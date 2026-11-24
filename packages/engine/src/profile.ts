/**
 * Editor profile shared by every card: indent 2 spaces,
 * tab width 4, no auto-indent, first match per line, case-sensitive search, decimal numbers.
 * The reference Vim gets the same profile in packages/conformance/vim/driver.vim.
 */
import type { Extension } from '@codemirror/state';

export const PROFILE_VERSION = 1;

export function editorProfileExtensions(m: {
  state: typeof import('@codemirror/state');
  commands: typeof import('@codemirror/commands');
  language: typeof import('@codemirror/language');
}): Extension[] {
  return [
    m.commands.history(),
    // Visual-block commands (<C-v>…I, x, c) work on one selection range per line.
    m.state.EditorState.allowMultipleSelections.of(true),
    m.state.EditorState.tabSize.of(4),
    m.language.indentUnit.of('  '),
  ];
}

/** Global vim-core options. Call after every reset of vim-core global state. */
export function applyVimProfile(Vim: { setOption(name: string, value: unknown): void }): void {
  // Vim regex syntax (\(, \+, \<) instead of JavaScript regex syntax.
  Vim.setOption('pcre', false);
  // CTRL-A / CTRL-X work on decimal numbers only ("007" is seven, not octal).
  Vim.setOption('nrformats', '');
}
