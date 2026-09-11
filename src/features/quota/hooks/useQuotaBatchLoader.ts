/**
 * 混合提供商批量额度加载（原 useQuotaLoader 的跨分区泛化）。
 *
 * 保留的三道守卫与旧实现逐一对应：
 * - loadingRef：并发批量加载去重；
 * - requestIdRef：被超越的响应直接丢弃；
 * - cacheGeneration：断线重连后过期请求不得写入新会话缓存。
 * 提交按 provider 分组进行 —— 快的提供商先落地，不等慢的。
 */

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores';
import { getStatusFromError } from '@/utils/quota';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_BATCH_CONCURRENCY } from '../constants';
import { QUOTA_ADAPTERS, getQuotaSetter } from '../providers';
import type { QuotaProviderType } from '../providers/types';

interface BatchFetchResult {
  name: string;
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
  errorStatus?: number;
}

const runWithConcurrency = async <T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        results[index] = await worker(items[index]);
      }
    })
  );

  return results;
};

export function useQuotaBatchLoader() {
  const { t } = useTranslation();
  const [batchLoading, setBatchLoading] = useState(false);
  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  const loadQuota = useCallback(
    async (targets: QuotaFileEntry[]) => {
      if (loadingRef.current) return;
      if (targets.length === 0) return;
      loadingRef.current = true;
      const requestId = ++requestIdRef.current;
      const cacheGeneration = captureQuotaCacheGeneration();
      setBatchLoading(true);

      try {
        const entriesByType = new Map<QuotaProviderType, QuotaFileEntry[]>();
        targets.forEach((entry) => {
          const entries = entriesByType.get(entry.type) ?? [];
          entries.push(entry);
          entriesByType.set(entry.type, entries);
        });

        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          entriesByType.forEach((entries, type) => {
            const adapter = QUOTA_ADAPTERS[type];
            const setQuota = getQuotaSetter(adapter);
            setQuota((prev) => {
              const nextState = { ...prev };
              entries.forEach(({ file }) => {
                nextState[file.name] = adapter.buildLoadingState();
              });
              return nextState;
            });
          });
        });

        const results = await runWithConcurrency(
          targets,
          async ({ type, file }): Promise<BatchFetchResult & { type: QuotaProviderType }> => {
            const adapter = QUOTA_ADAPTERS[type];
            try {
              const data = await adapter.fetchQuota(file, t);
              return { type, name: file.name, status: 'success', data };
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : t('common.unknown_error');
              return {
                type,
                name: file.name,
                status: 'error',
                error: message,
                errorStatus: getStatusFromError(err),
              };
            }
          },
          QUOTA_BATCH_CONCURRENCY
        );

        if (requestId !== requestIdRef.current) return;

        const resultsByType = new Map<
          QuotaProviderType,
          (BatchFetchResult & { type: QuotaProviderType })[]
        >();
        results.forEach((result) => {
          const typeResults = resultsByType.get(result.type) ?? [];
          typeResults.push(result);
          resultsByType.set(result.type, typeResults);
        });

        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          resultsByType.forEach((typeResults, type) => {
            const adapter = QUOTA_ADAPTERS[type];
            const setQuota = getQuotaSetter(adapter);
            setQuota((prev) => {
              const nextState = { ...prev };
              typeResults.forEach((result) => {
                nextState[result.name] =
                  result.status === 'success'
                    ? adapter.buildSuccessState(result.data)
                    : adapter.buildErrorState(
                        result.error || t('common.unknown_error'),
                        result.errorStatus
                      );
              });
              return nextState;
            });
          });
        });
      } finally {
        if (requestId === requestIdRef.current) {
          setBatchLoading(false);
          loadingRef.current = false;
        }
      }
    },
    [t]
  );

  return { batchLoading, loadQuota };
}
