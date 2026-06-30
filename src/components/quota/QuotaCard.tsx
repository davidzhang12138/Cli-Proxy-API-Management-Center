/**
 * Generic quota card component.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import type { AuthFileItem, ResolvedTheme, ThemeColors } from '@/types';
import type { AuthUsageResponse } from '@/services/api';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { TYPE_COLORS } from '@/utils/quota';
import { maskApiKey } from '@/utils/format';
import { calculateCost, formatCompactNumber, type ModelPrice } from '@/utils/usage';
import { Modal } from '@/components/ui/Modal';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaStatus = 'idle' | 'loading' | 'success' | 'error';

export interface QuotaStatusState {
  status: QuotaStatus;
  error?: string;
  errorStatus?: number;
}

export interface QuotaProgressBarProps {
  percent: number | null;
  highThreshold: number;
  mediumThreshold: number;
}

export function QuotaProgressBar({
  percent,
  highThreshold,
  mediumThreshold,
}: QuotaProgressBarProps) {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const normalized = percent === null ? null : clamp(percent, 0, 100);
  const fillClass =
    normalized === null
      ? styles.quotaBarFillMedium
      : normalized >= highThreshold
        ? styles.quotaBarFillHigh
        : normalized >= mediumThreshold
          ? styles.quotaBarFillMedium
          : styles.quotaBarFillLow;
  const widthPercent = Math.round((normalized ?? 0) * 100) / 100;

  return (
    <div className={styles.quotaBar}>
      <div
        className={`${styles.quotaBarFill} ${fillClass}`}
        style={{ width: `${widthPercent}%` }}
      />
    </div>
  );
}

export interface QuotaRenderHelpers {
  styles: typeof styles;
  QuotaProgressBar: (props: QuotaProgressBarProps) => ReactElement;
}

export interface QuotaUsageModelSummary {
  model: string;
  totalTokens: number;
  totalCost: number;
  totalRequests?: number;
  quotaUsageRatio?: number | null;
  latestUsedAtMs?: number | null;
}

const USAGE_DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
};

const formatUsageCost = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  if (value >= 100) return `$${value.toFixed(2)}`;
  if (value >= 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
};

const formatUsageShare = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '--';
  if (value <= 0) return '0.0%';
  return `${value.toFixed(1)}%`;
};

const toAuthUsageModelCost = (
  model: string,
  summary: AuthUsageResponse['models'][string],
  modelPrices: Record<string, ModelPrice>,
  fallbackTokens?: AuthUsageResponse['summary']
): number => {
  const hasGroupedCachedTokens = typeof summary.cached_tokens === 'number';
  const hasGroupedReasoningTokens = typeof summary.reasoning_tokens === 'number';
  const details = Array.isArray(summary.details) ? summary.details : [];

  if (!hasGroupedCachedTokens && details.length > 0) {
    return details.reduce((sum, detail) => (
      sum + calculateCost(
        {
          timestamp: detail.timestamp,
          source: detail.source,
          auth_index: detail.auth_index,
          latency_ms: detail.latency_ms,
          tokens: {
            input_tokens: detail.tokens.input_tokens,
            output_tokens: detail.tokens.output_tokens,
            reasoning_tokens: detail.tokens.reasoning_tokens,
            cached_tokens: detail.tokens.cached_tokens,
            total_tokens: detail.tokens.total_tokens,
          },
          failed: detail.failed,
          __modelName: detail.model || model,
        },
        modelPrices
      )
    ), 0);
  }

  const tokens = fallbackTokens && !hasGroupedCachedTokens
    ? fallbackTokens
    : {
        input_tokens: summary.input_tokens,
        output_tokens: summary.output_tokens,
        reasoning_tokens: hasGroupedReasoningTokens ? summary.reasoning_tokens ?? 0 : 0,
        cached_tokens: hasGroupedCachedTokens ? summary.cached_tokens ?? 0 : 0,
        total_tokens: summary.total_tokens,
      };

  return calculateCost(
    {
      timestamp: '',
      source: '',
      auth_index: null,
      tokens: {
        input_tokens: tokens.input_tokens,
        output_tokens: tokens.output_tokens,
        reasoning_tokens: tokens.reasoning_tokens,
        cached_tokens: tokens.cached_tokens,
        total_tokens: tokens.total_tokens,
      },
      failed: false,
      __modelName: model,
    },
    modelPrices
  );
};

interface QuotaCardProps<TState extends QuotaStatusState> {
  item: AuthFileItem;
  quota?: TState;
  usedTokens?: number | null;
  usageStartedAtMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  reasoningTokens?: number | null;
  topModels?: QuotaUsageModelSummary[];
  modelPrices?: Record<string, ModelPrice>;
  resolvedTheme: ResolvedTheme;
  i18nPrefix: string;
  cardIdleMessageKey?: string;
  cardClassName: string;
  defaultType: string;
  detailsContent?: ReactNode;
  canRefresh?: boolean;
  onRefresh?: () => void;
  loadAuthUsage?: (item: AuthFileItem) => Promise<AuthUsageResponse>;
  selectionMode?: boolean;
  selected?: boolean;
  onSelectionChange?: () => void;
  resetQuotaAction?: ReactNode;
  renderQuotaItems: (quota: TState, t: TFunction, helpers: QuotaRenderHelpers) => ReactNode;
}

export function QuotaCard<TState extends QuotaStatusState>({
  item,
  quota,
  usedTokens = null,
  usageStartedAtMs = null,
  inputTokens = null,
  outputTokens = null,
  cachedTokens = null,
  reasoningTokens = null,
  topModels = [],
  modelPrices = {},
  resolvedTheme,
  i18nPrefix,
  cardIdleMessageKey,
  cardClassName,
  defaultType,
  detailsContent,
  canRefresh = false,
  onRefresh,
  loadAuthUsage,
  selectionMode = false,
  selected = false,
  onSelectionChange,
  resetQuotaAction,
  renderQuotaItems,
}: QuotaCardProps<TState>) {
  const { t, i18n } = useTranslation();
  const [modelsModalOpen, setModelsModalOpen] = useState(false);
  const [authUsage, setAuthUsage] = useState<AuthUsageResponse | null>(null);
  const [authUsageLoading, setAuthUsageLoading] = useState(false);
  const [authUsageError, setAuthUsageError] = useState<string | null>(null);

  const displayType = item.type || item.provider || defaultType;
  const typeColorSet = TYPE_COLORS[displayType] || TYPE_COLORS.unknown;
  const typeColor: ThemeColors =
    resolvedTheme === 'dark' && typeColorSet.dark ? typeColorSet.dark : typeColorSet.light;

  const quotaStatus = quota?.status ?? 'idle';
  const quotaLoading = quotaStatus === 'loading';
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );
  const authUsageWindowStartMs = authUsage ? Date.parse(authUsage.window_start) : Number.NaN;
  const authUsageWindowEndMs = authUsage ? Date.parse(authUsage.window_end) : Number.NaN;
  const effectiveUsageStartedAtMs =
    authUsage && Number.isFinite(authUsageWindowStartMs) ? authUsageWindowStartMs : usageStartedAtMs;
  const authUsageWindowEnd =
    authUsage && Number.isFinite(authUsageWindowEndMs)
      ? new Intl.DateTimeFormat(i18n.resolvedLanguage, USAGE_DATE_FORMAT_OPTIONS).format(
          authUsageWindowEndMs
        )
      : null;
  const effectiveUsedTokens = authUsage?.summary.total_tokens ?? usedTokens;
  const effectiveInputTokens = authUsage?.summary.input_tokens ?? inputTokens;
  const effectiveOutputTokens = authUsage?.summary.output_tokens ?? outputTokens;
  const effectiveCachedTokens = authUsage?.summary.cached_tokens ?? cachedTokens;
  const effectiveReasoningTokens = authUsage?.summary.reasoning_tokens ?? reasoningTokens;
  const authUsageModelEntries = authUsage ? Object.entries(authUsage.models) : [];
  const authUsageModels = authUsage
    ? authUsageModelEntries
        .map(([model, summary]) => ({
          model,
          totalTokens: summary.total_tokens,
          totalCost: toAuthUsageModelCost(
            model,
            summary,
            modelPrices,
            authUsageModelEntries.length === 1 ? authUsage.summary : undefined
          ),
          totalRequests: summary.total_requests,
          quotaUsageRatio: null,
          latestUsedAtMs: null,
        }))
        .sort((left, right) => {
          const tokenDiff = right.totalTokens - left.totalTokens;
          if (tokenDiff !== 0) return tokenDiff;
          return left.model.localeCompare(right.model, undefined, { sensitivity: 'base' });
        })
    : topModels;
  const authUsageApiKeys = authUsage
    ? Object.entries(authUsage.api_keys)
        .map(([apiKey, summary]) => ({ apiKey, summary }))
        .sort((left, right) => {
          const tokenDiff = right.summary.total_tokens - left.summary.total_tokens;
          if (tokenDiff !== 0) return tokenDiff;
          return left.apiKey.localeCompare(right.apiKey, undefined, { sensitivity: 'base' });
        })
    : [];
  const usageStartedAt =
    effectiveUsageStartedAtMs === null
      ? null
      : new Intl.DateTimeFormat(i18n.resolvedLanguage, USAGE_DATE_FORMAT_OPTIONS).format(
          effectiveUsageStartedAtMs
        );
  const usageMetaText = usageStartedAt
    ? t('quota_management.usage_since', { time: usageStartedAt })
    : effectiveUsedTokens === 0
      ? t('quota_management.usage_no_data')
      : t('system_info.not_loaded');
  const idleMessageKey = onRefresh
    ? `${i18nPrefix}.idle`
    : (cardIdleMessageKey ?? `${i18nPrefix}.idle`);
  const usageBreakdownItems = [
    { key: 'input', label: t('usage_stats.input_tokens'), value: effectiveInputTokens },
    { key: 'output', label: t('usage_stats.output_tokens'), value: effectiveOutputTokens },
    { key: 'cached', label: t('usage_stats.cached_tokens'), value: effectiveCachedTokens },
    { key: 'reasoning', label: t('usage_stats.reasoning_tokens'), value: effectiveReasoningTokens }
  ];
  const hasUsageModels = authUsageModels.length > 0;
  const totalUsageCost = authUsageModels.reduce((sum, model) => sum + model.totalCost, 0);
  const hasUsageData =
    effectiveUsedTokens !== null ||
    usageStartedAt !== null ||
    effectiveInputTokens !== null ||
    effectiveOutputTokens !== null ||
    effectiveCachedTokens !== null ||
    effectiveReasoningTokens !== null ||
    hasUsageModels;

  const refreshAuthUsage = () => {
    if (!loadAuthUsage) return;
    setAuthUsageLoading(true);
    setAuthUsageError(null);
    void loadAuthUsage(item)
      .then((response) => {
        setAuthUsage(response);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error || '');
        setAuthUsageError(message || t('common.unknown_error'));
      })
      .finally(() => {
        setAuthUsageLoading(false);
      });
  };

  const openModelsModal = () => {
    if (selectionMode) {
      onSelectionChange?.();
      return;
    }
    setModelsModalOpen(true);
    refreshAuthUsage();
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (selectionMode) {
      onSelectionChange?.();
      return;
    }
    setModelsModalOpen(true);
    refreshAuthUsage();
  };

  const getTypeLabel = (type: string): string => {
    const key = `auth_files.filter_${type}`;
    const translated = t(key);
    if (translated !== key) return translated;
    if (type.toLowerCase() === 'iflow') return 'iFlow';
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  return (
    <>
    <div
      className={`${styles.fileCard} ${cardClassName} ${styles.fileCardClickable}${selected ? ` ${styles.fileCardSelected}` : ''}`}
      onClick={openModelsModal}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-label={t('quota_management.top_models_modal_title', { name: item.name })}
    >
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderMain}>
          {selectionMode && (
            <div
              className={styles.cardSelectionCheckbox}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.stopPropagation();
                }
              }}
            >
              <SelectionCheckbox
                checked={selected}
                onChange={() => onSelectionChange?.()}
                ariaLabel={t('quota_management.top_models_modal_title', { name: item.name })}
              />
            </div>
          )}
          <span
            className={styles.typeBadge}
            style={{
              backgroundColor: typeColor.bg,
              color: typeColor.text,
              ...(typeColor.border ? { border: typeColor.border } : {})
            }}
          >
            {getTypeLabel(displayType)}
          </span>
          <span className={styles.fileName}>{item.name}</span>
        </div>
        {onRefresh && (
          <button
            type="button"
            className={styles.cardRefreshButton}
            onClick={(event) => {
              event.stopPropagation();
              onRefresh();
            }}
            onKeyDown={(event) => event.stopPropagation()}
            disabled={!canRefresh || quotaStatus === 'loading'}
            title={t('auth_files.quota_refresh_hint')}
            aria-label={t('auth_files.quota_refresh_single')}
          >
            <IconRefreshCw
              size={15}
              className={quotaStatus === 'loading' ? styles.cardRefreshIconSpinning : undefined}
            />
          </button>
        )}
      </div>

      <div className={styles.cardUsageHint}>
        <span className={styles.cardUsageModelsLabel}>{t('quota_management.top_models')}</span>
        <span className={styles.cardUsageHintText}>
          {topModels.length > 0
            ? t('quota_management.top_models_click_hint', { count: topModels.length })
            : t('quota_management.usage_details_click_hint')}
        </span>
      </div>

      <div className={styles.quotaSection} onClick={(event) => event.stopPropagation()}>
        {quotaLoading ? (
          <div className={styles.quotaMessage}>{t(`${i18nPrefix}.loading`)}</div>
        ) : quotaStatus === 'idle' ? (
          <div className={styles.quotaMessage}>{t(idleMessageKey)}</div>
        ) : quotaStatus === 'error' ? (
          <div className={styles.quotaError}>
            {t(`${i18nPrefix}.load_failed`, {
              message: quotaErrorMessage,
            })}
          </div>
        ) : quota ? (
          renderQuotaItems(quota, t, { styles, QuotaProgressBar })
        ) : (
          <div className={styles.quotaMessage}>{t(idleMessageKey)}</div>
        )}
      </div>

      {resetQuotaAction && (
        <div className={styles.quotaCardActions} onClick={(event) => event.stopPropagation()}>
          {resetQuotaAction}
        </div>
      )}
    </div>

    <Modal
      open={modelsModalOpen}
      onClose={() => setModelsModalOpen(false)}
      title={t('quota_management.top_models_modal_title', { name: item.name })}
      width={720}
      className={styles.quotaUsageModal}
    >
      <div className={styles.quotaUsageModalBody}>
        <div className={styles.quotaUsageModalSummaryGrid}>
          <div className={styles.quotaUsageModalSummary}>
            <span className={styles.cardUsageModelsLabel}>{t('quota_management.used_tokens')}</span>
            <strong>
              {effectiveUsedTokens === null
                ? '--'
                : `${formatCompactNumber(effectiveUsedTokens)} Tokens`}
            </strong>
          </div>
          <div className={styles.quotaUsageModalSummary}>
            <span className={styles.cardUsageModelsLabel}>{t('usage_stats.total_cost')}</span>
            <strong>{formatUsageCost(totalUsageCost)}</strong>
          </div>
        </div>
        {authUsageLoading && (
          <div className={styles.quotaUsageModalLoadingBadge}>{t('common.loading')}</div>
        )}
        {authUsageError && (
          <div className={styles.quotaUsageModalError}>
            <span>{authUsageError}</span>
            <button type="button" onClick={refreshAuthUsage}>
              {t('common.refresh')}
            </button>
          </div>
        )}
        <div className={styles.cardUsageMeta}>
          <span className={styles.cardUsageLabel}>{t('quota_management.used_tokens')}</span>
          <span className={styles.cardUsageSubtext} title={usageStartedAt ?? undefined}>
            {usageMetaText}
          </span>
        </div>
        {authUsage && (
          <div className={styles.quotaUsageModalWindow}>
            <span>
              {t('quota_management.usage_window')}: {usageStartedAt ?? '--'}
              {authUsageWindowEnd ? ` - ${authUsageWindowEnd}` : ''}
            </span>
            <span>
              {t(`quota_management.usage_window_source_${authUsage.window_source}`, {
                defaultValue: authUsage.window_source,
              })}
            </span>
          </div>
        )}
        <div className={styles.cardUsageBreakdown}>
          {usageBreakdownItems.map((item) => (
            <div key={item.key} className={styles.cardUsageStat}>
              <span className={styles.cardUsageStatLabel}>{item.label}</span>
              <span
                className={styles.cardUsageStatValue}
                title={item.value === null ? undefined : item.value.toLocaleString()}
              >
                {item.value === null ? '--' : formatCompactNumber(item.value)}
              </span>
            </div>
          ))}
        </div>
        {hasUsageModels ? (
          <div className={styles.quotaUsageModalList}>
            {authUsageModels.map((model) => {
              const requestText =
                typeof model.totalRequests === 'number'
                  ? t('quota_management.usage_requests', {
                      count: model.totalRequests.toLocaleString(),
                    })
                  : null;
              const usageLine = authUsage
                ? [
                    `${formatCompactNumber(model.totalTokens)} Tokens`,
                    requestText,
                    formatUsageCost(model.totalCost),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : t('quota_management.top_models_usage_value', {
                    tokens: `${formatCompactNumber(model.totalTokens)} Tokens`,
                    share: formatUsageShare(
                      model.quotaUsageRatio === null || model.quotaUsageRatio === undefined
                        ? null
                        : model.quotaUsageRatio * 100
                    ),
                    cost: formatUsageCost(model.totalCost),
                  });
              const usageLineTitle = authUsage
                ? [
                    `${model.totalTokens.toLocaleString()} Tokens`,
                    requestText,
                    formatUsageCost(model.totalCost),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : t('quota_management.top_models_usage_value', {
                    tokens: `${model.totalTokens.toLocaleString()} Tokens`,
                    share: formatUsageShare(
                      model.quotaUsageRatio === null || model.quotaUsageRatio === undefined
                        ? null
                        : model.quotaUsageRatio * 100
                    ),
                    cost: formatUsageCost(model.totalCost),
                  });

              return (
                <div key={model.model} className={styles.quotaUsageModalItem}>
                  <span className={styles.quotaUsageModalModel} title={model.model}>
                    {model.model}
                  </span>
                  <span className={styles.quotaUsageModalValue} title={usageLineTitle}>
                    {usageLine}
                  </span>
                </div>
              );
            })}
          </div>
        ) : !hasUsageData && !detailsContent ? (
          <div className={styles.quotaMessage}>{t('quota_management.usage_no_data')}</div>
        ) : null}
        {authUsageApiKeys.length > 0 && (
          <div className={styles.quotaUsageModalSection}>
            <div className={styles.quotaUsageModalSectionTitle}>
              {t('quota_management.usage_api_keys')}
            </div>
            <div className={styles.quotaUsageModalList}>
              {authUsageApiKeys.map(({ apiKey, summary }) => (
                <div key={apiKey} className={styles.quotaUsageModalItem}>
                  <span className={styles.quotaUsageModalModel} title={apiKey}>
                    {maskApiKey(apiKey)}
                  </span>
                  <span
                    className={styles.quotaUsageModalValue}
                    title={`${summary.total_tokens.toLocaleString()} Tokens`}
                  >
                    {`${formatCompactNumber(summary.total_tokens)} Tokens · ${t('quota_management.usage_requests', { count: summary.total_requests.toLocaleString() })}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {detailsContent}
      </div>
    </Modal>
    </>
  );
}

const resolveQuotaErrorMessage = (
  t: TFunction,
  status: number | undefined,
  fallback: string
): string => {
  if (status === 404) return t('common.quota_update_required');
  if (status === 403) return t('common.quota_check_credential');
  return fallback;
};
