import { expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QUOTA_BATCH_CONCURRENCY } from '@/features/quota/constants';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { getQuotaCacheKey } from '@/utils/quota/identity';

test('batch refresh keeps its concurrency limit and only commits current credential identities', async () => {
  let loader!: ReturnType<typeof useQuotaBatchLoader>;
  function Harness() {
    loader = useQuotaBatchLoader();
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  useQuotaStore.getState().clearQuotaCache();
  const entries = Array.from({ length: QUOTA_BATCH_CONCURRENCY + 1 }, (_, index) => ({
    type: 'devin' as const,
    file: {
      name: index < 2 ? 'shared.json' : `${index}.json`,
      type: 'devin',
      authIndex: String(index),
    },
  }));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchQuota = spyOn(QUOTA_ADAPTERS.devin, 'fetchQuota').mockImplementation(async () => {
    await pending;
    return { windows: [] };
  });
  try {
    const request = loader.loadQuota(entries);
    expect(fetchQuota).toHaveBeenCalledTimes(QUOTA_BATCH_CONCURRENCY);
    const last = entries.at(-1)!;
    useQuotaStore.getState().clearQuotaCache(['shared.json', last.file.name]);
    release();
    await request;
    expect(fetchQuota).toHaveBeenCalledTimes(QUOTA_BATCH_CONCURRENCY);
    const cache = useQuotaStore.getState().devinQuota;
    expect(cache[getQuotaCacheKey(entries[0].file)]).toBeUndefined();
    expect(cache[getQuotaCacheKey(entries[1].file)]).toBeUndefined();
    expect(cache[getQuotaCacheKey(last.file)]).toBeUndefined();
    expect(cache[getQuotaCacheKey(entries[2].file)]?.status).toBe('success');
  } finally {
    release();
    fetchQuota.mockRestore();
    useQuotaStore.getState().clearQuotaCache();
  }
});
