import { describe, expect, test } from 'bun:test';
import {
  applyOAuthModelAliases,
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

  test('drops blank and non-string model IDs', () => {
    expect(
      mergeAuthFileModels(
        [
          { id: '' },
          { id: '   ' },
          { id: 42 as unknown as string },
          { id: 'valid-model' },
        ],
        []
      )
    ).toEqual([{ id: 'valid-model' }]);
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

  test('hides the original model when a non-fork alias is configured', () => {
    expect(
      applyOAuthModelAliases(
        [{ id: 'deepseek-v4-flash', type: 'freebuff' }],
        [{ name: 'deepseek-v4-flash', alias: 'deepseek-v4.1-flash-t' }]
      )
    ).toEqual([
      {
        id: 'deepseek-v4.1-flash-t',
        sourceId: 'deepseek-v4-flash',
        type: 'freebuff',
      },
    ]);
  });

  test('rewrites quota model IDs using non-fork aliases', () => {
    expect(
      modelsFromUsageQuotaSnapshot(
        { resources: [{ models: ['deepseek-v4-flash'] }] },
        [{ name: 'deepseek-v4-flash', alias: 'deepseek-v4.1-flash-t' }]
      )
    ).toEqual([{ id: 'deepseek-v4.1-flash-t', sourceId: 'deepseek-v4-flash' }]);
  });

  test('keeps the original model for fork aliases', () => {
    expect(
      applyOAuthModelAliases(
        [{ id: 'deepseek-v4-flash', type: 'freebuff' }],
        [{ name: 'deepseek-v4-flash', alias: 'deepseek-v4.1-flash-t', fork: true }]
      )
    ).toEqual([
      { id: 'deepseek-v4-flash', type: 'freebuff' },
      {
        id: 'deepseek-v4.1-flash-t',
        sourceId: 'deepseek-v4-flash',
        type: 'freebuff',
      },
    ]);
  });

  test('lets a non-fork alias replace a colliding model ID and keeps the source ID', () => {
    expect(
      applyOAuthModelAliases(
        [
          { id: 'deepseek-v4-pro' },
          { id: 'deepseek-v4-pro-0813', display_name: 'DeepSeek V4 Pro 0813' },
        ],
        [{ name: 'deepseek-v4-pro-0813', alias: 'deepseek-v4-pro' }]
      )
    ).toEqual([
      {
        id: 'deepseek-v4-pro',
        sourceId: 'deepseek-v4-pro-0813',
        display_name: 'DeepSeek V4 Pro 0813',
      },
    ]);
  });
});
