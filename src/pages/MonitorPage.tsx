import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  BarController,
  LineController,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useThemeStore } from '@/stores';
import { usageApi, providersApi, authFilesApi } from '@/services/api';
import { buildUsageDateQueryParams, filterDataByApiFilter, filterDataByTimeRange } from '@/utils/monitor';
import { buildSourceInfoMap, type SourceInfoMap } from '@/utils/sourceResolver';
import { normalizeAuthIndex } from '@/utils/usage';
import type { CredentialInfo } from '@/types/sourceInfo';
import { KpiCards } from '@/components/monitor/KpiCards';
import { ModelDistributionChart } from '@/components/monitor/ModelDistributionChart';
import { DailyTrendChart } from '@/components/monitor/DailyTrendChart';
import { HourlyCostChart } from '@/components/monitor/HourlyCostChart';
import { RequestLogs } from '@/components/monitor/RequestLogs';
import styles from './MonitorPage.module.scss';

// 注册 Chart.js 组件
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  BarController,
  LineController,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// 时间范围选项
type TimeRange = 1 | 7 | 14 | 30;

export interface UsageDetail {
  timestamp: string;
  failed: boolean;
  source: string;
  auth_index: string;
  latency_ms?: number | string | null;
  tokens: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    cached_tokens: number;
    cache_tokens?: number;
    total_tokens: number;
  };
}

export interface UsageData {
  apis: Record<string, {
    models: Record<string, {
      details: UsageDetail[];
    }>;
  }>;
}

type MonitorProviderContext = {
  providerMap: Record<string, string>;
  providerTypeMap: Record<string, string>;
  sourceInfoMap: SourceInfoMap;
};
type MonitorAuthLookupEntry = [string, CredentialInfo];

let inFlightProviderContext: Promise<MonitorProviderContext> | null = null;
const MONITOR_AUTH_LOOKUP_PAGE_SIZE = 20;
const MONITOR_AUTH_LOOKUP_MAX_TERMS = 120;
const monitorAuthLookupCache = new Map<string, MonitorAuthLookupEntry[]>();
const inFlightMonitorAuthLookups = new Map<string, Promise<MonitorAuthLookupEntry[]>>();

const loadMonitorProviderContext = async (): Promise<MonitorProviderContext> => {
  if (inFlightProviderContext) return inFlightProviderContext;

  inFlightProviderContext = (async () => {
    const map: Record<string, string> = {};
    const typeMap: Record<string, string> = {};

    const [openaiProviders, geminiKeys, claudeConfigs, codexConfigs, vertexConfigs] =
      await Promise.all([
        providersApi.getOpenAIProviders().catch(() => []),
        providersApi.getGeminiKeys().catch(() => []),
        providersApi.getClaudeConfigs().catch(() => []),
        providersApi.getCodexConfigs().catch(() => []),
        providersApi.getVertexConfigs().catch(() => []),
      ]);

    openaiProviders.forEach((provider) => {
      const providerName = provider.headers?.['X-Provider'] || provider.name || 'unknown';
      const apiKeyEntries = provider.apiKeyEntries || [];
      apiKeyEntries.forEach((entry) => {
        const apiKey = entry.apiKey;
        if (apiKey) {
          map[apiKey] = providerName;
          typeMap[apiKey] = 'OpenAI';
        }
      });
      if (provider.name) {
        map[provider.name] = providerName;
        typeMap[provider.name] = 'OpenAI';
      }
    });

    geminiKeys.forEach((config) => {
      const apiKey = config.apiKey;
      if (apiKey) {
        const providerName = config.prefix?.trim() || 'Gemini';
        map[apiKey] = providerName;
        typeMap[apiKey] = 'Gemini';
      }
    });

    claudeConfigs.forEach((config) => {
      const apiKey = config.apiKey;
      if (apiKey) {
        const providerName = config.prefix?.trim() || 'Claude';
        map[apiKey] = providerName;
        typeMap[apiKey] = 'Claude';
      }
    });

    codexConfigs.forEach((config) => {
      const apiKey = config.apiKey;
      if (apiKey) {
        const providerName = config.prefix?.trim() || 'Codex';
        map[apiKey] = providerName;
        typeMap[apiKey] = 'Codex';
      }
    });

    vertexConfigs.forEach((config) => {
      const apiKey = config.apiKey;
      if (apiKey) {
        const providerName = config.prefix?.trim() || 'Vertex';
        map[apiKey] = providerName;
        typeMap[apiKey] = 'Vertex';
      }
    });

    return {
      providerMap: map,
      providerTypeMap: typeMap,
      sourceInfoMap: buildSourceInfoMap({
        geminiApiKeys: geminiKeys,
        claudeApiKeys: claudeConfigs,
        codexApiKeys: codexConfigs,
        vertexApiKeys: vertexConfigs,
        openaiCompatibility: openaiProviders,
      }),
    };
  })().finally(() => {
    inFlightProviderContext = null;
  });

  return inFlightProviderContext;
};

const normalizeUsageSourceForAuthLookup = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.startsWith('t:') ? raw.slice(2).trim() : raw;
};

const collectMonitorAuthLookupTerms = (data: UsageData | null): string[] => {
  if (!data?.apis) return [];

  const terms = new Set<string>();
  Object.values(data.apis).forEach((api) => {
    Object.values(api.models || {}).forEach((model) => {
      (model.details || []).forEach((detail) => {
        const authIndex = normalizeAuthIndex(detail.auth_index);
        if (authIndex) terms.add(authIndex);

        const source = normalizeUsageSourceForAuthLookup(detail.source);
        if (source.includes('@') || source.endsWith('.json')) terms.add(source);
      });
    });
  });

  return Array.from(terms).slice(0, MONITOR_AUTH_LOOKUP_MAX_TERMS);
};

const credentialInfoFromAuthFile = (file: unknown): MonitorAuthLookupEntry | null => {
  if (!file || typeof file !== 'object') return null;
  const entry = file as Record<string, unknown>;
  const authIndex = normalizeAuthIndex(entry.auth_index ?? entry.authIndex);
  if (!authIndex) return null;
  return [
    authIndex,
    {
      name: String(entry.name || entry.email || entry.account || authIndex),
      type: String(entry.type || entry.provider || ''),
    },
  ];
};

const fetchMonitorAuthLookupTerm = (term: string): Promise<MonitorAuthLookupEntry[]> => {
  const key = term.trim().toLowerCase();
  if (!key) return Promise.resolve([]);

  const cached = monitorAuthLookupCache.get(key);
  if (cached) return Promise.resolve(cached);

  const inFlight = inFlightMonitorAuthLookups.get(key);
  if (inFlight) return inFlight;

  const request = authFilesApi
    .list({
      search: term,
      page: 1,
      pageSize: MONITOR_AUTH_LOOKUP_PAGE_SIZE,
    })
    .then((response) => {
      const results = (response.files || [])
        .map(credentialInfoFromAuthFile)
        .filter((entry): entry is MonitorAuthLookupEntry => Boolean(entry));
      monitorAuthLookupCache.set(key, results);
      return results;
    })
    .catch(() => [])
    .finally(() => {
      if (inFlightMonitorAuthLookups.get(key) === request) {
        inFlightMonitorAuthLookups.delete(key);
      }
    });

  inFlightMonitorAuthLookups.set(key, request);
  return request;
};

const loadMonitorAuthFileMap = async (data: UsageData | null): Promise<Map<string, CredentialInfo>> => {
  const terms = collectMonitorAuthLookupTerms(data);
  const authFileMap = new Map<string, CredentialInfo>();

  for (let index = 0; index < terms.length; index += 8) {
    const batch = terms.slice(index, index + 8);
    const results = await Promise.all(batch.map(fetchMonitorAuthLookupTerm));
    results.flat().forEach(([authIndex, info]) => {
      authFileMap.set(authIndex, info);
    });
  }

  return authFileMap;
};

function DeferredSection({
  children,
  label,
  minHeight = 320,
}: {
  children: ReactNode;
  label: string;
  minHeight?: number;
}) {
  const [mounted, setMounted] = useState(() => typeof IntersectionObserver === 'undefined');
  const placeholderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (mounted) return;
    const node = placeholderRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMounted(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: '240px 0px',
      }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [mounted]);

  if (mounted) {
    return <>{children}</>;
  }

  return (
    <div ref={placeholderRef} className={styles.deferredPlaceholder} style={{ minHeight }}>
      <div className={styles.deferredPlaceholderContent}>
        <LoadingSpinner size={22} className={styles.deferredPlaceholderSpinner} />
        <span className={styles.deferredPlaceholderText}>{label}</span>
      </div>
    </div>
  );
}

export function MonitorPage() {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = resolvedTheme === 'dark';

  // 状态
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>(1);
  const [apiFilter, setApiFilter] = useState('');
  const [providerMap, setProviderMap] = useState<Record<string, string>>({});
  const [providerTypeMap, setProviderTypeMap] = useState<Record<string, string>>({});
  const [sourceInfoMap, setSourceInfoMap] = useState<SourceInfoMap>({
    byAuthIndex: new Map(),
    bySource: new Map(),
  });
  const [authFileMap, setAuthFileMap] = useState<Map<string, CredentialInfo>>(new Map());

  // 加载渠道名称映射（支持所有提供商类型）
  const loadProviderMap = useCallback(async () => {
    try {
      const context = await loadMonitorProviderContext();
      setProviderMap(context.providerMap);
      setProviderTypeMap(context.providerTypeMap);
      setSourceInfoMap(context.sourceInfoMap);
    } catch (err) {
      console.warn('Monitor: Failed to load provider map:', err);
    }
  }, []);

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    // 渠道映射并行加载，但不阻塞主数据展示
    loadProviderMap();
    try {
      const response = await usageApi.getUsage(buildUsageDateQueryParams(timeRange));
      // API 返回的数据可能在 response.usage 或直接在 response 中
      const data = response?.usage ?? response;
      setUsageData(data as UsageData);
      void loadMonitorAuthFileMap(data as UsageData).then(setAuthFileMap);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      console.error('Monitor: Error loading data:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t, loadProviderMap, timeRange]);

  // 初始加载
  useEffect(() => {
    loadData();
  }, [loadData]);

  // 响应头部刷新
  useHeaderRefresh(loadData);

  // 根据时间范围过滤数据
  const apiFilteredData = useMemo(() => {
    return filterDataByApiFilter(usageData, apiFilter);
  }, [usageData, apiFilter]);

  const filteredData = useMemo(() => {
    return filterDataByTimeRange(apiFilteredData, timeRange);
  }, [apiFilteredData, timeRange]);

  // 处理时间范围变化
  const handleTimeRangeChange = (range: TimeRange) => {
    setTimeRange(range);
  };

  // 处理 API 过滤应用（触发数据刷新）
  const handleApiFilterApply = () => {
    loadData();
  };

  const initialLoading = loading && !usageData;

  return (
    <div className={styles.container}>
      {initialLoading && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
            <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
          </div>
        </div>
      )}

      {!initialLoading && (
        <>
          {/* 页面标题 */}
          <div className={styles.header}>
            <h1 className={styles.pageTitle}>{t('monitor.title')}</h1>
            <div className={styles.headerActions}>
              <Button
                variant="secondary"
                size="sm"
                onClick={loadData}
                disabled={loading}
              >
                {loading ? t('common.loading') : t('common.refresh')}
              </Button>
            </div>
          </div>

          {/* 错误提示 */}
          {error && <div className={styles.errorBox}>{error}</div>}

          {/* 时间范围和 API 过滤 */}
          <div className={styles.filters}>
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>{t('monitor.time_range')}</span>
              <div className={styles.timeButtons}>
                {([1, 7, 14, 30] as TimeRange[]).map((range) => (
                  <button
                    key={range}
                    className={`${styles.timeButton} ${timeRange === range ? styles.active : ''}`}
                    onClick={() => handleTimeRangeChange(range)}
                  >
                    {range === 1 ? t('monitor.today') : t('monitor.last_n_days', { n: range })}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>{t('monitor.api_filter')}</span>
              <input
                type="text"
                className={styles.filterInput}
                placeholder={t('monitor.api_filter_placeholder')}
                value={apiFilter}
                onChange={(e) => setApiFilter(e.target.value)}
              />
              <Button variant="secondary" size="sm" onClick={handleApiFilterApply}>
                {t('monitor.apply')}
              </Button>
            </div>
          </div>

          {/* KPI 卡片 */}
          <KpiCards data={filteredData} loading={loading} />

          {/* 图表区域 */}
          <div className={styles.chartsGrid}>
            <ModelDistributionChart data={filteredData} loading={loading} isDark={isDark} timeRange={timeRange} />
            <DailyTrendChart data={filteredData} loading={loading} isDark={isDark} timeRange={timeRange} />
          </div>

          {/* 小时级图表 */}
          <DeferredSection label={t('monitor.hourly_cost.title')} minHeight={420}>
            <HourlyCostChart data={apiFilteredData} loading={loading} isDark={isDark} />
          </DeferredSection>

          {/* 请求日志 */}
          <DeferredSection label={t('monitor.logs.title')} minHeight={520}>
            <RequestLogs
              data={filteredData}
              loading={loading}
              providerMap={providerMap}
              providerTypeMap={providerTypeMap}
              sourceInfoMap={sourceInfoMap}
              authFileMap={authFileMap}
              apiFilter={apiFilter}
            />
          </DeferredSection>
        </>
      )}
    </div>
  );
}
