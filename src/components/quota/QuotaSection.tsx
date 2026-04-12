/**
 * Generic quota section component.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useNotificationStore, useQuotaStore, useThemeStore } from '@/stores';
import type {
  AntigravityQuotaState,
  AuthFileItem,
  ClaudeQuotaState,
  CodexQuotaState,
  GeminiCliQuotaState,
  KimiQuotaState,
  KiroQuotaState,
  ResolvedTheme
} from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { normalizeAuthIndex, normalizeUsageSourceId, type UsageDetail } from '@/utils/usage';
import { QuotaCard } from './QuotaCard';
import type { QuotaStatusState, QuotaUsageModelSummary } from './QuotaCard';
import { useQuotaLoader } from './useQuotaLoader';
import { getEffectiveKiroQuotaState, type QuotaConfig } from './quotaConfigs';
import { useGridColumns } from './useGridColumns';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);
type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;
type ViewMode = 'paged' | 'all';
type QuotaAvailabilityFilter = 'all' | 'has' | 'none';
type QuotaSortMode = 'default' | 'quota_desc' | 'quota_asc' | 'model_reset_asc';

const DEFAULT_ITEMS_PER_PAGE = 6;
const PAGE_SIZE_OPTIONS = [6, 12, 24];
const MAX_ITEMS_PER_PAGE = 24;
const MAX_SHOW_ALL_THRESHOLD = 30;
const ANTIGRAVITY_VISIBLE_GROUP_IDS = new Set(['claude-gpt', 'gemini-3-1-pro-series', 'gemini-3-flash']);

interface FileUsageSummary {
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  startedAtMs: number | null;
  models: QuotaUsageModelSummary[];
}

interface QuotaPaginationState<T> {
  pageSize: number;
  totalPages: number;
  currentPage: number;
  pageItems: T[];
  setPageSize: (size: number) => void;
  syncPageSize: (size: number) => void;
  goToPage: (page: number) => void;
  goToPrev: () => void;
  goToNext: () => void;
  loading: boolean;
  loadingScope: 'page' | 'all' | null;
  setLoading: (loading: boolean, scope?: 'page' | 'all' | null) => void;
}

const normalizeModelKey = (value: string) => value.trim().toLowerCase();

const toNonNegativeNumber = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(numeric, 0) : 0;
};

const toUsageTimestampMs = (detail: UsageDetail): number | null => {
  if (typeof detail.__timestampMs === 'number' && detail.__timestampMs > 0) {
    return detail.__timestampMs;
  }
  const parsed = Date.parse(detail.timestamp);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const clampQuotaRatio = (value: number | null | undefined): number | null => {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.min(1, Math.max(0, Number(value)));
};

const toResetTimestamp = (value?: string): number | null => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const isAntigravityQuotaState = (
  quotaState: QuotaStatusState | undefined
): quotaState is AntigravityQuotaState =>
  Boolean(
    quotaState &&
      quotaState.status === 'success' &&
      'groups' in quotaState &&
      Array.isArray(quotaState.groups)
  );

const getAntigravityGroups = (
  quotaState: QuotaStatusState | undefined
): AntigravityQuotaState['groups'] => {
  if (!isAntigravityQuotaState(quotaState)) {
    return [];
  }

  return quotaState.groups;
};

const getCodexAvailabilityWindows = (state: CodexQuotaState) =>
  (state.windows ?? []).filter((window) => !window.id.startsWith('code-review-'));

const buildPaginationItems = (currentPage: number, totalPages: number): Array<number | 'ellipsis'> => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, 'ellipsis', totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [1, 'ellipsis', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', totalPages];
};

const buildEmptyUsageSummary = (ready: boolean): FileUsageSummary => ({
  totalTokens: ready ? 0 : null,
  inputTokens: ready ? 0 : null,
  outputTokens: ready ? 0 : null,
  cachedTokens: ready ? 0 : null,
  reasoningTokens: ready ? 0 : null,
  startedAtMs: null,
  models: []
});

const quotaStateMatchesModel = (
  quotaType: QuotaConfig<QuotaStatusState, unknown>['type'],
  quotaState: QuotaStatusState | undefined,
  normalizedSelectedModel: string
): boolean | null => {
  if (!normalizedSelectedModel || !quotaState || quotaState.status !== 'success') {
    return null;
  }

  switch (quotaType) {
    case 'antigravity': {
      return getAntigravityGroups(quotaState).some((group) =>
        group.models.some((model) => normalizeModelKey(model) === normalizedSelectedModel)
      );
    }
    case 'gemini-cli': {
      const state = quotaState as GeminiCliQuotaState;
      return state.buckets.some((bucket) =>
        (bucket.modelIds ?? []).some((model) => normalizeModelKey(model) === normalizedSelectedModel)
      );
    }
    default:
      return null;
  }
};

const getQuotaRemainingRatioForModel = (
  quotaType: QuotaConfig<QuotaStatusState, unknown>['type'],
  quotaState: QuotaStatusState | undefined,
  normalizedSelectedModel: string
): number | null => {
  if (!normalizedSelectedModel || !quotaState || quotaState.status !== 'success') {
    return null;
  }

  switch (quotaType) {
    case 'antigravity': {
      const ratios = getAntigravityGroups(quotaState)
        .filter((group) =>
          group.models.some((model) => normalizeModelKey(model) === normalizedSelectedModel)
        )
        .map((group) => clampQuotaRatio(group.remainingFraction))
        .filter((ratio): ratio is number => ratio !== null);
      return ratios.length ? Math.max(...ratios) : null;
    }
    case 'gemini-cli': {
      const state = quotaState as GeminiCliQuotaState;
      const ratios = state.buckets
        .filter((bucket) =>
          (bucket.modelIds ?? []).some((model) => normalizeModelKey(model) === normalizedSelectedModel)
        )
        .map((bucket) => clampQuotaRatio(bucket.remainingFraction))
        .filter((ratio): ratio is number => ratio !== null);
      return ratios.length ? Math.max(...ratios) : null;
    }
    default:
      return null;
  }
};

const getQuotaRemainingRatio = (
  quotaType: QuotaConfig<QuotaStatusState, unknown>['type'],
  quotaState: QuotaStatusState | undefined
): number | null => {
  if (!quotaState || quotaState.status !== 'success') {
    return null;
  }

  switch (quotaType) {
    case 'antigravity': {
      const ratios = getAntigravityGroups(quotaState)
        .map((group) => clampQuotaRatio(group.remainingFraction))
        .filter((ratio): ratio is number => ratio !== null);
      return ratios.length ? Math.max(...ratios) : null;
    }
    case 'claude': {
      const state = quotaState as ClaudeQuotaState;
      const ratios = state.windows
        .map((window) =>
          window.usedPercent === null ? null : clampQuotaRatio(1 - window.usedPercent / 100)
        )
        .filter((ratio): ratio is number => ratio !== null);
      return ratios.length ? Math.max(...ratios) : null;
    }
    case 'codex': {
      const state = quotaState as CodexQuotaState;
      const ratios = getCodexAvailabilityWindows(state)
        .map((window) =>
          window.usedPercent === null ? null : clampQuotaRatio(1 - window.usedPercent / 100)
        )
        .filter((ratio): ratio is number => ratio !== null);
      return ratios.length ? Math.max(...ratios) : null;
    }
    case 'gemini-cli': {
      const state = quotaState as GeminiCliQuotaState;
      const ratios = state.buckets
        .map((bucket) => clampQuotaRatio(bucket.remainingFraction))
        .filter((ratio): ratio is number => ratio !== null);
      if (ratios.length) {
        return Math.max(...ratios);
      }
      if (typeof state.creditBalance === 'number') {
        return state.creditBalance > 0 ? 1 : 0;
      }
      return null;
    }
    case 'kiro': {
      const state = getEffectiveKiroQuotaState(quotaState as KiroQuotaState);
      if (typeof state.remainingCredits === 'number' && typeof state.usageLimit === 'number') {
        if (state.usageLimit <= 0) {
          return state.remainingCredits > 0 ? 1 : 0;
        }
        return clampQuotaRatio(state.remainingCredits / state.usageLimit);
      }
      if (
        typeof state.baseRemaining === 'number' &&
        typeof state.baseLimit === 'number' &&
        state.baseLimit > 0
      ) {
        return clampQuotaRatio(state.baseRemaining / state.baseLimit);
      }
      return null;
    }
    case 'kimi': {
      const state = quotaState as KimiQuotaState;
      const ratios = state.rows
        .map((row) => (row.limit > 0 ? clampQuotaRatio((row.limit - row.used) / row.limit) : null))
        .filter((ratio): ratio is number => ratio !== null);
      return ratios.length ? Math.max(...ratios) : null;
    }
    default:
      return null;
  }
};

const getQuotaResetTimestampForModel = (
  quotaType: QuotaConfig<QuotaStatusState, unknown>['type'],
  quotaState: QuotaStatusState | undefined,
  normalizedSelectedModel: string
): number | null => {
  if (!quotaState || quotaState.status !== 'success') {
    return null;
  }

  const pickEarliest = (values: Array<number | null>) => {
    const timestamps = values.filter((value): value is number => value !== null);
    return timestamps.length ? Math.min(...timestamps) : null;
  };

  switch (quotaType) {
    case 'antigravity': {
      const groups = getAntigravityGroups(quotaState);
      const matchedGroups = normalizedSelectedModel
        ? groups.filter((group) =>
            group.models.some((model) => normalizeModelKey(model) === normalizedSelectedModel)
          )
        : groups;
      return pickEarliest(matchedGroups.map((group) => toResetTimestamp(group.resetTime)));
    }
    case 'claude': {
      const state = quotaState as ClaudeQuotaState;
      return pickEarliest(state.windows.map((window) => toResetTimestamp(window.resetTime)));
    }
    case 'codex': {
      const state = quotaState as CodexQuotaState;
      return pickEarliest(
        getCodexAvailabilityWindows(state).map((window) => toResetTimestamp(window.resetTime))
      );
    }
    case 'gemini-cli': {
      const state = quotaState as GeminiCliQuotaState;
      const matchedBuckets = normalizedSelectedModel
        ? state.buckets.filter((bucket) =>
            (bucket.modelIds ?? []).some((model) => normalizeModelKey(model) === normalizedSelectedModel)
          )
        : state.buckets;
      return pickEarliest(matchedBuckets.map((bucket) => toResetTimestamp(bucket.resetTime)));
    }
    case 'kiro': {
      const state = getEffectiveKiroQuotaState(quotaState as KiroQuotaState);
      return pickEarliest([
        toResetTimestamp(state.nextReset),
        toResetTimestamp(state.bonusNextReset)
      ]);
    }
    default:
      return null;
  }
};

const useQuotaPagination = <T,>(items: T[], defaultPageSize = 6): QuotaPaginationState<T> => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
  const [loading, setLoadingState] = useState(false);
  const [loadingScope, setLoadingScope] = useState<'page' | 'all' | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(items.length / pageSize)),
    [items.length, pageSize]
  );

  const currentPage = useMemo(() => Math.min(page, totalPages), [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(1);
  }, []);

  const syncPageSize = useCallback((size: number) => {
    setPageSizeState(size);
  }, []);

  const goToPage = useCallback((targetPage: number) => {
    setPage(Math.min(Math.max(1, targetPage), totalPages));
  }, [totalPages]);

  const goToPrev = useCallback(() => {
    setPage((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNext = useCallback(() => {
    setPage((prev) => Math.min(totalPages, prev + 1));
  }, [totalPages]);

  const setLoading = useCallback((isLoading: boolean, scope?: 'page' | 'all' | null) => {
    setLoadingState(isLoading);
    setLoadingScope(isLoading ? (scope ?? null) : null);
  }, []);

  return {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    syncPageSize,
    goToPage,
    goToPrev,
    goToNext,
    loading,
    loadingScope,
    setLoading
  };
};

interface QuotaSectionProps<TState extends QuotaStatusState, TData> {
  config: QuotaConfig<TState, TData>;
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
  usageDetails: UsageDetail[];
  usageStatsReady: boolean;
  availabilityFilter: QuotaAvailabilityFilter;
  selectedModel: string;
  sortMode: QuotaSortMode;
  fileModelsByName: Record<string, string[]>;
}

export function QuotaSection<TState extends QuotaStatusState, TData>({
  config,
  files,
  loading,
  disabled,
  usageDetails,
  usageStatsReady,
  availabilityFilter,
  selectedModel,
  sortMode,
  fileModelsByName
}: QuotaSectionProps<TState, TData>) {
  const { t } = useTranslation();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;
  const { quota, loadQuota } = useQuotaLoader(config);

  const [, gridRef] = useGridColumns(380);
  const [viewMode, setViewMode] = useState<ViewMode>('paged');
  const [showTooManyWarning, setShowTooManyWarning] = useState(false);
  const [pageSizePreference, setPageSizePreference] = useState(DEFAULT_ITEMS_PER_PAGE);
  const [pageJumpValue, setPageJumpValue] = useState('');
  const [refreshSnapshots, setRefreshSnapshots] = useState<Record<string, TState>>({});

  const providerFiles = useMemo(() => files.filter((file) => config.filterFn(file)), [files, config]);

  const usageSummaryByFileName = useMemo(() => {
    const normalizedSelectedModel =
      selectedModel && selectedModel !== 'all' ? normalizeModelKey(selectedModel) : '';
    const usageByAuthIndex = new Map<string, FileUsageSummary>();
    const usageBySource = new Map<string, FileUsageSummary>();

    const accumulateDetail = (
      bucket: Map<string, FileUsageSummary>,
      key: string,
      detail: UsageDetail
    ) => {
      const summary = bucket.get(key) ?? buildEmptyUsageSummary(true);
      const inputTokens = toNonNegativeNumber(detail.tokens.input_tokens);
      const outputTokens = toNonNegativeNumber(detail.tokens.output_tokens);
      const cachedTokens = Math.max(
        toNonNegativeNumber(detail.tokens.cached_tokens),
        toNonNegativeNumber(detail.tokens.cache_tokens)
      );
      const reasoningTokens = toNonNegativeNumber(detail.tokens.reasoning_tokens);
      const totalTokens = inputTokens + outputTokens + cachedTokens + reasoningTokens;
      const timestampMs = toUsageTimestampMs(detail);
      const modelName = String(detail.__modelName ?? '').trim();

      summary.totalTokens = (summary.totalTokens ?? 0) + totalTokens;
      summary.inputTokens = (summary.inputTokens ?? 0) + inputTokens;
      summary.outputTokens = (summary.outputTokens ?? 0) + outputTokens;
      summary.cachedTokens = (summary.cachedTokens ?? 0) + cachedTokens;
      summary.reasoningTokens = (summary.reasoningTokens ?? 0) + reasoningTokens;
      summary.startedAtMs =
        timestampMs === null
          ? summary.startedAtMs
          : summary.startedAtMs === null
            ? timestampMs
            : Math.min(summary.startedAtMs, timestampMs);

      if (modelName && totalTokens > 0) {
        const existing = summary.models.find(
          (model) => normalizeModelKey(model.model) === normalizeModelKey(modelName)
        );
        if (existing) {
          existing.totalTokens += totalTokens;
        } else {
          summary.models.push({ model: modelName, totalTokens });
        }
        summary.models.sort((left, right) => {
          const tokenDiff = right.totalTokens - left.totalTokens;
          if (tokenDiff !== 0) return tokenDiff;
          return left.model.localeCompare(right.model, undefined, { sensitivity: 'base' });
        });
      }

      bucket.set(key, summary);
    };

    usageDetails.forEach((detail) => {
      if (
        normalizedSelectedModel &&
        normalizeModelKey(String(detail.__modelName ?? '')) !== normalizedSelectedModel
      ) {
        return;
      }

      const authIndexKey = normalizeAuthIndex(detail.auth_index);
      if (authIndexKey) {
        accumulateDetail(usageByAuthIndex, authIndexKey, detail);
      }

      const sourceId = normalizeUsageSourceId(detail.source);
      if (sourceId) {
        accumulateDetail(usageBySource, sourceId, detail);
      }
    });

    const summaryByFile = new Map<string, FileUsageSummary>();
    providerFiles.forEach((file) => {
      const rawAuthIndex = file['auth_index'] ?? file.authIndex;
      const authIndexKey = normalizeAuthIndex(rawAuthIndex);
      if (authIndexKey && usageByAuthIndex.has(authIndexKey)) {
        summaryByFile.set(file.name, usageByAuthIndex.get(authIndexKey) ?? buildEmptyUsageSummary(usageStatsReady));
        return;
      }

      const fileNameId = file.name ? normalizeUsageSourceId(file.name) : '';
      if (fileNameId && usageBySource.has(fileNameId)) {
        summaryByFile.set(file.name, usageBySource.get(fileNameId) ?? buildEmptyUsageSummary(usageStatsReady));
        return;
      }

      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
      const nameWithoutExtId = nameWithoutExt ? normalizeUsageSourceId(nameWithoutExt) : '';
      if (nameWithoutExtId && usageBySource.has(nameWithoutExtId)) {
        summaryByFile.set(file.name, usageBySource.get(nameWithoutExtId) ?? buildEmptyUsageSummary(usageStatsReady));
        return;
      }

      summaryByFile.set(file.name, buildEmptyUsageSummary(usageStatsReady));
    });

    return summaryByFile;
  }, [providerFiles, selectedModel, usageDetails, usageStatsReady]);

  const preserveQuotaSnapshot = useCallback(
    (targets: AuthFileItem[]) => {
      setRefreshSnapshots((prev) => {
        const nextState = { ...prev };
        targets.forEach((file) => {
          const currentState = quota[file.name];
          if (currentState && currentState.status !== 'loading') {
            nextState[file.name] = currentState;
          }
        });
        return nextState;
      });
    },
    [quota]
  );

  const clearQuotaSnapshot = useCallback((targets: AuthFileItem[]) => {
    setRefreshSnapshots((prev) => {
      const nextState = { ...prev };
      targets.forEach((file) => {
        delete nextState[file.name];
      });
      return nextState;
    });
  }, []);

  const getQuotaStateForList = useCallback(
    (fileName: string): QuotaStatusState | undefined => {
      const currentState = quota[fileName] as QuotaStatusState | undefined;
      if (currentState?.status === 'loading' && refreshSnapshots[fileName]) {
        return refreshSnapshots[fileName] as QuotaStatusState;
      }
      return currentState;
    },
    [quota, refreshSnapshots]
  );

  const visibleFiles = useMemo(() => {
    const normalizedSelectedModel =
      selectedModel && selectedModel !== 'all' ? normalizeModelKey(selectedModel) : '';

    return [...providerFiles]
      .filter((file) => {
        const quotaState = getQuotaStateForList(file.name);
        const ratio =
          normalizedSelectedModel
            ? getQuotaRemainingRatioForModel(config.type, quotaState, normalizedSelectedModel) ??
              getQuotaRemainingRatio(config.type, quotaState)
            : getQuotaRemainingRatio(config.type, quotaState);
        const matchesQuota =
          availabilityFilter === 'all'
            ? true
            : availabilityFilter === 'has'
              ? ratio !== null && ratio > 0
              : ratio !== null && ratio <= 0;

        if (!matchesQuota) {
          return false;
        }

        if (!normalizedSelectedModel) {
          return true;
        }

        const quotaModelMatch = quotaStateMatchesModel(
          config.type,
          quotaState,
          normalizedSelectedModel
        );
        if (quotaModelMatch !== null) {
          return quotaModelMatch;
        }

        const supportedModels = fileModelsByName[file.name] ?? [];
        const usageModels = usageSummaryByFileName.get(file.name)?.models ?? [];
        return (
          supportedModels.some((model) => normalizeModelKey(model) === normalizedSelectedModel) ||
          usageModels.some((model) => normalizeModelKey(model.model) === normalizedSelectedModel)
        );
      })
      .sort((left, right) => {
        if (sortMode === 'default') {
          return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
        }

        const leftState = getQuotaStateForList(left.name);
        const rightState = getQuotaStateForList(right.name);
        if (sortMode === 'model_reset_asc') {
          const leftReset = getQuotaResetTimestampForModel(
            config.type,
            leftState,
            normalizedSelectedModel
          );
          const rightReset = getQuotaResetTimestampForModel(
            config.type,
            rightState,
            normalizedSelectedModel
          );

          if (leftReset === null && rightReset === null) {
            return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
          }
          if (leftReset === null) return 1;
          if (rightReset === null) return -1;
          if (leftReset !== rightReset) {
            return leftReset - rightReset;
          }
          return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
        }

        const leftRatio =
          normalizedSelectedModel
            ? getQuotaRemainingRatioForModel(config.type, leftState, normalizedSelectedModel) ??
              getQuotaRemainingRatio(config.type, leftState)
            : getQuotaRemainingRatio(config.type, leftState);
        const rightRatio =
          normalizedSelectedModel
            ? getQuotaRemainingRatioForModel(config.type, rightState, normalizedSelectedModel) ??
              getQuotaRemainingRatio(config.type, rightState)
            : getQuotaRemainingRatio(config.type, rightState);

        if (leftRatio === null && rightRatio === null) {
          return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
        }
        if (leftRatio === null) return 1;
        if (rightRatio === null) return -1;

        const diff = sortMode === 'quota_desc' ? rightRatio - leftRatio : leftRatio - rightRatio;
        if (diff !== 0) {
          return diff;
        }
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      });
  }, [
    availabilityFilter,
    config.type,
    fileModelsByName,
    getQuotaStateForList,
    providerFiles,
    selectedModel,
    sortMode,
    usageSummaryByFileName
  ]);

  const showAllAllowed = visibleFiles.length <= MAX_SHOW_ALL_THRESHOLD;
  const effectiveViewMode: ViewMode = viewMode === 'all' && !showAllAllowed ? 'paged' : viewMode;

  const {
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    syncPageSize,
    goToPage,
    goToPrev,
    goToNext,
    loading: sectionLoading,
    loadingScope,
    setLoading
  } = useQuotaPagination(visibleFiles, DEFAULT_ITEMS_PER_PAGE);

  useEffect(() => {
    if (showAllAllowed) return;
    if (viewMode !== 'all') return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setViewMode('paged');
      setShowTooManyWarning(true);
    });

    return () => {
      cancelled = true;
    };
  }, [showAllAllowed, viewMode]);

  useEffect(() => {
    if (effectiveViewMode === 'all') {
      syncPageSize(Math.max(1, visibleFiles.length));
    } else {
      syncPageSize(Math.min(pageSizePreference, MAX_ITEMS_PER_PAGE));
    }
  }, [effectiveViewMode, pageSizePreference, syncPageSize, visibleFiles.length]);

  const [refreshProgress, setRefreshProgress] = useState<{
    completedCount: number;
    total: number;
  } | null>(null);

  const primeQuotaRefreshState = useCallback(
    (targets: AuthFileItem[]) => {
      if (targets.length === 0) return;
      setQuota((prev) => {
        const nextState = { ...prev };
        targets.forEach((file) => {
          nextState[file.name] = config.buildLoadingState();
        });
        return nextState;
      });
    },
    [config, setQuota]
  );

  const refreshCurrentPage = useCallback(
    async () => {
      const targets = pageItems;
      if (targets.length === 0) {
        showNotification(t('notification.data_refreshed'), 'success');
        return;
      }
      preserveQuotaSnapshot(targets);
      primeQuotaRefreshState(targets);
      setRefreshProgress({ completedCount: 0, total: targets.length });
      try {
        const summary = await loadQuota(targets, 'page', setLoading, (progress) => {
          setRefreshProgress({
            completedCount: progress.completedCount,
            total: progress.total
          });
        });
        if (summary && summary.errorCount === 0) {
          showNotification(t('notification.data_refreshed'), 'success');
          return;
        }
        showNotification(t('notification.refresh_failed'), 'error');
      } finally {
        clearQuotaSnapshot(targets);
        setRefreshProgress(null);
      }
    },
    [
      clearQuotaSnapshot,
      loadQuota,
      pageItems,
      preserveQuotaSnapshot,
      primeQuotaRefreshState,
      setLoading,
      showNotification,
      t
    ]
  );

  useEffect(() => {
    if (loading) return;
    if (providerFiles.length === 0) {
      setQuota({});
      return;
    }
    setQuota((prev) => {
      const nextState: Record<string, TState> = {};
      providerFiles.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [loading, providerFiles, setQuota]);

  const refreshQuotaForFile = useCallback(
    async (file: AuthFileItem) => {
      if (disabled || file.disabled) return;
      if (quota[file.name]?.status === 'loading') return;

      preserveQuotaSnapshot([file]);
      setQuota((prev) => ({
        ...prev,
        [file.name]: config.buildLoadingState()
      }));

      try {
        const data = await config.fetchQuota(file, t);
        setQuota((prev) => ({
          ...prev,
          [file.name]: config.buildSuccessState(data)
        }));
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        setQuota((prev) => ({
          ...prev,
          [file.name]: config.buildErrorState(message, status)
        }));
        showNotification(
          t('auth_files.quota_refresh_failed', { name: file.name, message }),
          'error'
        );
      } finally {
        clearQuotaSnapshot([file]);
      }
    },
    [clearQuotaSnapshot, config, disabled, preserveQuotaSnapshot, quota, setQuota, showNotification, t]
  );

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t(`${config.i18nPrefix}.title`)}</span>
      {visibleFiles.length > 0 && <span className={styles.countBadge}>{visibleFiles.length}</span>}
    </div>
  );

  const isRefreshing = sectionLoading || loading;
  const isRefreshingPage = isRefreshing && loadingScope === 'page';
  const paginationItems = buildPaginationItems(currentPage, totalPages);
  const refreshProgressLabel =
    refreshProgress === null
      ? null
      : t('quota_management.refresh_progress', {
          label: t('quota_management.refresh_page_short'),
          completed: refreshProgress.completedCount,
          total: refreshProgress.total
        });

  return (
    <Card
      title={titleNode}
      extra={
        <div className={styles.headerActions}>
          <div className={styles.viewModeToggle}>
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'paged' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => setViewMode('paged')}
            >
              {t('auth_files.view_mode_paged')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'all' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => {
                if (visibleFiles.length > MAX_SHOW_ALL_THRESHOLD) {
                  setShowTooManyWarning(true);
                } else {
                  setViewMode('all');
                }
              }}
            >
              {t('auth_files.view_mode_all')}
            </Button>
          </div>
          {refreshProgressLabel && <div className={styles.refreshProgressBadge}>{refreshProgressLabel}</div>}
          <div className={styles.refreshActions}>
            <Button
              variant="secondary"
              size="sm"
              className={styles.refreshPageButton}
              onClick={() => void refreshCurrentPage()}
              disabled={disabled || isRefreshing}
              loading={isRefreshingPage}
              title={t('quota_management.refresh_page_credentials')}
              aria-label={t('quota_management.refresh_page_credentials')}
            >
              {!isRefreshingPage && <IconRefreshCw size={16} />}
              {t('quota_management.refresh_page_credentials')}
            </Button>
          </div>
        </div>
      }
    >
      {visibleFiles.length === 0 ? (
        <EmptyState
          title={
            providerFiles.length === 0
              ? t(`${config.i18nPrefix}.empty_title`)
              : t('quota_management.filtered_empty_title')
          }
          description={
            providerFiles.length === 0
              ? t(`${config.i18nPrefix}.empty_desc`)
              : t('quota_management.filtered_empty_desc')
          }
        />
      ) : (
        <>
          <div ref={gridRef} className={config.gridClassName}>
            {pageItems.map((item) => {
              const usageSummary = usageSummaryByFileName.get(item.name) ?? buildEmptyUsageSummary(usageStatsReady);
              const antigravityGroups =
                config.type === 'antigravity' ? getAntigravityGroups(quota[item.name]) : [];
              const detailsContent =
                config.type === 'antigravity' &&
                antigravityGroups.some((group) => !ANTIGRAVITY_VISIBLE_GROUP_IDS.has(group.id)) ? (
                  <div className={styles.quotaUsageModalSection}>
                    <div className={styles.quotaUsageModalSectionTitle}>
                      {t('quota_management.antigravity_more_quota')}
                    </div>
                    <div className={styles.quotaUsageModalList}>
                      {antigravityGroups
                        .filter((group) => !ANTIGRAVITY_VISIBLE_GROUP_IDS.has(group.id))
                        .map((group) => (
                          <div key={group.id} className={styles.quotaUsageModalItem}>
                            <span className={styles.quotaUsageModalModel} title={group.models.join(', ')}>
                              {group.label}
                            </span>
                            <span className={styles.quotaUsageModalValue}>
                              {`${Math.round(Math.max(0, Math.min(1, group.remainingFraction)) * 100)}%`}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : null;

              return (
                <QuotaCard
                  key={item.name}
                  item={item}
                  quota={quota[item.name]}
                  usedTokens={usageSummary.totalTokens}
                  usageStartedAtMs={usageSummary.startedAtMs}
                  inputTokens={usageSummary.inputTokens}
                  outputTokens={usageSummary.outputTokens}
                  cachedTokens={usageSummary.cachedTokens}
                  reasoningTokens={usageSummary.reasoningTokens}
                  topModels={usageSummary.models}
                  resolvedTheme={resolvedTheme}
                  i18nPrefix={config.i18nPrefix}
                  cardIdleMessageKey={config.cardIdleMessageKey}
                  cardClassName={config.cardClassName}
                  defaultType={config.type}
                  detailsContent={detailsContent}
                  canRefresh={!disabled && !item.disabled}
                  onRefresh={() => void refreshQuotaForFile(item)}
                  renderQuotaItems={config.renderQuotaItems}
                />
              );
            })}
          </div>
          {effectiveViewMode === 'paged' && (
            <div className={styles.pagination}>
              <div className={styles.paginationMeta}>
                <div className={styles.pageSizeControl}>
                  <label htmlFor={`${config.type}-page-size`}>{t('quota_management.page_size_label')}</label>
                  <select
                    id={`${config.type}-page-size`}
                    className={styles.pageSizeSelect}
                    value={pageSizePreference}
                    onChange={(event) => {
                      const nextPageSize = Number(event.target.value);
                      setPageSizePreference(nextPageSize);
                      setPageSize(nextPageSize);
                    }}
                    disabled={isRefreshing}
                  >
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {t('quota_management.page_size_option', { count: option })}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.pageInfo}>
                  {t('auth_files.pagination_info', {
                    current: currentPage,
                    total: totalPages,
                    count: visibleFiles.length
                  })}
                </div>
              </div>

              <div className={styles.paginationControls}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={goToPrev}
                  disabled={currentPage <= 1}
                >
                  {t('auth_files.pagination_prev')}
                </Button>
                <div className={styles.paginationNumbers}>
                  {paginationItems.map((item, index) =>
                    item === 'ellipsis' ? (
                      <span
                        key={`ellipsis-${currentPage}-${index}`}
                        className={styles.paginationEllipsis}
                      >
                        ...
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        className={`${styles.paginationNumberButton} ${
                          item === currentPage ? styles.paginationNumberButtonActive : ''
                        }`}
                        onClick={() => goToPage(item)}
                        aria-current={item === currentPage ? 'page' : undefined}
                      >
                        {item}
                      </button>
                    )
                  )}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={goToNext}
                  disabled={currentPage >= totalPages}
                >
                  {t('auth_files.pagination_next')}
                </Button>
              </div>

              <div className={styles.paginationJump}>
                <label htmlFor={`${config.type}-page-jump`}>
                  {t('quota_management.page_jump_label')}
                </label>
                <input
                  id={`${config.type}-page-jump`}
                  type="number"
                  min={1}
                  max={totalPages}
                  inputMode="numeric"
                  className={styles.paginationJumpInput}
                  value={pageJumpValue}
                  onChange={(event) => setPageJumpValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    const targetPage = Number(pageJumpValue);
                    if (!Number.isFinite(targetPage)) return;
                    goToPage(targetPage);
                    setPageJumpValue('');
                  }}
                  placeholder={t('quota_management.page_jump_placeholder', { total: totalPages })}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const targetPage = Number(pageJumpValue);
                    if (!Number.isFinite(targetPage)) return;
                    goToPage(targetPage);
                    setPageJumpValue('');
                  }}
                  disabled={!pageJumpValue.trim()}
                >
                  {t('quota_management.page_jump_confirm')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {showTooManyWarning && (
        <div className={styles.warningOverlay} onClick={() => setShowTooManyWarning(false)}>
          <div className={styles.warningModal} onClick={(e) => e.stopPropagation()}>
            <p>{t('auth_files.too_many_files_warning')}</p>
            <Button variant="primary" size="sm" onClick={() => setShowTooManyWarning(false)}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
