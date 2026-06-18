import type {
  AntigravityQuotaGroup,
  AntigravityModelsPayload,
  KiroQuotaState,
  UsageQuotaResource,
  UsageQuotaResourcePayload,
  UsageQuotaSnapshot,
  UsageQuotaSnapshotPayload,
} from '@/types';
import { ANTIGRAVITY_QUOTA_GROUPS } from './constants';
import { buildAntigravityQuotaGroups } from './builders';
import { normalizeNumberValue, normalizeStringValue } from './parsers';

type KiroQuotaData = Omit<KiroQuotaState, 'status' | 'error' | 'errorStatus'>;

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

export const toFutureKiroResetIso = (
  timestampMs: number | null,
  nowMs = Date.now()
): string | undefined => {
  if (timestampMs === null || timestampMs <= nowMs) return undefined;
  const date = new Date(timestampMs);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export const readUsageQuotaSnapshotPayload = (value: unknown): UsageQuotaSnapshotPayload | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as UsageQuotaSnapshotPayload;
};

const usageQuotaResourceId = (resourceType?: string): string =>
  (resourceType || 'credit')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'credit';

const usageQuotaResourceLabel = (resourceType?: string): string => {
  if (!resourceType) return 'Credit';
  return resourceType
    .trim()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

const parseUsageQuotaResource = (value: unknown): UsageQuotaResource | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as UsageQuotaResourcePayload;
  const resourceType =
    normalizeStringValue(payload.resource_type ?? payload.resourceType) ?? undefined;
  const totalLimit = normalizeNumberValue(payload.total_limit ?? payload.totalLimit);
  const currentUsage = normalizeNumberValue(payload.current_usage ?? payload.currentUsage);
  const remaining = normalizeNumberValue(payload.remaining);
  const minimumCreditAmountForUsage = normalizeNumberValue(
    payload.minimum_credit_amount_for_usage ?? payload.minimumCreditAmountForUsage
  );
  const windowSeconds = normalizeNumberValue(payload.window_seconds ?? payload.windowSeconds);
  const resetAt = normalizeIsoTimestamp(payload.reset_at ?? payload.resetAt);
  const exhausted =
    normalizeBooleanValue(payload.exhausted) ??
    (remaining !== null && minimumCreditAmountForUsage !== null
      ? remaining < minimumCreditAmountForUsage
      : remaining !== null && remaining <= 0) ??
    false;

  return {
    resourceType,
    totalLimit,
    currentUsage,
    remaining,
    minimumCreditAmountForUsage,
    windowSeconds,
    resetAt,
    exhausted,
  };
};

const usageQuotaResourceToAntigravityGroup = (
  resource: UsageQuotaResource,
  resetTime?: string
): AntigravityQuotaGroup | null => {
  const remaining = resource.remaining ?? (resource.exhausted ? 0 : null);
  const inferredLimit =
    resource.totalLimit ??
    (remaining !== null && resource.currentUsage !== null
      ? remaining + resource.currentUsage
      : null);
  if (remaining === null && inferredLimit === null) return null;

  const remainingFraction =
    inferredLimit !== null && inferredLimit > 0
      ? Math.max(0, Math.min(1, (remaining ?? 0) / inferredLimit))
      : remaining !== null && remaining > 0 && !resource.exhausted
        ? 1
        : 0;
  const resourceType = resource.resourceType;

  const group: AntigravityQuotaGroup = {
    id: usageQuotaResourceId(resourceType),
    label: usageQuotaResourceLabel(resourceType),
    models: resourceType ? [resourceType] : [],
    remainingFraction,
    resetTime,
    buckets: [
      {
        id: `${usageQuotaResourceId(resourceType)}-quota`,
        label: usageQuotaResourceLabel(resourceType),
        remainingFraction,
        remainingAmount: remaining ?? undefined,
        minimumAmount: resource.minimumCreditAmountForUsage ?? undefined,
        resetTime,
      },
    ],
  };
  if (remaining !== null && resource.totalLimit === null) {
    group.remainingAmount = remaining;
  }
  if (resource.minimumCreditAmountForUsage !== null) {
    group.minimumAmount = resource.minimumCreditAmountForUsage;
  }
  return group;
};

const usageQuotaResourceToAntigravityModel = (
  resource: UsageQuotaResource,
  resetTime?: string
): AntigravityModelsPayload[string] | null => {
  const group = usageQuotaResourceToAntigravityGroup(resource, resetTime);
  if (!group) return null;

  return {
    displayName: group.label,
    quotaInfo: {
      remainingFraction: group.remainingFraction,
      resetTime,
    },
  };
};

const ANTIGRAVITY_GROUPED_RESOURCE_TYPES = new Set(
  ANTIGRAVITY_QUOTA_GROUPS.flatMap((group) => group.identifiers)
);

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
  const resources = Array.isArray(payload.resources)
    ? payload.resources
        .map(parseUsageQuotaResource)
        .filter((resource): resource is UsageQuotaResource => Boolean(resource))
    : [];

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
    resources,
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
    nextReset: toFutureKiroResetIso(
      snapshot.nextReset ? Date.parse(snapshot.nextReset) : null
    ),
    subscriptionType: snapshot.resourceType,
  };
};

export const buildAntigravityQuotaGroupsFromUsageQuota = (
  value: unknown
): AntigravityQuotaGroup[] => {
  const snapshot = parseUsageQuotaSnapshot(value);
  if (!snapshot || !snapshot.known || snapshot.error) return [];

  if (snapshot.resources.length > 0) {
    const groupedModels: AntigravityModelsPayload = {};
    const fallbackGroups: AntigravityQuotaGroup[] = [];

    snapshot.resources.forEach((resource) => {
      const resourceType = resource.resourceType;
      if (resourceType && ANTIGRAVITY_GROUPED_RESOURCE_TYPES.has(resourceType)) {
        const model = usageQuotaResourceToAntigravityModel(resource, snapshot.nextReset);
        if (model) {
          groupedModels[resourceType] = model;
        }
        return;
      }

      const group = usageQuotaResourceToAntigravityGroup(resource, snapshot.nextReset);
      if (group) {
        fallbackGroups.push(group);
      }
    });

    return [...buildAntigravityQuotaGroups(groupedModels), ...fallbackGroups];
  }

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

  const group: AntigravityQuotaGroup = {
    id: usageQuotaResourceId(snapshot.resourceType),
    label: usageQuotaResourceLabel(snapshot.resourceType),
    models: snapshot.resourceType ? [snapshot.resourceType] : [],
    remainingFraction,
    resetTime: snapshot.nextReset,
    buckets: [
      {
        id: `${usageQuotaResourceId(snapshot.resourceType)}-quota`,
        label: usageQuotaResourceLabel(snapshot.resourceType),
        remainingFraction,
        remainingAmount: remaining ?? undefined,
        resetTime: snapshot.nextReset,
      },
    ],
  };
  if (remaining !== null) {
    group.remainingAmount = remaining;
  }
  return [group];
};
