import { describe, expect, test } from 'bun:test';
import { getApiKeyEntryAvailabilityStats } from '../src/features/providers/apiKeyEntryStatus';
import {
  getOpenAIBulkDisableCandidateIndexes,
  getOpenAIBulkDisableGroups,
  OTHER_FAILURE_GROUP_KEY,
} from '../src/features/providers/sheets/forms/useConnectivityTest';
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

  test('groups candidates by HTTP status with network failures last', () => {
    expect(
      getOpenAIBulkDisableGroups(
        [entry(), entry(), entry(), entry(), entry(), entry({ disabled: true })],
        [
          { state: 'error', message: 'unauthorized', canDisable: true, statusCode: 401 },
          { state: 'error', message: 'unauthorized', canDisable: true, statusCode: 401 },
          { state: 'error', message: 'rate limited', canDisable: true, statusCode: 429 },
          { state: 'error', message: 'timeout', canDisable: true },
          { state: 'error', message: 'Test model is required' },
          { state: 'error', message: 'forbidden', canDisable: true, statusCode: 403 },
        ]
      )
    ).toEqual([
      { key: 'http:401', statusCode: 401, count: 2, indexes: [0, 1] },
      { key: 'http:429', statusCode: 429, count: 1, indexes: [2] },
      { key: OTHER_FAILURE_GROUP_KEY, statusCode: undefined, count: 1, indexes: [3] },
    ]);
  });

  test('filters bulk disable candidates by selected error groups', () => {
    const entries = [entry(), entry(), entry()];
    const statuses = [
      { state: 'error' as const, message: 'unauthorized', canDisable: true, statusCode: 401 },
      { state: 'error' as const, message: 'rate limited', canDisable: true, statusCode: 429 },
      { state: 'error' as const, message: 'timeout', canDisable: true },
    ];

    expect(getOpenAIBulkDisableCandidateIndexes(entries, statuses, new Set(['http:429']))).toEqual([
      1,
    ]);
    expect(
      getOpenAIBulkDisableCandidateIndexes(entries, statuses, new Set([OTHER_FAILURE_GROUP_KEY]))
    ).toEqual([2]);
  });
});

describe('OpenAI compatibility key availability stats', () => {
  test('counts configured available and disabled keys while ignoring blank rows', () => {
    expect(
      getApiKeyEntryAvailabilityStats([
        entry(),
        entry({ disabled: true }),
        entry({ apiKey: '', existingApiKey: '' }),
        entry({ apiKey: 'new-key', existingApiKey: undefined }),
      ])
    ).toEqual({ available: 2, disabled: 1 });
  });
});
