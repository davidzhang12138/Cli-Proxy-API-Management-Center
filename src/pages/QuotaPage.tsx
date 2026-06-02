/**
 * Quota management page.
 */

import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';
import { IconFilterAll } from '@/components/ui/icons';
import {
  getAuthFileIcon,
  getTypeColor,
  getTypeLabel,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  USAGE_STATS_STALE_TIME_MS,
  useAuthStore,
  useThemeStore,
  useUsageStatsStore,
} from '@/stores';
import { authFilesApi, configFileApi } from '@/services/api';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIRO_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import styles from './QuotaPage.module.scss';

type QuotaAvailabilityFilter = 'all' | 'has' | 'none' | 'expired' | 'uncached';
type QuotaSortMode =
  | 'default'
  | 'quota_desc'
  | 'quota_asc'
  | 'model_reset_asc'
  | 'model_reset_desc'
  | 'model_recent_usage_asc'
  | 'model_recent_usage_desc';

const QUOTA_CONFIGS = [
  CLAUDE_CONFIG,
  ANTIGRAVITY_CONFIG,
  CODEX_CONFIG,
  KIRO_CONFIG,
  XAI_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
] as const;
type ActiveQuotaType = (typeof QUOTA_CONFIGS)[number]['type'];
type ActiveQuotaFilter = 'all' | ActiveQuotaType;
type QuotaPaginationState = Record<ActiveQuotaType, { page: number; pageSize: number }>;

const DEFAULT_QUOTA_PAGE_SIZE = 6;
const createDefaultQuotaPaginationState = (): QuotaPaginationState =>
  QUOTA_CONFIGS.reduce((result, config) => {
    result[config.type] = { page: 1, pageSize: DEFAULT_QUOTA_PAGE_SIZE };
    return result;
  }, {} as QuotaPaginationState);

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
    record.alias,
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
  const singleFields = [
    file['model'],
    file['modelId'],
    file['model_id'],
    file['testModel'],
    file['test-model'],
  ];

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
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const usageDetails = useUsageStatsStore((state) => state.usageDetails);
  const usageLastRefreshedAt = useUsageStatsStore((state) => state.lastRefreshedAt);
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [filesByType, setFilesByType] = useState<Partial<Record<ActiveQuotaType, AuthFileItem[]>>>(
    {}
  );
  const [totalByType, setTotalByType] = useState<Partial<Record<ActiveQuotaType, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [availabilityFilter, setAvailabilityFilter] = useState<QuotaAvailabilityFilter>('all');
  const [selectedModel, setSelectedModel] = useState('all');
  const [sortMode, setSortMode] = useState<QuotaSortMode>('default');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeQuotaFilter, setActiveQuotaFilter] = useState<ActiveQuotaFilter>('all');
  const [fileModelsByName, setFileModelsByName] = useState<Record<string, string[]>>({});
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false);
  const [modelReloadKey, setModelReloadKey] = useState(0);
  const [quotaPagination, setQuotaPagination] = useState<QuotaPaginationState>(
    createDefaultQuotaPaginationState
  );
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const fileModelsRef = useRef<Record<string, string[]>>({});
  const filesByTypeRef = useRef<Partial<Record<ActiveQuotaType, AuthFileItem[]>>>({});
  const totalByTypeRef = useRef<Partial<Record<ActiveQuotaType, number>>>({});

  useEffect(() => {
    fileModelsRef.current = fileModelsByName;
  }, [fileModelsByName]);

  useEffect(() => {
    filesByTypeRef.current = filesByType;
  }, [filesByType]);

  useEffect(() => {
    totalByTypeRef.current = totalByType;
  }, [totalByType]);

  const disableControls = connectionStatus !== 'connected';
  const usageStatsReady = usageLastRefreshedAt !== null;
  const serverPaginationEnabled =
    deferredSearchQuery.trim().length === 0 &&
    availabilityFilter === 'all' &&
    selectedModel === 'all' &&
    sortMode === 'default';

  const quotaFiles = useMemo(
    () => files.filter((file) => QUOTA_CONFIGS.some((config) => config.filterFn(file))),
    [files]
  );
  const quotaTypeCounts = useMemo(
    () =>
      QUOTA_CONFIGS.reduce<Record<ActiveQuotaType, number>>(
        (result, config) => {
          result[config.type] = serverPaginationEnabled
            ? (totalByType[config.type] ?? 0)
            : quotaFiles.filter((file) => config.filterFn(file)).length;
          return result;
        },
        {} as Record<ActiveQuotaType, number>
      ),
    [quotaFiles, serverPaginationEnabled, totalByType]
  );
  const totalQuotaFileCount = useMemo(
    () =>
      serverPaginationEnabled
        ? QUOTA_CONFIGS.reduce((sum, config) => sum + (quotaTypeCounts[config.type] ?? 0), 0)
        : quotaFiles.length,
    [quotaFiles.length, quotaTypeCounts, serverPaginationEnabled]
  );
  const availableQuotaConfigs = useMemo(
    () => QUOTA_CONFIGS.filter((config) => (quotaTypeCounts[config.type] ?? 0) > 0),
    [quotaTypeCounts]
  );
  const selectedQuotaConfigs = useMemo(() => {
    if (activeQuotaFilter === 'all') {
      return availableQuotaConfigs;
    }
    return availableQuotaConfigs.filter((config) => config.type === activeQuotaFilter);
  }, [activeQuotaFilter, availableQuotaConfigs]);
  const scopedQuotaFiles = useMemo(() => {
    if (activeQuotaFilter === 'all') {
      return quotaFiles;
    }
    const selectedConfig = QUOTA_CONFIGS.find((config) => config.type === activeQuotaFilter);
    return selectedConfig ? quotaFiles.filter((file) => selectedConfig.filterFn(file)) : [];
  }, [activeQuotaFilter, quotaFiles]);

  const modelOptions = useMemo(() => {
    const models = new Map<string, string>();
    const scopedAuthIndexKeys = new Set(
      scopedQuotaFiles
        .map((file) => String(file['auth_index'] ?? file.authIndex ?? '').trim())
        .filter(Boolean)
    );

    scopedQuotaFiles.forEach((file) => {
      const entries = fileModelsByName[file.name] ?? [];
      entries.forEach((model) => {
        const key = normalizeModelName(model);
        if (!key || models.has(key)) return;
        models.set(key, model);
      });
    });

    usageDetails.forEach((detail) => {
      const authIndexKey = String(detail.auth_index ?? '').trim();
      if (!authIndexKey || !scopedAuthIndexKeys.has(authIndexKey)) {
        return;
      }
      const modelName = String(detail.__modelName ?? '').trim();
      const key = normalizeModelName(modelName);
      if (!key || models.has(key)) return;
      models.set(key, modelName);
    });

    return Array.from(models.values()).sort(compareModelNames);
  }, [fileModelsByName, scopedQuotaFiles, usageDetails]);

  useEffect(() => {
    if (activeQuotaFilter === 'all') return;
    if (availableQuotaConfigs.some((config) => config.type === activeQuotaFilter)) return;
    setActiveQuotaFilter('all');
  }, [activeQuotaFilter, availableQuotaConfigs]);

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
      if (serverPaginationEnabled) {
        const typesToLoad =
          activeQuotaFilter === 'all'
            ? QUOTA_CONFIGS.map((config) => config.type)
            : [activeQuotaFilter];
        const [responses, categoriesData] = await Promise.all([
          Promise.all(
            typesToLoad.map(async (type) => {
              const pageState = quotaPagination[type];
              const data = await authFilesApi.list({
                page: pageState.page,
                pageSize: pageState.pageSize,
                provider: type,
              });
              return { type, data };
            })
          ),
          activeQuotaFilter === 'all'
            ? Promise.resolve(null)
            : authFilesApi.list({ page: 1, pageSize: 1 }).catch(() => null),
        ]);
        const nextFilesByType: Partial<Record<ActiveQuotaType, AuthFileItem[]>> = {
          ...filesByTypeRef.current,
        };
        const nextTotalByType: Partial<Record<ActiveQuotaType, number>> = {
          ...totalByTypeRef.current,
        };
        categoriesData?.categories?.providers?.forEach((item) => {
          const matched = QUOTA_CONFIGS.find((config) => config.type === item.name);
          if (matched) {
            nextTotalByType[matched.type] = item.count;
          }
        });
        responses.forEach(({ type, data }) => {
          nextFilesByType[type] = data?.files ?? [];
          nextTotalByType[type] =
            data?.pagination?.total ?? data?.total ?? data?.files?.length ?? 0;
        });
        const mergedFiles = QUOTA_CONFIGS.flatMap((config) => nextFilesByType[config.type] ?? []);
        setFilesByType(nextFilesByType);
        setTotalByType(nextTotalByType);
        setFiles(mergedFiles);
      } else {
        const data = await authFilesApi.list();
        const nextFiles = data?.files || [];
        setFiles(nextFiles);
        setFilesByType({});
        setTotalByType(
          QUOTA_CONFIGS.reduce<Partial<Record<ActiveQuotaType, number>>>((result, config) => {
            result[config.type] = nextFiles.filter((file) => config.filterFn(file)).length;
            return result;
          }, {})
        );
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [activeQuotaFilter, quotaPagination, serverPaginationEnabled, t]);

  const handleHeaderRefresh = useCallback(async () => {
    setFileModelsByName({});
    setModelReloadKey((prev) => prev + 1);
    await Promise.all([
      loadConfig(),
      loadFiles(),
      loadUsageStats({
        force: true,
        staleTimeMs: USAGE_STATS_STALE_TIME_MS,
        queryParams: { all: true },
      }),
    ]);
  }, [loadConfig, loadFiles, loadUsageStats]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    loadFiles();
    loadConfig();
    void loadUsageStats({
      staleTimeMs: USAGE_STATS_STALE_TIME_MS,
      queryParams: { all: true },
    }).catch(() => {});
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
          ),
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

  const commonSectionProps = {
    loading,
    disabled: disableControls,
    usageDetails,
    usageStatsReady,
    availabilityFilter,
    selectedModel,
    sortMode,
    searchQuery: deferredSearchQuery,
    fileModelsByName,
    onFilesChanged: loadFiles,
  };

  const updateQuotaPage = useCallback((type: ActiveQuotaType, page: number) => {
    setQuotaPagination((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        page: Math.max(1, Math.round(page)),
      },
    }));
  }, []);

  const updateQuotaPageSize = useCallback((type: ActiveQuotaType, pageSize: number) => {
    setQuotaPagination((prev) => ({
      ...prev,
      [type]: {
        page: 1,
        pageSize: Math.max(1, Math.round(pageSize)),
      },
    }));
  }, []);

  const getQuotaSectionProps = useCallback(
    (type: ActiveQuotaType) => {
      const pageState = quotaPagination[type];
      const total = totalByType[type] ?? 0;
      return {
        files: serverPaginationEnabled ? (filesByType[type] ?? []) : files,
        serverPagination: serverPaginationEnabled
          ? {
              enabled: true,
              total,
              totalPages: Math.max(1, Math.ceil(total / Math.max(1, pageState.pageSize))),
              currentPage: pageState.page,
              pageSize: pageState.pageSize,
              onPageChange: (nextPage: number) => updateQuotaPage(type, nextPage),
              onPageSizeChange: (nextPageSize: number) => updateQuotaPageSize(type, nextPageSize),
            }
          : undefined,
      };
    },
    [
      files,
      filesByType,
      quotaPagination,
      serverPaginationEnabled,
      totalByType,
      updateQuotaPage,
      updateQuotaPageSize,
    ]
  );

  const renderQuotaSection = (type: ActiveQuotaType) => {
    const sectionProps = getQuotaSectionProps(type);
    switch (type) {
      case ANTIGRAVITY_CONFIG.type:
        return (
          <QuotaSection
            key={type}
            config={ANTIGRAVITY_CONFIG}
            {...commonSectionProps}
            {...sectionProps}
          />
        );
      case CODEX_CONFIG.type:
        return (
          <QuotaSection
            key={type}
            config={CODEX_CONFIG}
            {...commonSectionProps}
            {...sectionProps}
          />
        );
      case KIRO_CONFIG.type:
        return (
          <QuotaSection key={type} config={KIRO_CONFIG} {...commonSectionProps} {...sectionProps} />
        );
      case XAI_CONFIG.type:
        return (
          <QuotaSection key={type} config={XAI_CONFIG} {...commonSectionProps} {...sectionProps} />
        );
      case GEMINI_CLI_CONFIG.type:
        return (
          <QuotaSection
            key={type}
            config={GEMINI_CLI_CONFIG}
            {...commonSectionProps}
            {...sectionProps}
          />
        );
      case KIMI_CONFIG.type:
        return (
          <QuotaSection key={type} config={KIMI_CONFIG} {...commonSectionProps} {...sectionProps} />
        );
      case CLAUDE_CONFIG.type:
      default:
        return (
          <QuotaSection
            key={type}
            config={CLAUDE_CONFIG}
            {...commonSectionProps}
            {...sectionProps}
          />
        );
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
        <p className={styles.description}>{t('quota_management.description')}</p>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.filterSection}>
        <div className={styles.filterRail}>
          <div className={styles.filterTags}>
            {(
              [
                { type: 'all' as const, count: totalQuotaFileCount },
                ...availableQuotaConfigs.map((config) => ({
                  type: config.type,
                  count: quotaTypeCounts[config.type] ?? 0,
                })),
              ] as Array<{ type: ActiveQuotaFilter; count: number }>
            ).map(({ type, count }) => {
              const isActive = activeQuotaFilter === type;
              const iconSrc = type === 'all' ? null : getAuthFileIcon(type, resolvedTheme);
              const color =
                type === 'all'
                  ? { bg: 'var(--bg-tertiary)', text: 'var(--text-primary)' }
                  : getTypeColor(type, resolvedTheme);
              const buttonStyle = {
                '--filter-color': color.text,
                '--filter-surface': color.bg,
                '--filter-active-text': resolvedTheme === 'dark' ? '#111827' : '#ffffff',
              } as CSSProperties;

              return (
                <button
                  key={type}
                  type="button"
                  className={`${styles.filterTag} ${isActive ? styles.filterTagActive : ''}`}
                  style={buttonStyle}
                  onClick={() => {
                    startTransition(() => {
                      setActiveQuotaFilter(type);
                      if (type !== 'all') {
                        updateQuotaPage(type, 1);
                      }
                    });
                  }}
                >
                  <span className={styles.filterTagLabel}>
                    {type === 'all' ? (
                      <span className={`${styles.filterTagIconWrap} ${styles.filterAllIconWrap}`}>
                        <IconFilterAll className={styles.filterAllIcon} size={16} />
                      </span>
                    ) : (
                      <span className={styles.filterTagIconWrap}>
                        {iconSrc ? (
                          <img src={iconSrc} alt="" className={styles.filterTagIcon} />
                        ) : (
                          <span className={styles.filterTagIconFallback}>
                            {getTypeLabel(t, type).slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </span>
                    )}
                    <span className={styles.filterTagText}>
                      {type === 'all' ? t('auth_files.filter_all') : getTypeLabel(t, type)}
                    </span>
                  </span>
                  <span className={styles.filterTagCount}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.filterControlsPanel}>
          <div className={styles.filterToolbar}>
            <div className={styles.filterControl}>
              <label htmlFor="quota-search-query">{t('quota_management.search_label')}</label>
              <input
                id="quota-search-query"
                type="search"
                className={styles.searchInput}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('quota_management.search_placeholder')}
                spellCheck={false}
              />
            </div>

            <div className={styles.filterControl}>
              <label htmlFor="quota-availability-filter">
                {t('quota_management.quota_filter_label')}
              </label>
              <select
                id="quota-availability-filter"
                className={styles.pageSizeSelect}
                value={availabilityFilter}
                onChange={(event) =>
                  setAvailabilityFilter(event.target.value as QuotaAvailabilityFilter)
                }
              >
                <option value="all">{t('quota_management.quota_filter_all')}</option>
                <option value="has">{t('quota_management.quota_filter_has')}</option>
                <option value="none">{t('quota_management.quota_filter_none')}</option>
                <option value="expired">{t('quota_management.quota_filter_expired')}</option>
                <option value="uncached">{t('quota_management.quota_filter_uncached')}</option>
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
                <option value="model_reset_asc">
                  {t('quota_management.sort_model_reset_asc')}
                </option>
                <option value="model_reset_desc">
                  {t('quota_management.sort_model_reset_desc')}
                </option>
                <option value="model_recent_usage_asc">
                  {t('quota_management.sort_model_recent_usage_asc')}
                </option>
                <option value="model_recent_usage_desc">
                  {t('quota_management.sort_model_recent_usage_desc')}
                </option>
              </select>
            </div>

            <div className={styles.filterStatus}>
              {modelCatalogLoading
                ? t('quota_management.model_filter_loading')
                : t('quota_management.model_filter_ready', { count: modelOptions.length })}
            </div>
          </div>
        </div>
      </div>

      {selectedQuotaConfigs.map((config) => renderQuotaSection(config.type))}
    </div>
  );
}
