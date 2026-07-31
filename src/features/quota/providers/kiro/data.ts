/**
 * Kiro 额度数据层。React-free / SCSS-free。
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, KiroQuotaState } from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  KIRO_QUOTA_URL,
  KIRO_REQUEST_HEADERS,
  buildKiroQuotaDataFromUsageQuota,
  createStatusError,
  isDisabledAuthFile,
  isKiroFile,
  normalizeNumberValue,
  normalizeStringValue,
  parseKiroQuotaPayload,
  toFutureKiroResetIso,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';

export type KiroQuotaData = Omit<KiroQuotaState, 'status' | 'error' | 'errorStatus'>;

const KIRO_INACTIVE_BONUS_STATUSES = new Set(['EXPIRED', 'INACTIVE', 'ENDED', 'TERMINATED']);

const isExpiredIsoTimestamp = (value?: string): boolean => {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
};

export const hasActiveKiroBonus = (
  quota: Pick<KiroQuotaState, 'bonusLimit' | 'bonusStatus' | 'bonusNextReset'>
): boolean => {
  const bonusStatusUpper = normalizeStringValue(quota.bonusStatus)?.toUpperCase() ?? '';
  return (
    typeof quota.bonusLimit === 'number' &&
    quota.bonusLimit > 0 &&
    !KIRO_INACTIVE_BONUS_STATUSES.has(bonusStatusUpper) &&
    !isExpiredIsoTimestamp(quota.bonusNextReset)
  );
};

export const getEffectiveKiroQuotaState = (quota: KiroQuotaState): KiroQuotaState => {
  const activeBonus = hasActiveKiroBonus(quota);
  const effectiveBonusUsage = activeBonus ? quota.bonusUsage : null;
  const effectiveBonusLimit = activeBonus ? quota.bonusLimit : null;
  const effectiveBonusRemaining =
    activeBonus && typeof quota.bonusLimit === 'number' && typeof quota.bonusUsage === 'number'
      ? Math.max(0, quota.bonusLimit - quota.bonusUsage)
      : null;

  const baseUsage = quota.baseUsage;
  const baseLimit = quota.baseLimit;
  const currentUsage =
    (typeof baseUsage === 'number' ? baseUsage : 0) +
    (typeof effectiveBonusUsage === 'number' ? effectiveBonusUsage : 0);
  const usageLimit =
    (typeof baseLimit === 'number' ? baseLimit : 0) +
    (typeof effectiveBonusLimit === 'number' ? effectiveBonusLimit : 0);
  const remainingCredits =
    usageLimit > 0
      ? Math.max(
          0,
          (typeof quota.baseRemaining === 'number' ? quota.baseRemaining : 0) +
            (typeof effectiveBonusRemaining === 'number' ? effectiveBonusRemaining : 0)
        )
      : null;

  return {
    ...quota,
    bonusStatus: activeBonus ? quota.bonusStatus : undefined,
    bonusUsage: effectiveBonusUsage,
    bonusLimit: effectiveBonusLimit,
    bonusRemaining: effectiveBonusRemaining,
    bonusNextReset: activeBonus ? quota.bonusNextReset : undefined,
    currentUsage: usageLimit > 0 ? currentUsage : baseUsage,
    usageLimit: usageLimit > 0 ? usageLimit : baseLimit,
    remainingCredits,
  };
};

const normalizeKiroTimestamp = (...values: unknown[]): number | null => {
  for (const value of values) {
    const normalized = normalizeNumberValue(value);
    if (normalized === null || normalized <= 0) continue;
    if (normalized > 1_000_000_000_000) return Math.round(normalized);
    if (normalized > 1_000_000_000) return Math.round(normalized * 1000);
  }
  return null;
};

const fetchKiroQuota = async (file: AuthFileItem, t: TFunction): Promise<KiroQuotaData> => {
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  if (!authIndex) {
    throw new Error(t('kiro_quota.missing_auth_index'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: KIRO_QUOTA_URL,
    header: { ...KIRO_REQUEST_HEADERS },
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseKiroQuotaPayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('kiro_quota.empty_data'));
  }

  const breakdownList = Array.isArray(payload.usageBreakdownList) ? payload.usageBreakdownList : [];
  let baseLimit = 0;
  let baseUsage = 0;
  let bonusLimit = 0;
  let bonusUsage = 0;
  let bonusStatus: string | undefined;
  let bonusNextResetTimestamp: number | null = null;

  breakdownList.forEach((breakdown) => {
    const limit = normalizeNumberValue(breakdown.usageLimitWithPrecision ?? breakdown.usageLimit);
    const usage = normalizeNumberValue(
      breakdown.currentUsageWithPrecision ?? breakdown.currentUsage
    );
    if (limit !== null) baseLimit += limit;
    if (usage !== null) baseUsage += usage;

    const freeTrialInfo = breakdown.freeTrialInfo;
    if (!freeTrialInfo) return;

    const freeLimit = normalizeNumberValue(
      freeTrialInfo.usageLimitWithPrecision ?? freeTrialInfo.usageLimit
    );
    const freeUsage = normalizeNumberValue(
      freeTrialInfo.currentUsageWithPrecision ?? freeTrialInfo.currentUsage
    );
    if (freeLimit !== null) bonusLimit += freeLimit;
    if (freeUsage !== null) bonusUsage += freeUsage;
    if (freeTrialInfo.freeTrialStatus) bonusStatus = freeTrialInfo.freeTrialStatus;
    bonusNextResetTimestamp ??= normalizeKiroTimestamp(
      freeTrialInfo.freeTrialExpiry,
      freeTrialInfo.free_trial_expiry,
      freeTrialInfo.nextDateReset,
      freeTrialInfo.next_date_reset,
      freeTrialInfo.expiresAt,
      freeTrialInfo.expires_at,
      freeTrialInfo.expirationDate,
      freeTrialInfo.expiration_date,
      freeTrialInfo.expiryDate,
      freeTrialInfo.expiry_date,
      freeTrialInfo.endAt,
      freeTrialInfo.end_at
    );
  });

  const nextReset = toFutureKiroResetIso(normalizeKiroTimestamp(payload.nextDateReset));
  const bonusNextReset = toFutureKiroResetIso(bonusNextResetTimestamp);
  const bonusStatusUpper = normalizeStringValue(bonusStatus)?.toUpperCase() ?? '';
  const hasActiveBonus =
    bonusLimit > 0 &&
    !KIRO_INACTIVE_BONUS_STATUSES.has(bonusStatusUpper) &&
    !(bonusNextResetTimestamp !== null && bonusNextResetTimestamp <= Date.now());
  const effectiveBonusLimit = hasActiveBonus ? bonusLimit : 0;
  const effectiveBonusUsage = hasActiveBonus ? bonusUsage : 0;
  const totalLimit = baseLimit + effectiveBonusLimit;
  const totalUsage = baseUsage + effectiveBonusUsage;
  const subscriptionType =
    normalizeStringValue(payload.subscriptionInfo?.subscriptionTitle) ??
    normalizeStringValue(payload.subscriptionInfo?.type) ??
    undefined;

  return {
    baseUsage,
    baseLimit,
    baseRemaining: baseLimit > 0 ? Math.max(0, baseLimit - baseUsage) : null,
    bonusUsage: hasActiveBonus ? bonusUsage : null,
    bonusLimit: hasActiveBonus ? bonusLimit : null,
    bonusRemaining: hasActiveBonus ? Math.max(0, bonusLimit - bonusUsage) : null,
    bonusStatus,
    bonusNextReset,
    currentUsage: totalUsage,
    usageLimit: totalLimit,
    remainingCredits: totalLimit > 0 ? Math.max(0, totalLimit - totalUsage) : null,
    nextReset,
    subscriptionType,
  };
};

const emptyKiroState = () => ({
  baseUsage: null,
  baseLimit: null,
  baseRemaining: null,
  bonusUsage: null,
  bonusLimit: null,
  bonusRemaining: null,
  currentUsage: null,
  usageLimit: null,
  remainingCredits: null,
});

export const KIRO_CONFIG: QuotaProviderData<KiroQuotaState, KiroQuotaData> = {
  type: 'kiro',
  i18nPrefix: 'kiro_quota',
  filterFn: (file) => isKiroFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchKiroQuota,
  storeSelector: (state) => state.kiroQuota,
  storeSetter: 'setKiroQuota',
  buildLoadingState: () => ({ status: 'loading', ...emptyKiroState() }),
  buildSuccessState: (data) => ({ status: 'success', ...data }),
  buildErrorState: (message, status) => ({
    status: 'error',
    ...emptyKiroState(),
    error: message,
    errorStatus: status,
  }),
  buildSnapshotState: (file) => {
    const data = buildKiroQuotaDataFromUsageQuota(file.usage_quota ?? file.usageQuota);
    return data ? { status: 'success', ...data } : null;
  },
};
