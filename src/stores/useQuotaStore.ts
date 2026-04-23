/**
 * Quota cache that survives route switches.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  GeminiCliQuotaState,
  KimiQuotaState,
  KiroQuotaState,
} from '@/types';
import { STORAGE_KEY_QUOTA } from '@/utils/constants';

type QuotaUpdater<T> = T | ((prev: T) => T);
type TimedQuotaState = { status?: string; _cachedAt?: number; _cacheExpiresAt?: number };

const QUOTA_CACHE_FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface QuotaStoreState {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  geminiCliQuota: Record<string, GeminiCliQuotaState>;
  kiroQuota: Record<string, KiroQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setGeminiCliQuota: (updater: QuotaUpdater<Record<string, GeminiCliQuotaState>>) => void;
  setKiroQuota: (updater: QuotaUpdater<Record<string, KiroQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  clearQuotaCache: () => void;
  purgeStaleEntries: () => void;
}

type PersistedQuotaStoreState = Pick<
  QuotaStoreState,
  | 'antigravityQuota'
  | 'claudeQuota'
  | 'codexQuota'
  | 'geminiCliQuota'
  | 'kiroQuota'
  | 'kimiQuota'
>;

const resolveUpdater = <T,>(updater: QuotaUpdater<T>, prev: T): T => {
  if (typeof updater === 'function') {
    return (updater as (value: T) => T)(prev);
  }
  return updater;
};

const resolveQuotaCacheExpiryAt = (_value: TimedQuotaState, cachedAt: number) => {
  return cachedAt + QUOTA_CACHE_FALLBACK_TTL_MS;
};

const isFreshQuotaState = (value: TimedQuotaState | undefined, now: number) => {
  if (!value || value.status === 'loading') return false;
  if (typeof value._cacheExpiresAt === 'number' && Number.isFinite(value._cacheExpiresAt)) {
    return value._cacheExpiresAt > now;
  }
  const cachedAt =
    typeof value._cachedAt === 'number' && Number.isFinite(value._cachedAt) ? value._cachedAt : now;
  return resolveQuotaCacheExpiryAt(value, cachedAt) > now;
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
          : resolveQuotaCacheExpiryAt(value, cachedAt);

      return [
        [
          key,
          {
            ...value,
            _cachedAt: cachedAt,
            _cacheExpiresAt: cacheExpiresAt
          }
        ]
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
        prevValue === value && isFreshQuotaState(prevValue, now)
          ? prevValue._cachedAt
          : now;
      const normalizedCachedAt =
        typeof cachedAt === 'number' && Number.isFinite(cachedAt) ? cachedAt : now;
      const cacheExpiresAt = resolveQuotaCacheExpiryAt(value, normalizedCachedAt);

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
  geminiCliQuota: sanitizeQuotaMap(state.geminiCliQuota ?? {}),
  kiroQuota: sanitizeQuotaMap(state.kiroQuota ?? {}),
  kimiQuota: sanitizeQuotaMap(state.kimiQuota ?? {}),
});

export const useQuotaStore = create<QuotaStoreState>()(
  persist(
    (set) => ({
      antigravityQuota: {},
      claudeQuota: {},
      codexQuota: {},
      geminiCliQuota: {},
      kiroQuota: {},
      kimiQuota: {},
      setAntigravityQuota: (updater) =>
        set((state) => ({
          antigravityQuota: stampQuotaMap(
            resolveUpdater(updater, state.antigravityQuota),
            state.antigravityQuota
          )
        })),
      setClaudeQuota: (updater) =>
        set((state) => ({
          claudeQuota: stampQuotaMap(resolveUpdater(updater, state.claudeQuota), state.claudeQuota)
        })),
      setCodexQuota: (updater) =>
        set((state) => ({
          codexQuota: stampQuotaMap(resolveUpdater(updater, state.codexQuota), state.codexQuota)
        })),
      setGeminiCliQuota: (updater) =>
        set((state) => ({
          geminiCliQuota: stampQuotaMap(
            resolveUpdater(updater, state.geminiCliQuota),
            state.geminiCliQuota
          )
        })),
      setKiroQuota: (updater) =>
        set((state) => ({
          kiroQuota: stampQuotaMap(resolveUpdater(updater, state.kiroQuota), state.kiroQuota)
        })),
      setKimiQuota: (updater) =>
        set((state) => ({
          kimiQuota: stampQuotaMap(resolveUpdater(updater, state.kimiQuota), state.kimiQuota)
        })),
      clearQuotaCache: () =>
        set({
          antigravityQuota: {},
          claudeQuota: {},
          codexQuota: {},
          geminiCliQuota: {},
          kiroQuota: {},
          kimiQuota: {}
        }),
      purgeStaleEntries: () =>
        set((state) => {
          const sanitized = sanitizePersistedQuotaState({
            antigravityQuota: state.antigravityQuota,
            claudeQuota: state.claudeQuota,
            codexQuota: state.codexQuota,
            geminiCliQuota: state.geminiCliQuota,
            kiroQuota: state.kiroQuota,
            kimiQuota: state.kimiQuota,
          });
          return sanitized;
        })
    }),
    {
      name: STORAGE_KEY_QUOTA,
      partialize: (state) =>
        sanitizePersistedQuotaState({
          antigravityQuota: state.antigravityQuota,
          claudeQuota: state.claudeQuota,
          codexQuota: state.codexQuota,
          geminiCliQuota: state.geminiCliQuota,
          kiroQuota: state.kiroQuota,
          kimiQuota: state.kimiQuota,
        }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedQuotaState(
          (persistedState as Partial<PersistedQuotaStoreState>) ?? {}
        ),
      }),
    }
  )
);
