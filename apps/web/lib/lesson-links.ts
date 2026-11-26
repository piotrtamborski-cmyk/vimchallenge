/** Lessons a task page offers when an attempt fails: the task's own, and one per kind of goal. */
import { lessonById, lessonsForTask, TOPIC_LESSONS, type Topic } from '@vimchallenge/tasks';
import type { LessonLink, TaskLessons } from './failure-lessons.ts';

const link = (id: string | undefined): LessonLink | undefined => {
  const lesson = id ? lessonById(id) : undefined;
  return lesson && { title: lesson.title, href: `/lessons/${lesson.id}` };
};

export function taskLessons(taskId: string, taskLesson?: string): TaskLessons {
  const topics: Partial<Record<Topic, LessonLink>> = {};
  for (const [topic, id] of Object.entries(TOPIC_LESSONS)) topics[topic as Topic] = link(id);
  return { task: link(taskLesson ?? lessonsForTask(taskId)[0]?.id), topics };
}
