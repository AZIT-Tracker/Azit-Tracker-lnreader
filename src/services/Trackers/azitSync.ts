/**
 * Azit, beyond the tracker itself (like Komikku's Azit tracker):
 *
 * - Auto-link: reading a novel that is already in your Azit links it by itself (no search needed).
 * - Offline queue: progress made while Azit cannot be reached is kept, then sent in one go when it answers again.
 * - Unlinked novels: which library novels are not linked to Azit yet (Settings -> Tracking).
 */
import { getMMKVObject, setMMKVObject, MMKVStorage } from '@utils/mmkv/mmkv';
import { AuthenticationResult, UserListEntry } from './index';
import type { AzitAuthMeta } from './azit';
// Same key as `useTrackedNovel` (not imported: that module loads the trackers, this one is loaded by them).
const TRACKED_NOVEL_PREFIX = 'TRACKED_NOVEL_PREFIX';

const AUTO_LINK_KEY = 'AZIT_AUTO_LINK';
const QUEUE_KEY = 'AZIT_QUEUE';

type AzitAuth = AuthenticationResult<AzitAuthMeta>;
export type QueuedUpdate = {
  mediaId: number;
  title: string;
  payload: Partial<UserListEntry>;
  at: number;
};

/** The Azit login, when LNReader is connected to Azit. */
export const getAzitAuth = (): AzitAuth | undefined =>
  getMMKVObject<Record<string, { auth: AzitAuth }>>('TRACKERS')?.Azit?.auth;

export const azitLinkKey = (novelId: number) =>
  `${TRACKED_NOVEL_PREFIX}_${novelId}_Azit`;
export const isLinkedToAzit = (novelId: number) =>
  MMKVStorage.contains(azitLinkKey(novelId));

/** Auto-link is on unless turned off in Settings -> Tracking. */
export const isAutoLinkOn = () => MMKVStorage.getBoolean(AUTO_LINK_KEY) ?? true;
export const setAutoLink = (value: boolean) =>
  MMKVStorage.set(AUTO_LINK_KEY, value);

// ---- offline queue

export const getQueue = (): QueuedUpdate[] =>
  getMMKVObject<QueuedUpdate[]>(QUEUE_KEY) ?? [];
const saveQueue = (queue: QueuedUpdate[]) =>
  queue.length
    ? setMMKVObject(QUEUE_KEY, queue)
    : MMKVStorage.remove(QUEUE_KEY);

/** Keep an update for later; a newer one for the same novel replaces the older (only the last state matters). */
export function enqueue(update: QueuedUpdate) {
  const queue = getQueue().filter(item => item.mediaId !== update.mediaId);
  const previous = getQueue().find(item => item.mediaId === update.mediaId);
  saveQueue([
    ...queue,
    { ...update, payload: { ...previous?.payload, ...update.payload } },
  ]);
}

/** A network failure (no answer at all), as opposed to Azit refusing the update. */
export const isOffline = (error: unknown) =>
  error instanceof TypeError || /network request failed/i.test(String(error));

const toAzitStatus: Record<string, string> = {
  CURRENT: 'current',
  PLANNING: 'planning',
  COMPLETED: 'completed',
  DROPPED: 'dropped',
  PAUSED: 'paused',
  REPEATING: 'repeating',
};

/** Sends what waited (one request); what Azit refuses is dropped, what still cannot be sent stays. */
export async function flushQueue(auth: AzitAuth): Promise<number> {
  const queue = getQueue();
  if (!queue.length) {
    return 0;
  }
  try {
    const response = await fetch(
      `${auth.meta!.server}/api/tracking/progress/batch`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${auth.accessToken}`,
          'Content-Type': 'application/json',
          'X-Azit-App': 'lnreader',
        },
        body: JSON.stringify({
          updates: queue.map(item => ({
            media_id: item.mediaId,
            title: item.title,
            kind: 'novel',
            create_if_missing: false,
            only_forward: true,
            ...(item.payload.progress !== undefined
              ? { chapter: item.payload.progress }
              : {}),
            ...(item.payload.status
              ? { status: toAzitStatus[item.payload.status] }
              : {}),
            ...(item.payload.score !== undefined
              ? { score: Math.round(item.payload.score) }
              : {}),
          })),
        }),
      },
    );
    if (!response.ok) {
      return 0;
    }
    saveQueue([]);
    return queue.length;
  } catch {
    return 0;
  }
}

// ---- auto-link

type NovelRef = { id: number; name: string; cover?: string | null };

/**
 * Reading a novel not linked yet: when Azit already has it in your library (same title), link it and send the
 * chapter. Nothing is created: a novel not in Azit stays unlinked (link or create it from the tracking sheet).
 */
export async function autoLinkAzit(
  novel: NovelRef,
  chapter: number,
): Promise<boolean> {
  const auth = getAzitAuth();
  if (!auth || !isAutoLinkOn() || isLinkedToAzit(novel.id)) {
    return false;
  }
  try {
    const response = await fetch(`${auth.meta!.server}/api/tracking/lookup`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${auth.accessToken}`,
        'Content-Type': 'application/json',
        'X-Azit-App': 'lnreader',
      },
      body: JSON.stringify({ title: novel.name, kind: 'novel' }),
    });
    const entry = response.ok ? await response.json() : null;
    if (!entry?.media_id) {
      return false;
    }
    const progress = Math.max(
      Math.floor(entry.progress?.chapter ?? 0),
      chapter,
    );
    setMMKVObject(azitLinkKey(novel.id), {
      id: entry.media_id,
      title: entry.title,
      coverImage: entry.cover_url?.startsWith('/')
        ? `${auth.meta!.server}${entry.cover_url}`
        : entry.cover_url ?? '',
      totalChapters: entry.total ?? undefined,
      status: 'CURRENT',
      progress,
      score: entry.score ?? 0,
    });
    if (chapter > Math.floor(entry.progress?.chapter ?? 0)) {
      const { azitTracker } = await import('./azit');
      await azitTracker
        .updateUserListEntry(entry.media_id, { progress: chapter }, auth)
        .catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}
