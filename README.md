# vimchallenge

Learn a Vim technique, use it in a real editor, then prove it in a contest — all three modes run on the
same versioned tasks and the same judging rules.

Early stage: this repository currently holds the editor engine and the conformance harness that checks
it against real Vim. The web app comes next.

## Layout

| Path | What |
|---|---|
| `packages/engine` | The editing engine: CodeMirror 6 + [`@replit/codemirror-vim`](https://github.com/replit/codemirror-vim), the shared editor profile, key notation and positions. `@vimchallenge/engine/headless` runs the same engine in Node (jsdom) for the server-side judge. |
| `packages/conformance` | Replays every case key by key in reference Vim and in the headless engine and writes [`MATRIX.md`](packages/conformance/MATRIX.md). |
| `packages/conformance/cases` | `plan-bank-v1.json` — the 80 planned tasks with the author's keys; `probes.json` — extra cases aimed at known weak spots (undo grouping, Unicode, regex). |

## Requirements

Node 22+ and Vim 9.1 on `PATH` (the reference for conformance).

```bash
npm install
npm run typecheck
npm test
npm run conformance            # all cases, rewrites packages/conformance/MATRIX.md
npm run conformance -- V033    # selected cases, report in packages/conformance/out/
```

## How conformance works

`packages/conformance/vim/driver.vim` starts Vim with no user config, applies the editor profile and feeds
the keys one at a time from a timer, so each key is handled exactly as if typed. After every key it records
text, mode, cursor, visual selection, registers and marks. The headless engine records the same snapshot,
and the harness reports the first key after which the two differ. Columns are 1-based and count Unicode
code points.

## License

[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). If you run a modified version as a
network service, you must offer its source code to its users.
