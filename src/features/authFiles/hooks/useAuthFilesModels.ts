import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { AuthFileItem } from '@/types';
import { normalizeProviderKey, type AuthFileModelItem } from '@/features/authFiles/constants';
import {
  mergeAuthFileModels,
  modelsFromUsageQuotaSnapshot,
} from '@/features/authFiles/modelCatalog';
import { parseUsageQuotaSnapshot } from '@/utils/quota';

type ModelsError = 'unsupported' | null;

const getFreebuffQuotaModels = (item: AuthFileItem): AuthFileModelItem[] => {
  const provider = normalizeProviderKey(String(item.type ?? item.provider ?? ''));
  if (provider !== 'freebuff') return [];

  const cachedQuota = useQuotaStore.getState().freebuffQuota[item.name];
  const itemSnapshot = parseUsageQuotaSnapshot(item.usage_quota ?? item.usageQuota);

  return modelsFromUsageQuotaSnapshot(cachedQuota ? cachedQuota.snapshot : itemSnapshot);
};

export type UseAuthFilesModelsResult = {
  modelsModalOpen: boolean;
  modelsLoading: boolean;
  modelsList: AuthFileModelItem[];
  modelsFileName: string;
  modelsFileType: string;
  modelsError: ModelsError;
  showModels: (item: AuthFileItem) => Promise<void>;
  closeModelsModal: () => void;
  /** 文件集变更后失效缓存；不传 names 则全部清空。 */
  invalidateModels: (names?: string[]) => void;
};

export function useAuthFilesModels(): UseAuthFilesModelsResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [modelsModalOpen, setModelsModalOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsList, setModelsList] = useState<AuthFileModelItem[]>([]);
  const [modelsFileName, setModelsFileName] = useState('');
  const [modelsFileType, setModelsFileType] = useState('');
  const [modelsError, setModelsError] = useState<ModelsError>(null);
  const modelsCacheRef = useRef<Map<string, AuthFileModelItem[]>>(new Map());
  const modelsCacheVersionRef = useRef(0);
  const modelsFileVersionRef = useRef<Map<string, number>>(new Map());
  const activeModelsRequestIdRef = useRef(0);

  const closeModelsModal = useCallback(() => {
    activeModelsRequestIdRef.current += 1;
    setModelsModalOpen(false);
    setModelsLoading(false);
  }, []);

  const invalidateModels = useCallback((names?: string[]) => {
    if (!names) {
      modelsCacheRef.current.clear();
      modelsFileVersionRef.current.clear();
      modelsCacheVersionRef.current += 1;
      return;
    }
    new Set(names.map((name) => name.trim()).filter(Boolean)).forEach((name) => {
      modelsCacheRef.current.delete(name);
      modelsFileVersionRef.current.set(name, (modelsFileVersionRef.current.get(name) ?? 0) + 1);
    });
  }, []);

  const showModels = useCallback(
    async (item: AuthFileItem) => {
      const cacheKey = item.name.trim();
      const requestId = ++activeModelsRequestIdRef.current;

      setModelsFileName(item.name);
      setModelsFileType(item.type || '');
      const quotaModels = getFreebuffQuotaModels(item);
      setModelsList(quotaModels);
      setModelsError(null);
      setModelsModalOpen(true);

      const cached = modelsCacheRef.current.get(cacheKey);
      if (cached) {
        setModelsList(mergeAuthFileModels(cached, quotaModels));
      }

      const cacheVersion = modelsCacheVersionRef.current;
      const fileVersion = modelsFileVersionRef.current.get(cacheKey) ?? 0;
      const isCacheCurrent = () =>
        cacheVersion === modelsCacheVersionRef.current &&
        fileVersion === (modelsFileVersionRef.current.get(cacheKey) ?? 0);
      const isRequestCurrent = () => requestId === activeModelsRequestIdRef.current;

      setModelsLoading(true);
      try {
        const models = await authFilesApi.getModelsForAuthFile(item.name);
        const mergedModels = mergeAuthFileModels(models, getFreebuffQuotaModels(item));
        if (isCacheCurrent()) {
          modelsCacheRef.current.set(cacheKey, models);
          if (isRequestCurrent()) setModelsList(mergedModels);
        }
      } catch (err) {
        if (!isRequestCurrent() || !isCacheCurrent()) return;
        const errorMessage = err instanceof Error ? err.message : '';
        if (
          errorMessage.includes('404') ||
          errorMessage.includes('not found') ||
          errorMessage.includes('Not Found')
        ) {
          setModelsError('unsupported');
        } else {
          showNotification(`${t('notification.load_failed')}: ${errorMessage}`, 'error');
        }
      } finally {
        if (isRequestCurrent()) setModelsLoading(false);
      }
    },
    [showNotification, t]
  );

  return {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    showModels,
    closeModelsModal,
    invalidateModels,
  };
}
