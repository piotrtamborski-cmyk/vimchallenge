# vimchallenge

Learn a Vim technique, use it in a real editor, then prove it in a contest — all three modes run on the
same versioned tasks and the same judging rules.

Early stage: the editor engine, the conformance harnesses that check it against real Vim, and the web app
with 12 lessons and 42 training tasks on three texts each, judged in the browser and confirmed by the
server's judge.

## Layout

| Path | What |
|---|---|
| `apps/web` | The web app (Next.js): home page, lessons, task list and task pages with the Vim editor. |
| `packages/tasks` | Published tasks (`tasks.json`: prompt, initial state, goals and one solution, plus `variants` — the same technique on other texts, for "practise on new text") and lessons (`lessons.json`: explanation, keys and the tasks that practise them). Tests check every card's shape and that each task belongs to a lesson; CI replays every task in Vim. |
| `packages/judge` | The server-side judge: a pool of worker threads that replay a key log in the headless engine under time, memory and size limits, and a small HTTP service in front of it. |
| `deploy` | Running on a server: [`deploy/README.md`](deploy/README.md), systemd units and sandbox for the web app and the judge, release and rollback scripts. |
| `packages/engine` | The editing engine: CodeMirror 6 + [`@replit/codemirror-vim`](https://github.com/replit/codemirror-vim), the shared editor profile, key notation, positions and goal checks. `@vimchallenge/engine/browser` is the editor in the page; `@vimchallenge/engine/headless` runs the same session in Node (jsdom) for the server-side judge. |
| `packages/vim-core` | Vendored fork of `@replit/codemirror-vim-core` (MIT) with the fixes found by conformance. npm links it in place of the published package. |
| `packages/conformance` | Replays every case key by key in reference Vim and in the headless engine and writes [`MATRIX.md`](packages/conformance/MATRIX.md); types every case into the browser editor in Chromium and checks that the judge reproduces it. |
| `packages/conformance/cases` | `plan-bank-v1.json` — the 80 planned tasks with the author's keys; `probes.json` — extra cases aimed at known weak spots (undo grouping, Unicode, regex). |

## Requirements

Node 22.18+ (it runs the TypeScript sources directly), Vim 9.1 on `PATH` (the reference for conformance) and Chromium or Chrome for the browser check
(found in `/usr/bin`, or set `CHROMIUM_PATH`).

```bash
npm install
npm run dev                    # web app on http://localhost:3000
npm run judge                  # judge service on http://127.0.0.1:3101 (PORT, HOST, JUDGE_WORKERS);
                               # run it next to `npm run dev` so the task page can confirm solves
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

## Judging

A task declares goals for the final state (text, cursor, mode, selection, registers, marks) and,
when the way matters, step goals in `expected.steps`: steps that must occur in order, each matched
on one key, for example "an undo turned `test` back into `test!`" or "the cursor was on the last
character before the first edit". The editor records a trail — the state after every key and
whether the key edited the text, undid or redid — and `checkGoals` judges the whole trail. The
reference Vim runner classifies keys the same way from `undotree()`, and conformance requires both
engines to agree on every undo and redo.

## Judge service

`POST /v1/judge` with `{"task": "undo-a-change", "version": 1, "text": 1, "keys": ["x", "u"]}` (`text` picks the
task's text: 1 is the task as published, 2 and up its variants; default 1) replays the key log —
tokens exactly as the browser editor records them — from the task's initial state and returns
`{"verdict": "passed" | "failed" | "rejected", "failures": [...], "reason": ..., "timing": {...}}` along with
the judge and profile versions. A run that breaks a limit in `packages/judge/src/limits.ts` (keys, text
size, time, worker heap) is `rejected` with the reason; a request that cannot be judged gets 400 (not key
tokens), 404 (unknown task), 409 (the task changed since the run started), 413, 415 or 503 (all workers busy).
`GET /healthz` reports the pool.

The task page judges a run in the browser and, once it is solved, asks the server to confirm it:
`POST /api/judge` in the web app forwards the run to the judge at `JUDGE_URL` (default
`http://127.0.0.1:3101`) and the page shows whether the server agreed. Only solved runs are sent, and
neither the web app nor the judge stores them. Without a running judge the page says the server check is
not available; the solve still counts in training.

`/api/judge` limits checks per client address: a burst of 20, then 30 a minute (`JUDGE_RATE_BURST`,
`JUDGE_RATE_PER_MINUTE`), answering 429 with `Retry-After` beyond that. IPv6 clients are counted per /64.
The address is the last `X-Forwarded-For` entry; behind Cloudflare set `CLIENT_IP_HEADER=cf-connecting-ip`.
The limit lives in the web app's memory, so it assumes one app process.

Each worker thread holds one engine and judges one run at a time from a fresh session; a run over the
time limit is stopped by terminating its worker, which is replaced. The service stores nothing and logs
only the task, the verdict and the time, never the keys. It listens on localhost; the public route sits in
front of it; [`deploy/README.md`](deploy/README.md) installs it as a systemd service next to the web app.
`GET /api/health` on the web app reports the release (commit) and whether the judge answers.

## Content Security Policy

Every page gets a Content Security Policy with a fresh nonce (`apps/web/proxy.ts`, policy in
`apps/web/lib/csp.ts`): scripts run only with the nonce or when loaded by such a script
(`'strict-dynamic'`), style elements need the nonce too, and nothing loads from other origins. Next.js
puts the nonce on its own scripts; the layout hands it to the editor, which puts it on the style element
CodeMirror adds. A nonce must be new for every response, so pages are rendered per request instead of
at build time. In development the policy also allows `eval` and inline styles, which React's error
reporting and the Next.js overlay need. `npm run -w @vimchallenge/judge bench` measures latency (on the development machine: p95 about
110 ms with 2 workers and 8 clients; the service takes about 250 MB with 2 workers).

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
