#!/usr/bin/env bash
# Teste v1.1 da Ponte — novas ações (tree, disk_usage, duplicates, read/write_binary, run_command)
set -e
AGENT_TOKEN="${PONTE_TEST_TOKEN:?export PONTE_TEST_TOKEN antes (canal test)}"
ADMIN_TOKEN="${PONTE_ADMIN_TOKEN:?export PONTE_ADMIN_TOKEN antes (o mesmo do relay)}"
BASE="http://127.0.0.1:3000"
AGENT_DIR="/home/z/my-project/download/ponte-agent"
TEST_HOME="/home/z/ponte-teste-home2"
py() { PONTE_CHANNEL=test python3 /home/z/my-project/scripts/ponte.py "$@"; }

echo "=== 1. Home falsa v2 ==="
rm -rf "$TEST_HOME" /home/z/my-project/scripts/.ponte_since_test
mkdir -p "$TEST_HOME/Downloads" "$TEST_HOME/Fotos"
echo "relatorio" > "$TEST_HOME/Downloads/doc.pdf"
head -c 30000 /dev/urandom > "$TEST_HOME/Downloads/foto.jpg"
cp "$TEST_HOME/Downloads/foto.jpg" "$TEST_HOME/Fotos/foto-copia.jpg"   # duplicado!
cp "$TEST_HOME/Downloads/foto.jpg" "$TEST_HOME/Fotos/foto-copia2.jpg"  # outro duplicado
echo "unico" > "$TEST_HOME/Downloads/grande.zip"
head -c 200000 /dev/urandom > "$TEST_HOME/Downloads/grande.zip"
ls -R "$TEST_HOME" | head -20

echo "=== 2. Agente v1.1 SEM --allow-run (modo arquivos) ==="
pkill -f "node agent.js" 2>/dev/null || true
cd "$AGENT_DIR"
nohup node agent.js --server "$BASE" --token "$AGENT_TOKEN" --home "$TEST_HOME" > /tmp/agent-v11.log 2>&1 &
sleep 3
tail -3 /tmp/agent-v11.log

echo "=== 3. ping (deve mostrar run_command DESLIGADO) ==="
py ping | head -8

echo "=== 4. tree ==="
py tree '{"path":"'"$TEST_HOME"'","depth":2}' | head -40

echo "=== 5. disk_usage ==="
py disk_usage '{"path":"'"$TEST_HOME"'"}' | head -20

echo "=== 6. duplicates (deve achar 3 cópias da foto) ==="
py duplicates '{"path":"'"$TEST_HOME"'","minSizeBytes":1000}' | head -30

echo "=== 7. read_binary (baixa a foto pra VM e confere hash) ==="
py pegar "$TEST_HOME/Downloads/foto.jpg" /tmp/foto-baixada.jpg
md5sum "$TEST_HOME/Downloads/foto.jpg" /tmp/foto-baixada.jpg

echo "=== 8. write_binary (envia arquivo da VM pro 'PC') ==="
head -c 5000 /dev/urandom > /tmp/enviado.bin
py enviar /tmp/enviado.bin "$TEST_HOME/recebido.bin"
md5sum /tmp/enviado.bin "$TEST_HOME/recebido.bin"

echo "=== 9. run_command SEM flag (deve FALHAR rápido) ==="
py run_command '{"command":"echo teste"}' | head -5

pkill -f "node agent.js" 2>/dev/null || true
sleep 1

echo "=== 10. agente COM --allow-run + aprovação via pipe 'n' (rejeita) ==="
echo "n" | timeout 30 node "$AGENT_DIR/agent.js" --server "$BASE" --allow-run --token "$AGENT_TOKEN" --home "$TEST_HOME" > /tmp/agent-run-n.log 2>&1 &
sleep 2
py run_command '{"command":"touch /tmp/NAO-DEVERIA-EXISTIR"}' | head -5
sleep 1
ls /tmp/NAO-DEVERIA-EXISTIR 2>/dev/null && echo "FALHA: arquivo criado!" || echo "OK: nada foi executado"

echo "=== 11. agente COM --allow-run + aprovação 's' (executa) ==="
echo "s" | timeout 30 node "$AGENT_DIR/agent.js" --server "$BASE" --allow-run --token "$AGENT_TOKEN" --home "$TEST_HOME" > /tmp/agent-run-s.log 2>&1 &
sleep 2
py run_command '{"command":"echo ponte-ok && pwd && whoami"}' | head -16
sleep 1
grep -A2 "PEDIDO DE COMANDO" /tmp/agent-run-s.log | head -8 || true

pkill -f "node agent.js" 2>/dev/null || true
echo "=== FIM TESTES v1.1 ==="
