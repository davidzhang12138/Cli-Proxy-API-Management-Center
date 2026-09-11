import { useCallback, useEffect, useState } from 'react';
import { authFilesApi } from '@/services/api/authFiles';
import { configApi } from '@/services/api/config';
import { providersApi } from '@/services/api/providers';
import type {
  ApiKeyEntry,
  AuthFileItem,
  GeminiKeyConfig,
  ModelAlias,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';
import { maskApiKey } from '@/utils/format';

export type RoutingStrategy = 'round-robin' | 'weighted-round-robin' | 'fill-first';
export type RoutingCandidateSource = 'oauth' | 'api-key' | 'openai-compat';

export interface RoutingCandidateUpdate {
  priority: number;
  weight: number | null;
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

export interface RoutingSnapshot {
  candidates: RoutingCandidate[];
  strategy: RoutingStrategy;
  fetchedAt: number;
}

export interface UseRoutingWorkbenchResult {
  snapshot: RoutingSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  savingStrategy: boolean;
  savingCandidateId: string | null;
  refresh: () => Promise<void>;
  updateStrategy: (strategy: RoutingStrategy) => Promise<void>;
  updateCandidate: (candidate: RoutingCandidate, next: RoutingCandidateUpdate) => Promise<void>;
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

const authModelNames = (models: Array<{ id?: string }> | undefined): string[] => {
  const seen = new Set<string>();
  (models ?? []).forEach((model) => {
    const value = String(model.id ?? '').trim();
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
        priority: next.priority === 0 ? undefined : next.priority,
        weight: next.weight === null ? undefined : next.weight,
      };
      await standardUpdate(provider, apiKey, config.baseUrl, updated);
    },
  };
};

const buildOAuthCandidate = (file: AuthFileItem, models: string[]): RoutingCandidate => {
  const provider = String(file.type ?? file.provider ?? 'unknown')
    .trim()
    .toLowerCase();
  const identity = String(file.email ?? file.projectId ?? file.name).trim();
  const runtimeOnly = isRuntimeOnly(file);
  const enabled = file.disabled !== true && file.unavailable !== true;
  const warning = Boolean(file.statusMessage) || file.status === 'error';

  return {
    id: `oauth:${file.name}`,
    provider,
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
                weight: next.weight === null ? undefined : next.weight,
              }
            : current
        );
        await providersApi.updateOpenAIProvider(provider.name, sourceIndex, {
          ...provider,
          priority: next.priority === 0 ? undefined : next.priority,
          apiKeyEntries: nextEntries,
        });
      },
    };
  };

  return entries.length > 0
    ? entries.map((entry, index) => buildCandidate(entry, index))
    : [buildCandidate(null, 0)];
};

const loadOAuthCandidates = async (files: AuthFileItem[]): Promise<RoutingCandidate[]> => {
  const results = await Promise.all(
    files.map(async (file) => {
      try {
        const models = await authFilesApi.getModelsForAuthFile(file.name);
        return buildOAuthCandidate(file, authModelNames(models));
      } catch {
        return buildOAuthCandidate(file, []);
      }
    })
  );
  return results;
};

const loadSnapshot = async (): Promise<RoutingSnapshot> => {
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
  candidates.push(...(await loadOAuthCandidates(authFiles.files ?? [])));

  return {
    candidates,
    strategy: normalizeStrategy(config.routingStrategy ?? strategy),
    fetchedAt: Date.now(),
  };
};

export function useRoutingWorkbench(): UseRoutingWorkbenchResult {
  const [snapshot, setSnapshot] = useState<RoutingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [savingCandidateId, setSavingCandidateId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      setSnapshot(await loadSnapshot());
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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

  const updateCandidate = useCallback(
    async (candidate: RoutingCandidate, next: RoutingCandidateUpdate) => {
      setSavingCandidateId(candidate.id);
      try {
        await candidate.update(next);
      } finally {
        setSavingCandidateId(null);
      }
    },
    []
  );

  return {
    snapshot,
    loading,
    refreshing,
    error,
    savingStrategy,
    savingCandidateId,
    refresh,
    updateStrategy,
    updateCandidate,
  };
}
