#!/usr/bin/env python3
"""
ponte.py — operador da Ponte Local (lado da IA, dentro da VM).
Uso: python3 ponte.py <ação> [args_json]
Ex:  python3 ponte.py ping
     python3 ponte.py list '{"path":"/home/user/Downloads"}'
Envia o comando, espera o resultado e imprime o JSON completo.
"""
import json
import os
import sys
import time
import urllib.request

BASE = os.environ.get("PONTE_URL", "http://127.0.0.1:3000")
# Token admin da ponte — exporte antes de usar:
#   export PONTE_ADMIN_TOKEN=$(openssl rand -hex 16)   (o mesmo do relay)
ADMIN_TOKEN = os.environ.get("PONTE_ADMIN_TOKEN", "")
# Canal: "prod" (PC real do usuário) ou "test" (agente de teste na VM)
CHANNEL = os.environ.get("PONTE_CHANNEL", "prod")
# Baseline de resultados lidos — salva junto ao script (ou em PONTE_STATE_DIR)
BASELINE_FILE = os.path.join(
    os.environ.get("PONTE_STATE_DIR", os.path.dirname(os.path.abspath(__file__))),
    ".ponte_since_%s" % CHANNEL,
)


def req(path, body=None, method=None):
    # IMPORTANTE: montar a URL completa ANTES de criar o Request
    if "/results" in path and "channel=" not in path:
        sep = "&" if "?" in path else "?"
        path = path + sep + "channel=" + CHANNEL
    r = urllib.request.Request(BASE + path, method=method)
    r.add_header("x-ponte-admin", ADMIN_TOKEN)
    data = None
    if body is not None:
        if CHANNEL != "prod" and isinstance(body, dict) and "channel" not in body and path.endswith("/cmd"):
            body["channel"] = CHANNEL
        data = json.dumps(body).encode()
        r.add_header("content-type", "application/json")
    with urllib.request.urlopen(r, data=data, timeout=60) as resp:
        return json.loads(resp.read().decode())


def get_since():
    try:
        with open(BASELINE_FILE) as f:
            return int(f.read().strip())
    except Exception:
        return 0  # instância nova: ids de resultado começam em 1


def set_since(n):
    with open(BASELINE_FILE, "w") as f:
        f.write(str(n))


def main():
    if not ADMIN_TOKEN:
        print("ERRO: PONTE_ADMIN_TOKEN não definido.")
        print("  export PONTE_ADMIN_TOKEN=<o mesmo token configurado no relay>")
        print("  (e PONTE_URL se o relay não estiver em http://127.0.0.1:3000)")
        return 1
    if len(sys.argv) < 2:
        print("uso: ponte.py <ação> [args_json] | --status | --drain | pegar <remoto> <local> | enviar <local> <remoto>")
        return 1
    if sys.argv[1] == "--status":
        print(json.dumps(req("/api/ponte/status"), ensure_ascii=False, indent=2))
        return 0
    if sys.argv[1] == "--drain":  # lê resultados pendentes sem mandar comando
        since = get_since()
        d = req(f"/api/ponte/results?since={since}")
        for r in d["results"]:
            print(json.dumps(r, ensure_ascii=False, indent=2)[:3000])
            set_since(max(since, r["id"]))
            since = max(since, r["id"])
        if not d["results"]:
            print(f"(nenhum resultado novo desde {since})")
        return 0
    if sys.argv[1] == "pegar":  # read_binary → decodifica → salva local
        import base64
        remoto, local = sys.argv[2], sys.argv[3]
        since = get_since()
        out = req("/api/ponte/cmd", {"action": "read_binary", "args": {"path": remoto}}, method="POST")
        if not out.get("ok"):
            print("ERRO:", out); return 1
        cid = out["id"]
        for _ in range(40):
            time.sleep(1.5)
            d = req(f"/api/ponte/results?since={since}")
            for r in d["results"]:
                set_since(max(since, r["id"]))
                since = max(since, r["id"])
                if r["id"] == cid:
                    if not r["ok"]:
                        print("ERRO do agente:", r.get("error")); return 2
                    data = r.get("data") or {}
                    raw = base64.b64decode(data.get("base64", ""))
                    with open(local, "wb") as f:
                        f.write(raw)
                    print(f"OK: {remoto} ({data.get('bytes')} bytes) → {local}")
                    return 0
        print("TEMPO ESGOTADO"); return 3
    if sys.argv[1] == "enviar":  # codifica local em base64 → write_binary
        import base64
        local, remoto = sys.argv[2], sys.argv[3]
        size = os.path.getsize(local)
        if size > 8 * 1024 * 1024:
            print(f"ERRO: {local} tem {size} bytes — limite 8 MB"); return 1
        with open(local, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        since = get_since()
        out = req("/api/ponte/cmd", {"action": "write_binary", "args": {"path": remoto, "base64": b64, "overwrite": True}}, method="POST")
        if not out.get("ok"):
            print("ERRO:", out); return 1
        cid = out["id"]
        for _ in range(40):
            time.sleep(1.5)
            d = req(f"/api/ponte/results?since={since}")
            for r in d["results"]:
                set_since(max(since, r["id"]))
                since = max(since, r["id"])
                if r["id"] == cid:
                    if not r["ok"]:
                        print("ERRO do agente:", r.get("error")); return 2
                    print(f"OK: {local} ({size} bytes) → {remoto} (substituiu: {(r.get('data') or {}).get('substituiu')})")
                    return 0
        print("TEMPO ESGOTADO"); return 3

    action = sys.argv[1]
    args = {}
    if len(sys.argv) >= 3:
        args = json.loads(sys.argv[2])

    since = get_since()
    out = req("/api/ponte/cmd", {"action": action, "args": args}, method="POST")
    if not out.get("ok"):
        print("ERRO ao enfileirar:", out)
        return 1
    cid = out["id"]
    print(f"→ comando #{cid} ({action}) na fila; aguardando o agente...")

    # Espera padrão: 150s — precisa cobrir o prompt s/N (60s) + execução do comando.
    # Ajustável via env: PONTE_WAIT_S=300 python3 ponte.py ...
    deadline = time.time() + int(os.environ.get("PONTE_WAIT_S", "150"))
    while time.time() < deadline:
        time.sleep(1.5)
        d = req(f"/api/ponte/results?since={since}")
        for r in d["results"]:
            set_since(max(since, r["id"]))
            since = max(since, r["id"])
            if r["id"] == cid:
                ok = "OK" if r["ok"] else f"ERRO: {r.get('error')}"
                print(f"← #{cid} [{ok}] ({r.get('durationMs', 0)}ms no seu PC)")
                print(json.dumps(r.get("data"), ensure_ascii=False, indent=2)[:60000])
                return 0 if r["ok"] else 2
    print(f"TEMPO ESGOTADO esperando o resultado do comando #{cid}")
    return 3


if __name__ == "__main__":
    sys.exit(main())
