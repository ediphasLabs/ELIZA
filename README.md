# ELIZA

A faithful recreation of Joseph Weizenbaum's **ELIZA** (MIT, 1966) running the **DOCTOR** script, in a modern chat interface.

Every reply has a **trace** you can open. It shows the tokens, the substitutions, the keyword stack, which decomposition patterns were tried, the captured fragments and their pronoun swaps, and the reassembly template that was filled in. You can watch the illusion get made.

> ELIZA matches patterns. It doesn't understand you, and it never did.

## Features

- **Faithful engine**: ranked keywords, clause selection at punctuation and *but*, `*` and `@synonym` decomposition, cycling reassembly, `goto` / `newkey` directives, and the `MY` memory stack. It reproduces the well-known "Men are all alike" transcript from the 1966 paper almost line for line.
- **The script is data.** `assets/js/doctor.js` holds the DOCTOR script in a readable `key / decomp / reasmb` format. Swap it and ELIZA becomes a different character. You can also read it inside the app.
- **Trace view**: a step-by-step breakdown under any reply, or under all of them.
- **Modern chat UI**: conversation history, light and dark themes, a streaming typing effect, copy, keyboard shortcuts (`Enter` to send, `Shift+Enter` for a newline, `⌘/Ctrl+K` for a new chat, `/` to focus), and a responsive mobile layout.
- **Teletype mode**: replies in capitals and monospace, as they came out of the IBM 7094.
- **Private**: no backend, no API, no tracking. Conversations live in your browser's `localStorage`.

## Run locally

No build step. Serve the folder with any static server (ES modules don't load from `file://`):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy to GitHub Pages

1. Push to `main`.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then select `main` and `/ (root)`.
4. The site appears at `https://<user>.github.io/ELIZA/`.

All paths are relative, so it also works under a custom domain or a subpath.

## Structure

```
index.html            app shell, dialogs, icon sprite
assets/css/style.css  design system and layout
assets/js/eliza.js    the engine (parseScript, tokenize, Eliza class)
assets/js/doctor.js   the DOCTOR script
assets/js/app.js      UI: conversations, streaming, trace rendering, settings
assets/favicon.svg
```

The engine has no DOM dependency, so you can use it in Node:

```js
import { Eliza } from "./assets/js/eliza.js";
import { DOCTOR } from "./assets/js/doctor.js";

const eliza = new Eliza(DOCTOR);
eliza.respond("Men are all alike.").text;  // "In what way?"
```

## References

- Weizenbaum, J. (1966). ELIZA — a computer program for the study of natural language communication between man and machine. *Communications of the ACM*, 9(1), 36–45.
- Weizenbaum, J. (1976). *Computer Power and Human Reason.*
- [ELIZAGEN: the original ELIZA source](https://sites.google.com/view/elizagen-org/original-eliza), rediscovered in MIT's archives in 2021.
- Lane, R. et al. (2025). [ELIZA Reanimated](https://arxiv.org/abs/2501.06707).

The DOCTOR script here is a reconstruction based on the script published in the 1966 paper, written in the widely used `key/decomp/reasmb` notation.
