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

const QUOTA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

const toFutureTimestamp = (value?: string) => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return timestamp > Date.now() ? timestamp : null;
};

const parseDisplayResetLabel = (value?: string) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-') return null;

  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const [, monthText, dayText, hourText, minuteText] = match;
  const now = new Date();
  const candidate = new Date(
    now.getFullYear(),
    Number(monthText) - 1,
    Number(dayText),
    Number(hourText),
    Number(minuteText),
    0,
    0
  );
  if (Number.isNaN(candidate.getTime())) {
    return null;
  }
  if (candidate.getTime() <= now.getTime()) {
    candidate.setFullYear(candidate.getFullYear() + 1);
  }
  return candidate.getTime();
};

const pickEarliestFutureTimestamp = (values: Array<number | null>) => {
  const timestamps = values.filter((value): value is number => value !== null);
  return timestamps.length ? Math.min(...timestamps) : null;
};

const pickPreferredWindowExpiryAt = (
  windows: Array<{ id?: string; resetTime?: string; resetLabel?: string }>
) => {
  const entries = windows
    .map((window) => ({
      id: typeof window.id === 'string' ? window.id : '',
      timestamp:
        toFutureTimestamp(window.resetTime) ?? parseDisplayResetLabel(window.resetLabel)
    }))
    .filter((entry): entry is { id: string; timestamp: number } => entry.timestamp !== null);

  if (entries.length === 0) {
    return null;
  }

  const longCycleEntries = entries.filter(
    (entry) =>
      entry.id === 'weekly' ||
      entry.id.endsWith('-weekly') ||
      entry.id.startsWith('seven-day')
  );

  return pickEarliestFutureTimestamp(
    (longCycleEntries.length > 0 ? longCycleEntries : entries).map((entry) => entry.timestamp)
  );
};

const resolveQuotaResetExpiryAt = (value: TimedQuotaState) => {
  if ('groups' in value && Array.isArray(value.groups)) {
    return pickEarliestFutureTimestamp(value.groups.map((group) => toFutureTimestamp(group.resetTime)));
  }

  if ('buckets' in value && Array.isArray(value.buckets)) {
    return pickEarliestFutureTimestamp(value.buckets.map((bucket) => toFutureTimestamp(bucket.resetTime)));
  }

  if ('windows' in value && Array.isArray(value.windows)) {
    return pickPreferredWindowExpiryAt(value.windows);
  }

  if ('nextReset' in value || 'bonusNextReset' in value) {
    const nextResetValue =
      'nextReset' in value && typeof value.nextReset === 'string' ? value.nextReset : undefined;
    const bonusNextResetValue =
      'bonusNextReset' in value && typeof value.bonusNextReset === 'string'
        ? value.bonusNextReset
        : undefined;

    return pickEarliestFutureTimestamp([
      toFutureTimestamp(nextResetValue),
      toFutureTimestamp(bonusNextResetValue)
    ]);
  }

  return null;
};

const resolveQuotaCacheExpiryAt = (value: TimedQuotaState, cachedAt: number) => {
  const resetExpiryAt = resolveQuotaResetExpiryAt(value);
  const minimumRetentionExpiryAt = cachedAt + QUOTA_CACHE_TTL_MS;
  return resetExpiryAt === null
    ? minimumRetentionExpiryAt
    : Math.max(resetExpiryAt, minimumRetentionExpiryAt);
};

const isFreshQuotaState = (value: TimedQuotaState | undefined, now: number) => {
  if (!value || value.status === 'loading') return false;
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

      return [
        [
          key,
          {
            ...value,
            _cachedAt: cachedAt,
            _cacheExpiresAt: resolveQuotaCacheExpiryAt(value, cachedAt)
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
