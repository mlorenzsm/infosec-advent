#!/bin/sh
# Erzeugt die Screenshots für die README.
#
# Wichtig: --force-prefers-reduced-motion. Ohne das Flag schießt Chrome das
# Bild mitten in die Einblend-Animation der Detailkarte — halb transparent
# und unbrauchbar. Genau das ist einmal passiert.
#
# Aufruf:  tools/screenshots.sh

set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT=${PORT:-8099}
URL="http://127.0.0.1:$PORT"
SERVER_PID=""

case $(uname -s) in
  Darwin) CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ;;
  *)      CHROME=${CHROME:-$(command -v chromium || command -v google-chrome)} ;;
esac

if [ ! -x "$CHROME" ] && ! command -v "$CHROME" >/dev/null 2>&1; then
  echo "Kein Chrome/Chromium gefunden. CHROME=/pfad/zum/browser $0" >&2
  exit 1
fi

cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; }
trap cleanup EXIT INT TERM

if ! curl -sf -o /dev/null --max-time 1 "$URL/"; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR" >/dev/null 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 50); do
    curl -sf -o /dev/null --max-time 1 "$URL/" && break
    sleep 0.1
  done
fi

shoot() {  # shoot <datei> <query>
  # Eigene Profile je Aufnahme: Chrome schickt einen zweiten Start mit
  # demselben --user-data-dir sonst in die laufende Instanz und schreibt
  # kein Bild.
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-prefers-reduced-motion \
    --user-data-dir="/tmp/infosec-shot-$(basename "$1" .png)" \
    --window-size=1280,800 --virtual-time-budget=5000 \
    --screenshot="$DIR/docs/$1" "$URL/$2" >/dev/null 2>&1
  echo "  docs/$1"
}

echo "Screenshots nach docs/:"
shoot board.png "?datum=2026-12-20&auto=aus"
shoot quiz.png "?tur=2&datum=2026-12-09"
shoot finale.png "?tur=24&datum=2026-12-24"
echo "Fertig. Prüfen: keine halb transparenten Karten (das wäre eine Animation im Bild)."
