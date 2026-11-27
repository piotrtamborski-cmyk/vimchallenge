/**
 * Checks of the published tasks and lessons that need no editor: the shape and consistency of
 * every card. Whether a task's solution reaches its goals is checked by replaying it, in reference
 * Vim (npm run conformance) and in the judge (test/judge.test.ts).
 */
import { isToken, parseKeys, toCh, type Pos, type TaskVariant } from '@vimchallenge/engine';
import { LEVEL_BASE, planLevel, type BankTask } from './index.ts';
import { TOPIC_LESSONS, type Lesson } from './lessons.ts';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const balancedCode = (text: string) => (text.match(/`/g)?.length ?? 0) % 2 === 0;

/** A position inside the text: an existing line, and a column on a character of it (or 1 on an empty line). */
function cursorOnText(lines: string[], [line, col]: Pos): boolean {
  const text = lines[line - 1];
  if (text === undefined || !Number.isInteger(col) || col < 1) return false;
  return col === 1 || toCh(text, col) < text.length;
}

export function validateTasks(tasks: readonly BankTask[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const t of tasks) {
    const at = (msg: string) => problems.push(`task ${t.id}: ${msg}`);
    if (!SLUG.test(t.id)) at('id must be a lowercase slug');
    if (seen.has(t.id)) at('id is used twice');
    seen.add(t.id);
    if (!Number.isInteger(t.version) || t.version < 1) at('version must be a positive integer');
    if (!t.title.trim()) at('title is empty');
    if (t.referenceSeconds !== undefined && !(t.referenceSeconds > 0)) at('referenceSeconds must be positive');
    if (!LEVEL_BASE[t.level]) at('level must be 1 to 5');
    else if (t.plan && /^V\d{3}$/.test(t.plan) && planLevel(t.plan) !== t.level) at(`level ${t.level} differs from card ${t.plan} (level ${planLevel(t.plan)})`);
    checkText(t, at);
    for (const [i, v] of (t.variants ?? []).entries()) checkText(v, (msg) => at(`text ${i + 2}: ${msg}`));
  }
  return problems;
}

/** One text of a task (the task itself or a variant): prompt, start, solution keys and goals. */
function checkText(t: TaskVariant, at: (msg: string) => void) {
  if (!t.prompt?.trim()) at('prompt is empty');
  else if (!balancedCode(t.prompt)) at('prompt has an unclosed ` code span');
  if (!t.initial.lines.length || t.initial.lines.some((l) => typeof l !== 'string' || l.includes('\n')))
    at('initial.lines must be one string per line');
  if (!cursorOnText(t.initial.lines, t.initial.cursor)) at(`initial cursor ${JSON.stringify(t.initial.cursor)} is not on the text`);
  const keys = parseKeys(t.keys ?? '');
  if (!keys.length) at('keys are empty');
  const bad = keys.find((k) => !isToken(k));
  if (bad !== undefined) at(`keys contain ${JSON.stringify(bad)}, which is not a key`);
  const e = t.expected;
  if (!Object.keys(e).length) at('expected declares no goal');
  if (e.lines && e.lines.some((l) => typeof l !== 'string' || l.includes('\n'))) at('expected.lines must be one string per line');
  if (e.cursor && e.lines && !cursorOnText(e.lines, e.cursor)) at(`expected cursor ${JSON.stringify(e.cursor)} is not on the text`);
  for (const [i, s] of (e.steps ?? []).entries()) {
    if (!s.label?.trim()) at(`step ${i + 1} has no label`);
    else if (!balancedCode(s.label)) at(`step ${i + 1} label has an unclosed \` code span`);
    if (Object.keys(s).length === 1) at(`step ${i + 1} has no condition besides its label`);
    for (const k of s.keys ?? []) {
      const tokens = parseKeys(k);
      if (!tokens.length || tokens.some((x) => !isToken(x))) at(`step ${i + 1} keys ${JSON.stringify(k)} are not keys`);
    }
    if (s.keys && !s.keys.length) at(`step ${i + 1} lists no keys`);
    if (s.linesAtOnce !== undefined && !(Number.isInteger(s.linesAtOnce) && s.linesAtOnce > 0)) at(`step ${i + 1} linesAtOnce must be a positive integer`);
    if (s.line !== undefined && !(Number.isInteger(s.line) && s.line > 0)) at(`step ${i + 1} line must be a positive integer`);
  }
}

export function validateLessons(lessons: readonly Lesson[], tasks: readonly BankTask[]): string[] {
  const problems: string[] = [];
  const taskIds = new Set(tasks.map((t) => t.id));
  const earlier = new Set<string>();
  const practised = new Set<string>();
  for (const l of lessons) {
    const at = (msg: string) => problems.push(`lesson ${l.id}: ${msg}`);
    if (!SLUG.test(l.id)) at('id must be a lowercase slug');
    if (earlier.has(l.id)) at('id is used twice');
    for (const r of l.requires) if (!earlier.has(r)) at(`requires "${r}", which is not an earlier lesson`);
    if (!l.title.trim() || !l.summary.trim() || !l.section.trim()) at('title, summary and section must not be empty');
    if (!l.body.length) at('body is empty');
    for (const text of [l.summary, ...l.body]) if (!balancedCode(text)) at(`unclosed \` code span in "${text.slice(0, 40)}…"`);
    if (!l.keys.length) at('teaches no keys');
    if (!l.tasks.length) at('has no tasks');
    if (new Set(l.tasks).size !== l.tasks.length) at('lists a task twice');
    for (const id of l.tasks) {
      if (!taskIds.has(id)) at(`task "${id}" is not published`);
      practised.add(id);
    }
    earlier.add(l.id);
  }
  for (const t of tasks) if (!practised.has(t.id)) problems.push(`task ${t.id}: no lesson practises it`);
  for (const [topic, id] of Object.entries(TOPIC_LESSONS))
    if (!earlier.has(id)) problems.push(`topic ${topic}: lesson "${id}" does not exist`);
  return problems;
}
