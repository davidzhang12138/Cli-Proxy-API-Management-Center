/**
 * Kiro 额度渲染体：订阅、基础额度、奖励额度与合计额度。
 */

import { useTranslation } from 'react-i18next';
import type { KiroQuotaState } from '@/types';
import { formatQuotaResetTime } from '@/utils/quota';
import { QuotaMeter } from '../../components/QuotaMeter';
import type { QuotaBodyProps } from '../../types';
import { getEffectiveKiroQuotaState } from './data';

const remainingPercent = (remaining: number | null, limit: number | null): number | null => {
  if (remaining === null || limit === null || limit <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((remaining / limit) * 100)));
};

export function KiroQuotaBody({ quota, classes }: QuotaBodyProps<KiroQuotaState>) {
  const { t } = useTranslation();
  const effectiveQuota = getEffectiveKiroQuotaState(quota);
  const formatResourceType = (value: string): string => {
    const key = `kiro_quota.resource_${value.trim().toLowerCase()}`;
    const translated = t(key);
    return translated === key ? value : translated;
  };

  const basePercent = remainingPercent(effectiveQuota.baseRemaining, effectiveQuota.baseLimit);
  const bonusPercent = remainingPercent(effectiveQuota.bonusRemaining, effectiveQuota.bonusLimit);
  const totalPercent = remainingPercent(
    effectiveQuota.remainingCredits,
    effectiveQuota.usageLimit
  );
  const rows = [
    {
      id: 'base',
      label: t('kiro_quota.base_credits_label'),
      remaining: effectiveQuota.baseRemaining,
      limit: effectiveQuota.baseLimit,
      percent: basePercent,
      reset: effectiveQuota.nextReset,
    },
    {
      id: 'bonus',
      label: t('kiro_quota.bonus_credits_label'),
      remaining: effectiveQuota.bonusRemaining,
      limit: effectiveQuota.bonusLimit,
      percent: bonusPercent,
      reset: effectiveQuota.bonusNextReset,
    },
    {
      id: 'total',
      label: t('kiro_quota.total_credits_label'),
      remaining: effectiveQuota.remainingCredits,
      limit: effectiveQuota.usageLimit,
      percent: totalPercent,
      reset: undefined,
    },
  ].filter((row) => typeof row.limit === 'number' && row.limit > 0);

  if (rows.length === 0 && !effectiveQuota.subscriptionType) {
    return <div className={classes.quotaMessage}>{t('kiro_quota.empty_data')}</div>;
  }

  return (
    <>
      {effectiveQuota.subscriptionType && (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanLabel}>{t('kiro_quota.subscription_label')}</span>
          <span className={classes.codexPlanValue}>
            {formatResourceType(effectiveQuota.subscriptionType)}
          </span>
        </div>
      )}
      {rows.map((row, index) => {
        const resetLabel = formatQuotaResetTime(row.reset);
        return (
          <div key={row.id} className={classes.quotaRow}>
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>{row.label}</span>
              <div className={classes.quotaMeta}>
                <span className={classes.quotaPercent}>
                  {row.percent === null ? '--' : `${row.percent}%`}
                </span>
                {row.remaining !== null && (
                  <span className={classes.quotaAmount}>
                    {t('kiro_quota.remaining_credits', {
                      count: Math.round(row.remaining),
                    })}
                  </span>
                )}
                {resetLabel !== '-' && (
                  <span className={classes.quotaReset}>{resetLabel}</span>
                )}
              </div>
            </div>
            <QuotaMeter percent={row.percent} classes={classes} index={index} />
          </div>
        );
      })}
    </>
  );
}
