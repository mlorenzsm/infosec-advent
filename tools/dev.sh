# Server starten (Python, keine Abhängigkeiten)
python3 -m http.server 8099

# Inhalte prüfen
python3 tools/check_content.py

# Browsertests (Server muss laufen)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --virtual-time-budget=20000 --dump-dom \
  http://localhost:8099/_selftest.html | sed -n '/<pre id="out"/,/<\/pre>/p'

# Screenshots für die README
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --hide-scrollbars --force-prefers-reduced-motion \
  --window-size=1280,800 --virtual-time-budget=4000 \
  --screenshot=docs/board.png "http://localhost:8099/index.html?datum=2026-12-09&auto=aus"
