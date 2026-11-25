/**
 * Conformance harness: replays every case in reference Vim and in the headless browser engine,
 * compares the state after every key and writes the compatibility matrix.
 *
 *   npm run conformance              # all cases
 *   npm run conformance -- V033 P001 # selected cases
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseKeys, PROFILE_VERSION } from '@vimchallenge/engine';
import { loadCases, repoRoot, root, type Case } from './cases.ts';
import { runCm } from './cm-run.ts';
import { finalDifferences, goalFailures, stepDifferences, type Difference } from './compare.ts';
import { runVim, type VimRun } from './vim-ref.ts';

type Status = 'match' | 'display-only' | 'diverge' | 'engine-error' | 'card-error' | 'vim-error';

interface Result {
  id: string;
  mvp: boolean;
  keys: string;
  status: Status;
  step?: number;
  token?: string;
  differences: Difference[];
  /** Differences in the final state (empty when only intermediate steps differ). */
  finalDifferences: Difference[];
  vimGoalFailures: string[];
  cmGoalFailures: string[];
  error?: string;
  cmMs: number;
  semanticNotes?: string[];
  /** Labels of the step goals, in order. */
  steps?: string[];
}

/** Installed version of a dependency (read from node_modules: not every package exports package.json). */
const pkg = async (name: string) =>
  JSON.parse(await readFile(`${repoRoot}node_modules/${name}/package.json`, 'utf8')).version as string;

function macroRegisters(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) if (tokens[i] === 'q' && /^[a-z]$/.test(tokens[i + 1]!)) out.add(tokens[i + 1]!);
  return out;
}

async function runCase(c: Case): Promise<{ result: Result; vimVersion?: string }> {
  const tokens = parseKeys(c.keys);
  const base = { id: c.id, mvp: Boolean(c.mvp), keys: c.keys, semanticNotes: c.semanticNotes, steps: c.expected.steps?.map((g) => g.label) };
  let vim: VimRun;
  try {
    vim = await runVim(c.initial, tokens);
  } catch (e) {
    return { result: { ...base, status: 'vim-error', differences: [], finalDifferences: [], vimGoalFailures: [], cmGoalFailures: [], error: (e as Error).message, cmMs: 0 } };
  }
  const cm = await runCm(c.initial, tokens);
  const vimFinal = vim.trail.at(-1)!.snapshot;
  const vimGoalFailures = goalFailures(vim.trail, c.expected);
  const cmGoalFailures = cm.error ? [] : goalFailures(cm.trail, c.expected);
  const result: Result = { ...base, status: 'match', differences: [], finalDifferences: [], vimGoalFailures, cmGoalFailures, cmMs: cm.ms };

  // First key after which the engines differ, and first key only one of them treats as an undo or
  // redo: that decides step goals, so it is a real difference even when the result is the same.
  let changeStep: { step: number; differences: Difference[] } | undefined;
  for (let i = 0; i < cm.trail.length; i++) {
    const diffs = stepDifferences(vim.trail[i]!, cm.trail[i]!);
    if (diffs.length && result.status === 'match')
      Object.assign(result, { status: 'diverge', step: i, token: tokens[i - 1], differences: diffs });
    if (!changeStep && diffs.some((d) => d.field === 'change')) changeStep = { step: i, differences: diffs };
  }
  if (cm.error) {
    if (result.status === 'match')
      Object.assign(result, { status: 'engine-error', step: cm.error.step, token: tokens[cm.error.step - 1] });
    result.error = cm.error.message;
  } else {
    result.finalDifferences = finalDifferences(vimFinal, cm.trail.at(-1)!.snapshot, macroRegisters(tokens));
    if (result.status === 'match' && result.finalDifferences.length)
      Object.assign(result, { status: 'diverge', step: tokens.length, token: tokens.at(-1), differences: result.finalDifferences });
    else if (result.status === 'diverge' && !result.finalDifferences.length) {
      if (changeStep) Object.assign(result, { step: changeStep.step, token: tokens[changeStep.step - 1], differences: changeStep.differences });
      else result.status = 'display-only';
    }
  }
  if (result.status === 'match' && vimGoalFailures.length) result.status = 'card-error';
  return { result, vimVersion: vim.version };
}

const show = (v: unknown) => '`' + JSON.stringify(v ?? null).replaceAll('|', '\\|').replaceAll('`', 'ˋ') + '`';

function keysWithMark(keys: string, step?: number): string {
  if (!step) return '`' + keys + '`';
  const tokens = parseKeys(keys).map((t) => (t === '<Space>' ? '␠' : t));
  const before = tokens.slice(0, step - 1).join('');
  return '`' + before + '` **' + tokens[step - 1] + '** `' + tokens.slice(step).join('') + '`';
}

const LABEL: Record<Status, string> = {
  match: '✅ match',
  'display-only': '🟡 same result, differs while typing',
  diverge: '❌ differs',
  'engine-error': '💥 engine error',
  'card-error': '⚠️ card goal fails in Vim',
  'vim-error': '⚠️ Vim run failed',
};

async function main() {
  const filter = new Set(process.argv.slice(2));
  const cases = await loadCases(filter);
  const results: Result[] = [];
  let vimVersion = '?';
  for (const c of cases) {
    const { result, vimVersion: v } = await runCase(c);
    if (v) vimVersion = v;
    results.push(result);
    const where = result.step !== undefined ? ` after key ${result.step} (${result.token ?? 'start'})` : '';
    console.log(`${result.id.padEnd(5)} ${LABEL[result.status]}${where}`);
  }

  const versions = {
    vim: vimVersion,
    codemirrorVim: await pkg('@replit/codemirror-vim'),
    vimCore: await pkg('@replit/codemirror-vim-core'),
    codemirrorView: await pkg('@codemirror/view'),
    profile: PROFILE_VERSION,
  };
  const counts = Object.fromEntries((Object.keys(LABEL) as Status[]).map((s) => [s, results.filter((r) => r.status === s).length]));
  const cmMs = results.map((r) => r.cmMs).filter(Boolean).sort((a, b) => a - b);
  const median = cmMs[Math.floor(cmMs.length / 2)] ?? 0;

  await mkdir(`${root}out`, { recursive: true });
  await writeFile(`${root}out/report.json`, JSON.stringify({ versions, counts, results }, null, 2) + '\n');

  if (!filter.size) {
    const lines = [
      '# Compatibility matrix',
      '',
      'Generated by `npm run conformance`. Do not edit by hand.',
      '',
      `Reference Vim ${versions.vim} · @replit/codemirror-vim ${versions.codemirrorVim} · vim-core ${versions.vimCore} (vendored fork in packages/vim-core) · @codemirror/view ${versions.codemirrorView} · editor profile v${versions.profile}`,
      '',
      'Each case is replayed key by key in reference Vim and in the headless browser engine. After every key the text, mode and cursor must be equal; at the end visual selection, named registers and marks are compared too. Registers recorded with `q` are not compared (engine-specific key codes). After every key both engines must also agree on whether the key was an undo or a redo. Step goals (`expected.steps`, e.g. "cursor visited the end before the first edit") are judged on both runs; other semantic goals are listed but not judged yet.',
      '',
      `**${counts.match} match · ${counts['display-only']} same result but differ while typing · ${counts.diverge} differ in the result · ${counts['engine-error']} engine errors · ${counts['card-error']} card goal fails in Vim · ${counts['vim-error']} Vim run failed** — of ${results.length} cases.`,
      '',
      '| Case | MVP | Result | Keys (first differing key in bold) | Difference: Vim → browser engine |',
      '|---|---|---|---|---|',
    ];
    for (const r of results) {
      const fmt = (ds: Difference[]) => ds.map((d) => `${d.field}: ${show(d.vim)} → ${show(d.cm)}`).join('<br>');
      let detail = r.error ? show(r.error) : fmt(r.differences);
      if (r.status === 'diverge' && r.finalDifferences.length && r.step !== parseKeys(r.keys).length)
        detail += `<br>**Final state:** ${fmt(r.finalDifferences)}`;
      const goals = r.vimGoalFailures.length ? `<br>Vim misses card goal: ${r.vimGoalFailures.join('; ')}` : '';
      const notes = r.semanticNotes?.length ? `<br>_Semantic goal not judged yet: ${r.semanticNotes.join(' ')}_` : '';
      const steps = r.steps?.length ? `<br>Steps judged: ${r.steps.map((l) => l.replaceAll('|', '\\|')).join(' → ')}` : '';
      lines.push(`| ${r.id} | ${r.mvp ? 'MVP' : ''} | ${LABEL[r.status]} | ${keysWithMark(r.keys, r.status === 'match' ? undefined : r.step)} | ${detail}${goals}${steps}${notes} |`);
    }
    await writeFile(`${root}MATRIX.md`, lines.join('\n') + '\n');
  }
  console.log('\n' + JSON.stringify({ versions, counts, medianCmMs: Number(median.toFixed(1)) }));
}

await main();
