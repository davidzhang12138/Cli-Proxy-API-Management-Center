import { authFilesApi, configApi, providersApi } from '@/services/api';
import {
  CLAUDE_REQUEST_HEADERS,
  CODEX_REQUEST_HEADERS,
  XAI_API_REQUEST_HEADERS,
} from '@/utils/quota';
import { resolveCodexChatgptAccountId } from '@/utils/quota/resolvers';
import { normalizeProviderKey, type AuthFileModelItem } from '@/features/authFiles/constants';
import {
  aliasesForProvider,
  applyOAuthModelAliases,
  mergeAuthFileModels,
} from '@/features/authFiles/modelCatalog';
import { maskApiKey } from '@/utils/format';
import type {
  AuthFileItem,
  Config,
  GeminiKeyConfig,
  ModelAlias,
  OpenAIProviderConfig,
  OAuthModelAliasEntry,
  ProviderKeyConfig,
} from '@/types';
import type { BenchmarkModel, BenchmarkProtocol, BenchmarkTarget } from '@/types';

export interface BenchmarkDiscovery {
  targets: BenchmarkTarget[];
  models: string[];
  fetchedAt: number;
}

const PROVIDER_LABELS: Record<string, string> = {
  aistudio: 'AI Studio',
  antigravity: 'Antigravity',
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  interactions: 'Interactions',
  kimi: 'Kimi',
  kiro: 'Kiro',
  hyper: 'Hyper',
  vertex: 'Vertex',
  xai: 'xAI',
};

const providerLabel = (provider: string): string =>
  PROVIDER_LABELS[provider] ?? provider.replace(/[-_]+/g, ' ');

const normalizeText = (value: unknown): string => String(value ?? '').trim();

const recordValue = (value: unknown, key: string): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return normalizeText((value as Record<string, unknown>)[key]);
};

const resolveAuthProviderKey = (file: AuthFileItem, provider: string): string => {
  const providerKey =
    normalizeText(file['provider_key']) ||
    recordValue(file.attributes, 'provider_key') ||
    recordValue(file.metadata, 'provider_key');
  const compatName =
    normalizeText(file['compat_name']) ||
    recordValue(file.attributes, 'compat_name') ||
    recordValue(file.metadata, 'compat_name');
  const normalized = provider.toLowerCase();
  const isCompatible =
    normalized === 'openai' ||
    normalized === 'openai-compatibility' ||
    normalized.startsWith('openai-compatible-') ||
    providerKey.toLowerCase().startsWith('openai-compatible-') ||
    Boolean(compatName);
  if (!isCompatible) return provider;
  const key = (providerKey || compatName || provider).toLowerCase();
  return key.startsWith('openai-compatible-') ? key : `openai-compatible-${key}`;
};

const modelsFromAliases = (models: ModelAlias[] | undefined): BenchmarkModel[] => {
  const seen = new Set<string>();
  const result: BenchmarkModel[] = [];

  (models ?? []).forEach((model) => {
    const name = normalizeText(model.name);
    const alias = normalizeText(model.alias);
    const id = alias || name;
    if (!id || seen.has(id.toLowerCase())) return;
    seen.add(id.toLowerCase());
    result.push(alias ? { id, name, alias } : { id, name });
  });

  return result;
};

const modelsFromCatalog = (models: string[] | undefined): BenchmarkModel[] => {
  const seen = new Set<string>();
  return (models ?? []).reduce<BenchmarkModel[]>((result, model) => {
    const name = normalizeText(model);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return result;
    seen.add(key);
    result.push({ id: name, name });
    return result;
  }, []);
};

/**
 * Static provider definitions can lag behind the model IDs returned by a live
 * auth file. Keep both sources so Benchmark uses the same model coverage as
 * the routing workbench.
 */
export const mergeBenchmarkOAuthModels = (
  runtimeModels: readonly AuthFileModelItem[],
  staticModelIds: readonly string[],
  aliases: readonly OAuthModelAliasEntry[] = []
): string[] => {
  const staticModels = staticModelIds.map((id) => ({ id }));
  return applyOAuthModelAliases(mergeAuthFileModels(runtimeModels, staticModels), aliases).map(
    (model) => model.id
  );
};

const providerProtocol = (provider: string): BenchmarkProtocol | null => {
  switch (provider) {
    case 'gemini':
    case 'aistudio':
      return 'gemini';
    case 'interactions':
      return 'interactions';
    case 'codex':
      return 'responses';
    case 'xai':
    case 'hyper':
      return 'chat-completions';
    case 'claude':
      return 'claude-messages';
    default:
      return null;
  }
};

const standardProviderRows: Array<{
  key: string;
  configs: (config: Config) => Array<GeminiKeyConfig | ProviderKeyConfig> | undefined;
  protocol: BenchmarkProtocol | null;
}> = [
  { key: 'gemini', configs: (config) => config.geminiApiKeys, protocol: 'gemini' },
  {
    key: 'interactions',
    configs: (config) => config.interactionsApiKeys,
    protocol: 'interactions',
  },
  { key: 'codex', configs: (config) => config.codexApiKeys, protocol: 'responses' },
  { key: 'xai', configs: (config) => config.xaiApiKeys, protocol: 'responses' },
  { key: 'claude', configs: (config) => config.claudeApiKeys, protocol: 'claude-messages' },
  { key: 'vertex', configs: (config) => config.vertexApiKeys, protocol: null },
];

const targetIdentity = (target: BenchmarkTarget): string =>
  `${target.providerKey}:${target.source}:${target.id}`;

const buildStandardTargets = (config: Config): BenchmarkTarget[] => {
  const targets: BenchmarkTarget[] = [];

  standardProviderRows.forEach(({ key, configs, protocol }) => {
    (configs(config) ?? []).forEach((entry, index) => {
      const apiKey = normalizeText(entry.apiKey);
      const authIndex = normalizeText(entry.authIndex);
      const baseUrl = normalizeText(entry.baseUrl);
      if (!apiKey && !authIndex) return;
      const requiresBaseUrl = key === 'codex' || key === 'xai' || key === 'vertex';
      const supported = protocol !== null && (!requiresBaseUrl || Boolean(baseUrl));
      targets.push({
        id: `api:${key}:${index}`,
        providerKey: key,
        label: `${providerLabel(key)} · ${index + 1}`,
        source: 'api-key',
        identity: maskApiKey(apiKey) || `auth:${authIndex || index + 1}`,
        protocol,
        baseUrl: baseUrl || undefined,
        apiKey,
        authIndex: authIndex || undefined,
        headers: entry.headers ?? {},
        models: modelsFromAliases(entry.models),
        enabled: true,
        supported,
        note: supported ? undefined : 'base-url-required',
      });
    });
  });

  (config.openaiCompatibility ?? []).forEach((provider, providerIndex) => {
    const entries = provider.apiKeyEntries ?? [];
    const providerModels = modelsFromAliases(provider.models);
    const rows = entries.length > 0 ? entries : [null];

    rows.forEach((entry, entryIndex) => {
      const apiKey = normalizeText(entry?.apiKey);
      const models = entry?.models?.length ? modelsFromAliases(entry.models) : providerModels;
      const baseUrl = normalizeText(entry?.baseUrl) || normalizeText(provider.baseUrl);
      const providerName = normalizeText(provider.name) || `openai-compat-${providerIndex + 1}`;
      const supported = Boolean(baseUrl);
      targets.push({
        id: `compat:${providerIndex}:${entryIndex}`,
        providerKey: `openai-compatible-${providerName.toLowerCase()}`,
        label: `${providerName || 'OpenAI compatible'} · ${entryIndex + 1}`,
        source: 'openai-compat',
        identity: apiKey ? maskApiKey(apiKey) : 'provider key pool',
        protocol: 'chat-completions',
        baseUrl: baseUrl || undefined,
        apiKey: apiKey || undefined,
        authIndex:
          normalizeText(entry?.authIndex) || normalizeText(provider.authIndex) || undefined,
        headers: provider.headers ?? {},
        models,
        enabled: provider.disabled !== true && entry?.disabled !== true,
        supported,
        note: supported ? undefined : 'base-url-required',
      });
    });
  });

  return targets;
};

const authFileIdentity = (file: AuthFileItem): string =>
  normalizeText(file.email) || normalizeText(file.projectId) || normalizeText(file.name);

const buildOAuthTarget = (
  file: AuthFileItem,
  catalog: Record<string, string[]>
): BenchmarkTarget => {
  const provider = normalizeProviderKey(normalizeText(file.type ?? file.provider));
  const providerKey = resolveAuthProviderKey(file, provider);
  const protocol = providerProtocol(provider);
  const authIndex = normalizeText(file.authIndex ?? file.auth_index) || undefined;
  const accountId =
    provider === 'codex' ? (resolveCodexChatgptAccountId(file) ?? undefined) : undefined;
  const headers: Record<string, string> = {};

  if (provider === 'claude') Object.assign(headers, CLAUDE_REQUEST_HEADERS);
  if (provider === 'codex') Object.assign(headers, CODEX_REQUEST_HEADERS);
  if (provider === 'xai') Object.assign(headers, XAI_API_REQUEST_HEADERS);
  if (accountId) headers['Chatgpt-Account-Id'] = accountId;

  if (provider === 'gemini' || provider === 'aistudio') {
    headers['x-goog-api-key'] = '$TOKEN$';
  }

  // OAuth auth files execute through CPA's pinned provider executor, so a
  // protocol-specific direct URL is not required for benchmark requests.
  const supported = Boolean(authIndex || normalizeText(file.name));
  return {
    id: `oauth:${normalizeText(file.name)}`,
    providerKey,
    label: `${providerLabel(provider)} · ${authFileIdentity(file) || 'auth file'}`,
    source: 'oauth',
    identity: authFileIdentity(file),
    protocol,
    baseUrl:
      provider === 'xai'
        ? 'https://api.x.ai/v1'
        : provider === 'hyper'
          ? 'https://hyper.charm.land/v1'
          : provider === 'claude'
            ? 'https://api.anthropic.com'
            : undefined,
    authIndex,
    headers,
    models: modelsFromCatalog(catalog[provider]),
    enabled: file.disabled !== true && file.unavailable !== true,
    supported,
    note: supported ? undefined : 'auth-index-missing',
    accountId,
    authFileName: file.name,
  };
};

export const buildBenchmarkTargets = (
  config: Config,
  files: AuthFileItem[],
  oauthCatalog: Record<string, string[]> = {}
): BenchmarkTarget[] => {
  const targets = [
    ...buildStandardTargets(config),
    ...files.map((file) => buildOAuthTarget(file, oauthCatalog)),
  ];
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = targetIdentity(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * The raw /config response intentionally contains no runtime auth indexes.
 * The management OpenAI-compatible list does, so copy those indexes onto the
 * config snapshot before building targets. This lets Benchmark use the
 * backend's pinned provider executor instead of bypassing it with api-call.
 */
const mergeOpenAIAuthIndexes = (
  config: Config,
  indexedProviders: OpenAIProviderConfig[]
): Config => {
  if (!config.openaiCompatibility?.length || !indexedProviders.length) return config;

  return {
    ...config,
    openaiCompatibility: config.openaiCompatibility.map((provider, providerIndex) => {
      const indexed =
        indexedProviders.find((candidate) => candidate.sourceIndex === providerIndex) ??
        indexedProviders.find(
          (candidate) => candidate.name.trim().toLowerCase() === provider.name.trim().toLowerCase()
        );
      if (!indexed) return provider;

      return {
        ...provider,
        authIndex: provider.authIndex || indexed.authIndex,
        apiKeyEntries: (provider.apiKeyEntries ?? []).map((entry, entryIndex) => ({
          ...entry,
          authIndex: entry.authIndex || indexed.apiKeyEntries?.[entryIndex]?.authIndex,
        })),
      };
    }),
  };
};

export async function loadBenchmarkTargets(): Promise<BenchmarkDiscovery> {
  const [config, authFiles, aliases, indexedProviders] = await Promise.all([
    configApi.getConfig(),
    authFilesApi.list(),
    authFilesApi.getOauthModelAlias().catch(() => ({})),
    providersApi.getOpenAIProviders().catch(() => []),
  ]);
  const providers = [
    ...new Set(
      (authFiles.files ?? [])
        .map((file) => normalizeProviderKey(normalizeText(file.type ?? file.provider)))
        .filter(Boolean)
    ),
  ];

  const catalogEntries = await Promise.all(
    providers.map(async (provider) => {
      const staticModels = await authFilesApi.getModelDefinitions(provider).catch(() => []);
      const representative = (authFiles.files ?? []).find(
        (file) =>
          normalizeProviderKey(normalizeText(file.type ?? file.provider)) === provider &&
          file.disabled !== true &&
          file.unavailable !== true &&
          normalizeText(file.name) !== ''
      );
      const runtimeModels = representative
        ? await authFilesApi.getModelsForAuthFile(representative.name).catch(() => [])
        : [];
      const staticModelIds = staticModels
        .map((model) => normalizeText(model.id))
        .filter(Boolean);
      return [
        provider,
        mergeBenchmarkOAuthModels(
          runtimeModels,
          staticModelIds,
          aliasesForProvider(aliases, provider)
        ),
      ] as const;
    })
  );
  const oauthCatalog = Object.fromEntries(catalogEntries);
  const targets = buildBenchmarkTargets(
    mergeOpenAIAuthIndexes(config, indexedProviders),
    authFiles.files ?? [],
    oauthCatalog
  );
  const models = [
    ...new Set(targets.flatMap((target) => target.models.map((model) => model.id)).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));

  return { targets, models, fetchedAt: Date.now() };
}

export const targetServesModel = (target: BenchmarkTarget, model: string): boolean => {
  const selected = normalizeText(model).toLowerCase();
  if (!selected || target.models.length === 0) return true;
  return target.models.some(
    (candidate) =>
      candidate.id.toLowerCase() === selected || candidate.name.toLowerCase() === selected
  );
};

export const resolveTargetModel = (target: BenchmarkTarget, model: string): string => {
  const selected = normalizeText(model);
  const match = target.models.find(
    (candidate) =>
      candidate.id.toLowerCase() === selected.toLowerCase() ||
      candidate.name.toLowerCase() === selected.toLowerCase()
  );
  return match?.name ?? selected;
};
