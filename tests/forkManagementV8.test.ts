import { afterEach, expect, spyOn, test } from 'bun:test';
import type { AxiosAdapter } from 'axios';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import { configApi } from '@/services/api/config';
import { providersApi } from '@/services/api/providers';
import { buildOpenAICompatCandidates } from '@/features/routing/useRoutingWorkbench';
import { useQuotaActions } from '@/features/quota/hooks/useQuotaActions';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { buildXaiBillingSummary } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';

afterEach(() => {
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  useQuotaStore.getState().clearQuotaCache();
});

test('fork extensions keep their declared path and current connection authentication', async () => {
  for (const origin of ['https://one.invalid/gateway', 'https://two.invalid/proxy']) {
    apiClient.setConfig({ apiBase: `${origin}/v8/management`, managementKey: 'fixture-only' });
    const adapter: AxiosAdapter = async (config) => {
      expect(config.url).toBe(`${origin}/v0/management/auth-quotas`);
      expect(config.headers.Authorization).toBe('Bearer fixture-only');
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };
    await apiClient.get(apiClient.getExtensionUrl('/auth-quotas'), { adapter });
  }
});

test('routing strategy uses the v8 scalar config contract', async () => {
  const get = spyOn(apiClient, 'get').mockResolvedValue('weighted-round-robin');
  const put = spyOn(apiClient, 'put').mockResolvedValue({});
  try {
    expect(await configApi.getRoutingStrategy()).toBe('weighted-round-robin');
    expect(get).toHaveBeenCalledWith('/config/routing/strategy');
    await configApi.updateRoutingStrategy('fill-first');
    expect(put).toHaveBeenCalledWith('/config/routing/strategy', 'fill-first');
  } finally {
    get.mockRestore();
    put.mockRestore();
  }
});

test('in-flight credential lists are not reused after a connection switch', async () => {
  let release!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const get = spyOn(apiClient, 'get')
    .mockImplementationOnce(async () => pending)
    .mockResolvedValue({ files: [{ name: 'new.json', type: 'codex' }] });
  try {
    apiClient.setConfig({ apiBase: 'https://old.invalid', managementKey: 'fixture-only' });
    const old = authFilesApi.list({ provider: 'codex' });
    apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'fixture-only' });
    const current = await authFilesApi.list({ provider: 'codex' });
    expect(get).toHaveBeenCalledTimes(2);
    expect(current.files[0].name).toBe('new.json');
    release({ files: [{ name: 'old.json' }] });
    await old;
  } finally {
    release({ files: [] });
    get.mockRestore();
  }
});

test('routing batch saves every compatible key without overwriting previous changes', async () => {
  let groups = [
    {
      name: 'fixture',
      'base-url': 'https://provider.invalid/v1',
      models: [{ name: 'fixture-model' }],
      'future-policy': { keep: true },
      keys: [
        { 'api-key': 'fixture-a', weight: 2, 'model-priorities': { other: 1 } },
        { 'api-key': 'fixture-b', weight: 3, 'model-priorities': { other: 2 } },
      ],
    },
  ];
  groups.unshift({ ...groups[0], name: 'incomplete', 'base-url': '', keys: [] });
  const get = spyOn(apiClient, 'get').mockImplementation(async () =>
    structuredClone({ 'api-keys': { 'openai-compatibility': groups } })
  );
  const put = spyOn(apiClient, 'put').mockImplementation(async (url, value) => {
    expect(url).toBe('/config/api-keys/openai-compatibility');
    groups = structuredClone(value) as typeof groups;
    return {};
  });
  try {
    const [provider] = await providersApi.getOpenAIProviders();
    const candidates = buildOpenAICompatCandidates(provider);
    await candidates[0].update({ modelPriorities: { other: 1, 'fixture-model': 5 } });
    await candidates[1].update({ modelPriorities: { other: 2, 'fixture-model': 8 } });
    expect(groups[1].keys.map((key) => key['model-priorities'])).toEqual([
      { other: 1, 'fixture-model': 5 },
      { other: 2, 'fixture-model': 8 },
    ]);
    expect(groups[1]['future-policy']).toEqual({ keep: true });
    expect(groups[1].keys.map((key) => key.weight)).toEqual([2, 3]);
  } finally {
    get.mockRestore();
    put.mockRestore();
  }
});

for (const mode of ['single', 'batch'] as const) {
  test(`${mode} quota refresh enriches the committed, timestamped cache`, async () => {
    let actions!: ReturnType<typeof useQuotaActions>;
    let batch!: ReturnType<typeof useQuotaBatchLoader>;
    function Harness() {
      actions = useQuotaActions(false);
      batch = useQuotaBatchLoader();
      return null;
    }
    renderToStaticMarkup(createElement(Harness));
    const file = { name: 'fixture.json', type: 'xai', authIndex: 'fixture' };
    const billing = buildXaiBillingSummary({ monthlyLimit: { val: 100 }, used: { val: 10 } })!;
    const fetch = spyOn(QUOTA_ADAPTERS.xai, 'fetchQuota').mockResolvedValue(billing);
    const enrich = spyOn(QUOTA_ADAPTERS.xai, 'enrichQuota').mockResolvedValue({
      ...billing,
      planLabel: 'SuperGrok',
      planTier: 'premium',
    });
    try {
      if (mode === 'single') await actions.refreshQuota(file, QUOTA_ADAPTERS.xai);
      else await batch.loadQuota([{ type: 'xai', file }]);
      await Promise.resolve();
      expect(enrich).toHaveBeenCalledTimes(1);
      const state = useQuotaStore.getState().xaiQuota[getQuotaCacheKey(file)];
      expect(state.billing?.planLabel).toBe('SuperGrok');
      expect(state._cachedAt).toBeGreaterThan(0);
    } finally {
      fetch.mockRestore();
      enrich.mockRestore();
    }
  });
}
