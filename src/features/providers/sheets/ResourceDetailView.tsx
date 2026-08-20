import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import { IconCheck, IconX } from '@/components/ui/icons';
import { getProviderTotalStats, type ProviderRecentUsageMap } from '@/components/providers/utils';
import type { OpenAIProviderConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import { getApiKeyEntryAvailabilityStats } from '../apiKeyEntryStatus';
import type { ProviderResource } from '../types';
import styles from './forms/sharedForm.module.scss';

interface ResourceDetailViewProps {
  resource: ProviderResource;
  usageByProvider?: ProviderRecentUsageMap;
}

export function ResourceDetailView({ resource, usageByProvider }: ResourceDetailViewProps) {
  const { t } = useTranslation();

  const primary: Array<[string, string]> = [
    ['identifier', resource.identifier],
    ['baseUrl', resource.baseUrl ?? t('providersPage.status.notSet')],
    ['proxyUrl', resource.proxyUrl ?? t('providersPage.status.notSet')],
    ['prefix', resource.prefix ?? t('providersPage.status.none')],
    ['models', String(resource.modelCount)],
    ['headers', String(resource.headerCount)],
  ];

  const metadata: Array<[string, string]> = [
    ['authIndex', resource.authIndex ?? t('providersPage.status.notSet')],
    ['excludedModels', String(resource.excludedModelCount)],
    ['apiKeyEntries', String(resource.apiKeyEntryCount)],
  ];

  const openaiConfig =
    resource.brand === 'openaiCompatibility' ? (resource.raw as OpenAIProviderConfig) : null;
  const apiKeyEntries = openaiConfig?.apiKeyEntries ?? [];
  const availabilityStats = getApiKeyEntryAvailabilityStats(apiKeyEntries);

  return (
    <div>
      <div className={styles.detailHeader}>
        <div className={styles.sectionTitle}>{resource.name ?? resource.identifier}</div>
      </div>

      <dl className={styles.dl}>
        {primary.map(([key, value]) => (
          <div key={key}>
            <dt className={styles.dt}>{t(`providersPage.detail.fields.${key}`)}</dt>
            <dd className={styles.dd}>{value}</dd>
          </div>
        ))}
      </dl>

      {openaiConfig && apiKeyEntries.length > 0 ? (
        <div className={styles.apiKeyEntriesSection}>
          <div className={styles.apiKeyEntriesHeader}>
            <div className={styles.apiKeyEntriesLabel}>
              {t('providersPage.form.apiKeyEntriesSection')}: {apiKeyEntries.length}
            </div>
            <div className={styles.entryAvailabilityStats}>
              <span
                className={`${styles.entryAvailabilityStat} ${styles.entryAvailabilityStatActive}`}
              >
                <span>{t('providersPage.form.apiKeyAvailableStat')}</span>
                <strong>{availabilityStats.available}</strong>
              </span>
              <span
                className={`${styles.entryAvailabilityStat} ${styles.entryAvailabilityStatDisabled}`}
              >
                <span>{t('providersPage.form.apiKeyDisabledStat')}</span>
                <strong>{availabilityStats.disabled}</strong>
              </span>
            </div>
          </div>
          <div className={styles.apiKeyEntryList}>
            {apiKeyEntries.map((entry, entryIndex) => {
              const entryStats = usageByProvider
                ? getProviderTotalStats(
                    usageByProvider,
                    openaiConfig.name,
                    entry.apiKey,
                    entry.baseUrl ?? openaiConfig.baseUrl
                  )
                : { success: 0, failure: 0 };
              return (
                <div
                  key={`${entry.apiKey}-${entryIndex}`}
                  className={`${styles.apiKeyEntryCard} ${
                    entry.disabled ? styles.apiKeyEntryCardDisabled : ''
                  }`}
                >
                  <span className={styles.apiKeyEntryIndex}>{entryIndex + 1}</span>
                  <span className={styles.apiKeyEntryKey}>{maskApiKey(entry.apiKey)}</span>
                  {entry.disabled ? (
                    <span className={styles.apiKeyEntryDisabledBadge}>
                      {t('providersPage.form.apiKeyDisabledBadge')}
                    </span>
                  ) : null}
                  {entry.proxyUrl ? (
                    <span className={styles.apiKeyEntryProxy}>{entry.proxyUrl}</span>
                  ) : null}
                  <div className={styles.apiKeyEntryStats}>
                    <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatSuccess}`}>
                      <IconCheck size={12} /> {entryStats.success}
                    </span>
                    <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatFailure}`}>
                      <IconX size={12} /> {entryStats.failure}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Collapsible label={t('providersPage.detail.metadataTitle')}>
          <dl className={styles.dl}>
            {metadata.map(([key, value]) => (
              <div key={key}>
                <dt className={styles.dt}>{t(`providersPage.detail.fields.${key}`)}</dt>
                <dd className={styles.dd}>{value}</dd>
              </div>
            ))}
          </dl>
        </Collapsible>
      </div>
    </div>
  );
}
