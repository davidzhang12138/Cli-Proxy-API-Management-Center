import { useTranslation } from 'react-i18next';
import type { FreebuffQuotaState, UsageQuotaResource } from '@/types';
import { formatQuotaResetTime, resolveUsageQuotaResourceResetAt } from '@/utils/quota';
import { QuotaMeter } from '../../components/QuotaMeter';
import type { QuotaBodyProps } from '../../types';

const formatNumber = (value: number): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);

const formatWindowDuration = (seconds: number | null): string | null => {
  if (seconds === null || seconds <= 0) return null;
  if (seconds % 86_400 === 0) return `${formatNumber(seconds / 86_400)}d`;
  if (seconds % 3_600 === 0) return `${formatNumber(seconds / 3_600)}h`;
  return `${formatNumber(seconds / 60)}m`;
};

const resourceLimit = (resource: UsageQuotaResource): number | null =>
  resource.totalLimit ??
  (resource.currentUsage !== null && resource.remaining !== null
    ? resource.currentUsage + resource.remaining
    : null);

const resourceRemaining = (resource: UsageQuotaResource, limit: number | null): number | null =>
  resource.remaining ??
  (limit !== null && resource.currentUsage !== null
    ? Math.max(0, limit - resource.currentUsage)
    : resource.exhausted
      ? 0
      : null);

const RESOURCE_LABEL_KEYS: Record<string, string> = {
  freebuff_sessions: 'freebuff_quota.resource_sessions',
  freebuff_premium_sessions: 'freebuff_quota.resource_premium_sessions',
  freebuff_limited_sessions: 'freebuff_quota.resource_limited_sessions',
  freebuff_unlimited_models: 'freebuff_quota.resource_unlimited_models',
  provider_spend: 'freebuff_quota.resource_provider_spend',
};

export function FreebuffQuotaBody({ quota, classes }: QuotaBodyProps<FreebuffQuotaState>) {
  const { t } = useTranslation();
  const snapshot = quota.snapshot;
  if (!snapshot) {
    return <div className={classes.quotaMessage}>{t('freebuff_quota.empty_data')}</div>;
  }

  const baseResources: UsageQuotaResource[] =
    snapshot.resources.length > 0
      ? snapshot.resources
      : [
          {
            resourceType: snapshot.resourceType,
            totalLimit: snapshot.totalLimit,
            limitHint: snapshot.limitHint ?? null,
            currentUsage: snapshot.currentUsage,
            remaining: snapshot.remaining,
            minimumCreditAmountForUsage: null,
            windowSeconds: null,
            resetAt: snapshot.nextReset,
            exhausted: snapshot.globalExhausted || snapshot.exhausted,
            usageUnknown: snapshot.usageUnknown,
            unlimited: snapshot.unlimited,
          },
        ];
  const hasProviderSpend = baseResources.some(
    (resource) => resource.resourceType?.toLowerCase() === 'provider_spend'
  );
  const sourceResources =
    snapshot.globalExhausted && !hasProviderSpend
      ? [
          ...baseResources,
          {
            resourceType: 'provider_spend',
            totalLimit: null,
            limitHint: null,
            currentUsage: null,
            remaining: null,
            minimumCreditAmountForUsage: null,
            windowSeconds: null,
            resetAt: snapshot.nextReset,
            exhausted: true,
          },
        ]
      : baseResources;
  const resources = sourceResources
    .filter(
      (resource) =>
        resource.totalLimit !== null ||
        (resource.limitHint !== null && resource.limitHint !== undefined) ||
        resource.currentUsage !== null ||
        resource.remaining !== null ||
        resource.exhausted ||
        resource.usageUnknown ||
        resource.unlimited ||
        Boolean(resource.entitlementBreakdown) ||
        Boolean(resource.sharedPool)
    )
    .sort((left, right) => {
      const leftSpend = left.resourceType?.toLowerCase() === 'provider_spend' ? 1 : 0;
      const rightSpend = right.resourceType?.toLowerCase() === 'provider_spend' ? 1 : 0;
      return leftSpend - rightSpend;
    });

  if (resources.length === 0) {
    return <div className={classes.quotaMessage}>{t('freebuff_quota.empty_data')}</div>;
  }

  return (
    <>
      {resources.map((resource, index) => {
        const limit = resourceLimit(resource);
        const remaining = resourceRemaining(resource, limit);
        const percent =
          limit !== null && limit > 0 && remaining !== null
            ? Math.max(0, Math.min(100, Math.round((remaining / limit) * 100)))
            : resource.exhausted
              ? 0
              : null;
        const resetLabel = formatQuotaResetTime(
          resolveUsageQuotaResourceResetAt(snapshot, resource)
        );
        const windowDuration = formatWindowDuration(resource.windowSeconds);
        const rawResourceType =
          resource.resourceType || snapshot.resourceType || 'freebuff_sessions';
        const labelKey = RESOURCE_LABEL_KEYS[rawResourceType.toLowerCase()];
        const label = labelKey ? t(labelKey) : rawResourceType;
        const models = resource.models ?? [];
        const modelList = models.join(', ');
        const showModelScope =
          models.length > 0 &&
          (resource.shared ||
            models.length > 1 ||
            models[0].toLowerCase() !== rawResourceType.toLowerCase());
        const modelScopeLabel = showModelScope
          ? t(resource.shared ? 'freebuff_quota.shared_models' : 'freebuff_quota.models', {
              models: modelList,
            })
          : null;
        const showUsageUnknown =
          resource.usageUnknown && !resource.unlimited && !resource.exhausted && remaining === null;
        const entitlementBreakdown = resource.entitlementBreakdown;
        const entitlementParts = entitlementBreakdown
          ? [
              entitlementBreakdown.base !== null
                ? t('freebuff_quota.base_sessions', {
                    count: formatNumber(entitlementBreakdown.base),
                  })
                : null,
              entitlementBreakdown.referral !== null
                ? t('freebuff_quota.referral_bonus', {
                    count: formatNumber(entitlementBreakdown.referral),
                  })
                : null,
              entitlementBreakdown.streak !== null
                ? t('freebuff_quota.streak_bonus', {
                    count: formatNumber(entitlementBreakdown.streak),
                  })
                : null,
            ].filter((part): part is string => Boolean(part))
          : [];
        const entitlementLabel = entitlementParts.length > 0 ? entitlementParts.join(' · ') : null;
        const sharedPool = resource.sharedPool;
        const sharedPoolRemaining = sharedPool?.remaining ?? (sharedPool?.exhausted ? 0 : null);
        const sharedPoolLabel =
          sharedPool && sharedPoolRemaining !== null && sharedPool.totalLimit !== null
            ? t('freebuff_quota.shared_pool_remaining', {
                remaining: formatNumber(sharedPoolRemaining),
                total: formatNumber(sharedPool.totalLimit),
              })
            : null;

        return (
          <div key={`${rawResourceType}-${index}`} className={classes.quotaRow}>
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel} title={modelList || rawResourceType}>
                {label}
              </span>
              <div className={classes.quotaMeta}>
                <span className={classes.quotaPercent}>
                  {resource.unlimited ? '∞' : percent === null ? '--' : `${percent}%`}
                </span>
                {resource.unlimited ? (
                  <span className={classes.quotaAmount}>{t('freebuff_quota.unlimited')}</span>
                ) : remaining !== null && limit !== null ? (
                  <span className={classes.quotaAmount}>
                    {t('freebuff_quota.remaining_amount', {
                      remaining: formatNumber(remaining),
                      total: formatNumber(limit),
                    })}
                  </span>
                ) : resource.exhausted ? (
                  <span className={classes.quotaAmount}>{t('freebuff_quota.exhausted')}</span>
                ) : remaining !== null ? (
                  <span className={classes.quotaAmount}>
                    {t('freebuff_quota.remaining_only', {
                      remaining: formatNumber(remaining),
                    })}
                  </span>
                ) : resource.limitHint !== null && resource.limitHint !== undefined ? (
                  <span className={classes.quotaAmount}>
                    {t('freebuff_quota.limit_hint', {
                      limit: formatNumber(resource.limitHint),
                    })}
                  </span>
                ) : null}
                {showUsageUnknown ? (
                  <span className={classes.quotaAmount}>{t('freebuff_quota.usage_unknown')}</span>
                ) : null}
                {resetLabel !== '-' ? (
                  <span className={classes.quotaReset}>
                    {t('freebuff_quota.reset_at', { time: resetLabel })}
                  </span>
                ) : windowDuration ? (
                  <span className={classes.quotaReset}>
                    {t('freebuff_quota.window', { duration: windowDuration })}
                  </span>
                ) : null}
              </div>
            </div>
            {modelScopeLabel ? (
              <div className={classes.quotaScope} title={modelList}>
                {modelScopeLabel}
              </div>
            ) : null}
            {entitlementLabel ? <div className={classes.quotaScope}>{entitlementLabel}</div> : null}
            {sharedPoolLabel ? <div className={classes.quotaScope}>{sharedPoolLabel}</div> : null}
            {percent !== null ? (
              <QuotaMeter percent={percent} classes={classes} index={index} />
            ) : null}
          </div>
        );
      })}
    </>
  );
}
