import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import '@/i18n/index';
import { FreebuffQuotaBody } from '@/features/quota/providers/freebuff/FreebuffQuotaBody';
import { FREEBUFF_CONFIG } from '@/features/quota/providers/freebuff/data';
import { HyperQuotaBody } from '@/features/quota/providers/hyper/HyperQuotaBody';
import { HYPER_CONFIG } from '@/features/quota/providers/hyper/data';
import { KeelCodeQuotaBody } from '@/features/quota/providers/keelcode/KeelCodeQuotaBody';
import { KEELCODE_CONFIG } from '@/features/quota/providers/keelcode/data';
import { QUOTA_CLASS_KEYS, type QuotaClassMap } from '@/features/quota/types';
import { authFilesApi } from '@/services/api';
import type { AuthFileItem } from '@/types';
import { formatInstantShort } from '@/utils/quota';

const t = ((key: string) => key) as unknown as TFunction;
const originalRefreshAuthQuotas = authFilesApi.refreshAuthQuotas;
const quotaClasses = Object.fromEntries(
  QUOTA_CLASS_KEYS.map((key) => [key, key])
) as unknown as QuotaClassMap;

beforeAll(async () => {
  await i18n.changeLanguage('zh-CN');
});

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

  test('preserves FreeBuff quota hints and scope flags from management snapshots', () => {
    const state = FREEBUFF_CONFIG.buildSnapshotState?.({
      name: 'freebuff-limited.json',
      type: 'freebuff',
      usage_quota: {
        known: true,
        resource_type: 'freebuff_limited_sessions',
        limit_hint: 8,
        usage_unknown: true,
        next_reset: '2026-08-03T07:00:00Z',
        resources: [
          {
            resource_type: 'freebuff_limited_sessions',
            models: ['deepseek-v4-flash', 'mimo-v2.5'],
            shared: true,
            limit_hint: 8,
            usage_unknown: true,
            model_scoped: true,
            window_seconds: 86_400,
            reset_at: '2026-08-03T07:00:00Z',
          },
        ],
      },
    });

    expect(state?.snapshot).toMatchObject({
      resourceType: 'freebuff_limited_sessions',
      limitHint: 8,
      usageUnknown: true,
      resources: [
        expect.objectContaining({
          resourceType: 'freebuff_limited_sessions',
          models: ['deepseek-v4-flash', 'mimo-v2.5'],
          shared: true,
          limitHint: 8,
          usageUnknown: true,
          modelScoped: true,
          windowSeconds: 86_400,
        }),
      ],
    });
  });

  test('preserves and renders entitlement details and a shared provider pool', () => {
    const state = FREEBUFF_CONFIG.buildSnapshotState?.({
      name: 'freebuff-details.json',
      type: 'freebuff',
      usage_quota: {
        known: true,
        resources: [
          {
            resource_type: 'freebuff_premium_sessions',
            total_limit: 10,
            current_usage: 2,
            remaining: 8,
            entitlement_breakdown: { base: 6, referral: 3, streak: 1 },
          },
          {
            resource_type: 'claude-fable-5',
            total_limit: 1,
            current_usage: 0,
            remaining: 1,
            shared_pool: { total_limit: 55, remaining: 47 },
          },
        ],
      },
    });

    expect(state?.snapshot?.resources[0]).toMatchObject({
      entitlementBreakdown: { base: 6, referral: 3, streak: 1 },
    });
    expect(state?.snapshot?.resources[1]).toMatchObject({
      sharedPool: { totalLimit: 55, remaining: 47, exhausted: false },
    });

    const markup = renderToStaticMarkup(
      createElement(FreebuffQuotaBody, { classes: quotaClasses, quota: state! })
    );
    expect(markup).toContain('基础 6 次 · 推荐奖励 +3 · 连续使用奖励 +1');
    expect(markup).toContain('全局池剩余 47 / 55');
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

  test('renders a limited-tier hint without inventing current usage', () => {
    const state = FREEBUFF_CONFIG.buildSnapshotState?.({
      name: 'freebuff-limited.json',
      type: 'freebuff',
      usage_quota: {
        known: true,
        resource_type: 'freebuff_limited_sessions',
        limit_hint: 8,
        usage_unknown: true,
        next_reset: '2026-08-03T07:00:00Z',
        resources: [
          {
            resource_type: 'freebuff_limited_sessions',
            models: ['deepseek-v4-flash', 'mimo-v2.5'],
            shared: true,
            limit_hint: 8,
            usage_unknown: true,
            window_seconds: 86_400,
            reset_at: '2026-08-03T07:00:00Z',
          },
        ],
      },
    });
    const markup = renderToStaticMarkup(
      createElement(FreebuffQuotaBody, {
        classes: quotaClasses,
        quota: state!,
      })
    );

    expect(markup).toContain('限量模型会话');
    expect(markup).toContain('共享模型：deepseek-v4-flash, mimo-v2.5');
    expect(markup).toContain('至少 8 次会话');
    expect(markup).toContain('当前用量未上报');
    expect(markup).toContain('>--<');
    expect(markup).not.toContain('暂无配额数据');
    expect(markup).not.toContain('quotaBar');
  });

  test('renders full-tier unlimited models alongside the session hint', () => {
    const state = FREEBUFF_CONFIG.buildSnapshotState?.({
      name: 'freebuff-full.json',
      type: 'freebuff',
      usage_quota: {
        known: true,
        resource_type: 'freebuff_sessions',
        limit_hint: 6,
        usage_unknown: true,
        unlimited: true,
        resources: [
          {
            resource_type: 'freebuff_unlimited_models',
            models: ['deepseek-v4-flash', 'mimo-v2.5'],
            unlimited: true,
          },
          {
            resource_type: 'freebuff_premium_sessions',
            models: ['deepseek-v4-pro', 'gpt-5.6-luna', 'minimax-m3'],
            shared: true,
            limit_hint: 6,
            usage_unknown: true,
            window_seconds: 86_400,
            reset_at: '2026-08-03T07:00:00Z',
          },
          {
            resource_type: 'glm-5.2',
            models: ['glm-5.2'],
            exhausted: true,
            model_scoped: true,
            usage_unknown: true,
            window_seconds: 86_400,
            reset_at: '2026-08-03T07:00:00Z',
          },
        ],
      },
    });
    const markup = renderToStaticMarkup(
      createElement(FreebuffQuotaBody, {
        classes: quotaClasses,
        quota: state!,
      })
    );

    expect(markup).toContain('不限量模型');
    expect(markup).toContain('>∞<');
    expect(markup).toContain('高级模型会话');
    expect(markup).toContain('共享模型：deepseek-v4-pro, gpt-5.6-luna, minimax-m3');
    expect(markup).toContain('至少 6 次会话');
    expect(markup.match(/当前用量未上报/g)).toHaveLength(1);
    expect(markup).toContain('适用模型：deepseek-v4-flash, mimo-v2.5');
    expect(markup).toContain('glm-5.2');
    expect(markup).not.toContain('暂无配额数据');
  });

  test('preserves global exhaustion and synthesizes its provider-spend row when needed', () => {
    const state = FREEBUFF_CONFIG.buildSnapshotState?.({
      name: 'freebuff-spend.json',
      type: 'freebuff',
      usage_quota: {
        known: true,
        exhausted: true,
        global_exhausted: true,
        resource_type: 'provider_spend',
        next_reset: '2026-08-03T07:00:00Z',
        resources: [
          {
            resource_type: 'deepseek-v4-pro',
            total_limit: 6,
            current_usage: 1,
            remaining: 5,
            model_scoped: true,
          },
        ],
      },
    });
    const markup = renderToStaticMarkup(
      createElement(FreebuffQuotaBody, {
        classes: quotaClasses,
        quota: state!,
      })
    );

    expect(state?.snapshot?.globalExhausted).toBe(true);
    expect(state?.snapshot?.resources[0]?.modelScoped).toBe(true);
    expect(markup).toContain('全局消费限制');
    expect(markup).toContain('已耗尽');
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
  test('hydrates the real Hypercredits refresh schedule from a management snapshot', () => {
    const resetAt = '2026-08-14T08:00:00Z';
    const state = HYPER_CONFIG.buildSnapshotState?.({
      name: 'hyper.json',
      type: 'hyper',
      usage_quota: {
        known: true,
        remaining: 250,
        resource_type: 'hypercredits',
        next_reset: resetAt,
        resources: [
          {
            resource_type: 'hypercredits',
            remaining: 250,
            window_seconds: 86_400,
            reset_at: resetAt,
          },
        ],
      },
    });

    const normalizedResetAt = new Date(resetAt).toISOString();
    expect(state?.status).toBe('success');
    expect(state?.snapshot).toMatchObject({
      nextReset: normalizedResetAt,
      resources: [
        expect.objectContaining({
          resourceType: 'hypercredits',
          remaining: 250,
          windowSeconds: 86_400,
          resetAt: normalizedResetAt,
        }),
      ],
    });
  });

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

  test('keeps a genuinely missing Hyper balance in the ordinary empty state', () => {
    const markup = renderToStaticMarkup(
      createElement(HyperQuotaBody, {
        classes: quotaClasses,
        quota: {
          status: 'success',
          snapshot: {
            known: true,
            totalLimit: null,
            currentUsage: null,
            remaining: null,
            exhausted: false,
            resourceType: 'hypercredits',
            resources: [],
          },
        },
      })
    );

    expect(markup).toContain('暂无余额数据');
    expect(markup).not.toContain('该团队使用 USD 计价');
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

  test('renders the next Hypercredits refresh as local time plus a countdown', () => {
    const resetAtMs = Date.now() + 3 * 24 * 60 * 60 * 1000;
    const resetAt = new Date(resetAtMs).toISOString();
    const state = HYPER_CONFIG.buildSnapshotState?.({
      name: 'hyper.json',
      type: 'hyper',
      usage_quota: {
        known: true,
        remaining: 100,
        resource_type: 'hypercredits',
        next_reset: resetAt,
        resources: [
          {
            resource_type: 'hypercredits',
            remaining: 100,
            window_seconds: 2_592_000,
            reset_at: resetAt,
          },
        ],
      },
    });
    const markup = renderToStaticMarkup(
      createElement(HyperQuotaBody, { classes: quotaClasses, quota: state! })
    );

    expect(markup).toContain('下次刷新');
    expect(markup).toContain('quotaBalanceReset');
    expect(markup).toContain(formatInstantShort(resetAtMs));
    expect(markup).toContain('quotaResetRelative');
    expect(markup).not.toContain('%');
  });

  test('renders a neutral USD-billing state while preserving the real refresh time', () => {
    const resetAtMs = Date.now() + 5 * 24 * 60 * 60 * 1000;
    const resetAt = new Date(resetAtMs).toISOString();
    const state = HYPER_CONFIG.buildSnapshotState?.({
      name: 'hyper-usd.json',
      type: 'hyper',
      usage_quota: {
        known: true,
        usage_unknown: true,
        resource_type: 'hypercredits',
        next_reset: resetAt,
        resources: [
          {
            resource_type: 'hypercredits',
            usage_unknown: true,
            window_seconds: 2_678_400,
            reset_at: resetAt,
          },
        ],
      },
    });
    const markup = renderToStaticMarkup(
      createElement(HyperQuotaBody, { classes: quotaClasses, quota: state! })
    );

    expect(state?.snapshot?.usageUnknown).toBe(true);
    expect(markup).toContain('该团队使用 USD 计价，因此 Hypercredits 余额不展示。');
    expect(markup).toContain('未展示');
    expect(markup).toContain('下次刷新');
    expect(markup).toContain(formatInstantShort(resetAtMs));
    expect(markup).not.toContain('quotaBalanceValueExhausted');
  });
});

describe('KeelCode unified quota adapter', () => {
  test('hydrates multiple quota pools from a management snapshot', () => {
    const state = KEELCODE_CONFIG.buildSnapshotState?.({
      name: 'keelcode.json',
      type: 'keelcode',
      usage_quota: {
        known: true,
        resource_type: 'keelcode',
        next_reset: '2026-08-10T00:00:00Z',
        resources: [
          {
            resource_type: 'premium',
            total_limit: 1,
            current_usage: 0.3,
            remaining: 0.7,
            reset_at: '2026-08-10T00:00:00Z',
          },
          {
            resource_type: 'oss',
            total_limit: 2,
            current_usage: 2,
            remaining: 0,
            reset_at: '2026-08-10T00:00:00Z',
            exhausted: true,
          },
        ],
      },
    });

    expect(state?.status).toBe('success');
    expect(state?.snapshot?.resources).toEqual([
      expect.objectContaining({ resourceType: 'premium', remaining: 0.7 }),
      expect.objectContaining({ resourceType: 'oss', remaining: 0, exhausted: true }),
    ]);
  });

  test('hydrates and renders Free plan daily model request quotas', () => {
    const state = KEELCODE_CONFIG.buildSnapshotState?.({
      name: 'keelcode-free.json',
      type: 'keelcode',
      usage_quota: {
        known: true,
        resource_type: 'keelcode',
        next_reset: '2026-08-11T00:00:00Z',
        resources: [
          {
            resource_type: 'gpt-5.6-luna',
            models: ['gpt-5.6-luna'],
            model_scoped: true,
            total_limit: 10,
            current_usage: 1,
            remaining: 9,
            reset_at: '2026-08-11T00:00:00Z',
          },
          {
            resource_type: 'deepseek-v4-flash',
            models: ['deepseek-v4-flash'],
            model_scoped: true,
            total_limit: 100,
            current_usage: 3,
            remaining: 97,
            reset_at: '2026-08-11T00:00:00Z',
          },
        ],
      },
    });

    expect(state?.snapshot?.resources[0]).toMatchObject({
      resourceType: 'gpt-5.6-luna',
      models: ['gpt-5.6-luna'],
      modelScoped: true,
      totalLimit: 10,
      remaining: 9,
    });

    const markup = renderToStaticMarkup(
      createElement(KeelCodeQuotaBody, { classes: quotaClasses, quota: state! })
    );
    expect(markup).toContain('Free 套餐按模型分别计算每日请求额度');
    expect(markup).toContain('gpt-5.6-luna');
    expect(markup).toContain('今日剩余 9 / 10 次请求');
    expect(markup).toContain('今日剩余 97 / 100 次请求');
  });

  test('refreshes the selected KeelCode credential through management API', async () => {
    let request: unknown;
    authFilesApi.refreshAuthQuotas = (async (payload) => {
      request = payload;
      return {
        refreshed: 1,
        auths: [
          {
            id: 'keelcode-1',
            auth_index: 'keelcode:1',
            provider: 'keelcode',
            usage_quota: {
              known: true,
              resources: [{ resource_type: 'premium', total_limit: 1, remaining: 0.7 }],
            },
          },
        ],
      };
    }) as typeof authFilesApi.refreshAuthQuotas;

    const snapshot = await KEELCODE_CONFIG.fetchQuota(
      { name: 'keelcode.json', type: 'keelcode', auth_index: 'keelcode:1' },
      t
    );

    expect(request).toEqual({ auth_indexes: ['keelcode:1'] });
    expect(snapshot.resources[0]).toMatchObject({ resourceType: 'premium', remaining: 0.7 });
  });

  test('renders each pool with its remaining percentage and reset time', () => {
    const markup = renderToStaticMarkup(
      createElement(KeelCodeQuotaBody, {
        classes: quotaClasses,
        quota: {
          status: 'success',
          snapshot: {
            known: true,
            totalLimit: 3,
            currentUsage: 2.3,
            remaining: 0.7,
            exhausted: false,
            nextReset: '2026-08-10T00:00:00Z',
            resources: [
              {
                resourceType: 'premium',
                totalLimit: 1,
                currentUsage: 0.3,
                remaining: 0.7,
                minimumCreditAmountForUsage: null,
                windowSeconds: null,
                resetAt: '2026-08-10T00:00:00Z',
                exhausted: false,
              },
            ],
          },
        },
      })
    );

    expect(markup).toContain('Premium 配额池');
    expect(markup).toContain('>70%<');
    expect(markup).toContain('剩余 0.7 / 1');
    expect(markup).toContain('重置');
  });
});
