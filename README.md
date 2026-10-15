# Ponte Local 🌉

Deixe sua IA operar o seu PC Linux remotamente, pelo chat — com segurança de verdade.
O agente é **um único arquivo Node.js, sem dependências**; o relay é um conjunto de API
routes Next.js. Nada de portas abertas: o agente só faz requests de **saída**.

> 🤖 **Você é uma IA (Claude, ChatGPT, Cursor, agente de código)?**
> Leia [`SKILL.md`](SKILL.md) — ele contém o passo a passo completo para você
> instalar a ponte, guiar o usuário no que instalar e começar a operar.

## Como funciona

```
┌──────────────┐   poll (1,5s)    ┌─────────────────────┐   admin    ┌──────────┐
│ SEU PC Linux │ ◄──────────────► │ relay Next.js       │ ◄────────► │   IA     │
│  agent.js    │  GET  /poll      │ /api/ponte/*        │ injeta cmd │ (chat ou │
│ (zero deps)  │  POST /result    │ URL pública https   │ + lê res.  │  agente) │
└──────────────┘                  └─────────────────────┘            └──────────┘
```

- **Agente** (roda no seu PC): faz poll de comandos a cada 1,5 s, executa, devolve resultado. Zero dependências, roda em qualquer distro com Node 18+.
- **Relay** (roda em VM/servidor): API routes que guardam a fila e os resultados em memória, com entrega exclusiva (claim/lease) e sequência persistida.
- **Operador** (CLI Python na VM): `ponte.py` — a IA injeta comandos e lê resultados pelo terminal.

## Destaques

- 🔒 **Escopo travado na home** — `.ssh`, `.gnupg`, `.config`, `.password-store`, `.aws`, `.kube` são inacessíveis para o agente
- 🗑️ **Exclusão = lixeira XDG** com log JSONL e `undo_last` — nada é apagado de verdade
- 🧨 **Trava anticatástrofe** no modo autônomo: fork bomb, `mkfs`, `wipefs`, `dd of=/dev/*`, `shred` em dispositivo e `rm -r` de sistema são recusados localmente, antes de executar
- 🎛️ **3 modos do `run_command`** — desligado (só arquivos), supervisionado (você aperta `s`/`N` no seu terminal) e autônomo — e a escalada é sempre **física**: só você, digitando o flag no seu PC
- 📦 19 ações de arquivo: list, tree, search por conteúdo, organização com plano-aprovação, duplicados (md5), disk usage, transferência de arquivos em base64 (8 MB), e mais
- 🖥️ **Painel web** com status, bloco de instalação pronto e resultados

## Requisitos

| Onde | O quê |
|------|-------|
| Seu PC (Linux) | Node.js 18+, `curl` |
| VM/servidor da IA | Node.js 18+ (Next.js), Python 3 (opcional), URL pública HTTPS para o relay |

## Quick start (manual)

No **servidor** (onde sua IA roda) — detalhes completos em [`SKILL.md`](SKILL.md) e [`relay/RESTAURAR.md`](relay/RESTAURAR.md):

```bash
npx create-next-app@latest ponte-relay --typescript --app --no-eslint --no-src-dir --import-alias "@/*"
# copie relay/ponte-store.ts → src/lib/, relay/api/* → src/app/api/ponte/,
# relay/painel/page.tsx → src/app/page.tsx, agente/agent.js → download/ponte-agent/
export PONTE_AGENT_TOKEN=$(openssl rand -hex 12)
export PONTE_ADMIN_TOKEN=$(openssl rand -hex 16)
npm install && npm run dev
```

No **seu PC** (com a URL pública do relay e o `PONTE_AGENT_TOKEN` que sua IA te passar):

```bash
mkdir -p ~/ponte-agent && cd ~/ponte-agent
curl -fso agent.js https://raw.githubusercontent.com/MicaelSanPedro/ponte-local/main/agente/agent.js
node agent.js --server https://SEU-RELAY --token SEU_TOKEN --save
```

Pronto — sua IA já pode `list`, `search`, organizar, mandar/receber arquivos e
(assim que você liberar `--allow-run` ou `--auto`) rodar comandos no seu PC.

## Segurança — o agente nunca

- Sai do escopo da home do usuário ou acessa pastas sensíveis
- Apaga de verdade (lixeira XDG + `undo_last`)
- Executa comandos catastróficos (trava local, mesmo com aprovação humana)
- Expõe a senha do sudo (comandos com sudo rodam no terminal do dono; padrão
  seguro documentado no `SKILL.md` mantém a senha fora de qualquer log)
- Aceita escalada de modo por mensagem — o flag é digitado no terminal do PC

**Tokens**: todos via variáveis de ambiente (`PONTE_AGENT_TOKEN`,
`PONTE_ADMIN_TOKEN`, `PONTE_TEST_TOKEN`) — nada hardcoded, nada versionado.
Gere os seus com `openssl rand -hex 12`.

## Estrutura

```
SKILL.md         instruções completas para IAs instalarem e operarem a ponte
agente/          agent.js (v1.3.0, Windows + Linux) + LEIA-ME.md + rodar.sh + atualizar.sh
relay/           ponte-store.ts + api/ponte/*/route.ts + painel + RESTAURAR.md
operador/        ponte.py (CLI admin) + teste-ponte*.sh (E2E)
```

## Licença

MIT — use, modifique e compartilhe. Se te ajudou, uma ⭐ no repo vale ouro.
