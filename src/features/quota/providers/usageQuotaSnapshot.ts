import type {
  AntigravityQuotaState,
  AuthFileItem,
  ClaudeQuotaState,
  CodexQuotaState,
  KimiQuotaState,
  UsageQuotaResource,
  UsageQuotaSnapshot,
} from '@/types';
import {
  buildAntigravityQuotaGroupsFromUsageQuota,
  formatCodexResetLabel,
  formatQuotaResetTime,
  parseUsageQuotaSnapshot,
  periodHoursFromSeconds,
  resolveCodexPlanType,
  resolveCodexQuotaWindowMeta,
  resolveCodexSubscriptionActiveUntil,
  resolveResetMs,
} from '@/utils/quota';

type SnapshotState<T> = Omit<T, 'status' | 'error' | 'errorStatus'>;

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

const resourceUsedPercent = (resource: UsageQuotaResource): number | null => {
  if (resource.exhausted) return 100;
  if (resource.totalLimit !== null && resource.totalLimit > 0) {
    if (resource.currentUsage !== null) {
      return clampPercent((resource.currentUsage / resource.totalLimit) * 100);
    }
    if (resource.remaining !== null) {
      return clampPercent(((resource.totalLimit - resource.remaining) / resource.totalLimit) * 100);
    }
  }
  return null;
};

const resourceWithFallback = (snapshot: UsageQuotaSnapshot): UsageQuotaResource[] => {
  if (snapshot.resources.length > 0) return snapshot.resources;
  if (
    snapshot.totalLimit === null &&
    snapshot.currentUsage === null &&
    snapshot.remaining === null &&
    !snapshot.exhausted
  ) {
    return [];
  }
  return [
    {
      resourceType: snapshot.resourceType,
      totalLimit: snapshot.totalLimit,
      currentUsage: snapshot.currentUsage,
      remaining: snapshot.remaining,
      minimumCreditAmountForUsage: null,
      windowSeconds: null,
      resetAt: snapshot.nextReset,
      exhausted: snapshot.exhausted,
    },
  ];
};

const additionalWindowName = (resourceType: string): string | undefined => {
  const match = resourceType.match(/^(.+)_(?:primary|secondary)_window$/i);
  if (!match || match[1].startsWith('code_review')) return undefined;
  return match[1]
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const additionalWindowIdPrefix = (resourceType: string): string | undefined => {
  const match = resourceType.match(/^(.+)_(?:primary|secondary)_window$/i);
  if (!match || match[1].startsWith('code_review')) return undefined;
  return match[1].replace(/[^a-z0-9]+/gi, '-').toLowerCase();
};

export const buildAntigravityQuotaStateFromUsageQuota = (
  file: AuthFileItem
): SnapshotState<AntigravityQuotaState> | null => {
  const groups = buildAntigravityQuotaGroupsFromUsageQuota(file.usage_quota ?? file.usageQuota);
  return groups.length > 0
    ? {
        groups,
        subscription: null,
        serverTimeOffsetMs: null,
      }
    : null;
};

export const buildCodexQuotaStateFromUsageQuota = (
  file: AuthFileItem
): SnapshotState<CodexQuotaState> | null => {
  const snapshot = parseUsageQuotaSnapshot(file.usage_quota ?? file.usageQuota);
  if (!snapshot || !snapshot.known || snapshot.error) return null;

  const isFreePlan = resolveCodexPlanType(file)?.toLowerCase() === 'free';
  const windows = resourceWithFallback(snapshot).flatMap((resource) => {
    const resourceType = resource.resourceType?.trim() ?? '';
    const meta = resolveCodexQuotaWindowMeta({
      resourceType,
      windowSeconds: resource.windowSeconds,
      isFreePlan,
      additionalName: additionalWindowName(resourceType),
      additionalIdPrefix: additionalWindowIdPrefix(resourceType),
    });
    const resetAtMs = resolveResetMs([resource.resetAt]);
    const id = meta.id ?? (resourceType || 'quota');
    const labelKey = meta.labelKey;
    const usedPercent = resourceUsedPercent(resource);
    const periodHours = periodHoursFromSeconds(resource.windowSeconds);
    const resetLabel = formatCodexResetLabel(
      resetAtMs === null ? null : { reset_at: resetAtMs / 1000 }
    );

    return [
      {
        id,
        label: labelKey ?? (resourceType || 'Quota'),
        ...(labelKey ? { labelKey } : {}),
        ...(meta.labelParams ? { labelParams: meta.labelParams } : {}),
        usedPercent,
        resetLabel,
        resetAtMs,
        periodHours,
      },
    ];
  });

  if (windows.length === 0) return null;
  return {
    windows,
    planType: resolveCodexPlanType(file),
    subscriptionActiveUntil: resolveCodexSubscriptionActiveUntil(file),
    rateLimitResetCreditsAvailableCount: null,
    rateLimitResetCreditsApplicableAvailableCount: null,
    rateLimitResetCredits: [],
    rateLimitResetCreditsError: '',
  };
};

const claudeWindowMeta = (resourceType: string) => {
  const normalized = resourceType.toLowerCase().replace(/-/g, '_');
  if (normalized === 'five_hour' || normalized === 'primary_window') {
    return { id: 'five-hour', labelKey: 'claude_quota.five_hour', periodHours: 5 } as const;
  }
  if (normalized === 'seven_day' || normalized === 'secondary_window' || normalized === 'weekly') {
    return { id: 'seven-day', labelKey: 'claude_quota.seven_day', periodHours: 168 } as const;
  }
  if (normalized.includes('opus')) {
    return {
      id: 'seven-day-opus',
      labelKey: 'claude_quota.seven_day_opus',
      periodHours: 168,
    } as const;
  }
  if (normalized.includes('sonnet')) {
    return {
      id: 'seven-day-sonnet',
      labelKey: 'claude_quota.seven_day_sonnet',
      periodHours: 168,
    } as const;
  }
  if (normalized.includes('cowork')) {
    return {
      id: 'seven-day-cowork',
      labelKey: 'claude_quota.seven_day_cowork',
      periodHours: 168,
    } as const;
  }
  if (normalized.includes('fable') || normalized.includes('iguana')) {
    return {
      id: 'seven-day-fable',
      labelKey: 'claude_quota.seven_day_fable',
      periodHours: 168,
    } as const;
  }
  if (normalized.includes('oauth')) {
    return {
      id: 'seven-day-oauth-apps',
      labelKey: 'claude_quota.seven_day_oauth_apps',
      periodHours: 168,
    } as const;
  }
  return null;
};

export const buildClaudeQuotaStateFromUsageQuota = (
  file: AuthFileItem
): SnapshotState<ClaudeQuotaState> | null => {
  const snapshot = parseUsageQuotaSnapshot(file.usage_quota ?? file.usageQuota);
  if (!snapshot || !snapshot.known || snapshot.error) return null;

  const windows = resourceWithFallback(snapshot).map((resource, index) => {
    const resourceType = resource.resourceType?.trim() || `quota-${index + 1}`;
    const meta = claudeWindowMeta(resourceType);
    const resetAtMs = resolveResetMs([resource.resetAt]);
    return {
      id: meta?.id ?? resourceType,
      label: meta?.labelKey ?? resourceType,
      ...(meta?.labelKey ? { labelKey: meta.labelKey } : {}),
      usedPercent: resourceUsedPercent(resource),
      resetLabel:
        resetAtMs === null ? '-' : formatQuotaResetTime(new Date(resetAtMs).toISOString()),
      resetAtMs,
      periodHours: periodHoursFromSeconds(resource.windowSeconds) ?? meta?.periodHours ?? null,
    };
  });

  return windows.length > 0 ? { windows, extraUsage: null, planType: null } : null;
};

export const buildKimiQuotaStateFromUsageQuota = (
  file: AuthFileItem
): SnapshotState<KimiQuotaState> | null => {
  const snapshot = parseUsageQuotaSnapshot(file.usage_quota ?? file.usageQuota);
  if (!snapshot || !snapshot.known || snapshot.error) return null;

  const rows = resourceWithFallback(snapshot).flatMap((resource, index) => {
    const limit =
      resource.totalLimit ??
      (resource.currentUsage !== null && resource.remaining !== null
        ? resource.currentUsage + resource.remaining
        : null);
    const used =
      resource.currentUsage ??
      (limit !== null && resource.remaining !== null
        ? Math.max(0, limit - resource.remaining)
        : null);
    if (limit === null && used === null) return [];

    const resetAtMs = resolveResetMs([resource.resetAt]);
    return [
      {
        id: resource.resourceType || `resource-${index + 1}`,
        label: resource.resourceType || `Resource ${index + 1}`,
        used: used ?? 0,
        limit: limit ?? 0,
        resetAtMs,
        periodHours: periodHoursFromSeconds(resource.windowSeconds),
      },
    ];
  });

  return rows.length > 0 ? { rows } : null;
};
