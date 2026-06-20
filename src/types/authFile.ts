/**
 * 认证文件相关类型
 * 基于原项目 src/modules/auth-files.js
 */

import type { RecentRequestBucket } from '@/utils/recentRequests';
import type { UsageQuotaSnapshotPayload } from './quota';

export type AuthFileType =
  | 'qwen'
  | 'kimi'
  | 'kiro'
  | 'gemini'
  | 'aistudio'
  | 'claude'
  | 'codex'
  | 'antigravity'
  | 'xai'
  | 'iflow'
  | 'vertex'
  | 'empty'
  | 'unknown';

export interface AuthFileItem {
  name: string;
  type?: AuthFileType | string;
  provider?: string;
  size?: number;
  auth_index?: string | number | null;
  authIndex?: string | number | null;
  runtimeOnly?: boolean | string;
  disabled?: boolean;
  unavailable?: boolean;
  status?: string;
  statusMessage?: string;
  lastRefresh?: string | number;
  modified?: number;
  success?: unknown;
  failed?: unknown;
  recent_requests?: RecentRequestBucket[];
  recentRequests?: RecentRequestBucket[];
  usage_quota?: UsageQuotaSnapshotPayload | null;
  usageQuota?: UsageQuotaSnapshotPayload | null;
  [key: string]: unknown;
}

export interface AuthFilesPagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface AuthFilesCategoryItem {
  name: string;
  count: number;
}

export interface AuthFilesCategories {
  providers?: AuthFilesCategoryItem[];
  sources?: AuthFilesCategoryItem[];
  statuses?: AuthFilesCategoryItem[];
}

export interface AuthFilesResponse {
  files: AuthFileItem[];
  total?: number;
  pagination?: AuthFilesPagination;
  categories?: AuthFilesCategories;
}

export interface AuthFilesListOptions {
  page?: number;
  pageSize?: number;
  perPage?: number;
  provider?: string;
  type?: string;
  source?: string;
  status?: string;
  search?: string;
  quotaFilter?: string;
  sort?: string;
  problemOnly?: boolean;
}

export interface AuthQuotaEntry {
  id?: string;
  auth_index?: string;
  authIndex?: string;
  provider?: string;
  label?: string;
  account_type?: string;
  accountType?: string;
  account?: string;
  status?: string;
  disabled?: boolean;
  unavailable?: boolean;
  success?: unknown;
  failed?: unknown;
  usage_quota?: UsageQuotaSnapshotPayload | null;
  usageQuota?: UsageQuotaSnapshotPayload | null;
}

export interface AuthQuotasResponse {
  auths?: AuthQuotaEntry[];
}

export interface RefreshAuthQuotasRequest {
  all?: boolean;
  ids?: string[];
  auth_indexes?: string[];
  authIndexes?: string[];
}

export interface RefreshAuthQuotasResponse extends AuthQuotasResponse {
  refreshed?: number;
}
