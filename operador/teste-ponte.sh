#!/usr/bin/env bash
# Teste ponta a ponta da Ponte Local — simula o PC do usuário dentro da VM
set -e
AGENT_TOKEN="f4f50a789db13e5f40ffd8b0"
ADMIN_TOKEN="bb094b43a4be17f1ad09c070112f0514"
BASE="http://127.0.0.1:3000"
AGENT_DIR="/home/z/my-project/download/ponte-agent"
TEST_HOME="/home/z/ponte-teste-home"

echo "=== 1. Home falsa com arquivos de teste ==="
rm -rf "$TEST_HOME"
mkdir -p "$TEST_HOME/Downloads" "$TEST_HOME/Documentos"
echo "relatorio fiscal 2024" > "$TEST_HOME/Downloads/imposto-2024.pdf"
echo "conteudo da nota" > "$TEST_HOME/Downloads/nota.txt"
head -c 50000 /dev/urandom > "$TEST_HOME/Downloads/foto-viagem.jpg"
head -c 120000 /dev/urandom > "$TEST_HOME/Downloads/programa-instalar.zip"
head -c 30000 /dev/urandom > "$TEST_HOME/Downloads/musica-favorita.mp3"
head -c 20000 /dev/urandom > "$TEST_HOME/Downloads/video-aniversario.mp4"
echo "lista de compras: arroz, feijao" > "$TEST_HOME/Documentos/compras.md"
ls "$TEST_HOME/Downloads"

echo "=== 2. Sobe agente de teste (simula o PC do usuário) ==="
pkill -f "node agent.js" 2>/dev/null || true
cd "$AGENT_DIR"
nohup node agent.js --server "$BASE" --token "$AGENT_TOKEN" --home "$TEST_HOME" > /tmp/agent-teste.log 2>&1 &
AGENT_PID=$!
echo "agente PID $AGENT_PID — aguardando 4s para o primeiro poll..."
sleep 4
tail -6 /tmp/agent-teste.log

cmd() { curl -s -X POST "$BASE/api/ponte/cmd" -H "x-ponte-admin: $ADMIN_TOKEN" -H "content-type: application/json" -d "$1"; }

wait_result() {
  for i in $(seq 1 20); do
    R=$(curl -s "$BASE/api/ponte/results?since=0" -H "x-ponte-admin: $ADMIN_TOKEN")
    FOUND=$(echo "$R" | python3 -c "
import sys, json
d = json.load(sys.stdin)
rs = [r for r in d['results'] if r['id'] == $1]
print(json.dumps(rs[0], ensure_ascii=False)[:1200] if rs else '')" 2>/dev/null)
    if [ -n "$FOUND" ]; then echo "$FOUND"; return 0; fi
    sleep 1.5
  done
  echo "TIMEOUT aguardando resultado do comando $1"
}

NEWID() { python3 -c "import sys,json;print(json.load(sys.stdin)['id'])"; }

echo "=== 3. ping ==="
ID=$(cmd '{"action":"ping"}' | NEWID)
wait_result "$ID"

echo "=== 4. list Downloads ==="
ID=$(cmd "{\"action\":\"list\",\"args\":{\"path\":\"$TEST_HOME/Downloads\"}}" | NEWID)
wait_result "$ID"

echo "=== 5. organize_plan Downloads ==="
ID=$(cmd "{\"action\":\"organize_plan\",\"args\":{\"path\":\"$TEST_HOME/Downloads\"}}" | NEWID)
wait_result "$ID"

echo "=== 6. apply_plan ==="
PLAN=$(curl -s "$BASE/api/ponte/results?since=0" -H "x-ponte-admin: $ADMIN_TOKEN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = [x for x in d['results'] if x['ok'] and isinstance(x.get('data'), dict) and 'plano' in x['data']][-1]
print(json.dumps({'action':'apply_plan','args':{'plan': r['data']['plano']}}))")
ID=$(curl -s -X POST "$BASE/api/ponte/cmd" -H "x-ponte-admin: $ADMIN_TOKEN" -H "content-type: application/json" -d "$PLAN" | NEWID)
wait_result "$ID"
echo "--- Downloads depois do plano:"
ls -R "$TEST_HOME/Downloads"

echo "=== 7. delete (vai pra lixeira) ==="
ID=$(cmd "{\"action\":\"delete\",\"args\":{\"paths\":[\"$TEST_HOME/Downloads/Documentos/imposto-2024.pdf\"]}}" | NEWID)
wait_result "$ID"
echo "--- lixeira:"
ls "$TEST_HOME/.local/share/Trash/files" 2>/dev/null

echo "=== 8. undo_last (restaura da lixeira) ==="
ID=$(cmd '{"action":"undo_last"}' | NEWID)
wait_result "$ID"
echo "--- imposto voltou?"
ls "$TEST_HOME/Downloads/Documentos/" 2>/dev/null

echo "=== 9. busca por nome ==="
ID=$(cmd "{\"action\":\"search\",\"args\":{\"path\":\"$TEST_HOME\",\"query\":\"imposto\",\"mode\":\"name\"}}" | NEWID)
wait_result "$ID"

echo "=== 10. teste de escopo (deve FALHAR) ==="
ID=$(cmd '{"action":"list","args":{"path":"/etc"}}' | NEWID)
wait_result "$ID"

echo "=== FIM DOS TESTES ==="
kill $AGENT_PID 2>/dev/null || true
