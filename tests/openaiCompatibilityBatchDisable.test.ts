import { describe, expect, test } from 'bun:test';
import { getOpenAIBulkDisableCandidateIndexes } from '../src/features/providers/sheets/forms/useConnectivityTest';
import type { ApiKeyEntryInput } from '../src/features/providers/types';

const entry = (overrides: Partial<ApiKeyEntryInput> = {}): ApiKeyEntryInput => ({
  apiKey: '',
  existingApiKey: 'existing-key',
  disabled: false,
  proxyUrl: '',
  ...overrides,
});

describe('OpenAI compatibility bulk disable candidates', () => {
  test('includes only real request failures', () => {
    expect(
      getOpenAIBulkDisableCandidateIndexes(
        [entry(), entry(), entry()],
        [
          { state: 'success', message: '' },
          { state: 'error', message: '401', canDisable: true },
          { state: 'error', message: 'Test model is required' },
        ]
      )
    ).toEqual([1]);
  });

  test('excludes blank and already-disabled keys', () => {
    expect(
      getOpenAIBulkDisableCandidateIndexes(
        [
          entry({ apiKey: '', existingApiKey: '' }),
          entry({ disabled: true }),
          entry({ existingApiKey: 'active-key' }),
        ],
        [
          { state: 'error', message: 'missing', canDisable: true },
          { state: 'error', message: '401', canDisable: true },
          { state: 'error', message: 'timeout', canDisable: true },
        ]
      )
    ).toEqual([2]);
  });
});
