/**
 * 使用统计相关 API
 */

import { apiClient } from './client';
import { computeKeyStats, KeyStats, type ModelPrice, type UsageTimeRange } from '@/utils/usage';

const USAGE_TIMEOUT_MS = 60 * 1000;

export type UsageQueryParams = {
  all?: boolean;
  date?: string;
  day?: string;
  days?: number;
  start?: string;
  start_date?: string;
  from?: string;
  since?: string;
  end?: string;
  end_date?: string;
  to?: string;
  until?: string;
  range?: 'all' | string;
};

export type AuthUsageQueryParams = {
  account?: string;
  email?: string;
  source?: string;
  auth_index?: string;
  authIndex?: string;
  id?: string;
  name?: string;
  file?: string;
  filename?: string;
  since?: string;
  start?: string;
  start_date?: string;
  from?: string;
  until?: string;
  end?: string;
  end_date?: string;
  to?: string;
  include_details?: boolean;
};

export interface AuthUsageTokenStats {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  total_tokens: number;
}

export interface AuthUsageDetail {
  timestamp: string;
  latency_ms: number;
  source: string;
  auth_index: string;
  tokens: AuthUsageTokenStats;
  failed: boolean;
  api_key: string;
  model: string;
}

export interface AuthUsageSummary extends AuthUsageTokenStats {
  total_requests: number;
  success_count: number;
  failure_count: number;
}

export interface AuthUsageGroupSummary {
  total_requests: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  failed?: number;
  details?: AuthUsageDetail[];
}

export interface AuthUsageResponse {
  auth: {
    id: string;
    name: string;
    auth_index: string;
    provider: string;
    account_type: string;
    account: string;
  };
  window_start: string;
  window_end: string;
  window_source: string;
  summary: AuthUsageSummary;
  models: Record<string, AuthUsageGroupSummary>;
  api_keys: Record<string, AuthUsageGroupSummary>;
}

export interface ModelPricesResponse {
  'model-prices'?: Record<string, ModelPrice>;
  model_prices?: Record<string, ModelPrice>;
  prices?: Record<string, ModelPrice>;
}

export interface UsageExportPayload {
  version?: number;
  exported_at?: string;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UsageImportResponse {
  added?: number;
  skipped?: number;
  total_requests?: number;
  failed_requests?: number;
  [key: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const normalizeModelPricesResponse = (response: unknown): Record<string, ModelPrice> => {
  const payload = isRecord(response)
    ? response.model_prices ?? response.prices ?? response['model-prices'] ?? response
    : null;
  if (!isRecord(payload)) {
    return {};
  }

  const normalized: Record<string, ModelPrice> = {};
  Object.entries(payload).forEach(([model, price]) => {
    if (!model || !isRecord(price)) {
      return;
    }

    const prompt = Number(price.prompt);
    const completion = Number(price.completion);
    const cache = Number(price.cache);
    if (
      !Number.isFinite(prompt) &&
      !Number.isFinite(completion) &&
      !Number.isFinite(cache)
    ) {
      return;
    }

    normalized[model] = {
      prompt: Number.isFinite(prompt) && prompt >= 0 ? prompt : 0,
      completion: Number.isFinite(completion) && completion >= 0 ? completion : 0,
      cache:
        Number.isFinite(cache) && cache >= 0
          ? cache
          : Number.isFinite(prompt) && prompt >= 0
            ? prompt
            : 0,
    };
  });

  return normalized;
};

export const buildUsageQueryParams = (
  range: UsageTimeRange,
  now: Date = new Date()
): UsageQueryParams => {
  if (range === 'all') {
    return { all: true };
  }

  const hours = range === '7h' ? 7 : range === '24h' ? 24 : 7 * 24;
  const end = new Date(now.getTime());
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
};

export const usageApi = {
  /**
   * 获取使用统计原始数据
   */
  getUsage: (params?: UsageQueryParams) =>
    apiClient.get<Record<string, unknown>>('/usage', {
      timeout: USAGE_TIMEOUT_MS,
      params,
    }),

  /**
   * 获取单个认证账号在当前配额窗口内的用量
   */
  getAuthUsage: (params: AuthUsageQueryParams) =>
    apiClient.get<AuthUsageResponse>('/auth-usage', {
      timeout: USAGE_TIMEOUT_MS,
      params,
    }),

  /**
   * 获取后端保存的模型价格配置
   */
  getModelPrices: () =>
    apiClient.get<ModelPricesResponse>('/model-prices', {
      timeout: USAGE_TIMEOUT_MS,
    }),

  /**
   * 替换后端模型价格配置
   */
  replaceModelPrices: (prices: Record<string, ModelPrice>) =>
    apiClient.put<ModelPricesResponse>('/model-prices', {
      model_prices: prices,
    }, {
      timeout: USAGE_TIMEOUT_MS,
    }),

  /**
   * 导出使用统计快照
   */
  exportUsage: () => apiClient.get<UsageExportPayload>('/usage/export', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导入使用统计快照
   */
  importUsage: (payload: unknown) =>
    apiClient.post<UsageImportResponse>('/usage/import', payload, { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 计算密钥成功/失败统计，必要时会先获取 usage 数据
   */
  async getKeyStats(usageData?: unknown): Promise<KeyStats> {
    let payload = usageData;
    if (!payload) {
      const response = await apiClient.get<Record<string, unknown>>('/usage', {
        timeout: USAGE_TIMEOUT_MS,
        params: { all: true } satisfies UsageQueryParams,
      });
      payload = response?.usage ?? response;
    }
    return computeKeyStats(payload);
  }
};
