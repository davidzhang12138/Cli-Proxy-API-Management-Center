/**
 * 版本相关 API
 */

import { apiClient } from './client';
import type { ServerRuntimeKind } from '@/types';

export const versionApi = {
  checkLatest: () => apiClient.get<Record<string, unknown>>('/latest-version'),

  async detectRuntimeKind(): Promise<ServerRuntimeKind> {
    return 'cpa';
  }
};
