/**
 * Azit Tracker (self-hosted): the novels read here are tracked in your own Azit.
 *
 * Login is the site's address and a device token (Azit -> Settings -> Devices, type "LNReader"). LNReader only ever
 * sends and reads novels: it says who it is (`X-Azit-App: lnreader`) and Azit keeps it to novel types, so it never
 * touches the manga Komikku tracks (and Komikku never touches these novels).
 */
import { enqueue, flushQueue, isOffline } from './azitSync';
import { cacheDirectory, downloadAsync } from 'expo-file-system/legacy';
import {
  AuthenticationResult,
  SearchResult,
  Tracker,
  UserListEntry,
  UserListStatus,
} from './index';

export type AzitAuthMeta = {
  /** The site's address, e.g. http://192.168.1.20:8080 */
  server: string;
  /** Scores are 0-100 in Azit: shown like AniList's 10-point decimal format. */
  scoreFormat: 'POINT_10_DECIMAL';
};
type AzitAuth = AuthenticationResult<AzitAuthMeta>;

const APP = 'lnreader';
const CREATE_PREFIX = 'create:';

const toAzit: Record<UserListStatus, string> = {
  CURRENT: 'current',
  PLANNING: 'planning',
  COMPLETED: 'completed',
  DROPPED: 'dropped',
  PAUSED: 'paused',
  REPEATING: 'repeating',
};
const fromAzit: Record<string, UserListStatus> = Object.fromEntries(
  Object.entries(toAzit).map(([key, value]) => [value, key as UserListStatus]),
);

/** `azit.local:8080/` -> `http://azit.local:8080` */
export function normalizeServer(address: string): string {
  const trimmed = address.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return trimmed;
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/** Azit gives its own pictures as paths (`/api/images/...`). */
const absolute = (url: string | null | undefined, server: string) =>
  !url ? '' : url.startsWith('/') ? `${server}${url}` : url;

/** The address of the Azit last called (to make its picture paths absolute on the tracker card). */
let lastServer = '';

async function call<T>(
  auth: Pick<AzitAuth, 'accessToken' | 'meta'>,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  lastServer = auth.meta!.server;
  const response = await fetch(`${auth.meta!.server}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${auth.accessToken}`,
      'Accept': 'application/json',
      'X-Azit-App': APP,
      ...(body !== undefined && !(body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
        ? body
        : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      typeof error?.detail === 'string'
        ? error.detail
        : response.status === 401
        ? 'Azit refused the token (Settings -> Devices in Azit).'
        : `Azit answered ${response.status}`,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

/** "Test connection": the address and the token, before saving them. */
export async function authenticateWithCredentials(
  server: string,
  token: string,
): Promise<AzitAuth> {
  const auth = {
    accessToken: token.trim(),
    meta: {
      server: normalizeServer(server),
      scoreFormat: 'POINT_10_DECIMAL' as const,
    },
  };
  if (!auth.meta.server) {
    throw new Error(
      'Give the address of your Azit (e.g. http://192.168.1.20:8080).',
    );
  }
  const me = await call<{ ok?: boolean }>(auth, 'GET', '/api/devices/me');
  if (!me?.ok) {
    throw new Error('Azit refused this token.');
  }
  // A device token does not expire: it works until it is revoked in Azit.
  return { ...auth, expiresAt: new Date(Date.UTC(2999, 0, 1)) };
}

type AzitEntry = {
  media_id: number;
  title: string;
  in_library: boolean;
  status: string | null;
  progress: Record<string, number>;
  score: number | null;
  total: number | null;
  cover_url: string | null;
};

const toEntry = (
  entry: AzitEntry,
): UserListEntry & {
  id: number;
  totalChapters?: number;
  title?: string;
  coverImage?: string;
} => ({
  id: entry.media_id,
  // Azit's own title and cover on the tracker card (not the search result's "+ Create … in Azit").
  title: entry.title,
  ...(entry.cover_url && lastServer
    ? { coverImage: absolute(entry.cover_url, lastServer) }
    : {}),
  status: (entry.status && fromAzit[entry.status]) || 'PLANNING',
  progress: Math.floor(entry.progress?.chapter ?? 0),
  score: entry.score ?? 0,
  totalChapters: entry.total ?? undefined,
});

/** What the app knows about the novel being linked: used by "Create in Azit" (title, cover, details, page). */
export type AzitNovelContext = {
  title: string;
  cover?: string | null;
  summary?: string | null;
  author?: string | null;
  artist?: string | null;
  genres?: string | null;
  url?: string | null;
  source?: string | null;
  status?: string | null;
  chaptersRead?: number;
  /** Set in the "Create in Azit" form: the Azit type (novel, light_novel, web_novel), my status and score (0-100). */
  typeSlug?: string;
  entryStatus?: string;
  score?: number;
};
let novelContext: AzitNovelContext | null = null;
/** Set by the search dialog: the novel the results are for. */
export const getAzitNovelContext = () => novelContext;
export const setAzitNovelContext = (context: AzitNovelContext | null) => {
  novelContext = context;
};

const releaseStatus = (status?: string | null) => {
  const value = (status || '').toLowerCase();
  if (value.includes('ongoing')) return 'releasing';
  if (value.includes('complete')) return 'finished';
  if (value.includes('hiatus')) return 'hiatus';
  if (value.includes('cancel')) return 'cancelled';
  return undefined;
};

/** Sends the cover the app shows (a local file or the site's picture) so Azit keeps the file, not a link. */
async function uploadCover(
  auth: AzitAuth,
  cover?: string | null,
): Promise<number | undefined> {
  if (!cover) {
    return undefined;
  }
  try {
    let uri = cover;
    if (/^https?:/i.test(cover)) {
      const target = `${cacheDirectory}azit-cover-${Date.now()}.jpg`;
      uri = (await downloadAsync(cover, target)).uri;
    }
    const form = new FormData();
    // React Native's fetch sends a local file from its uri (file:// or content://).
    form.append('file', {
      uri,
      name: 'cover.jpg',
      type: 'image/jpeg',
    } as any);
    const image = await call<{ id: number }>(
      auth,
      'POST',
      '/api/tracking/images',
      form,
    );
    return image.id;
  } catch {
    return undefined; // Azit then tries the link itself
  }
}

async function createInAzit(auth: AzitAuth, title: string) {
  const context = novelContext && novelContext.title ? novelContext : { title };
  const coverImageId = await uploadCover(auth, context.cover);
  const entry = await call<AzitEntry>(auth, 'POST', '/api/tracking/progress', {
    title: context.title || title,
    kind: 'novel',
    type_slug: context.typeSlug || undefined,
    force_create: true,
    create_if_missing: true,
    only_forward: false,
    url: context.url || undefined,
    link_label: context.source || undefined,
    cover_url:
      context.cover && /^https?:/.test(context.cover)
        ? context.cover
        : undefined,
    cover_image_id: coverImageId,
    description: context.summary?.slice(0, 20000) || undefined,
    authors: [context.author, context.artist]
      .flatMap(name => (name || '').split(','))
      .map(name => name.trim())
      .filter(Boolean)
      .filter((name, index, all) => all.indexOf(name) === index)
      .slice(0, 20),
    genres: (context.genres || '')
      .split(',')
      .map(name => name.trim())
      .filter(Boolean)
      .slice(0, 50),
    release_status: releaseStatus(context.status),
    chapter: context.chaptersRead || undefined,
    status:
      context.entryStatus || (context.chaptersRead ? 'current' : 'planning'),
    score: context.score || undefined,
  });
  return entry;
}

export const azitTracker: Tracker<AzitAuthMeta> = {
  // The login is a form (address + token), see `authenticateWithCredentials`.
  authenticate: () =>
    Promise.reject(
      new Error('Log in to Azit with its address and a device token.'),
    ),
  revalidate: undefined,

  handleSearch: async (search, auth) => {
    const page = await call<{ items: any[] }>(
      auth,
      'GET',
      `/api/media?search=${encodeURIComponent(search)}&per_page=25`,
    );
    const results: SearchResult[] = page.items.map(item => ({
      id: item.id,
      title: item.title,
      coverImage: absolute(item.cover_url, auth.meta!.server),
      totalChapters: item.unit_totals?.chapter || undefined,
    }));
    // Always last: a new title in Azit, made from this novel (cover, details, page, chapters read).
    results.push({
      id: `${CREATE_PREFIX}${search}`,
      title: `+ Create "${(novelContext?.title || search).slice(
        0,
        80,
      )}" in Azit`,
      coverImage: '',
    });
    return results;
  },

  getUserListEntry: async (id, auth) => {
    const entry =
      typeof id === 'string' && id.startsWith(CREATE_PREFIX)
        ? await createInAzit(auth as AzitAuth, id.slice(CREATE_PREFIX.length))
        : await call<AzitEntry>(auth, 'GET', `/api/tracking/entry/${id}`);
    if (!entry.in_library) {
      // Linked to a title of the catalogue not in the library yet: add it (planning, or reading from the chapters read).
      const added = await call<AzitEntry>(
        auth,
        'POST',
        '/api/tracking/progress',
        {
          media_id: entry.media_id,
          title: entry.title,
          kind: 'novel',
          create_if_missing: true,
          chapter: novelContext?.chaptersRead || undefined,
        },
      );
      return toEntry(added);
    }
    return toEntry(entry);
  },

  updateUserListEntry: async (id, payload, auth) => {
    // What waited while Azit could not be reached goes first, in one request.
    await flushQueue(auth as AzitAuth);
    const send = () =>
      call<AzitEntry>(auth, 'POST', '/api/tracking/progress', {
        media_id: Number(id),
        title: novelContext?.title || 'Novel',
        kind: 'novel',
        create_if_missing: false,
        only_forward: false,
        ...(payload.progress !== undefined
          ? { chapter: payload.progress }
          : {}),
        ...(payload.status ? { status: toAzit[payload.status] } : {}),
        ...(payload.score !== undefined
          ? { score: Math.round(payload.score) }
          : {}),
      });
    try {
      return toEntry(await send());
    } catch (error) {
      if (!isOffline(error)) {
        throw error;
      }
      // No connection: kept, and sent with the next update that reaches Azit. The app shows the new state now.
      enqueue({
        mediaId: Number(id),
        title: novelContext?.title || 'Novel',
        payload,
        at: Date.now(),
      });
      return {
        id: Number(id),
        status: payload.status ?? 'CURRENT',
        progress: payload.progress ?? 0,
        score: payload.score ?? 0,
      };
    }
  },
};
