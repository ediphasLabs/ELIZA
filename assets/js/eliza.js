// ELIZA engine — keyword ranking, decomposition, reassembly, memory.
// After Weizenbaum (1966). No dependencies; works in the browser and Node.

const DELIMITERS = new Set([".", ",", ";", "!", "?", "but"]);
const NEWKEY = Symbol("newkey");
const MAX_GOTO = 10;

export function parseScript(text) {
  const s = { initial: "", final: "", quit: new Set(), pre: {}, post: {}, synon: {}, keys: {} };
  let key = null;
  let decomp = null;

  text.split("\n").forEach((raw, lineNo) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) return;
    const [, tag, rest] = m;
    switch (tag) {
      case "initial": s.initial = rest; break;
      case "final": s.final = rest; break;
      case "quit": s.quit.add(rest.toLowerCase()); break;
      case "pre": {
        const [w, ...rep] = rest.toLowerCase().split(/\s+/);
        s.pre[w] = rep;
        break;
      }
      case "post": {
        const [w, ...rep] = rest.split(/\s+/);
        s.post[w.toLowerCase()] = rep.join(" ");
        break;
      }
      case "synon": {
        const words = rest.toLowerCase().split(/\s+/);
        s.synon[words[0]] = words;
        break;
      }
      case "key": {
        const [word, rank] = rest.toLowerCase().split(/\s+/);
        key = { word, rank: Number(rank) || 0, decomps: [] };
        s.keys[word] = key;
        decomp = null;
        break;
      }
      case "decomp": {
        if (!key) throw new Error(`decomp outside key (line ${lineNo + 1})`);
        let p = rest.trim();
        const memory = p.startsWith("$");
        if (memory) p = p.slice(1).trim();
        decomp = {
          id: `${key.word}#${key.decomps.length}`,
          source: p,
          pattern: p.toLowerCase().split(/\s+/),
          memory,
          reasmb: [],
        };
        key.decomps.push(decomp);
        break;
      }
      case "reasmb": {
        if (!decomp) throw new Error(`reasmb outside decomp (line ${lineNo + 1})`);
        decomp.reasmb.push(rest.trim());
        break;
      }
    }
  });
  return s;
}

export function tokenize(input) {
  return input
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/([.,;!?])/g, " $1 ")
    .replace(/[^a-z0-9'.,;!? ]+/g, " ")
    .split(/\s+/)
    .map((w) => (/^[.,;!?]$/.test(w) ? w : w.replace(/^'+|'+$/g, "")))
    .filter(Boolean);
}

function splitClauses(words) {
  const clauses = [];
  let cur = [];
  for (const w of words) {
    if (DELIMITERS.has(w)) {
      if (cur.length) clauses.push(cur);
      cur = [];
    } else cur.push(w);
  }
  if (cur.length) clauses.push(cur);
  return clauses;
}

// Match a decomposition pattern against a word list.
// '*' captures any run (possibly empty), '@group' captures one word from a
// synonym group, literals must match exactly. Returns an array of captures.
function matchPattern(pattern, words, synon) {
  const go = (pi, wi, caps) => {
    if (pi === pattern.length) return wi === words.length ? caps : null;
    const p = pattern[pi];
    if (p === "*") {
      for (let k = wi; k <= words.length; k++) {
        const r = go(pi + 1, k, [...caps, words.slice(wi, k)]);
        if (r) return r;
      }
      return null;
    }
    if (p.startsWith("@")) {
      const group = synon[p.slice(1)] || [p.slice(1)];
      if (wi < words.length && group.includes(words[wi])) return go(pi + 1, wi + 1, [...caps, [words[wi]]]);
      return null;
    }
    if (wi < words.length && words[wi] === p) return go(pi + 1, wi + 1, caps);
    return null;
  };
  return go(0, 0, []);
}

function tidy(text) {
  const t = text
    .replace(/\s+/g, " ")
    .replace(/\s+([?.!,])/g, "$1")
    .replace(/"\s+/g, '"')
    .trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export class Eliza {
  constructor(scriptText, state) {
    this.script = typeof scriptText === "string" ? parseScript(scriptText) : scriptText;
    this.memory = [];
    this.cursors = {};
    if (state) this.loadState(state);
  }

  get initial() { return this.script.initial; }
  get final() { return this.script.final; }

  getState() { return { memory: [...this.memory], cursors: { ...this.cursors } }; }
  loadState(state) {
    this.memory = [...(state.memory || [])];
    this.cursors = { ...(state.cursors || {}) };
  }

  postTransform(words) {
    return words.map((w) => this.script.post[w] ?? w).join(" ");
  }

  // Choose the next reassembly for a decomposition, cycling in order as the
  // original did. Skips templates that reference an empty fragment.
  nextReassembly(decomp, caps) {
    const n = decomp.reasmb.length;
    let idx = this.cursors[decomp.id] ?? 0;
    for (let tries = 0; tries < n; tries++) {
      const template = decomp.reasmb[idx % n];
      idx++;
      const refs = [...template.matchAll(/\((\d+)\)/g)].map((m) => Number(m[1]));
      if (refs.every((r) => caps[r - 1] && caps[r - 1].length)) {
        this.cursors[decomp.id] = idx % n;
        return template;
      }
    }
    this.cursors[decomp.id] = idx % n;
    return decomp.reasmb[(idx - 1) % n];
  }

  assemble(template, caps) {
    const fragments = {};
    const text = template.replace(/\((\d+)\)/g, (_, n) => {
      const t = this.postTransform(caps[Number(n) - 1] || []);
      fragments[n] = t;
      return t;
    });
    return { text: tidy(text), fragments };
  }

  tryKey(word, words, trace, depth = 0) {
    const key = this.script.keys[word];
    if (!key || depth > MAX_GOTO) return NEWKEY;
    for (const decomp of key.decomps) {
      const caps = matchPattern(decomp.pattern, words, this.script.synon);
      trace.attempts.push({ key: word, pattern: decomp.source, memory: decomp.memory, matched: !!caps });
      if (!caps) continue;

      if (decomp.memory) {
        const template = this.nextReassembly(decomp, caps);
        if (!/^(goto |newkey)/.test(template)) {
          const { text } = this.assemble(template, caps);
          this.memory.push(text);
          trace.memorySaved = text;
        }
        continue;
      }

      const template = this.nextReassembly(decomp, caps);
      if (template === "newkey") {
        trace.attempts.push({ key: word, directive: "newkey" });
        return NEWKEY;
      }
      if (template.startsWith("goto ")) {
        const target = template.slice(5).trim();
        trace.attempts.push({ key: word, directive: `goto ${target}` });
        return this.tryKey(target, words, trace, depth + 1);
      }
      const { text, fragments } = this.assemble(template, caps);
      return {
        text,
        key: word,
        decomp: decomp.source,
        template,
        captures: caps.map((c) => c.join(" ")),
        fragments,
      };
    }
    return NEWKEY;
  }

  respond(input) {
    const trace = {
      input,
      tokens: [],
      substitutions: [],
      clauses: [],
      clause: null,
      stack: [],
      attempts: [],
      memorySaved: null,
      path: null,
      result: null,
    };

    const tokens = tokenize(input);
    trace.tokens = tokens;

    // 1. Quit words end the session.
    const quitWord = tokens.find((t) => this.script.quit.has(t));
    if (quitWord) {
      trace.path = "quit";
      trace.result = { key: quitWord, template: this.script.final };
      return { text: this.script.final, trace, ended: true };
    }

    // 2. Pre-substitution.
    const words = [];
    for (const t of tokens) {
      const rep = this.script.pre[t];
      if (rep) {
        words.push(...rep);
        trace.substitutions.push([t, rep.join(" ")]);
      } else words.push(t);
    }

    // 3. Clause selection: the first clause that contains a keyword is kept;
    //    everything before it is discarded, everything after it ignored.
    const clauses = splitClauses(words);
    trace.clauses = clauses.map((c) => c.join(" "));
    for (let i = 0; i < clauses.length; i++) {
      const seen = new Set();
      const stack = [];
      for (const w of clauses[i]) {
        const key = this.script.keys[w];
        if (key && !seen.has(w)) {
          seen.add(w);
          stack.push({ word: w, rank: key.rank });
        }
      }
      if (stack.length) {
        // Stable sort: higher rank first, ties keep order of appearance.
        stack.sort((a, b) => b.rank - a.rank);
        trace.clause = i;
        trace.stack = stack;

        // 4. Try keywords from the top of the stack.
        for (const { word } of stack) {
          const r = this.tryKey(word, clauses[i], trace);
          if (r !== NEWKEY) {
            trace.path = "keyword";
            trace.result = r;
            return { text: r.text, trace };
          }
        }
        break;
      }
    }

    // 5. No usable keyword: recall something from memory, else a content-free remark.
    if (this.memory.length) {
      const text = this.memory.shift();
      trace.path = "memory";
      trace.result = { text, template: "(from memory)" };
      return { text, trace };
    }

    const all = clauses.flat();
    const r = this.tryKey("xnone", all, trace);
    trace.path = "fallback";
    trace.result = r === NEWKEY ? { text: "Please go on." } : r;
    return { text: trace.result.text, trace };
  }
}
