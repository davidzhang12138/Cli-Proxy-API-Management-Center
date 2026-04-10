/**
 * Generic quota section component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
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
import type { QuotaConfig } from './quotaConfigs';
import { useGridColumns } from './useGridColumns';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);
type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;
type ViewMode = 'paged' | 'all';
type QuotaAvailabilityFilter = 'all' | 'has' | 'none';
type QuotaSortMode = 'default' | 'quota_desc' | 'quota_asc';

const MAX_ITEMS_PER_PAGE = 25;
const MAX_SHOW_ALL_THRESHOLD = 30;

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

const buildEmptyUsageSummary = (ready: boolean): FileUsageSummary => ({
  totalTokens: ready ? 0 : null,
  inputTokens: ready ? 0 : null,
  outputTokens: ready ? 0 : null,
  cachedTokens: ready ? 0 : null,
  reasoningTokens: ready ? 0 : null,
  startedAtMs: null,
  models: []
});

const getQuotaRemainingRatio = (
  quotaType: QuotaConfig<QuotaStatusState, unknown>['type'],
  quotaState: QuotaStatusState | undefined
): number | null => {
  if (!quotaState || quotaState.status !== 'success') {
    return null;
  }

  switch (quotaType) {
    case 'antigravity': {
      const state = quotaState as AntigravityQuotaState;
      const ratios = state.groups
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
      const ratios = state.windows
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
      const state = quotaState as KiroQuotaState;
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

  const [columns, gridRef] = useGridColumns(380);
  const [viewMode, setViewMode] = useState<ViewMode>('paged');
  const [showTooManyWarning, setShowTooManyWarning] = useState(false);

  const providerFiles = useMemo(() => files.filter((file) => config.filterFn(file)), [files, config]);

  const usageSummaryByFileName = useMemo(() => {
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

      if (modelName) {
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
        summary.models = summary.models.slice(0, 3);
      }

      bucket.set(key, summary);
    };

    usageDetails.forEach((detail) => {
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
  }, [providerFiles, usageDetails, usageStatsReady]);

  const visibleFiles = useMemo(() => {
    const normalizedSelectedModel =
      selectedModel && selectedModel !== 'all' ? normalizeModelKey(selectedModel) : '';

    return [...providerFiles]
      .filter((file) => {
        const ratio = getQuotaRemainingRatio(
          config.type,
          quota[file.name] as QuotaStatusState | undefined
        );
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

        const leftRatio = getQuotaRemainingRatio(
          config.type,
          quota[left.name] as QuotaStatusState | undefined
        );
        const rightRatio = getQuotaRemainingRatio(
          config.type,
          quota[right.name] as QuotaStatusState | undefined
        );

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
    providerFiles,
    quota,
    selectedModel,
    sortMode,
    usageSummaryByFileName
  ]);

  const showAllAllowed = visibleFiles.length <= MAX_SHOW_ALL_THRESHOLD;
  const effectiveViewMode: ViewMode = viewMode === 'all' && !showAllAllowed ? 'paged' : viewMode;

  const {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToPrev,
    goToNext,
    loading: sectionLoading,
    setLoading
  } = useQuotaPagination(visibleFiles);

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
      setPageSize(Math.max(1, visibleFiles.length));
    } else {
      setPageSize(Math.min(columns * 3, MAX_ITEMS_PER_PAGE));
    }
  }, [columns, effectiveViewMode, setPageSize, visibleFiles.length]);

  const pendingQuotaRefreshRef = useRef(false);
  const prevFilesLoadingRef = useRef(loading);

  const handleRefresh = useCallback(() => {
    pendingQuotaRefreshRef.current = true;
    void triggerHeaderRefresh();
  }, []);

  useEffect(() => {
    const wasLoading = prevFilesLoadingRef.current;
    prevFilesLoadingRef.current = loading;

    if (!pendingQuotaRefreshRef.current) return;
    if (loading) return;
    if (!wasLoading) return;

    pendingQuotaRefreshRef.current = false;
    const scope = effectiveViewMode === 'all' ? 'all' : 'page';
    const targets = effectiveViewMode === 'all' ? providerFiles : pageItems;
    if (targets.length === 0) return;
    loadQuota(targets, scope, setLoading);
  }, [effectiveViewMode, loadQuota, loading, pageItems, providerFiles, setLoading]);

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
      }
    },
    [config, disabled, quota, setQuota, showNotification, t]
  );

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t(`${config.i18nPrefix}.title`)}</span>
      {visibleFiles.length > 0 && <span className={styles.countBadge}>{visibleFiles.length}</span>}
    </div>
  );

  const isRefreshing = sectionLoading || loading;

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
          <Button
            variant="secondary"
            size="sm"
            className={styles.refreshAllButton}
            onClick={handleRefresh}
            disabled={disabled || isRefreshing}
            loading={isRefreshing}
            title={t('quota_management.refresh_all_credentials')}
            aria-label={t('quota_management.refresh_all_credentials')}
          >
            {!isRefreshing && <IconRefreshCw size={16} />}
            {t('quota_management.refresh_all_credentials')}
          </Button>
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
                  canRefresh={!disabled && !item.disabled}
                  onRefresh={() => void refreshQuotaForFile(item)}
                  renderQuotaItems={config.renderQuotaItems}
                />
              );
            })}
          </div>
          {visibleFiles.length > pageSize && effectiveViewMode === 'paged' && (
            <div className={styles.pagination}>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToPrev}
                disabled={currentPage <= 1}
              >
                {t('auth_files.pagination_prev')}
              </Button>
              <div className={styles.pageInfo}>
                {t('auth_files.pagination_info', {
                  current: currentPage,
                  total: totalPages,
                  count: visibleFiles.length
                })}
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
