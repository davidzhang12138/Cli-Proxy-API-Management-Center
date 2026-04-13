/**
 * Generic quota card component.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type { AuthFileItem, ResolvedTheme, ThemeColors } from '@/types';
import { IconRefreshCw } from '@/components/ui/icons';
import { TYPE_COLORS } from '@/utils/quota';
import { formatCompactNumber } from '@/utils/usage';
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
  mediumThreshold
}: QuotaProgressBarProps) {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  const normalized = percent === null ? null : clamp(percent, 0, 100);
  const fillClass =
    normalized === null
      ? styles.quotaBarFillMedium
      : normalized >= highThreshold
        ? styles.quotaBarFillHigh
        : normalized >= mediumThreshold
          ? styles.quotaBarFillMedium
          : styles.quotaBarFillLow;
  const widthPercent = Math.round(normalized ?? 0);

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
  resolvedTheme: ResolvedTheme;
  i18nPrefix: string;
  cardIdleMessageKey?: string;
  cardClassName: string;
  defaultType: string;
  detailsContent?: ReactNode;
  canRefresh?: boolean;
  onRefresh?: () => void;
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
  resolvedTheme,
  i18nPrefix,
  cardIdleMessageKey,
  cardClassName,
  defaultType,
  detailsContent,
  canRefresh = false,
  onRefresh,
  renderQuotaItems
}: QuotaCardProps<TState>) {
  const { t, i18n } = useTranslation();
  const [modelsModalOpen, setModelsModalOpen] = useState(false);

  const displayType = item.type || item.provider || defaultType;
  const typeColorSet = TYPE_COLORS[displayType] || TYPE_COLORS.unknown;
  const typeColor: ThemeColors =
    resolvedTheme === 'dark' && typeColorSet.dark ? typeColorSet.dark : typeColorSet.light;

  const quotaStatus = quota?.status ?? 'idle';
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );
  const usageStartedAt =
    usageStartedAtMs === null
      ? null
      : new Intl.DateTimeFormat(i18n.resolvedLanguage, USAGE_DATE_FORMAT_OPTIONS).format(
          usageStartedAtMs
        );
  const usageMetaText = usageStartedAt
    ? t('quota_management.usage_since', { time: usageStartedAt })
    : usedTokens === 0
      ? t('quota_management.usage_no_data')
      : t('system_info.not_loaded');
  const idleMessageKey = cardIdleMessageKey ?? `${i18nPrefix}.idle`;
  const usageBreakdownItems = [
    { key: 'input', label: t('usage_stats.input_tokens'), value: inputTokens },
    { key: 'output', label: t('usage_stats.output_tokens'), value: outputTokens },
    { key: 'cached', label: t('usage_stats.cached_tokens'), value: cachedTokens },
    { key: 'reasoning', label: t('usage_stats.reasoning_tokens'), value: reasoningTokens }
  ];
  const hasUsageModels = topModels.length > 0;
  const hasUsageData =
    usedTokens !== null ||
    usageStartedAt !== null ||
    inputTokens !== null ||
    outputTokens !== null ||
    cachedTokens !== null ||
    reasoningTokens !== null ||
    hasUsageModels;

  const openModelsModal = () => {
    setModelsModalOpen(true);
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setModelsModalOpen(true);
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
      className={`${styles.fileCard} ${cardClassName} ${styles.fileCardClickable}`}
      onClick={openModelsModal}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-label={t('quota_management.top_models_modal_title', { name: item.name })}
    >
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderMain}>
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
          {hasUsageModels
            ? t('quota_management.top_models_click_hint', { count: topModels.length })
            : t('quota_management.usage_details_click_hint')}
        </span>
      </div>

      <div className={styles.quotaSection} onClick={(event) => event.stopPropagation()}>
        {quotaStatus === 'loading' ? (
          <div className={styles.quotaMessage}>{t(`${i18nPrefix}.loading`)}</div>
        ) : quotaStatus === 'idle' ? (
          <div className={styles.quotaMessage}>{t(idleMessageKey)}</div>
        ) : quotaStatus === 'error' ? (
          <div className={styles.quotaError}>
            {t(`${i18nPrefix}.load_failed`, {
              message: quotaErrorMessage
            })}
          </div>
        ) : quota ? (
          renderQuotaItems(quota, t, { styles, QuotaProgressBar })
        ) : (
          <div className={styles.quotaMessage}>{t(idleMessageKey)}</div>
        )}
      </div>
    </div>

    <Modal
      open={modelsModalOpen}
      onClose={() => setModelsModalOpen(false)}
      title={t('quota_management.top_models_modal_title', { name: item.name })}
      width={720}
    >
      <div className={styles.quotaUsageModalBody}>
        <div className={styles.quotaUsageModalSummary}>
          <span className={styles.cardUsageModelsLabel}>{t('quota_management.used_tokens')}</span>
          <strong>{usedTokens === null ? '--' : `${formatCompactNumber(usedTokens)} Tokens`}</strong>
        </div>
        <div className={styles.cardUsageMeta}>
          <span className={styles.cardUsageLabel}>{t('quota_management.used_tokens')}</span>
          <span className={styles.cardUsageSubtext} title={usageStartedAt ?? undefined}>
            {usageMetaText}
          </span>
        </div>
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
            {topModels.map((model) => (
              <div key={model.model} className={styles.quotaUsageModalItem}>
                <span className={styles.quotaUsageModalModel} title={model.model}>
                  {model.model}
                </span>
                <span
                  className={styles.quotaUsageModalValue}
                  title={`${model.totalTokens.toLocaleString()} Tokens · ${formatUsageCost(model.totalCost)}`}
                >
                  {formatCompactNumber(model.totalTokens)} Tokens · {formatUsageCost(model.totalCost)}
                </span>
              </div>
            ))}
          </div>
        ) : !hasUsageData && !detailsContent ? (
          <div className={styles.quotaMessage}>{t('quota_management.usage_no_data')}</div>
        ) : null}
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
