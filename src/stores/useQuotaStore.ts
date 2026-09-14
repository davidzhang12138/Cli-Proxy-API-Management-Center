/**
 * Quota cache that survives route switches.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getQuotaCacheFileName } from '@/utils/quota/identity';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  FreebuffQuotaState,
  HyperQuotaState,
  KimiQuotaState,
  KiroQuotaState,
  XaiQuotaState,
} from '@/types';
import { STORAGE_KEY_QUOTA } from '@/utils/constants';

type QuotaUpdater<T> = T | ((prev: T) => T);
type TimedQuotaState = { status?: string; _cachedAt?: number; _cacheExpiresAt?: number };

const QUOTA_CACHE_FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface QuotaStoreState {
  cacheGeneration: number;
  fileGenerations: Record<string, number>;
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  devinQuota: Record<string, DevinQuotaState>;
  kiroQuota: Record<string, KiroQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  xaiQuota: Record<string, XaiQuotaState>;
  freebuffQuota: Record<string, FreebuffQuotaState>;
  hyperQuota: Record<string, HyperQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setDevinQuota: (updater: QuotaUpdater<Record<string, DevinQuotaState>>) => void;
  setKiroQuota: (updater: QuotaUpdater<Record<string, KiroQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  setXaiQuota: (updater: QuotaUpdater<Record<string, XaiQuotaState>>) => void;
  setFreebuffQuota: (updater: QuotaUpdater<Record<string, FreebuffQuotaState>>) => void;
  setHyperQuota: (updater: QuotaUpdater<Record<string, HyperQuotaState>>) => void;
  clearQuotaCache: (names?: string[]) => void;
  purgeStaleEntries: () => void;
}

type PersistedQuotaStoreState = Pick<
  QuotaStoreState,
  | 'antigravityQuota'
  | 'claudeQuota'
  | 'codexQuota'
  | 'kiroQuota'
  | 'kimiQuota'
  | 'xaiQuota'
  | 'freebuffQuota'
  | 'hyperQuota'
>;

const resolveUpdater = <T>(updater: QuotaUpdater<T>, prev: T): T => {
  if (typeof updater === 'function') {
    return (updater as (value: T) => T)(prev);
  }
  return updater;
};

/**
 * When an entry stops being treated as fresh: write time + the fallback TTL.
 *
 * Deliberately independent of any provider reset time. Expiring per-window
 * meant one short-cycle resource (Antigravity reports 33) purged a card whose
 * other resources were still good for a week — see 0d8fffb. Staleness is now
 * handled by comparing the backend's `checked_at` against the cache on load
 * (shouldApplySnapshot), so this is only a backstop for credentials the backend
 * can no longer probe.
 */
const resolveQuotaCacheExpiryAt = (cachedAt: number) => cachedAt + QUOTA_CACHE_FALLBACK_TTL_MS;

const isFreshQuotaState = (value: TimedQuotaState | undefined, now: number) => {
  if (!value || value.status === 'loading') return false;
  if (typeof value._cacheExpiresAt === 'number' && Number.isFinite(value._cacheExpiresAt)) {
    return value._cacheExpiresAt > now;
  }
  const cachedAt =
    typeof value._cachedAt === 'number' && Number.isFinite(value._cachedAt) ? value._cachedAt : now;
  return resolveQuotaCacheExpiryAt(cachedAt) > now;
};

const sanitizeQuotaMap = <T extends TimedQuotaState>(quotaMap: Record<string, T>) => {
  const now = Date.now();

  return Object.fromEntries(
    Object.entries(quotaMap).flatMap(([key, value]) => {
      if (!isFreshQuotaState(value, now)) {
        return [];
      }

      const cachedAt =
        typeof value._cachedAt === 'number' && Number.isFinite(value._cachedAt)
          ? value._cachedAt
          : now;

      const cacheExpiresAt =
        typeof value._cacheExpiresAt === 'number' && Number.isFinite(value._cacheExpiresAt)
          ? value._cacheExpiresAt
          : resolveQuotaCacheExpiryAt(cachedAt);

      return [
        [
          key,
          {
            ...value,
            _cachedAt: cachedAt,
            _cacheExpiresAt: cacheExpiresAt,
          },
        ],
      ];
    })
  ) as Record<string, T>;
};

const stampQuotaMap = <T extends TimedQuotaState>(
  nextMap: Record<string, T>,
  prevMap: Record<string, T>
) => {
  const now = Date.now();

  return Object.fromEntries(
    Object.entries(nextMap).flatMap(([key, value]) => {
      if (!value) {
        return [];
      }

      if (value.status === 'loading') {
        return [[key, value]];
      }

      const prevValue = prevMap[key];
      const cachedAt =
        prevValue === value && isFreshQuotaState(prevValue, now) ? prevValue._cachedAt : now;
      const normalizedCachedAt =
        typeof cachedAt === 'number' && Number.isFinite(cachedAt) ? cachedAt : now;
      const cacheExpiresAt = resolveQuotaCacheExpiryAt(normalizedCachedAt);

      return [[key, { ...value, _cachedAt: normalizedCachedAt, _cacheExpiresAt: cacheExpiresAt }]];
    })
  ) as Record<string, T>;
};

const sanitizePersistedQuotaState = (
  state: PersistedQuotaStoreState | Partial<PersistedQuotaStoreState>
): PersistedQuotaStoreState => ({
  antigravityQuota: sanitizeQuotaMap(state.antigravityQuota ?? {}),
  claudeQuota: sanitizeQuotaMap(state.claudeQuota ?? {}),
  codexQuota: sanitizeQuotaMap(state.codexQuota ?? {}),
  kiroQuota: sanitizeQuotaMap(state.kiroQuota ?? {}),
  kimiQuota: sanitizeQuotaMap(state.kimiQuota ?? {}),
  xaiQuota: sanitizeQuotaMap(state.xaiQuota ?? {}),
  freebuffQuota: sanitizeQuotaMap(state.freebuffQuota ?? {}),
  hyperQuota: sanitizeQuotaMap(state.hyperQuota ?? {}),
});

/**
 * Drop entries whose TTL has passed, for the in-session purge timer.
 *
 * Unlike `sanitizeQuotaMap`, in-flight entries are kept: that function decides
 * what is worth *persisting*, where a half-finished fetch is noise, but the
 * timer runs mid-session where deleting a `loading` entry blanks a card the
 * user is watching and the arriving response has nowhere to land.
 */
const purgeStaleQuotaMap = <T extends TimedQuotaState>(quotaMap: Record<string, T>) => {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(quotaMap).flatMap(([key, value]) =>
      value && (value.status === 'loading' || isFreshQuotaState(value, now)) ? [[key, value]] : []
    )
  ) as Record<string, T>;
};

export const useQuotaStore = create<QuotaStoreState>()(
  persist(
    (set) => ({
      cacheGeneration: 0,
      fileGenerations: {},
      antigravityQuota: {},
      claudeQuota: {},
      codexQuota: {},
      devinQuota: {},
      kiroQuota: {},
      kimiQuota: {},
      xaiQuota: {},
      freebuffQuota: {},
      hyperQuota: {},
      setAntigravityQuota: (updater) =>
        set((state) => ({
          antigravityQuota: stampQuotaMap(
            resolveUpdater(updater, state.antigravityQuota),
            state.antigravityQuota
          ),
        })),
      setClaudeQuota: (updater) =>
        set((state) => ({
          claudeQuota: stampQuotaMap(resolveUpdater(updater, state.claudeQuota), state.claudeQuota),
        })),
      setCodexQuota: (updater) =>
        set((state) => ({
          codexQuota: stampQuotaMap(resolveUpdater(updater, state.codexQuota), state.codexQuota),
        })),
      setDevinQuota: (updater) =>
        set((state) => ({
          devinQuota: resolveUpdater(updater, state.devinQuota),
        })),
      setKiroQuota: (updater) =>
        set((state) => ({
          kiroQuota: stampQuotaMap(resolveUpdater(updater, state.kiroQuota), state.kiroQuota),
        })),
      setKimiQuota: (updater) =>
        set((state) => ({
          kimiQuota: stampQuotaMap(resolveUpdater(updater, state.kimiQuota), state.kimiQuota),
        })),
      setXaiQuota: (updater) =>
        set((state) => ({
          xaiQuota: stampQuotaMap(resolveUpdater(updater, state.xaiQuota), state.xaiQuota),
        })),
      setFreebuffQuota: (updater) =>
        set((state) => ({
          freebuffQuota: stampQuotaMap(
            resolveUpdater(updater, state.freebuffQuota),
            state.freebuffQuota
          ),
        })),
      setHyperQuota: (updater) =>
        set((state) => ({
          hyperQuota: stampQuotaMap(resolveUpdater(updater, state.hyperQuota), state.hyperQuota),
        })),

      clearQuotaCache: (names) =>
        set((state) => {
          if (names) {
            if (names.length === 0) return state;
            const fileGenerations = { ...state.fileGenerations };
            names.forEach((name) => {
              fileGenerations[name] = (fileGenerations[name] ?? 0) + 1;
            });
            const invalidatedNames = new Set(names);
            const omitNames = <T>(cache: Record<string, T>): Record<string, T> => {
              const keysToDelete = Object.keys(cache).filter((key) =>
                invalidatedNames.has(getQuotaCacheFileName(key))
              );
              if (keysToDelete.length === 0) return cache;
              const next = { ...cache };
              keysToDelete.forEach((key) => delete next[key]);
              return next;
            };
            return {
              fileGenerations,
              antigravityQuota: omitNames(state.antigravityQuota),
              claudeQuota: omitNames(state.claudeQuota),
              codexQuota: omitNames(state.codexQuota),
              devinQuota: omitNames(state.devinQuota),
              kiroQuota: omitNames(state.kiroQuota),
              freebuffQuota: omitNames(state.freebuffQuota),
              hyperQuota: omitNames(state.hyperQuota),
              kimiQuota: omitNames(state.kimiQuota),
              xaiQuota: omitNames(state.xaiQuota),
            };
          }
          return {
            cacheGeneration: state.cacheGeneration + 1,
            fileGenerations: {},
            antigravityQuota: {},
            claudeQuota: {},
            codexQuota: {},
            devinQuota: {},
            kiroQuota: {},
            freebuffQuota: {},
            hyperQuota: {},
            kimiQuota: {},
            xaiQuota: {},
          };
        }),
      purgeStaleEntries: () =>
        set((state) => ({
          antigravityQuota: purgeStaleQuotaMap(state.antigravityQuota),
          claudeQuota: purgeStaleQuotaMap(state.claudeQuota),
          codexQuota: purgeStaleQuotaMap(state.codexQuota),
          kiroQuota: purgeStaleQuotaMap(state.kiroQuota),
          kimiQuota: purgeStaleQuotaMap(state.kimiQuota),
          xaiQuota: purgeStaleQuotaMap(state.xaiQuota),
          freebuffQuota: purgeStaleQuotaMap(state.freebuffQuota),
          hyperQuota: purgeStaleQuotaMap(state.hyperQuota),
        })),
    }),
    {
      name: STORAGE_KEY_QUOTA,
      partialize: (state) =>
        sanitizePersistedQuotaState({
          antigravityQuota: state.antigravityQuota,
          claudeQuota: state.claudeQuota,
          codexQuota: state.codexQuota,
          kiroQuota: state.kiroQuota,
          kimiQuota: state.kimiQuota,
          xaiQuota: state.xaiQuota,
          freebuffQuota: state.freebuffQuota,
          hyperQuota: state.hyperQuota,
        }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedQuotaState((persistedState as Partial<PersistedQuotaStoreState>) ?? {}),
      }),
    }
  )
);

export const captureQuotaCacheGeneration = (name?: string) => {
  const { cacheGeneration, fileGenerations } = useQuotaStore.getState();
  return { cacheGeneration, fileGenerations, name };
};

export const commitIfQuotaCacheCurrent = (
  generation: ReturnType<typeof captureQuotaCacheGeneration>,
  commit: () => void,
  name: string | undefined = generation.name
): boolean => {
  const current = useQuotaStore.getState();
  if (current.cacheGeneration !== generation.cacheGeneration) return false;
  // File-scoped requests survive mutations to unrelated credentials.
  if (name !== undefined) {
    if ((current.fileGenerations[name] ?? 0) !== (generation.fileGenerations[name] ?? 0)) {
      return false;
    }
  } else if (current.fileGenerations !== generation.fileGenerations) {
    return false;
  }
  commit();
  return true;
};
