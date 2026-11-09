#!/bin/zsh
cd "${0:A:h}"
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
chimera_url='http://127.0.0.1:5431/BongoChimera/'

if /usr/sbin/lsof -nP -iTCP:5431 -sTCP:LISTEN >/dev/null; then
  if /usr/bin/curl -fsS "$chimera_url" | /usr/bin/grep -q '<title>Bongo Chimera</title>'; then
    /usr/bin/open "$chimera_url"
    exit 0
  fi
  echo 'Port 5431 is in use. Free the port before launching Bongo Chimera.'
  exit 1
fi

bun run dev &
chimera_server=$!
trap 'kill "$chimera_server" 2>/dev/null' EXIT
for ((chimera_try=1; chimera_try<=120; chimera_try++)); do
  if /usr/bin/curl -fsS "$chimera_url" >/dev/null 2>&1; then
    /usr/bin/open "$chimera_url"
    wait "$chimera_server"
    exit $?
  fi
  kill -0 "$chimera_server" 2>/dev/null || { wait "$chimera_server"; exit $?; }
  sleep 1
done
echo 'Bongo Chimera took too long to start.'
exit 1
