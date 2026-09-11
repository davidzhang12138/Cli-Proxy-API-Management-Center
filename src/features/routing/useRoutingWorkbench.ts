import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFilesApi } from '@/services/api/authFiles';
import { configApi } from '@/services/api/config';
import { providersApi } from '@/services/api/providers';
import { normalizeProviderKey } from '@/features/authFiles/constants';
import { aliasesForProvider, applyOAuthModelAliases } from '@/features/authFiles/modelCatalog';
import type {
  ApiKeyEntry,
  AuthFileItem,
  GeminiKeyConfig,
  ModelAlias,
  OAuthModelAliasEntry,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';
import { buildGroupCoverage } from '@/utils/routingCoverage';
import { maskApiKey } from '@/utils/format';

export type RoutingStrategy = 'round-robin' | 'weighted-round-robin' | 'fill-first';
export type RoutingCandidateSource = 'oauth' | 'api-key' | 'openai-compat';

export interface RoutingCandidateUpdate {
  priority?: number;
  weight?: number | null;
}

export interface RoutingCandidate {
  id: string;
  provider: string;
  providerKey: string;
  source: RoutingCandidateSource;
  identity: string;
  detail: string;
  models: string[];
  priority: number;
  weight: number;
  enabled: boolean;
  status: 'ready' | 'disabled' | 'warning';
  editable: boolean;
  update: (next: RoutingCandidateUpdate) => Promise<void>;
}

export interface RoutingGroup {
  id: string;
  provider: string;
  providerKey: string;
  candidates: RoutingCandidate[];
  models: string[];
  priority: number;
  uniformPriority: boolean;
  editable: boolean;
  updatePriority: (priority: number) => Promise<void>;
  updateCandidatePriority: (candidateId: string, priority: number) => Promise<void>;
}

export interface RoutingSnapshot {
  candidates: RoutingCandidate[];
  groups: RoutingGroup[];
  models: string[];
  strategy: RoutingStrategy;
  fetchedAt: number;
}

export interface UseRoutingWorkbenchResult {
  snapshot: RoutingSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  savingStrategy: boolean;
  /** providerKey -> model ids actually declared by that group's credentials. */
  modelCoverage: Map<string, string[]>;
  refresh: () => Promise<void>;
  updateStrategy: (strategy: RoutingStrategy) => Promise<void>;
}

const DEFAULT_STRATEGY: RoutingStrategy = 'round-robin';

/** Credentials per provider family can number in the hundreds; keep the fan-out bounded. */
const MODEL_FETCH_CONCURRENCY = 6;

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index]);
      }
    })
  );
}

const normalizeStrategy = (value: unknown): RoutingStrategy => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'weighted-round-robin') return normalized;
  if (normalized === 'fill-first') return normalized;
  return DEFAULT_STRATEGY;
};

const modelNames = (models?: ModelAlias[]): string[] => {
  const seen = new Set<string>();
  (models ?? []).forEach((model) => {
    const value = String(model.alias ?? model.name ?? '').trim();
    if (value) seen.add(value);
  });
  return [...seen].sort((left, right) => left.localeCompare(right));
};

const effectivePriority = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;

const effectiveWeight = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 1;

const isRuntimeOnly = (file: AuthFileItem): boolean =>
  file.runtimeOnly === true || file.runtimeOnly === 'true';

const standardUpdate = async (
  provider: string,
  apiKey: string,
  baseUrl: string | undefined,
  config: GeminiKeyConfig | ProviderKeyConfig
): Promise<void> => {
  switch (provider) {
    case 'gemini':
      await providersApi.updateGeminiKey(apiKey, baseUrl, config as GeminiKeyConfig);
      return;
    case 'interactions':
      await providersApi.updateInteractionsKey(apiKey, baseUrl, config as GeminiKeyConfig);
      return;
    case 'codex':
      await providersApi.updateCodexConfig(apiKey, baseUrl, config as ProviderKeyConfig);
      return;
    case 'xai':
      await providersApi.updateXAIConfig(apiKey, baseUrl, config as ProviderKeyConfig);
      return;
    case 'claude':
      await providersApi.updateClaudeConfig(apiKey, baseUrl, config as ProviderKeyConfig);
      return;
    case 'vertex':
      await providersApi.updateVertexConfig(apiKey, baseUrl, config as ProviderKeyConfig);
      return;
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
};

const buildStandardCandidate = (
  provider: string,
  index: number,
  config: GeminiKeyConfig | ProviderKeyConfig
): RoutingCandidate => {
  const apiKey = config.apiKey.trim();
  const identity = maskApiKey(apiKey) || `#${index + 1}`;
  const enabled = config.excludedModels?.includes('*') !== true;

  return {
    id: `config:${provider}:${index}:${apiKey}`,
    provider,
    providerKey: provider,
    source: 'api-key',
    identity,
    detail: config.baseUrl ?? 'default endpoint',
    models: modelNames(config.models),
    priority: effectivePriority(config.priority),
    weight: effectiveWeight(config.weight),
    enabled,
    status: enabled ? 'ready' : 'disabled',
    editable: true,
    update: async (next) => {
      const updated = {
        ...config,
        priority: next.priority === undefined || next.priority === 0 ? undefined : next.priority,
        ...(next.weight === undefined
          ? {}
          : { weight: next.weight === null ? undefined : next.weight }),
      };
      await standardUpdate(provider, apiKey, config.baseUrl, updated);
    },
  };
};

const buildOAuthCandidate = (file: AuthFileItem): RoutingCandidate => {
  const provider = normalizeProviderKey(String(file.type ?? file.provider ?? 'unknown'));
  const identity = String(file.email ?? file.projectId ?? file.name).trim();
  const runtimeOnly = isRuntimeOnly(file);
  const enabled = file.disabled !== true && file.unavailable !== true;
  const warning = Boolean(file.statusMessage) || file.status === 'error';
  // The models a credential actually serves come from its own catalog endpoint,
  // not the proxy-wide /v1/models list (which is per API key, not per file). It
  // is fetched lazily when the group is expanded; until then, none are claimed.
  const models: string[] = [];

  return {
    id: `oauth:${file.name}`,
    provider,
    // Same key as the config-declared keys for this provider: the workbench's
    // point is one group per provider family, spanning OAuth and API keys.
    providerKey: provider,
    source: 'oauth',
    identity,
    detail: file.name,
    models,
    priority: effectivePriority(file.priority),
    weight: effectiveWeight(file.weight),
    enabled,
    status: file.disabled ? 'disabled' : warning ? 'warning' : 'ready',
    editable: !runtimeOnly,
    update: async (next) => {
      if (runtimeOnly) throw new Error('Runtime-only credentials cannot be edited');
      await authFilesApi.patchFields(file.name, {
        priority: next.priority,
        weight: next.weight,
      });
    },
  };
};

const buildOpenAICompatCandidates = (provider: OpenAIProviderConfig): RoutingCandidate[] => {
  const sourceIndex = provider.sourceIndex ?? 0;
  const entries = provider.apiKeyEntries ?? [];
  const providerModels = modelNames(provider.models);

  const buildCandidate = (entry: ApiKeyEntry | null, entryIndex: number): RoutingCandidate => {
    const apiKey = entry?.apiKey?.trim() ?? '';
    const identity = apiKey ? maskApiKey(apiKey) : provider.name;
    const enabled = provider.disabled !== true && entry?.disabled !== true;
    const models = entry?.models?.length ? modelNames(entry.models) : providerModels;

    return {
      id: `compat:${sourceIndex}:${entryIndex}:${provider.name}:${apiKey}`,
      provider: provider.name,
      providerKey: `openai-compatible-${provider.name.toLowerCase()}`,
      source: 'openai-compat',
      identity,
      detail: entry?.baseUrl ?? provider.baseUrl ?? 'default endpoint',
      models,
      priority: effectivePriority(provider.priority),
      weight: effectiveWeight(entry?.weight),
      enabled,
      status: enabled ? 'ready' : 'disabled',
      editable: true,
      update: async (next) => {
        const nextEntries = entries.map((current, currentIndex) =>
          currentIndex === entryIndex
            ? {
                ...current,
                ...(next.weight === undefined
                  ? {}
                  : { weight: next.weight === null ? undefined : next.weight }),
              }
            : current
        );
        await providersApi.updateOpenAIProvider(provider.name, sourceIndex, {
          ...provider,
          priority: next.priority === undefined || next.priority === 0 ? undefined : next.priority,
          apiKeyEntries: nextEntries,
        });
      },
    };
  };

  return entries.length > 0
    ? entries.map((entry, index) => buildCandidate(entry, index))
    : [buildCandidate(null, 0)];
};

interface GroupRecord {
  group: RoutingGroup;
  coverage: string[];
}

/**
 * Groups credentials by provider. Pass the catalog to let unscoped credentials
 * (those declaring no models) inherit it; omit it to report declared models only.
 */
const groupRecords = (candidates: RoutingCandidate[], catalog?: string[]): GroupRecord[] =>
  buildGroupCoverage(candidates, catalog).map(
    ({ id, provider, candidates: groupCandidates, coverage }) => ({
      coverage,
      group: {
        id,
        provider,
        providerKey: id,
        candidates: groupCandidates,
        models: coverage,
        priority: Math.max(...groupCandidates.map((candidate) => candidate.priority), 0),
        uniformPriority:
          new Set(groupCandidates.map((candidate) => candidate.priority)).size <= 1,
        editable: groupCandidates.some((candidate) => candidate.editable),
        updatePriority: async (priority: number) => {
          for (const candidate of groupCandidates) {
            if (candidate.editable && candidate.priority !== priority) {
              await candidate.update({ priority });
            }
          }
        },
        updateCandidatePriority: async (candidateId: string, priority: number) => {
          const candidate = groupCandidates.find(
            (item) => item.id === candidateId && item.editable
          );
          if (!candidate) throw new Error('Credential is not editable');
          await candidate.update({ priority });
        },
      },
    })
  );

const snapshotFrom = (
  candidates: RoutingCandidate[],
  catalog: string[],
  strategy: RoutingStrategy,
  fetchedAt: number
): RoutingSnapshot => {
  const models = new Set(catalog);
  candidates.forEach((candidate) => candidate.models.forEach((model) => models.add(model)));
  const modelList = [...models].sort((left, right) => left.localeCompare(right));
  return {
    candidates,
    groups: groupRecords(candidates, modelList).map((record) => record.group),
    models: modelList,
    strategy,
    fetchedAt,
  };
};

interface BaseSnapshotResult {
  snapshot: RoutingSnapshot;
}

const loadBaseSnapshot = async (): Promise<BaseSnapshotResult> => {
  const [config, authFiles, strategy] = await Promise.all([
    configApi.getConfig(),
    authFilesApi.list(),
    configApi.getRoutingStrategy().catch(() => DEFAULT_STRATEGY),
  ]);

  const candidates: RoutingCandidate[] = [];
  const addStandard = (
    provider: string,
    configs: Array<GeminiKeyConfig | ProviderKeyConfig> | undefined
  ) => {
    (configs ?? []).forEach((configItem, index) => {
      if (configItem?.apiKey?.trim())
        candidates.push(buildStandardCandidate(provider, index, configItem));
    });
  };

  addStandard('gemini', config.geminiApiKeys);
  addStandard('interactions', config.interactionsApiKeys);
  addStandard('codex', config.codexApiKeys);
  addStandard('xai', config.xaiApiKeys);
  addStandard('claude', config.claudeApiKeys);
  addStandard('vertex', config.vertexApiKeys);
  (config.openaiCompatibility ?? []).forEach((provider) => {
    candidates.push(...buildOpenAICompatCandidates(provider));
  });
  candidates.push(...(authFiles.files ?? []).map((file) => buildOAuthCandidate(file)));

  return {
    snapshot: snapshotFrom(
      candidates,
      [],
      normalizeStrategy(config.routingStrategy ?? strategy),
      Date.now()
    ),
  };
};

export function useRoutingWorkbench(): UseRoutingWorkbenchResult {
  const [snapshot, setSnapshot] = useState<RoutingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [savingStrategy, setSavingStrategy] = useState(false);
  const aliasesRef = useRef<Record<string, OAuthModelAliasEntry[]>>({});

  const modelCoverage = useMemo(() => {
    const map = new Map<string, string[]>();
    if (snapshot) {
      groupRecords(snapshot.candidates).forEach((record) =>
        map.set(record.group.id, record.coverage)
      );
    }
    return map;
  }, [snapshot]);

  /**
   * Per-credential model catalogs. Each auth file has its own endpoint, and the
   * pool hides groups with no models, so coverage has to be known up front
   * rather than on expand — one bounded round of requests per credential, then
   * cached for the session.
   *
   * ponytail: the cache is never invalidated, so a catalog edited elsewhere
   * stays stale until reload. Add a TTL or invalidate on auth-file writes if
   * that starts to matter.
   */
  const modelsCacheRef = useRef<Map<string, string[]>>(new Map());

  const loadOAuthModels = useCallback(async (candidates: RoutingCandidate[]) => {
    const oauth = candidates.filter((candidate) => candidate.source === 'oauth');
    if (oauth.length === 0) return;

    const missing = oauth.filter((candidate) => !modelsCacheRef.current.has(candidate.id));
    if (missing.length > 0) {
      if (Object.keys(aliasesRef.current).length === 0) {
        aliasesRef.current = await authFilesApi.getOauthModelAlias().catch(() => ({}));
      }
      await runWithConcurrency(missing, MODEL_FETCH_CONCURRENCY, async (candidate) => {
        const name = candidate.id.replace(/^oauth:/, '');
        const provider = normalizeProviderKey(candidate.provider);
        let models: string[] = [];
        try {
          const raw = await authFilesApi.getModelsForAuthFile(name);
          models = [
            ...new Set(
              applyOAuthModelAliases(raw, aliasesForProvider(aliasesRef.current, provider))
                .map((model) => model.id)
                .filter(Boolean)
            ),
          ].sort((left, right) => left.localeCompare(right));
        } catch {
          // A credential with no catalog endpoint simply claims no models.
        }
        modelsCacheRef.current.set(candidate.id, models);
      });
    }

    setSnapshot((current) => {
      if (!current) return current;
      return snapshotFrom(
        current.candidates.map((candidate) =>
          candidate.source === 'oauth'
            ? { ...candidate, models: modelsCacheRef.current.get(candidate.id) ?? [] }
            : candidate
        ),
        [],
        current.strategy,
        current.fetchedAt
      );
    });
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const result = await loadBaseSnapshot();
      setSnapshot(result.snapshot);
      await loadOAuthModels(result.snapshot.candidates);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadOAuthModels]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateStrategy = useCallback(async (strategy: RoutingStrategy) => {
    setSavingStrategy(true);
    try {
      await configApi.updateRoutingStrategy(strategy);
      setSnapshot((current) => (current ? { ...current, strategy } : current));
    } finally {
      setSavingStrategy(false);
    }
  }, []);

  return {
    snapshot,
    loading,
    refreshing,
    error,
    savingStrategy,
    modelCoverage,
    refresh,
    updateStrategy,
  };
}
