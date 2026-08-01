import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '@/i18n/index';
import { FreebuffQuotaBody } from '@/features/quota/providers/freebuff/FreebuffQuotaBody';
import { FREEBUFF_CONFIG } from '@/features/quota/providers/freebuff/data';
import { HyperQuotaBody } from '@/features/quota/providers/hyper/HyperQuotaBody';
import { HYPER_CONFIG } from '@/features/quota/providers/hyper/data';
import { QUOTA_CLASS_KEYS, type QuotaClassMap } from '@/features/quota/types';
import { authFilesApi } from '@/services/api';
import type { AuthFileItem } from '@/types';

const t = ((key: string) => key) as unknown as TFunction;
const originalRefreshAuthQuotas = authFilesApi.refreshAuthQuotas;
const quotaClasses = Object.fromEntries(
  QUOTA_CLASS_KEYS.map((key) => [key, key])
) as unknown as QuotaClassMap;

afterEach(() => {
  authFilesApi.refreshAuthQuotas = originalRefreshAuthQuotas;
});

describe('FreeBuff unified quota adapter', () => {
  test('hydrates per-model session quotas from an auth-file snapshot', () => {
    const state = FREEBUFF_CONFIG.buildSnapshotState?.({
      name: 'freebuff.json',
      type: 'freebuff',
      usage_quota: {
        known: true,
        resource_type: 'freebuff_sessions',
        next_reset: '2026-08-02T00:00:00Z',
        resources: [
          {
            resource_type: 'deepseek-v4-pro',
            total_limit: 5,
            current_usage: 2,
            remaining: 3,
            window_seconds: 86_400,
            reset_at: '2026-08-02T00:00:00Z',
            exhausted: false,
          },
          {
            resource_type: 'glm-5.2',
            total_limit: 3,
            current_usage: 3,
            remaining: 0,
            window_seconds: 604_800,
            reset_at: '2026-08-08T00:00:00Z',
            exhausted: true,
          },
        ],
      },
    });

    expect(state?.status).toBe('success');
    expect(state?.snapshot?.resourceType).toBe('freebuff_sessions');
    expect(state?.snapshot?.resources).toEqual([
      expect.objectContaining({
        resourceType: 'deepseek-v4-pro',
        totalLimit: 5,
        currentUsage: 2,
        remaining: 3,
        windowSeconds: 86_400,
        exhausted: false,
      }),
      expect.objectContaining({
        resourceType: 'glm-5.2',
        remaining: 0,
        exhausted: true,
      }),
    ]);
  });

  test('refreshes only the requested auth index and selects its provider snapshot', async () => {
    let request: unknown;
    authFilesApi.refreshAuthQuotas = (async (payload) => {
      request = payload;
      return {
        refreshed: 1,
        auths: [
          {
            id: 'unrelated',
            auth_index: 'other:1',
            provider: 'freebuff',
            usage_quota: { known: true, remaining: 99 },
          },
          {
            id: 'target',
            auth_index: 'freebuff:2',
            provider: 'freebuff',
            usage_quota: {
              known: true,
              resource_type: 'freebuff_sessions',
              resources: [
                {
                  resource_type: 'deepseek-v4-pro',
                  total_limit: 5,
                  current_usage: 1,
                  remaining: 4,
                },
              ],
            },
          },
        ],
      };
    }) as typeof authFilesApi.refreshAuthQuotas;

    const snapshot = await FREEBUFF_CONFIG.fetchQuota(
      { name: 'freebuff.json', type: 'freebuff', auth_index: 'freebuff:2' },
      t
    );

    expect(request).toEqual({ auth_indexes: ['freebuff:2'] });
    expect(snapshot.resources[0]).toMatchObject({
      resourceType: 'deepseek-v4-pro',
      remaining: 4,
    });
  });

  test('rejects a sole refresh result when it belongs to another credential', async () => {
    authFilesApi.refreshAuthQuotas = (async () => ({
      refreshed: 1,
      auths: [
        {
          id: 'other',
          auth_index: 'freebuff:other',
          provider: 'freebuff',
          usage_quota: { known: true, remaining: 99 },
        },
      ],
    })) as typeof authFilesApi.refreshAuthQuotas;

    await expect(
      FREEBUFF_CONFIG.fetchQuota(
        { name: 'freebuff.json', type: 'freebuff', auth_index: 'freebuff:target' },
        t
      )
    ).rejects.toThrow('freebuff_quota.empty_data');
  });

  test('renders the real remaining ratio for each model', () => {
    const markup = renderToStaticMarkup(
      createElement(FreebuffQuotaBody, {
        classes: quotaClasses,
        quota: {
          status: 'success',
          snapshot: {
            known: true,
            totalLimit: null,
            currentUsage: null,
            remaining: null,
            exhausted: false,
            resources: [
              {
                resourceType: 'deepseek-v4-pro',
                totalLimit: 5,
                currentUsage: 2,
                remaining: 3,
                minimumCreditAmountForUsage: null,
                windowSeconds: 86_400,
                exhausted: false,
              },
            ],
          },
        },
      })
    );

    expect(markup).toContain('>60%<');
    expect(markup).toContain('3 / 5');
  });

  test("does not assign another model's reset time to a resource without one", () => {
    const markup = renderToStaticMarkup(
      createElement(FreebuffQuotaBody, {
        classes: quotaClasses,
        quota: {
          status: 'success',
          snapshot: {
            known: true,
            totalLimit: null,
            currentUsage: null,
            remaining: null,
            exhausted: false,
            nextReset: '2026-08-02T00:00:00Z',
            resources: [
              {
                resourceType: 'daily-model',
                totalLimit: 5,
                currentUsage: 2,
                remaining: 3,
                minimumCreditAmountForUsage: null,
                windowSeconds: 86_400,
                resetAt: '2026-08-02T00:00:00Z',
                exhausted: false,
              },
              {
                resourceType: 'weekly-model',
                totalLimit: 10,
                currentUsage: 1,
                remaining: 9,
                minimumCreditAmountForUsage: null,
                windowSeconds: 604_800,
                exhausted: false,
              },
            ],
          },
        },
      })
    );

    expect(markup).toContain('>7d');
  });
});

describe('Charm Hyper unified quota adapter', () => {
  test('keeps a zero Hypercredits balance as a known exhausted state', () => {
    const file: AuthFileItem = {
      name: 'hyper.json',
      type: 'hyper',
      usage_quota: {
        known: true,
        remaining: 0,
        exhausted: true,
        resource_type: 'hypercredits',
        resources: [
          {
            resource_type: 'hypercredits',
            remaining: 0,
            exhausted: true,
          },
        ],
      },
    };

    const state = HYPER_CONFIG.buildSnapshotState?.(file);
    expect(state?.status).toBe('success');
    expect(state?.snapshot).toMatchObject({
      known: true,
      remaining: 0,
      exhausted: true,
      resourceType: 'hypercredits',
    });
    expect(state?.snapshot?.resources[0]).toMatchObject({
      resourceType: 'hypercredits',
      remaining: 0,
      exhausted: true,
    });
  });

  test('reports a missing auth index before calling the management endpoint', async () => {
    await expect(HYPER_CONFIG.fetchQuota({ name: 'hyper.json', type: 'hyper' }, t)).rejects.toThrow(
      'hyper_quota.missing_auth_index'
    );
  });

  test('renders an exhausted zero balance without inventing a percentage', () => {
    const markup = renderToStaticMarkup(
      createElement(HyperQuotaBody, {
        classes: quotaClasses,
        quota: {
          status: 'success',
          snapshot: {
            known: true,
            totalLimit: null,
            currentUsage: null,
            remaining: 0,
            exhausted: true,
            resourceType: 'hypercredits',
            resources: [],
          },
        },
      })
    );

    expect(markup).toContain('quotaBalanceValueExhausted');
    expect(markup).toContain('>0<');
    expect(markup).not.toContain('%');
  });
});
