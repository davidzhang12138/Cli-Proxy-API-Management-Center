import { describe, expect, test } from 'bun:test';
import { ANTIGRAVITY_CONFIG } from '@/features/quota/providers/antigravity/data';
import { CLAUDE_CONFIG } from '@/features/quota/providers/claude/data';
import { CODEX_CONFIG } from '@/features/quota/providers/codex/data';
import { KIMI_CONFIG } from '@/features/quota/providers/kimi/data';

describe('management quota snapshot hydration', () => {
  test('hydrates Codex windows from a persisted management snapshot', () => {
    const state = CODEX_CONFIG.buildSnapshotState?.({
      name: 'codex.json',
      type: 'codex',
      usage_quota: {
        known: true,
        resources: [
          {
            resource_type: 'primary_window',
            total_limit: 100,
            current_usage: 25,
            remaining: 75,
            window_seconds: 18_000,
            reset_at: '2026-09-12T00:00:00Z',
          },
          {
            resource_type: 'secondary_window',
            total_limit: 100,
            current_usage: 40,
            remaining: 60,
            window_seconds: 604_800,
            reset_at: '2026-09-18T00:00:00Z',
          },
        ],
      },
    });

    expect(state?.status).toBe('success');
    expect(state?.windows).toEqual([
      expect.objectContaining({
        id: 'five-hour',
        usedPercent: 25,
        labelKey: 'codex_quota.primary_window',
      }),
      expect.objectContaining({
        id: 'weekly',
        usedPercent: 40,
        labelKey: 'codex_quota.secondary_window',
      }),
    ]);
  });

  test('hydrates Antigravity groups from a persisted management snapshot', () => {
    const state = ANTIGRAVITY_CONFIG.buildSnapshotState?.({
      name: 'antigravity.json',
      type: 'antigravity',
      usage_quota: {
        known: true,
        resources: [
          {
            resource_type: 'ANTIGRAVITY_AI',
            remaining: 5_000,
            minimum_credit_amount_for_usage: 50,
            window_seconds: 2_678_400,
            reset_at: '2026-10-01T00:00:00Z',
          },
        ],
      },
    });

    expect(state?.status).toBe('success');
    expect(state?.groups).toHaveLength(1);
    expect(state?.groups[0]).toMatchObject({
      remainingAmount: 5_000,
      minimumAmount: 50,
    });
  });

  test('hydrates Claude windows from a persisted management snapshot', () => {
    const state = CLAUDE_CONFIG.buildSnapshotState?.({
      name: 'claude.json',
      type: 'claude',
      usage_quota: {
        known: true,
        resources: [
          {
            resource_type: 'five_hour',
            total_limit: 100,
            current_usage: 10,
            remaining: 90,
            window_seconds: 18_000,
            reset_at: '2026-09-12T00:00:00Z',
          },
        ],
      },
    });

    expect(state?.status).toBe('success');
    expect(state?.windows[0]).toMatchObject({
      id: 'five-hour',
      labelKey: 'claude_quota.five_hour',
      usedPercent: 10,
    });
  });

  test('hydrates Kimi rows from a persisted management snapshot', () => {
    const state = KIMI_CONFIG.buildSnapshotState?.({
      name: 'kimi.json',
      type: 'kimi',
      usage_quota: {
        known: true,
        resources: [
          {
            resource_type: 'weekly_limit',
            total_limit: 100,
            current_usage: 35,
            remaining: 65,
            window_seconds: 604_800,
            reset_at: '2026-09-18T00:00:00Z',
          },
        ],
      },
    });

    expect(state?.status).toBe('success');
    expect(state?.rows[0]).toMatchObject({
      id: 'weekly_limit',
      used: 35,
      limit: 100,
      periodHours: 168,
    });
  });
});
