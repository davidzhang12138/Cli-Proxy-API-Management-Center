import { useTranslation } from 'react-i18next';
import type { HyperQuotaState } from '@/types';
import type { QuotaBodyProps } from '../../types';

const formatNumber = (value: number): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);

export function HyperQuotaBody({ quota, classes }: QuotaBodyProps<HyperQuotaState>) {
  const { t } = useTranslation();
  const snapshot = quota.snapshot;
  if (!snapshot) {
    return <div className={classes.quotaMessage}>{t('hyper_quota.empty_data')}</div>;
  }

  const credits = snapshot.resources.find(
    (resource) => resource.resourceType?.toLowerCase() === 'hypercredits'
  );
  const exhausted = credits?.exhausted ?? snapshot.exhausted;
  const balance = credits?.remaining ?? snapshot.remaining ?? (exhausted ? 0 : null);

  if (balance === null) {
    return <div className={classes.quotaMessage}>{t('hyper_quota.empty_data')}</div>;
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
    </div>
  );
}
