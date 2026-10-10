/**
 * 认证文件与 OAuth 排除模型相关 API
 */

import { apiClient } from './client';
import type {
  AuthFilesListOptions,
  AuthFilesResponse,
  AuthQuotaEntry,
  AuthQuotasResponse,
  RefreshAuthQuotasRequest,
  RefreshAuthQuotasResponse,
} from '@/types/authFile';
import { getConfigValue, guardConfigConnection } from './configValue';
import { isRecord } from '@/utils/helpers';
import type { OAuthModelAliasEntry } from '@/types';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import {
  normalizeRecentRequestAuthIndex,
  normalizeRecentRequestBuckets,
  normalizeUsageTotal,
} from '@/utils/recentRequests';
import { parseTimestampMs } from '@/utils/timestamp';
import { normalizeAuthFileCooldowns, normalizeCooldownTimestamp } from './authFileCooldowns';

type AuthFileStatusResponse = { status: string; disabled: boolean };
export type AuthFileModelCheckResult = {
  available: boolean;
  status_code: number;
  message?: string;
  latency_ms: number;
};
export type AuthFileLookup = { name: string; authIndex?: string };
type AuthFileEntry = AuthFilesResponse['files'][number];
export type AuthFileFieldsPatch = {
  request_retry?: number | null;
  model_aliases?: Array<{
    name: string;
    alias: string;
    fork?: boolean;
    'display-name'?: string;
    'force-mapping'?: boolean;
  }>;
  request_scoped_errors?: Array<{
    status?: number;
    match?: string[];
    'match-regexr'?: string[];
    action?: string;
  }>;
  prefix?: string;
  proxy_url?: string;
  headers?: Record<string, string>;
  priority?: number;
  model_priorities?: Record<string, number>;
  weight?: number | null;
  disable_cooling?: boolean;
  'disable-cooling'?: boolean;
  websockets?: boolean;
  using_api?: boolean;
  note?: string;
  excluded_models?: string[];
  'excluded-models'?: string[];
  expired?: string;
};
type AuthFileBatchFailure = { name: string; error: string };
type AuthFileBatchUploadResponse = {
  status?: string;
  uploaded?: number;
  files?: unknown;
  failed?: unknown;
};
type AuthFileBatchDeleteResponse = {
  status?: string;
  deleted?: number;
  files?: unknown;
  failed?: unknown;
};
type AuthFileBatchUploadResult = {
  status: string;
  uploaded: number;
  files: string[];
  failed: AuthFileBatchFailure[];
};
type AuthFileBatchDeleteResult = {
  status: string;
  deleted: number;
  files: string[];
  failed: AuthFileBatchFailure[];
};

export const AUTH_FILE_INVALID_JSON_OBJECT_ERROR = 'AUTH_FILE_INVALID_JSON_OBJECT';

const normalizeRequestedAuthFileNames = (names: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  names.forEach((name) => {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
};

const normalizeBatchFileNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return normalizeRequestedAuthFileNames(value.map((item) => String(item ?? '')));
};

const buildAuthFilesListParams = (options?: AuthFilesListOptions): Record<string, unknown> => {
  if (!options) return {};
  const params: Record<string, unknown> = {};
  const name = options.name?.trim();
  if (name) params.name = name;
  const authIndex = options.authIndex?.trim();
  if (authIndex) params.auth_index = authIndex;
  if (typeof options.page === 'number' && Number.isFinite(options.page)) {
    params.page = Math.max(1, Math.round(options.page));
  }
  const pageSize =
    typeof options.pageSize === 'number' && Number.isFinite(options.pageSize)
      ? options.pageSize
      : typeof options.perPage === 'number' && Number.isFinite(options.perPage)
        ? options.perPage
        : null;
  if (pageSize !== null) {
    params.page_size = Math.max(1, Math.round(pageSize));
  }
  const provider = options.provider?.trim();
  if (provider) params.provider = provider;
  const type = options.type?.trim();
  if (type) params.type = type;
  const source = options.source?.trim();
  if (source) params.source = source;
  const status = options.status?.trim();
  if (status) params.status = status;
  const search = options.search?.trim();
  if (search) params.q = search;
  const quotaFilter = options.quotaFilter?.trim();
  if (quotaFilter) params.quota_filter = quotaFilter;
  const sort = options.sort?.trim();
  if (sort) params.sort = sort;
  if (options.problemOnly === true) params.problem_only = true;
  return params;
};

const normalizeBatchFailures = (value: unknown): AuthFileBatchFailure[] => {
  if (!Array.isArray(value)) return [];

  return value.reduce<AuthFileBatchFailure[]>((result, item) => {
    if (!item || typeof item !== 'object') return result;
    const entry = item as Record<string, unknown>;
    const name = String(entry.name ?? '').trim();
    const error =
      typeof entry.error === 'string'
        ? entry.error.trim()
        : typeof entry.message === 'string'
          ? entry.message.trim()
          : '';

    if (!name && !error) return result;
    result.push({ name, error: error || 'Unknown error' });
    return result;
  }, []);
};

const normalizeBatchUploadResponse = (
  payload: AuthFileBatchUploadResponse | undefined,
  requestedNames: string[]
): AuthFileBatchUploadResult => {
  const failed = normalizeBatchFailures(payload?.failed);
  const filesFromPayload = normalizeBatchFileNames(payload?.files);
  // Backend single-file success path returns only {status:"ok"} (auth_files.go:680).
  // Derive count + names from the request when no failures and counts are absent.
  const inferFromRequest = payload?.uploaded === undefined && failed.length === 0;
  return {
    status: payload?.status ?? (failed.length > 0 ? 'partial' : 'ok'),
    uploaded: payload?.uploaded ?? (inferFromRequest ? requestedNames.length : 0),
    files: filesFromPayload.length ? filesFromPayload : inferFromRequest ? [...requestedNames] : [],
    failed,
  };
};

const normalizeBatchDeleteResponse = (
  payload: AuthFileBatchDeleteResponse | undefined,
  requestedNames: string[]
): AuthFileBatchDeleteResult => {
  const failed = normalizeBatchFailures(payload?.failed);
  const filesFromPayload = normalizeBatchFileNames(payload?.files);
  // Backend single-name delete returns only {status:"ok"} (auth_files.go:794).
  const inferFromRequest = payload?.deleted === undefined && failed.length === 0;
  return {
    status: payload?.status ?? (failed.length > 0 ? 'partial' : 'ok'),
    deleted: payload?.deleted ?? (inferFromRequest ? requestedNames.length : 0),
    files: filesFromPayload.length ? filesFromPayload : inferFromRequest ? [...requestedNames] : [],
    failed,
  };
};

const readTextField = (entry: AuthFileEntry, key: string): string => {
  const value = entry[key];
  return typeof value === 'string' ? value.trim() : '';
};

const readQuotaTextField = (entry: AuthQuotaEntry, key: keyof AuthQuotaEntry): string => {
  const value = entry[key];
  return typeof value === 'string' ? value.trim() : '';
};

type AuthQuotaSummarySource = Pick<
  AuthQuotaEntry,
  | 'quota_supported'
  | 'quotaSupported'
  | 'quota_status'
  | 'quotaStatus'
  | 'quota_remaining_ratio'
  | 'quotaRemainingRatio'
  | 'quota_next_reset'
  | 'quotaNextReset'
>;

const buildAuthQuotaSummaryFields = (entry: AuthQuotaSummarySource): Partial<AuthFileEntry> => {
  const quotaSupported =
    entry.quota_supported !== undefined ? entry.quota_supported : entry.quotaSupported;
  const quotaStatus = entry.quota_status !== undefined ? entry.quota_status : entry.quotaStatus;
  const quotaRemainingRatio =
    entry.quota_remaining_ratio !== undefined
      ? entry.quota_remaining_ratio
      : entry.quotaRemainingRatio;
  const quotaNextReset =
    entry.quota_next_reset !== undefined ? entry.quota_next_reset : entry.quotaNextReset;

  return {
    ...(quotaSupported !== undefined ? { quota_supported: quotaSupported, quotaSupported } : {}),
    ...(quotaStatus !== undefined ? { quota_status: quotaStatus, quotaStatus } : {}),
    ...(quotaRemainingRatio !== undefined
      ? { quota_remaining_ratio: quotaRemainingRatio, quotaRemainingRatio }
      : {}),
    ...(quotaNextReset !== undefined ? { quota_next_reset: quotaNextReset, quotaNextReset } : {}),
  };
};

const readDateField = (entry: AuthFileEntry): number => {
  const candidates = [entry['modtime'], entry['updated_at'], entry['last_refresh']];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) {
        return asNumber < 1e12 ? asNumber * 1000 : asNumber;
      }
      const parsed = parseTimestampMs(trimmed);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
};

const isRuntimeOnlyEntry = (entry: AuthFileEntry): boolean => entry['runtime_only'] === true;

const hasMeaningfulValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const countMeaningfulFields = (entry: AuthFileEntry): number =>
  Object.values(entry).reduce<number>(
    (count, value) => count + (hasMeaningfulValue(value) ? 1 : 0),
    0
  );

const authFilePriorityScore = (entry: AuthFileEntry): number => {
  let score = 0;
  if (readTextField(entry, 'source').toLowerCase() === 'file') score += 32;
  if (readTextField(entry, 'path')) score += 16;
  if (!isRuntimeOnlyEntry(entry)) score += 8;
  if (entry.disabled !== true) score += 4;
  if (readDateField(entry) > 0) score += 2;
  return score;
};

const compareAuthFileEntries = (left: AuthFileEntry, right: AuthFileEntry): number => {
  const scoreDiff = authFilePriorityScore(right) - authFilePriorityScore(left);
  if (scoreDiff !== 0) return scoreDiff;

  const dateDiff = readDateField(right) - readDateField(left);
  if (dateDiff !== 0) return dateDiff;

  const fieldDiff = countMeaningfulFields(right) - countMeaningfulFields(left);
  if (fieldDiff !== 0) return fieldDiff;

  return 0;
};

const mergeAuthFileEntries = (entries: AuthFileEntry[]): AuthFileEntry => {
  const [primary, ...rest] = [...entries].sort(compareAuthFileEntries);
  const merged: AuthFileEntry = { ...primary };

  rest.forEach((entry) => {
    Object.entries(entry).forEach(([key, value]) => {
      // Cooldown snapshots are atomic: [] and null are meaningful, not missing fields.
      if (key === 'cooldowns' && Object.prototype.hasOwnProperty.call(merged, key)) return;
      if (!hasMeaningfulValue(merged[key]) && hasMeaningfulValue(value)) {
        merged[key] = value;
      }
    });
  });

  return merged;
};

const INTEGER_STRING_PATTERN = /^[+-]?\d+$/;

const readIntegerField = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || !INTEGER_STRING_PATTERN.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const readIntegerMap = (value: unknown): Record<string, number> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, number> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
    const parsed = readIntegerField(raw);
    if (key.trim() && parsed !== undefined) result[key.trim()] = parsed;
  });
  return Object.keys(result).length > 0 ? result : undefined;
};

const readRuntimeOnlyField = (entry: AuthFileEntry): boolean => {
  const raw = entry['runtime_only'] ?? entry.runtimeOnly;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
};

const readBooleanField = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return undefined;
};

/**
 * 契约边界归一化：把后端 kebab/snake_case 生字段填充到 AuthFileItem 声明的
 * camelCase 字段上。原始字段全部透传——quota resolvers 仍直接读
 * plan_type / id_token / metadata / attributes 等生字段。
 */
const normalizeAuthFileEntry = (
  entry: AuthFileEntry,
  observedAt: string | undefined,
  receivedAtMs: number
): AuthFileEntry => {
  const declaredStatusMessage =
    typeof entry.statusMessage === 'string' ? entry.statusMessage.trim() : '';
  const statusMessage = readTextField(entry, 'status_message') || declaredStatusMessage;
  const note = readTextField(entry, 'note');
  const email = readTextField(entry, 'email');
  // account / account_type 故意不归一化：api-key 类凭证的 account 就是 API key 本身
  // （sdk/cliproxy/auth/types.go AccountInfo），不能进入展示与搜索路径。
  const projectId = readTextField(entry, 'project_id');
  const modified = readDateField(entry);
  const priority = readIntegerField(entry['priority']);
  const modelPriorities = readIntegerMap(entry['model_priorities'] ?? entry['model-priorities']);
  const weight = readIntegerField(entry['weight']);
  const supportsQuota = readBooleanField(entry['supports_quota'] ?? entry.supportsQuota);
  const quotaProvider = readTextField(entry, 'quota_provider') || readTextField(entry, 'quotaProvider');

  return {
    ...entry,
    ...buildAuthQuotaSummaryFields(entry),
    cooldownSnapshot: normalizeAuthFileCooldowns(entry.cooldowns, observedAt, receivedAtMs),
    runtimeOnly: readRuntimeOnlyField(entry),
    authIndex: normalizeRecentRequestAuthIndex(entry['auth_index'] ?? entry.authIndex),
    ...(supportsQuota !== undefined ? { supportsQuota } : {}),
    ...(quotaProvider ? { quotaProvider } : {}),
    recentRequests: normalizeRecentRequestBuckets(entry.recent_requests ?? entry.recentRequests),
    successCount: normalizeUsageTotal(entry.success),
    failureCount: normalizeUsageTotal(entry.failed),
    ...(statusMessage ? { statusMessage } : {}),
    ...(modified > 0 ? { modified } : {}),
    priority,
    ...(modelPriorities ? { modelPriorities } : {}),
    weight,
    ...(note ? { note } : {}),
    ...(email ? { email } : {}),
    ...(projectId ? { projectId } : {}),
  };
};

export const normalizeAuthFilesResponse = (
  payload: AuthFilesResponse,
  receivedAtMs = Date.now()
): AuthFilesResponse => {
  const observedAt = normalizeCooldownTimestamp(payload?.observed_at);
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const grouped = new Map<string, AuthFileEntry[]>();

  files.forEach((entry) => {
    const name = readTextField(entry, 'name');
    const key = name
      ? getQuotaCacheKey({
          ...entry,
          name,
          authIndex: normalizeRecentRequestAuthIndex(entry['auth_index'] ?? entry.authIndex),
        })
      : JSON.stringify(entry);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(entry);
      return;
    }
    grouped.set(key, [entry]);
  });

  const normalizedFiles = Array.from(grouped.values()).map((entries) =>
    normalizeAuthFileEntry(mergeAuthFileEntries(entries), observedAt, receivedAtMs)
  );
  normalizedFiles.sort((left, right) => {
    const nameOrder = readTextField(left, 'name').localeCompare(
      readTextField(right, 'name'),
      undefined,
      { sensitivity: 'accent' }
    );
    if (nameOrder !== 0) return nameOrder;
    return String(left.authIndex ?? '').localeCompare(String(right.authIndex ?? ''), undefined, {
      sensitivity: 'accent',
    });
  });

  return {
    ...payload,
    observedAt,
    files: normalizedFiles,
    total: payload?.pagination?.total ?? payload?.total ?? normalizedFiles.length,
  };
};

const authFileMatchKeys = (entry: AuthFileEntry): string[] => {
  const keys = [
    readTextField(entry, 'id'),
    readTextField(entry, 'auth_index'),
    String(entry.authIndex ?? '').trim(),
    readTextField(entry, 'name'),
  ];
  return keys.filter(Boolean);
};

const authQuotaMatchKeys = (entry: AuthQuotaEntry): string[] => {
  const keys = [
    readQuotaTextField(entry, 'id'),
    readQuotaTextField(entry, 'auth_index'),
    readQuotaTextField(entry, 'authIndex'),
  ];
  return keys.filter(Boolean);
};

const buildAuthFileFromQuotaEntry = (entry: AuthQuotaEntry): AuthFileEntry | null => {
  const provider = readQuotaTextField(entry, 'provider');
  const usageQuota = entry.usage_quota ?? entry.usageQuota;
  if (!provider || !usageQuota) return null;

  const id = readQuotaTextField(entry, 'id');
  const authIndex =
    readQuotaTextField(entry, 'auth_index') || readQuotaTextField(entry, 'authIndex');
  const label = readQuotaTextField(entry, 'label');
  const account = readQuotaTextField(entry, 'account');
  const name = label || account || authIndex || id;
  if (!name) return null;

  return {
    id,
    auth_index: authIndex,
    authIndex,
    name,
    type: provider,
    provider,
    label,
    account_type:
      readQuotaTextField(entry, 'account_type') || readQuotaTextField(entry, 'accountType'),
    account,
    status: readQuotaTextField(entry, 'status'),
    disabled: entry.disabled,
    unavailable: entry.unavailable,
    runtimeOnly: true,
    source: 'memory',
    size: 0,
    success: entry.success,
    failed: entry.failed,
    usage_quota: usageQuota,
    ...buildAuthQuotaSummaryFields(entry),
  };
};

export const mergeAuthQuotaSnapshots = (
  filesPayload: AuthFilesResponse,
  quotasPayload: AuthQuotasResponse | null,
  options: { includeSynthetic?: boolean } = {}
): AuthFilesResponse => {
  const includeSynthetic = options.includeSynthetic !== false;
  const normalized = normalizeAuthFilesResponse(filesPayload);
  const quotaEntries = Array.isArray(quotasPayload?.auths) ? quotasPayload.auths : [];
  if (quotaEntries.length === 0) return normalized;

  const files = [...normalized.files];
  const byKey = new Map<string, AuthFileEntry>();
  files.forEach((file) => {
    authFileMatchKeys(file).forEach((key) => byKey.set(key, file));
  });

  quotaEntries.forEach((entry) => {
    const usageQuota = entry.usage_quota ?? entry.usageQuota;
    const matched = authQuotaMatchKeys(entry)
      .map((key) => byKey.get(key))
      .find((file): file is AuthFileEntry => Boolean(file));

    if (matched) {
      Object.assign(matched, buildAuthQuotaSummaryFields(entry));
      if (!usageQuota) return;
      matched.usage_quota = usageQuota;
      if (!hasMeaningfulValue(matched.success)) matched.success = entry.success;
      if (!hasMeaningfulValue(matched.failed)) matched.failed = entry.failed;
      if (!hasMeaningfulValue(matched.status)) matched.status = entry.status;
      if (matched.disabled === undefined) matched.disabled = entry.disabled;
      if (matched.unavailable === undefined) matched.unavailable = entry.unavailable;
      return;
    }

    if (!usageQuota) return;
    if (!includeSynthetic) return;
    const synthetic = buildAuthFileFromQuotaEntry(entry);
    if (!synthetic) return;
    files.push(synthetic);
    authFileMatchKeys(synthetic).forEach((key) => byKey.set(key, synthetic));
  });

  files.sort((left, right) =>
    readTextField(left, 'name').localeCompare(readTextField(right, 'name'), undefined, {
      sensitivity: 'accent',
    })
  );

  return {
    ...normalized,
    files,
    total: includeSynthetic
      ? files.length
      : (normalized.pagination?.total ?? normalized.total ?? files.length),
  };
};

const getAuthQuotasIfAvailable = async (): Promise<AuthQuotasResponse | null> => {
  try {
    return await apiClient.get<AuthQuotasResponse>(apiClient.getExtensionUrl('/auth-quotas'), {
      params: { all: true },
    });
  } catch {
    return null;
  }
};

const inFlightAuthFilesListRequests = new Map<string, Promise<AuthFilesResponse>>();

const buildAuthFilesListCacheKey = (params: Record<string, unknown>): string => {
  const normalized = Object.keys(params)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = params[key];
      return result;
    }, {});
  return `${apiClient.getConnectionRevision()}:${JSON.stringify(normalized)}`;
};

const parseAuthFileJsonObject = (rawText: string): Record<string, unknown> => {
  const trimmed = rawText.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(AUTH_FILE_INVALID_JSON_OBJECT_ERROR);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(AUTH_FILE_INVALID_JSON_OBJECT_ERROR);
  }

  return { ...(parsed as Record<string, unknown>) };
};

const saveAuthFileText = async (name: string, text: string) => {
  const file = new File([text], name, { type: 'application/json' });
  await authFilesApi.upload(file);
};

export const isAuthFileInvalidJsonObjectError = (err: unknown): boolean =>
  err instanceof Error && err.message === AUTH_FILE_INVALID_JSON_OBJECT_ERROR;

const normalizeOauthExcludedModels = (payload: unknown): Record<string, string[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const source = payload as Record<string, unknown>;

  const result: Record<string, string[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([provider, models]) => {
    const key = normalizeOAuthProviderKey(String(provider ?? ''));
    if (!key) return;

    const rawList = Array.isArray(models)
      ? models
      : typeof models === 'string'
        ? models.split(/[\n,]+/)
        : [];

    const normalized = result[key] ?? [];
    const seen = new Set(normalized.map((item) => item.toLowerCase()));
    rawList.forEach((item) => {
      const trimmed = String(item ?? '').trim();
      if (!trimmed) return;
      const modelKey = trimmed.toLowerCase();
      if (seen.has(modelKey)) return;
      seen.add(modelKey);
      normalized.push(trimmed);
    });

    result[key] = normalized;
  });

  return result;
};

export const normalizeOauthModelAlias = (
  payload: unknown
): Record<string, OAuthModelAliasEntry[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const source = payload as Record<string, unknown>;

  const result: Record<string, OAuthModelAliasEntry[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([channel, mappings]) => {
    const key = normalizeOAuthProviderKey(String(channel ?? ''));
    if (!key) return;
    if (!Array.isArray(mappings)) return;

    const normalized = result[key] ?? [];
    const seenAlias = new Set(normalized.map((entry) => entry.alias.toLowerCase()));
    mappings
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const entry = item as Record<string, unknown>;
        const name = String(entry.name ?? entry.id ?? entry.model ?? '').trim();
        const alias = String(entry.alias ?? '').trim();
        if (!name || !alias) return null;
        const fork = entry.fork === true;
        const forceMappingValue = entry['force-mapping'] ?? entry.forceMapping;
        const normalizedEntry: OAuthModelAliasEntry = { name, alias };
        if (fork) normalizedEntry.fork = true;
        if (typeof forceMappingValue === 'boolean') {
          normalizedEntry.forceMapping = forceMappingValue;
        }
        return normalizedEntry;
      })
      .filter(Boolean)
      .forEach((entry) => {
        const aliasEntry = entry as OAuthModelAliasEntry;
        const aliasKey = aliasEntry.alias.toLowerCase();
        if (seenAlias.has(aliasKey)) return;
        seenAlias.add(aliasKey);
        normalized.push(aliasEntry);
      });

    if (normalized.length) {
      result[key] = normalized;
    }
  });

  return result;
};

export const serializeOauthModelAliases = (
  aliases: OAuthModelAliasEntry[]
): Array<Record<string, unknown>> =>
  aliases.map((entry) => {
    const payload: Record<string, unknown> = {
      name: entry.name,
      alias: entry.alias,
    };
    if (entry.fork) payload.fork = true;
    if (typeof entry.forceMapping === 'boolean') {
      payload['force-mapping'] = entry.forceMapping;
    }
    return payload;
  });

const OAUTH_MODEL_ALIAS_ENDPOINT = '/config/oauth/model-alias';
const OAUTH_EXCLUDED_MODELS_ENDPOINT = '/config/oauth/excluded-models';

const oauthMapWrites = new Map<string, Promise<void>>();

// v8 replaces a whole provider map. Serialize local read/modify/write operations
// so a batch cannot overwrite another provider's changes with an older snapshot.
function queueOauthMapWrite(path: string, write: () => Promise<void>): Promise<void> {
  const assertConnection = guardConfigConnection();
  const queueKey = `${apiClient.getConnectionRevision()}:${path}`;
  const previous = oauthMapWrites.get(queueKey) ?? Promise.resolve();
  const pending = previous.then(async () => {
    assertConnection();
    await write();
  });
  const settled = pending.then(
    () => undefined,
    () => undefined
  );
  oauthMapWrites.set(queueKey, settled);
  void settled.then(() => {
    if (oauthMapWrites.get(queueKey) === settled) oauthMapWrites.delete(queueKey);
  });
  return pending;
}

async function updateOauthProviderMap(path: string, provider: string, value?: unknown) {
  const key = normalizeOAuthProviderKey(provider);
  if (!key) throw new Error('Invalid OAuth provider');
  return queueOauthMapWrite(path, async () => {
    const assertConnection = guardConfigConnection();
    const current = await getConfigValue<unknown>(path, {});
    assertConnection();
    if (current != null && !isRecord(current)) throw new Error('Invalid OAuth configuration map');
    // v8 reads preserve YAML key spelling. The UI groups normalized providers, so
    // remove every spelling of this provider, preserving unrelated entries verbatim.
    const next = Object.fromEntries(
      Object.entries(current ?? {}).filter(([name]) => normalizeOAuthProviderKey(name) !== key)
    );
    if (value !== undefined) {
      Object.defineProperty(next, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    await apiClient.put(path, next);
  });
}

export interface AuthFileRefreshResult {
  id: string;
  success: boolean;
  error?: string;
}

export const normalizeAuthFileRefreshResults = (payload: unknown): AuthFileRefreshResult[] => {
  if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.results)) {
    throw new Error('Invalid credential refresh response');
  }
  return payload.results.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      !entry.id.trim() ||
      typeof entry.success !== 'boolean'
    ) {
      throw new Error('Invalid credential refresh result');
    }
    // Whitelist result fields: never expose credential metadata or tokens.
    return {
      id: entry.id,
      success: entry.success,
      ...(!entry.success && typeof entry.error === 'string' ? { error: entry.error } : {}),
    };
  });
};

export interface AuthFileCooldownResetResponse {
  status: 'ok';
  auth_index: string;
  models: string[];
}

export const authFilesApi = {
  list: async (options?: AuthFilesListOptions) => {
    const params = buildAuthFilesListParams(options);
    const mergeQuotaSnapshots = Object.keys(params).length === 0;
    const cacheKey = buildAuthFilesListCacheKey(params);
    const inFlight = inFlightAuthFilesListRequests.get(cacheKey);
    if (inFlight) return inFlight;

    const request = (async () => {
      const [filesPayload, quotasPayload] = await Promise.all([
        apiClient.get<AuthFilesResponse>('/credentials', {
          params: Object.keys(params).length ? params : undefined,
        }),
        mergeQuotaSnapshots ? getAuthQuotasIfAvailable() : Promise.resolve(null),
      ]);
      return mergeAuthQuotaSnapshots(filesPayload, quotasPayload, {
        includeSynthetic: mergeQuotaSnapshots,
      });
    })().finally(() => {
      if (inFlightAuthFilesListRequests.get(cacheKey) === request) {
        inFlightAuthFilesListRequests.delete(cacheKey);
      }
    });

    inFlightAuthFilesListRequests.set(cacheKey, request);
    return request;
  },

  getAuthQuotas: (all = true) =>
    apiClient.get<AuthQuotasResponse>(apiClient.getExtensionUrl('/auth-quotas'), {
      params: { all },
    }),

  refreshAuthQuotas: (request: RefreshAuthQuotasRequest = {}) => {
    const authIndexes = request.auth_indexes ?? request.authIndexes;
    return apiClient.post<RefreshAuthQuotasResponse>(
      apiClient.getExtensionUrl('/auth-quotas/refresh'),
      {
        all: request.all === true,
        ids: request.ids ?? [],
        auth_indexes: authIndexes ?? [],
      }
    );
  },

  setStatus: (name: string, disabled: boolean, authIndex?: string) =>
    apiClient.patch<AuthFileStatusResponse>('/credentials/status', {
      name,
      disabled,
      ...(authIndex ? { auth_index: authIndex } : {}),
    }),

  patchFields: (name: string, fields: AuthFileFieldsPatch) =>
    apiClient.patch('/credentials/fields', { name, ...fields }),

  requestManualRefresh: async (name: string, authIndex?: string): Promise<void> => {
    // The refresh response may include tokens. Never return it to callers.
    await apiClient.post<unknown>('/credentials/refresh', {
      name,
      ...(authIndex ? { auth_index: authIndex } : {}),
    });
  },

  requestAllManualRefresh: async (): Promise<AuthFileRefreshResult[]> => {
    const response = await apiClient.post<unknown>(
      '/credentials/refresh',
      { all: true },
      { timeout: 300_000 }
    );
    return normalizeAuthFileRefreshResults(response);
  },

  resetCooldown: (authIndex: string) =>
    apiClient.post<AuthFileCooldownResetResponse>('/routing/cooldown/reset', {
      auth_index: authIndex,
    }),

  uploadFiles: async (files: File[]): Promise<AuthFileBatchUploadResult> => {
    const requestedNames = files.map((file) => file.name);
    if (requestedNames.length === 0) {
      return { status: 'ok', uploaded: 0, files: [], failed: [] };
    }

    const formData = new FormData();
    files.forEach((file) => {
      formData.append('file', file, file.name);
    });
    const payload = await apiClient.postForm<AuthFileBatchUploadResponse>('/credentials', formData);
    return normalizeBatchUploadResponse(payload, requestedNames);
  },

  upload: (file: File) => authFilesApi.uploadFiles([file]),

  deleteFiles: async (names: string[]): Promise<AuthFileBatchDeleteResult> => {
    const requestedNames = normalizeRequestedAuthFileNames(names);
    if (requestedNames.length === 0) {
      return { status: 'ok', deleted: 0, files: [], failed: [] };
    }

    const payload = await apiClient.delete<AuthFileBatchDeleteResponse>('/credentials', {
      data: { names: requestedNames },
    });
    return normalizeBatchDeleteResponse(payload, requestedNames);
  },

  deleteFile: (name: string) => authFilesApi.deleteFiles([name]),

  deleteAll: () => apiClient.delete('/credentials', { params: { all: true } }),

  download: async (name: string): Promise<Blob> => {
    const response = await apiClient.getRaw(
      `/credentials/download?name=${encodeURIComponent(name)}`,
      {
        responseType: 'blob',
      }
    );
    return response.data as Blob;
  },

  downloadText: async (name: string): Promise<string> => {
    const blob = await authFilesApi.download(name);
    return blob.text();
  },

  readJson: async (name: string): Promise<Record<string, unknown>> => {
    const rawText = await authFilesApi.downloadText(name);
    return parseAuthFileJsonObject(rawText);
  },

  saveJson: async (name: string, value: Record<string, unknown>) => {
    const text = JSON.stringify(value, null, 2);
    await saveAuthFileText(name, text);
  },

  // OAuth 排除模型
  async getOauthExcludedModels(): Promise<Record<string, string[]>> {
    const data = await getConfigValue(OAUTH_EXCLUDED_MODELS_ENDPOINT, {});
    return normalizeOauthExcludedModels(data);
  },

  saveOauthExcludedModels: (provider: string, models: string[]) =>
    updateOauthProviderMap(OAUTH_EXCLUDED_MODELS_ENDPOINT, provider, models),

  deleteOauthExcludedEntry: (provider: string) =>
    updateOauthProviderMap(OAUTH_EXCLUDED_MODELS_ENDPOINT, provider),

  replaceOauthExcludedModels: (map: Record<string, string[]>) =>
    queueOauthMapWrite(OAUTH_EXCLUDED_MODELS_ENDPOINT, async () => {
      await apiClient.put(OAUTH_EXCLUDED_MODELS_ENDPOINT, normalizeOauthExcludedModels(map));
    }),

  // OAuth 模型别名
  async getOauthModelAlias(): Promise<Record<string, OAuthModelAliasEntry[]>> {
    const data = await getConfigValue(OAUTH_MODEL_ALIAS_ENDPOINT, {});
    return normalizeOauthModelAlias(data);
  },

  saveOauthModelAlias: async (channel: string, aliases: OAuthModelAliasEntry[]) => {
    const normalizedChannel = normalizeOAuthProviderKey(String(channel ?? ''));
    const normalizedAliases =
      normalizeOauthModelAlias({ [normalizedChannel]: aliases })[normalizedChannel] ?? [];
    await updateOauthProviderMap(
      OAUTH_MODEL_ALIAS_ENDPOINT,
      normalizedChannel,
      serializeOauthModelAliases(normalizedAliases)
    );
  },

  deleteOauthModelAlias: (channel: string) =>
    updateOauthProviderMap(OAUTH_MODEL_ALIAS_ENDPOINT, channel),

  // 获取认证凭证支持的模型
  async getModelsForAuthFile(
    name: string
  ): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const data = await apiClient.get<Record<string, unknown>>(
      `/credentials/models?name=${encodeURIComponent(name)}`
    );
    const models = data.models ?? data.data ?? data.items;
    return Array.isArray(models)
      ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  },

  checkModel: (name: string, model: string, authIndex?: string) =>
    apiClient.post<AuthFileModelCheckResult>(apiClient.getExtensionUrl('/auth-files/model-check'), {
      name,
      model,
      ...(authIndex ? { auth_index: authIndex } : {}),
    }),

  // 获取指定 channel 的模型定义
  async getModelDefinitions(
    channel: string
  ): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const normalizedChannel = normalizeOAuthProviderKey(String(channel ?? ''));
    if (!normalizedChannel) return [];
    const data = await apiClient.get<Record<string, unknown>>(
      `/routing/model-definitions/${encodeURIComponent(normalizedChannel)}`
    );
    const models = data.models ?? data.data ?? data.items;
    return Array.isArray(models)
      ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  },
};
