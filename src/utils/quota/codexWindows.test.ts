import { resolveCodexQuotaWindowMeta } from './codexWindows.ts';

const assertEqual = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
};

const weeklyMeta = resolveCodexQuotaWindowMeta({
  resourceType: 'primary_window',
  windowSeconds: 604800,
  isFreePlan: true,
});

assertEqual(weeklyMeta.labelKey, 'codex_quota.secondary_window', 'weekly label key');
assertEqual(weeklyMeta.id, 'weekly', 'weekly id');

const monthlyMeta = resolveCodexQuotaWindowMeta({
  resourceType: 'primary_window',
  windowSeconds: 2592000,
  isFreePlan: true,
});

assertEqual(monthlyMeta.labelKey, 'codex_quota.monthly_window', 'monthly label key');
assertEqual(monthlyMeta.id, 'monthly', 'monthly id');
