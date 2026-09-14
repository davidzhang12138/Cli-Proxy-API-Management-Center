/**
 * Provider benchmark contracts.
 *
 * The benchmark runs through the management API's api-call proxy. Credentials
 * stay in memory and are never part of benchmark history or exported results.
 */

export type BenchmarkSource = 'oauth' | 'api-key' | 'openai-compat';

export type BenchmarkProtocol =
  'chat-completions' | 'responses' | 'claude-messages' | 'gemini' | 'interactions';

export type BenchmarkThinkingLevel =
  'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';

export interface BenchmarkModel {
  id: string;
  name: string;
  alias?: string;
}

export interface BenchmarkTarget {
  id: string;
  providerKey: string;
  label: string;
  source: BenchmarkSource;
  identity: string;
  protocol: BenchmarkProtocol | null;
  baseUrl?: string;
  apiKey?: string;
  authIndex?: string;
  headers: Record<string, string>;
  models: BenchmarkModel[];
  enabled: boolean;
  supported: boolean;
  note?: string;
  accountId?: string;
  authFileName?: string;
}

export interface BenchmarkRequestOptions {
  target: BenchmarkTarget;
  model: string;
  prompt: string;
  systemPrompt: string;
  thinkingLevel: BenchmarkThinkingLevel;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface BenchmarkUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface BenchmarkResponse {
  answer: string;
  latencyMs: number;
  statusCode: number;
  usage?: BenchmarkUsage;
}
