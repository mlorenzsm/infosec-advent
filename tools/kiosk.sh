#!/bin/sh
# Kiosk-Start für den Sicherheitskalender auf dem Kundenstopper (Linux Mint).
#
# Startet einen lokalen Webserver für den Ordner (nötig, weil der Browser
# fetch() auf file:// blockiert), schaltet Bildschirmschoner und DPMS ab und
# öffnet die Seite im Vollbild. Stürzt der Browser ab, wird er neu gestartet.
#
# Von Hand:   tools/kiosk.sh
# Automatisch: siehe deploy/adventkalender.desktop und README, Abschnitt Kiosk.

set -u

DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT=${PORT:-8099}
URL="http://127.0.0.1:$PORT/"
SERVER_PID=""

# --- 1. Server -------------------------------------------------------------
# Läuft schon einer (z. B. nach einem Browser-Neustart), wird er mitbenutzt.
if ! curl -sf -o /dev/null --max-time 1 "$URL"; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR" \
    >/dev/null 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 50); do
    curl -sf -o /dev/null --max-time 1 "$URL" && break
    sleep 0.1
  done
fi

cleanup() {
  [ -n "${BROWSER_PID:-}" ] && kill "$BROWSER_PID" 2>/dev/null
  [ -n "${UNC_PID:-}" ] && kill "$UNC_PID" 2>/dev/null
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  exit 0
}
# Auch auf SIGTERM von außen (Logout, systemctl) sauber aufräumen.
trap cleanup EXIT INT TERM HUP

# --- 2. Bildschirm anlassen ------------------------------------------------
# Cinnamon schaltet nach ein paar Minuten in den Ruhezustand. xset wirkt nur
# in der laufenden X-Sitzung; die dauerhafte Einstellung steht in der README.
xset s off 2>/dev/null
xset -dpms 2>/dev/null
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 1 -root &
  UNC_PID=$!
fi

# --- 3. Browser im Kiosk ---------------------------------------------------
find_browser() {
  for candidate in chromium chromium-browser google-chrome brave-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

BROWSER_BIN=${BROWSER:-$(find_browser || true)}
if [ -z "$BROWSER_BIN" ]; then
  echo "Kein Chromium gefunden. Installieren mit: sudo apt install chromium" >&2
  exit 1
fi

FLAGS="--kiosk --no-first-run --no-default-browser-check --disable-infobars
--disable-session-crashed-bubble --disable-features=Translate
--password-store=basic --check-for-update-interval=31536000 --start-fullscreen"

# Endlosschleife: Ein Kiosk, der nach einem Absturz schwarz bleibt, ist kaputt.
# Der Browser läuft im Hintergrund und wird mit `wait` abgewartet — so greift
# das TERM-Trap sofort, statt erst wenn der Browser von selbst endet.
while :; do
  # shellcheck disable=SC2086
  "$BROWSER_BIN" $FLAGS "$URL" &
  BROWSER_PID=$!
  wait "$BROWSER_PID"
  BROWSER_PID=""
  sleep 2
done
