import { afterEach, describe, expect, test } from 'bun:test';
import { buildOpenAIConfig } from '../src/features/providers/useProviderWorkbench';
import type { ProviderEntryFormInput } from '../src/features/providers/types';
import { apiClient } from '../src/services/api/client';
import { providersApi } from '../src/services/api/providers';
import { normalizeOpenAIProvider } from '../src/services/api/transformers';

const originalGet = apiClient.get;
const originalPut = apiClient.put;

const modalForm = (): ProviderEntryFormInput => ({
  apiKey: '',
  name: 'modal',
  baseUrl: '',
  proxyUrl: '',
  prefix: '',
  disabled: false,
  models: [],
  headers: [],
  excludedModelsText: '',
  apiKeyEntries: [
    {
      apiKey: 'token-id.token-secret',
      baseUrl: 'https://workspace--app-server.us-east.modal.direct/v1',
      models: [{ name: 'upstream-model', alias: 'modal-model' }],
      disabled: false,
      proxyUrl: '',
    },
  ],
});

afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
});

describe('OpenAI-compatible endpoint overrides', () => {
  test('normalizes a provider with only per-key endpoints', () => {
    const provider = normalizeOpenAIProvider({
      name: 'modal',
      'api-key-entries': [
        {
          'api-key': 'token-id.token-secret',
          'base-url': 'https://workspace--app-server.us-east.modal.direct/v1',
          models: [{ name: 'upstream-model', alias: 'modal-model' }],
        },
      ],
    });

    expect(provider?.baseUrl).toBeUndefined();
    expect(provider?.apiKeyEntries[0]?.baseUrl).toBe(
      'https://workspace--app-server.us-east.modal.direct/v1'
    );
    expect(provider?.apiKeyEntries[0]?.models).toEqual([
      { name: 'upstream-model', alias: 'modal-model' },
    ]);
  });

  test('builds and writes per-key endpoint and model settings', async () => {
    let written: unknown;
    apiClient.get = (async () => ({ 'openai-compatibility': [] })) as typeof apiClient.get;
    apiClient.put = (async (_url: string, data?: unknown) => {
      written = data;
      return undefined;
    }) as typeof apiClient.put;

    await providersApi.createOpenAIProvider(buildOpenAIConfig(modalForm()));

    expect(written).toEqual([
      {
        name: 'modal',
        'api-key-entries': [
          {
            'api-key': 'token-id.token-secret',
            'base-url': 'https://workspace--app-server.us-east.modal.direct/v1',
            models: [{ name: 'upstream-model', alias: 'modal-model' }],
          },
        ],
        disabled: false,
      },
    ]);
  });

  test('preserves unknown fields on endpoint models during updates', async () => {
    let written: unknown;
    apiClient.get = (async () => ({
      'openai-compatibility': [
        {
          name: 'modal',
          'api-key-entries': [
            {
              'api-key': 'token-id.token-secret',
              'base-url': 'https://workspace--app-server.us-east.modal.direct/v1',
              models: [{ name: 'upstream-model', 'future-field': 'preserved' }],
            },
          ],
        },
      ],
    })) as typeof apiClient.get;
    apiClient.put = (async (_url: string, data?: unknown) => {
      written = data;
      return undefined;
    }) as typeof apiClient.put;

    await providersApi.updateOpenAIProvider('modal', 0, buildOpenAIConfig(modalForm()));

    expect(written).toEqual([
      {
        name: 'modal',
        'api-key-entries': [
          {
            'api-key': 'token-id.token-secret',
            'base-url': 'https://workspace--app-server.us-east.modal.direct/v1',
            models: [
              {
                'future-field': 'preserved',
                name: 'upstream-model',
                alias: 'modal-model',
              },
            ],
          },
        ],
        disabled: false,
      },
    ]);
  });
});
