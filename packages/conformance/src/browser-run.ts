/**
 * Browser leg of the conformance check: types every case into the real browser editor in
 * Chromium (trusted key events, real layout, real focus handling), then replays the key log the
 * browser recorded in the headless judge and compares the state after every key.
 * Together with the matrix (judge vs reference Vim) this checks browser = judge = Vim.
 *
 *   npm run conformance:browser              # all cases
 *   npm run conformance:browser -- V033      # selected cases
 *   CHROMIUM_PATH=/path/to/chrome npm run conformance:browser
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { parseKeys, sameValue, type Change, type InitialState, type Snapshot, type Step } from '@vimchallenge/engine';
import { loadCases, root } from './cases.ts';
import { runCm } from './cm-run.ts';

const NAMED: Record<string, string> = {
  '<Esc>': 'Escape', '<CR>': 'Enter', '<BS>': 'Backspace', '<Tab>': 'Tab', '<Del>': 'Delete', '<Space>': 'Space',
  '<Up>': 'ArrowUp', '<Down>': 'ArrowDown', '<Left>': 'ArrowLeft', '<Right>': 'ArrowRight',
};
const CTRL_KEYS: Record<string, string> = {
  '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '^': 'Shift+Digit6', '_': 'Shift+Minus', '@': 'Shift+Digit2',
};

async function press(page: Page, token: string) {
  const named = NAMED[token];
  if (named) return page.keyboard.press(named);
  const ctrl = /^<C-(.)>$/.exec(token);
  if (ctrl) return page.keyboard.press(`Control+${CTRL_KEYS[ctrl[1]!] ?? ctrl[1]}`);
  // US-layout characters are real key presses; anything else arrives as text input (like an IME or AltGr).
  if (/^[\x21-\x7e]$/.test(token)) return page.keyboard.press(token);
  return page.keyboard.insertText(token);
}

function findChromium(): string {
  const candidates = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('No Chromium found; set CHROMIUM_PATH');
  return found;
}

/** Browser-only input paths: each must leave a log that the judge replays to the same state. */
const SCENARIOS: { id: string; initial: InitialState; run(page: Page): Promise<void>; expect(s: BrowserState): string[] }[] = [
  {
    id: 'browser:click-does-not-move-cursor',
    initial: { lines: ['hello world'], cursor: [1, 1] },
    async run(page) {
      const box = (await page.locator('.cm-line').first().boundingBox())!;
      await page.mouse.click(box.x + box.width - 5, box.y + box.height / 2);
      await page.keyboard.press('x');
    },
    expect: (s) => check(s, { log: ['x'], lines: ['ello world'], focused: true }),
  },
  {
    id: 'browser:paste-in-insert-mode',
    initial: { lines: ['ab'], cursor: [1, 1] },
    async run(page) {
      await page.keyboard.press('i');
      await page.evaluate(() => {
        const data = new DataTransfer();
        data.setData('text/plain', 'x y\n');
        document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      });
    },
    expect: (s) => check(s, { log: ['i', 'x', '<Space>', 'y', '<CR>'], lines: ['x y', 'ab'] }),
  },
  {
    id: 'browser:paste-in-normal-mode-is-refused',
    initial: { lines: ['ab'], cursor: [1, 1] },
    async run(page) {
      await page.evaluate(() => {
        const data = new DataTransfer();
        data.setData('text/plain', 'dd');
        document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      });
    },
    expect: (s) => check(s, { log: [], lines: ['ab'], rejected: 1 }),
  },
  {
    id: 'browser:leaving-the-command-line-is-esc',
    initial: { lines: ['abc'], cursor: [1, 1] },
    async run(page) {
      await page.keyboard.type(':s/a/X');
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    },
    expect: (s) => check(s, { log: [':', 's', '/', 'a', '/', 'X', '<Esc>'], lines: ['abc'], mode: 'normal' }),
  },
  {
    id: 'browser:esc-tab-leaves-the-editor',
    initial: { lines: ['abc'], cursor: [1, 2] },
    async run(page) {
      await page.keyboard.press('i');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Tab');
    },
    expect: (s) => check(s, { log: ['i', '<Esc>'], focused: false, mode: 'normal' }),
  },
  {
    id: 'browser:tab-inside-a-command-is-a-key',
    initial: { lines: ['abc'], cursor: [1, 1] },
    async run(page) {
      await page.keyboard.press('i');
      await page.keyboard.press('Tab');
    },
    expect: (s) => check(s, { log: ['i', '<Tab>'], focused: true }),
  },
  {
    id: 'browser:unsupported-key-is-refused',
    initial: { lines: ['abc'], cursor: [1, 2] },
    async run(page) {
      await page.keyboard.press('End');
      await page.keyboard.press('Shift+ArrowRight');
    },
    expect: (s) => check(s, { log: [], rejected: 2 }),
  },
];

function check(s: BrowserState, want: { log: string[]; lines?: string[]; mode?: string; focused?: boolean; rejected?: number }): string[] {
  const out: string[] = [];
  if (!sameValue(s.log, want.log)) out.push(`log ${JSON.stringify(s.log)}, want ${JSON.stringify(want.log)}`);
  if (want.lines && !sameValue(s.snapshot.lines, want.lines)) out.push(`text ${JSON.stringify(s.snapshot.lines)}`);
  if (want.mode && s.snapshot.mode !== want.mode) out.push(`mode ${s.snapshot.mode}`);
  if (want.focused !== undefined && s.focused !== want.focused) out.push(`focus in editor: ${s.focused}`);
  if (want.rejected !== undefined && s.rejected.length !== want.rejected) out.push(`rejected ${JSON.stringify(s.rejected)}`);
  return out;
}

interface BrowserState {
  snapshot: Snapshot;
  /** What the last key did to the text (see classifyChange). */
  change: Change | null;
  log: string[];
  rejected: string[];
  focused: boolean;
}

/** What the judge scores after a key: the state and what the key did. */
const judged = (s: BrowserState | Step) => ({ snapshot: s.snapshot, change: s.change ?? null });

interface Outcome {
  id: string;
  ok: boolean;
  problem?: string;
}

async function main() {
  const filter = new Set(process.argv.slice(2));
  const cases = await loadCases(filter);
  const bundle = await build({
    entryPoints: [`${root}src/browser-harness.ts`],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'error',
  });
  const browser = await chromium.launch({ executablePath: findChromium() });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body><div id="editor"></div></body></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });

  const outcomes: Outcome[] = [];
  for (const c of cases) {
    const tokens = parseKeys(c.keys);
    await page.evaluate((initial) => (window as any).vc.start(initial), c.initial);
    const states: BrowserState[] = [await page.evaluate(() => (window as any).vc.state())];
    for (const token of tokens) {
      await press(page, token);
      states.push(await page.evaluate(() => (window as any).vc.state()));
    }
    const last = states.at(-1)!;
    const outcome: Outcome = { id: c.id, ok: true };
    const fail = (problem: string) => Object.assign(outcome, { ok: false, problem });

    if (!sameValue(last.log, tokens)) {
      const i = tokens.findIndex((t, k) => last.log[k] !== t);
      fail(`browser logged ${JSON.stringify(last.log)}; typed ${JSON.stringify(tokens)} (first difference at key ${i + 1}; focus in editor: ${last.focused}; rejected: ${JSON.stringify(last.rejected)})`);
    }
    // The judge replays what the browser logged.
    const judge = await runCm(c.initial, last.log);
    if (judge.error) fail(`judge error at key ${judge.error.step}: ${judge.error.message}`);
    else if (outcome.ok) {
      for (let i = 0; i < states.length; i++) {
        if (!sameValue(judged(states[i]!), judged(judge.trail[i]!))) {
          fail(`after key ${i} (${tokens[i - 1] ?? 'start'}): browser ${JSON.stringify(judged(states[i]!))} judge ${JSON.stringify(judged(judge.trail[i]!))}`);
          break;
        }
      }
    } else if (!sameValue(judged(last), judged(judge.trail.at(-1)!))) {
      outcome.problem += `; final state differs: browser ${JSON.stringify(judged(last))} judge ${JSON.stringify(judged(judge.trail.at(-1)!))}`;
    }
    outcomes.push(outcome);
    if (!outcome.ok) console.log(`${c.id.padEnd(5)} ❌ ${outcome.problem}`);
  }
  for (const sc of SCENARIOS) {
    await page.evaluate((initial) => (window as any).vc.start(initial), sc.initial);
    await sc.run(page);
    const state: BrowserState = await page.evaluate(() => (window as any).vc.state());
    const judge = await runCm(sc.initial, state.log);
    const problems = sc.expect(state);
    if (!sameValue(judged(state), judged(judge.trail.at(-1)!)))
      problems.push(`judge disagrees: browser ${JSON.stringify(judged(state))} judge ${JSON.stringify(judged(judge.trail.at(-1)!))}`);
    const outcome: Outcome = problems.length ? { id: sc.id, ok: false, problem: problems.join('; ') } : { id: sc.id, ok: true };
    outcomes.push(outcome);
    if (!outcome.ok) console.log(`${sc.id} ❌ ${outcome.problem}`);
  }
  await browser.close();

  const failed = outcomes.filter((o) => !o.ok);
  await mkdir(`${root}out`, { recursive: true });
  await writeFile(`${root}out/browser-report.json`, JSON.stringify({ browser: browser.version(), outcomes }, null, 2) + '\n');
  console.log(`\n${outcomes.length - failed.length}/${outcomes.length} cases and browser scenarios: browser and judge agree (${browser.version()})`);
  if (failed.length) process.exitCode = 1;
}

await main();
