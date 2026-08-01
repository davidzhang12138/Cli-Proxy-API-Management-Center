import type { TFunction } from 'i18next';
import { authFilesApi } from '@/services/api';
import type { AuthFileItem, AuthQuotaEntry, UsageQuotaSnapshot } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { parseUsageQuotaSnapshot } from '@/utils/quota';

const normalizeText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const quotaEntryAuthIndex = (entry: AuthQuotaEntry): string | null =>
  normalizeAuthIndex(entry.auth_index ?? entry.authIndex);

export const selectRefreshedUsageQuota = (
  entries: AuthQuotaEntry[] | undefined,
  file: AuthFileItem,
  provider: string
): UsageQuotaSnapshot | null => {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  const fileId = normalizeText(file.id);
  const providerEntries = entries.filter(
    (entry) => normalizeText(entry.provider).toLowerCase() === provider
  );
  const candidates = providerEntries.length > 0 ? providerEntries : entries;
  const identitylessProviderCandidate =
    providerEntries.length === 1 &&
    quotaEntryAuthIndex(providerEntries[0]) === null &&
    normalizeText(providerEntries[0].id) === ''
      ? providerEntries[0]
      : undefined;
  const matched =
    candidates.find((entry) => authIndex !== null && quotaEntryAuthIndex(entry) === authIndex) ??
    candidates.find((entry) => fileId !== '' && normalizeText(entry.id) === fileId) ??
    identitylessProviderCandidate;

  return matched ? parseUsageQuotaSnapshot(matched.usage_quota ?? matched.usageQuota) : null;
};

export async function refreshUsageQuotaSnapshot(
  file: AuthFileItem,
  provider: string,
  i18nPrefix: string,
  t: TFunction
): Promise<UsageQuotaSnapshot> {
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  if (!authIndex) {
    throw new Error(t(`${i18nPrefix}.missing_auth_index`));
  }

  const response = await authFilesApi.refreshAuthQuotas({ auth_indexes: [authIndex] });
  const snapshot = selectRefreshedUsageQuota(response.auths, file, provider);
  if (!snapshot) {
    throw new Error(t(`${i18nPrefix}.empty_data`));
  }
  if (snapshot.error) {
    throw new Error(snapshot.error);
  }
  if (!snapshot.known) {
    throw new Error(t(`${i18nPrefix}.empty_data`));
  }
  return snapshot;
}

export const buildUsageQuotaSnapshotState = (file: AuthFileItem): UsageQuotaSnapshot | null => {
  const snapshot = parseUsageQuotaSnapshot(file.usage_quota ?? file.usageQuota);
  return snapshot?.known && !snapshot.error ? snapshot : null;
};
