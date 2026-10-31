import { createOracle } from "./oracle.js";

const $ = (id) => document.getElementById(id);
const oracle = createOracle($("oracle"));

const TEXT = {
  en: {
    tagline: "An altar for dead open-source projects. Summon one and speak with its ghost. Everything runs on your machine.",
    url: "github.com/owner/repo", summon: "Summon", try: "Try:",
    lastWords: "Last words", commits: "Commits", mourners: "Mourners", archived: "Archived", stars: "Stars",
    heirs: "Heirs (forks)", leftBehind: "It left behind", seance: "Séance", question: "Ask the ghost…", ask: "Ask",
    pending: "the spirits stir…", from: "from", yes: "yes", no: "no", stillBreathing: "still breathing",
    breakBond: "Break the bond", idle: "Bring me a dead repository…", released: "The bond is broken. The ghost rests again.",
    ghost: (name) => `I am the ghost of ${name}. Ask.`, alive: "This one still breathes… ask it anyway.",
    preparing: "Preparing the altar…",
    steps: {
      waiting: "Waiting at the altar…", grave: "Opening the grave…", bones: "Reading the bones (git history)…",
      words: "Listening to its last words…", writings: "Gathering its writings…",
      candles: (n) => `Lighting the candles (embedding ${n} fragments)…`, epitaph: "Writing the epitaph…",
    },
  },
  es: {
    tagline: "Un altar para proyectos de código abierto muertos. Invoca uno y habla con su fantasma. Todo se ejecuta en tu ordenador.",
    url: "github.com/propietario/repo", summon: "Invocar", try: "Prueba:",
    lastWords: "Últimas palabras", commits: "Commits", mourners: "Dolientes", archived: "Archivado", stars: "Estrellas",
    heirs: "Herederos (forks)", leftBehind: "Lo que dejó", seance: "Sesión de espiritismo", question: "Pregúntale al fantasma…",
    ask: "Preguntar", pending: "los espíritus se agitan…", from: "de", yes: "sí", no: "no", stillBreathing: "aún respira",
    breakBond: "Romper el vínculo", idle: "Tráeme un repositorio muerto…", released: "El vínculo se ha roto. El fantasma vuelve a descansar.",
    ghost: (name) => `Soy el fantasma de ${name}. Pregunta.`, alive: "Este aún respira… pregúntale igualmente.",
    preparing: "Preparando el altar…",
    steps: {
      waiting: "Esperando en el altar…", grave: "Abriendo la tumba…", bones: "Leyendo los huesos (historial de git)…",
      words: "Escuchando sus últimas palabras…", writings: "Reuniendo sus escritos…",
      candles: (n) => `Encendiendo las velas (${n} fragmentos)…`, epitaph: "Escribiendo el epitafio…",
    },
  },
};

function savedLang() {
  try {
    const saved = localStorage.getItem("ofrenda-lang");
    if (saved in TEXT) return saved;
  } catch {}
  return navigator.language?.startsWith("es") ? "es" : "en";
}

let lang = savedLang();
let spiritId = null;
let lastUrl = "";
let lastOfrenda = null;
let history = [];
let controller = null; // aborts whatever is streaming when the bond is broken
const t = () => TEXT[lang];

async function* ndjson(url, body, signal) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`The altar answered ${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) yield JSON.parse(line);
    }
    if (buffer.trim()) yield JSON.parse(buffer);
  } finally {
    reader.cancel().catch(() => {});
  }
}

function setProgress(text, isError = false) {
  $("progress").textContent = text;
  $("progress").classList.toggle("error", isError);
}

function stepText(event) {
  const step = t().steps[event.step];
  if (typeof step === "function") return step(event.count);
  return step || event.message;
}

function setWhisper() {
  if (!lastOfrenda) $("whisper").textContent = t().idle;
  else $("whisper").textContent = lastOfrenda.facts.alive ? t().alive : t().ghost(lastOfrenda.facts.name);
}

function applyLanguage() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t()[el.dataset.i18n];
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t()[el.dataset.i18nPlaceholder];
  for (const button of document.querySelectorAll("#lang button")) {
    button.setAttribute("aria-pressed", String(button.dataset.lang === lang));
  }
  for (const el of document.querySelectorAll(".msg.ghost.pending")) el.dataset.pending = t().pending;
  if (lastOfrenda) renderOfrenda(lastOfrenda);
  setWhisper();
}

function renderOfrenda(event) {
  lastOfrenda = event;
  const f = event.facts;
  const n = (value) => value.toLocaleString(lang);
  $("card-name").textContent = `${f.owner}/${f.name}`;
  $("card-dates").textContent = f.alive ? `${f.born} – ${t().stillBreathing}` : `${f.born} – ${f.died}`;
  $("card-epitaph").textContent = `“${event.epitaph}”`;
  $("card-obituary").textContent = event.obituary;
  const facts = [
    [t().lastWords, `“${f.last_words}”`],
    [t().commits, n(f.commit_count)],
    [t().mourners, f.mourners.map(([name, c]) => `${name} (${c})`).join(", ")],
  ];
  if (f.archived !== null) facts.push([t().archived, f.archived ? t().yes : t().no]);
  if (f.stars !== null) facts.push([t().stars, n(f.stars)]);
  if (f.forks !== null) facts.push([t().heirs, n(f.forks)]);
  $("card-facts").replaceChildren(...facts.flatMap(([k, v]) => {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    return [dt, dd];
  }));
  $("card-legacy").replaceChildren(...event.legacy.map((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    return li;
  }));
  $("card").hidden = false;
  $("seance").hidden = false;
  setWhisper();
}

function setSummoning(on) {
  for (const button of document.querySelectorAll("#summon button, #examples button")) button.disabled = on;
}

function freshController() {
  controller?.abort();
  controller = new AbortController();
  return controller.signal;
}

// keepChat: re-summon the same spirit in another language without ending the séance.
async function summon(url, { keepChat = false } = {}) {
  const signal = freshController();
  setSummoning(true);
  if (!keepChat) {
    spiritId = null;
    lastOfrenda = null;
    history = [];
    $("log").replaceChildren();
    $("card").hidden = true;
    $("seance").hidden = true;
    setWhisper();
  }
  lastUrl = url;
  oracle.setThinking(true);
  setProgress(t().preparing);
  try {
    for await (const event of ndjson("/api/summon", { url, lang }, signal)) {
      if (event.type === "progress") setProgress(stepText(event));
      else if (event.type === "error") throw new Error(event.message);
      else if (event.type === "ofrenda") {
        spiritId = event.id;
        renderOfrenda(event);
        setProgress("");
        oracle.setMood("idle");
        if (!keepChat) $("question").focus();
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") setProgress(error.message, true);
  } finally {
    oracle.setThinking(false);
    setSummoning(false);
  }
}

// Keep the newest words in view: the ofrenda card above pushes the séance below the fold.
function followConversation() {
  $("log").scrollTop = $("log").scrollHeight;
  const panel = document.querySelector(".panel");
  panel.scrollTop = panel.scrollHeight;
}

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  $("log").append(div);
  followConversation();
  return div;
}

async function ask(question) {
  const id = spiritId; // a new summon or a broken bond must not leak into this answer
  const past = history;
  const signal = freshController();
  addMessage("user", question);
  const answer = addMessage("ghost", "");
  answer.classList.add("pending");
  answer.dataset.pending = t().pending;
  const askButton = $("ask").querySelector("button");
  askButton.disabled = true;
  oracle.setThinking(true);
  let text = "";
  try {
    for await (const event of ndjson("/api/ask", { id, question, history: past, lang }, signal)) {
      if (event.type === "token") {
        if (!text) { oracle.setThinking(false); oracle.setMood("speaking"); answer.classList.remove("pending"); }
        text += event.text;
        answer.textContent = text;
        oracle.pulseJaw();
        followConversation();
      } else if (event.type === "sources" && event.files.length) {
        const sources = document.createElement("small");
        sources.className = "sources";
        sources.textContent = `${t().from} ${event.files.join(", ")}`;
        answer.append(sources);
        followConversation();
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
    past.push({ role: "user", content: question }, { role: "assistant", content: text });
  } catch (error) {
    if (error.name === "AbortError") return;
    answer.classList.add("error");
    answer.textContent = error.message;
  } finally {
    answer.classList.remove("pending");
    askButton.disabled = false;
    if (id === spiritId) {
      oracle.setThinking(false);
      oracle.setMood(spiritId ? "idle" : "asleep");
    }
  }
}

function breakBond() {
  controller?.abort();
  controller = null;
  spiritId = null;
  lastOfrenda = null;
  history = [];
  $("log").replaceChildren();
  $("card").hidden = true;
  $("seance").hidden = true;
  setSummoning(false);
  setProgress(t().released);
  oracle.setThinking(false);
  oracle.setMood("asleep");
  setWhisper();
  $("url").focus();
}

$("summon").addEventListener("submit", (e) => {
  e.preventDefault();
  summon($("url").value);
});
$("examples").addEventListener("click", (e) => {
  const url = e.target.dataset?.url;
  if (!url) return;
  $("url").value = url;
  summon(url);
});
$("ask").addEventListener("submit", (e) => {
  e.preventDefault();
  const question = $("question").value.trim();
  if (!question || !spiritId) return;
  $("question").value = "";
  ask(question);
});
$("break").addEventListener("click", breakBond);
$("lang").addEventListener("click", (e) => {
  const chosen = e.target.dataset?.lang;
  if (!chosen || chosen === lang) return;
  lang = chosen;
  try { localStorage.setItem("ofrenda-lang", lang); } catch {}
  applyLanguage();
  if (spiritId) summon(lastUrl, { keepChat: true }); // the ofrenda is rewritten in the new language
});

applyLanguage();
