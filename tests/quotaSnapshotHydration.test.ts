import { describe, expect, test } from 'bun:test';
import { ANTIGRAVITY_CONFIG } from '@/features/quota/providers/antigravity/data';
import { CLAUDE_CONFIG } from '@/features/quota/providers/claude/data';
import { CODEX_CONFIG } from '@/features/quota/providers/codex/data';
import { KIMI_CONFIG } from '@/features/quota/providers/kimi/data';
import { shouldApplySnapshot } from '@/features/quota/logic';
import { buildQuotaSnapshotState } from '@/features/quota/providers/usageQuotaSnapshot';
import { usageQuotaCheckedAtMs } from '@/utils/quota';
import { useQuotaStore } from '@/stores';
import type { AntigravityQuotaState } from '@/types';

const HOUR_MS = 60 * 60 * 1000;

describe('management quota snapshot hydration', () => {
  test('a backend quota failure replaces old numeric data with an error state', () => {
    const state = buildQuotaSnapshotState(CODEX_CONFIG, {
      name: 'codex.json',
      type: 'codex',
      usage_quota: {
        known: false,
        error: 'quota request failed',
        checked_at: '2026-09-15T00:00:00Z',
      },
    });
    expect(state).toMatchObject({ status: 'error', error: 'quota request failed', windows: [] });
  });

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

// The reported bug: a card rendered a stale snapshot, the backend re-probed and
// returned newer numbers, and the hydration guard dropped them because the
// cached entry was already `success`.
describe('stale snapshot replacement', () => {
  const now = 1_800_000_000_000;
  const snapshotAt = (iso: string) => ({ known: true, checked_at: iso, resources: [] });

  test('a backend snapshot newer than the cached success replaces it', () => {
    const cachedAt = now - 3 * HOUR_MS;
    const checked = usageQuotaCheckedAtMs(snapshotAt(new Date(now - HOUR_MS).toISOString()));
    expect(shouldApplySnapshot({ status: 'success', _cachedAt: cachedAt }, checked, now)).toBe(
      true
    );
  });

  test('an older backend snapshot leaves the cached success alone', () => {
    const cachedAt = now - HOUR_MS;
    const checked = usageQuotaCheckedAtMs(snapshotAt(new Date(now - 3 * HOUR_MS).toISOString()));
    expect(shouldApplySnapshot({ status: 'success', _cachedAt: cachedAt }, checked, now)).toBe(
      false
    );
  });

  test('a snapshot fills only idle and missing entries', () => {
    const checked = usageQuotaCheckedAtMs(snapshotAt(new Date(now - 5 * HOUR_MS).toISOString()));
    expect(shouldApplySnapshot(undefined, checked, now)).toBe(true);
    expect(shouldApplySnapshot({ status: 'idle' }, checked, now)).toBe(true);
    expect(shouldApplySnapshot({ status: 'error' }, checked, now)).toBe(false);
    expect(shouldApplySnapshot({ status: 'loading' }, checked, now)).toBe(false);
  });

  test('a failed refresh cannot be revived by any backend snapshot until manually retried', () => {
    for (const checked of [null, now - HOUR_MS, now + HOUR_MS]) {
      expect(shouldApplySnapshot({ status: 'error', _cachedAt: now }, checked, now)).toBe(false);
      expect(shouldApplySnapshot({ status: 'loading' }, checked, now)).toBe(false);
    }
  });

  test('an unstamped snapshot cannot displace a success but still fills a gap', () => {
    expect(shouldApplySnapshot({ status: 'success', _cachedAt: now }, null, now)).toBe(false);
    expect(shouldApplySnapshot(undefined, null, now)).toBe(true);
  });

  test('a snapshot without checked_at parses to null', () => {
    expect(usageQuotaCheckedAtMs({ known: true, resources: [] })).toBeNull();
    expect(usageQuotaCheckedAtMs(null)).toBeNull();
    expect(usageQuotaCheckedAtMs({ known: true, checked_at: 'not-a-date' })).toBeNull();
  });

  test('a backend clock running ahead does not out-rank the write it caused', () => {
    // checked_at is in the future relative to the browser: without clamping,
    // the same snapshot would re-apply on every render.
    const checked = now + 2 * HOUR_MS;
    expect(shouldApplySnapshot({ status: 'success', _cachedAt: now }, checked, now)).toBe(false);
  });

  test('a cached success with no stamp is replaced (pre-stamp persisted data)', () => {
    const checked = usageQuotaCheckedAtMs(snapshotAt(new Date(now).toISOString()));
    expect(shouldApplySnapshot({ status: 'success' }, checked, now)).toBe(true);
  });
});

// purgeStaleEntries was reached only from the retired section shell; restoring
// the timer call must not blank a card that is mid-fetch.
describe('quota cache purge', () => {
  // Injected via setState rather than the setter: the setters re-stamp every
  // write, so an already-expired entry can only be reached by landing one in
  // state directly — which is exactly what loading the persisted cache does.
  const write = (entries: Record<string, unknown>) => {
    useQuotaStore.setState({
      antigravityQuota: entries as Record<string, AntigravityQuotaState>,
    });
    useQuotaStore.getState().purgeStaleEntries();
    return useQuotaStore.getState().antigravityQuota;
  };

  test('keeps a loading entry so an in-flight fetch still has somewhere to land', () => {
    const after = write({ 'loading.json': { status: 'loading', groups: [] } });
    expect(Object.keys(after)).toEqual(['loading.json']);
  });

  test('drops an entry whose TTL has passed', () => {
    // purgeStaleEntries reads the real clock (isFreshQuotaState owns it), so
    // these stamps are relative to now rather than injected.
    const realNow = Date.now();
    const expired = realNow - 24 * HOUR_MS;
    const after = write({
      'expired.json': {
        status: 'success',
        groups: [],
        _cachedAt: expired,
        _cacheExpiresAt: expired,
      },
    });
    expect(Object.keys(after)).toEqual([]);
  });

  test('keeps a fresh entry', () => {
    const realNow = Date.now();
    const after = write({
      'fresh.json': {
        status: 'success',
        groups: [],
        _cachedAt: realNow,
        _cacheExpiresAt: realNow + 7 * 24 * HOUR_MS,
      },
    });
    expect(Object.keys(after)).toEqual(['fresh.json']);
  });

  test('retains an error marker until manual refresh instead of reviving a stale snapshot', () => {
    const after = write({
      'failed.json': {
        status: 'error',
        error: 'Quota refresh failed',
        groups: [],
        _cachedAt: 1,
        _cacheExpiresAt: 2,
      },
    });
    expect(after['failed.json']?.status).toBe('error');
    expect(after['failed.json']?.groups).toEqual([]);
  });
});
