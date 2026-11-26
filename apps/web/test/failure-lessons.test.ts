import type { GoalFailure } from '@vimchallenge/engine';
import { describe, expect, it } from 'vitest';
import { lessonsFor } from '../lib/failure-lessons.ts';
import { taskLessons } from '../lib/lesson-links.ts';

const fail = (field: string, want: unknown = null): GoalFailure => ({ field, want, got: null }) as GoalFailure;

describe('lessons for unmet goals', () => {
  it("point to the task's lesson, and to a lesson per technique", () => {
    const lessons = taskLessons('change-a-word');
    expect(lessonsFor([fail('text')], lessons).map((l) => l.href)).toEqual(['/lessons/text-objects']);
    expect(lessonsFor([fail('text'), fail('mode', 'normal')], lessons).map((l) => l.href)).toEqual(['/lessons/text-objects', '/lessons/modes-and-typing']);
    expect(lessonsFor([fail('register a'), fail('visual')], lessons).map((l) => l.href)).toEqual(['/lessons/registers', '/lessons/visual-selection']);
  });

  it('name each lesson once', () => {
    const lessons = taskLessons('undo-a-change');
    const failures = [fail('text'), fail('steps', { label: 'Undo', change: 'undo' })];
    expect(lessonsFor(failures, lessons).map((l) => l.title)).toEqual(['Undo and redo']);
    expect(lessonsFor([fail('steps', { label: 'Visit', cursor: [1, 0] })], taskLessons('visit-the-end-first')).map((l) => l.href)).toEqual(['/lessons/words']);
  });

  it('follow the lesson a task is practised in', () => {
    expect(taskLessons('open-a-line-below', 'lines').task?.href).toBe('/lessons/lines');
    expect(taskLessons('open-a-line-below').task?.href).toBe('/lessons/modes-and-typing');
  });
});
