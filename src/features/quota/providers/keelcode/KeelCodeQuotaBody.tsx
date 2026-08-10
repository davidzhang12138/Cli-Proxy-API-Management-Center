import { useTranslation } from 'react-i18next';
import type { KeelCodeQuotaState, UsageQuotaResource } from '@/types';
import { formatQuotaResetTime, resolveUsageQuotaResourceResetAt } from '@/utils/quota';
import { QuotaMeter } from '../../components/QuotaMeter';
import type { QuotaBodyProps } from '../../types';

const formatNumber = (value: number): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);

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

const getResourceLabel = (
  resource: UsageQuotaResource,
  translate: (key: string) => string
): string => {
  const modelId = resource.models?.find((model) => model.trim())?.trim();
  if (resource.modelScoped && modelId) return modelId;

  const resourceType = resource.resourceType;
  const rawType = resourceType?.trim() || 'quota';
  const normalizedType = rawType.toLowerCase();
  const key = `keelcode_quota.resource_${normalizedType}`;
  const translated = translate(key);
  return translated === key ? rawType : translated;
};

export function KeelCodeQuotaBody({ quota, classes }: QuotaBodyProps<KeelCodeQuotaState>) {
  const { t } = useTranslation();
  const snapshot = quota.snapshot;
  if (!snapshot) {
    return <div className={classes.quotaMessage}>{t('keelcode_quota.empty_data')}</div>;
  }

  const resources =
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
          },
        ];

  const visibleResources = resources.filter(
    (resource) =>
      resource.totalLimit !== null ||
      resource.currentUsage !== null ||
      resource.remaining !== null ||
      resource.exhausted
  );

  if (visibleResources.length === 0) {
    return <div className={classes.quotaMessage}>{t('keelcode_quota.empty_data')}</div>;
  }
  const hasModelQuotas = visibleResources.some((resource) => resource.modelScoped);

  return (
    <>
      {hasModelQuotas && (
        <div className={classes.quotaScope}>{t('keelcode_quota.model_quota_notice')}</div>
      )}
      {visibleResources.map((resource, index) => {
        const isModelQuota = resource.modelScoped === true;
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
        const amount =
          remaining !== null && limit !== null
            ? t(
                isModelQuota
                  ? 'keelcode_quota.model_remaining_amount'
                  : 'keelcode_quota.remaining_amount',
                {
                  remaining: formatNumber(remaining),
                  total: formatNumber(limit),
                }
              )
            : resource.exhausted
              ? t('keelcode_quota.exhausted')
              : remaining !== null
                ? t(
                    isModelQuota
                      ? 'keelcode_quota.model_remaining_only'
                      : 'keelcode_quota.remaining_only',
                    { remaining: formatNumber(remaining) }
                  )
                : null;

        return (
          <div key={`${resource.resourceType || 'quota'}-${index}`} className={classes.quotaRow}>
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>{getResourceLabel(resource, t)}</span>
              <div className={classes.quotaMeta}>
                <span className={classes.quotaPercent}>
                  {percent === null ? '--' : `${percent}%`}
                </span>
                {amount && <span className={classes.quotaAmount}>{amount}</span>}
                {resetLabel !== '-' && (
                  <span className={classes.quotaReset}>
                    {t('keelcode_quota.reset_at', { time: resetLabel })}
                  </span>
                )}
              </div>
            </div>
            <QuotaMeter percent={percent} classes={classes} index={index} />
          </div>
        );
      })}
    </>
  );
}
