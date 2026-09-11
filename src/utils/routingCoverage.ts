/** A credential reduced to the fields model coverage depends on. */
export interface RoutingCoverageCandidate {
  providerKey: string;
  provider: string;
  models: readonly string[];
}

export interface RoutingGroupCoverage<T extends RoutingCoverageCandidate> {
  id: string;
  provider: string;
  candidates: T[];
  /** Distinct model ids any credential in the group declares. */
  coverage: string[];
}

/**
 * Groups credentials by provider and collects the models they actually serve.
 *
 * A credential declaring no models is unscoped: it can serve anything, so the
 * group inherits the whole catalog. Keeping `coverage` separate from the catalog
 * lets callers report what each credential declares apart from what it may serve.
 */
export const buildGroupCoverage = <T extends RoutingCoverageCandidate>(
  candidates: readonly T[],
  catalog: readonly string[] = []
): RoutingGroupCoverage<T>[] => {
  const grouped = new Map<string, T[]>();
  candidates.forEach((candidate) => {
    const current = grouped.get(candidate.providerKey) ?? [];
    current.push(candidate);
    grouped.set(candidate.providerKey, current);
  });

  return [...grouped.entries()].map(([id, groupCandidates]) => {
    const declared = new Set<string>();
    groupCandidates.forEach((candidate) =>
      candidate.models.forEach((model) => declared.add(model))
    );
    const source = declared.size > 0 ? declared : new Set(catalog);
    return {
      id,
      provider: groupCandidates[0]?.provider ?? id,
      candidates: groupCandidates,
      coverage: [...source].sort((left, right) => left.localeCompare(right)),
    };
  });
};

/** How many groups can serve each model — the unit the model index is counted in. */
export const countGroupsByModel = <T extends RoutingCoverageCandidate>(
  groups: ReadonlyArray<RoutingGroupCoverage<T>>
): Map<string, number> => {
  const counts = new Map<string, number>();
  groups.forEach((group) =>
    group.coverage.forEach((model) => counts.set(model, (counts.get(model) ?? 0) + 1))
  );
  return counts;
};
