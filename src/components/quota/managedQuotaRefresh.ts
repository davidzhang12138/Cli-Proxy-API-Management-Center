import { authFilesApi } from '@/services/api';
import type { AuthFileItem, AuthQuotaEntry } from '@/types';
import type { QuotaConfig } from './quotaConfigs';

export type ManagedQuotaRefreshResult<TState> = {
  name: string;
  status: 'success' | 'error';
  state?: TState;
  error?: string;
  fallbackable?: boolean;
};

const readText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const readAuthFileId = (file: AuthFileItem): string => readText(file.id);

const readAuthFileIndex = (file: AuthFileItem): string =>
  readText(file.auth_index ?? file.authIndex);

const readQuotaError = (entry: AuthQuotaEntry): string => {
  const quota = entry.usage_quota ?? entry.usageQuota;
  if (!quota || typeof quota !== 'object') return '';
  return readText((quota as Record<string, unknown>).error);
};

const authFileMatchKeys = (file: AuthFileItem): string[] =>
  [readAuthFileId(file), readAuthFileIndex(file), readText(file.name)].filter(Boolean);

const quotaEntryMatchKeys = (entry: AuthQuotaEntry): string[] =>
  [readText(entry.id), readText(entry.auth_index), readText(entry.authIndex)].filter(Boolean);

const findQuotaEntryForFile = (
  entries: AuthQuotaEntry[],
  file: AuthFileItem
): AuthQuotaEntry | null => {
  const keys = new Set(authFileMatchKeys(file));
  if (keys.size === 0) return null;
  return entries.find((entry) => quotaEntryMatchKeys(entry).some((key) => keys.has(key))) ?? null;
};

const buildAuthFileWithQuotaEntry = (file: AuthFileItem, entry: AuthQuotaEntry): AuthFileItem => {
  const usageQuota = entry.usage_quota ?? entry.usageQuota ?? null;
  return {
    ...file,
    id: entry.id ?? file.id,
    auth_index: entry.auth_index ?? file.auth_index,
    authIndex: entry.authIndex ?? entry.auth_index ?? file.authIndex,
    provider: entry.provider ?? file.provider,
    type: file.type ?? entry.provider,
    label: entry.label ?? file.label,
    account_type: entry.account_type ?? file.account_type,
    accountType: entry.accountType ?? file.accountType,
    account: entry.account ?? file.account,
    status: entry.status ?? file.status,
    disabled: entry.disabled ?? file.disabled,
    unavailable: entry.unavailable ?? file.unavailable,
    success: entry.success ?? file.success,
    failed: entry.failed ?? file.failed,
    usage_quota: usageQuota,
    usageQuota,
  };
};

export const canUseManagedQuotaRefresh = <TState, TData>(
  config: QuotaConfig<TState, TData>,
  targets: AuthFileItem[]
): boolean =>
  typeof config.buildSnapshotState === 'function' &&
  targets.some((file) => readAuthFileId(file) || readAuthFileIndex(file));

export const refreshManagedQuotaStates = async <TState, TData>(
  config: QuotaConfig<TState, TData>,
  targets: AuthFileItem[]
): Promise<ManagedQuotaRefreshResult<TState>[] | null> => {
  if (!canUseManagedQuotaRefresh(config, targets)) return null;

  const ids = Array.from(new Set(targets.map(readAuthFileId).filter(Boolean)));
  const authIndexes = Array.from(new Set(targets.map(readAuthFileIndex).filter(Boolean)));
  const response = await authFilesApi.refreshAuthQuotas({
    ids,
    auth_indexes: authIndexes,
  });
  const entries = Array.isArray(response.auths) ? response.auths : [];

  const results: ManagedQuotaRefreshResult<TState>[] = targets.map((file) => {
    const entry = findQuotaEntryForFile(entries, file);
    if (!entry) {
      return {
        name: file.name,
        status: 'error',
        error: 'Quota snapshot was not returned',
        fallbackable: true,
      };
    }

    const quotaError = readQuotaError(entry);
    if (quotaError) {
      return { name: file.name, status: 'error', error: quotaError };
    }

    const state = config.buildSnapshotState?.(buildAuthFileWithQuotaEntry(file, entry)) ?? null;
    if (!state) {
      return {
        name: file.name,
        status: 'error',
        error: 'Quota snapshot is unavailable',
        fallbackable: true,
      };
    }

    return { name: file.name, status: 'success', state };
  });

  return results.every((result) => result.status === 'error' && result.fallbackable)
    ? null
    : results;
};
