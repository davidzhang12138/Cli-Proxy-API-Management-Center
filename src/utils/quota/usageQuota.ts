import type {
  AntigravityQuotaGroup,
  KiroQuotaState,
  UsageQuotaSnapshot,
  UsageQuotaSnapshotPayload,
} from '@/types';
import { normalizeNumberValue, normalizeStringValue } from './parsers';

type KiroQuotaData = Omit<KiroQuotaState, 'status' | 'error' | 'errorStatus'>;

const ANTIGRAVITY_USAGE_QUOTA_GROUP_ID = 'google-one-ai-credits';
const ANTIGRAVITY_USAGE_QUOTA_LABEL = 'Google One AI Credits';

const normalizeBooleanValue = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return null;
};

const normalizeIsoTimestamp = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const direct = new Date(trimmed);
    if (!Number.isNaN(direct.getTime())) return direct.toISOString();
    const numeric = normalizeNumberValue(trimmed);
    if (numeric === null) return undefined;
    return normalizeIsoTimestamp(numeric);
  }

  const numeric = normalizeNumberValue(value);
  if (numeric === null || numeric <= 0) return undefined;
  const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export const readUsageQuotaSnapshotPayload = (value: unknown): UsageQuotaSnapshotPayload | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as UsageQuotaSnapshotPayload;
};

export const parseUsageQuotaSnapshot = (value: unknown): UsageQuotaSnapshot | null => {
  const payload = readUsageQuotaSnapshotPayload(value);
  if (!payload) return null;

  const known = normalizeBooleanValue(payload.known) ?? false;
  const totalLimit = normalizeNumberValue(payload.total_limit ?? payload.totalLimit);
  const currentUsage = normalizeNumberValue(payload.current_usage ?? payload.currentUsage);
  const remaining = normalizeNumberValue(payload.remaining);
  const exhausted =
    normalizeBooleanValue(payload.exhausted) ?? (remaining !== null && remaining <= 0) ?? false;
  const resourceType =
    normalizeStringValue(payload.resource_type ?? payload.resourceType) ?? undefined;
  const nextReset = normalizeIsoTimestamp(payload.next_reset ?? payload.nextReset);
  const checkedAt = normalizeIsoTimestamp(payload.checked_at ?? payload.checkedAt);
  const error = normalizeStringValue(payload.error) ?? undefined;

  return {
    known,
    totalLimit,
    currentUsage,
    remaining,
    exhausted,
    resourceType,
    nextReset,
    checkedAt,
    error,
  };
};

export const hasKnownUsageQuotaSnapshot = (value: unknown): boolean => {
  const snapshot = parseUsageQuotaSnapshot(value);
  return Boolean(snapshot?.known && !snapshot.error);
};

export const buildKiroQuotaDataFromUsageQuota = (value: unknown): KiroQuotaData | null => {
  const snapshot = parseUsageQuotaSnapshot(value);
  if (!snapshot || !snapshot.known || snapshot.error) return null;

  const totalLimit = snapshot.totalLimit;
  const remaining = snapshot.remaining;
  const currentUsage =
    snapshot.currentUsage ??
    (totalLimit !== null && remaining !== null ? Math.max(0, totalLimit - remaining) : null);

  if (totalLimit === null && currentUsage === null && remaining === null) {
    return null;
  }

  const normalizedLimit =
    totalLimit ?? (remaining !== null && currentUsage !== null ? remaining + currentUsage : null);
  const normalizedRemaining =
    remaining ??
    (normalizedLimit !== null && currentUsage !== null
      ? Math.max(0, normalizedLimit - currentUsage)
      : snapshot.exhausted
        ? 0
        : null);

  return {
    baseUsage: currentUsage,
    baseLimit: normalizedLimit,
    baseRemaining: normalizedRemaining,
    bonusUsage: null,
    bonusLimit: null,
    bonusRemaining: null,
    bonusNextReset: undefined,
    currentUsage,
    usageLimit: normalizedLimit,
    remainingCredits: normalizedRemaining,
    nextReset: snapshot.nextReset,
    subscriptionType: snapshot.resourceType,
  };
};

export const buildAntigravityQuotaGroupsFromUsageQuota = (
  value: unknown
): AntigravityQuotaGroup[] => {
  const snapshot = parseUsageQuotaSnapshot(value);
  if (!snapshot || !snapshot.known || snapshot.error) return [];

  const totalLimit = snapshot.totalLimit;
  const remaining = snapshot.remaining ?? (snapshot.exhausted ? 0 : null);
  const currentUsage = snapshot.currentUsage;
  const inferredLimit =
    totalLimit ?? (remaining !== null && currentUsage !== null ? remaining + currentUsage : null);

  if (remaining === null && inferredLimit === null) return [];

  const remainingFraction =
    inferredLimit !== null && inferredLimit > 0
      ? Math.max(0, Math.min(1, (remaining ?? 0) / inferredLimit))
      : remaining !== null && remaining > 0
        ? 1
        : 0;

  return [
    {
      id: ANTIGRAVITY_USAGE_QUOTA_GROUP_ID,
      label: ANTIGRAVITY_USAGE_QUOTA_LABEL,
      models: [snapshot.resourceType ?? ANTIGRAVITY_USAGE_QUOTA_LABEL],
      remainingFraction,
      resetTime: snapshot.nextReset,
    },
  ];
};
