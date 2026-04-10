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

const sanitizeQuotaMap = <T extends { status?: string }>(quotaMap: Record<string, T>) =>
  Object.fromEntries(
    Object.entries(quotaMap).filter(([, value]) => value && value.status !== 'loading')
  ) as Record<string, T>;

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
          antigravityQuota: resolveUpdater(updater, state.antigravityQuota)
        })),
      setClaudeQuota: (updater) =>
        set((state) => ({
          claudeQuota: resolveUpdater(updater, state.claudeQuota)
        })),
      setCodexQuota: (updater) =>
        set((state) => ({
          codexQuota: resolveUpdater(updater, state.codexQuota)
        })),
      setGeminiCliQuota: (updater) =>
        set((state) => ({
          geminiCliQuota: resolveUpdater(updater, state.geminiCliQuota)
        })),
      setKiroQuota: (updater) =>
        set((state) => ({
          kiroQuota: resolveUpdater(updater, state.kiroQuota)
        })),
      setKimiQuota: (updater) =>
        set((state) => ({
          kimiQuota: resolveUpdater(updater, state.kimiQuota)
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
