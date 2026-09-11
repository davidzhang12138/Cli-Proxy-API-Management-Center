/**
 * 配置相关 API
 */

import { apiClient } from './client';
import type { Config } from '@/types';
import { normalizeConfigResponse } from './transformers';

export const configApi = {
  /**
   * 获取配置（会进行字段规范化）
   */
  async getConfig(): Promise<Config> {
    const raw = await apiClient.get('/config');
    return normalizeConfigResponse(raw);
  },

  async getRoutingStrategy(): Promise<string> {
    const raw = await apiClient.get<{ strategy?: unknown }>('/routing/strategy');
    return typeof raw?.strategy === 'string' && raw.strategy.trim()
      ? raw.strategy.trim()
      : 'round-robin';
  },

  updateRoutingStrategy: (strategy: string) =>
    apiClient.put('/routing/strategy', { value: strategy }),

  /**
   * 请求日志开关
   */
  updateRequestLog: (enabled: boolean) => apiClient.put('/request-log', { value: enabled }),
};
