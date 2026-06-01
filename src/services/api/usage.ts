/**
 * 使用统计相关 API
 */

import { apiClient } from './client';
import { computeKeyStats, KeyStats, type UsageTimeRange } from '@/utils/usage';

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
