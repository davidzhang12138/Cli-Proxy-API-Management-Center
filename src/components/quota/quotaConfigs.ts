/**
 * Quota configuration definitions.
 */

import React from 'react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaBucket,
  AntigravityQuotaGroup,
  AntigravityQuotaSubscription,
  AntigravityQuotaSummaryPayload,
  AntigravityQuotaState,
  AuthFileItem,
  ClaudeExtraUsage,
  ClaudeProfileResponse,
  ClaudeQuotaState,
  ClaudeQuotaWindow,
  ClaudeUsagePayload,
  CodexRateLimitInfo,
  CodexRateLimitResetCredit,
  CodexQuotaState,
  CodexUsageWindow,
  CodexQuotaWindow,
  CodexUsagePayload,
  KimiQuotaRow,
  KimiQuotaState,
  KiroQuotaState,
  XaiBillingConfig,
  XaiBillingSummary,
  XaiQuotaState,
  XaiRateLimitQuota,
} from '@/types';
import {
  antigravitySubscriptionApi,
  apiCallApi,
  authFilesApi,
  getApiCallErrorMessage,
  type AntigravitySubscriptionSummary,
} from '@/services/api';
import {
  ANTIGRAVITY_QUOTA_URLS,
  ANTIGRAVITY_REQUEST_HEADERS,
  CLAUDE_PROFILE_URL,
  CLAUDE_USAGE_URL,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_WINDOW_KEYS,
  CODEX_RATE_LIMIT_RESET_CREDITS_URL,
  CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
  CODEX_USAGE_URL,
  CODEX_REQUEST_HEADERS,
  KIMI_USAGE_URL,
  KIMI_REQUEST_HEADERS,
  KIRO_QUOTA_URL,
  KIRO_REQUEST_HEADERS,
  XAI_BILLING_URL,
  XAI_REQUEST_HEADERS,
  normalizeNumberValue,
  normalizePlanType,
  normalizeStringValue,
  normalizeCodexResetCreditsPayload,
  parseAntigravityPayload,
  parseClaudeUsagePayload,
  parseCodexUsagePayload,
  parseUsageQuotaSnapshot,
  parseKimiUsagePayload,
  parseKiroQuotaPayload,
  parseXaiBillingPayload,
  resolveCodexChatgptAccountId,
  resolveCodexPlanType,
  resolveCodexSubscriptionActiveUntil,
  resolveCodexQuotaWindowMeta,
  formatCodexResetLabel,
  formatQuotaResetTime,
  formatKimiResetHint,
  buildAntigravityQuotaGroups,
  buildAntigravityQuotaGroupsFromUsageQuota,
  buildKiroQuotaDataFromUsageQuota,
  buildKimiQuotaRows,
  CODEX_WINDOW_META,
  createStatusError,
  formatShanghaiDateTime,
  getStatusFromError,
  hasKnownUsageQuotaSnapshot,
  inferCodexQuotaWindowPeriod,
  isAntigravityFile,
  isClaudeFile,
  isCodexFile,
  isDisabledAuthFile,
  isKimiFile,
  isKiroFile,
  isXaiFile,
  toFutureKiroResetIso,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { formatDateTimeValue } from '@/utils/format';
import type { QuotaRenderHelpers } from './QuotaCard';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaType = 'antigravity' | 'claude' | 'codex' | 'kiro' | 'kimi' | 'xai';

type AntigravityQuotaData = {
  groups: AntigravityQuotaGroup[];
  subscription: AntigravityQuotaSubscription | null;
  serverTimeOffsetMs: number | null;
};

type CodexResetCreditsData = {
  availableCount: number | null;
  credits: CodexRateLimitResetCredit[];
  error: string;
};

type CodexQuotaData = {
  planType: string | null;
  subscriptionActiveUntil: string | number | null;
  rateLimitResetCreditsAvailableCount: number | null;
  rateLimitResetCredits: CodexRateLimitResetCredit[];
  rateLimitResetCreditsError: string;
  windows: CodexQuotaWindow[];
};

const QUOTA_PROGRESS_HIGH_THRESHOLD = 70;
const QUOTA_PROGRESS_MEDIUM_THRESHOLD = 30;
export const ANTIGRAVITY_VISIBLE_GROUP_IDS = new Set([
  'google-one-ai-credits',
  'claude-gpt',
  'gemini-3-1-pro-series',
  'gemini-3-flash',
]);
const ANTIGRAVITY_FALLBACK_VISIBLE_GROUP_LIMIT = 4;
const CODEX_RESET_CREDITS_REQUEST_TIMEOUT_MS = 8000;

export interface QuotaStore {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  kiroQuota: Record<string, KiroQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  xaiQuota: Record<string, XaiQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setKiroQuota: (updater: QuotaUpdater<Record<string, KiroQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  setXaiQuota: (updater: QuotaUpdater<Record<string, XaiQuotaState>>) => void;
  clearQuotaCache: () => void;
}

export const filterVisibleAntigravityGroups = (
  groups: AntigravityQuotaGroup[]
): AntigravityQuotaGroup[] => {
  const visibleGroups = groups.filter((group) => ANTIGRAVITY_VISIBLE_GROUP_IDS.has(group.id));
  if (visibleGroups.length > 0) return visibleGroups;
  return groups.slice(0, ANTIGRAVITY_FALLBACK_VISIBLE_GROUP_LIMIT);
};

const snapshotResourceId = (resourceType?: string, fallback = 'quota'): string =>
  (resourceType || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;

const snapshotResourceLabel = (resourceType?: string, fallback = 'Quota'): string => {
  if (!resourceType) return fallback;
  return resourceType
    .trim()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

const computeSnapshotUsage = (
  totalLimit: number | null,
  currentUsage: number | null,
  remaining: number | null,
  exhausted: boolean
) => {
  const normalizedLimit =
    totalLimit ?? (remaining !== null && currentUsage !== null ? remaining + currentUsage : null);
  const normalizedUsage =
    currentUsage ??
    (normalizedLimit !== null && remaining !== null
      ? Math.max(0, normalizedLimit - remaining)
      : exhausted
        ? normalizedLimit
        : null);
  const normalizedRemaining =
    remaining ??
    (normalizedLimit !== null && normalizedUsage !== null
      ? Math.max(0, normalizedLimit - normalizedUsage)
      : exhausted
        ? 0
        : null);
  const usedPercent =
    normalizedLimit !== null && normalizedLimit > 0 && normalizedUsage !== null
      ? Math.max(0, Math.min(100, (normalizedUsage / normalizedLimit) * 100))
      : exhausted
        ? 100
        : null;
  const remainingFraction =
    normalizedLimit !== null && normalizedLimit > 0 && normalizedRemaining !== null
      ? Math.max(0, Math.min(1, normalizedRemaining / normalizedLimit))
      : normalizedRemaining !== null && normalizedRemaining > 0 && !exhausted
        ? 1
        : exhausted
          ? 0
          : null;

  return {
    normalizedLimit,
    normalizedUsage,
    normalizedRemaining,
    usedPercent,
    remainingFraction,
  };
};

export interface QuotaConfig<TState, TData> {
  type: QuotaType;
  i18nPrefix: string;
  cardIdleMessageKey?: string;
  filterFn: (file: AuthFileItem) => boolean;
  fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<TData>;
  resetQuota?: (file: AuthFileItem, t: TFunction) => Promise<TData>;
  canResetQuota?: (quota: TState | null | undefined) => boolean;
  storeSelector: (state: QuotaStore) => Record<string, TState>;
  storeSetter: keyof QuotaStore;
  buildLoadingState: () => TState;
  buildSuccessState: (data: TData) => TState;
  buildErrorState: (message: string, status?: number) => TState;
  buildSnapshotState?: (file: AuthFileItem) => TState | null;
  cardClassName: string;
  controlsClassName: string;
  controlClassName: string;
  gridClassName: string;
  renderQuotaItems: (quota: TState, t: TFunction, helpers: QuotaRenderHelpers) => ReactNode;
}

const resolveAntigravityProjectId = async (file: AuthFileItem): Promise<string> => {
  const directProjectId = normalizeStringValue(file.project_id ?? file.projectId);
  if (directProjectId) return directProjectId;

  const metadata =
    file.metadata && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const metadataProjectId = metadata
    ? normalizeStringValue(metadata.project_id ?? metadata.projectId)
    : null;
  if (metadataProjectId) return metadataProjectId;

  const attributes =
    file.attributes && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;
  const attributesProjectId = attributes
    ? normalizeStringValue(
        attributes.project_id ?? attributes.projectId ?? attributes.gemini_virtual_project
      )
    : null;
  if (attributesProjectId) return attributesProjectId;

  try {
    const text = await authFilesApi.downloadText(file.name);
    const trimmed = text.trim();
    if (!trimmed) return '';

    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const topLevel = normalizeStringValue(parsed.project_id ?? parsed.projectId);
    if (topLevel) return topLevel;

    const installed =
      parsed.installed && typeof parsed.installed === 'object' && parsed.installed !== null
        ? (parsed.installed as Record<string, unknown>)
        : null;
    const installedProjectId = installed
      ? normalizeStringValue(installed.project_id ?? installed.projectId)
      : null;
    if (installedProjectId) return installedProjectId;

    const web =
      parsed.web && typeof parsed.web === 'object' && parsed.web !== null
        ? (parsed.web as Record<string, unknown>)
        : null;
    const webProjectId = web ? normalizeStringValue(web.project_id ?? web.projectId) : null;
    if (webProjectId) return webProjectId;
  } catch {
    return '';
  }

  return '';
};

const resolveResponseServerTimeOffsetMs = (
  header: Record<string, string[]> | undefined
): number | null => {
  if (!header) return null;
  const dateEntry = Object.entries(header).find(([key]) => key.toLowerCase() === 'date');
  const rawDate = dateEntry?.[1]?.[0];
  if (!rawDate) return null;
  const serverTime = new Date(rawDate).getTime();
  if (Number.isNaN(serverTime)) return null;
  return serverTime - Date.now();
};

const fetchAntigravityQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<AntigravityQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('antigravity_quota.missing_auth_index'));
  }

  const projectId = await resolveAntigravityProjectId(file);
  if (!projectId) {
    throw new Error(t('antigravity_quota.missing_project_id'));
  }
  const requestBody = JSON.stringify({ project: projectId });
  const subscriptionPromise = antigravitySubscriptionApi
    .get(authIndex)
    .then(toAntigravityQuotaSubscription)
    .catch(() => null);

  let lastError = '';
  let lastStatus: number | undefined;
  let priorityStatus: number | undefined;
  let hadSuccess = false;

  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    try {
      const result = await apiCallApi.request({
        authIndex,
        method: 'POST',
        url,
        header: { ...ANTIGRAVITY_REQUEST_HEADERS },
        data: requestBody,
      });

      if (result.statusCode < 200 || result.statusCode >= 300) {
        lastError = getApiCallErrorMessage(result);
        lastStatus = result.statusCode;
        if (result.statusCode === 403 || result.statusCode === 404) {
          priorityStatus ??= result.statusCode;
        }
        continue;
      }

      hadSuccess = true;
      const payload = parseAntigravityPayload(
        result.body ?? result.bodyText
      ) as AntigravityQuotaSummaryPayload | null;
      if (!payload || !Array.isArray(payload.groups)) {
        lastError = t('antigravity_quota.empty_models');
        continue;
      }

      const groups = buildAntigravityQuotaGroups(payload);
      if (groups.length === 0) {
        lastError = t('antigravity_quota.empty_models');
        continue;
      }

      return {
        groups,
        subscription: await subscriptionPromise,
        serverTimeOffsetMs: resolveResponseServerTimeOffsetMs(result.header),
      };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      if (status) {
        lastStatus = status;
        if (status === 403 || status === 404) {
          priorityStatus ??= status;
        }
      }
    }
  }

  if (hadSuccess) {
    return { groups: [], subscription: await subscriptionPromise, serverTimeOffsetMs: null };
  }

  throw createStatusError(lastError || t('common.unknown_error'), priorityStatus ?? lastStatus);
};

const toAntigravityQuotaSubscription = (
  summary: AntigravitySubscriptionSummary | null
): AntigravityQuotaSubscription | null => {
  if (!summary) return null;
  return {
    plan: summary.plan,
    tierName: summary.tierName,
    tierId: summary.tierId,
  };
};

const buildCodexQuotaWindows = (payload: CodexUsagePayload, t: TFunction): CodexQuotaWindow[] => {
  const rateLimit = payload.rate_limit ?? payload.rateLimit ?? undefined;
  const codeReviewLimit =
    payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? undefined;
  const additionalRateLimits = payload.additional_rate_limits ?? payload.additionalRateLimits ?? [];
  const windows: CodexQuotaWindow[] = [];

  const addWindow = (
    id: string,
    label: string,
    labelKey: string | undefined,
    labelParams: Record<string, string | number> | undefined,
    window?: CodexUsageWindow | null,
    limitReached?: boolean,
    allowed?: boolean
  ) => {
    if (!window) return;
    const resetLabel = formatCodexResetLabel(window);
    const resetAt = normalizeNumberValue(window.reset_at ?? window.resetAt);
    const resetAfter = normalizeNumberValue(window.reset_after_seconds ?? window.resetAfterSeconds);
    const resetTime =
      resetAt !== null && resetAt > 0
        ? new Date(resetAt * 1000).toISOString()
        : resetAfter !== null && resetAfter > 0
          ? new Date((Math.floor(Date.now() / 1000) + resetAfter) * 1000).toISOString()
          : undefined;
    const usedPercentRaw = normalizeNumberValue(window.used_percent ?? window.usedPercent);
    const isLimitReached = Boolean(limitReached) || allowed === false;
    const usedPercent = usedPercentRaw ?? (isLimitReached && resetLabel !== '-' ? 100 : null);
    windows.push({
      id,
      label,
      labelKey,
      labelParams,
      usedPercent,
      resetLabel,
      resetTime,
    });
  };

  const getWindowSeconds = (window?: CodexUsageWindow | null): number | null => {
    if (!window) return null;
    return normalizeNumberValue(window.limit_window_seconds ?? window.limitWindowSeconds);
  };

  const rawLimitReached = rateLimit?.limit_reached ?? rateLimit?.limitReached;
  const rawAllowed = rateLimit?.allowed;

  const pickClassifiedWindows = (
    limitInfo?: CodexRateLimitInfo | null,
    options?: { allowOrderFallback?: boolean }
  ): {
    fiveHourWindow: CodexUsageWindow | null;
    weeklyWindow: CodexUsageWindow | null;
    monthlyWindow: CodexUsageWindow | null;
  } => {
    const allowOrderFallback = options?.allowOrderFallback ?? true;
    const primaryWindow = limitInfo?.primary_window ?? limitInfo?.primaryWindow ?? null;
    const secondaryWindow = limitInfo?.secondary_window ?? limitInfo?.secondaryWindow ?? null;
    const rawWindows = [primaryWindow, secondaryWindow];

    let fiveHourWindow: CodexUsageWindow | null = null;
    let weeklyWindow: CodexUsageWindow | null = null;
    let monthlyWindow: CodexUsageWindow | null = null;

    for (const window of rawWindows) {
      if (!window) continue;
      const period = inferCodexQuotaWindowPeriod(getWindowSeconds(window));
      if (period === 'five-hour' && !fiveHourWindow) {
        fiveHourWindow = window;
      } else if (period === 'weekly' && !weeklyWindow) {
        weeklyWindow = window;
      } else if (period === 'monthly' && !monthlyWindow) {
        monthlyWindow = window;
      }
    }

    // For legacy payloads without window duration, fallback to primary/secondary ordering.
    if (allowOrderFallback) {
      if (!fiveHourWindow) {
        fiveHourWindow =
          primaryWindow && primaryWindow !== weeklyWindow && primaryWindow !== monthlyWindow
            ? primaryWindow
            : null;
      }
      if (!weeklyWindow) {
        weeklyWindow =
          secondaryWindow && secondaryWindow !== fiveHourWindow && secondaryWindow !== monthlyWindow
            ? secondaryWindow
            : null;
      }
    }

    return { fiveHourWindow, weeklyWindow, monthlyWindow };
  };

  const rateWindows = pickClassifiedWindows(rateLimit);
  addWindow(
    CODEX_WINDOW_META.codeFiveHour.id,
    t(CODEX_WINDOW_META.codeFiveHour.labelKey),
    CODEX_WINDOW_META.codeFiveHour.labelKey,
    undefined,
    rateWindows.fiveHourWindow,
    rawLimitReached,
    rawAllowed
  );
  addWindow(
    CODEX_WINDOW_META.codeWeekly.id,
    t(CODEX_WINDOW_META.codeWeekly.labelKey),
    CODEX_WINDOW_META.codeWeekly.labelKey,
    undefined,
    rateWindows.weeklyWindow,
    rawLimitReached,
    rawAllowed
  );
  addWindow(
    CODEX_WINDOW_META.codeTeamSecondary.id,
    t(CODEX_WINDOW_META.codeTeamSecondary.labelKey),
    CODEX_WINDOW_META.codeTeamSecondary.labelKey,
    undefined,
    rateWindows.monthlyWindow,
    rawLimitReached,
    rawAllowed
  );

  const codeReviewWindows = pickClassifiedWindows(codeReviewLimit);
  const codeReviewLimitReached = codeReviewLimit?.limit_reached ?? codeReviewLimit?.limitReached;
  const codeReviewAllowed = codeReviewLimit?.allowed;
  addWindow(
    CODEX_WINDOW_META.codeReviewFiveHour.id,
    t(CODEX_WINDOW_META.codeReviewFiveHour.labelKey),
    CODEX_WINDOW_META.codeReviewFiveHour.labelKey,
    undefined,
    codeReviewWindows.fiveHourWindow,
    codeReviewLimitReached,
    codeReviewAllowed
  );
  addWindow(
    CODEX_WINDOW_META.codeReviewWeekly.id,
    t(CODEX_WINDOW_META.codeReviewWeekly.labelKey),
    CODEX_WINDOW_META.codeReviewWeekly.labelKey,
    undefined,
    codeReviewWindows.weeklyWindow,
    codeReviewLimitReached,
    codeReviewAllowed
  );
  addWindow(
    CODEX_WINDOW_META.codeReviewMonthly.id,
    t(CODEX_WINDOW_META.codeReviewMonthly.labelKey),
    CODEX_WINDOW_META.codeReviewMonthly.labelKey,
    undefined,
    codeReviewWindows.monthlyWindow,
    codeReviewLimitReached,
    codeReviewAllowed
  );

  const normalizeWindowId = (raw: string) =>
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  if (Array.isArray(additionalRateLimits)) {
    additionalRateLimits.forEach((limitItem, index) => {
      const rateInfo = limitItem?.rate_limit ?? limitItem?.rateLimit ?? null;
      if (!rateInfo) return;

      const limitName =
        normalizeStringValue(limitItem?.limit_name ?? limitItem?.limitName) ??
        normalizeStringValue(limitItem?.metered_feature ?? limitItem?.meteredFeature) ??
        `additional-${index + 1}`;

      const idPrefix = normalizeWindowId(limitName) || `additional-${index + 1}`;
      const additionalPrimaryWindow = rateInfo.primary_window ?? rateInfo.primaryWindow ?? null;
      const additionalSecondaryWindow =
        rateInfo.secondary_window ?? rateInfo.secondaryWindow ?? null;
      const additionalLimitReached = rateInfo.limit_reached ?? rateInfo.limitReached;
      const additionalAllowed = rateInfo.allowed;
      const additionalPrimaryMeta = resolveCodexQuotaWindowMeta({
        resourceType: 'primary_window',
        windowSeconds: getWindowSeconds(additionalPrimaryWindow),
        additionalName: limitName,
        additionalIdPrefix: idPrefix,
      });
      const additionalSecondaryMeta = resolveCodexQuotaWindowMeta({
        resourceType: 'secondary_window',
        windowSeconds: getWindowSeconds(additionalSecondaryWindow),
        additionalName: limitName,
        additionalIdPrefix: idPrefix,
      });

      addWindow(
        `${additionalPrimaryMeta.id || `${idPrefix}-primary`}-${index}`,
        additionalPrimaryMeta.labelKey
          ? t(additionalPrimaryMeta.labelKey, additionalPrimaryMeta.labelParams)
          : limitName,
        additionalPrimaryMeta.labelKey,
        additionalPrimaryMeta.labelParams,
        additionalPrimaryWindow,
        additionalLimitReached,
        additionalAllowed
      );
      addWindow(
        `${additionalSecondaryMeta.id || `${idPrefix}-secondary`}-${index}`,
        additionalSecondaryMeta.labelKey
          ? t(additionalSecondaryMeta.labelKey, additionalSecondaryMeta.labelParams)
          : limitName,
        additionalSecondaryMeta.labelKey,
        additionalSecondaryMeta.labelParams,
        additionalSecondaryWindow,
        additionalLimitReached,
        additionalAllowed
      );
    });
  }

  return windows;
};

const codexSnapshotResourceId = (resourceType?: string): string =>
  snapshotResourceId(resourceType, 'usage');

const codexSnapshotAdditionalName = (value: string): string => {
  const normalized = value
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return snapshotResourceLabel(normalized, 'Codex');
};

const codexSnapshotResourceMeta = (
  resourceType?: string,
  options?: { isFreePlan?: boolean; windowSeconds?: number | null }
): Pick<CodexQuotaWindow, 'id' | 'label' | 'labelKey' | 'labelParams'> => {
  const normalized = (resourceType ?? '').trim().toLowerCase();
  const directMeta = resolveCodexQuotaWindowMeta({
    resourceType,
    windowSeconds: options?.windowSeconds,
    isFreePlan: options?.isFreePlan,
  });
  if (directMeta.id) {
    return { ...directMeta, id: directMeta.id, label: '' };
  }

  if (normalized.endsWith('_primary_window')) {
    const name = codexSnapshotAdditionalName(normalized.slice(0, -'_primary_window'.length));
    const meta = resolveCodexQuotaWindowMeta({
      resourceType,
      windowSeconds: options?.windowSeconds,
      additionalName: name,
      additionalIdPrefix: snapshotResourceId(name, 'additional'),
    });
    return {
      ...meta,
      id: meta.id ?? `${snapshotResourceId(name, 'additional')}-primary`,
      label: '',
    };
  }
  if (normalized.endsWith('_secondary_window')) {
    const name = codexSnapshotAdditionalName(normalized.slice(0, -'_secondary_window'.length));
    const meta = resolveCodexQuotaWindowMeta({
      resourceType,
      windowSeconds: options?.windowSeconds,
      additionalName: name,
      additionalIdPrefix: snapshotResourceId(name, 'additional'),
    });
    return {
      ...meta,
      id: meta.id ?? `${snapshotResourceId(name, 'additional')}-secondary`,
      label: '',
    };
  }

  return {
    id: codexSnapshotResourceId(resourceType),
    label: snapshotResourceLabel(resourceType, 'Codex'),
  };
};

const buildCodexQuotaStateFromUsageQuota = (
  file: AuthFileItem
): Pick<CodexQuotaState, 'windows' | 'planType'> | null => {
  const snapshot = parseUsageQuotaSnapshot(file.usage_quota ?? file.usageQuota);
  if (!snapshot || !snapshot.known || snapshot.error) return null;
  const planType = normalizePlanType(snapshot.resourceType) ?? resolveCodexPlanType(file);
  const isFreePlan = planType === 'free';

  const toWindow = (
    resourceType: string | undefined,
    totalLimit: number | null,
    currentUsage: number | null,
    remaining: number | null,
    exhausted: boolean,
    resetTime?: string,
    windowSeconds?: number | null
  ): CodexQuotaWindow | null => {
    const usage = computeSnapshotUsage(totalLimit, currentUsage, remaining, exhausted);

    if (
      usage.normalizedLimit === null &&
      usage.normalizedUsage === null &&
      usage.normalizedRemaining === null
    ) {
      return null;
    }
    const effectiveResetTime = resetTime ?? snapshot.nextReset;
    const resetLabel = formatQuotaResetTime(effectiveResetTime);
    const meta = codexSnapshotResourceMeta(resourceType, { isFreePlan, windowSeconds });

    return {
      ...meta,
      usedPercent: usage.usedPercent,
      resetLabel,
      resetTime: effectiveResetTime,
    };
  };

  const windows =
    snapshot.resources.length > 0
      ? snapshot.resources
          .map((resource) =>
            toWindow(
              resource.resourceType,
              resource.totalLimit,
              resource.currentUsage,
              resource.remaining,
              resource.exhausted,
              resource.resetAt,
              resource.windowSeconds
            )
          )
          .filter((window): window is CodexQuotaWindow => Boolean(window))
      : [
          toWindow(
            snapshot.resourceType,
            snapshot.totalLimit,
            snapshot.currentUsage,
            snapshot.remaining,
            snapshot.exhausted,
            snapshot.nextReset
          ),
        ].filter((window): window is CodexQuotaWindow => Boolean(window));

  if (windows.length === 0) return null;

  return {
    windows,
    planType,
  };
};

const buildCodexRequestHeader = (file: AuthFileItem): Record<string, string> => {
  const accountId = resolveCodexChatgptAccountId(file);
  const requestHeader: Record<string, string> = {
    ...CODEX_REQUEST_HEADERS,
  };
  if (accountId) {
    requestHeader['Chatgpt-Account-Id'] = accountId;
  }
  return requestHeader;
};

const fetchCodexResetCredits = async (
  authIndex: string,
  requestHeader: Record<string, string>,
  t: TFunction
): Promise<CodexResetCreditsData> => {
  try {
    const result = await apiCallApi.request(
      {
        authIndex,
        method: 'GET',
        url: CODEX_RATE_LIMIT_RESET_CREDITS_URL,
        header: {
          ...requestHeader,
          Accept: 'application/json',
          'OpenAI-Beta': 'codex-1',
          Originator: 'Codex Desktop',
        },
      },
      { timeout: CODEX_RESET_CREDITS_REQUEST_TIMEOUT_MS }
    );

    if (result.statusCode < 200 || result.statusCode >= 300) {
      return {
        availableCount: null,
        credits: [],
        error: getApiCallErrorMessage(result),
      };
    }

    const summary = normalizeCodexResetCreditsPayload(result.body ?? result.bodyText);
    if (summary.invalidPayload) {
      return {
        availableCount: null,
        credits: [],
        error: t('codex_quota.reset_credits_invalid_payload'),
      };
    }

    return {
      availableCount: summary.availableCount,
      credits: summary.credits,
      error: '',
    };
  } catch (err: unknown) {
    return {
      availableCount: null,
      credits: [],
      error: err instanceof Error ? err.message : t('common.unknown_error'),
    };
  }
};

const fetchCodexQuota = async (file: AuthFileItem, t: TFunction): Promise<CodexQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('codex_quota.missing_auth_index'));
  }

  const planTypeFromFile = resolveCodexPlanType(file);
  const subscriptionActiveUntil = resolveCodexSubscriptionActiveUntil(file);
  const requestHeader = buildCodexRequestHeader(file);

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: CODEX_USAGE_URL,
    header: requestHeader,
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseCodexUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('codex_quota.empty_windows'));
  }

  const planTypeFromUsage = normalizePlanType(payload.plan_type ?? payload.planType);
  const resetCredits = payload.rate_limit_reset_credits ?? payload.rateLimitResetCredits ?? null;
  const usageResetCreditsAvailableCount = normalizeNumberValue(
    resetCredits?.available_count ?? resetCredits?.availableCount
  );
  const resetCreditsData = await fetchCodexResetCredits(authIndex, requestHeader, t);
  const resetCreditsCountFromDetails =
    resetCreditsData.credits.length > 0 ? resetCreditsData.credits.length : null;
  const rateLimitResetCreditsAvailableCount =
    resetCreditsData.availableCount ??
    resetCreditsCountFromDetails ??
    usageResetCreditsAvailableCount;
  const planType = planTypeFromUsage ?? planTypeFromFile;
  const windows = buildCodexQuotaWindows(payload, t);
  return {
    planType,
    subscriptionActiveUntil,
    rateLimitResetCreditsAvailableCount,
    rateLimitResetCredits: resetCreditsData.credits,
    rateLimitResetCreditsError: resetCreditsData.error,
    windows,
  };
};

const createCodexRedeemRequestId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const segment = char === 'x' ? value : (value & 0x3) | 0x8;
    return segment.toString(16);
  });
};

const consumeCodexRateLimitResetCredit = async (
  file: AuthFileItem,
  t: TFunction
): Promise<void> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('codex_quota.missing_auth_index'));
  }

  const requestHeader = buildCodexRequestHeader(file);

  const result = await apiCallApi.request({
    authIndex,
    method: 'POST',
    url: CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
    header: requestHeader,
    data: JSON.stringify({
      redeem_request_id: createCodexRedeemRequestId(),
    }),
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }
};

const resetCodexQuota = async (file: AuthFileItem, t: TFunction): Promise<CodexQuotaData> => {
  await consumeCodexRateLimitResetCredit(file, t);
  return fetchCodexQuota(file, t);
};

const isResetTimeExpired = (resetTime?: string): boolean => {
  if (!resetTime) return false;
  const timestamp = Date.parse(resetTime);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
};

const formatAntigravityDuration = (t: TFunction, deltaMs: number): string => {
  const totalMinutes = Math.max(1, Math.ceil(deltaMs / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return t('antigravity_quota.duration_day_hour', {
      days,
      hours,
    });
  }
  if (hours > 0) {
    return t('antigravity_quota.duration_hour_minute', {
      hours,
      minutes,
    });
  }
  if (minutes > 0) {
    return t('antigravity_quota.duration_minute', {
      minutes,
    });
  }
  return t('antigravity_quota.duration_less_than_minute');
};

const formatAntigravityResetLabel = (
  resetTime: string | undefined,
  t: TFunction,
  nowMs: number
): string => {
  if (!resetTime) return '-';
  const resetMs = new Date(resetTime).getTime();
  if (Number.isNaN(resetMs)) return '-';
  const deltaMs = resetMs - nowMs;
  if (deltaMs <= 0) return t('antigravity_quota.refresh_available');
  return t('antigravity_quota.refreshes_in', {
    duration: formatAntigravityDuration(t, deltaMs),
  });
};

const ANTIGRAVITY_GROUP_LABEL_KEYS = new Map<string, string>([
  ['gemini models', 'group_gemini_models'],
  ['claude and gpt models', 'group_claude_gpt_models'],
]);

const ANTIGRAVITY_BUCKET_LABEL_KEYS = new Map<string, string>([
  ['weekly limit', 'weekly_limit'],
  ['daily limit', 'daily_limit'],
  ['5 hour limit', 'five_hour_limit'],
  ['5-hour limit', 'five_hour_limit'],
  ['five hour limit', 'five_hour_limit'],
  ['monthly limit', 'monthly_limit'],
]);

const normalizeAntigravityQuotaText = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const translateAntigravityQuotaLabel = (
  value: string,
  keys: Map<string, string>,
  t: TFunction
): string => {
  const key = keys.get(normalizeAntigravityQuotaText(value));
  return key ? t(`antigravity_quota.${key}`) : value;
};

const translateAntigravityQuotaDescription = (
  value: string | undefined,
  t: TFunction
): string | undefined => {
  if (!value) return undefined;
  const modelsMatch = value.match(/^models within this group:\s*(.+)$/i);
  if (modelsMatch) {
    return t('antigravity_quota.group_models_description', {
      models: modelsMatch[1].trim(),
    });
  }
  return value;
};

const getAntigravityPlanLabel = (
  subscription: AntigravityQuotaSubscription | null | undefined,
  t: TFunction
): string | null => {
  if (!subscription) return null;
  if (subscription.plan === 'free') return t('antigravity_subscription.plan_free');
  if (subscription.plan === 'pro') return t('antigravity_subscription.plan_pro');
  if (subscription.plan === 'ultra') return t('antigravity_subscription.plan_ultra');
  if (subscription.plan === 'ultra-lite') return t('antigravity_subscription.plan_ultra_lite');
  return (
    subscription.tierName ||
    subscription.tierId ||
    (subscription.plan === 'unknown' ? t('antigravity_subscription.plan_unknown') : null)
  );
};

const resolveAntigravityGroupBuckets = (group: AntigravityQuotaGroup) => {
  if (Array.isArray(group.buckets) && group.buckets.length > 0) {
    return group.buckets;
  }

  return [
    {
      id: `${group.id}-quota`,
      label: group.label,
      remainingFraction: group.remainingFraction,
      remainingAmount: group.remainingAmount,
      minimumAmount: group.minimumAmount,
      resetTime: group.resetTime,
      description: group.description,
    },
  ];
};

/**
 * A group rendered from the models payload only carries a single bucket that
 * mirrors the group itself (see buildLegacyAntigravityGroupBucket, which
 * assigns `bucket.label = group.label`, and the usage-quota snapshot builders
 * that derive both labels from the same helper). Rendering both the group
 * header and that bucket's title would print the same label twice, so callers
 * should drop the bucket title for self buckets. The two labels are produced
 * from the same source, so a strict equality check is sufficient and avoids
 * false positives on genuinely distinct window-scoped bucket labels.
 */
export const isAntigravityGroupSelfBucket = (
  group: AntigravityQuotaGroup,
  bucket: AntigravityQuotaBucket
): boolean => {
  if (Array.isArray(group.buckets) && group.buckets.length === 1) {
    return bucket.label === group.label;
  }
  return false;
};

const renderAntigravityItems = (
  quota: AntigravityQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const groups = quota.groups ?? [];
  const visibleGroups = filterVisibleAntigravityGroups(groups);
  const nodes: ReactNode[] = [];
  const planLabel = getAntigravityPlanLabel(quota.subscription, t);
  const normalizedPlan = quota.subscription?.plan?.toLowerCase() ?? '';
  const isPremiumPlan = normalizedPlan === 'ultra' || normalizedPlan === 'ultra-lite';

  if (planLabel) {
    nodes.push(
      h(
        'div',
        { key: 'plan', className: styleMap.codexPlan },
        h(
          'span',
          { className: styleMap.codexPlanItem },
          h('span', { className: styleMap.codexPlanLabel }, t('antigravity_quota.plan_label')),
          h(
            'span',
            { className: isPremiumPlan ? styleMap.premiumPlanValue : styleMap.codexPlanValue },
            planLabel
          )
        )
      )
    );
  }

  if (groups.length === 0) {
    nodes.push(
      h(
        'div',
        { key: 'empty', className: styleMap.quotaMessage },
        t('antigravity_quota.empty_models')
      )
    );
    return h(Fragment, null, ...nodes);
  }

  const nowMs = Date.now() + (quota.serverTimeOffsetMs ?? 0);

  nodes.push(
    ...visibleGroups.map((group) => {
      const groupLabel = translateAntigravityQuotaLabel(
        group.label,
        ANTIGRAVITY_GROUP_LABEL_KEYS,
        t
      );
      const groupDescription = translateAntigravityQuotaDescription(group.description, t);

      return h(
        'div',
        { key: group.id, className: styleMap.antigravityQuotaGroup },
        h(
          'div',
          { className: styleMap.antigravityQuotaGroupHeader },
          h('span', { className: styleMap.antigravityQuotaGroupTitle }, groupLabel),
          groupDescription
            ? h('span', { className: styleMap.antigravityQuotaGroupDescription }, groupDescription)
            : null
        ),
        ...resolveAntigravityGroupBuckets(group).map((bucket) => {
          const clamped = Math.max(0, Math.min(1, bucket.remainingFraction));
          const percent = clamped * 100;
          const percentLabel =
            bucket.remainingFraction === 1
              ? t('antigravity_quota.quota_available')
              : t('antigravity_quota.remaining_percent', {
                  percent: Math.round(percent),
                });
          const resetLabel = formatAntigravityResetLabel(bucket.resetTime, t, nowMs);
          const isSelfBucket = isAntigravityGroupSelfBucket(group, bucket);
          const bucketLabel = translateAntigravityQuotaLabel(
            bucket.label,
            ANTIGRAVITY_BUCKET_LABEL_KEYS,
            t
          );
          const bucketDescription = translateAntigravityQuotaDescription(bucket.description, t);

          return h(
            'div',
            { key: bucket.id, className: styleMap.quotaRow },
            h(
              'div',
              { className: styleMap.quotaRowHeader },
              isSelfBucket
                ? null
                : h(
                    'span',
                    { className: styleMap.quotaModel, title: bucketDescription },
                    bucketLabel
                  ),
              h(
                'div',
                { className: styleMap.quotaMeta },
                h('span', { className: styleMap.quotaPercent }, percentLabel),
                h('span', { className: styleMap.quotaReset }, resetLabel)
              )
            ),
            h(QuotaProgressBar, {
              percent,
              highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
              mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
            })
          );
        })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

const PREMIUM_CODEX_PLAN_TYPES = new Set(['pro', 'prolite', 'pro-lite', 'pro_lite']);

const renderCodexItems = (
  quota: CodexQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const windows = quota.windows ?? [];
  const planType = quota.planType ?? null;
  const subscriptionActiveUntil = quota.subscriptionActiveUntil ?? null;
  const rateLimitResetCreditsAvailableCount = quota.rateLimitResetCreditsAvailableCount ?? null;
  const rateLimitResetCredits = quota.rateLimitResetCredits ?? [];
  const rateLimitResetCreditsError = quota.rateLimitResetCreditsError ?? '';

  const getPlanLabel = (pt?: string | null): string | null => {
    const normalized = normalizePlanType(pt);
    if (!normalized) return null;
    if (normalized === 'pro') return t('codex_quota.plan_pro');
    if (PREMIUM_CODEX_PLAN_TYPES.has(normalized) && normalized !== 'pro') {
      return t('codex_quota.plan_prolite');
    }
    if (normalized === 'plus') return t('codex_quota.plan_plus');
    if (normalized === 'team') return t('codex_quota.plan_team');
    if (normalized === 'free') return t('codex_quota.plan_free');
    return pt || normalized;
  };

  const planLabel = getPlanLabel(planType);
  const isPremiumPlan = PREMIUM_CODEX_PLAN_TYPES.has(normalizePlanType(planType) ?? '');
  const expiryLabel = subscriptionActiveUntil ? formatDateTimeValue(subscriptionActiveUntil) : '';
  const nodes: ReactNode[] = [];

  if (planLabel || expiryLabel || rateLimitResetCreditsAvailableCount !== null) {
    const planValueClass = isPremiumPlan ? styleMap.premiumPlanValue : styleMap.codexPlanValue;
    const planNodes: ReactNode[] = [];

    const appendPlanItem = (
      key: string,
      label: string,
      value: string,
      valueClassName = styleMap.codexPlanValue
    ) => {
      planNodes.push(
        h(
          'span',
          { key, className: styleMap.codexPlanItem },
          h('span', { className: styleMap.codexPlanLabel }, label),
          h('span', { className: valueClassName }, value)
        )
      );
    };

    if (planLabel) {
      appendPlanItem('plan-type', t('codex_quota.plan_label'), planLabel, planValueClass);
    }

    if (expiryLabel) {
      appendPlanItem('subscription-expiry', t('codex_quota.expires_label'), expiryLabel);
    }

    if (rateLimitResetCreditsAvailableCount !== null) {
      appendPlanItem(
        'reset-credits',
        t('codex_quota.reset_credits_label'),
        rateLimitResetCreditsAvailableCount.toString()
      );
    }

    nodes.push(h('div', { key: 'plan', className: styleMap.codexPlan }, ...planNodes));
  }

  if (rateLimitResetCredits.length > 0) {
    nodes.push(
      h(
        'div',
        { key: 'reset-credit-expiries', className: styleMap.codexResetCredits },
        h(
          'div',
          { className: styleMap.codexResetCreditsTitle },
          t('codex_quota.reset_credits_expiry_label')
        ),
        ...rateLimitResetCredits.map((credit, index) =>
          h(
            'div',
            {
              key: credit.id || `${credit.expiresAt}-${index}`,
              className: styleMap.codexResetCreditRow,
            },
            h(
              'span',
              { className: styleMap.codexResetCreditLabel },
              t('codex_quota.reset_credit_number', { index: index + 1 })
            ),
            h(
              'span',
              { className: styleMap.codexResetCreditTime },
              formatShanghaiDateTime(credit.expiresAt) || credit.expiresAt
            )
          )
        )
      )
    );
  } else if (rateLimitResetCreditsError) {
    nodes.push(
      h(
        'div',
        { key: 'reset-credit-expiry-error', className: styleMap.codexResetCreditsError },
        t('codex_quota.reset_credits_expiry_failed', {
          message: rateLimitResetCreditsError,
        })
      )
    );
  }

  if (windows.length === 0) {
    nodes.push(
      h('div', { key: 'empty', className: styleMap.quotaMessage }, t('codex_quota.empty_windows'))
    );
    return h(Fragment, null, ...nodes);
  }

  nodes.push(
    ...windows.map((window) => {
      const used = window.usedPercent;
      const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
      const remaining = clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
      const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
      const windowLabel = window.labelKey
        ? t(window.labelKey, window.labelParams as Record<string, string | number>)
        : window.label;
      const expired = isResetTimeExpired(window.resetTime);
      const resetClassName = expired ? styleMap.quotaResetExpired : styleMap.quotaReset;

      return h(
        'div',
        { key: window.id, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel }, windowLabel),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h('span', { className: styleMap.quotaPercent }, percentLabel),
            h('span', { className: resetClassName }, window.resetLabel)
          )
        ),
        h(QuotaProgressBar, {
          percent: remaining,
          highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
          mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
        })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

const buildKimiQuotaStateFromUsageQuota = (
  file: AuthFileItem
): Pick<KimiQuotaState, 'rows'> | null => {
  const snapshot = parseUsageQuotaSnapshot(file.usage_quota ?? file.usageQuota);
  if (!snapshot || !snapshot.known || snapshot.error) return null;

  const toRow = (
    resourceType: string | undefined,
    totalLimit: number | null,
    currentUsage: number | null,
    remaining: number | null,
    exhausted: boolean
  ): KimiQuotaRow | null => {
    const usage = computeSnapshotUsage(totalLimit, currentUsage, remaining, exhausted);
    if (
      usage.normalizedLimit === null &&
      usage.normalizedUsage === null &&
      usage.normalizedRemaining === null
    ) {
      return null;
    }

    const limit = usage.normalizedLimit ?? usage.normalizedUsage ?? 0;
    const used =
      usage.normalizedUsage ??
      (limit > 0 && usage.normalizedRemaining !== null
        ? Math.max(0, limit - usage.normalizedRemaining)
        : exhausted
          ? limit
          : 0);

    return {
      id: snapshotResourceId(resourceType, 'quota'),
      label: snapshotResourceLabel(resourceType, 'Kimi'),
      used: Math.round(Math.max(0, used)),
      limit: Math.round(Math.max(0, limit)),
      resetHint: snapshot.nextReset,
    };
  };

  const rows =
    snapshot.resources.length > 0
      ? snapshot.resources
          .map((resource) =>
            toRow(
              resource.resourceType,
              resource.totalLimit,
              resource.currentUsage,
              resource.remaining,
              resource.exhausted
            )
          )
          .filter((row): row is KimiQuotaRow => Boolean(row))
      : [
          toRow(
            snapshot.resourceType,
            snapshot.totalLimit,
            snapshot.currentUsage,
            snapshot.remaining,
            snapshot.exhausted
          ),
        ].filter((row): row is KimiQuotaRow => Boolean(row));

  return rows.length ? { rows } : null;
};

const buildClaudeQuotaWindows = (
  payload: ClaudeUsagePayload,
  t: TFunction
): ClaudeQuotaWindow[] => {
  const windows: ClaudeQuotaWindow[] = [];

  for (const { key, id, labelKey } of CLAUDE_USAGE_WINDOW_KEYS) {
    const window = payload[key as keyof ClaudeUsagePayload];
    if (!window || typeof window !== 'object' || !('utilization' in window)) continue;
    const typedWindow = window as { utilization: number; resets_at: string };
    const usedPercent = normalizeNumberValue(typedWindow.utilization);
    const resetLabel = formatQuotaResetTime(typedWindow.resets_at);
    windows.push({
      id,
      label: t(labelKey),
      labelKey,
      usedPercent,
      resetLabel,
      resetTime: typedWindow.resets_at,
    });
  }

  return windows;
};

const normalizeFlagValue = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(trimmed)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(trimmed)) return false;
  }
  return undefined;
};

const parseClaudeProfilePayload = (payload: unknown): ClaudeProfileResponse | null => {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as ClaudeProfileResponse;
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') {
    return payload as ClaudeProfileResponse;
  }
  return null;
};

const resolveClaudePlanType = (profile: ClaudeProfileResponse | null): string | null => {
  if (!profile) return null;

  const hasClaudeMax = normalizeFlagValue(profile.account?.has_claude_max);
  if (hasClaudeMax) return 'plan_max';

  const hasClaudePro = normalizeFlagValue(profile.account?.has_claude_pro);
  if (hasClaudePro) return 'plan_pro';

  const organizationType = normalizeStringValue(
    profile.organization?.organization_type
  )?.toLowerCase();
  const subscriptionStatus = normalizeStringValue(
    profile.organization?.subscription_status
  )?.toLowerCase();

  if (organizationType === 'claude_team' && subscriptionStatus === 'active') {
    return 'plan_team';
  }

  if (hasClaudeMax === false && hasClaudePro === false) return 'plan_free';

  return null;
};

const fetchClaudeQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<{
  windows: ClaudeQuotaWindow[];
  extraUsage?: ClaudeExtraUsage | null;
  planType?: string | null;
}> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('claude_quota.missing_auth_index'));
  }

  const [usageResult, profileResult] = await Promise.allSettled([
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_USAGE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_PROFILE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
  ]);

  if (usageResult.status === 'rejected') {
    throw usageResult.reason;
  }

  const result = usageResult.value;

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseClaudeUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('claude_quota.empty_windows'));
  }

  const windows = buildClaudeQuotaWindows(payload, t);
  const planType =
    profileResult.status === 'fulfilled' &&
    profileResult.value.statusCode >= 200 &&
    profileResult.value.statusCode < 300
      ? resolveClaudePlanType(
          parseClaudeProfilePayload(profileResult.value.body ?? profileResult.value.bodyText)
        )
      : null;

  return { windows, extraUsage: payload.extra_usage, planType };
};

const renderClaudeItems = (
  quota: ClaudeQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const windows = quota.windows ?? [];
  const extraUsage = quota.extraUsage ?? null;
  const planType = quota.planType ?? null;
  const nodes: ReactNode[] = [];

  if (planType) {
    nodes.push(
      h(
        'div',
        { key: 'plan', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('claude_quota.plan_label')),
        h('span', { className: styleMap.codexPlanValue }, t(`claude_quota.${planType}`))
      )
    );
  }

  if (extraUsage && extraUsage.is_enabled) {
    const usedLabel = `$${(extraUsage.used_credits / 100).toFixed(2)} / $${(extraUsage.monthly_limit / 100).toFixed(2)}`;
    nodes.push(
      h(
        'div',
        { key: 'extra', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('claude_quota.extra_usage_label')),
        h('span', { className: styleMap.codexPlanValue }, usedLabel)
      )
    );
  }

  if (windows.length === 0) {
    nodes.push(
      h('div', { key: 'empty', className: styleMap.quotaMessage }, t('claude_quota.empty_windows'))
    );
    return h(Fragment, null, ...nodes);
  }

  nodes.push(
    ...windows.map((window) => {
      const used = window.usedPercent;
      const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
      const remaining = clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
      const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
      const windowLabel = window.labelKey ? t(window.labelKey) : window.label;
      const expired = isResetTimeExpired(window.resetTime);
      const resetClassName = expired ? styleMap.quotaResetExpired : styleMap.quotaReset;

      return h(
        'div',
        { key: window.id, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel }, windowLabel),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h('span', { className: styleMap.quotaPercent }, percentLabel),
            h('span', { className: resetClassName }, window.resetLabel)
          )
        ),
        h(QuotaProgressBar, {
          percent: remaining,
          highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
          mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
        })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

const buildClaudeQuotaStateFromUsageQuota = (
  file: AuthFileItem
): Pick<ClaudeQuotaState, 'windows' | 'planType'> | null => {
  const snapshot = parseUsageQuotaSnapshot(file.usage_quota ?? file.usageQuota);
  if (!snapshot || !snapshot.known || snapshot.error) return null;

  const usage = computeSnapshotUsage(
    snapshot.totalLimit,
    snapshot.currentUsage,
    snapshot.remaining,
    snapshot.exhausted
  );
  if (
    usage.normalizedLimit === null &&
    usage.normalizedUsage === null &&
    usage.normalizedRemaining === null
  ) {
    return null;
  }

  const resourceType = snapshot.resourceType;
  return {
    windows: [
      {
        id: snapshotResourceId(resourceType, 'quota'),
        label: snapshotResourceLabel(resourceType, 'Claude'),
        usedPercent: usage.usedPercent,
        resetLabel: formatQuotaResetTime(snapshot.nextReset),
        resetTime: snapshot.nextReset,
      },
    ],
    planType: resolveClaudePlanType({ organization: { rate_limit_tier: resourceType } }),
  };
};

export const CLAUDE_CONFIG: QuotaConfig<
  ClaudeQuotaState,
  { windows: ClaudeQuotaWindow[]; extraUsage?: ClaudeExtraUsage | null; planType?: string | null }
> = {
  type: 'claude',
  i18nPrefix: 'claude_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isClaudeFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchClaudeQuota,
  storeSelector: (state) => state.claudeQuota,
  storeSetter: 'setClaudeQuota',
  buildLoadingState: () => ({ status: 'loading', windows: [] }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    extraUsage: data.extraUsage,
    planType: data.planType,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    error: message,
    errorStatus: status,
  }),
  buildSnapshotState: (file) => {
    if (!hasKnownUsageQuotaSnapshot(file.usage_quota ?? file.usageQuota)) return null;
    const data = buildClaudeQuotaStateFromUsageQuota(file);
    return data
      ? {
          status: 'success',
          windows: data.windows,
          extraUsage: null,
          planType: data.planType,
        }
      : null;
  },
  cardClassName: styles.claudeCard,
  controlsClassName: styles.claudeControls,
  controlClassName: styles.claudeControl,
  gridClassName: styles.claudeGrid,
  renderQuotaItems: renderClaudeItems,
};

export const ANTIGRAVITY_CONFIG: QuotaConfig<AntigravityQuotaState, AntigravityQuotaData> = {
  type: 'antigravity',
  i18nPrefix: 'antigravity_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isAntigravityFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchAntigravityQuota,
  storeSelector: (state) => state.antigravityQuota,
  storeSetter: 'setAntigravityQuota',
  buildLoadingState: () => ({
    status: 'loading',
    groups: [],
    subscription: null,
    serverTimeOffsetMs: null,
  }),
  buildSuccessState: (data) => ({
    status: 'success',
    groups: data.groups,
    subscription: data.subscription,
    serverTimeOffsetMs: data.serverTimeOffsetMs,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    groups: [],
    subscription: null,
    serverTimeOffsetMs: null,
    error: message,
    errorStatus: status,
  }),
  buildSnapshotState: (file) => {
    if (!hasKnownUsageQuotaSnapshot(file.usage_quota ?? file.usageQuota)) return null;
    const groups = buildAntigravityQuotaGroupsFromUsageQuota(file.usage_quota ?? file.usageQuota);
    return groups.length ? { status: 'success', groups } : null;
  },
  cardClassName: styles.antigravityCard,
  controlsClassName: styles.antigravityControls,
  controlClassName: styles.antigravityControl,
  gridClassName: styles.antigravityGrid,
  renderQuotaItems: renderAntigravityItems,
};

export const CODEX_CONFIG: QuotaConfig<CodexQuotaState, CodexQuotaData> = {
  type: 'codex',
  i18nPrefix: 'codex_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isCodexFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchCodexQuota,
  resetQuota: resetCodexQuota,
  canResetQuota: (quota) => (quota?.rateLimitResetCreditsAvailableCount ?? 0) > 0,
  storeSelector: (state) => state.codexQuota,
  storeSetter: 'setCodexQuota',
  buildLoadingState: () => ({
    status: 'loading',
    windows: [],
    rateLimitResetCredits: [],
    rateLimitResetCreditsError: '',
  }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    planType: data.planType,
    subscriptionActiveUntil: data.subscriptionActiveUntil,
    rateLimitResetCreditsAvailableCount: data.rateLimitResetCreditsAvailableCount,
    rateLimitResetCredits: data.rateLimitResetCredits,
    rateLimitResetCreditsError: data.rateLimitResetCreditsError,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    rateLimitResetCredits: [],
    rateLimitResetCreditsError: '',
    error: message,
    errorStatus: status,
  }),
  buildSnapshotState: (file) => {
    if (!hasKnownUsageQuotaSnapshot(file.usage_quota ?? file.usageQuota)) return null;
    const data = buildCodexQuotaStateFromUsageQuota(file);
    return data ? { status: 'success', windows: data.windows, planType: data.planType } : null;
  },
  cardClassName: styles.codexCard,
  controlsClassName: styles.codexControls,
  controlClassName: styles.codexControl,
  gridClassName: styles.codexGrid,
  renderQuotaItems: renderCodexItems,
};

type KiroQuotaData = {
  baseUsage: number | null;
  baseLimit: number | null;
  baseRemaining: number | null;
  bonusUsage: number | null;
  bonusLimit: number | null;
  bonusRemaining: number | null;
  bonusStatus?: string;
  bonusNextReset?: string;
  currentUsage: number | null;
  usageLimit: number | null;
  remainingCredits: number | null;
  nextReset?: string;
  subscriptionType?: string;
};

const KIRO_INACTIVE_BONUS_STATUSES = new Set(['EXPIRED', 'INACTIVE', 'ENDED', 'TERMINATED']);

const isExpiredIsoTimestamp = (value?: string): boolean => {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
};

export const hasActiveKiroBonus = (
  quota: Pick<KiroQuotaState, 'bonusLimit' | 'bonusStatus' | 'bonusNextReset'>
) => {
  const bonusStatusUpper = normalizeStringValue(quota.bonusStatus)?.toUpperCase() ?? '';
  return (
    typeof quota.bonusLimit === 'number' &&
    quota.bonusLimit > 0 &&
    !KIRO_INACTIVE_BONUS_STATUSES.has(bonusStatusUpper) &&
    !isExpiredIsoTimestamp(quota.bonusNextReset)
  );
};

export const getEffectiveKiroQuotaState = (quota: KiroQuotaState) => {
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
    if (normalized > 1_000_000_000_000) {
      return Math.round(normalized);
    }
    if (normalized > 1_000_000_000) {
      return Math.round(normalized * 1000);
    }
  }
  return null;
};

const toIsoFromKiroTimestamp = (value: number | null): string | undefined => {
  return toFutureKiroResetIso(value);
};

const fetchKiroQuota = async (file: AuthFileItem, t: TFunction): Promise<KiroQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
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
    if (freeTrialInfo.freeTrialStatus) {
      bonusStatus = freeTrialInfo.freeTrialStatus;
    }
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

  const nextReset = toIsoFromKiroTimestamp(normalizeKiroTimestamp(payload.nextDateReset));
  const bonusNextReset = toIsoFromKiroTimestamp(bonusNextResetTimestamp);
  const bonusStatusUpper = normalizeStringValue(bonusStatus)?.toUpperCase() ?? '';
  const bonusExpiredByStatus = KIRO_INACTIVE_BONUS_STATUSES.has(bonusStatusUpper);
  const bonusExpiredByTime =
    bonusNextResetTimestamp !== null && bonusNextResetTimestamp <= Date.now();
  const hasActiveBonus = bonusLimit > 0 && !bonusExpiredByStatus && !bonusExpiredByTime;
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

const renderKiroItems = (
  quota: KiroQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const effectiveQuota = getEffectiveKiroQuotaState(quota);
  const nodes: ReactNode[] = [];
  const formatResourceType = (value: string): string => {
    const normalized = value.trim().toUpperCase();
    const key = `kiro_quota.resource_${normalized.toLowerCase()}`;
    const translated = t(key);
    return translated === key ? value : translated;
  };

  if (effectiveQuota.subscriptionType) {
    nodes.push(
      h(
        'div',
        { key: 'subscription', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('kiro_quota.subscription_label')),
        h(
          'span',
          { className: styleMap.codexPlanValue },
          formatResourceType(effectiveQuota.subscriptionType)
        )
      )
    );
  }

  const usageLimit = effectiveQuota.usageLimit;
  if (usageLimit === null || usageLimit === 0) {
    nodes.push(
      h('div', { key: 'empty', className: styleMap.quotaMessage }, t('kiro_quota.empty_data'))
    );
    return h(Fragment, null, ...nodes);
  }

  const resetLabel = formatQuotaResetTime(effectiveQuota.nextReset);
  const bonusResetLabel = formatQuotaResetTime(effectiveQuota.bonusNextReset);
  const resetExpired = isResetTimeExpired(effectiveQuota.nextReset);
  const bonusResetExpired = isResetTimeExpired(effectiveQuota.bonusNextReset);
  const resetClassName = resetExpired ? styleMap.quotaResetExpired : styleMap.quotaReset;
  const bonusResetClassName = bonusResetExpired ? styleMap.quotaResetExpired : styleMap.quotaReset;
  const buildRemainingPercent = (remaining: number | null, limit: number | null) => {
    if (remaining === null || limit === null || limit <= 0) return 0;
    return Math.round((remaining / limit) * 100);
  };

  const baseRemainingPercent = buildRemainingPercent(
    effectiveQuota.baseRemaining,
    effectiveQuota.baseLimit
  );
  if (effectiveQuota.baseLimit !== null && effectiveQuota.baseLimit > 0) {
    nodes.push(
      h(
        'div',
        { key: 'base-credits', className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel }, t('kiro_quota.base_credits_label')),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h('span', { className: styleMap.quotaPercent }, `${baseRemainingPercent}%`),
            effectiveQuota.baseRemaining !== null
              ? h(
                  'span',
                  { className: styleMap.quotaAmount },
                  t('kiro_quota.remaining_credits', {
                    count: Math.round(effectiveQuota.baseRemaining),
                  })
                )
              : null,
            resetLabel !== '-'
              ? h('span', { className: resetClassName }, resetLabel)
              : null
          )
        ),
        h(QuotaProgressBar, {
          percent: baseRemainingPercent,
          highThreshold: 60,
          mediumThreshold: 20,
        })
      )
    );
  }

  const bonusRemainingPercent = buildRemainingPercent(
    effectiveQuota.bonusRemaining,
    effectiveQuota.bonusLimit
  );
  if (effectiveQuota.bonusLimit !== null && effectiveQuota.bonusLimit > 0) {
    nodes.push(
      h(
        'div',
        { key: 'bonus-credits', className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel }, t('kiro_quota.bonus_credits_label')),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h('span', { className: styleMap.quotaPercent }, `${bonusRemainingPercent}%`),
            effectiveQuota.bonusRemaining !== null
              ? h(
                  'span',
                  { className: styleMap.quotaAmount },
                  t('kiro_quota.remaining_credits', {
                    count: Math.round(effectiveQuota.bonusRemaining),
                  })
                )
              : null,
            bonusResetLabel !== '-'
              ? h('span', { className: bonusResetClassName }, bonusResetLabel)
              : null
          )
        ),
        h(QuotaProgressBar, {
          percent: bonusRemainingPercent,
          highThreshold: 60,
          mediumThreshold: 20,
        })
      )
    );
  }

  const totalRemainingPercent =
    effectiveQuota.currentUsage !== null && usageLimit > 0
      ? Math.max(0, 100 - Math.round((effectiveQuota.currentUsage / usageLimit) * 100))
      : 0;

  nodes.push(
    h(
      'div',
      { key: 'total-credits', className: styleMap.quotaRow },
      h(
        'div',
        { className: styleMap.quotaRowHeader },
        h('span', { className: styleMap.quotaModel }, t('kiro_quota.total_credits_label')),
        h(
          'div',
          { className: styleMap.quotaMeta },
          h('span', { className: styleMap.quotaPercent }, `${totalRemainingPercent}%`),
          effectiveQuota.remainingCredits !== null
            ? h(
                'span',
                { className: styleMap.quotaAmount },
                t('kiro_quota.remaining_credits', {
                  count: Math.round(effectiveQuota.remainingCredits),
                })
              )
            : null
        )
      ),
      h(QuotaProgressBar, {
        percent: totalRemainingPercent,
        highThreshold: 60,
        mediumThreshold: 20,
      })
    )
  );

  return h(Fragment, null, ...nodes);
};

export const KIRO_CONFIG: QuotaConfig<KiroQuotaState, KiroQuotaData> = {
  type: 'kiro',
  i18nPrefix: 'kiro_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isKiroFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchKiroQuota,
  storeSelector: (state) => state.kiroQuota,
  storeSetter: 'setKiroQuota',
  buildLoadingState: () => ({
    status: 'loading',
    baseUsage: null,
    baseLimit: null,
    baseRemaining: null,
    bonusUsage: null,
    bonusLimit: null,
    bonusRemaining: null,
    bonusNextReset: undefined,
    currentUsage: null,
    usageLimit: null,
    remainingCredits: null,
  }),
  buildSuccessState: (data) => ({
    status: 'success',
    baseUsage: data.baseUsage,
    baseLimit: data.baseLimit,
    baseRemaining: data.baseRemaining,
    bonusUsage: data.bonusUsage,
    bonusLimit: data.bonusLimit,
    bonusRemaining: data.bonusRemaining,
    bonusStatus: data.bonusStatus,
    bonusNextReset: data.bonusNextReset,
    currentUsage: data.currentUsage,
    usageLimit: data.usageLimit,
    remainingCredits: data.remainingCredits,
    nextReset: data.nextReset,
    subscriptionType: data.subscriptionType,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    baseUsage: null,
    baseLimit: null,
    baseRemaining: null,
    bonusUsage: null,
    bonusLimit: null,
    bonusRemaining: null,
    bonusNextReset: undefined,
    currentUsage: null,
    usageLimit: null,
    remainingCredits: null,
    error: message,
    errorStatus: status,
  }),
  buildSnapshotState: (file) => {
    if (!hasKnownUsageQuotaSnapshot(file.usage_quota ?? file.usageQuota)) return null;
    const data = buildKiroQuotaDataFromUsageQuota(file.usage_quota ?? file.usageQuota);
    return data
      ? {
          status: 'success',
          baseUsage: data.baseUsage,
          baseLimit: data.baseLimit,
          baseRemaining: data.baseRemaining,
          bonusUsage: data.bonusUsage,
          bonusLimit: data.bonusLimit,
          bonusRemaining: data.bonusRemaining,
          bonusStatus: data.bonusStatus,
          bonusNextReset: data.bonusNextReset,
          currentUsage: data.currentUsage,
          usageLimit: data.usageLimit,
          remainingCredits: data.remainingCredits,
          nextReset: data.nextReset,
          subscriptionType: data.subscriptionType,
        }
      : null;
  },
  cardClassName: styles.kiroCard,
  controlsClassName: styles.kiroControls,
  controlClassName: styles.kiroControl,
  gridClassName: styles.kiroGrid,
  renderQuotaItems: renderKiroItems,
};

const fetchKimiQuota = async (file: AuthFileItem, t: TFunction): Promise<KimiQuotaRow[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('kimi_quota.missing_auth_index'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: KIMI_USAGE_URL,
    header: { ...KIMI_REQUEST_HEADERS },
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseKimiUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('kimi_quota.empty_data'));
  }

  return buildKimiQuotaRows(payload);
};

const renderKimiItems = (
  quota: KimiQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h } = React;
  const rows = quota.rows ?? [];

  if (rows.length === 0) {
    return h('div', { className: styleMap.quotaMessage }, t('kimi_quota.empty_data'));
  }

  return rows.map((row) => {
    const limit = row.limit;
    const used = row.used;
    const remaining =
      limit > 0
        ? Math.max(0, Math.min(100, Math.round(((limit - used) / limit) * 100)))
        : used > 0
          ? 0
          : null;
    const percentLabel = remaining === null ? '--' : `${remaining}%`;
    const rowLabel = row.labelKey
      ? t(row.labelKey, (row.labelParams ?? {}) as Record<string, string | number>)
      : (row.label ?? '');
    const resetLabel = formatKimiResetHint(t, row.resetHint);

    return h(
      'div',
      { key: row.id, className: styleMap.quotaRow },
      h(
        'div',
        { className: styleMap.quotaRowHeader },
        h('span', { className: styleMap.quotaModel }, rowLabel),
        h(
          'div',
          { className: styleMap.quotaMeta },
          h('span', { className: styleMap.quotaPercent }, percentLabel),
          resetLabel ? h('span', { className: styleMap.quotaReset }, resetLabel) : null
        )
      ),
      h(QuotaProgressBar, {
        percent: remaining,
        highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
        mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
      })
    );
  });
};

const normalizeXaiCentValue = (value: XaiBillingConfig['monthlyLimit']): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return normalizeNumberValue((value as { val?: unknown }).val);
  }
  return normalizeNumberValue(value);
};

const buildXaiBillingSummary = (
  config: XaiBillingConfig | null | undefined
): XaiBillingSummary | null => {
  if (!config || typeof config !== 'object') return null;

  const monthlyLimitCents = normalizeXaiCentValue(config.monthlyLimit ?? config.monthly_limit);
  const usedCents = normalizeXaiCentValue(config.used);
  const onDemandCapCents = normalizeXaiCentValue(config.onDemandCap ?? config.on_demand_cap);
  const billingPeriodStart =
    normalizeStringValue(config.billingPeriodStart ?? config.billing_period_start) ?? undefined;
  const billingPeriodEnd =
    normalizeStringValue(config.billingPeriodEnd ?? config.billing_period_end) ?? undefined;

  if (
    monthlyLimitCents === null &&
    usedCents === null &&
    onDemandCapCents === null &&
    !billingPeriodEnd
  ) {
    return null;
  }

  const includedUsedCents =
    usedCents === null
      ? null
      : monthlyLimitCents !== null && monthlyLimitCents > 0
        ? Math.min(usedCents, monthlyLimitCents)
        : usedCents;
  const onDemandUsedCents =
    usedCents !== null && monthlyLimitCents !== null
      ? Math.max(0, usedCents - monthlyLimitCents)
      : null;
  const usedPercent =
    monthlyLimitCents !== null && monthlyLimitCents > 0 && includedUsedCents !== null
      ? (includedUsedCents / monthlyLimitCents) * 100
      : null;
  const onDemandUsedPercent =
    onDemandCapCents !== null && onDemandCapCents > 0 && onDemandUsedCents !== null
      ? (onDemandUsedCents / onDemandCapCents) * 100
      : null;

  return {
    monthlyLimitCents,
    usedCents,
    includedUsedCents,
    onDemandCapCents,
    onDemandUsedCents,
    onDemandUsedPercent,
    billingPeriodStart,
    billingPeriodEnd,
    usedPercent,
  };
};

const buildXaiQuotaStateFromUsageQuota = (
  file: AuthFileItem
): Pick<XaiQuotaState, 'billing' | 'resources'> | null => {
  const snapshot = parseUsageQuotaSnapshot(file.usage_quota ?? file.usageQuota);
  if (!snapshot || !snapshot.known || snapshot.error) return null;

  const sourceResources =
    snapshot.resources.length > 0
      ? snapshot.resources
      : [
          {
            resourceType: snapshot.resourceType,
            totalLimit: snapshot.totalLimit,
            currentUsage: snapshot.currentUsage,
            remaining: snapshot.remaining,
            resetAt: snapshot.nextReset,
            exhausted: snapshot.exhausted,
          },
        ];
  const resources: XaiRateLimitQuota[] = sourceResources
    .filter(
      (resource) =>
        resource.totalLimit !== null ||
        resource.currentUsage !== null ||
        resource.remaining !== null
    )
    .map((resource) => ({
      resourceType: resource.resourceType || 'quota',
      totalLimit: resource.totalLimit,
      currentUsage: resource.currentUsage,
      remaining: resource.remaining,
      resetAt: resource.resetAt || snapshot.nextReset,
      exhausted: resource.exhausted,
    }))
    .sort((a, b) => {
      const order = (resourceType: string) =>
        resourceType.toLowerCase() === 'requests'
          ? 0
          : resourceType.toLowerCase() === 'tokens'
            ? 1
            : 2;
      return order(a.resourceType) - order(b.resourceType);
    });
  if (resources.length === 0) return null;

  return {
    billing: null,
    resources,
  };
};

const fetchXaiQuota = async (file: AuthFileItem, t: TFunction): Promise<XaiBillingSummary> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('xai_quota.missing_auth_index'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: XAI_BILLING_URL,
    header: { ...XAI_REQUEST_HEADERS },
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseXaiBillingPayload(result.body ?? result.bodyText);
  const summary = buildXaiBillingSummary(payload?.config);
  if (!summary) {
    throw new Error(t('xai_quota.empty_data'));
  }

  return summary;
};

const formatUsdFromCents = (cents: number | null): string => {
  if (cents === null) return '--';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
};

const formatXaiRateLimitAmount = (remaining: number | null, totalLimit: number | null): string => {
  const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  if (remaining !== null && totalLimit !== null) {
    return `${formatter.format(remaining)} / ${formatter.format(totalLimit)}`;
  }
  if (remaining !== null) return formatter.format(remaining);
  if (totalLimit !== null) return formatter.format(totalLimit);
  return '--';
};

const formatXaiRemainingAmount = (billing: XaiBillingSummary): string => {
  const remainingCents =
    billing.monthlyLimitCents !== null && billing.includedUsedCents !== null
      ? Math.max(0, billing.monthlyLimitCents - billing.includedUsedCents)
      : null;
  const remaining = formatUsdFromCents(remainingCents);
  const limit = formatUsdFromCents(billing.monthlyLimitCents);
  if (billing.monthlyLimitCents === null) return remaining;
  return `${remaining} / ${limit}`;
};

const formatXaiOnDemandAmount = (billing: XaiBillingSummary): string => {
  const remainingCents =
    billing.onDemandCapCents !== null && billing.onDemandUsedCents !== null
      ? Math.max(0, billing.onDemandCapCents - billing.onDemandUsedCents)
      : null;
  const remaining = formatUsdFromCents(remainingCents);
  const cap = formatUsdFromCents(billing.onDemandCapCents);
  if (billing.onDemandCapCents === null) return remaining;
  return `${remaining} / ${cap}`;
};

const XAI_SUPERGROK_LIMIT_CENTS = 15_000;
const XAI_SUPERGROK_HEAVY_LIMIT_CENTS = 150_000;

const resolveXaiPlan = (
  monthlyLimitCents: number | null
): { labelKey: string; premium: boolean } | null => {
  if (monthlyLimitCents === XAI_SUPERGROK_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok', premium: false };
  }
  if (monthlyLimitCents === XAI_SUPERGROK_HEAVY_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok_heavy', premium: true };
  }
  return null;
};

const renderXaiItems = (
  quota: XaiQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const billing = quota.billing;

  if (quota.resources.length > 0) {
    return h(
      Fragment,
      null,
      ...quota.resources.map((resource) => {
        const usage = computeSnapshotUsage(
          resource.totalLimit,
          resource.currentUsage,
          resource.remaining,
          resource.exhausted
        );
        const remainingPercent =
          usage.remainingFraction === null ? null : usage.remainingFraction * 100;
        const normalizedType = resource.resourceType.trim().toLowerCase();
        const label =
          normalizedType === 'requests' || normalizedType === 'tokens'
            ? t(`xai_quota.resource_${normalizedType}`)
            : snapshotResourceLabel(resource.resourceType, t('xai_quota.resource_quota'));

        return h(
          'div',
          { key: `rate-limit-${normalizedType}`, className: styleMap.quotaRow },
          h(
            'div',
            { className: styleMap.quotaRowHeader },
            h('span', { className: styleMap.quotaModel }, label),
            h(
              'div',
              { className: styleMap.quotaMeta },
              h(
                'span',
                { className: styleMap.quotaPercent },
                remainingPercent === null ? '--' : `${Math.round(remainingPercent)}%`
              ),
              h(
                'span',
                { className: styleMap.quotaAmount },
                formatXaiRateLimitAmount(usage.normalizedRemaining, usage.normalizedLimit)
              ),
              h('span', { className: styleMap.quotaReset }, formatQuotaResetTime(resource.resetAt))
            )
          ),
          h(QuotaProgressBar, {
            percent: remainingPercent,
            highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
            mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
          })
        );
      })
    );
  }

  if (!billing) {
    return h('div', { className: styleMap.quotaMessage }, t('xai_quota.empty_data'));
  }

  const clampedUsed =
    billing.usedPercent === null ? null : Math.max(0, Math.min(100, billing.usedPercent));
  const remaining = clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
  const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
  const amountLabel = formatXaiRemainingAmount(billing);
  const resetLabel = formatQuotaResetTime(billing.billingPeriodEnd);
  const onDemandCap = billing.onDemandCapCents ?? 0;
  const clampedOnDemandUsed =
    billing.onDemandUsedPercent === null
      ? null
      : Math.max(0, Math.min(100, billing.onDemandUsedPercent));
  const onDemandRemaining =
    clampedOnDemandUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedOnDemandUsed));
  const onDemandPercentLabel =
    onDemandRemaining === null ? '--' : `${Math.round(onDemandRemaining)}%`;
  const onDemandAmountLabel = formatXaiOnDemandAmount(billing);
  const plan = resolveXaiPlan(billing.monthlyLimitCents);

  return h(
    Fragment,
    null,
    plan
      ? h(
          'div',
          { key: 'plan', className: styleMap.codexPlan },
          h('span', { className: styleMap.codexPlanLabel }, t('xai_quota.plan_label')),
          h(
            'span',
            { className: plan.premium ? styleMap.premiumPlanValue : styleMap.codexPlanValue },
            t(`xai_quota.${plan.labelKey}`)
          )
        )
      : null,
    onDemandCap > 0
      ? h(
          'div',
          { key: 'pay-as-you-go', className: styleMap.quotaRow },
          h(
            'div',
            { className: styleMap.quotaRowHeader },
            h('span', { className: styleMap.quotaModel }, t('xai_quota.pay_as_you_go_label')),
            h(
              'div',
              { className: styleMap.quotaMeta },
              h('span', { className: styleMap.quotaPercent }, onDemandPercentLabel),
              h('span', { className: styleMap.quotaAmount }, onDemandAmountLabel)
            )
          ),
          h(QuotaProgressBar, {
            percent: onDemandRemaining,
            highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
            mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
          })
        )
      : h(
          'div',
          { key: 'pay-as-you-go', className: styleMap.codexPlan },
          h('span', { className: styleMap.codexPlanLabel }, t('xai_quota.pay_as_you_go_label')),
          h('span', { className: styleMap.codexPlanValue }, t('xai_quota.pay_as_you_go_disabled'))
        ),
    h(
      'div',
      { key: 'monthly-credits', className: styleMap.quotaRow },
      h(
        'div',
        { className: styleMap.quotaRowHeader },
        h('span', { className: styleMap.quotaModel }, t('xai_quota.monthly_credits')),
        h(
          'div',
          { className: styleMap.quotaMeta },
          h('span', { className: styleMap.quotaPercent }, percentLabel),
          h('span', { className: styleMap.quotaAmount }, amountLabel),
          h('span', { className: styleMap.quotaReset }, resetLabel)
        )
      ),
      h(QuotaProgressBar, {
        percent: remaining,
        highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
        mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
      })
    )
  );
};

export const KIMI_CONFIG: QuotaConfig<KimiQuotaState, KimiQuotaRow[]> = {
  type: 'kimi',
  i18nPrefix: 'kimi_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isKimiFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchKimiQuota,
  storeSelector: (state) => state.kimiQuota,
  storeSetter: 'setKimiQuota',
  buildLoadingState: () => ({ status: 'loading', rows: [] }),
  buildSuccessState: (rows) => ({ status: 'success', rows }),
  buildErrorState: (message, status) => ({
    status: 'error',
    rows: [],
    error: message,
    errorStatus: status,
  }),
  buildSnapshotState: (file) => {
    if (!hasKnownUsageQuotaSnapshot(file.usage_quota ?? file.usageQuota)) return null;
    const data = buildKimiQuotaStateFromUsageQuota(file);
    return data ? { status: 'success', rows: data.rows } : null;
  },
  cardClassName: styles.kimiCard,
  controlsClassName: styles.kimiControls,
  controlClassName: styles.kimiControl,
  gridClassName: styles.kimiGrid,
  renderQuotaItems: renderKimiItems,
};

export const XAI_CONFIG: QuotaConfig<XaiQuotaState, XaiBillingSummary> = {
  type: 'xai',
  i18nPrefix: 'xai_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isXaiFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchXaiQuota,
  storeSelector: (state) => state.xaiQuota,
  storeSetter: 'setXaiQuota',
  buildLoadingState: () => ({ status: 'loading', billing: null, resources: [] }),
  buildSuccessState: (billing) => ({ status: 'success', billing, resources: [] }),
  buildErrorState: (message, status) => ({
    status: 'error',
    billing: null,
    resources: [],
    error: message,
    errorStatus: status,
  }),
  buildSnapshotState: (file) => {
    if (!hasKnownUsageQuotaSnapshot(file.usage_quota ?? file.usageQuota)) return null;
    const data = buildXaiQuotaStateFromUsageQuota(file);
    return data ? { status: 'success', billing: data.billing, resources: data.resources } : null;
  },
  cardClassName: styles.xaiCard,
  controlsClassName: styles.xaiControls,
  controlClassName: styles.xaiControl,
  gridClassName: styles.xaiGrid,
  renderQuotaItems: renderXaiItems,
};
