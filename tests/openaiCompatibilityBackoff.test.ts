import { afterEach, describe, expect, test } from 'bun:test';
import { buildOpenAIConfig } from '../src/features/providers/useProviderWorkbench';
import type { ProviderEntryFormInput } from '../src/features/providers/types';
import { apiClient } from '../src/services/api/client';
import { providersApi } from '../src/services/api/providers';

const originalGet = apiClient.get;
const originalPut = apiClient.put;

const openAIFormInput = (
  overrides: Partial<ProviderEntryFormInput> = {}
): ProviderEntryFormInput => ({
  apiKey: '',
  name: 'morphllm',
  baseUrl: 'https://morph.example.com/v1',
  proxyUrl: '',
  prefix: '',
  disabled: false,
  models: [],
  headers: [],
  excludedModelsText: '',
  apiKeyEntries: [{ apiKey: '', existingApiKey: 'existing-key', proxyUrl: '' }],
  ...overrides,
});

afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
});

describe('OpenAI compatibility quota backoff', () => {
  test('writes duration fields and removes deprecated seconds fields', async () => {
    let putData: unknown;
    apiClient.get = (async () => ({
      'openai-compatibility': [
        {
          name: 'morphllm',
          'base-url': 'https://morph.example.com/v1',
          'api-key-entries': [{ 'api-key': 'existing-key', 'future-key-field': 'preserved' }],
          'quota-backoff-min-seconds': 60,
          'quota-backoff-max-seconds': 300,
          'future-provider-field': 'preserved',
        },
      ],
    })) as typeof apiClient.get;
    apiClient.put = (async (_url: string, data?: unknown) => {
      putData = data;
      return undefined;
    }) as typeof apiClient.put;

    const config = buildOpenAIConfig(
      openAIFormInput({ quotaBackoffMin: ' 1h ', quotaBackoffMax: ' 5h ' })
    );
    await providersApi.updateOpenAIProvider('morphllm', 0, config);

    expect(putData).toEqual([
      {
        name: 'morphllm',
        'base-url': 'https://morph.example.com/v1',
        'api-key-entries': [{ 'api-key': 'existing-key', 'future-key-field': 'preserved' }],
        disabled: false,
        'quota-backoff-min': '1h',
        'quota-backoff-max': '5h',
        'future-provider-field': 'preserved',
      },
    ]);
  });

  test('clears saved duration and deprecated seconds fields when inputs are blank', async () => {
    let putData: unknown;
    apiClient.get = (async () => ({
      'openai-compatibility': [
        {
          name: 'morphllm',
          'base-url': 'https://morph.example.com/v1',
          'api-key-entries': [{ 'api-key': 'existing-key' }],
          'quota-backoff-min': '1h',
          'quota-backoff-max': '5h',
          'quota-backoff-min-seconds': 60,
          'quota-backoff-max-seconds': 300,
          'future-provider-field': 'preserved',
        },
      ],
    })) as typeof apiClient.get;
    apiClient.put = (async (_url: string, data?: unknown) => {
      putData = data;
      return undefined;
    }) as typeof apiClient.put;

    const config = buildOpenAIConfig(
      openAIFormInput({ quotaBackoffMin: '   ', quotaBackoffMax: '' }),
      {
        name: 'morphllm',
        baseUrl: 'https://morph.example.com/v1',
        apiKeyEntries: [{ apiKey: 'existing-key' }],
        quotaBackoffMin: '1h',
        quotaBackoffMax: '5h',
      }
    );
    await providersApi.updateOpenAIProvider('morphllm', 0, config);

    expect(putData).toEqual([
      {
        name: 'morphllm',
        'base-url': 'https://morph.example.com/v1',
        'api-key-entries': [{ 'api-key': 'existing-key' }],
        disabled: false,
        'future-provider-field': 'preserved',
      },
    ]);
  });
});
