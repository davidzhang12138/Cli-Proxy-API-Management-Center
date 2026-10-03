/**
 * 配置相关 API
 */

import { apiClient } from './client';
import type { Config } from '@/types';
import { normalizeConfigResponse } from './transformers';
import { getConfigValue } from './configValue';

export const configApi = {
  /**
   * 获取配置（会进行字段规范化）
   */
  async getConfig(): Promise<Config> {
    const raw = await apiClient.get('/config');
    return normalizeConfigResponse(raw);
  },

  async getRoutingStrategy(): Promise<string> {
    const raw = await getConfigValue<unknown>('/config/routing/strategy', 'round-robin');
    return typeof raw === 'string' && raw.trim() ? raw.trim() : 'round-robin';
  },

  updateRoutingStrategy: (strategy: string) => apiClient.put('/config/routing/strategy', strategy),

  /**
   * 请求日志开关
   */
  updateRequestLog: (enabled: boolean) =>
    apiClient.put('/config/observability/logs/request-log', enabled),
};
