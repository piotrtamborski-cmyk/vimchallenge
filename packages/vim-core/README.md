# vim-core (vendored fork)

This directory is a copy of [`@replit/codemirror-vim-core`](https://www.npmjs.com/package/@replit/codemirror-vim-core)
0.1.0, the editor-agnostic Vim engine used by `@replit/codemirror-vim`. The workspace package keeps the upstream
name, so npm links it in place of the published package and the CodeMirror 6 adapter uses it unchanged.

The first commit that adds this directory is the unmodified upstream release; every later commit is a fix found by
`npm run conformance` (see `packages/conformance/MATRIX.md`). `git diff <first commit> -- packages/vim-core` is the
patch set to offer upstream.

This directory stays under the upstream MIT license (see `LICENSE`), unlike the rest of the repository.

---

# @replit/codemirror-vim-core

The editor-agnostic vim engine behind [`@replit/codemirror-vim`](https://www.npmjs.com/package/@replit/codemirror-vim) (CodeMirror 6) and [`cm5-vim`](https://www.npmjs.com/package/cm5-vim) (CodeMirror 5).

It implements vim's modal editing — motions, operators, actions, registers, marks, macros, and ex commands — against a CodeMirror-5-style editor interface (see `CM5EditorInterface` in the type definitions). You most likely want one of the packages above rather than this one directly; use this package if you're building your own editor adapter.

```js
import { initVim } from "@replit/codemirror-vim-core"

const Vim = initVim(CodeMirror) // a CM5-style editor constructor
```

The shared vim test suite (700+ tests) ships at `@replit/codemirror-vim-core/test/vim_test.js`.

## Credits

This engine was originally authored by [@mightyguava](https://github.com/mightyguava) (Yunchi Luo) as part of [CodeMirror](https://github.com/codemirror/dev), before being extracted and maintained in [replit/codemirror-vim](https://github.com/replit/codemirror-vim).
