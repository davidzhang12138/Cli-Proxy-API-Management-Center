/**
 * Request adapter for the Provider Benchmark page.
 *
 * The management API's /api-call endpoint is the single transport boundary.
 * This module only builds provider-specific wire requests and normalizes the
 * response text, so the page never needs to know about upstream credentials or
 * protocol-specific response shapes.
 */

import {
  buildClaudeMessagesEndpoint,
  buildCodexResponsesEndpoint,
  buildGeminiGenerateContentEndpoint,
  buildInteractionsEndpoint,
  buildOpenAIChatCompletionsEndpoint,
  INTERACTIONS_API_REVISION,
} from '@/components/providers/utils';
import { isRecord } from '@/utils/helpers';
import { apiClient } from './client';
import { apiCallApi, getApiCallErrorMessage, type ApiCallRequest } from './apiCall';
import type {
  BenchmarkProtocol,
  BenchmarkRequestOptions,
  BenchmarkResponse,
  BenchmarkTarget,
  BenchmarkThinkingLevel,
  BenchmarkUsage,
} from '@/types';

const CODEX_OAUTH_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const hasHeader = (headers: Record<string, string>, name: string): boolean => {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
};

const setHeaderIfMissing = (headers: Record<string, string>, name: string, value: string): void => {
  if (!hasHeader(headers, name)) headers[name] = value;
};

const protocolEffort = (level: BenchmarkThinkingLevel): string => level;

const claudeEffort = (level: BenchmarkThinkingLevel): string | undefined => {
  switch (level) {
    case 'none':
    case 'auto':
      return undefined;
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
    case 'max':
      return 'max';
  }
};

const geminiThinkingBudget = (level: BenchmarkThinkingLevel): number => {
  switch (level) {
    case 'minimal':
      return 512;
    case 'low':
      return 1024;
    case 'medium':
      return 2048;
    case 'high':
      return 4096;
    case 'xhigh':
      return 8192;
    case 'max':
      return 16384;
    case 'auto':
      return -1;
    case 'none':
      return 0;
  }
};

const isGeminiBudgetModel = (model: string): boolean => /gemini[-.]?2\.5/i.test(model);

const geminiThinkingLevel = (level: BenchmarkThinkingLevel): string => {
  if (level === 'minimal') return 'minimal';
  if (level === 'low') return 'low';
  if (level === 'medium') return 'medium';
  if (level === 'none') return 'none';
  if (level === 'auto') return 'auto';
  return 'high';
};

const buildEndpoint = (target: BenchmarkTarget, model: string): string => {
  if (!target.protocol) return '';

  switch (target.protocol) {
    case 'chat-completions':
      return buildOpenAIChatCompletionsEndpoint(target.baseUrl ?? '');
    case 'responses':
      if (target.source === 'oauth' && target.providerKey === 'codex') {
        return CODEX_OAUTH_RESPONSES_URL;
      }
      return buildCodexResponsesEndpoint(target.baseUrl ?? '');
    case 'claude-messages':
      return buildClaudeMessagesEndpoint(target.baseUrl ?? '');
    case 'gemini':
      return buildGeminiGenerateContentEndpoint(target.baseUrl ?? '', model);
    case 'interactions':
      return buildInteractionsEndpoint(target.baseUrl ?? '');
  }
  return '';
};

const buildHeaders = (target: BenchmarkTarget): Record<string, string> => {
  const headers = { ...target.headers };
  const token = target.authIndex ? '$TOKEN$' : target.apiKey?.trim() || '';

  switch (target.protocol) {
    case 'claude-messages':
      setHeaderIfMissing(headers, 'anthropic-version', DEFAULT_ANTHROPIC_VERSION);
      if (token) setHeaderIfMissing(headers, 'x-api-key', token);
      break;
    case 'gemini':
    case 'interactions':
      if (token) setHeaderIfMissing(headers, 'x-goog-api-key', token);
      if (target.protocol === 'interactions') {
        setHeaderIfMissing(headers, 'api-revision', INTERACTIONS_API_REVISION);
      }
      break;
    case 'chat-completions':
    case 'responses':
      if (token) setHeaderIfMissing(headers, 'Authorization', `Bearer ${token}`);
      break;
    default:
      break;
  }

  setHeaderIfMissing(headers, 'content-type', 'application/json');
  return headers;
};

const buildThinkingFields = (
  protocol: BenchmarkProtocol,
  level: BenchmarkThinkingLevel,
  model: string
): Record<string, unknown> => {
  const effort = protocolEffort(level);

  if (protocol === 'responses') {
    return effort ? { reasoning: { effort } } : {};
  }
  if (protocol === 'chat-completions') {
    return effort ? { reasoning_effort: effort } : {};
  }
  if (protocol === 'claude-messages') {
    if (level === 'none') return { thinking: { type: 'disabled' } };
    if (level === 'auto') return { thinking: { type: 'adaptive' } };
    return {
      thinking: { type: 'adaptive' },
      output_config: { effort: claudeEffort(level) },
    };
  }
  if (protocol === 'gemini') {
    return isGeminiBudgetModel(model)
      ? { generationConfig: { thinkingConfig: { thinkingBudget: geminiThinkingBudget(level) } } }
      : {
          generationConfig: {
            thinkingConfig: { thinkingLevel: geminiThinkingLevel(level) },
          },
        };
  }

  // Gemini Interactions exposes the same concept under generation_config.
  return effort ? { generation_config: { thinking_level: effort } } : {};
};

const buildRequestBody = (options: BenchmarkRequestOptions): Record<string, unknown> => {
  const { target, model, prompt, systemPrompt, thinkingLevel, maxOutputTokens } = options;
  if (!target.protocol) throw new Error('This provider does not expose a benchmark protocol');
  const thinking = buildThinkingFields(target.protocol as BenchmarkProtocol, thinkingLevel, model);

  switch (target.protocol) {
    case 'chat-completions':
      return {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        stream: false,
        temperature: 0,
        max_tokens: maxOutputTokens,
        ...thinking,
      };
    case 'responses':
      return {
        model,
        instructions: systemPrompt,
        input: prompt,
        stream: false,
        max_output_tokens: maxOutputTokens,
        ...thinking,
      };
    case 'claude-messages': {
      return {
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxOutputTokens,
        temperature: 0,
        ...thinking,
      };
    }
    case 'gemini':
      return {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens,
          ...(thinking.generationConfig as Record<string, unknown> | undefined),
        },
      };
    case 'interactions':
      return {
        model,
        system_instruction: systemPrompt,
        input: prompt,
        ...thinking,
      };
  }
  throw new Error('Unsupported benchmark protocol');
};

export interface BenchmarkWireRequest extends ApiCallRequest {
  data: string;
}

interface AuthFileBenchmarkPayload {
  available?: boolean;
  status_code?: number;
  message?: string;
  body?: unknown;
  body_text?: string;
  latency_ms?: number;
}

export const buildBenchmarkRequest = (options: BenchmarkRequestOptions): BenchmarkWireRequest => {
  const endpoint = buildEndpoint(options.target, options.model);
  if (!endpoint) throw new Error('This provider does not expose a benchmark endpoint');

  return {
    authIndex: options.target.authIndex,
    method: 'POST',
    url: endpoint,
    header: buildHeaders(options.target),
    data: JSON.stringify(buildRequestBody(options)),
  };
};

const runAuthFileBenchmark = async (
  options: BenchmarkRequestOptions
): Promise<BenchmarkResponse> => {
  const authFileName = options.target.authFileName?.trim();
  const authIndex = options.target.authIndex?.trim();
  if (!authFileName && !authIndex) {
    throw new Error('Auth file target is missing its identity');
  }

  const result = await apiClient.post<AuthFileBenchmarkPayload>('/auth-files/benchmark', {
    ...(authFileName ? { name: authFileName } : {}),
    ...(authIndex ? { auth_index: authIndex } : {}),
    model: options.model,
    prompt: options.prompt,
    system_prompt: options.systemPrompt,
    thinking_level: options.thinkingLevel,
    max_tokens: options.maxOutputTokens,
  });
  const body = result.body ?? result.body_text;
  const statusCode = Number(result.status_code ?? 0);
  if (result.available !== true || (statusCode >= 300 && statusCode > 0)) {
    throw new Error(result.message || `HTTP ${statusCode || 502}`);
  }

  return {
    answer: extractBenchmarkText(body, result.body_text),
    latencyMs: Number(result.latency_ms ?? 0),
    statusCode: statusCode || 200,
    usage: extractBenchmarkUsage(body),
  };
};

const textFromContent = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (isRecord(item)) return textFromContent(item.text ?? item.content ?? item.output_text);
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  if (isRecord(value)) {
    if (isNonEmptyString(value.text)) return value.text;
    if (isNonEmptyString(value.output_text)) return value.output_text;
    if (value.content !== undefined) return textFromContent(value.content);
    if (value.parts !== undefined) return textFromContent(value.parts);
  }
  return '';
};

export const extractBenchmarkText = (body: unknown, bodyText = ''): string => {
  if (typeof body === 'string') return body.trim();
  if (!isRecord(body)) return bodyText.trim();

  const direct = [body.output_text, body.text, body.completion].find(isNonEmptyString);
  if (direct) return direct.trim();

  const choices = body.choices;
  if (Array.isArray(choices) && choices[0] && isRecord(choices[0])) {
    const choice = choices[0];
    const message = isRecord(choice.message) ? choice.message.content : undefined;
    const content = textFromContent(message ?? choice.text);
    if (content) return content.trim();
  }

  const output = body.output;
  if (output !== undefined) {
    const content = textFromContent(output);
    if (content) return content.trim();
  }

  const candidates = body.candidates;
  if (Array.isArray(candidates) && candidates[0] && isRecord(candidates[0])) {
    const candidate = candidates[0];
    const content = textFromContent(candidate.content ?? candidate.output);
    if (content) return content.trim();
  }

  const fallback = textFromContent(body.content ?? body.response ?? body.result);
  return fallback.trim() || bodyText.trim();
};

const numberField = (value: unknown): number | undefined => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
};

export const extractBenchmarkUsage = (body: unknown): BenchmarkUsage | undefined => {
  if (!isRecord(body) || !isRecord(body.usage)) return undefined;
  const usage = body.usage;
  const inputTokens = numberField(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = numberField(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = numberField(usage.total_tokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens };
};

export async function runBenchmarkRequest(
  options: BenchmarkRequestOptions
): Promise<BenchmarkResponse> {
  if (options.target.source === 'oauth') {
    return runAuthFileBenchmark(options);
  }

  const startedAt = Date.now();
  const request = buildBenchmarkRequest(options);
  const result = await apiCallApi.request(request, {
    timeout: 120_000,
    signal: options.signal,
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(getApiCallErrorMessage(result));
  }

  return {
    answer: extractBenchmarkText(result.body ?? result.bodyText, result.bodyText),
    latencyMs: Math.max(0, Date.now() - startedAt),
    statusCode: result.statusCode,
    usage: extractBenchmarkUsage(result.body),
  };
}
