/**
 * 认证文件相关类型
 * 基于原项目 src/modules/auth-files.js
 */

import type { RecentRequestBucket } from '@/utils/recentRequests';
import type { UsageQuotaSnapshotPayload } from './quota';

export type AuthFileType =
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
  | 'freebuff'
  | 'hyper'
  | 'keelcode'
  | 'context-code'
  | 'cline'
  | 'cline-pass'
  | 'empty'
  | 'unknown';

export interface AuthFileItem {
  name: string;
  type?: AuthFileType | string;
  provider?: string;
  /**
   * 凭证账号邮箱（后端 auth_files 两条分支都会填：磁盘扫描读 JSON 的 email 字段，
   * 注册表读 Metadata/Attributes）。卡片主行用它领衔。
   * 注意：后端还会下发 account/account_type，但 api-key 类凭证的 account 就是
   * API key 本身（AccountInfo() → return "api_key", apiKey），**绝不可用于展示或搜索**。
   */
  email?: string;
  /** GCP / Vertex 项目 ID，账号邮箱缺失时作为身份回落。 */
  projectId?: string;
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
  priority?: number;
  weight?: number;
  note?: string;
  success?: unknown;
  failed?: unknown;
  /** 归一化后的累计成功/失败计数（由 API 边界从 success/failed 生字段填充）。 */
  successCount?: number;
  failureCount?: number;
  recent_requests?: RecentRequestBucket[];
  recentRequests?: RecentRequestBucket[];
  usage_quota?: UsageQuotaSnapshotPayload | null;
  usageQuota?: UsageQuotaSnapshotPayload | null;
  quota_supported?: boolean | string | number | null;
  quotaSupported?: boolean | string | number | null;
  quota_status?: string | null;
  quotaStatus?: string | null;
  quota_remaining_ratio?: number | string | null;
  quotaRemainingRatio?: number | string | null;
  quota_next_reset?: string | number | null;
  quotaNextReset?: string | number | null;
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
  quota_supported?: boolean | string | number | null;
  quotaSupported?: boolean | string | number | null;
  quota_status?: string | null;
  quotaStatus?: string | null;
  quota_remaining_ratio?: number | string | null;
  quotaRemainingRatio?: number | string | null;
  quota_next_reset?: string | number | null;
  quotaNextReset?: string | number | null;
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
