import type { AuthFileItem } from '@/types';
import {
  buildAntigravityQuotaGroupsFromUsageQuota,
  buildKiroQuotaDataFromUsageQuota,
  parseUsageQuotaSnapshot,
  toFutureKiroResetIso,
} from './usageQuota';

const usageQuotaPayload = {
  known: true,
  total_limit: '100',
  current_usage: 25,
  remaining: '75',
  exhausted: false,
  resource_type: 'GOOGLE_ONE_AI',
  next_reset: '2026-06-03T00:00:00Z',
  checked_at: '2026-06-02T12:00:00Z',
} satisfies NonNullable<AuthFileItem['usage_quota']>;

const parsedSnapshot = parseUsageQuotaSnapshot(usageQuotaPayload);

if (parsedSnapshot) {
  const totalLimit: number | null = parsedSnapshot.totalLimit;
  const nextReset: string | undefined = parsedSnapshot.nextReset;

  void totalLimit;
  void nextReset;
}

const kiroQuotaData = buildKiroQuotaDataFromUsageQuota(usageQuotaPayload);
const acceptsKiroQuotaNumbers: {
  baseUsage: number | null;
  baseLimit: number | null;
  baseRemaining: number | null;
  currentUsage: number | null;
  usageLimit: number | null;
  remainingCredits: number | null;
} | null = kiroQuotaData;

const antigravityGroups = buildAntigravityQuotaGroupsFromUsageQuota(usageQuotaPayload);
const acceptsAntigravityGroups: Array<{
  id: string;
  label: string;
  models: string[];
  remainingFraction: number;
  resetTime?: string;
}> = antigravityGroups;

void acceptsKiroQuotaNumbers;
void acceptsAntigravityGroups;

const antigravityResourcesPayload = {
  known: true,
  resources: [
    {
      resource_type: 'ANTIGRAVITY_AI',
      remaining: '5000',
      minimum_credit_amount_for_usage: '50',
      exhausted: false,
    },
  ],
} satisfies NonNullable<AuthFileItem['usage_quota']>;

const antigravityResourceGroups =
  buildAntigravityQuotaGroupsFromUsageQuota(antigravityResourcesPayload);
const acceptsAntigravityResourceGroups: Array<{
  id: string;
  label: string;
  models: string[];
  remainingFraction: number;
  remainingAmount?: number;
  minimumAmount?: number;
}> = antigravityResourceGroups;

const acceptsKiroFutureReset: string | undefined = toFutureKiroResetIso(Date.now() + 60_000);

void acceptsAntigravityResourceGroups;
void acceptsKiroFutureReset;
