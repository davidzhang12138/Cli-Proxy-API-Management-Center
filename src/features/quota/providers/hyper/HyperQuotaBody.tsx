import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import type { HyperQuotaState } from '@/types';
import {
  buildResetDisplay,
  formatQuotaResetTime,
  parseIsoToMs,
  resolveUsageQuotaResourceResetAt,
} from '@/utils/quota';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import type { QuotaBodyProps } from '../../types';

const formatNumber = (value: number): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);

export function HyperQuotaBody({ quota, classes }: QuotaBodyProps<HyperQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const snapshot = quota.snapshot;
  if (!snapshot) {
    return <div className={classes.quotaMessage}>{t('hyper_quota.empty_data')}</div>;
  }

  const credits = snapshot.resources.find(
    (resource) => resource.resourceType?.toLowerCase() === 'hypercredits'
  );
  const exhausted = credits?.exhausted ?? snapshot.exhausted;
  const balance = credits?.remaining ?? snapshot.remaining ?? (exhausted ? 0 : null);
  const balanceHidden = Boolean(credits?.usageUnknown || snapshot.usageUnknown);
  const resetAt = credits
    ? resolveUsageQuotaResourceResetAt(snapshot, credits)
    : snapshot.nextReset;
  const resetAtMs = parseIsoToMs(resetAt);
  const resetDisplay = buildResetDisplay(
    formatQuotaResetTime(resetAt),
    resetAtMs,
    now,
    i18n.resolvedLanguage
  );

  if (balance === null) {
    if (!balanceHidden) {
      return <div className={classes.quotaMessage}>{t('hyper_quota.empty_data')}</div>;
    }
    return (
      <div className={classes.quotaBalance}>
        <span className={classes.quotaBalanceLabel}>{t('hyper_quota.balance_label')}</span>
        <span className={classes.quotaBalanceState}>{t('hyper_quota.hidden_state')}</span>
        <span className={classes.quotaBalanceValue}>—</span>
        <span className={classes.quotaScope}>{t('hyper_quota.hidden_balance')}</span>
        {resetDisplay && (
          <span className={classes.quotaBalanceReset}>
            <span>{t('hyper_quota.reset_label')}</span>
            <span className={classes.quotaMeta}>
              <QuotaResetLabel display={resetDisplay} classes={classes} />
            </span>
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={classes.quotaBalance}>
      <span className={classes.quotaBalanceLabel}>{t('hyper_quota.balance_label')}</span>
      <span className={classes.quotaBalanceState}>
        {t(exhausted ? 'hyper_quota.exhausted' : 'hyper_quota.available')}
      </span>
      <span
        className={`${classes.quotaBalanceValue} ${
          exhausted ? classes.quotaBalanceValueExhausted : ''
        }`}
      >
        {formatNumber(balance)}
      </span>
      {resetDisplay && (
        <span className={classes.quotaBalanceReset}>
          <span>{t('hyper_quota.reset_label')}</span>
          <span className={classes.quotaMeta}>
            <QuotaResetLabel display={resetDisplay} classes={classes} />
          </span>
        </span>
      )}
    </div>
  );
}
