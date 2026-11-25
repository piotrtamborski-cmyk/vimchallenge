/**
 * Headless engine: the browser session (session.ts) driven inside jsdom. Used by the judge
 * (replaying an action log) and by the conformance harness (comparing with reference Vim).
 *
 * Only one session may be live at a time per JS realm (vim-core state is global); run
 * concurrent replays in separate worker threads.
 */
import { JSDOM } from 'jsdom';
import { createSession, type EngineModules, type Session } from './session.ts';
import type { InitialState, Snapshot, Step } from './types.ts';

let dom: JSDOM | undefined;
let mods: Promise<EngineModules> | undefined;
let live: HeadlessSession | undefined;

function installDom(): JSDOM {
  const d = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  const w = d.window as unknown as Record<string, unknown>;
  const g = globalThis as Record<string, unknown>;
  // Event classes must come from jsdom, otherwise jsdom rejects them in dispatchEvent.
  const forced = ['window', 'document', 'Event', 'CustomEvent', 'KeyboardEvent', 'InputEvent', 'FocusEvent'];
  for (const key of forced) g[key] = w[key];
  // Everything else CodeMirror may look up as a global (Window, HTMLElement, getSelection, ...).
  for (const key of Object.getOwnPropertyNames(d.window)) {
    if (key in g) continue;
    try {
      g[key] = w[key];
    } catch {
      // Some jsdom getters (e.g. localStorage on an opaque origin) throw; CodeMirror does not need them.
    }
  }
  // jsdom has no layout engine; CodeMirror only needs these to exist.
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} });
  const proto = d.window.Range.prototype as unknown as Record<string, unknown>;
  proto.getClientRects = () => Object.assign([], { item: () => null });
  proto.getBoundingClientRect = rect;
  return d;
}

async function load(): Promise<EngineModules> {
  dom ??= installDom();
  // Imported only after the DOM globals exist: CodeMirror reads them at module load.
  mods ??= (async () => ({
    state: await import('@codemirror/state'),
    view: await import('@codemirror/view'),
    commands: await import('@codemirror/commands'),
    language: await import('@codemirror/language'),
    vim: await import('@replit/codemirror-vim'),
  }))();
  return mods;
}

export interface HeadlessSession {
  feed(token: string): void;
  snapshot(): Snapshot;
  trail(): readonly Step[];
  destroy(): void;
}

export async function createHeadlessSession(initial: InitialState): Promise<HeadlessSession> {
  const m = await load();
  // A key vim-core throws on is part of the run (see replay); do not print its stack trace.
  (m.vim.Vim as unknown as { suppressErrorLogging: boolean }).suppressErrorLogging = true;
  live?.destroy();
  const parent = dom!.window.document.createElement('div');
  dom!.window.document.body.append(parent);
  const session: Session = createSession(m, parent, initial);
  session.view.focus();
  const headless: HeadlessSession = {
    feed: (token) => session.feed(token),
    snapshot: () => session.snapshot(),
    trail: () => session.trail(),
    destroy() {
      session.destroy();
      parent.remove();
      if (live === headless) live = undefined;
    },
  };
  live = headless;
  return headless;
}

/**
 * Replays a key log from the initial state and returns the trail the judge scores (see
 * `checkGoals`). A key the engine throws on stays in the trail, as it did in the browser.
 * `keepGoing` sees every step and can end the replay early (the judge's limits).
 */
export async function replay(
  initial: InitialState,
  tokens: readonly string[],
  keepGoing: (step: Step) => boolean = () => true,
): Promise<Step[]> {
  const session = await createHeadlessSession(initial);
  try {
    for (const token of tokens) {
      try {
        session.feed(token);
      } catch {
        // The browser reported this key to the player and went on; so does the judge.
      }
      const trail = session.trail();
      if (!keepGoing(trail[trail.length - 1]!)) break;
    }
    return [...session.trail()];
  } finally {
    session.destroy();
  }
}
