import { describe, expect, it } from 'vitest';
import { lessons, tasks, validateLessons, validateTasks, type BankTask } from '../src/index.ts';

describe('published content', () => {
  it('every task is well-formed', () => {
    expect(validateTasks(tasks)).toEqual([]);
  });
  it('every lesson is well-formed and every task belongs to a lesson', () => {
    expect(validateLessons(lessons, tasks)).toEqual([]);
  });
});

describe('the checks catch broken cards', () => {
  const good = tasks[0]!;
  const broken = (change: Partial<BankTask>) => validateTasks([{ ...good, ...change }]);

  it('in tasks', () => {
    expect(broken({ id: 'Bad Id' })).toContain('task Bad Id: id must be a lowercase slug');
    expect(broken({ initial: { lines: ['ab'], cursor: [1, 3] } })[0]).toMatch(/initial cursor \[1,3\] is not on the text/);
    expect(broken({ initial: { lines: ['ab'], cursor: [2, 1] } })[0]).toMatch(/not on the text/);
    expect(broken({ prompt: 'Replace the `x.' })[0]).toMatch(/unclosed/);
    expect(broken({ expected: {} })[0]).toMatch(/no goal/);
    expect(broken({ keys: 'x\u0000' })[0]).toMatch(/not a key/);
    expect(broken({ expected: { lines: ['a'], steps: [{ label: 'Only a label' }] } })[0]).toMatch(/no condition/);
    expect(validateTasks([good, good])).toContain(`task ${good.id}: id is used twice`);
    const variant = good.variants![0]!;
    expect(broken({ variants: [{ ...variant, initial: { lines: ['ab'], cursor: [1, 9] } }] })[0]).toMatch(/text 2: initial cursor \[1,9\] is not on the text/);
    expect(broken({ variants: [{ ...variant, prompt: '' }] })[0]).toMatch(/text 2: prompt is empty/);
  });

  it('in lessons', () => {
    const lesson = lessons[2]!;
    const problems = validateLessons([{ ...lesson, tasks: ['no-such-task', lesson.tasks[0]!, lesson.tasks[0]!] }], tasks);
    expect(problems).toContain(`lesson ${lesson.id}: task "no-such-task" is not published`);
    expect(problems).toContain(`lesson ${lesson.id}: lists a task twice`);
    expect(problems.some((p) => p.includes('which is not an earlier lesson'))).toBe(true);
    expect(problems.some((p) => p.endsWith('no lesson practises it'))).toBe(true);
  });
});
