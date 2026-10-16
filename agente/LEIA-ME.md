# Ponte Local — Agente

Este agente conecta o seu computador à "Ponte": um canal pelo qual eu (a IA da
nossa conversa) consigo ver e organizar os seus arquivos **de dentro da minha
VM**, sem você precisar copiar nada manualmente.

## Como funciona

1. O agente roda no seu PC e pergunta ao relay (uma vez a cada 1,5 s):
   "tem comando novo?"
2. Quando eu mando um comando, o agente executa **localmente no seu disco**.
3. O resultado (listagens, caminhos, confirmações) volta pela ponte.
   **Seus arquivos nunca são enviados para lugar nenhum** — só texto de
   comandos e respostas trafega.

## Requisitos

- **Windows 10/11** ou **Linux** com Node.js 18+:
  - Linux (Arch/CachyOS): `sudo pacman -S --needed nodejs`
  - Windows: `winget install OpenJS.NodeJS.LTS` (ou instalador do nodejs.org)

## Como rodar (primeira vez)

1. Abra o terminal na pasta onde está este arquivo (no Windows, PowerShell).
2. Rode o comando que te passei no chat (ele já vem com servidor e token
   preenchidos — você não configura nada à mão):

   **Linux:**

   ```bash
   node agent.js --server https://SEU-LINK-DE-PREVIEW --token SEU_TOKEN --save
   ```

   **Windows (PowerShell):**

   ```powershell
   node agent.js --server https://SEU-LINK-DE-PREVIEW --token SEU_TOKEN --save
   ```

   O `--save` grava a configuração em `ponte.config.json`, então das próximas
   vezes é só rodar:

   ```bash
   node agent.js
   ```

3. Deixe a janela aberta. Quando o agente conectar, o banner dele mostra modo,
   escopo e proteções — e do lado da IA o status já responde `connected:true`.
   (Se o relay tiver painel web, é só um visor opcional com uma luz verde:
   nada da instalação depende dele.)

Para encerrar: `Ctrl+C`. Para religar: `node agent.js`.

## O que o agente PODE fazer (lista fixa — nada além disso)

| Ação             | O que faz                                                          |
| ---------------- | ------------------------------------------------------------------ |
| `ping`           | Identifica a máquina (usuário, CPU, RAM, home, modo ativo)          |
| `list`           | Lista o conteúdo de uma pasta                                       |
| `tree`           | Visão em árvore de pastas (até 4 níveis)                            |
| `file_info`      | Diz o tipo REAL do arquivo (png, pdf, exe, mp4, zip…) pelo conteúdo + encoding se for texto |
| `read_text`      | Lê texto de arquivos de QUALQUER tamanho, em pedaços (siga `proximoOffset`); detecta utf-8, cp1252, utf-16 e latin1 |
| `write_text`     | Cria/sobrescreve arquivos de texto (antigo vai pra lixeira)         |
| `read_binary`    | Lê binário em base64 por pedaços — arquivo de qualquer tamanho      |
| `write_binary`   | Recebe arquivo binário (até 8 MB) da ponte                          |
| `search`         | Busca por nome ou por conteúdo em toda a home                       |
| `mkdir`          | Cria pastas                                                         |
| `move`/`rename`  | Move/renomeia arquivos e pastas                                     |
| `delete`         | Manda para a **lixeira do agente** (nunca apaga de verdade)         |
| `restore`        | Restaura item da lixeira                                            |
| `organize_plan`  | Gera um plano de organização por tipo de arquivo                    |
| `apply_plan`     | Executa o plano (com desfazer)                                      |
| `duplicates`     | Acha arquivos duplicados por tamanho + hash                         |
| `disk_usage`     | Mostra as pastas que mais ocupam espaço                             |
| `undo_last`      | Desfaz a última ação reversível                                     |
| `free_space`     | Mostra espaço livre em disco                                        |
| `run_command`    | Executa um comando de shell. Depende do modo (veja abaixo): **supervisionado** pede `s/N` no terminal; **autônomo** executa direto, exceto padrões catastróficos |

## Os 3 modos do run_command

| Modo | Como ativar | O que acontece |
| ---- | ----------- | -------------- |
| **Desligado** (padrão) | — | Nenhum comando de shell roda. Só operações de arquivo. |
| **Supervisionado** | `node agent.js --allow-run --save` | Cada comando aparece numa caixa no terminal e roda só com `s` + Enter (60s para responder). |
| **Autônomo** | `node agent.js --auto --save` | A IA executa os comandos SOZINHA, sem perguntar. O terminal só registra `[AUTO] $ comando`. Uma trava anticatástrofe recusa sempre: `rm -rf` na raiz/home/sistema, `mkfs`, `dd` em disco, fork bomb, `wipefs`, `shred` em dispositivo. |

A escalada de permissão é sempre FÍSICA: é você quem digita `--allow-run`
ou `--auto` no SEU terminal — a IA não consegue ligar modos sozinha.

## Modo supervisionado — detalhe

1. Você religa o agente com `--allow-run --save` (uma vez só; fica salvo)
2. Quando a IA propor um comando, ele aparece numa caixa no terminal do agente
3. Você lê o comando e digita `s` (executar) ou `n`/Enter (recusar)
4. Sem resposta em 60s = recusado automaticamente
5. A saída do comando volta pela ponte pra IA analisar

A trava é física: o comando só roda se VOCÊ apertar Enter no SEU teclado.
Se o agente rodar em background (sem terminal), nada é executado.

## O que o agente NUNCA faz

- **Com o run_command desligado** (padrão): não executa nenhum comando de shell
- **No modo supervisionado**: nenhum comando roda sem você digitar "s" no terminal — e cada comando aparece por completo antes
- **No modo autônomo**: comandos rodam sem confirmação, MAS a trava anticatástrofe recusa os que destroem o sistema de uma vez (no Windows: `format`, `diskpart`, `rd /s` em raiz de drive etc.), e TUDO fica registrado em `ponte-log.jsonl`
- Não acessa nada fora da sua home (ações de arquivo)
- Não toca em pastas sensíveis: `.ssh`, `.gnupg`, `.config`, `.password-store`,
  `.aws`, `.kube`
- Não apaga arquivos permanentemente (sempre lixeira, sempre recuperável)

## Arquivos gerados aqui

- `ponte.config.json` — servidor, token e escopo (criado com `--save`)
- `ponte-log.jsonl` — registro local de tudo que aconteceu, com informação de
  desfazer

Você pode ler os dois com qualquer editor. O código do agente é um arquivo só
e está aberto — vale a pena conferir.
