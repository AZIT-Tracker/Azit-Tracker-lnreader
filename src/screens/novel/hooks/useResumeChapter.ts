import { useEffect, useState } from 'react';
import { ChapterInfo } from '@database/types';
import { getChapter, getNextChapter } from '@database/queries/ChapterQueries';

/**
 * The chapter "Continue reading" opens: the last read chapter, or the one after
 * it once it is finished. The stored last-read chapter is a snapshot taken when
 * it was opened, so its read state is looked up again in the database.
 * `chapters` is only a trigger: the list reloads after reading.
 */
export const useResumeChapter = (
  lastRead: ChapterInfo | undefined,
  chapters: ChapterInfo[],
): ChapterInfo | undefined => {
  const [resume, setResume] = useState<ChapterInfo | undefined>(lastRead);

  useEffect(() => {
    let cancelled = false;
    const resolve = async (): Promise<ChapterInfo | undefined> => {
      if (!lastRead) return undefined;
      const current = (await getChapter(lastRead.id)) as
        | ChapterInfo
        | undefined;
      if (!current || current.unread !== false) {
        return current ?? lastRead;
      }
      const next = (await getNextChapter(
        current.novelId,
        current.position ?? 0,
        current.page ?? '1',
      )) as ChapterInfo | undefined;
      return next ?? current;
    };
    resolve()
      .then(chapter => {
        if (!cancelled) setResume(chapter);
      })
      .catch(() => {
        if (!cancelled) setResume(lastRead);
      });
    return () => {
      cancelled = true;
    };
  }, [lastRead, chapters]);

  return resume;
};
