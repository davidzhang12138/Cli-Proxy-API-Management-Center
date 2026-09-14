/**
 * 额度页纯逻辑：文件归类、tab 过滤、计数、分页。
 * React-free —— 由 tests/quotaPageLogic.test.ts 直接消费。
 */

import type { AuthFileItem } from '@/types';
import { deriveAuthFileIdentity } from '@/features/authFiles/identity';
import { ANTIGRAVITY_CONFIG } from './providers/antigravity/data';
import { CLAUDE_CONFIG } from './providers/claude/data';
import { CODEX_CONFIG } from './providers/codex/data';
import { KIRO_CONFIG } from './providers/kiro/data';
import { KIMI_CONFIG } from './providers/kimi/data';
import { XAI_CONFIG } from './providers/xai/data';
import { FREEBUFF_CONFIG } from './providers/freebuff/data';
import { HYPER_CONFIG } from './providers/hyper/data';
import type { QuotaProviderType } from './providers/types';
import { QUOTA_TAB_ORDER, type QuotaSortMode, type QuotaTabId } from './constants';

const QUOTA_FILTER_MAP: Record<QuotaProviderType, (file: AuthFileItem) => boolean> = {
  antigravity: ANTIGRAVITY_CONFIG.filterFn,
  claude: CLAUDE_CONFIG.filterFn,
  codex: CODEX_CONFIG.filterFn,
  kiro: KIRO_CONFIG.filterFn,
  kimi: KIMI_CONFIG.filterFn,
  xai: XAI_CONFIG.filterFn,
  freebuff: FREEBUFF_CONFIG.filterFn,
  hyper: HYPER_CONFIG.filterFn,
};

export interface QuotaFileEntry {
  file: AuthFileItem;
  type: QuotaProviderType;
}

/**
 * 配额卡片与时间线沿用认证文件页的身份规则：优先显示邮箱 / 项目 ID，
 * 没有结构化身份时才回落到去掉 .json 后缀的文件名。
 */
export const resolveQuotaDisplayName = (file: AuthFileItem): string =>
  deriveAuthFileIdentity(file).primary;

export const resolveQuotaProviderType = (file: AuthFileItem): QuotaProviderType | null =>
  QUOTA_TAB_ORDER.find((type) => QUOTA_FILTER_MAP[type](file)) ?? null;

/**
 * 把文件列表归类为额度条目：不支持额度或已停用的文件被过滤，
 * 结果按 QUOTA_TAB_ORDER 分组排列（'全部' tab 的卡片顺序即由此决定）。
 */
export function classifyQuotaFiles(files: AuthFileItem[]): QuotaFileEntry[] {
  const groups = new Map<QuotaProviderType, QuotaFileEntry[]>(
    QUOTA_TAB_ORDER.map((type) => [type, []])
  );
  for (const file of files) {
    const type = resolveQuotaProviderType(file);
    if (!type) continue;
    groups.get(type)?.push({ file, type });
  }
  return QUOTA_TAB_ORDER.flatMap((type) => groups.get(type) ?? []);
}

export function filterEntriesByTab(entries: QuotaFileEntry[], tab: QuotaTabId): QuotaFileEntry[] {
  if (tab === 'all') return entries;
  return entries.filter((entry) => entry.type === tab);
}

/**
 * Whether a freshly fetched backend snapshot should replace the cached card
 * state for one credential.
 *
 * The backend re-probes credentials on its own schedule, so its snapshot can be
 * strictly newer than whatever the card last rendered — a hand-triggered
 * success from a moment ago, or a persisted entry from days back. Timestamps
 * decide that; status alone cannot, which is what let a persisted `success`
 * pin the card until the 7-day cache fallback expired.
 *
 * A snapshot carrying no `checked_at` cannot be ordered against the cache, so
 * it only fills gaps rather than displacing a timestamped success.
 */
export function shouldApplySnapshot(
  current: { status?: string; _cachedAt?: number } | undefined,
  snapshotCheckedAtMs: number | null,
  nowMs: number = Date.now()
): boolean {
  if (!current || current.status !== 'success') return true;
  if (snapshotCheckedAtMs === null) return false;
  const cachedAt = current._cachedAt;
  if (typeof cachedAt !== 'number' || !Number.isFinite(cachedAt)) return true;
  // Clamp to the local clock: a backend running ahead of the browser would
  // otherwise keep looking newer than the write it just caused, re-applying
  // the same snapshot on every render.
  return Math.min(snapshotCheckedAtMs, nowMs) > cachedAt;
}

/**
 * Order the grid by whichever credential recovers first.
 *
 * The instant is injected rather than read here: quota lives in the store and
 * arrives asynchronously, and keeping this function store-free is what makes
 * the ordering rules directly testable.
 *
 * Credentials with no instant — not loaded yet, failed, or reporting no
 * upcoming reset — sink to the bottom rather than sorting as "now". They keep
 * their incoming provider-grouped order, so the unloaded tail still reads like
 * the default view instead of an arbitrary shuffle. Because loading is
 * click-to-fetch, that tail is most of the list until the user asks for data.
 *
 * The original index is the final tiebreak, making stability an asserted
 * property rather than an assumption about the engine's sort.
 */
export function sortQuotaEntries(
  entries: QuotaFileEntry[],
  mode: QuotaSortMode,
  resolveNextRecoveryMs: (entry: QuotaFileEntry) => number | null
): QuotaFileEntry[] {
  if (mode !== 'soonest') return [...entries];

  // Decorate once — resolving pokes at provider-shaped state per entry.
  return entries
    .map((entry, index) => ({ entry, index, atMs: resolveNextRecoveryMs(entry) }))
    .sort((a, b) => {
      if (a.atMs === null && b.atMs === null) return a.index - b.index;
      if (a.atMs === null) return 1;
      if (b.atMs === null) return -1;
      return a.atMs - b.atMs || a.index - b.index;
    })
    .map((decorated) => decorated.entry);
}

export function buildTabCounts(entries: QuotaFileEntry[]): Record<string, number> {
  const counts: Record<string, number> = { all: entries.length };
  for (const type of QUOTA_TAB_ORDER) {
    counts[type] = 0;
  }
  for (const entry of entries) {
    counts[entry.type] += 1;
  }
  return counts;
}

/** 额度页只展示实际有可用凭证的提供商 tab，避免空 tab 占据横向空间。 */
export function buildVisibleTabIds(counts: Record<string, number>): QuotaTabId[] {
  return ['all', ...QUOTA_TAB_ORDER.filter((type) => (counts[type] ?? 0) > 0)];
}

export const isQuotaRefreshDisabled = (
  canRefresh: boolean,
  loading: boolean,
  resetting: boolean
): boolean => !canRefresh || loading || resetting;

export interface QuotaPagination<T> {
  pageItems: T[];
  currentPage: number;
  totalPages: number;
}

/** 页码越界时收敛到有效区间（列表缩短后停留在最后一页而不是空页）。 */
export function paginate<T>(items: T[], page: number, pageSize: number): QuotaPagination<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    pageItems: items.slice(start, start + pageSize),
    currentPage,
    totalPages,
  };
}
