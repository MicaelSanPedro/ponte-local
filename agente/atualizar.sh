#!/usr/bin/env bash
# Ponte Local — atualiza o agente para a v1.2.0 (modo autônomo disponível)
# Roda NO SEU COMPUTADOR: bash ~/ponte-update/atualizar.sh
set -e
SRC="$HOME/ponte-update/agent.js"
[ -f "$SRC" ] || { echo "[x] $SRC nao encontrado"; exit 1; }

DEST=""
for cand in "$HOME/ponte-agent" "$HOME/Downloads/ponte-agent" "$HOME/Documentos/ponte-agent" "$HOME/Area de trabalho/ponte-agent" "$HOME/Desktop/ponte-agent"; do
  if [ -f "$cand/agent.js" ]; then DEST="$cand"; break; fi
done
if [ -z "$DEST" ]; then
  read -rp "Nao achei a pasta do agente. Digite o caminho dela (ex: ~/ponte-agent): " DEST
  DEST="${DEST/#\~/$HOME}"
fi
[ -f "$DEST/agent.js" ] || { echo "[x] Sem agent.js em: $DEST"; exit 1; }

cp "$DEST/agent.js" "$DEST/agent.js.bak"
cp "$SRC" "$DEST/agent.js"
echo ""
echo "[OK] Agente atualizado para v1.2.0 em: $DEST"
echo "(backup da versao antiga salvo como agent.js.bak)"
echo ""
echo "PROXIMO PASSO - reinicie o agente no modo que preferir:"
echo "  1) Ctrl+C no terminal onde o agente esta rodando"
echo "  2) escolha um dos modos:"
echo "       node \"$DEST/agent.js\"                    # arquivos apenas (padrao)"
echo "       node \"$DEST/agent.js\" --allow-run --save  # supervisionado (aperta s/N)"
echo "       node \"$DEST/agent.js\" --auto --save       # autonomo (executa direto,"
echo "                                                 #  com trava anticatastrofe)"
