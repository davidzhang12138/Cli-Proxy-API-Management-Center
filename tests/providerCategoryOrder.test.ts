import { describe, expect, test } from 'bun:test';
import { sortProviderGroupsByResourceCount } from '../src/features/providers/uiState';

describe('provider category ordering', () => {
  test('puts groups with the most resources first and keeps ties stable', () => {
    const groups = [
      { id: 'kimi', resources: [] },
      { id: 'gemini', resources: [{ id: 1 }] },
      { id: 'openaiCompatibility', resources: [{ id: 2 }, { id: 3 }] },
      { id: 'codex', resources: [{ id: 4 }] },
    ];

    expect(sortProviderGroupsByResourceCount(groups).map((group) => group.id)).toEqual([
      'openaiCompatibility',
      'gemini',
      'codex',
      'kimi',
    ]);
    expect(groups.map((group) => group.id)).toEqual([
      'kimi',
      'gemini',
      'openaiCompatibility',
      'codex',
    ]);
  });
});
