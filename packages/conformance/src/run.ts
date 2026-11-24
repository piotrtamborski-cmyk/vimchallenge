/**
 * Conformance harness: replays every case in reference Vim and in the headless browser engine,
 * compares the state after every key and writes the compatibility matrix.
 *
 *   npm run conformance              # all cases
 *   npm run conformance -- V033 P001 # selected cases
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseKeys, PROFILE_VERSION, type InitialState, type Snapshot } from '@vimchallenge/engine';
import { runCm } from './cm-run.ts';
import { finalDifferences, goalFailures, stepDifferences, type Difference, type Expected } from './compare.ts';
import { runVim } from './vim-ref.ts';

interface Case {
  id: string;
  source: string;
  mvp?: boolean;
  title?: string;
  prompt?: string;
  keys: string;
  initial: InitialState;
  expected: Expected;
  semanticNotes?: string[];
}

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
}

const root = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
/** Installed version of a dependency (read from node_modules: not every package exports package.json). */
const pkg = async (name: string) =>
  JSON.parse(await readFile(`${repoRoot}node_modules/${name}/package.json`, 'utf8')).version as string;

async function loadCases(): Promise<Case[]> {
  const dir = `${root}cases/`;
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const all: Case[] = [];
  for (const f of files) all.push(...(JSON.parse(await readFile(dir + f, 'utf8')) as Case[]));
  return all;
}

function macroRegisters(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) if (tokens[i] === 'q' && /^[a-z]$/.test(tokens[i + 1]!)) out.add(tokens[i + 1]!);
  return out;
}

async function runCase(c: Case): Promise<{ result: Result; vimVersion?: string }> {
  const tokens = parseKeys(c.keys);
  const base = { id: c.id, mvp: Boolean(c.mvp), keys: c.keys, semanticNotes: c.semanticNotes };
  let vim: { version: string; snapshots: Snapshot[] };
  try {
    vim = await runVim(c.initial, tokens);
  } catch (e) {
    return { result: { ...base, status: 'vim-error', differences: [], finalDifferences: [], vimGoalFailures: [], cmGoalFailures: [], error: (e as Error).message, cmMs: 0 } };
  }
  const cm = await runCm(c.initial, tokens);
  const vimFinal = vim.snapshots.at(-1)!;
  const vimGoalFailures = goalFailures(vimFinal, c.expected);
  const cmGoalFailures = cm.error ? [] : goalFailures(cm.snapshots.at(-1)!, c.expected);
  const result: Result = { ...base, status: 'match', differences: [], finalDifferences: [], vimGoalFailures, cmGoalFailures, cmMs: cm.ms };

  for (let i = 0; i < cm.snapshots.length; i++) {
    const diffs = stepDifferences(vim.snapshots[i]!, cm.snapshots[i]!, tokens[i - 1]);
    if (diffs.length) {
      Object.assign(result, { status: 'diverge', step: i, token: tokens[i - 1], differences: diffs });
      break;
    }
  }
  if (cm.error) {
    if (result.status === 'match')
      Object.assign(result, { status: 'engine-error', step: cm.error.step, token: tokens[cm.error.step - 1] });
    result.error = cm.error.message;
  } else {
    result.finalDifferences = finalDifferences(vimFinal, cm.snapshots.at(-1)!, macroRegisters(tokens));
    if (result.status === 'match' && result.finalDifferences.length)
      Object.assign(result, { status: 'diverge', step: tokens.length, token: tokens.at(-1), differences: result.finalDifferences });
    else if (result.status === 'diverge' && !result.finalDifferences.length) result.status = 'display-only';
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
  const cases = (await loadCases()).filter((c) => !filter.size || filter.has(c.id));
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
      'Each case is replayed key by key in reference Vim and in the headless browser engine. After every key the text, mode and cursor must be equal; at the end visual selection, named registers and marks are compared too. Registers recorded with `q` are not compared (engine-specific key codes). Semantic goals (e.g. "cursor visited the end before the first edit") are listed but not judged yet.',
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
      lines.push(`| ${r.id} | ${r.mvp ? 'MVP' : ''} | ${LABEL[r.status]} | ${keysWithMark(r.keys, r.status === 'match' ? undefined : r.step)} | ${detail}${goals}${notes} |`);
    }
    await writeFile(`${root}MATRIX.md`, lines.join('\n') + '\n');
  }
  console.log('\n' + JSON.stringify({ versions, counts, medianCmMs: Number(median.toFixed(1)) }));
}

await main();
