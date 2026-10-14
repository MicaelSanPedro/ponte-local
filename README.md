# Ponte Local

Controle remoto do seu PC Linux direto pelo chat, através de um relay Next.js.
O agente é **um único arquivo Node.js, sem dependências** — roda em qualquer máquina com Node 18+.

>Este repositório é o backup do projeto. **Contém os tokens da minha ponte pessoal** (em `relay/ponte-store.ts` e `operador/`), por isso é **privado**. Se for tornar público, troque os tokens por placeholders primeiro.

## Arquitetura

```
┌──────────────┐   poll (1,5s)   ┌─────────────────────┐   admin    ┌──────────┐
│ SEU PC Linux │ ◄─────────────► │  VM: relay Next.js  │ ◄────────► │  Chat IA │
│  agent.js    │  GET /poll      │  /api/ponte/*       │  injeta    │ (painel/ │
│ (zero deps)  │  POST /result   │  porta 3000         │  comanda   │ ponte.py)│
└──────────────┘                 └─────────────────────┘            └──────────┘
```

- **Agente** (roda no seu PC): faz poll de comandos a cada 1,5s, executa, devolve resultado. Só abre conexões de **saída** — nada de portas abertas, nada de port forwarding.
- **Relay** (roda na VM): API routes Next.js que guardam a fila de comandos e os resultados em memória (`globalThis`).
- **Operador**: CLI (`ponte.py`, zero dependências além de Python 3) para comandar a ponte pelo terminal.

## Estrutura do repositório

```
agente/       agent.js (v1.2.0) + LEIA-ME.md + rodar.sh + atualizar.sh
relay/        ponte-store.ts + api/ponte/*/route.ts + painel (page.tsx) + RESTAURAR.md
operador/     ponte.py (CLI admin) + scripts de teste
```

## Os 3 modos do run_command

| Modo          | Como ativar                     | Comportamento do `run_command`                    |
|---------------|---------------------------------|---------------------------------------------------|
| Desligado     | (padrão)                        | Ação negada — só operações de arquivo              |
| Supervisionado| `node agent.js --allow-run --save` | Caixa no terminal do PC, você aperta `s`/`N` (60s; sem resposta = rejeita) |
| Autônomo      | `node agent.js --auto --save`   | Executa direto, loga `[AUTO] $ cmd`, com trava anticatástrofe |

Trocar de modo é sempre **físico**: só digitando o flag no terminal do PC onde o agente roda.

## Trava anticatástrofe (modo autônomo)

O agente recusa (localmente, antes de executar) comandos como:

- fork bomb (`:(){ :|:& };:`)
- `mkfs` / `wipefs` (formatar filesystem)
- `dd of=/dev/sd*`, `shred` em dispositivo, escrita `> /dev/sd*`
- `rm -r` em alvo de sistema: `/`, `/*`, `/home`, `~`, `/boot`, `/etc`, `/usr`, `/var`, `/lib`, `/opt`, `/mnt`, `/media`

`rm -rf` em pasta do próprio usuário continua liberado (uso normal).

## O que o agente nunca faz

- Sai do escopo da home do usuário (`BLOCKED_DIRS`: `.ssh`, `.gnupg`, `.config`, `.password-store`, `.aws`, `.kube`, `.ponte-agent`)
- Apaga de verdade — `delete` vai para a **lixeira XDG**, com log JSONL e `undo_last`
- Executa comando com timeout > 30 min, corpo > 1,5 MB, resposta > 150k chars, comando > 4000 chars
- Expõe a senha do sudo — comandos com sudo rodam no terminal do PC, a senha é digitada só lá

## Instalar o agente (no PC Linux)

**Forma 1 — via relay da ponte** (o painel mostra o bloco pronto):

```bash
mkdir -p ~/ponte-agent && cd ~/ponte-agent
curl -fso agent.js https://SEU-LINK-DE-PREVIEW/api/ponte/download
node agent.js --server https://SEU-LINK-DE-PREVIEW --token SEU_TOKEN --save
```

**Forma 2 — via este repositório** (sobrevive a reset da VM; repo **privado** = precisa de um token GitHub com escopo `repo`):

```bash
mkdir -p ~/ponte-agent && cd ~/ponte-agent
curl -fso agent.js -H "Authorization: token SEU_TOKEN_GITHUB" \
  https://raw.githubusercontent.com/MicaelSanPedro/ponte-local/main/agente/agent.js
node agent.js --server https://SEU-LINK-DE-PREVIEW --token SEU_TOKEN --save
```

Próximas vezes basta `./rodar.sh` (ou `node agent.js`) — servidor e token ficam salvos em `ponte.config.json`.

## Restaurar o relay (depois de um reset da VM)

Guia completo em [`relay/RESTAURAR.md`](relay/RESTAURAR.md). Resumo: criar projeto Next.js, copiar `relay/ponte-store.ts` → `src/lib/`, `relay/api/*` → `src/app/api/ponte/`, `relay/painel/page.tsx` → `src/app/page.tsx`, colocar `agente/agent.js` em `download/ponte-agent/agent.js`, `npm run dev`.

## Operador (CLI admin)

```bash
python3 ponte.py --status              # conectado? modo? fila pendente?
python3 ponte.py ping                  # latência + info da máquina
python3 ponte.py list '{"caminho":"Downloads"}'
python3 ponte.py run_command '{"comando":"free -h","timeoutMin":2}'
python3 ponte.py enviar arquivo.zip destino/remoto.zip   # base64 → write_binary
python3 ponte.py --drain               # lê resultados acumulados
PONTE_WAIT_S=300 python3 ponte.py ...  # espera mais (útil em modo supervisionado)
```

Segurança dos tokens: o token do agente identifica o PC (1 agente por token), o token admin comanda. Ambos ficam em `relay/ponte-store.ts` (relay) e `operador/ponte.py` (CLI). Janela de "conectado": 15 s sem poll.
