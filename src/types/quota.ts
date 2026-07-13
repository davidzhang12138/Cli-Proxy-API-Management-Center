/**
 * Quota management types.
 */

// Theme types
export type ThemeColors = { bg: string; text: string; border?: string };
export type TypeColorSet = { light: ThemeColors; dark?: ThemeColors };
export type ResolvedTheme = 'light' | 'dark';

// API payload types
export interface AntigravityQuotaSummaryBucketPayload {
  bucketId?: string;
  bucket_id?: string;
  displayName?: string;
  display_name?: string;
  window?: string;
  resetTime?: string;
  reset_time?: string;
  remainingFraction?: number | string;
  remaining_fraction?: number | string;
  description?: string;
}

export interface AntigravityQuotaSummaryGroupPayload {
  displayName?: string;
  display_name?: string;
  description?: string;
  buckets?: AntigravityQuotaSummaryBucketPayload[];
}

export interface AntigravityQuotaSummaryPayload {
  groups?: AntigravityQuotaSummaryGroupPayload[];
}

export interface AntigravityQuotaInfo {
  displayName?: string;
  quotaInfo?: {
    remainingFraction?: number | string;
    remaining_fraction?: number | string;
    remaining?: number | string;
    resetTime?: string;
    reset_time?: string;
  };
  quota_info?: {
    remainingFraction?: number | string;
    remaining_fraction?: number | string;
    remaining?: number | string;
    resetTime?: string;
    reset_time?: string;
  };
}

export type AntigravityModelsPayload = Record<string, AntigravityQuotaInfo>;

export interface AntigravityQuotaGroupDefinition {
  id: string;
  label: string;
  identifiers: string[];
  labelFromModel?: boolean;
}

export interface UsageQuotaSnapshotPayload {
  known?: boolean | string | number;
  total_limit?: number | string | null;
  totalLimit?: number | string | null;
  current_usage?: number | string | null;
  currentUsage?: number | string | null;
  remaining?: number | string | null;
  exhausted?: boolean | string | number | null;
  resource_type?: string | null;
  resourceType?: string | null;
  next_reset?: string | number | null;
  nextReset?: string | number | null;
  checked_at?: string | number | null;
  checkedAt?: string | number | null;
  error?: string | null;
  resources?: UsageQuotaResourcePayload[];
}

export interface UsageQuotaResourcePayload {
  resource_type?: string | null;
  resourceType?: string | null;
  total_limit?: number | string | null;
  totalLimit?: number | string | null;
  current_usage?: number | string | null;
  currentUsage?: number | string | null;
  remaining?: number | string | null;
  minimum_credit_amount_for_usage?: number | string | null;
  minimumCreditAmountForUsage?: number | string | null;
  window_seconds?: number | string | null;
  windowSeconds?: number | string | null;
  reset_at?: string | number | null;
  resetAt?: string | number | null;
  exhausted?: boolean | string | number | null;
}

export interface UsageQuotaSnapshot {
  known: boolean;
  totalLimit: number | null;
  currentUsage: number | null;
  remaining: number | null;
  exhausted: boolean;
  resourceType?: string;
  nextReset?: string;
  checkedAt?: string;
  error?: string;
  resources: UsageQuotaResource[];
}

export interface UsageQuotaResource {
  resourceType?: string;
  totalLimit: number | null;
  currentUsage: number | null;
  remaining: number | null;
  minimumCreditAmountForUsage: number | null;
  windowSeconds: number | null;
  resetAt?: string;
  exhausted: boolean;
}

export interface CodexUsageWindow {
  used_percent?: number | string;
  usedPercent?: number | string;
  limit_window_seconds?: number | string;
  limitWindowSeconds?: number | string;
  reset_after_seconds?: number | string;
  resetAfterSeconds?: number | string;
  reset_at?: number | string;
  resetAt?: number | string;
}

export interface CodexRateLimitInfo {
  allowed?: boolean;
  limit_reached?: boolean;
  limitReached?: boolean;
  primary_window?: CodexUsageWindow | null;
  primaryWindow?: CodexUsageWindow | null;
  secondary_window?: CodexUsageWindow | null;
  secondaryWindow?: CodexUsageWindow | null;
}

export interface CodexAdditionalRateLimit {
  limit_name?: string;
  limitName?: string;
  metered_feature?: string;
  meteredFeature?: string;
  rate_limit?: CodexRateLimitInfo | null;
  rateLimit?: CodexRateLimitInfo | null;
}

export interface CodexRateLimitResetCredits {
  available_count?: number | string;
  availableCount?: number | string;
}

export interface CodexRateLimitResetCredit {
  id: string;
  status: string;
  grantedAt: string;
  expiresAt: string;
}

export interface CodexUsagePayload {
  plan_type?: string;
  planType?: string;
  rate_limit?: CodexRateLimitInfo | null;
  rateLimit?: CodexRateLimitInfo | null;
  code_review_rate_limit?: CodexRateLimitInfo | null;
  codeReviewRateLimit?: CodexRateLimitInfo | null;
  additional_rate_limits?: CodexAdditionalRateLimit[] | null;
  additionalRateLimits?: CodexAdditionalRateLimit[] | null;
  rate_limit_reset_credits?: CodexRateLimitResetCredits | null;
  rateLimitResetCredits?: CodexRateLimitResetCredits | null;
}

// Claude API payload types
export interface ClaudeUsageWindow {
  utilization: number;
  resets_at: string;
}

export interface ClaudeExtraUsage {
  is_enabled: boolean;
  monthly_limit: number;
  used_credits: number;
  utilization: number | null;
}

export interface ClaudeUsagePayload {
  five_hour?: ClaudeUsageWindow | null;
  seven_day?: ClaudeUsageWindow | null;
  seven_day_oauth_apps?: ClaudeUsageWindow | null;
  seven_day_opus?: ClaudeUsageWindow | null;
  seven_day_sonnet?: ClaudeUsageWindow | null;
  seven_day_cowork?: ClaudeUsageWindow | null;
  iguana_necktie?: ClaudeUsageWindow | null;
  extra_usage?: ClaudeExtraUsage | null;
}

export interface ClaudeProfileResponse {
  account?: {
    uuid?: string;
    full_name?: string;
    display_name?: string;
    email?: string;
    has_claude_max?: boolean;
    has_claude_pro?: boolean;
    created_at?: string;
  };
  organization?: {
    uuid?: string;
    name?: string;
    organization_type?: string;
    billing_type?: string;
    rate_limit_tier?: string;
    has_extra_usage_enabled?: boolean;
    subscription_status?: string;
    subscription_created_at?: string;
  };
}

export interface ClaudeQuotaWindow {
  id: string;
  label: string;
  labelKey?: string;
  usedPercent: number | null;
  resetLabel: string;
  resetTime?: string;
}

export interface ClaudeQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  windows: ClaudeQuotaWindow[];
  extraUsage?: ClaudeExtraUsage | null;
  planType?: string | null;
  error?: string;
  errorStatus?: number;
}

// Quota state types
export interface AntigravityQuotaGroup {
  id: string;
  label: string;
  description?: string;
  models: string[];
  remainingFraction: number;
  remainingAmount?: number;
  minimumAmount?: number;
  resetTime?: string;
  buckets?: AntigravityQuotaBucket[];
}

export interface AntigravityQuotaSubscription {
  plan: string | null;
  tierName: string | null;
  tierId: string | null;
}

export interface AntigravityQuotaBucket {
  id: string;
  label: string;
  window?: string;
  remainingFraction: number;
  remainingAmount?: number;
  minimumAmount?: number;
  resetTime?: string;
  description?: string;
}

export interface AntigravityQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  groups: AntigravityQuotaGroup[];
  subscription?: AntigravityQuotaSubscription | null;
  serverTimeOffsetMs?: number | null;
  error?: string;
  errorStatus?: number;
}

export interface CodexQuotaWindow {
  id: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent: number | null;
  resetLabel: string;
  resetTime?: string;
}

export interface CodexQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  windows: CodexQuotaWindow[];
  planType?: string | null;
  subscriptionActiveUntil?: string | number | null;
  rateLimitResetCreditsAvailableCount?: number | null;
  rateLimitResetCredits?: CodexRateLimitResetCredit[];
  rateLimitResetCreditsError?: string;
  error?: string;
  errorStatus?: number;
}

// Kimi API payload types
export interface KimiUsageDetail {
  used?: number;
  limit?: number;
  remaining?: number;
  name?: string;
  title?: string;
  resetAt?: string;
  reset_at?: string;
  resetTime?: string;
  reset_time?: string;
  resetIn?: number;
  reset_in?: number;
  ttl?: number;
}

export interface KimiLimitWindow {
  duration?: number;
  timeUnit?: string;
}

export interface KimiLimitItem {
  name?: string;
  title?: string;
  scope?: string;
  detail?: KimiUsageDetail;
  window?: KimiLimitWindow;
  used?: number;
  limit?: number;
  remaining?: number;
  duration?: number;
  timeUnit?: string;
  resetAt?: string;
  reset_at?: string;
  resetIn?: number;
  reset_in?: number;
  ttl?: number;
}

export interface KimiUsagePayload {
  usage?: KimiUsageDetail;
  limits?: KimiLimitItem[];
}

export interface KimiQuotaRow {
  id: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  used: number;
  limit: number;
  resetHint?: string;
}

export interface KimiQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  rows: KimiQuotaRow[];
  error?: string;
  errorStatus?: number;
}

export interface KiroFreeTrialInfo {
  freeTrialStatus?: string;
  freeTrialExpiry?: number | string;
  free_trial_expiry?: number | string;
  usageLimit?: number;
  currentUsage?: number;
  usageLimitWithPrecision?: number;
  currentUsageWithPrecision?: number;
  nextDateReset?: number | string;
  next_date_reset?: number | string;
  expiresAt?: number | string;
  expires_at?: number | string;
  expirationDate?: number | string;
  expiration_date?: number | string;
  expiryDate?: number | string;
  expiry_date?: number | string;
  endAt?: number | string;
  end_at?: number | string;
}

export interface KiroUsageBreakdown {
  usageLimit?: number;
  currentUsage?: number;
  usageLimitWithPrecision?: number;
  currentUsageWithPrecision?: number;
  nextDateReset?: number;
  displayName?: string;
  resourceType?: string;
  freeTrialInfo?: KiroFreeTrialInfo;
}

export interface KiroQuotaPayload {
  daysUntilReset?: number;
  nextDateReset?: number;
  userInfo?: {
    email?: string;
    userId?: string;
  };
  subscriptionInfo?: {
    subscriptionTitle?: string;
    type?: string;
  };
  usageBreakdownList?: KiroUsageBreakdown[];
}

export interface KiroQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
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
  error?: string;
  errorStatus?: number;
}

// xAI/Grok API payload types
export interface XaiBillingCent {
  val?: number | string;
}

export interface XaiBillingPeriod {
  type?: string;
  start?: string;
  end?: string;
}

export interface XaiBillingProductUsage {
  product?: string;
  usagePercent?: number | string | null;
  usage_percent?: number | string | null;
}

export interface XaiBillingConfig {
  currentPeriod?: XaiBillingPeriod | null;
  current_period?: XaiBillingPeriod | null;
  creditUsagePercent?: number | string | null;
  credit_usage_percent?: number | string | null;
  productUsage?: XaiBillingProductUsage[] | null;
  product_usage?: XaiBillingProductUsage[] | null;
  monthlyLimit?: XaiBillingCent | number | string | null;
  monthly_limit?: XaiBillingCent | number | string | null;
  used?: XaiBillingCent | number | string | null;
  onDemandCap?: XaiBillingCent | number | string | null;
  on_demand_cap?: XaiBillingCent | number | string | null;
  onDemandUsed?: XaiBillingCent | number | string | null;
  on_demand_used?: XaiBillingCent | number | string | null;
  billingPeriodStart?: string;
  billing_period_start?: string;
  billingPeriodEnd?: string;
  billing_period_end?: string;
}

export interface XaiBillingPayload {
  config?: XaiBillingConfig | null;
}

export type XaiBillingPeriodType = 'weekly' | 'monthly' | 'unknown';

export interface XaiProductUsageSummary {
  product: string;
  usagePercent: number | null;
}

export interface XaiBillingSummary {
  periodType: XaiBillingPeriodType;
  usagePercent: number | null;
  periodStart?: string;
  periodEnd?: string;
  productUsage: XaiProductUsageSummary[];
  monthlyLimitCents: number | null;
  usedCents: number | null;
  includedUsedCents: number | null;
  onDemandCapCents: number | null;
  onDemandUsedCents: number | null;
  onDemandUsedPercent: number | null;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  usedPercent: number | null;
}

export interface XaiRateLimitQuota {
  resourceType: string;
  totalLimit: number | null;
  currentUsage: number | null;
  remaining: number | null;
  resetAt?: string;
  exhausted: boolean;
}

export interface XaiQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  billing: XaiBillingSummary | null;
  resources: XaiRateLimitQuota[];
  error?: string;
  errorStatus?: number;
}
