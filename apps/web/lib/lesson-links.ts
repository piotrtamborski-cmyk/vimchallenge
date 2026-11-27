/** Lessons a task page offers when an attempt fails: the task's own, and one per kind of goal. */
import { lessonById, lessonsForTask, TOPIC_LESSONS, type Topic } from '@vimchallenge/tasks';
import type { LessonLink, TaskLessons } from './failure-lessons.ts';

/**
 * `taskLesson`: the lesson the task is played in, when there is one. `href` turns a page of the
 * site into its address in the page's language.
 */
export function taskLessons(taskId: string, taskLesson?: string, href: (path: string) => string = (p) => p): TaskLessons {
  const link = (id: string | undefined): LessonLink | undefined => {
    const lesson = id ? lessonById(id) : undefined;
    return lesson && { title: lesson.title, href: href(`/lessons/${lesson.id}`) };
  };
  const topics: Partial<Record<Topic, LessonLink>> = {};
  for (const [topic, id] of Object.entries(TOPIC_LESSONS)) topics[topic as Topic] = link(id);
  return { task: link(taskLesson ?? lessonsForTask(taskId)[0]?.id), topics };
}
