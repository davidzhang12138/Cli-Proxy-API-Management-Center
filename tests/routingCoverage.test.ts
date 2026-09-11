import { describe, expect, test } from 'bun:test';
import { buildGroupCoverage, countGroupsByModel } from '../src/utils/routingCoverage';

const candidate = (providerKey: string, models: string[]) => ({ providerKey, provider: providerKey, models });

describe('routing coverage', () => {
  test('counts groups, never credentials, per model', () => {
    // 5 codex credentials declaring one model used to render as "5" under a badge
    // labelled "all models", which counted credentials instead.
    const candidates = [...Array(5)].map(() => candidate('codex', ['claude-opus-4-6-thinking']));
    const groups = buildGroupCoverage(candidates);
    expect(groups.length).toBe(1);
    expect(countGroupsByModel(groups).get('claude-opus-4-6-thinking')).toBe(1);
  });

  test('an unscoped credential inherits the catalog only when one is supplied', () => {
    const candidates = [candidate('claude', [])];
    expect(buildGroupCoverage(candidates)[0].coverage).toEqual([]);
    expect(buildGroupCoverage(candidates, ['kimi-k3'])[0].coverage).toEqual(['kimi-k3']);
  });

  test('declared models stay per-credential even with a catalog present', () => {
    // The model rail must not claim an OAuth group covers the whole catalog just
    // because the group-level coverage column does.
    const candidates = [candidate('claude', ['claude-opus-4-6-thinking'])];
    expect(buildGroupCoverage(candidates, ['kimi-k3'])[0].coverage).toEqual([
      'claude-opus-4-6-thinking',
    ]);
  });

  test('a partially declared group keeps its declared models over the catalog', () => {
    const candidates = [candidate('claude', ['gemini-3-flash']), candidate('claude', [])];
    expect(buildGroupCoverage(candidates, ['kimi-k3'])[0].coverage).toEqual(['gemini-3-flash']);
  });

  test('merges duplicate model ids across credentials of one group', () => {
    const candidates = [
      candidate('claude', ['a', 'b']),
      candidate('claude', ['b', 'c']),
      candidate('codex', ['c']),
    ];
    const groups = buildGroupCoverage(candidates);
    expect(groups.map((group) => group.id)).toEqual(['claude', 'codex']);
    expect(groups[0].coverage).toEqual(['a', 'b', 'c']);
    const counts = countGroupsByModel(groups);
    expect(counts.get('a')).toBe(1);
    expect(counts.get('c')).toBe(2);
  });
});
