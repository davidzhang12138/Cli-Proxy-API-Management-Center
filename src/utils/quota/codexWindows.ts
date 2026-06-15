export type CodexQuotaWindowLabelKey =
  | 'codex_quota.primary_window'
  | 'codex_quota.monthly_window'
  | 'codex_quota.secondary_window'
  | 'codex_quota.team_secondary_window'
  | 'codex_quota.code_review_primary_window'
  | 'codex_quota.code_review_secondary_window'
  | 'codex_quota.code_review_team_secondary_window'
  | 'codex_quota.additional_primary_window'
  | 'codex_quota.additional_secondary_window'
  | 'codex_quota.additional_team_secondary_window';

export type CodexQuotaWindowPeriod = 'five-hour' | 'weekly' | 'monthly' | null;

export interface CodexQuotaWindowMeta {
  id?: string;
  labelKey?: CodexQuotaWindowLabelKey;
  labelParams?: Record<string, string | number>;
}

const FIVE_HOUR_SECONDS = 18_000;
const WEEK_SECONDS = 604_800;
const MIN_MONTH_SECONDS = 2_419_200;
const MAX_MONTH_SECONDS = 2_678_400;

export const CODEX_WINDOW_META = {
  codeFiveHour: { id: 'five-hour', labelKey: 'codex_quota.primary_window' },
  codeWeekly: { id: 'weekly', labelKey: 'codex_quota.secondary_window' },
  codeMonthly: { id: 'monthly', labelKey: 'codex_quota.monthly_window' },
  codeTeamSecondary: { id: 'monthly', labelKey: 'codex_quota.team_secondary_window' },
  codeReviewFiveHour: {
    id: 'code-review-five-hour',
    labelKey: 'codex_quota.code_review_primary_window',
  },
  codeReviewWeekly: {
    id: 'code-review-weekly',
    labelKey: 'codex_quota.code_review_secondary_window',
  },
  codeReviewMonthly: {
    id: 'code-review-monthly',
    labelKey: 'codex_quota.code_review_team_secondary_window',
  },
} as const satisfies Record<string, CodexQuotaWindowMeta>;

export const inferCodexQuotaWindowPeriod = (
  windowSeconds: number | null | undefined
): CodexQuotaWindowPeriod => {
  if (windowSeconds === null || windowSeconds === undefined) return null;
  if (windowSeconds === FIVE_HOUR_SECONDS) return 'five-hour';
  if (windowSeconds === WEEK_SECONDS) return 'weekly';
  if (windowSeconds >= MIN_MONTH_SECONDS && windowSeconds <= MAX_MONTH_SECONDS) return 'monthly';
  return null;
};

const additionalMeta = (
  name: string,
  period: CodexQuotaWindowPeriod,
  idPrefix: string
): CodexQuotaWindowMeta => {
  if (period === 'weekly') {
    return {
      id: `${idPrefix}-weekly`,
      labelKey: 'codex_quota.additional_secondary_window',
      labelParams: { name },
    };
  }
  if (period === 'monthly') {
    return {
      id: `${idPrefix}-monthly`,
      labelKey: 'codex_quota.additional_team_secondary_window',
      labelParams: { name },
    };
  }
  return {
    id: `${idPrefix}-five-hour`,
    labelKey: 'codex_quota.additional_primary_window',
    labelParams: { name },
  };
};

export const resolveCodexQuotaWindowMeta = (options: {
  resourceType?: string;
  windowSeconds?: number | null;
  isFreePlan?: boolean;
  additionalName?: string;
  additionalIdPrefix?: string;
}): CodexQuotaWindowMeta => {
  const normalized = (options.resourceType ?? '').trim().toLowerCase();
  const period = inferCodexQuotaWindowPeriod(options.windowSeconds);

  if (options.additionalName && options.additionalIdPrefix) {
    return additionalMeta(options.additionalName, period, options.additionalIdPrefix);
  }

  if (normalized === 'primary_window') {
    if (period === 'weekly') return CODEX_WINDOW_META.codeWeekly;
    if (period === 'monthly') return CODEX_WINDOW_META.codeMonthly;
    if (period === 'five-hour') return CODEX_WINDOW_META.codeFiveHour;
    return options.isFreePlan ? CODEX_WINDOW_META.codeMonthly : CODEX_WINDOW_META.codeFiveHour;
  }

  if (normalized === 'secondary_window') {
    if (period === 'five-hour') return CODEX_WINDOW_META.codeFiveHour;
    if (period === 'monthly') return CODEX_WINDOW_META.codeTeamSecondary;
    return CODEX_WINDOW_META.codeWeekly;
  }

  if (normalized === 'code_review_primary_window') {
    if (period === 'weekly') return CODEX_WINDOW_META.codeReviewWeekly;
    return CODEX_WINDOW_META.codeReviewFiveHour;
  }

  if (normalized === 'code_review_secondary_window') {
    if (period === 'five-hour') return CODEX_WINDOW_META.codeReviewFiveHour;
    if (period === 'monthly') return CODEX_WINDOW_META.codeReviewMonthly;
    return CODEX_WINDOW_META.codeReviewWeekly;
  }

  return {};
};
