---
name: ponte-local
description: >-
  Operar o PC Linux do usuário remotamente pelo chat. Instalar a ponte
  (relay Next.js + agente Node.js zero-dependências), mostrar ao usuário
  o que ele precisa instalar, validar a conexão e executar operações de
  arquivos e comandos, com modos supervisionado/autônomo, lixeira XDG com
  undo e trava anticatástrofe. Use quando o usuário pedir para você
  mexer no computador dele: organizar arquivos, procurar coisas, rodar
  comandos, trocar configurações do desktop, automatizar tarefas locais.
---

# Ponte Local — skill de operação remota do PC do usuário

Você (a IA) comanda um relay que fala com um agente instalado no PC do usuário.
O agente faz **poll** a cada 1,5 s, executa e devolve o resultado. Ele só abre
conexões de **saída** — nada de portas abertas, firewall, port forwarding ou VPN.

```
┌──────────────┐   poll (1,5s)    ┌─────────────────────┐   admin    ┌──────────┐
│ PC do usuário │ ◄──────────────► │ relay Next.js       │ ◄────────► │   VOCÊ   │
│  agent.js     │  GET  /poll      │ /api/ponte/*        │ injeta cmd │ (IA que  │
│ (zero deps)   │  POST /result    │ URL pública https   │ + lê res.  │ lê isto) │
└──────────────┘                  └─────────────────────┘            └──────────┘
```

## Regras de ouro — leia antes de operar

1. **Destrutivo = confirmado.** Antes de qualquer operação em massa
   (`apply_plan`, muitos `move`/`write_text`), mostre o plano ao usuário e espere
   o OK. Exclusão via `apply_plan`/`delete` vai para a **lixeira XDG** (tem
   `undo_last`), mas mesmo assim confirme.
2. **A trava anticatástrofe é intransponível.** O agente recusa localmente
   fork bomb, `mkfs`, `wipefs`, `dd of=/dev/*`, `shred` em dispositivo, escrita
   em `/dev/sd*` e `rm -r` em alvo de sistema (`/`, `/*`, `/home`, `~`,
   `/boot`, `/etc`, `/usr`, `/var`, `/lib`, `/opt`, `/mnt`, `/media`).
   **Nunca tente contornar** (nem em modo supervisionado com aprovação).
3. **Escopo: a home do usuário.** Pastas sensíveis são bloqueadas no agente:
   `.ssh`, `.gnupg`, `.config`, `.password-store`, `.aws`, `.kube`, `ponte-agent`.
4. **Tokens e senhas nunca aparecem em log.** Token do agente via flag
   `--token` (salva em `ponte.config.json` local). Senha de sudo: só pelo
   padrão seguro da seção "Sudo sem expor senha".
5. **Caminhos absolutos.** Caminhos relativos resolvem contra o CWD do agente
   (a pasta onde ele foi iniciado, tipicamente `~/ponte-agent`) — use sempre
   `/home/usuario/...`.
6. **Um comando por vez de qualidade.** Prefira comandos pequenos e legíveis
   (o usuário pode ler no painel). Combine com `&&`/`;` quando fizer sentido.

## Pré-requisitos — mostre isto ao usuário

No **PC do usuário** (Linux), ele precisa de: Node.js **18+**, `curl` e um
terminal. Confira/instale conforme a distro:

| Distro        | Comando para instalar                                      |
|---------------|------------------------------------------------------------|
| Arch/CachyOS  | `sudo pacman -S --needed nodejs curl`                       |
| Debian/Ubuntu | `sudo apt install -y curl && curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo -E bash - && sudo apt install -y nodejs` |
| Fedora        | `sudo dnf install -y nodejs curl`                           |
| openSUSE      | `sudo zypper install -y nodejs20 curl`                      |

Verificação: `node --version` (≥ 18) e `curl --version`.

No **servidor onde VOCÊ roda** (VM, container, seu próprio servidor):

- Node.js 18+ (para o relay Next.js) e Python 3 (opcional, para o operador CLI)
- Uma **URL pública HTTPS** apontando para o relay (preview da plataforma,
  túnel como `ngrok`/`cloudflared`, ou servidor próprio). O PC do usuário
  só precisa alcançar essa URL.
- `openssl` para gerar os tokens.

## Fase 1 — Subir o relay

```bash
CI=1 npx create-next-app@latest ponte-relay --typescript --app --no-eslint --no-src-dir --import-alias "@/*"
cd ponte-relay
# copie os arquivos do repo (tabela abaixo), depois:
export PONTE_AGENT_TOKEN=$(openssl rand -hex 12)   # vai para o usuário
export PONTE_ADMIN_TOKEN=$(openssl rand -hex 16)   # só você usa
npm install && npm run dev                         # porta 3000
```

| Arquivo deste repo          | Destino no projeto Next.js           |
|-----------------------------|--------------------------------------|
| `relay/ponte-store.ts`      | `src/lib/ponte-store.ts`             |
| `relay/api/poll/route.ts`   | `src/app/api/ponte/poll/route.ts`    |
| `relay/api/result/route.ts` | `src/app/api/ponte/result/route.ts`  |
| `relay/api/cmd/route.ts`    | `src/app/api/ponte/cmd/route.ts`     |
| `relay/api/results/route.ts`| `src/app/api/ponte/results/route.ts` |
| `relay/api/status/route.ts` | `src/app/api/ponte/status/route.ts`  |
| `relay/api/download/route.ts`| `src/app/api/ponte/download/route.ts`|
| `relay/painel/page.tsx`     | `src/app/page.tsx`                   |
| `agente/agent.js`           | `download/ponte-agent/agent.js` (a rota `/api/ponte/download` serve este caminho) |

Se o projeto foi criado **sem** `src/`, ajuste os caminhos (`app/`, `lib/`).

**Next.js 16+ (obrigatório):** versões novas do `create-next-app` vêm com
`cacheComponents: true` no `next.config.ts`, e isso é **incompatível** com o
`export const dynamic = "force-dynamic"` das routes (erro: *Route segment
config \"dynamic\" is not compatible with nextConfig.cacheComponents*).
Edite `next.config.ts` e deixe apenas `cacheComponents: false`; se existir a
linha `partialPrefetching: true`, **remova-a também** (depende de
`cacheComponents`). Depois reinicie o `npm run dev`.

Valide: `curl -s https://SEU-RELAY/api/ponte/status` → deve responder
`{"ok":true,"connected":false,...}`. Se vier HTML de erro 500, releia o log do
dev — quase sempre é o `cacheComponents` do tópico acima.

**Importante:** o dev server precisa **herdar** os tokens exportados. Se
reiniciar o server, reexporte antes. A URL pública do preview pode mudar a
cada rebuild — confira e, se mudar, o agente precisa ser religado com a URL
nova (`--server NOVA_URL --save`).

## Fase 2 — Instalar o agente no PC do usuário

Entregue ao usuário **exatamente este bloco** (substitua URL e TOKEN):

```bash
mkdir -p ~/ponte-agent && cd ~/ponte-agent
curl -fso agent.js https://SEU-RELAY/api/ponte/download
node agent.js --server https://SEU-RELAY --token PONTE_AGENT_TOKEN --save
```

- Alternativa quando este repo é público:
  `curl -fso agent.js https://raw.githubusercontent.com/MicaelSanPedro/ponte-local/main/agente/agent.js`
- Peça para ele **manter o terminal aberto** (o agente roda em primeiro plano;
  o banner mostra modo, escopo e proteções).
- Próximas vezes: `~/ponte-agent/rodar.sh` (relê `ponte.config.json`).
- O `AGENT_TOKEN` é sensível: entregue no canal privado onde o usuário roda
  os comandos. Nunca versionado.

## Fase 3 — Validar a conexão

```bash
python3 operador/ponte.py --status      # connected:true + info da máquina
python3 operador/ponte.py ping          # latência + CPU/RAM/Node
```

O operador `ponte.py` enfileira um comando, espera o resultado (150 s padrão)
e imprime o JSON. Configure antes:

```bash
export PONTE_URL=https://SEU-RELAY
export PONTE_ADMIN_TOKEN=<o mesmo do relay>
```

Detalhe: o primeiro poll do agente usa `fresh=true` e pula comandos antigos
da fila (evita executar lixo de sessão anterior). Comandos órfãos sem
destinatário só expiram sozinhos.

## Fase 4 — Operar (referência das ações)

Envie comandos por `POST /api/ponte/cmd` com header `x-ponte-admin: ADMIN_TOKEN`,
corpo `{"action":"...","args":{...}}` — ou via `ponte.py`:

```bash
python3 ponte.py <ação> '<args-json>'
python3 ponte.py enviar <arquivo-local> <destino-absoluto-remoto>   # write_binary
python3 ponte.py pegar <origem-absoluta-remota> <arquivo-local>     # read_binary
python3 ponte.py --drain      # lê resultados pendentes
PONTE_WAIT_S=300 python3 ponte.py ...   # espera mais (modo supervisionado)
```

| Ação | Args (JSON) | O que faz |
|------|-------------|-----------|
| `ping` | `{}` | Latência, CPU, RAM, Node, modo do agente |
| `list` | `{"path":"/home/u/Downloads"}` | Lista pasta (nome, pasta?, bytes, mtime) |
| `tree` | `{"path":"...","depth":2}` | Árvore (profundidade máx. 4) |
| `read_text` | `{"path":"..."}` | Lê arquivo texto |
| `write_text` | `{"path":"...","content":"...","overwrite":true}` | Cria/sobrescreve (antigo → lixeira) |
| `search` | `{"path":"...","query":"termo","mode":"name"\|"content"}` | Busca por nome ou conteúdo |
| `mkdir` | `{"path":"..."}` | Cria pasta(s) |
| `move` | `{"from":"...","to":"..."}` | Move/renomeia |
| `rename` | `{"path":"...","newName":"novo.ext"}` | Renomeia no mesmo lugar |
| `organize_plan` | `{"path":"/home/u/Downloads"}` | Propõe plano de organização por tipo (não executa!) |
| `apply_plan` | `{"plan":[{"de":"/a/b.txt","para":"/c/b.txt"}]}` | Executa movimentos em lote (mostre o plano antes) |
| `undo_last` | `{}` | Desfaz a última operação (lixeira/lote) |
| `free_space` | `{}` | Espaço livre/total dos discos |
| `disk_usage` | `{"path":"...","depth":2}` | Tamanho por subpasta |
| `duplicates` | `{"path":"...","minSizeBytes":1048576}` | Duplicados (tamanho→md5) + espaço recuperável |
| `read_binary` | `{"path":"..."}` | Arquivo binário em base64 (máx 8 MB) |
| `write_binary` | `{"path":"...","base64":"...","overwrite":true}` | Grava binário (máx 8 MB) |
| `run_command` | `{"command":"...","cwd":"/home/u","timeoutMin":3}` | Shell — exige modo habilitado (abaixo) |

Resposta de cada comando: `{"id","ok","data"|"error","durationMs","ts"}`.

## `run_command` — os 3 modos (escalada é FÍSICA)

| Modo | O usuário religa com | Comportamento |
|------|----------------------|---------------|
| Desligado (padrão) | `node agent.js` | `run_command` negado; só operações de arquivo |
| Supervisionado | `node agent.js --allow-run --save` | Caixa no terminal dele, `s`/`N` em 60 s; sem resposta = rejeita |
| Autônomo | `node agent.js --auto --save` | Executa direto, loga `[AUTO] $ cmd`, trava anticatástrofe ativa |

Só o usuário pode trocar de modo (digitar o flag no terminal DELE). Peça com
clareza, ex.: *"Ctrl+C no terminal do agente e rode `node agent.js --auto --save`
— isso me dá execução direta com a trava anticatástrofe, ok?"*

Ao comandar em modo supervisionado, use `PONTE_WAIT_S=150` (ou mais) — a
espera padrão do operador precisa cobrir os 60 s do prompt + execução.

## Sudo sem expor senha (padrão seguro) — só com autorização explícita

Quando um comando precisa de sudo e o usuário autorizou (idealmente forneceu a
senha ou já configurou NOPASSWD):

1. `write_text` → `/home/u/Downloads/.tmp-senha` com `content: "SENHA\n"`
   (a senha viaja no corpo do comando, **nunca** dentro de um shell em log)
2. `run_command` → `sudo -S bash -c 'COMANDO_REAL' < /home/u/Downloads/.tmp-senha`
3. `run_command` → `rm -f /home/u/Downloads/.tmp-senha` (rm real via shell —
   a ação `delete` iria para a lixeira e a senha ficaria recuperável!)

Se o usuário quiser NOPASSWD permanente, só com pedido explícito dele:

```bash
sudo -S bash -c 'echo "usuario ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/90-nopasswd \
  && chmod 440 /etc/sudoers.d/90-nopasswd \
  && (visudo -c >/dev/null 2>&1 && echo OK || rm -f /etc/sudoers.d/90-nopasswd)' < .tmp-senha
```

`visudo -c` valida e o rollback remove o arquivo se a sintaxe estiver errada —
**nunca deixe um sudoers inválido no disco** (quebra o sudo da máquina).

## Troubleshooting

| Sintoma | Causa | Correção |
|---------|-------|----------|
| `Comando vazio` no `run_command` | chave errada no args | a chave é **`command`**, não `comando` |
| `Pasta protegida no caminho: ponte-agent` | caminho relativo resolveu contra o CWD do agente (a pasta dele é bloqueada) | use **caminho absoluto** `/home/u/...` |
| `Pasta protegida: .ssh/.config/...` | pasta sensível bloqueada | respeite; peça ao usuário, se preciso, por outro caminho |
| Agente não conecta (`connected:false`) | URL/token errados ou server reiniciou sem tokens | confira `--server`, reexporte tokens, religue o agente |
| `TEMPO ESGOTADO` com agente conectado | baseline do operador maior que os ids da instância nova | apague `.ponte_since_prod` em `PONTE_STATE_DIR` (corrigido: fallback é 0) |
| `TEMPO ESGOTADO` em modo supervisionado | ninguém apertou `s` | reenvie; use `PONTE_WAIT_S=150+` |
| `Fila de comandos cheia` | agente offline acumulando | verifique `--status`; o agente pula histórico com `fresh=true` |
| `Fora do escopo` | caminho fora da home | só `/home/usuario/**` é permitido |
| Base64 grande falha | > 8 MB | divida o arquivo ou use `run_command` (curl/wget no PC) |
| Comando some após rebuild do relay | URL de preview mudou | religue agente com `--server NOVA_URL --save` |

## Limites técnicos

| Limite | Valor |
|--------|-------|
| Corpo de requisição na ponte | 1,5 MB |
| Binário em base64 (`read/write_binary`) | 8 MB |
| Timeout por `run_command` | 30 min |
| Resposta do comando | 150.000 caracteres |
| Tamanho do comando | 4.000 caracteres |
| Fila de comandos pendentes | 100 |
| Histórico de resultados | 400 |
| Janela "conectado" | 15 s sem poll |

## Atualizar o agente no PC do usuário

```bash
# nova versão deste repo: baixe e envie via write_binary para /home/u/Downloads/
# no PC do usuário:
cp ~/Downloads/agent-vNOVA.js ~/ponte-agent/agent.js
# Ctrl+C no agente e religue no modo escolhido (--auto --save / --allow-run --save)
```

## Estrutura deste repo

```
SKILL.md       ← este arquivo (instruções para você, IA)
agente/        agent.js + LEIA-ME.md + rodar.sh + atualizar.sh  (lado do PC)
relay/         ponte-store.ts + api/ponte/*/route.ts + painel + RESTAURAR.md (lado do servidor)
operador/      ponte.py + teste-ponte*.sh  (CLI da IA na VM)
```
