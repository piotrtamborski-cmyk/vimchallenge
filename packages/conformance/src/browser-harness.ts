/** Runs in the page: the real browser editor, driven by Playwright with trusted key events. */
import type { InitialState } from '@vimchallenge/engine';
import { mountEditor, type BrowserEditor } from '@vimchallenge/engine/browser';

let editor: BrowserEditor | undefined;
const rejected: string[] = [];

Object.assign(window, {
  vc: {
    start(initial: InitialState) {
      rejected.length = 0;
      editor = mountEditor(document.getElementById('editor')!, { initial, onRejected: (r) => rejected.push(JSON.stringify(r)) });
    },
    state() {
      const step = editor!.trail().at(-1)!;
      return {
        snapshot: step.snapshot,
        change: step.change ?? null,
        log: [...editor!.log()],
        rejected: [...rejected],
        focused: document.activeElement?.closest('.cm-editor') != null,
      };
    },
  },
});
