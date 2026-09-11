import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFilesApi } from '@/services/api/authFiles';
import { configApi } from '@/services/api/config';
import { modelsApi } from '@/services/api/models';
import { providersApi } from '@/services/api/providers';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { useAuthStore } from '@/stores';
import { isModelExcluded, normalizeProviderKey } from '@/features/authFiles/constants';
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
  modelPriorities?: Record<string, number>;
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
  /** Model overrides owned by this credential (auth file, key entry, or provider). */
  modelPriorities: Record<string, number>;
  /** Provider-level overrides inherited by an OpenAI-compatible API key entry. */
  inheritedModelPriorities?: Record<string, number>;
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
  updateCandidateModelPriority: (
    candidateId: string,
    model: string,
    priority: number | null
  ) => Promise<void>;
  updateModelPriority: (model: string, priority: number | null) => Promise<void>;
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

const hasModelPriority = (priorities: Record<string, number> | undefined, model: string): boolean =>
  Boolean(priorities && Object.prototype.hasOwnProperty.call(priorities, model));

export type RoutingModelPrioritySource = 'override' | 'inherited';

export const getRoutingCandidatePriority = (
  candidate: RoutingCandidate,
  model: string | null
): number => {
  if (!model) return candidate.priority;
  const override = candidate.modelPriorities[model];
  if (hasModelPriority(candidate.modelPriorities, model)) return Math.trunc(override);
  const inherited = candidate.inheritedModelPriorities?.[model];
  if (typeof inherited === 'number' && hasModelPriority(candidate.inheritedModelPriorities, model)) {
    return Math.trunc(inherited);
  }
  return candidate.priority;
};

export const getRoutingModelPrioritySource = (
  candidate: RoutingCandidate,
  model: string | null
): RoutingModelPrioritySource | null => {
  if (!model) return null;
  if (hasModelPriority(candidate.modelPriorities, model)) return 'override';
  return 'inherited';
};

const nextModelPriorities = (
  current: Record<string, number> | undefined,
  model: string,
  priority: number | null
): Record<string, number> => {
  const next = { ...(current ?? {}) };
  if (priority === null) delete next[model];
  else next[model] = priority;
  return next;
};

const candidateServesModel = (
  candidate: RoutingCandidate,
  model: string,
  coverage: string[]
): boolean => (candidate.models.length === 0 ? coverage.includes(model) : candidate.models.includes(model));

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
    modelPriorities: config.modelPriorities ?? {},
    weight: effectiveWeight(config.weight),
    enabled,
    status: enabled ? 'ready' : 'disabled',
    editable: true,
    update: async (next) => {
      const updated = {
        ...config,
        ...(next.priority === undefined
          ? {}
          : { priority: next.priority === 0 ? undefined : next.priority }),
        ...(next.modelPriorities === undefined ? {} : { modelPriorities: next.modelPriorities }),
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
    modelPriorities: file.modelPriorities ?? {},
    weight: effectiveWeight(file.weight),
    enabled,
    status: file.disabled ? 'disabled' : warning ? 'warning' : 'ready',
    editable: !runtimeOnly,
    update: async (next) => {
      if (runtimeOnly) throw new Error('Runtime-only credentials cannot be edited');
      await authFilesApi.patchFields(file.name, {
        ...(next.priority === undefined ? {} : { priority: next.priority }),
        ...(next.weight === undefined ? {} : { weight: next.weight }),
        ...(next.modelPriorities === undefined
          ? {}
          : { model_priorities: next.modelPriorities }),
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
    const modelPriorities = entry ? entry.modelPriorities ?? {} : provider.modelPriorities ?? {};
    const inheritedModelPriorities = entry ? provider.modelPriorities : undefined;

    return {
      id: `compat:${sourceIndex}:${entryIndex}:${provider.name}:${apiKey}`,
      provider: provider.name,
      providerKey: `openai-compatible-${provider.name.toLowerCase()}`,
      source: 'openai-compat',
      identity,
      detail: entry?.baseUrl ?? provider.baseUrl ?? 'default endpoint',
      models,
      priority: effectivePriority(provider.priority),
      modelPriorities,
      ...(inheritedModelPriorities
        ? { inheritedModelPriorities }
        : {}),
      weight: effectiveWeight(entry?.weight),
      enabled,
      status: enabled ? 'ready' : 'disabled',
      editable: true,
      update: async (next) => {
        const nextEntries = entries.map((current, currentIndex) =>
          currentIndex === entryIndex
            ? {
                ...current,
                ...(next.modelPriorities === undefined
                  ? {}
                  : { modelPriorities: next.modelPriorities }),
                ...(next.weight === undefined
                  ? {}
                  : { weight: next.weight === null ? undefined : next.weight }),
              }
            : current
        );
        await providersApi.updateOpenAIProvider(provider.name, sourceIndex, {
          ...provider,
          ...(next.priority === undefined
            ? {}
            : { priority: next.priority === 0 ? undefined : next.priority }),
          ...(entry || next.modelPriorities === undefined
            ? {}
            : { modelPriorities: next.modelPriorities }),
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
          candidate.priority = priority;
        },
        updateCandidateModelPriority: async (
          candidateId: string,
          model: string,
          priority: number | null
        ) => {
          const candidate = groupCandidates.find(
            (item) => item.id === candidateId && item.editable
          );
          if (!candidate) throw new Error('Credential is not editable');
          if (!candidateServesModel(candidate, model, coverage)) {
            throw new Error('Credential does not serve this model');
          }
          const modelPriorities = nextModelPriorities(candidate.modelPriorities, model, priority);
          await candidate.update({
            modelPriorities,
          });
          candidate.modelPriorities = modelPriorities;
        },
        updateModelPriority: async (model: string, priority: number | null) => {
          for (const candidate of groupCandidates) {
            if (!candidate.editable) continue;
            if (!candidateServesModel(candidate, model, coverage)) continue;
            const modelPriorities = nextModelPriorities(candidate.modelPriorities, model, priority);
            await candidate.update({
              modelPriorities,
            });
            candidate.modelPriorities = modelPriorities;
          }
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
  /**
   * Provider -> models the operator excluded from OAuth routing. These are the
   * models /model-definitions returns but the proxy will never route to, so the
   * pool must not advertise them as served.
   */
  oauthExcludedModels: Record<string, string[]>;
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
    oauthExcludedModels: config.oauthExcludedModels ?? {},
  };
};

export function useRoutingWorkbench(): UseRoutingWorkbenchResult {
  const apiBase = useAuthStore((state) => state.apiBase);
  const getApiKeysForModels = useApiKeysForModels();
  const [snapshot, setSnapshot] = useState<RoutingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [savingStrategy, setSavingStrategy] = useState(false);
  const aliasesRef = useRef<Promise<Record<string, OAuthModelAliasEntry[]>> | null>(null);

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
   * OAuth model coverage comes from /model-definitions/{provider}, which returns
   * the catalog for a whole provider family in one request. Listing credentials
   * (1053 of them on a real install) must never mean one request per credential.
   *
   * ponytail: the provider catalogs are fetched once per session and not
   * invalidated, so a catalog edited elsewhere stays stale until reload.
   */
  // Promises, not results: the ref has to be populated synchronously, or a
  // second call arriving mid-flight (StrictMode, a refresh during load) starts
  // the same batch again.
  const providerModelsRef = useRef(new Map<string, Promise<string[]>>());

  const loadAliases = useCallback(() => {
    if (!aliasesRef.current) {
      aliasesRef.current = authFilesApi.getOauthModelAlias().catch(() => ({}));
    }
    return aliasesRef.current;
  }, []);

  /**
   * Models the proxy will actually route to. /model-definitions answers "what
   * does this provider offer"; this answers "what can a client request right
   * now", so the pool intersects the two. Unavailable (no key, fetch failed)
   * means no filtering rather than hiding everything.
   */
  const loadServedModels = useCallback(async (): Promise<Set<string> | null> => {
    if (!apiBase) return null;
    try {
      const apiKeys = await getApiKeysForModels();
      if (!apiKeys[0]) return null;
      const models = await modelsApi.fetchModels(apiBase, apiKeys[0]);
      const names = models.map((model) => model.name).filter(Boolean);
      return names.length > 0 ? new Set(names) : null;
    } catch {
      return null;
    }
  }, [apiBase, getApiKeysForModels]);

  const loadOAuthModels = useCallback(
    async (
      candidates: RoutingCandidate[],
      excluded: Record<string, string[]>,
      served: Set<string> | null
    ) => {
      const providers = [
        ...new Set(
          candidates
            .filter((candidate) => candidate.source === 'oauth')
            .map((candidate) => normalizeProviderKey(candidate.provider))
            .filter(Boolean)
        ),
      ];
      if (providers.length === 0) return;

      const resolved = await Promise.all(
        providers.map(async (provider) => {
          const cached = providerModelsRef.current.get(provider);
          if (cached) return [provider, await cached] as const;

          // Cached unfiltered: exclusions are applied on read so that editing
          // them takes effect without refetching the catalog.
          const pending = (async () => {
            const aliases = await loadAliases();
            const raw = await authFilesApi
              .getModelDefinitions(provider)
              // A provider with no definition endpoint simply claims no models.
              .catch(() => []);
            return [
              ...new Set(
                applyOAuthModelAliases(raw, aliasesForProvider(aliases, provider))
                  .map((model) => model.id)
                  .filter(Boolean)
              ),
            ].sort((left, right) => left.localeCompare(right));
          })();
          providerModelsRef.current.set(provider, pending);
          return [provider, await pending] as const;
        })
      );
      // The definition catalog lists everything the provider offers. Keep only
      // what the proxy actually serves and what the operator did not exclude
      // (exclusions support `*` wildcards).
      const catalog = new Map(
        resolved.map(([provider, models]) => [
          provider,
          models.filter(
            (model) =>
              !isModelExcluded(model, provider, excluded) && (!served || served.has(model))
          ),
        ])
      );

      setSnapshot((current) => {
        if (!current) return current;
        return snapshotFrom(
          current.candidates.map((candidate) =>
            candidate.source === 'oauth'
              ? {
                  ...candidate,
                  models: catalog.get(normalizeProviderKey(candidate.provider)) ?? [],
                }
              : candidate
          ),
          [],
          current.strategy,
          current.fetchedAt
        );
      });
    },
    [loadAliases]
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const result = await loadBaseSnapshot();
      setSnapshot(result.snapshot);
      const served = await loadServedModels();
      await loadOAuthModels(result.snapshot.candidates, result.oauthExcludedModels, served);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadOAuthModels, loadServedModels]);

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
