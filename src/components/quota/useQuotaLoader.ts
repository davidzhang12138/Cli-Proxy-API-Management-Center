/**
 * Generic hook for quota data fetching and management.
 */

import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent, useQuotaStore } from '@/stores';
import { getStatusFromError } from '@/utils/quota';
import type { QuotaConfig } from './quotaConfigs';
import { canUseManagedQuotaRefresh, refreshManagedQuotaStates } from './managedQuotaRefresh';

type QuotaScope = 'page' | 'all';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

interface LoadQuotaResult<TData> {
  name: string;
  status: 'success' | 'error';
  data?: TData;
  file?: AuthFileItem;
  error?: string;
  errorStatus?: number;
}

interface LoadQuotaSummary {
  total: number;
  successCount: number;
  errorCount: number;
  files: AuthFileItem[];
  errors: Array<{
    name: string;
    error: string;
    errorStatus?: number;
  }>;
}

interface LoadQuotaProgress {
  completedCount: number;
  total: number;
  successCount: number;
  errorCount: number;
}

export function useQuotaLoader<TState, TData>(config: QuotaConfig<TState, TData>) {
  const { t } = useTranslation();
  const quota = useQuotaStore(config.storeSelector);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  const loadQuota = useCallback(
    async (
      targets: AuthFileItem[],
      scope: QuotaScope,
      setLoading: (loading: boolean, scope?: QuotaScope | null) => void,
      onProgress?: (progress: LoadQuotaProgress) => void
    ): Promise<LoadQuotaSummary | null> => {
      if (loadingRef.current) return null;
      loadingRef.current = true;
      const requestId = ++requestIdRef.current;
      const cacheGeneration = captureQuotaCacheGeneration();
      setLoading(true, scope);

      try {
        if (targets.length === 0) {
          return { total: 0, successCount: 0, errorCount: 0, files: [], errors: [] };
        }

        setQuota((prev) => {
          const nextState = { ...prev };
          targets.forEach((file) => {
            nextState[file.name] = config.buildLoadingState();
          });
          return nextState;
        });

        let completedCount = 0;
        let successCount = 0;
        let errorCount = 0;

        const canUseManagedRefresh = canUseManagedQuotaRefresh(config, targets);
        const results: LoadQuotaResult<TData>[] = canUseManagedRefresh
          ? []
          : await Promise.all(
              targets.map(async (file): Promise<LoadQuotaResult<TData>> => {
                try {
                  const data = await config.fetchQuota(file, t);
                  successCount += 1;
                  return { name: file.name, status: 'success', data };
                } catch (err: unknown) {
                  const message = err instanceof Error ? err.message : t('common.unknown_error');
                  const errorStatus = getStatusFromError(err);
                  errorCount += 1;
                  return { name: file.name, status: 'error', error: message, errorStatus };
                } finally {
                  completedCount += 1;
                  onProgress?.({
                    completedCount,
                    total: targets.length,
                    successCount,
                    errorCount,
                  });
                }
              })
            );

        if (canUseManagedRefresh) {
          results.push(
            ...(await Promise.all(
              targets.map(async (file): Promise<LoadQuotaResult<TData>> => {
                const fileManagedResults = await refreshManagedQuotaStates(config, [file]).catch(
                  () => null
                );
                const managedResult = fileManagedResults?.[0];
                let result: LoadQuotaResult<TData>;

                if (managedResult?.status === 'success') {
                  result = {
                    name: managedResult.name,
                    status: 'success',
                    data: managedResult.state as TData,
                    file: managedResult.file,
                  };
                } else if (managedResult?.status === 'error' && !managedResult.fallbackable) {
                  result = {
                    name: managedResult.name,
                    status: 'error',
                    error: managedResult.error || t('common.unknown_error'),
                    file: managedResult.file,
                  };
                } else {
                  try {
                    const data = await config.fetchQuota(file, t);
                    result = { name: file.name, status: 'success', data };
                  } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : t('common.unknown_error');
                    const errorStatus = getStatusFromError(err);
                    result = { name: file.name, status: 'error', error: message, errorStatus };
                  }
                }

                completedCount += 1;
                if (result.status === 'success') {
                  successCount += 1;
                  commitIfQuotaCacheCurrent(cacheGeneration, () => {
                    setQuota((prev) => ({
                      ...prev,
                      [result.name]:
                        managedResult?.status === 'success'
                          ? (result.data as TState)
                          : config.buildSuccessState(result.data as TData),
                    }));
                  });
                } else {
                  errorCount += 1;
                  commitIfQuotaCacheCurrent(cacheGeneration, () => {
                    setQuota((prev) => ({
                      ...prev,
                      [result.name]: config.buildErrorState(
                        result.error || t('common.unknown_error'),
                        result.errorStatus
                      ),
                    }));
                  });
                }
                onProgress?.({
                  completedCount,
                  total: targets.length,
                  successCount,
                  errorCount,
                });
                return result;
              })
            ))
          );
        }

        if (requestId !== requestIdRef.current) return null;

        if (!canUseManagedRefresh) {
          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            setQuota((prev) => {
              const nextState = { ...prev };
              results.forEach((result) => {
                if (result.status === 'success') {
                  nextState[result.name] = config.buildSuccessState(result.data as TData);
                } else {
                  nextState[result.name] = config.buildErrorState(
                    result.error || t('common.unknown_error'),
                    result.errorStatus
                  );
                }
              });
              return nextState;
            });
          });
        }

        return {
          total: results.length,
          successCount,
          errorCount,
          files: results
            .map((result) => result.file)
            .filter((file): file is AuthFileItem => Boolean(file)),
          errors: results
            .filter(
              (
                result
              ): result is LoadQuotaResult<TData> & {
                status: 'error';
                error: string;
              } => result.status === 'error'
            )
            .map((result) => ({
              name: result.name,
              error: result.error || t('common.unknown_error'),
              errorStatus: result.errorStatus,
            })),
        };
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          loadingRef.current = false;
        }
      }
    },
    [config, setQuota, t]
  );

  return { quota, loadQuota };
}
