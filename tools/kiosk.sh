#!/bin/sh
# Kiosk-Start für den Sicherheitskalender auf dem Kundenstopper (Linux Mint).
#
# Startet einen lokalen Webserver für den Ordner (nötig, weil der Browser
# fetch() auf file:// blockiert), schaltet Bildschirmschoner und DPMS ab und
# öffnet die Seite im Vollbild. Stürzt der Browser ab, wird er neu gestartet.
#
# Von Hand:    tools/kiosk.sh
# Probelauf:   tools/kiosk.sh --dry-run      (zeigt nur, was gestartet würde)
# Testen:      tools/kiosk.sh --test [YYYY-MM-DD]
#              (normales Fenster mit Adresszeile, Automatik aus, optional mit
#               einem Datum — zum Durchklicken aller Türchen auf dem Gerät)
# Automatisch: siehe deploy/adventkalender.desktop und README, Abschnitt Kiosk.

set -u

DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT=${PORT:-8099}
URL="http://127.0.0.1:$PORT/"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/adventkalender"
SERVER_PID=""
DRY_RUN=0
TEST_DATE=""
TEST_MODE=0
for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=1 ;;
    --test)    TEST_MODE=1 ;;
    --test=*)  TEST_MODE=1; TEST_DATE=${arg#--test=} ;;
    *)         # --test 2026-12-07
               [ "$TEST_MODE" = 1 ] && TEST_DATE=$arg ;;
  esac
done
if [ -n "$TEST_DATE" ] && ! printf '%s' "$TEST_DATE" | grep -Eq '^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$'; then
  echo "Datum bitte als JJJJ-MM-TT angeben, z. B. --test 2026-12-07" >&2
  exit 2
fi

# --- 1. Browser finden -----------------------------------------------------
# Reihenfolge: ausdrücklich gesetzt (BROWSER=…), dann Chromium-Familie
# (kiosk-tauglich), dann Firefox. Auf Mint kommt Chromium als Snap oder
# Flatpak, nicht als /usr/bin-Eintrag — deshalb die zusätzlichen Pfade.
# macOS-Bundles, damit derselbe Ordner auch auf einem Laptop zum Testen läuft.

BROWSER_BIN=""
BROWSER_FAMILY=""

probe() {  # probe <pfad-oder-name> <familie>
  [ -n "$BROWSER_FAMILY" ] && return 0
  if [ -x "$1" ] || command -v "$1" >/dev/null 2>&1; then
    BROWSER_BIN=$1
    BROWSER_FAMILY=$2
  fi
}

probe_named() {  # probe_named <name> <familie>
  for dir in /usr/bin /usr/local/bin /snap/bin /var/lib/flatpak/exports/bin \
             "$HOME/.local/share/flatpak/exports/bin"; do
    probe "$dir/$1" "$2"
  done
  probe "$1" "$2"
}

if [ -n "${BROWSER:-}" ]; then
  # Familie am Namen ablesen, nicht raten: BROWSER=…/firefox braucht
  # -kiosk statt --kiosk.
  case $(basename "$BROWSER") in
    *[Ff]irefox*) probe "$BROWSER" firefox ;;
    *)            probe "$BROWSER" chromium ;;
  esac
fi

# Chromium-Familie
probe_named chromium chromium
probe_named chromium-browser chromium
probe_named google-chrome chromium
probe_named google-chrome-stable chromium
probe_named brave-browser chromium
probe_named microsoft-edge chromium
probe_named vivaldi chromium
probe "/var/lib/flatpak/exports/bin/org.chromium.Chromium" chromium
probe "$HOME/.local/share/flatpak/exports/bin/org.chromium.Chromium" chromium
probe "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" chromium
probe "/Applications/Chromium.app/Contents/MacOS/Chromium" chromium
probe "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" chromium
probe "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" chromium

# Firefox (Mint-Standard, falls kein Chromium installiert ist)
probe_named firefox firefox
probe_named firefox-esr firefox
probe "/Applications/Firefox.app/Contents/MacOS/firefox" firefox

if [ -z "$BROWSER_FAMILY" ]; then
  cat >&2 <<'MSG'
Kein Browser gefunden. Gesucht wurde nach:
  Chromium: chromium, chromium-browser, google-chrome, brave-browser,
            microsoft-edge, vivaldi (PATH, Snap, Flatpak, /Applications)
  Firefox:  firefox, firefox-esr

Installieren:
  sudo apt install chromium        # Linux Mint
  brew install --cask chromium     # macOS

Oder einen vorhandenen Browser direkt angeben:
  BROWSER=/pfad/zum/browser tools/kiosk.sh
MSG
  exit 1
fi

# --- 2. Flags je Browserfamilie --------------------------------------------
if [ "$TEST_MODE" = 1 ]; then
  QUERY="?auto=aus"
  [ -n "$TEST_DATE" ] && QUERY="$QUERY&datum=$TEST_DATE"
  URL="$URL$QUERY"
fi

if [ "$BROWSER_FAMILY" = "firefox" ]; then
  PROFILE="$CACHE/firefox-profile"
  if [ "$DRY_RUN" = 0 ]; then
    mkdir -p "$PROFILE"
    # Ein frisches Profil zeigt sonst Willkommensseite und Datenschutz-Dialog.
    cat > "$PROFILE/user.js" <<'PREFS'
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.enabled", false);
user_pref("app.update.auto", false);
user_pref("app.update.enabled", false);
PREFS
  fi
  if [ "$TEST_MODE" = 1 ]; then
    FLAGS="-no-remote -profile $PROFILE -new-window"
  else
    FLAGS="-kiosk -no-remote -profile $PROFILE"
  fi
else
  # Eigenes Profil: verhindert „Browser wurde nicht richtig beendet"-Dialoge
  # und Profil-Auswahl, wenn der Kiosk nach einem Absturz neu startet.
  if [ "$TEST_MODE" = 1 ]; then
    # Normales Fenster: Adresszeile sichtbar, damit man Parameter ausprobieren
    # kann. Kiosk-Dialoge bleiben trotzdem abgeschaltet.
    FLAGS="--user-data-dir=$CACHE/chromium-profile
--no-first-run --no-default-browser-check --disable-infobars
--disable-session-crashed-bubble --disable-features=Translate
--password-store=basic --check-for-update-interval=31536000"
  else
    FLAGS="--kiosk --user-data-dir=$CACHE/chromium-profile
--no-first-run --no-default-browser-check --disable-infobars
--disable-session-crashed-bubble --disable-features=Translate
--password-store=basic --check-for-update-interval=31536000"
  fi
fi

if [ "$DRY_RUN" = 1 ]; then
  echo "Browser:  $BROWSER_BIN"
  echo "Familie:  $BROWSER_FAMILY"
  echo "Modus:    $([ "$TEST_MODE" = 1 ] && echo Test || echo Kiosk)"
  echo "Flags:    $(echo $FLAGS)"
  echo "URL:      $URL"
  echo "Daten:    $CACHE"
  exit 0
fi

# --- 3. Server -------------------------------------------------------------
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
  # Nur die eigene Sperre entfernen — ein zweiter Start darf dem laufenden
  # Kiosk nicht die Sperre unter den Füßen wegziehen.
  [ "${LOCK_OWNED:-0}" = 1 ] && rm -rf "$LOCKDIR"
  exit 0
}
# Auch auf SIGTERM von außen (Logout, systemctl) sauber aufräumen.
trap cleanup EXIT INT TERM HUP

# --- 4. Bildschirm anlassen ------------------------------------------------
# Cinnamon schaltet nach ein paar Minuten in den Ruhezustand. xset wirkt nur
# in der laufenden X-Sitzung; die dauerhafte Einstellung steht in der README.
# Im Testmodus nicht — ein kurzer Blick soll die Einstellungen nicht ändern.
if [ "$TEST_MODE" = 0 ]; then
  xset s off 2>/dev/null
  xset -dpms 2>/dev/null
  if command -v unclutter >/dev/null 2>&1; then
    unclutter -idle 1 -root &
    UNC_PID=$!
  fi
fi

# --- 5. Browser ------------------------------------------------------------
# Testmodus: ein Fenster, kein Lock, kein Neustart — schließen beendet alles.
if [ "$TEST_MODE" = 1 ]; then
  echo "Testmodus: $URL"
  echo "Türchen anklicken; schließen des Fensters beendet den Test."
  # shellcheck disable=SC2086
  "$BROWSER_BIN" $FLAGS "$URL"
  exit 0
fi

# Nur ein Kiosk gleichzeitig: Ein zweiter Start würde den Browser nur als
# weiteren Tab in den laufenden schicken und hier in einer Startschleife enden.
LOCKDIR="${XDG_RUNTIME_DIR:-/tmp}/adventkalender-kiosk-$(id -u)"
LOCK_OWNED=0
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  OTHER=$(cat "$LOCKDIR/pid" 2>/dev/null || echo "")
  if [ -n "$OTHER" ] && kill -0 "$OTHER" 2>/dev/null; then
    echo "Der Kiosk läuft bereits (PID $OTHER)." >&2
    LOCKDIR=""          # fremde Sperre: beim Beenden nicht anfassen
    exit 0
  fi
  rm -rf "$LOCKDIR"     # verwaiste Sperre eines abgestürzten Laufs
  mkdir "$LOCKDIR" 2>/dev/null || exit 1
fi
LOCK_OWNED=1
echo $$ > "$LOCKDIR/pid"

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
