/**
 * Quota management page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { USAGE_STATS_STALE_TIME_MS, useAuthStore, useUsageStatsStore } from '@/stores';
import { authFilesApi, configFileApi } from '@/services/api';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIRO_CONFIG,
  KIMI_CONFIG
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import styles from './QuotaPage.module.scss';

type QuotaAvailabilityFilter = 'all' | 'has' | 'none';
type QuotaSortMode = 'default' | 'quota_desc' | 'quota_asc';

const QUOTA_CONFIGS = [
  CLAUDE_CONFIG,
  ANTIGRAVITY_CONFIG,
  CODEX_CONFIG,
  KIRO_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG
] as const;

const compareModelNames = (left: string, right: string) =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });

const normalizeModelName = (value: string) => value.trim().toLowerCase();

const dedupeModelNames = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = normalizeModelName(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  });

  return result.sort(compareModelNames);
};

const extractModelToken = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const candidates = [
    record.name,
    record.id,
    record.model,
    record.display_name,
    record.displayName,
    record.alias
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
};

const extractInlineModels = (file: AuthFileItem): string[] => {
  const values: string[] = [];
  const arrayFields = [file['models'], file['modelIds'], file['model_ids']];
  const singleFields = [file['model'], file['modelId'], file['model_id'], file['testModel'], file['test-model']];

  arrayFields.forEach((field) => {
    if (Array.isArray(field)) {
      field.forEach((item) => {
        const model = extractModelToken(item);
        if (model) values.push(model);
      });
      return;
    }

    if (typeof field === 'string') {
      field
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => values.push(item));
    }
  });

  singleFields.forEach((field) => {
    const model = extractModelToken(field);
    if (model) values.push(model);
  });

  return dedupeModelNames(values);
};

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const usageDetails = useUsageStatsStore((state) => state.usageDetails);
  const usageLastRefreshedAt = useUsageStatsStore((state) => state.lastRefreshedAt);
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [availabilityFilter, setAvailabilityFilter] = useState<QuotaAvailabilityFilter>('all');
  const [selectedModel, setSelectedModel] = useState('all');
  const [sortMode, setSortMode] = useState<QuotaSortMode>('default');
  const [fileModelsByName, setFileModelsByName] = useState<Record<string, string[]>>({});
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false);
  const [modelReloadKey, setModelReloadKey] = useState(0);

  const fileModelsRef = useRef<Record<string, string[]>>({});

  useEffect(() => {
    fileModelsRef.current = fileModelsByName;
  }, [fileModelsByName]);

  const disableControls = connectionStatus !== 'connected';
  const usageStatsReady = usageLastRefreshedAt !== null;

  const quotaFiles = useMemo(
    () => files.filter((file) => QUOTA_CONFIGS.some((config) => config.filterFn(file))),
    [files]
  );

  const modelOptions = useMemo(() => {
    const models = new Map<string, string>();

    Object.values(fileModelsByName).forEach((entries) => {
      entries.forEach((model) => {
        const key = normalizeModelName(model);
        if (!key || models.has(key)) return;
        models.set(key, model);
      });
    });

    usageDetails.forEach((detail) => {
      const modelName = String(detail.__modelName ?? '').trim();
      const key = normalizeModelName(modelName);
      if (!key || models.has(key)) return;
      models.set(key, modelName);
    });

    return Array.from(models.values()).sort(compareModelNames);
  }, [fileModelsByName, usageDetails]);

  const loadConfig = useCallback(async () => {
    try {
      await configFileApi.fetchConfigYaml();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError((prev) => prev || errorMessage);
    }
  }, [t]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleHeaderRefresh = useCallback(async () => {
    setFileModelsByName({});
    setModelReloadKey((prev) => prev + 1);
    await Promise.all([
      loadConfig(),
      loadFiles(),
      loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS })
    ]);
  }, [loadConfig, loadFiles, loadUsageStats]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    loadFiles();
    loadConfig();
    void loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS }).catch(() => {});
  }, [loadFiles, loadConfig, loadUsageStats]);

  useEffect(() => {
    let cancelled = false;

    const activeFileNames = new Set(quotaFiles.map((file) => file.name));
    const inlineModelsByName: Record<string, string[]> = {};
    const missingFiles: AuthFileItem[] = [];

    quotaFiles.forEach((file) => {
      const inlineModels = extractInlineModels(file);
      if (inlineModels.length > 0) {
        inlineModelsByName[file.name] = inlineModels;
        return;
      }
      if (!fileModelsRef.current[file.name]) {
        missingFiles.push(file);
      }
    });

    setFileModelsByName((prev) => {
      const next: Record<string, string[]> = {};
      Object.entries(prev).forEach(([name, models]) => {
        if (activeFileNames.has(name) && !inlineModelsByName[name]) {
          next[name] = models;
        }
      });
      Object.entries(inlineModelsByName).forEach(([name, models]) => {
        next[name] = models;
      });
      return next;
    });

    if (disableControls || missingFiles.length === 0) {
      setModelCatalogLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setModelCatalogLoading(true);
    void Promise.allSettled(
      missingFiles.map(async (file) => {
        const remoteModels = await authFilesApi.getModelsForAuthFile(file.name);
        return {
          name: file.name,
          models: dedupeModelNames(
            remoteModels
              .map((item) => extractModelToken(item.id ?? item.display_name ?? item))
              .filter((item): item is string => Boolean(item))
          )
        };
      })
    ).then((results) => {
      if (cancelled) return;

      setFileModelsByName((prev) => {
        const next = { ...prev };
        results.forEach((result) => {
          if (result.status !== 'fulfilled') return;
          next[result.value.name] = result.value.models;
        });
        return next;
      });
      setModelCatalogLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [disableControls, modelReloadKey, quotaFiles]);

  useEffect(() => {
    if (selectedModel === 'all') return;
    if (modelOptions.some((model) => model === selectedModel)) return;
    setSelectedModel('all');
  }, [modelOptions, selectedModel]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
        <p className={styles.description}>{t('quota_management.description')}</p>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.filterToolbar}>
        <div className={styles.filterControl}>
          <label htmlFor="quota-availability-filter">{t('quota_management.quota_filter_label')}</label>
          <select
            id="quota-availability-filter"
            className={styles.pageSizeSelect}
            value={availabilityFilter}
            onChange={(event) => setAvailabilityFilter(event.target.value as QuotaAvailabilityFilter)}
          >
            <option value="all">{t('quota_management.quota_filter_all')}</option>
            <option value="has">{t('quota_management.quota_filter_has')}</option>
            <option value="none">{t('quota_management.quota_filter_none')}</option>
          </select>
        </div>

        <div className={styles.filterControl}>
          <label htmlFor="quota-model-filter">{t('quota_management.model_filter_label')}</label>
          <select
            id="quota-model-filter"
            className={styles.pageSizeSelect}
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
            disabled={modelCatalogLoading && modelOptions.length === 0}
          >
            <option value="all">{t('quota_management.model_filter_all')}</option>
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterControl}>
          <label htmlFor="quota-sort-mode">{t('quota_management.sort_label')}</label>
          <select
            id="quota-sort-mode"
            className={styles.pageSizeSelect}
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as QuotaSortMode)}
          >
            <option value="default">{t('quota_management.sort_default')}</option>
            <option value="quota_desc">{t('quota_management.sort_quota_desc')}</option>
            <option value="quota_asc">{t('quota_management.sort_quota_asc')}</option>
          </select>
        </div>

        <div className={styles.filterStatus}>
          {modelCatalogLoading
            ? t('quota_management.model_filter_loading')
            : t('quota_management.model_filter_ready', { count: modelOptions.length })}
        </div>
      </div>

      <QuotaSection
        config={CLAUDE_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        usageDetails={usageDetails}
        usageStatsReady={usageStatsReady}
        availabilityFilter={availabilityFilter}
        selectedModel={selectedModel}
        sortMode={sortMode}
        fileModelsByName={fileModelsByName}
      />
      <QuotaSection
        config={ANTIGRAVITY_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        usageDetails={usageDetails}
        usageStatsReady={usageStatsReady}
        availabilityFilter={availabilityFilter}
        selectedModel={selectedModel}
        sortMode={sortMode}
        fileModelsByName={fileModelsByName}
      />
      <QuotaSection
        config={CODEX_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        usageDetails={usageDetails}
        usageStatsReady={usageStatsReady}
        availabilityFilter={availabilityFilter}
        selectedModel={selectedModel}
        sortMode={sortMode}
        fileModelsByName={fileModelsByName}
      />
      <QuotaSection
        config={KIRO_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        usageDetails={usageDetails}
        usageStatsReady={usageStatsReady}
        availabilityFilter={availabilityFilter}
        selectedModel={selectedModel}
        sortMode={sortMode}
        fileModelsByName={fileModelsByName}
      />
      <QuotaSection
        config={GEMINI_CLI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        usageDetails={usageDetails}
        usageStatsReady={usageStatsReady}
        availabilityFilter={availabilityFilter}
        selectedModel={selectedModel}
        sortMode={sortMode}
        fileModelsByName={fileModelsByName}
      />
      <QuotaSection
        config={KIMI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        usageDetails={usageDetails}
        usageStatsReady={usageStatsReady}
        availabilityFilter={availabilityFilter}
        selectedModel={selectedModel}
        sortMode={sortMode}
        fileModelsByName={fileModelsByName}
      />
    </div>
  );
}
