#!/usr/bin/env python3
"""Prüft content/advent.json: 24 Türchen, vollständige Felder, gültige Quizze.

Aufruf:  python3 tools/check_content.py
Exit 1 bei Fehlern — gedacht für ein Git-Hook oder die CI.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "content" / "advent.json"

REQUIRED = ("day", "kind", "motto", "title", "lead")
KINDS = {"tipp", "quiz", "challenge"}
# Lesbarkeit auf 3 m: eine Tür sollte in ~20 Sekunden erfassbar sein.
MAX_LEAD = 220
MAX_BODY = 420


def check() -> list[str]:
    errors: list[str] = []
    try:
        data = json.loads(DATA.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"{DATA}: {exc}"]

    if not isinstance(data.get("year"), int):
        errors.append("year fehlt oder ist keine Zahl")
    # Eine Überschrift, keine Kicker/Subline: Auf drei Metern zählt nur sie.
    if not data.get("title"):
        errors.append("title fehlt")
    for stale in ("kicker", "subtitle"):
        if stale in data:
            errors.append(f"{stale} wird nicht mehr angezeigt — entfernen")

    doors = data.get("doors")
    if not isinstance(doors, list):
        return errors + ["doors fehlt oder ist keine Liste"]

    days = [d.get("day") for d in doors if isinstance(d, dict)]
    if days != list(range(1, 25)):
        errors.append(f"Türchen müssen 1..24 lückenlos und sortiert sein, gefunden: {days}")

    for door in doors:
        if not isinstance(door, dict):
            errors.append(f"Türchen ist kein Objekt: {door!r}")
            continue
        day = door.get("day", "?")
        for key in REQUIRED:
            if not door.get(key):
                errors.append(f"Tag {day}: Feld '{key}' fehlt")
        kind = door.get("kind")
        if kind not in KINDS:
            errors.append(f"Tag {day}: unbekannte Art {kind!r} (erlaubt: {sorted(KINDS)})")
            continue

        if len(door.get("lead", "")) > MAX_LEAD:
            errors.append(f"Tag {day}: lead ist {len(door['lead'])} Zeichen (max {MAX_LEAD})")
        if len(door.get("body", "")) > MAX_BODY:
            errors.append(f"Tag {day}: body ist {len(door['body'])} Zeichen (max {MAX_BODY})")

        if kind == "quiz":
            options = door.get("options")
            if not isinstance(options, list) or len(options) < 2:
                errors.append(f"Tag {day}: Quiz braucht mindestens zwei Antworten")
            correct = door.get("correct")
            if not isinstance(correct, int) or not (0 <= correct < len(options or [])):
                errors.append(f"Tag {day}: correct zeigt auf keine Antwort ({correct!r})")
            if not door.get("explanation"):
                errors.append(f"Tag {day}: Quiz braucht eine Erklärung")
            if not door.get("question"):
                errors.append(f"Tag {day}: Quiz braucht eine Frage")

        if kind == "challenge":
            steps = door.get("steps")
            if not isinstance(steps, list) or len(steps) < 2:
                errors.append(f"Tag {day}: Challenge braucht mindestens zwei Schritte")

    return errors


def main() -> int:
    errors = check()
    if errors:
        for err in errors:
            print(f"✗ {err}")
        return 1
    print("✓ content/advent.json: 24 Türchen, alle Felder vollständig.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
