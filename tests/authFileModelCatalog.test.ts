import { describe, expect, test } from 'bun:test';
import {
  mergeAuthFileModels,
  modelsFromUsageQuotaSnapshot,
} from '../src/features/authFiles/modelCatalog';

describe('mergeAuthFileModels', () => {
  test('keeps dynamic models and supplements missing static definitions', () => {
    expect(
      mergeAuthFileModels(
        [{ id: 'dynamic-model', display_name: 'Dynamic' }],
        [
          { id: 'dynamic-model', display_name: 'Static copy' },
          { id: 'fallback-model', display_name: 'Fallback' },
        ]
      )
    ).toEqual([
      { id: 'dynamic-model', display_name: 'Dynamic' },
      { id: 'fallback-model', display_name: 'Fallback' },
    ]);
  });

  test('deduplicates model IDs case-insensitively and trims them', () => {
    expect(
      mergeAuthFileModels(
        [{ id: ' Model-A ' }],
        [{ id: 'model-a' }, { id: 'model-b' }]
      )
    ).toEqual([{ id: 'Model-A' }, { id: 'model-b' }]);
  });

  test('extracts quota models from shared and model-scoped resources', () => {
    expect(
      modelsFromUsageQuotaSnapshot({
        resources: [
          { models: ['shared-model', 'model-a'] },
          { models: ['model-a', 'model-b'] },
          { models: null },
        ],
      })
    ).toEqual([{ id: 'model-a' }, { id: 'model-b' }, { id: 'shared-model' }]);
  });
});
