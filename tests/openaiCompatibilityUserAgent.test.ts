import { afterEach, describe, expect, test } from 'bun:test';
import { buildOpenAIConfig } from '../src/features/providers/useProviderWorkbench';
import type { ProviderEntryFormInput } from '../src/features/providers/types';
import { apiClient } from '../src/services/api/client';
import { providersApi } from '../src/services/api/providers';
import { normalizeOpenAIProvider } from '../src/services/api/transformers';

const originalGet = apiClient.get;
const originalPut = apiClient.put;

const formInput = (forwardUserAgent = false): ProviderEntryFormInput => ({
  apiKey: '',
  name: 'compat',
  baseUrl: 'https://compat.example.com/v1',
  proxyUrl: '',
  prefix: '',
  disabled: false,
  disableCooling: false,
  forwardUserAgent,
  models: [],
  headers: [],
  excludedModelsText: '',
  apiKeyEntries: [{ apiKey: 'key', disabled: false, proxyUrl: '' }],
});

afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
});

describe('OpenAI compatibility User-Agent forwarding', () => {
  test('normalizes the backend switch', () => {
    expect(
      normalizeOpenAIProvider({
        name: 'compat',
        'base-url': 'https://compat.example.com/v1',
        'forward-user-agent': true,
      })?.forwardUserAgent
    ).toBe(true);
  });

  test('builds the form value', () => {
    expect(buildOpenAIConfig(formInput(true)).forwardUserAgent).toBe(true);
    expect(buildOpenAIConfig(formInput(false)).forwardUserAgent).toBe(false);
  });

  test('writes and clears the backend field', async () => {
    let putData: unknown;
    apiClient.get = (async () => ({
      'openai-compatibility': [
        {
          name: 'compat',
          'base-url': 'https://compat.example.com/v1',
          'api-key-entries': [{ 'api-key': 'key' }],
          'forward-user-agent': true,
        },
      ],
    })) as typeof apiClient.get;
    apiClient.put = (async (_url: string, data?: unknown) => {
      putData = data;
      return undefined;
    }) as typeof apiClient.put;

    await providersApi.updateOpenAIProvider('compat', 0, buildOpenAIConfig(formInput(false)));

    expect(putData).toEqual([
      {
        name: 'compat',
        'base-url': 'https://compat.example.com/v1',
        'api-key-entries': [{ 'api-key': 'key' }],
        disabled: false,
      },
    ]);
  });
});
