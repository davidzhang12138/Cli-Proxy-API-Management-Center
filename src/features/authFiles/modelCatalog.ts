import type { AuthFileModelItem } from './constants';
import type { UsageQuotaSnapshot } from '@/types';

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

export function modelsFromUsageQuotaSnapshot(
  snapshot: Pick<UsageQuotaSnapshot, 'resources'> | null | undefined
): AuthFileModelItem[] {
  const models = snapshot?.resources.flatMap((resource) =>
    (resource.models ?? []).map((id) => ({ id }))
  );

  return mergeAuthFileModels([], models ?? []);
}
