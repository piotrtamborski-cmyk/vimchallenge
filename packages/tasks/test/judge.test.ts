/**
 * The judge on published tasks: every solution passes, and for tasks with step goals a key log
 * that reaches the same final text without the required steps fails.
 */
import { checkGoals, parseKeys, type GoalFailure } from '@vimchallenge/engine';
import { replay } from '@vimchallenge/engine/headless';
import { describe, expect, it } from 'vitest';
import { onText, taskById, tasks, textCount } from '../src/index.ts';

async function judge(id: string, keys: string): Promise<GoalFailure[]> {
  const task = taskById(id)!;
  return checkGoals(await replay(task.initial, parseKeys(keys)), task.expected);
}

const missingStep = (failures: GoalFailure[]) =>
  failures.map((f) => (f.field === 'steps' ? (f.want as { label: string }).label : `${f.field} failed`));

describe('published solutions', () => {
  const texts = tasks.flatMap((t) => Array.from({ length: textCount(t) }, (_, i) => [t.id, i + 1, onText(t, i + 1)!.keys] as const));
  it.each(texts)('%s, text %i: %s passes', async (id, n, keys) => {
    const task = onText(taskById(id)!, n)!;
    expect(checkGoals(await replay(task.initial, parseKeys(keys)), task.expected)).toEqual([]);
  });
});

describe('undo-a-change', () => {
  it('accepts other ways to undo the deletion', async () => {
    expect(await judge('undo-a-change', 'xxuu')).toEqual([]);
    expect(await judge('undo-a-change', 'x:u<CR>')).toEqual([]);
  });
  it('rejects typing the `!` again', async () => {
    expect(missingStep(await judge('undo-a-change', 'xa!<Esc>'))).toEqual(['Undo the deletion to get the `!` back.']);
  });
  it('rejects undoing some other edit', async () => {
    expect(missingStep(await judge('undo-a-change', 'ix<Esc>u'))).toEqual(['Delete the `!`.']);
  });
  it('rejects doing nothing, though the text already matches', async () => {
    expect(missingStep(await judge('undo-a-change', ''))).toEqual(['Delete the `!`.']);
  });
});

describe('visit-the-end-first', () => {
  const step = 'Move to the last character of the document before your first edit.';
  it('accepts another way to the end', async () => {
    expect(await judge('visit-the-end-first', 'GA<Esc>bbciwnew<Esc>')).toEqual([]);
  });
  it('rejects the same text reached without visiting the end', async () => {
    expect(missingStep(await judge('visit-the-end-first', 'jwwwciwnew<Esc>'))).toEqual([step]);
  });
  it('rejects visiting the end only after the edit', async () => {
    expect(missingStep(await judge('visit-the-end-first', 'jwwwciwnew<Esc>G$'))).toEqual([step]);
  });
});

/** The ten tasks whose technique is judged: another way that uses it passes, the shortcuts do not. */
describe('return-to-a-mark', () => {
  it('accepts another way to the last line', async () => {
    expect(await judge('return-to-a-mark', 'majj`a')).toEqual([]);
  });
  it('rejects walking back instead of jumping to the mark', async () => {
    expect(missingStep(await judge('return-to-a-mark', 'maGggl'))).toEqual(['Then jump back to exactly that letter with the mark: a backtick, then `a`.']);
  });
  it('rejects setting the mark only after the visit', async () => {
    expect(missingStep(await judge('return-to-a-mark', 'Ggglma`a'))).toEqual(['Then visit the last line.']);
  });
});

describe('repeat-a-change', () => {
  const step = 'Make the last change by repeating the first one with `.`.';
  it('accepts another way to the second word', async () => {
    expect(await judge('repeat-a-change', 'wciwblue<Esc>j.')).toEqual([]);
  });
  it('rejects typing the second change again', async () => {
    expect(missingStep(await judge('repeat-a-change', '/red<CR>ciwblue<Esc>nciwblue<Esc>'))).toEqual([step]);
  });
  it('rejects a repeat that is undone', async () => {
    expect(missingStep(await judge('repeat-a-change', '/red<CR>ciwblue<Esc>nciwblue<Esc>0.u'))).toEqual([step]);
  });
});

describe('insert-in-a-column', () => {
  const step = 'Insert into every line at once: select the column with `<C-v>`, then `I`.';
  it('accepts another block of the same lines', async () => {
    expect(await judge('insert-in-a-column', '<C-v>GI# <Esc>')).toEqual([]);
  });
  it('rejects inserting line by line', async () => {
    expect(missingStep(await judge('insert-in-a-column', 'I# <Esc>jI# <Esc>jI# <Esc>'))).toEqual([step]);
  });
  it('rejects a substitution', async () => {
    expect(missingStep(await judge('insert-in-a-column', ':%s/^/# /<CR>'))).toEqual([step]);
  });
  it('rejects a block insert on only some of the lines', async () => {
    expect(missingStep(await judge('insert-in-a-column', '<C-v>jI# <Esc>GI# <Esc>'))).toEqual([step]);
  });
});

describe('delete-a-column', () => {
  it('accepts d on the block', async () => {
    expect(await judge('delete-a-column', '<C-v>jjd')).toEqual([]);
  });
  it('rejects deleting letter by letter', async () => {
    expect(missingStep(await judge('delete-a-column', 'xjxjx'))).toEqual(['Delete the whole column with one key on a block selection (`<C-v>`).']);
  });
});

describe('record-a-macro', () => {
  const step = 'Make the last change by playing the macro with `@q`.';
  it('accepts playing it twice, the second time with @@', async () => {
    expect(await judge('record-a-macro', 'qqI- <Esc>jq@q@@')).toEqual([]);
  });
  it('rejects recording the macro and then typing the rest', async () => {
    expect(missingStep(await judge('record-a-macro', 'qqI- <Esc>jqI- <Esc>jI- <Esc>'))).toEqual([step]);
  });
  it('rejects typing `@q` in Insert mode', async () => {
    expect(missingStep(await judge('record-a-macro', 'I- <Esc>jI- <Esc>jI- @q<BS><BS><Esc>'))).toEqual([step]);
  });
});

describe('search-backwards', () => {
  it('rejects moving up instead of searching', async () => {
    expect(missingStep(await judge('search-backwards', 'kkgg'))).toEqual(['Search backwards with `?` from the end: the first hit is the `ERR` on line 3.']);
  });
  it('rejects jumping to the line instead of repeating the search', async () => {
    expect(missingStep(await judge('search-backwards', ':3<CR>gg'))).toEqual(['Then repeat the search with `n` to the `ERR` on line 1.']);
  });
});

describe('macro-on-records', () => {
  it('rejects one substitution for all records', async () => {
    expect(missingStep(await judge('macro-on-records', ':%s/^\\([^:]*\\):\\(.*\\)$/\\2 (\\1)/<CR>'))).toEqual([
      'Make the last change by playing the macro with `@a`.',
    ]);
  });
});

describe('number-a-column', () => {
  it('rejects counting up line by line', async () => {
    expect(missingStep(await judge('number-a-column', '<C-a>j<C-a><C-a>j<C-a><C-a><C-a>'))).toEqual([
      'Number every line at once with `g<C-a>` on a block selection (`<C-v>`) of the zeros.',
    ]);
  });
});

describe('change-a-block', () => {
  const step = 'Change the digits of every line at once with `c` on one block selection (`<C-v>`).';
  it('accepts s on the block', async () => {
    expect(await judge('change-a-block', '<C-v>2jls--<Esc>')).toEqual([]);
  });
  it('rejects a substitution', async () => {
    expect(missingStep(await judge('change-a-block', ':2,4s/\\d\\d/--/<CR>'))).toEqual([step]);
  });
  it('rejects deleting the block and typing line by line', async () => {
    expect(missingStep(await judge('change-a-block', '<C-v>2jldi--<Esc>j0li--<Esc>j0li--<Esc>'))).toEqual([step]);
  });
});

describe('macro-for-key-values', () => {
  const step = 'Make the last change by playing the macro with `@a`, which ends at the start of the next line.';
  it('rejects one substitution for all records', async () => {
    expect(missingStep(await judge('macro-for-key-values', ':%s/: /=/<CR>'))).toEqual([step]);
  });
  it('rejects a macro that does not end at the start of the next line', async () => {
    expect(missingStep(await judge('macro-for-key-values', 'qa0f:r=lxjq2@a'))).toEqual([step]);
  });
});
