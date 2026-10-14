# Restaurar o relay da ponte (depois de um reset da VM)

A VM reseta e perde o projeto Next.js inteiro. Este guia reconstrói **só a parte da ponte** em ~5 minutos.

## 1. Criar o projeto Next.js

```bash
npx create-next-app@latest ponte-relay --typescript --app --no-eslint --no-tailwind --no-src-dir --import-alias "@/*"
cd ponte-relay
```

> Se a plataforma de preview exigir Tailwind/shadcn (como o projeto original), pode criar com eles — a ponte não depende disso.

## 2. Copiar os arquivos deste repositório

Do clone deste repo (`git clone https://github.com/MicaelSanPedro/ponte-local`):

| Arquivo do repo                          | Destino no projeto Next.js                      |
|------------------------------------------|--------------------------------------------------|
| `relay/ponte-store.ts`                   | `src/lib/ponte-store.ts` (criar a pasta `lib`)   |
| `relay/api/poll/route.ts`                | `src/app/api/ponte/poll/route.ts`                |
| `relay/api/result/route.ts`              | `src/app/api/ponte/result/route.ts`              |
| `relay/api/cmd/route.ts`                 | `src/app/api/ponte/cmd/route.ts`                 |
| `relay/api/results/route.ts`             | `src/app/api/ponte/results/route.ts`             |
| `relay/api/status/route.ts`              | `src/app/api/ponte/status/route.ts`              |
| `relay/api/download/route.ts`            | `src/app/api/ponte/download/route.ts`            |
| `relay/painel/page.tsx`                  | `src/app/page.tsx` (substitui a página inicial)  |
| `agente/agent.js`                        | `download/ponte-agent/agent.js` (a rota `/api/ponte/download` serve esse caminho) |

Se o projeto usa `src/` desativado, ajuste os caminhos (`app/`, `lib/`) — o `ponte-store.ts` é importado pelas routes como `@/lib/ponte-store`.

## 3. Rodar

```bash
npm install
npm run dev        # porta 3000
```

A URL pública de preview muda a cada rebuild. O painel (`/`) mostra o link atual e o bloco de instalação pronto.

## 4. Reconectar o agente

Se o PC do usuário continua com `~/ponte-agent/ponte.config.json` do relay antigo, o agente vai tentar o link antigo e falhar. Opções:

```bash
# opção A: apontar para o novo link
node ~/ponte-agent/agent.js --server https://NOVO-LINK --token SEU_TOKEN --save

# opção B: reinstalar via curl do novo relay (ou do raw deste repo — ver README)
```

## 5. Tokens

Os tokens reais estão versionados em `relay/ponte-store.ts` (agente + admin) e `operador/ponte.py` (admin). Para trocá-los:

1. Edite `ponte-store.ts` — são strings fixas comparadas no header `x-token` de cada rota
2. Atualize `operador/ponte.py` (constante do admin)
3. No PC, religue o agente com `--token NOVO_TOKEN --save`

Estado da fila/resultados vive em `globalThis` (`__ponteState`) — nada é persistido em disco no relay. O histórico fica no PC (`~/ponte-agent/ponte-log.jsonl`).
