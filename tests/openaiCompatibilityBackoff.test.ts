import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { providersApi } from '../src/services/api/providers';

const originalGet = apiClient.get;
const originalPut = apiClient.put;

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

    await providersApi.updateOpenAIProvider('morphllm', 0, {
      name: 'morphllm',
      baseUrl: 'https://morph.example.com/v1',
      apiKeyEntries: [{ apiKey: 'existing-key' }],
      quotaBackoffMin: ' 1h ',
      quotaBackoffMax: ' 5h ',
    });

    expect(putData).toEqual([
      {
        name: 'morphllm',
        'base-url': 'https://morph.example.com/v1',
        'api-key-entries': [{ 'api-key': 'existing-key', 'future-key-field': 'preserved' }],
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

    await providersApi.updateOpenAIProvider('morphllm', 0, {
      name: 'morphllm',
      baseUrl: 'https://morph.example.com/v1',
      apiKeyEntries: [{ apiKey: 'existing-key' }],
      quotaBackoffMin: '   ',
      quotaBackoffMax: '',
    });

    expect(putData).toEqual([
      {
        name: 'morphllm',
        'base-url': 'https://morph.example.com/v1',
        'api-key-entries': [{ 'api-key': 'existing-key' }],
        'future-provider-field': 'preserved',
      },
    ]);
  });
});
