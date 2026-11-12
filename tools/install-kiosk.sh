#!/bin/sh
# Richtet den Autostart auf dem Kundenstopper ein (Linux Mint, Cinnamon).
#
#   tools/install-kiosk.sh            # installieren
#   tools/install-kiosk.sh --remove   # wieder entfernen
#
# Legt ~/.config/autostart/infosec-advent.desktop an und schaltet in Cinnamon
# Bildschirmschoner und Ruhezustand ab, damit das Display dauerhaft anbleibt.

set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TARGET="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/infosec-advent.desktop"

if [ "${1:-}" = "--remove" ]; then
  rm -f "$TARGET"
  echo "Autostart entfernt: $TARGET"
  exit 0
fi

chmod +x "$DIR/tools/kiosk.sh"
mkdir -p "$(dirname "$TARGET")"

# Welcher Browser würde starten? Besser jetzt erfahren als am 1. Dezember,
# wenn der Bildschirm mit dem Desktop statt dem Kalender dasteht.
if ! "$DIR/tools/kiosk.sh" --dry-run >/dev/null 2>&1; then
  echo "Kein Browser gefunden — Autostart wird nicht eingerichtet." >&2
  "$DIR/tools/kiosk.sh" --dry-run >&2 || true
  exit 1
fi
"$DIR/tools/kiosk.sh" --dry-run | sed -n '1,2p'
sed "s|__REPO__|$DIR|g" "$DIR/deploy/infosec-advent.desktop" > "$TARGET"
echo "Autostart eingerichtet: $TARGET"
echo "Nächster Login startet den Kalender im Vollbild."

# --- Cinnamon: Bildschirmschoner, Ruhezustand, automatische Sperre aus -----
if command -v gsettings >/dev/null 2>&1; then
  gsettings set org.cinnamon.desktop.screensaver idle-activation-enabled false 2>/dev/null || true
  gsettings set org.cinnamon.desktop.screensaver lock-enabled false 2>/dev/null || true
  gsettings set org.cinnamon.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing' 2>/dev/null || true
  gsettings set org.cinnamon.settings-daemon.plugins.power sleep-inactive-battery-type 'nothing' 2>/dev/null || true
  gsettings set org.cinnamon.settings-daemon.plugins.power idle-dim false 2>/dev/null || true
  echo "Cinnamon: Bildschirmschoner und Standby abgeschaltet."
fi

# --- Optional: Mauszeiger nach kurzer Ruhe ausblenden ----------------------
if ! command -v unclutter >/dev/null 2>&1; then
  echo "Tipp: sudo apt install unclutter  — blendet den Mauszeiger aus."
fi
