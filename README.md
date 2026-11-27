# vimchallenge

Learn a Vim technique, use it in a real editor, then prove it in a contest — all three modes run on the
same versioned tasks and the same judging rules.

Early stage: the editor engine, the conformance harnesses that check it against real Vim, and the web app
with 18 lessons and all 80 tasks of the planned bank (five levels) on three texts each, judged in the browser and confirmed by the
server's judge. Players may sign in with GitHub, Google or an email link to keep their progress,
and play live rooms with up to eight people; neither needs an account. Signed-in players get one go a
day at the daily challenge, which feeds daily, weekly, monthly and all-time leaderboards.

## Layout

| Path | What |
|---|---|
| `apps/web` | The web app (Next.js): home page, lessons, task list and task pages with the Vim editor, rooms, the daily challenge and leaderboards, sign-in, account and privacy pages. |
| `packages/accounts` | Accounts without passwords: the SQLite schema, sign-in methods (email links, GitHub, Google) connected to one account, sessions, confirmed solves, the database backup script, and the schema check a rollback runs. |
| `packages/rooms` | Live rooms: members, matches, rounds and attempts in the same database, task draws by level, key packets, checks through the judge, and the scoring rules. |
| `packages/daily` | The daily challenge and the leaderboards: one set a day, runs and their attempts, day entries rebuilt from them, the four tables, corrections, and the operator's tools for them and for the restore drill. |
| `packages/loadtest` | The load test for live rooms: simulated guests play rooms against a running site and the tool reports check and delivery times (see [deploy/README.md](deploy/README.md#load-test)). |
| `packages/tasks` | Published tasks (`tasks.json`: prompt, initial state, goals and one solution, plus `variants` — the same technique on other texts, for "practise on new text") and lessons (`lessons.json`: explanation, keys and the tasks that practise them). Tests check every card's shape and that each task belongs to a lesson; CI replays every task in Vim. |
| `packages/judge` | The server-side judge: a pool of worker threads that replay a key log in the headless engine under time, memory and size limits, and a small HTTP service in front of it. |
| `deploy` | Running on a server: [`deploy/README.md`](deploy/README.md), systemd units and sandbox for the web app and the judge, the database backup timer, release and rollback scripts. |
| `packages/engine` | The editing engine: CodeMirror 6 + [`@replit/codemirror-vim`](https://github.com/replit/codemirror-vim), the shared editor profile, key notation, positions and goal checks. `@vimchallenge/engine/browser` is the editor in the page; `@vimchallenge/engine/headless` runs the same session in Node (jsdom) for the server-side judge. |
| `packages/vim-core` | Vendored fork of `@replit/codemirror-vim-core` (MIT) with the fixes found by conformance. npm links it in place of the published package. |
| `packages/conformance` | Replays every case key by key in reference Vim and in the headless engine and writes [`MATRIX.md`](packages/conformance/MATRIX.md); types every case into the browser editor in Chromium and checks that the judge reproduces it. |
| `packages/conformance/cases` | `plan-bank-v1.json` — the 80 planned tasks with the author's keys; `probes.json` — extra cases aimed at known weak spots (undo grouping, Unicode, regex). |

## Requirements

Node 22.18+ (it runs the TypeScript sources directly), Vim 9.1 on `PATH` (the reference for conformance) and Chromium or Chrome for the browser check
(found in `/usr/bin`, or set `CHROMIUM_PATH`).

```bash
npm install
npm run dev                    # web app on http://localhost:3100
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

A step can also say which command made it, which proves the technique a task teaches:
- `keys`: the keys so far end with one of these. A task can require the repeat `.`, playing the
  macro `@q` (or `@@`, with any count before it), or a jump with the mark `` `a ``.
- `fromMode`: the mode the key was pressed in, e.g. a search's `<CR>` comes from the command line.
- `marks`: the marks after the key, so the order "set the mark, then visit" can be judged.
- `line`: the cursor is on this line, at any column.
- `linesAtOnce`: one key changed at least this many lines and kept their number. This proves a
  block operation: typing or deleting line by line never changes more than one line per key.
  Vim fills a block insert's other lines when it ends, the editor fills them while typing, so a
  block insert asks for one line less than the block's height and passes in both.

Each task whose plan card names a technique (a repeat, a macro, a block operation, a mark, a
backward search) has such steps on every text. The tests in `packages/tasks/test/judge.test.ts`
check that the shortcuts to the same text fail. One condition is still checked only indirectly:
the plan wants V078's macro replayed in a fresh buffer. Instead, the final playback must leave the
cursor at the start of the next line, on records whose keys have other lengths.

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
the keys are never stored. For a signed-in player the web app saves the confirmed solve (task, text,
versions, number of keys, time); for guests nothing. Without a running judge the page says the server
check is not available; the solve still counts in training.

`/api/judge` limits checks per client address: a burst of 20, then 30 a minute (`JUDGE_RATE_BURST`,
`JUDGE_RATE_PER_MINUTE`), answering 429 with `Retry-After` beyond that. IPv6 clients are counted per /64.
The address is the last `X-Forwarded-For` entry; behind Cloudflare set `CLIENT_IP_HEADER=cf-connecting-ip`.
The limit lives in the web app's memory, so it assumes one app process.

Each worker thread holds one engine and judges one run at a time from a fresh session; a run over the
time limit is stopped by terminating its worker, which is replaced. The service stores nothing and logs
only the task, the verdict and the time, never the keys. It listens on localhost; the public route sits in
front of it; [`deploy/README.md`](deploy/README.md) installs it as a systemd service next to the web app.
`GET /api/health` on the web app reports the release (commit) and whether the judge answers.

## Accounts

There are no passwords. A player signs in with a link sent by email, with GitHub (OAuth 2.0) or with
Google (OpenID Connect), and may connect more of these to the same account on the account page; a
first sign-in makes the account. A new method whose verified email address another account already
uses does not make a second account: the page says how the player signed in before, so they can sign
in there and connect the new method. Disconnecting the last method is refused; deleting the account
removes it with its methods, sessions and progress.

- **Storage**: one SQLite file through Node's built-in `node:sqlite` (`DATABASE_PATH`, default
  `apps/web/.data/vimchallenge.db` in development). Migrations run when the file is opened
  (`packages/accounts/src/db.ts`).
- **Sessions**: a random 256-bit token in a `HttpOnly`, `SameSite=Lax` cookie (`__Host-` and `Secure` over
  HTTPS); only its SHA-256 is stored. A session ends after 30 days without a visit and after 180 days.
- **Email links** work once, within 15 minutes, and only after the player presses a button on the page
  the link opens (mail scanners open links too). An address gets at most 5 links an hour.
- **GitHub and Google** use the authorization code flow with PKCE (S256) and a one-time state held in
  the database and tied to the browser by a short-lived cookie; Google's ID token is verified (signature,
  issuer, audience, expiry, nonce) with [`jose`](https://github.com/panva/jose). Only verified addresses
  are kept.
- **Forms** (sign-out, account changes, email links) are plain HTML forms posting to `/api/auth/*` and
  `/api/account/*`; each must come from the site's own origin (`PUBLIC_URL`), and sign-in requests are
  rate-limited per client address.

Sign-in methods are configured with `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`,
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `RESEND_API_KEY`/`MAIL_FROM`; the sign-in page offers the
ones that are set. In development, email links are printed to the dev server's log instead of being
sent, so `npm run dev` can sign in without any setup; a production build on a test server over plain
HTTP does the same with `MAIL_TO_LOG=1`. See [`apps/web/.env.example`](apps/web/.env.example).
After a failed check, each unmet goal points to the lesson that teaches it: the task's own lesson, or
one for the mode, selection, register or undo goals.

## Rooms

A room (`/rooms`) gathers up to eight players by an invite link; guests are welcome. Members mark
themselves ready once the editor has loaded, and the host starts a match of one to five rounds
(when the host has been away for a minute, the member who joined first may). The players are fixed
at the start and every round's task and text are drawn then, by level (`level` in `tasks.json`,
from the planning card). Everyone gets the round's task at the same moment, after a countdown.

- **Scoring** (`packages/rooms/src/scoring.ts`, version stored with each match): a solve earns the
  base of its level (100, 160, 240, 360, 520) and up to a quarter more when it comes within the task's
  reference time, shrinking to nothing at twice that time. A round lasts four times the reference time,
  at least a minute, or until everyone has solved or skipped. The table ranks by points, then solves,
  then the time spent on solves in whole seconds; equal players share a place.
- **Keys** go to the server in packets numbered by position while the player types, so a reload or a
  second tab replays them into the editor (`replay` in the browser editor) and carries on with the
  same deadline. **Check** sends the count of keys; the time of a solve is when the server received a
  check with all its keys. While the judge is unavailable the check keeps its time, and the round waits
  15 seconds past its deadline for such checks. A solve closes the attempt; repeating it changes nothing.
- **State** lives in the database and every timed step follows from stored times, so a restart finds
  the same match. The page gets the room as Server-Sent Events (`/api/rooms/{code}/events`, a message
  on each change and every 20 seconds, which also marks the player present), and polls while the
  stream is down. Other players see each other's status during a round and results after it, never keys.
- A signed-in player's solve also counts in their progress. A room and everything in it is deleted a
  week after its last activity.

## Daily challenge and leaderboards

Every UTC day has one official set (`/daily`): five tasks, one per level, on the same texts for
everyone, drawn when the day's first visitor asks (each level's least recently used task, then its
least used text). An account with a verified email address (from any sign-in method) has one go.
For now the sets come from the public bank in `packages/tasks`, so every task and text can be
practised beforehand; a private pool for the league may come later.

- **A run** gives the tasks one at a time: each appears when the player starts it, its clock starts
  then, and it ends when solved, skipped or out of time (four times its reference time, at least a
  minute). Keys, checks, the judge's grace and the points work as in a room. The whole run must end
  within the time of all its tasks from its start (about 17 minutes at most), so a run started just
  before midnight still counts for the day, week and month it started in.
- **An entry** per run and day holds its points, solves, whole seconds on them, and league points:
  `floor(1000 × points / the most the day's tasks can give)` (1725 for a full set; versions of both
  rules are stored with the day). Entries are rebuilt from the attempts, never added to.
- **Tables** (`/leaderboards`): a day ranks by its points, then more solves, then less time; a week
  (from Monday), a month and all time rank by the sum of league points. Equal results share a place.
  A day is settled, and its table final, when its last possible run is over: midnight UTC plus the
  time of its tasks plus the grace. Days, weeks and months are UTC; pages show the boundary in the
  reader's own time zone.
- **Names** appear on the public tables only if the player chose so when starting (or on their account
  page); otherwise they see their own place and nobody else sees them.
- **Corrections**: `node packages/daily/src/admin.ts <database> void <day> <position> <reason>` takes a
  faulty task out of a day for everyone and rebuilds the day's entries, so all four tables follow;
  a day without any task that counts is cancelled. The entries before are kept with the correction
  (`show`, `restore` and `rebuild` too; see the file).
- **Kept**: the keys of each attempt until a week after the day is settled; results with the account.
  Rooms and training never add to the league.

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
