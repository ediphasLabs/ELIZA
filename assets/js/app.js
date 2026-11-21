import { Eliza, parseScript } from "./eliza.js";
import { DOCTOR } from "./doctor.js";

const SCRIPT = parseScript(DOCTOR);
const LS_CONVS = "eliza.conversations";
const LS_SETTINGS = "eliza.settings";

const SUGGESTIONS = [
  "Men are all alike.",
  "My mother doesn't understand me.",
  "I dreamt I was flying.",
  "Are you a computer?",
  "I feel anxious lately.",
];

// ---------------------------------------------------------------- utilities
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
};
const icon = (id) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const u = document.createElementNS("http://www.w3.org/2000/svg", "use");
  u.setAttribute("href", `#${id}`);
  s.append(u);
  return s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// -------------------------------------------------------------------- state
const settings = Object.assign({ theme: "system", teletype: false, traces: false, typing: true }, load(LS_SETTINGS, {}));
let convs = load(LS_CONVS, []);
let activeId = null;
let engine = null;
let busy = false;

const app = $("#app"), main = $("#main"), thread = $("#thread"), scroller = $("#scroller");
const input = $("#input"), sendBtn = $("#sendBtn"), form = $("#composer");

const active = () => convs.find((c) => c.id === activeId);
const persist = () => save(LS_CONVS, convs);

// -------------------------------------------------------------------- theme
const mq = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const t = settings.theme === "system" ? (mq.matches ? "dark" : "light") : settings.theme;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]').content = t === "dark" ? "#1C1B19" : "#F6F3EC";
  document.querySelectorAll("#themeSeg button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.theme === settings.theme)));
}
mq.addEventListener("change", applyTheme);

function applySettings() {
  applyTheme();
  app.classList.toggle("teletype", settings.teletype);
  $("#teletypeSwitch").checked = settings.teletype;
  $("#traceSwitch").checked = settings.traces;
  $("#typingSwitch").checked = settings.typing;
  $("#traceToggle").setAttribute("aria-pressed", String(settings.traces));
  save(LS_SETTINGS, settings);
}

// ----------------------------------------------------------------- greeting
function greet() {
  const hr = new Date().getHours();
  const part = hr < 5 ? "Still awake?" : hr < 12 ? "Good morning." : hr < 17 ? "Good afternoon." : hr < 22 ? "Good evening." : "Still awake?";
  $("#greeting").textContent = part;
}

// ------------------------------------------------------------------ sidebar
function groupLabel(ts) {
  const d = new Date(ts), now = new Date();
  const day = 864e5;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= start) return "Today";
  if (ts >= start - day) return "Yesterday";
  if (ts >= start - 7 * day) return "Previous 7 days";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function renderSidebar() {
  const list = $("#convList");
  list.replaceChildren();
  const sorted = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);
  if (!sorted.length) {
    list.append(h("div", { class: "sb-empty" }, "Your conversations stay in this browser. Nothing is sent anywhere. ELIZA runs entirely on your machine, as it always could have."));
    return;
  }
  let last = null;
  for (const c of sorted) {
    const g = groupLabel(c.updatedAt);
    if (g !== last) { list.append(h("div", { class: "sb-group" }, g)); last = g; }
    const del = h("span", { class: "del", role: "button", title: "Delete", "aria-label": "Delete conversation", onclick: (e) => { e.stopPropagation(); deleteConv(c.id); } }, icon("i-trash"));
    list.append(h("button", { class: "conv" + (c.id === activeId ? " active" : ""), onclick: () => { openConv(c.id); closeMobileSidebar(); } }, h("span", {}, c.title || "New conversation"), del));
  }
}

function deleteConv(id) {
  convs = convs.filter((c) => c.id !== id);
  persist();
  if (id === activeId) newConv();
  else renderSidebar();
  toast("Conversation deleted");
}

// ------------------------------------------------------------ conversations
function newConv() {
  activeId = null;
  engine = new Eliza(SCRIPT);
  thread.replaceChildren();
  main.classList.add("is-empty");
  $("#convTitle").textContent = "";
  document.title = "ELIZA — the 1966 chatbot, rebuilt";
  greet();
  renderSidebar();
  history.replaceState(null, "", location.pathname);
  input.focus();
}

function openConv(id) {
  const c = convs.find((x) => x.id === id);
  if (!c) return newConv();
  activeId = id;
  engine = new Eliza(SCRIPT, c.state);
  main.classList.toggle("is-empty", c.messages.length === 0);
  $("#convTitle").textContent = c.title;
  document.title = `${c.title} · ELIZA`;
  thread.replaceChildren(...c.messages.map((m) => renderMessage(m)));
  if (c.ended) thread.append(sessionEnd());
  renderSidebar();
  history.replaceState(null, "", `#${id}`);
  requestAnimationFrame(() => { scroller.style.scrollBehavior = "auto"; scroller.scrollTop = scroller.scrollHeight; scroller.style.scrollBehavior = ""; });
}

function ensureConv(firstText) {
  let c = active();
  if (c) return c;
  const title = firstText.length > 48 ? firstText.slice(0, 46).trimEnd() + "…" : firstText;
  c = { id: uid(), title, createdAt: Date.now(), updatedAt: Date.now(), messages: [], state: engine.getState() };
  convs.push(c);
  activeId = c.id;
  $("#convTitle").textContent = title;
  document.title = `${title} · ELIZA`;
  history.replaceState(null, "", `#${c.id}`);
  return c;
}

// ---------------------------------------------------------------- messages
function renderMessage(m, { stream = false } = {}) {
  if (m.role === "user") return h("div", { class: "msg user" }, h("div", { class: "bubble" }, m.text));

  const text = h("div", { class: "eliza-text" });
  if (!stream) text.textContent = m.text;
  const traceBtn = h("button", { "aria-expanded": "false", title: "How was this reply made?" }, icon("i-trace"), h("span", {}, "Trace"));
  const copyBtn = h("button", { title: "Copy" }, icon("i-copy"), h("span", {}, "Copy"));
  const actions = h("div", { class: "msg-actions" }, copyBtn, traceBtn);
  const body = h("div", { class: "eliza-body" }, text, actions);
  const el = h("div", { class: "msg eliza" + (m.ended ? " ended" : "") }, h("div", { class: "avatar" }, icon("mark")), body);

  copyBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(m.text); } catch {}
    copyBtn.replaceChildren(icon("i-check"), h("span", {}, "Copied"));
    setTimeout(() => copyBtn.replaceChildren(icon("i-copy"), h("span", {}, "Copy")), 1400);
  });
  const toggleTrace = (open) => {
    const existing = $(".trace", body);
    if (open && !existing) body.append(renderTrace(m.trace));
    if (!open && existing) existing.remove();
    traceBtn.setAttribute("aria-expanded", String(open));
    el.classList.toggle("trace-open", open);
  };
  traceBtn.addEventListener("click", () => {
    const open = traceBtn.getAttribute("aria-expanded") !== "true";
    toggleTrace(open);
    if (open) requestAnimationFrame(() => $(".trace", body)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  });
  el._toggleTrace = toggleTrace;
  el._text = text;
  if (settings.traces && m.trace && !stream) toggleTrace(true);
  return el;
}

function sessionEnd() {
  return h("div", { class: "session-end" }, "Session ended", h("button", { onclick: newConv }, "Start again"));
}

const PATH_LABEL = {
  keyword: "matched a keyword",
  memory: "recalled from memory",
  fallback: "no keyword · content-free remark",
  quit: "quit word",
};

function renderTrace(t) {
  if (!t) return h("div", { class: "trace" }, h("div", { class: "trace-head" }, "No trace recorded for this message."));
  const steps = h("ol", { class: "trace-steps" });
  const step = (label, ...val) => steps.append(h("li", {}, h("span", { class: "t-label" }, label), h("div", { class: "t-val" }, ...val)));
  const stepCol = (label, ...val) => steps.append(h("li", {}, h("span", { class: "t-label" }, label), h("div", { class: "t-val col" }, ...val)));
  const keyWords = new Set((t.stack || []).map((s) => s.word));

  step("Tokens", ...t.tokens.map((w) => h("span", { class: "tok" + (/^[.,;!?]$/.test(w) || w === "but" ? " delim" : "") }, w)));

  if (t.path === "quit") {
    step("Quit word", h("span", { class: "tok key" }, t.result.key), h("span", {}, "ends the session."));
  } else {
    if (t.substitutions.length) step("Substitutions", ...t.substitutions.map(([a, b]) => h("span", { class: "mono" }, `${a} → ${b}`)));
    else step("Substitutions", h("span", {}, "none"));

    if (t.clauses.length > 1) {
      step("Clauses", ...t.clauses.map((c, i) => h("span", { class: "tok" + (t.clause === i ? "" : " dim") }, c)));
    }

    if (t.stack.length) {
      step("Keyword stack", ...t.stack.map((s) => h("span", { class: "tok key" }, `${s.word} · ${s.rank}`)));
    } else {
      step("Keyword stack", h("span", {}, "empty: no keyword in any clause"));
    }

    if (t.attempts.length) {
      stepCol("Decomposition", ...t.attempts.map((a) => {
        if (a.directive) return h("div", { class: "attempt" }, h("span", { class: "mark-ok" }, "↳"), h("span", { class: "dir" }, `${a.key}: ${a.directive}`));
        const cls = "attempt" + (a.matched ? " ok" : "") + (a.matched && a.memory ? " mem" : "");
        return h("div", { class: cls },
          h("span", { class: a.matched ? "mark-ok" : "mark-no" }, a.matched ? (a.memory ? "◆" : "✓") : "·"),
          h("span", { class: "k" }, `${a.key}: ${a.memory ? "$ " : ""}${a.pattern}`));
      }));
    }

    const r = t.result;
    if (r && r.captures && r.captures.length) {
      stepCol("Fragments", ...r.captures.map((c, i) => {
        const n = String(i + 1);
        const used = r.fragments[n] != null;
        return h("div", { class: "cap" },
          h("i", {}, `(${n})`),
          h("span", { class: used ? `cap-c${(i % 4) + 1}` : "" }, c ? `“${c}”` : "∅"),
          used && r.fragments[n] !== c ? [h("span", { class: "arrow" }, "→"), h("span", { class: `cap-c${(i % 4) + 1}` }, `“${r.fragments[n]}”`)] : null);
      }));
    }

    if (r && r.template && t.path !== "memory") {
      const tpl = h("div", { class: "template" });
      r.template.split(/(\(\d+\))/).forEach((part) => tpl.append(/^\(\d+\)$/.test(part) ? h("span", { class: "slot" }, part) : part));
      step("Reassembly", tpl);
    }
    if (t.path === "memory") step("Memory", h("span", { class: "mem-note" }, "No keyword applied, so ELIZA pulled out something you said earlier."));
    if (t.memorySaved) step("Saved to memory", h("span", { class: "mem-note" }, `“${t.memorySaved}”`));
  }

  return h("div", { class: "trace" },
    h("div", { class: "trace-head" }, h("span", {}, h("b", {}, "How this reply was made")), h("span", { class: `path-badge ${t.path}` }, PATH_LABEL[t.path] || t.path)),
    steps);
}

// ------------------------------------------------------------------- send
function scrollToEnd() { scroller.scrollTop = scroller.scrollHeight; }

async function send(textRaw) {
  const text = textRaw.trim();
  if (!text || busy) return;
  busy = true;
  updateSend();

  const c = ensureConv(text);
  if (c.ended) { c.ended = false; const end = $(".session-end", thread); if (end) end.remove(); }
  main.classList.remove("is-empty");

  const userMsg = { role: "user", text, ts: Date.now() };
  c.messages.push(userMsg);
  thread.append(renderMessage(userMsg));
  input.value = "";
  autosize();
  renderSidebar();
  requestAnimationFrame(scrollToEnd);

  const { text: reply, trace, ended } = engine.respond(text);
  const elizaMsg = { role: "eliza", text: reply, trace, ended: !!ended, ts: Date.now() };

  // Thinking
  const thinking = h("div", { class: "msg eliza thinking" }, h("div", { class: "avatar" }, icon("mark")), h("div", { class: "thinking-label" }, "listening…"));
  if (settings.typing) {
    thread.append(thinking);
    requestAnimationFrame(scrollToEnd);
    await sleep(520 + Math.min(900, text.length * 12) + Math.random() * 380);
    thinking.remove();
  }

  const el = renderMessage(elizaMsg, { stream: settings.typing });
  thread.append(el);
  if (settings.typing) await stream(el._text, reply);
  if (settings.traces) el._toggleTrace(true);
  requestAnimationFrame(scrollToEnd);

  c.messages.push(elizaMsg);
  c.state = engine.getState();
  c.updatedAt = Date.now();
  if (ended) {
    c.ended = true;
    engine = new Eliza(SCRIPT);
    c.state = engine.getState();
    thread.append(sessionEnd());
  }
  persist();
  renderSidebar();
  busy = false;
  updateSend();
  if (matchMedia("(pointer: fine)").matches) input.focus();
}

async function stream(el, text) {
  const words = text.split(/(\s+)/);
  const caret = settings.teletype ? h("span", { class: "caret" }) : null;
  if (caret) el.append(caret);
  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  for (const w of words) {
    const node = /^\s+$/.test(w) ? document.createTextNode(w) : h("span", { class: "w" }, w);
    caret ? el.insertBefore(node, caret) : el.append(node);
    if (nearBottom()) scrollToEnd();
    if (!/^\s+$/.test(w)) await sleep(settings.teletype ? 26 + w.length * 18 : 38 + Math.random() * 40);
  }
  if (caret) { await sleep(400); caret.remove(); }
  el.textContent = text; // normalise
}

// --------------------------------------------------------------- composer
function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 220) + "px";
}
function updateSend() { sendBtn.disabled = busy || !input.value.trim(); }

input.addEventListener("input", () => { autosize(); updateSend(); });
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send(input.value);
  }
});
form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });

const chips = $("#chips");
SUGGESTIONS.forEach((s) => chips.append(h("button", { class: "chip", type: "button", onclick: () => send(s) }, s)));

// ------------------------------------------------------------- chrome / ui
const isMobile = () => matchMedia("(max-width: 860px)").matches;
function closeMobileSidebar() { app.classList.remove("sb-mobile-open"); }
$("#collapseBtn").addEventListener("click", () => {
  if (isMobile()) closeMobileSidebar();
  else { app.classList.add("sb-collapsed"); save("eliza.sb", "collapsed"); }
});
$("#openSidebarBtn").addEventListener("click", () => {
  if (isMobile()) app.classList.add("sb-mobile-open");
  else { app.classList.remove("sb-collapsed"); save("eliza.sb", "open"); }
});
$("#scrim").addEventListener("click", closeMobileSidebar);
if (load("eliza.sb", "open") === "collapsed") app.classList.add("sb-collapsed");

$("#newChatBtn").addEventListener("click", () => { newConv(); closeMobileSidebar(); });

$("#themeToggle").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme;
  settings.theme = cur === "dark" ? "light" : "dark";
  applySettings();
});
$("#traceToggle").addEventListener("click", () => {
  settings.traces = !settings.traces;
  applySettings();
  thread.querySelectorAll(".msg.eliza").forEach((el) => el._toggleTrace && el._toggleTrace(settings.traces));
});

// Dialogs
document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => { $("#" + b.dataset.open).showModal(); closeMobileSidebar(); }));
document.querySelectorAll("dialog").forEach((d) => {
  d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); });
});

// Settings
document.querySelectorAll("#themeSeg button").forEach((b) => b.addEventListener("click", () => { settings.theme = b.dataset.theme; applySettings(); }));
$("#teletypeSwitch").addEventListener("change", (e) => { settings.teletype = e.target.checked; applySettings(); });
$("#typingSwitch").addEventListener("change", (e) => { settings.typing = e.target.checked; applySettings(); });
$("#traceSwitch").addEventListener("change", (e) => {
  settings.traces = e.target.checked;
  applySettings();
  thread.querySelectorAll(".msg.eliza").forEach((el) => el._toggleTrace && el._toggleTrace(settings.traces));
});
$("#clearAllBtn").addEventListener("click", () => {
  if (!convs.length) return toast("Nothing to clear");
  convs = [];
  persist();
  newConv();
  $("#settingsDialog").close();
  toast("All conversations cleared");
});

// Keyboard
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); newConv(); }
  else if (e.key === "/" && document.activeElement !== input && !document.querySelector("dialog[open]")) { e.preventDefault(); input.focus(); }
});

// Toast
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

// ------------------------------------------------------------ script view
function renderScriptView() {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const out = DOCTOR.trim().split("\n").map((line) => {
    if (/^\s*#/.test(line)) return `<span class="s-com">${esc(line)}</span>`;
    const m = line.match(/^(\s*)(\w+):(\s*)(.*)$/);
    if (!m) return esc(line);
    const [, ind, tag, sp, rest] = m;
    let body = esc(rest);
    if (tag === "key") body = body.replace(/^(\S+)(\s+\d+)?/, (_, k, r) => `<span class="s-key">${k}</span>${r ? `<span class="s-rank">${r}</span>` : ""}`);
    else if (tag === "reasmb" && /^(goto |newkey)/.test(rest)) body = `<span class="s-dir">${body}</span>`;
    else body = body.replace(/(\(\d+\)|@\w+|\$)/g, '<span class="s-slot">$1</span>');
    return `${ind}<span class="s-tag">${tag}:</span>${sp}${body}`;
  });
  $("#scriptView").innerHTML = out.join("\n");
  const keys = Object.keys(SCRIPT.keys).filter((k) => !k.startsWith("x"));
  const decomps = Object.values(SCRIPT.keys).reduce((n, k) => n + k.decomps.length, 0);
  const reasmb = Object.values(SCRIPT.keys).reduce((n, k) => n + k.decomps.reduce((m, d) => m + d.reasmb.length, 0), 0);
  $("#scriptStats").textContent = `${keys.length} keywords · ${decomps} decomposition rules · ${reasmb} reassembly templates`;
}

// ------------------------------------------------------------------- boot
applySettings();
renderScriptView();
const hashId = location.hash.slice(1);
if (hashId && convs.some((c) => c.id === hashId)) openConv(hashId);
else newConv();
autosize();
