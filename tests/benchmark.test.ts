import { describe, expect, test } from 'bun:test';
import {
  buildBenchmarkRequest,
  extractBenchmarkText,
  extractBenchmarkUsage,
  runBenchmarkRequest,
} from '../src/services/api/benchmark';
import { apiClient } from '../src/services/api/client';
import {
  buildBenchmarkTargets,
  mergeBenchmarkOAuthModels,
  resolveTargetModel,
  targetServesModel,
} from '../src/features/benchmark/benchmark';
import { BENCHMARK_CASES, randomize } from '../src/features/benchmark/logic';
import type { BenchmarkTarget, Config } from '../src/types';

const target = (overrides: Partial<BenchmarkTarget> = {}): BenchmarkTarget => ({
  id: 'target-1',
  providerKey: 'openrouter',
  label: 'OpenRouter · 1',
  source: 'openai-compat',
  identity: 'sk-…1234',
  protocol: 'chat-completions',
  baseUrl: 'https://example.test/v1',
  apiKey: 'secret',
  headers: {},
  models: [{ id: 'gpt-4o', name: 'openai/gpt-4o', alias: 'gpt-4o' }],
  enabled: true,
  supported: true,
  ...overrides,
});

describe('benchmark response normalization', () => {
  test('extracts text from common provider response shapes', () => {
    expect(extractBenchmarkText({ choices: [{ message: { content: 'chat answer' } }] })).toBe(
      'chat answer'
    );
    expect(
      extractBenchmarkText({
        output: [{ content: [{ type: 'output_text', text: 'response answer' }] }],
      })
    ).toBe('response answer');
    expect(
      extractBenchmarkText({ candidates: [{ content: { parts: [{ text: 'gemini answer' }] } }] })
    ).toBe('gemini answer');
  });

  test('normalizes token usage without inventing missing values', () => {
    expect(extractBenchmarkUsage({ usage: { prompt_tokens: 11, completion_tokens: '7' } })).toEqual(
      {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: undefined,
      }
    );
    expect(extractBenchmarkUsage({ answer: 'none' })).toBeUndefined();
  });
});

describe('benchmark wire requests', () => {
  test('uses management api-call auth index and native reasoning effort', () => {
    const request = buildBenchmarkRequest({
      target: target({ authIndex: 'auth-7', apiKey: undefined }),
      model: 'openai/gpt-4o',
      prompt: 'question',
      systemPrompt: 'system',
      thinkingLevel: 'high',
      maxOutputTokens: 400,
    });
    const body = JSON.parse(request.data) as Record<string, unknown>;
    expect(request.authIndex).toBe('auth-7');
    expect(request.header?.Authorization).toBe('Bearer $TOKEN$');
    expect(body.reasoning_effort).toBe('high');
    expect(body.temperature).toBe(0);
  });

  test('uses the pinned backend executor for OpenAI-compatible auth indexes', async () => {
    const originalPost = apiClient.post;
    let request: { url: string; data?: unknown } | undefined;
    apiClient.post = (async (url: string, data?: unknown) => {
      request = { url, data };
      return {
        available: true,
        status_code: 200,
        latency_ms: 12,
        body: { choices: [{ message: { content: 'ok' } }] },
      };
    }) as typeof apiClient.post;

    try {
      const response = await runBenchmarkRequest({
        target: target({ authIndex: 'compat-auth-1' }),
        model: 'openai/gpt-4o',
        prompt: 'question',
        systemPrompt: 'system',
        thinkingLevel: 'high',
        maxOutputTokens: 400,
      });
      expect(response.answer).toBe('ok');
      expect(request).toEqual({
        url: '/auth-files/benchmark',
        data: expect.objectContaining({
          auth_index: 'compat-auth-1',
          model: 'openai/gpt-4o',
          thinking_level: 'high',
        }),
      });
    } finally {
      apiClient.post = originalPost;
    }
  });

  test('maps Claude thinking to native adaptive effort', () => {
    const request = buildBenchmarkRequest({
      target: target({
        providerKey: 'claude',
        protocol: 'claude-messages',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'claude-secret',
        models: [],
      }),
      model: 'claude-sonnet',
      prompt: 'question',
      systemPrompt: 'system',
      thinkingLevel: 'medium',
      maxOutputTokens: 400,
    });
    const body = JSON.parse(request.data) as Record<string, unknown>;
    expect(request.header?.['x-api-key']).toBe('claude-secret');
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'medium' });
    expect(body.max_tokens).toBe(400);
  });
});

describe('benchmark target discovery', () => {
  test('normalizes compatible providers and OAuth files into comparable targets', () => {
    const config: Config = {
      openaiCompatibility: [
        {
          name: 'relay',
          baseUrl: 'https://relay.test/v1',
          apiKeyEntries: [
            { apiKey: 'relay-secret', models: [{ name: 'real-model', alias: 'same-model' }] },
          ],
        },
      ],
    };
    const targets = buildBenchmarkTargets(
      config,
      [
        {
          name: 'claude.json',
          type: 'claude',
          email: 'user@example.test',
          authIndex: 'oauth-1',
        },
      ],
      { claude: ['same-model'] }
    );

    expect(targets).toHaveLength(2);
    const relay = targets.find((item) => item.source === 'openai-compat');
    const oauth = targets.find((item) => item.source === 'oauth');
    expect(relay?.models[0]).toEqual({ id: 'same-model', name: 'real-model', alias: 'same-model' });
    expect(oauth?.supported).toBe(true);
    expect(oauth?.authIndex).toBe('oauth-1');
    expect(targetServesModel(relay!, 'same-model')).toBe(true);
    expect(resolveTargetModel(relay!, 'same-model')).toBe('real-model');
  });

  test('keeps named OAuth files available even when auth index is omitted', () => {
    const [target] = buildBenchmarkTargets({}, [{ name: 'missing.json', type: 'claude' }]);
    expect(target.supported).toBe(true);
    expect(target.authFileName).toBe('missing.json');
  });

  test('uses the backend OpenAI-compatible provider key for OAuth auth files', () => {
    const [target] = buildBenchmarkTargets(
      {},
      [
        {
          name: 'ollama-auth.json',
          type: 'openai-compatibility',
          authIndex: 'ollama-auth',
          attributes: {
            provider_key: 'openai-compatible-ollama',
            compat_name: 'ollama',
          },
        },
      ],
      { 'openai-compatibility': ['deepseek-v4.1-flash'] }
    );
    expect(target.providerKey).toBe('openai-compatible-ollama');
    expect(target.supported).toBe(true);
  });

  test('keeps runtime OAuth model IDs when static definitions are stale', () => {
    const catalog = mergeBenchmarkOAuthModels(
      [{ id: 'deepseek-v4.1-flash' }],
      ['deepseek-v4-flash']
    );
    const [target] = buildBenchmarkTargets(
      {},
      [{ name: 'freebuff.json', type: 'freebuff', authIndex: 'freebuff-auth' }],
      { freebuff: catalog }
    );

    expect(catalog).toEqual(['deepseek-v4-flash', 'deepseek-v4.1-flash']);
    expect(targetServesModel(target, 'deepseek-v4.1-flash')).toBe(true);
  });
});

describe('benchmark scoring helpers', () => {
  test('scores the deterministic standard suite and exposes partial credit', () => {
    const puzzle = BENCHMARK_CASES.find((item) => item.id === 'constraint-json');
    const code = BENCHMARK_CASES.find((item) => item.id === 'async-code');
    const arithmetic = BENCHMARK_CASES.find((item) => item.id === 'arithmetic-json');
    expect(puzzle?.evaluate('{"甲":"绿","乙":"蓝","丙":"红"}').score).toBe(100);
    expect(puzzle?.evaluate('{"甲":"绿"}').score).toBe(33);
    expect(
      code?.evaluate(
        'return Promise.all(values.map(fetchValue)).then((items) => items.reduce((a, b) => a + b, 0));'
      ).score
    ).toBe(100);
    expect(arithmetic?.evaluate('{"amount":736,"formula":"800 * 1.15 * 0.8"}').score).toBe(100);
  });

  test('randomizes a copy without mutating the target order', () => {
    const source = [1, 2, 3, 4];
    const shuffled = randomize(source, () => 0);
    expect(source).toEqual([1, 2, 3, 4]);
    expect(shuffled).toEqual([2, 3, 4, 1]);
  });
});
