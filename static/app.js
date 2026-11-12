/* 24 Tage Informationssicherheit — Ablauf für das Display.
 *
 * Drei Zustände pro Türchen, berechnet aus dem Datum:
 *   vergangen  → offen, antippbar, rotiert im Automatik-Modus
 *   heute      → offen, hervorgehoben, wird zuerst gezeigt
 *   Zukunft    → geschlossen, antippen zeigt nur den Hinweis wann es öffnet
 *
 * Automatik-Modus: ohne Berührung öffnet sich alle ~35 s das nächste offene
 * Türchen (30 s Anzeige + 5 s Pause). Wer den Bildschirm anfasst, pausiert die
 * Rotation für fünf Minuten — sonst würde der Kalender beim Lesen weglaufen.
 *
 * Testen ohne Datumsreise:  ?datum=2026-12-07   (jedes Türchen bis 7 offen)
 *                           ?auto=aus           (keine Rotation)
 *                           ?tur=24             (ein bestimmtes Türchen zeigen)
 */
"use strict";

const AUTO_FIRST_DELAY = 4000;       // ms bis zum ersten automatischen Türchen
const AUTO_DWELL = 30000;            // ms, die ein Türchen offen bleibt
const AUTO_GAP = 5000;               // ms Pause zwischen zwei Türchen
const PAUSE_AFTER_TOUCH = 5 * 60000; // ms Ruhe nach einer Berührung

const params = new URLSearchParams(location.search);
const autoEnabled = params.get("auto") !== "aus";

const state = {
  data: null,
  openDay: 0,        // höchstes offenes Türchen (0 = noch keins)
  todayDay: 0,       // nur im Dezember gesetzt
  seen: new Set(),   // bereits gelesene Türchen (localStorage)
  autoPausedUntil: 0,
  nextAt: 0,
  current: null,     // gerade offenes Türchen im Overlay
  autoOpened: false,
  overlayOpenedAt: 0,
  rotationIndex: 0,
};

const $ = (id) => document.getElementById(id);
const board = $("board");
const detail = $("detail");
const detailCard = $("detail-card");
const toast = $("toast");

const KIND_LABEL = {
  tipp: "Tipp",
  quiz: "Quiz",
  challenge: "Challenge",
};

const fmtDate = new Intl.DateTimeFormat("de-DE", {
  weekday: "long", day: "numeric", month: "long",
});
const fmtShort = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long" });

/* --- Datum ------------------------------------------------------------- */

function nowDate() {
  const raw = params.get("datum");
  if (raw) {
    const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9, 0, 0);
  }
  return new Date();
}

function adventTarget(year) {
  return new Date(year, 11, 1, 0, 0, 0);
}

/* Bis zum 24.12. offen, danach (und im Januar) alle offen. Vor dem 1.12.:
 * nichts offen — der Kalender soll nicht schon im November alles verraten. */
function computeOpenDay(now, year) {
  const month = now.getMonth(); // 0-basiert
  const day = now.getDate();
  const y = now.getFullYear();
  if (y < year) return 0;                  // vor dem Kalenderjahr
  if (y > year) return 24;                 // nach dem Kalenderjahr
  if (month === 11 && day >= 1) return Math.min(day, 24);
  if (month === 0) return 24;              // Januar: Rückblick
  return 0;                                // Februar bis November: zu
}

function computeTodayDay(now) {
  return now.getMonth() === 11 && now.getDate() >= 1 && now.getDate() <= 24
    ? now.getDate()
    : 0;
}

/* --- Aufbau ------------------------------------------------------------ */

async function load() {
  const res = await fetch("content/advent.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Inhalt nicht geladen: " + res.status);
  return res.json();
}

function readSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem("advent.seen") || "[]"));
  } catch {
    return new Set();
  }
}

function markSeen(day) {
  state.seen.add(day);
  try {
    localStorage.setItem("advent.seen", JSON.stringify([...state.seen]));
  } catch {
    /* Kiosk ohne Speicher: dann gibt es eben keine Erinnerung. */
  }
}

function renderMasthead(data) {
  const title = data.title || "24 Tage Informationssicherheit";
  $("title").textContent = title;
  document.title = title;
}

/* Positionen der Hütten im Raster.
 *
 * Wie ein echter Wandkalender: Die Türchen stehen verstreut, nicht in
 * 1–24-Reihenfolge. Der Inhalt bleibt bei seiner Zahl (Tür 2 bleibt das
 * Quiz, Tür 24 das Finale) — nur der Platz im Raster wechselt.
 *
 * Die Mischung ist deterministisch: gleicher Seed → gleiche Anordnung, also
 * bei jedem Neuladen und auf jedem Gerät identisch. Der Seed enthält das
 * Jahr, damit es nächstes Jahr ein neues Dorf gibt. ?geordnet=1 schaltet
 * die Reihenfolge ab, ?seed=… erzwingt eine andere Anordnung. */

function shuffledPositions() {
  const days = Array.from({ length: 24 }, (_, i) => i + 1);
  if (params.get("geordnet")) return days;

  let seed = Number(params.get("seed")) || state.data.year || 2026;
  // mulberry32: klein, schnell, für 24 Elemente mehr als genug.
  const rand = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Fisher-Yates
  for (let i = days.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [days[i], days[j]] = [days[j], days[i]];
  }
  return days;
}

function renderBoard() {
  board.innerHTML = "";
  const byDay = new Map(state.data.doors.map((d) => [d.day, d]));

  // Reihenfolge der Rasterzellen; die Zelle trägt die Tageszahl.
  for (const day of shuffledPositions()) {
    const item = byDay.get(day);
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "door";
    btn.dataset.day = String(day);
    btn.setAttribute("aria-label", `Türchen ${day}`);

    const open = day <= state.openDay;
    const isToday = day === state.todayDay;

    if (open) {
      btn.classList.add("is-open");
      if (!state.seen.has(day)) btn.classList.add("is-new");
    } else {
      // Bewusst nicht `disabled`: Eine geschlossene Tür soll antworten
      // („öffnet am 24. Dezember"), nicht stumm bleiben.
      btn.classList.add("is-future");
      btn.setAttribute("aria-disabled", "true");
    }
    if (isToday) btn.classList.add("is-today");

    // Eine kleine Holzhütte: Dach mit Schnee, Holzwand, Fenster mit der Zahl.
    const hut = document.createElement("span");
    hut.className = "hut";
    // Drei Dachhöhen im Wechsel, deterministisch aus dem Tag: Das Dorf wirkt
    // gewachsen statt gestempelt, bleibt aber bei jedem Laden gleich.
    hut.dataset.roof = String((day % 3) + 1);

    const roof = document.createElement("span");
    roof.className = "hut-roof";

    const body = document.createElement("span");
    body.className = "hut-body";

    const window_ = document.createElement("span");
    window_.className = "hut-window";

    const num = document.createElement("span");
    num.className = "door-day";
    num.textContent = String(day);

    window_.appendChild(num);
    body.appendChild(window_);
    hut.append(roof, body);

    if (day === 24) {
      // Schild über dem Dach: markiert den Heiligabend-Hütte im Dorf.
      const sign = document.createElement("span");
      sign.className = "hut-sign";
      sign.setAttribute("aria-hidden", "true");
      sign.textContent = "★";
      hut.appendChild(sign);
    }

    btn.appendChild(hut);

    btn.addEventListener("click", () => onDoorClick(day, item, open));
    li.appendChild(btn);
    board.appendChild(li);
  }
}

function updateFooter(now) {
  const year = state.data.year;
  $("date-value").textContent = capitalize(fmtDate.format(now));

  const progress = Math.round((state.openDay / 24) * 100);
  $("bar").setAttribute("aria-valuenow", String(state.openDay));
  $("bar-fill").style.width = progress + "%";

  let hint;
  if (params.get("alle") && !state.todayDay) {
    hint = "Testmodus: alle 24 Türchen offen.";
  } else if (state.openDay === 0) {
    const days = Math.ceil((adventTarget(year) - now) / 86400000);
    hint = days > 0
      ? `Der Kalender öffnet in ${days} ${days === 1 ? "Tag" : "Tagen"} – am 1. Dezember.`
      : "Der Kalender öffnet am 1. Dezember.";
  } else if (state.openDay >= 24) {
    hint = "Alle 24 Türchen sind offen. Frohe Weihnachten!";
  } else {
    const rest = 24 - state.openDay;
    hint = `${state.openDay} von 24 offen · in ${rest} ${rest === 1 ? "Tag" : "Tagen"} ist der Kalender voll.`;
  }
  $("hint").textContent = hint;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function updateClock(now) {
  $("clock-value").textContent = now.toLocaleTimeString("de-DE", {
    hour: "2-digit", minute: "2-digit",
  });
}

/* --- Türchen öffnen ---------------------------------------------------- */

function onDoorClick(day, item, open) {
  pauseAuto();
  if (!open) {
    const target = new Date(state.data.year, 11, day);
    toastText(`Türchen ${day} öffnet am ${fmtShort.format(target)}.`);
    return;
  }
  openDoor(day, { auto: false });
}

/* Das Gelesen-Kennzeichen ist nur für den Automatik-Modus interessant:
 * Wer ein Türchen von Hand öffnet, will es lesen, nicht "abgehakt" haben. */

function openDoor(day, { auto }) {
  const item = state.data.doors.find((d) => d.day === day);
  if (!item) return;
  state.current = day;
  state.autoOpened = auto;
  state.overlayOpenedAt = Date.now();
  if (auto) markSeen(day);

  detailCard.innerHTML = "";
  detailCard.appendChild(buildDetail(item));
  detail.hidden = false;
  detailCard.scrollTop = 0;

  // Tür im Raster als „gelesen“ markieren, ohne neu zu rendern
  const btn = board.querySelector(`.door[data-day="${day}"]`);
  if (btn) btn.classList.remove("is-new");
}

function closeDetail() {
  if (detail.hidden) return;
  detail.hidden = true;
  state.current = null;
  if (autoEnabled) state.nextAt = Date.now() + AUTO_GAP;
}

function pauseAuto() {
  state.autoPausedUntil = Date.now() + PAUSE_AFTER_TOUCH;
  state.nextAt = 0;
}

/* --- Detailkarte ------------------------------------------------------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buildDetail(item) {
  const card = document.createDocumentFragment();

  const left = el("div", "detail-left");
  const eyebrow = el("div", "detail-eyebrow");
  eyebrow.appendChild(el("span", "detail-num", String(item.day)));
  eyebrow.appendChild(el("span", null, KIND_LABEL[item.kind] || "Türchen"));
  left.appendChild(eyebrow);
  left.appendChild(el("p", "detail-motto", item.motto || ""));
  left.appendChild(el("h2", "detail-title", item.title || ""));
  left.appendChild(el("p", "detail-lead", item.lead || ""));

  const right = el("div", "detail-right");
  if (item.kind === "quiz") right.appendChild(buildQuiz(item));
  else if (item.kind === "challenge") right.appendChild(buildChallenge(item));
  else if (item.body) right.appendChild(el("p", "detail-body", item.body));

  if (item.action) right.appendChild(buildAction(item.action));
  if (item.closing) right.appendChild(el("p", "detail-lead", item.closing));

  const foot = el("div", "detail-foot");
  const nav = el("div", "detail-nav");
  const prev = el("button", null, "‹ Zurück");
  const next = el("button", null, "Weiter ›");
  prev.type = next.type = "button";
  const open = openDoors();
  const idx = open.indexOf(item.day);
  prev.disabled = idx <= 0;
  next.disabled = idx < 0 || idx >= open.length - 1;
  prev.addEventListener("click", () => {
    pauseAuto();
    openDoor(open[idx - 1], { auto: false });
  });
  next.addEventListener("click", () => {
    pauseAuto();
    openDoor(open[idx + 1], { auto: false });
  });
  nav.append(prev, next);

  const hasNext = idx >= 0 && idx < open.length - 1;
  const close = el("button", "detail-close", hasNext ? "Weiter  →" : "Schließen");
  close.type = "button";
  close.addEventListener("click", () => {
    if (hasNext) {
      pauseAuto();
      openDoor(open[idx + 1], { auto: false });
    } else {
      closeDetail();
    }
  });

  foot.append(nav, close);
  right.appendChild(foot);

  card.append(left, right);
  return card;
}

function buildAction(text) {
  const box = el("div", "detail-action");
  const inner = el("div");
  inner.appendChild(el("strong", null, "Mach das"));
  inner.appendChild(el("span", null, text));
  box.appendChild(inner);
  return box;
}

function buildChallenge(item) {
  const wrap = el("div", "steps-wrap");
  const steps = el("ol", "steps");
  (item.steps || []).forEach((s) => steps.appendChild(el("li", null, s)));
  wrap.appendChild(steps);
  return wrap;
}

function buildQuiz(item) {
  const wrap = el("div", "quiz");
  wrap.appendChild(el("p", "quiz-q", item.question || ""));

  const options = el("div", "quiz-options");
  const result = el("div", "quiz-result");
  let answered = false;

  (item.options || []).forEach((text, i) => {
    const btn = el("button", "quiz-option");
    btn.type = "button";
    const mark = el("span", "quiz-mark", String.fromCharCode(65 + i));
    btn.append(mark, el("span", null, text));

    btn.addEventListener("click", () => {
      if (answered) return;
      answered = true;
      // Die Auflösung ist der interessante Moment — Automatik anhalten.
      state.autoPausedUntil = Date.now() + PAUSE_AFTER_TOUCH;
      state.overlayOpenedAt = Date.now();
      const correct = i === item.correct;

      options.querySelectorAll(".quiz-option").forEach((b, bi) => {
        b.disabled = true;
        if (bi === item.correct) {
          b.classList.add("is-right");
          b.querySelector(".quiz-mark").textContent = "✓";
        }
      });
      if (!correct) {
        btn.classList.add("is-wrong");
        btn.querySelector(".quiz-mark").textContent = "✗";
      }

      const verdict = el("p", "quiz-verdict " + (correct ? "is-right" : "is-wrong"),
        correct ? "Richtig." : "Knapp daneben.");
      result.append(verdict, el("p", "quiz-explain", item.explanation || ""));
      wrap.appendChild(result);
    });

    options.appendChild(btn);
  });

  wrap.appendChild(options);
  return wrap;
}

function openDoors() {
  return state.data.doors
    .map((d) => d.day)
    .filter((d) => d <= state.openDay)
    .sort((a, b) => a - b);
}

/* --- Automatik --------------------------------------------------------- */

function rotate() {
  const open = openDoors();
  if (open.length === 0) return;
  if (state.current != null) return;

  // Reihenfolge: heute zuerst, dann alle offenen von vorn. Ungelesene
  // Türchen kommen vor gelesenen — nach einem Neustart zeigt das Display
  // also zuerst das, was noch niemand gesehen hat.
  const order = state.todayDay
    ? [state.todayDay, ...open.filter((d) => d !== state.todayDay)]
    : open;
  const unseen = order.filter((d) => !state.seen.has(d));
  const day = unseen.length ? unseen[0] : order[state.rotationIndex % order.length];
  state.rotationIndex = (state.rotationIndex + 1) % order.length;
  openDoor(day, { auto: true });
}

function tick() {
  const now = new Date();
  updateClock(now);

  // Ein Display läuft wochenlang. Nach Mitternacht muss das nächste Türchen
  // aufgehen, ohne dass jemand die Seite neu lädt. Nicht im Testmodus: sonst
  // macht der erste Tick ?alle=1 sofort wieder rückgängig.
  if (!params.get("datum") && !params.get("alle") && !params.get("liste")) {
    const openDay = computeOpenDay(now, state.data.year);
    if (openDay !== state.openDay) {
      const justOpened = openDay > state.openDay ? openDay : null;
      state.openDay = openDay;
      state.todayDay = computeTodayDay(now);
      renderBoard();
      updateFooter(now);
      if (justOpened) {
        const btn = board.querySelector(`.door[data-day="${justOpened}"]`);
        if (btn) btn.classList.add("is-new");
      }
      if (state.current != null && state.current > openDay) closeDetail();
    }
  }

  if (!autoEnabled) return;

  const t = Date.now();
  if (t < state.autoPausedUntil) return;

  if (state.current != null) {
    if (state.autoOpened && t - state.overlayOpenedAt > AUTO_DWELL) closeDetail();
    return;
  }
  if (state.nextAt === 0) state.nextAt = t + AUTO_FIRST_DELAY;
  if (t >= state.nextAt) rotate();
}

/* --- Toast ------------------------------------------------------------- */

let toastTimer = null;
function toastText(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2800);
}

/* --- Schnee (dezent, ohne Canvas-Bibliothek) --------------------------- */

function snow() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed", inset: "0", width: "100%", height: "100%",
    pointerEvents: "none", zIndex: "5", opacity: "0.5",
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let flakes = [];

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(90, Math.max(30, innerWidth / 22)));
    flakes = Array.from({ length: count }, () => ({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      r: 0.8 + Math.random() * 2.2,
      vy: 6 + Math.random() * 18,
      vx: -4 + Math.random() * 8,
      phase: Math.random() * Math.PI * 2,
    }));
  };
  resize();
  addEventListener("resize", resize);

  let last = performance.now();
  const frame = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.fillStyle = "rgba(221, 232, 226, 0.85)";
    for (const f of flakes) {
      f.phase += dt * 0.8;
      f.x += (f.vx + Math.sin(f.phase) * 6) * dt;
      f.y += f.vy * dt;
      if (f.y > innerHeight + 4) { f.y = -4; f.x = Math.random() * innerWidth; }
      if (f.x < -4) f.x = innerWidth + 4;
      if (f.x > innerWidth + 4) f.x = -4;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* --- Lichterkette ------------------------------------------------------ */
/* Zwei durchhängende Ketten über dem Dorf. Gezeichnet in echten Pixeln statt
 * mit CSS: So bleiben die Birnen rund und die Kette hängt glaubwürdig durch.
 * Gezeichnet wird nur einmal je Größe; die Birnen blinken über CSS. */

function drawGarland() {
  const host = $("garland");
  if (!host) return;
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (!width || !height) return;

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  // Echte Pixel statt einer 100er-Höhe: sonst wird der Durchhang auf die
  // flache Leiste gestaucht und die Kette wirkt schnurgerade.
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");

  const bulbSize = Math.max(6, Math.min(14, width / 85));

  // Zwei Ketten, die sich nicht kreuzen: die hintere hängt höher und
  // flacher, die vordere tiefer und stärker durch.
  // sag ist der Abstand von der Aufhängung bis zum tiefsten Punkt. Bei einer
  // quadratischen Bézier liegt die Kurve bei der halben Kontrollpunkt-Höhe,
  // deshalb wird der Kontrollpunkt doppelt so tief gesetzt.
  // Die zweite Kette hängt vollständig unter der ersten — gleiche Aufhängung
  // an den Rändern würde sie in der Mitte kreuzen und wie ein X wirken.
  const chains = [
    { from: 0.02, to: 0.98, top: height * 0.06, sag: height * 0.50, count: 10 },
    { from: 0.08, to: 0.92, top: height * 0.24, sag: height * 0.68, count: 8 },
  ];

  const bulbs = [];
  for (const c of chains) {
    const x0 = width * c.from;
    const x1 = width * c.to;
    const cx = (x0 + x1) / 2;
    const y = c.top;
    const bottom = y + c.sag * 2;
    const d = `M ${x0} ${y} Q ${cx} ${bottom} ${x1} ${y}`;

    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "rgb(150 170 158 / 0.45)");
    path.setAttribute("stroke-width", "1.5");
    svg.appendChild(path);

    // Birnen auf der quadratischen Bézier verteilen
    for (let i = 0; i < c.count; i++) {
      const t = (i + 0.5) / c.count;
      const mt = 1 - t;
      bulbs.push({
        x: mt * mt * x0 + 2 * mt * t * cx + t * t * x1,
        y: mt * mt * y + 2 * mt * t * bottom + t * t * y,
        i: bulbs.length,
      });
    }
  }

  // Birnen als HTML-Punkte über dem SVG: So bleiben sie rund.
  host.replaceChildren(svg);
  for (const b of bulbs) {
    const dot = document.createElement("span");
    dot.className = "bulb";
    dot.style.left = `${b.x}px`;
    dot.style.top = `${b.y}px`;
    dot.style.width = `${bulbSize}px`;
    dot.style.height = `${bulbSize}px`;
    // Unregelmäßiges Blinken: jede Birne hat ihre eigene Phase.
    dot.style.animationDelay = `${(b.i * 0.37) % 3}s`;
    dot.style.animationDuration = `${2.4 + (b.i % 4) * 0.45}s`;
    host.appendChild(dot);
  }
}

/* --- Listenansicht (?liste=1) ------------------------------------------ */
/* Zum Korrekturlesen aller Texte auf einem Blick, ohne 24-mal zu klicken.
 * Bewusst ohne Schnee und ohne Automatik: Es geht ums Lesen. */

function renderList() {
  const stage = document.querySelector(".stage");
  document.querySelector("canvas")?.remove();
  document.querySelector(".garland")?.remove();
  document.querySelector(".foot")?.remove();
  document.querySelector(".masthead")?.remove();

  const list = document.createElement("div");
  list.className = "list";

  const head = el("header", "list-head");
  head.append(
    el("p", "list-kicker", "Korrekturlesen · alle 24 Türchen"),
    el("h1", "title", state.data.title || "24 Tage Informationssicherheit"),
  );
  const back = el("a", "list-back", "← Zurück zum Kalender");
  back.href = location.pathname;
  head.append(back);
  list.append(head);

  const grid = el("div", "list-grid");
  for (const item of [...state.data.doors].sort((a, b) => a.day - b.day)) {
    const card = el("article", "list-card");
    const top = el("div", "list-top");
    top.append(el("span", "list-num", String(item.day)),
               el("span", "list-kind", KIND_LABEL[item.kind] || item.kind));
    card.append(top);
    card.append(el("p", "detail-motto", item.motto || ""));
    card.append(el("h2", "list-title", item.title || ""));
    card.append(el("p", "list-lead", item.lead || ""));
    if (item.body) card.append(el("p", "list-body", item.body));

    if (item.kind === "quiz") {
      card.append(el("p", "list-q", item.question || ""));
      const ol = el("ol", "list-options");
      (item.options || []).forEach((text, i) => {
        const li = el("li", i === item.correct ? "is-right" : "", text);
        ol.append(li);
      });
      card.append(ol);
      card.append(el("p", "list-explain", item.explanation || ""));
    }
    if (item.kind === "challenge") {
      const ol = el("ol", "list-steps");
      (item.steps || []).forEach((text) => ol.append(el("li", null, text)));
      card.append(ol);
    }
    if (item.action) {
      const act = el("p", "list-action");
      act.append(el("strong", null, "Mach das "), document.createTextNode(item.action));
      card.append(act);
    }
    if (item.closing) card.append(el("p", "list-closing", item.closing));
    grid.append(card);
  }
  list.append(grid);

  const foot = el("p", "list-foot",
    "Texte ändern: content/advent.json — danach tools/check_content.py laufen lassen.");
  list.append(foot);

  stage.replaceChildren(list);
  document.title = "Korrekturlesen — " + (state.data.title || "24 Tage Informationssicherheit");
}

/* --- Start ------------------------------------------------------------- */

async function start() {
  try {
    state.data = await load();
  } catch (err) {
    board.innerHTML = "";
    const li = document.createElement("li");
    li.className = "board-error";
    li.textContent = "Der Kalender konnte nicht geladen werden. Bitte Seite neu laden.";
    board.appendChild(li);
    console.error(err);
    return;
  }

  state.seen = readSeen();
  const now = nowDate();
  state.todayDay = computeTodayDay(now);
  state.openDay = computeOpenDay(now, state.data.year);
  // Zum Testen unabhängig vom Datum:
  //   ?alle=1  → alle 24 Türchen offen (durchklicken)
  //   ?liste=1 → alle 24 Texte untereinander
  if (params.get("liste") || params.get("alle")) state.openDay = 24;

  renderMasthead(state.data);
  renderBoard();
  updateFooter(now);
  updateClock(now);

  if (params.get("liste")) {
    renderList();
    return;
  }

  snow();
  drawGarland();

  if (params.get("tur")) {
    const forced = Number(params.get("tur"));
    if (forced >= 1 && forced <= 24) openDoor(forced, { auto: false });
  } else if (state.openDay > 0) {
    state.nextAt = Date.now() + AUTO_FIRST_DELAY;
  }

  setInterval(tick, 1000);
  tick();
}

let garlandTimer = null;
addEventListener("resize", () => {
  clearTimeout(garlandTimer);
  garlandTimer = setTimeout(drawGarland, 150);
});

/* Eingaben, die die Automatik pausieren und den Dialog schließen. */
addEventListener("pointerdown", () => pauseAuto(), { passive: true });
addEventListener("keydown", (e) => {
  pauseAuto();
  if (e.key === "Escape") closeDetail();
  if (e.key === "ArrowRight" && state.current != null) {
    const open = openDoors();
    const idx = open.indexOf(state.current);
    if (idx >= 0 && idx < open.length - 1) openDoor(open[idx + 1], { auto: false });
  }
  if (e.key === "ArrowLeft" && state.current != null) {
    const open = openDoors();
    const idx = open.indexOf(state.current);
    if (idx > 0) openDoor(open[idx - 1], { auto: false });
  }
});
detail.addEventListener("click", (e) => {
  if (e.target === detail) closeDetail();
});

start();
