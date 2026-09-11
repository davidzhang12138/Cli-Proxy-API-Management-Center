import { normalizeProviderKey, type AuthFileModelItem } from './constants';
import type { OAuthModelAliasEntry, UsageQuotaSnapshot } from '@/types';

/** Looks up the alias list for one provider, matching on the normalized key. */
export function aliasesForProvider(
  aliases: Record<string, OAuthModelAliasEntry[]>,
  provider: string
): OAuthModelAliasEntry[] {
  const normalizedProvider = normalizeProviderKey(provider);
  const providerEntry = Object.entries(aliases).find(
    ([key]) => normalizeProviderKey(key) === normalizedProvider
  );
  return providerEntry?.[1] ?? [];
}

export function mergeAuthFileModels(
  primary: readonly AuthFileModelItem[],
  supplement: readonly AuthFileModelItem[]
): AuthFileModelItem[] {
  const byId = new Map<string, AuthFileModelItem>();

  [...primary, ...supplement].forEach((item) => {
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id) return;

    const key = id.toLowerCase();
    if (!byId.has(key)) {
      byId.set(key, { ...item, id });
    }
  });

  return [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id, undefined, { sensitivity: 'base' })
  );
}

export function applyOAuthModelAliases(
  models: readonly AuthFileModelItem[],
  aliases: readonly OAuthModelAliasEntry[] = []
): AuthFileModelItem[] {
  const aliasesByName = new Map<string, OAuthModelAliasEntry[]>();
  aliases.forEach((entry) => {
    const name = entry.name.trim();
    const alias = entry.alias.trim();
    if (!name || !alias || name.toLowerCase() === alias.toLowerCase()) return;

    const key = name.toLowerCase();
    const entries = aliasesByName.get(key) ?? [];
    entries.push({ ...entry, name, alias });
    aliasesByName.set(key, entries);
  });

  if (aliasesByName.size === 0) return mergeAuthFileModels([], models);

  const output: AuthFileModelItem[] = [];
  const seen = new Set<string>();
  const nonForkAliasTargets = new Set<string>();
  aliasesByName.forEach((entries) => {
    entries.forEach((entry) => {
      if (entry.fork !== true) nonForkAliasTargets.add(entry.alias.toLowerCase());
    });
  });
  const append = (model: AuthFileModelItem) => {
    const id = model.id.trim();
    if (!id) return;
    const key = id.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push({ ...model, id });
  };

  models.forEach((model) => {
    const id = model.id.trim();
    if (!id) return;

    const entries = aliasesByName.get(id.toLowerCase());
    if (!entries || entries.length === 0) {
      if (nonForkAliasTargets.has(id.toLowerCase())) return;
      append(model);
      return;
    }

    const keepOriginal = entries.some((entry) => entry.fork === true);
    if (keepOriginal) append(model);

    let addedAlias = false;
    entries.forEach((entry) => {
      const alias = entry.alias.trim();
      if (!alias || alias.toLowerCase() === id.toLowerCase() || seen.has(alias.toLowerCase())) {
        return;
      }
      const aliasedModel: AuthFileModelItem = {
        ...model,
        id: alias,
        sourceId: model.sourceId ?? id,
      };
      append(aliasedModel);
      addedAlias = true;
    });

    if (!keepOriginal && !addedAlias) append(model);
  });

  return output.sort((left, right) =>
    left.id.localeCompare(right.id, undefined, { sensitivity: 'base' })
  );
}

export function modelsFromUsageQuotaSnapshot(
  snapshot: Pick<UsageQuotaSnapshot, 'resources'> | null | undefined,
  aliases: readonly OAuthModelAliasEntry[] = []
): AuthFileModelItem[] {
  const models = snapshot?.resources.flatMap((resource) =>
    (resource.models ?? []).map((id) => ({ id }))
  );

  return applyOAuthModelAliases(models ?? [], aliases);
}
