#!/usr/bin/env bash
# Ponte Local — inicia o agente
# Primeira vez: ./rodar.sh https://SEU-LINK-DE-PREVIEW SEU_TOKEN
# Depois:       ./rodar.sh
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[x] Node.js não encontrado. Instale com: sudo pacman -S --needed nodejs"
  exit 1
fi

if [ -f ponte.config.json ]; then
  exec node agent.js
elif [ $# -ge 2 ]; then
  exec node agent.js --server "$1" --token "$2" --save
else
  echo "Uso: ./rodar.sh https://SEU-LINK-DE-PREVIEW SEU_TOKEN"
  echo "(o link de preview e o token estão no chat)"
  exit 1
fi
