import { expect, test } from 'bun:test';
import { buildAntigravityQuotaGroupsFromUsageQuota } from '../src/utils/quota/usageQuota';

// The shape the backend now reports for a group-scoped Antigravity credential:
// one resource per provider group, carrying the group's own label.
const groupedSnapshot = {
  known: true,
  checked_at: '2026-09-22T04:00:00Z',
  next_reset: '2026-09-29T03:28:49Z',
  resources: [
    {
      group: { label: 'Gemini Models', models: ['Gemini Flash', 'Gemini Pro'] },
      resource_type: 'Gemini Models',
      shared: true,
      total_limit: 1,
      current_usage: 0,
      remaining: 1,
      window_seconds: 604800,
      reset_at: '2026-09-29T03:28:49Z',
    },
    {
      group: { label: 'Claude and GPT models', models: ['Claude Opus', 'Claude Sonnet', 'GPT-OSS'] },
      resource_type: 'Claude and GPT models',
      shared: true,
      total_limit: 1,
      current_usage: 0.49,
      remaining: 0.51,
      window_seconds: 604800,
      reset_at: '2026-09-29T03:28:53Z',
    },
  ],
};

test('reported groups render as the provider named them', () => {
  const groups = buildAntigravityQuotaGroupsFromUsageQuota(groupedSnapshot);
  expect(groups.length).toBe(2);
  expect(groups[0].label).toBe('Gemini Models');
  expect(groups[0].models).toEqual(['Gemini Flash', 'Gemini Pro']);
  expect(groups[0].buckets[0].remainingFraction).toBe(1);
  expect(groups[0].buckets[0].resetTime).toBe('2026-09-29T03:28:49.000Z');

  expect(groups[1].label).toBe('Claude and GPT models');
  expect(groups[1].buckets[0].remainingFraction).toBeCloseTo(0.51, 2);
});

test('per-model snapshots still render one row per model', () => {
  const groups = buildAntigravityQuotaGroupsFromUsageQuota({
    known: true,
    resources: [
      { resource_type: 'claude-sonnet-4-6', total_limit: 1, current_usage: 0, remaining: 1 },
      { resource_type: 'gemini-3-flash', total_limit: 1, current_usage: 0, remaining: 1 },
    ],
  });
  expect(groups.map((group) => group.label)).toEqual(['Claude/GPT', 'Gemini 3 Flash']);
});
