# vimchallenge

Learn a Vim technique, use it in a real editor, then prove it in a contest — all three modes run on the
same versioned tasks and the same judging rules.

Early stage: the editor engine, the conformance harnesses that check it against real Vim, and the first
version of the web app with 22 training tasks.

## Layout

| Path | What |
|---|---|
| `apps/web` | The web app (Next.js): home page, task list and task pages with the Vim editor. |
| `packages/tasks` | Published tasks (`tasks.json`): prompt, initial state, goals and one solution. CI replays every task in Vim. |
| `packages/engine` | The editing engine: CodeMirror 6 + [`@replit/codemirror-vim`](https://github.com/replit/codemirror-vim), the shared editor profile, key notation, positions and goal checks. `@vimchallenge/engine/browser` is the editor in the page; `@vimchallenge/engine/headless` runs the same session in Node (jsdom) for the server-side judge. |
| `packages/vim-core` | Vendored fork of `@replit/codemirror-vim-core` (MIT) with the fixes found by conformance. npm links it in place of the published package. |
| `packages/conformance` | Replays every case key by key in reference Vim and in the headless engine and writes [`MATRIX.md`](packages/conformance/MATRIX.md); types every case into the browser editor in Chromium and checks that the judge reproduces it. |
| `packages/conformance/cases` | `plan-bank-v1.json` — the 80 planned tasks with the author's keys; `probes.json` — extra cases aimed at known weak spots (undo grouping, Unicode, regex). |

## Requirements

Node 22+, Vim 9.1 on `PATH` (the reference for conformance) and Chromium or Chrome for the browser check
(found in `/usr/bin`, or set `CHROMIUM_PATH`).

```bash
npm install
npm run dev                    # web app on http://localhost:3000
npm run typecheck
npm test
npm run conformance            # all cases, rewrites packages/conformance/MATRIX.md
npm run conformance -- V033    # selected cases, report in packages/conformance/out/
npm run conformance:browser    # browser editor vs judge, key by key, in headless Chromium
npm run build
```

## How conformance works

`packages/conformance/vim/driver.vim` starts Vim with no user config, applies the editor profile and feeds
the keys one at a time from a timer, so each key is handled exactly as if typed. After every key it records
text, mode, cursor, visual selection, registers and marks. The headless engine records the same snapshot,
and the harness reports the first key after which the two differ. Columns are 1-based and count characters
like Vim's `charcol()`: one per code point, with combining marks counted as part of the preceding character.

## Browser editor and judge

The browser never lets CodeMirror or vim-core react to DOM events directly. Each key press becomes one
token in Vim notation (`x`, `<Esc>`, `<C-v>`) and goes through `Session.feed`, the same function the judge
calls when it replays the key log. Text input that arrives without a key event (AltGr, dead keys) and pasted
text become the same tokens; a transaction filter drops every other change to the text or cursor, so mouse
clicks, drag and drop or cut cannot move the editor away from its log. IME composition is not supported yet
(the filter drops it). Losing focus with the command line open
is logged as the `<Esc>` it amounts to. `npm run conformance:browser` types every case with real key events
and compares the browser with the judge after every key.

## License

[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). If you run a modified version as a
network service, you must offer its source code to its users.
