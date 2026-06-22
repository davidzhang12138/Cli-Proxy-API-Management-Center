/**
 * 回退判定逻辑的等价验证。
 * 直接 import 真实的 secondsToDurationString,回退判定代码逐字复制自
 * normalizeOpenAIProvider,确保字符串优先、否则数字/数字字符串回退的协同正确。
 */
import { secondsToDurationString } from './durationString.ts';

const assertEqual = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
};

// 逐字复制 normalizeOpenAIProvider 里的回退判定(仅 min 分支,max 同理)
const resolveMin = (provider: Record<string, unknown>): string | undefined => {
  const quotaBackoffMinRaw = provider['quota-backoff-min'];
  if (typeof quotaBackoffMinRaw === 'string' && quotaBackoffMinRaw.trim()) {
    return quotaBackoffMinRaw.trim();
  }
  const minSeconds = provider['quota-backoff-min-seconds'];
  const minSecNum = typeof minSeconds === 'number' ? minSeconds : Number(minSeconds);
  if (Number.isFinite(minSecNum) && minSecNum > 0) {
    return secondsToDurationString(minSecNum);
  }
  return undefined;
};

// 新字段优先,原样保留
assertEqual(resolveMin({ 'quota-backoff-min': ' 5m ' }), '5m', 'new string field trimmed');

// 新字段为空字符串 → 回退旧数字字段
assertEqual(resolveMin({ 'quota-backoff-min': '', 'quota-backoff-min-seconds': 1800 }), '30m0s', 'fallback to -seconds number');

// 新字段不存在 → 回退旧数字字符串
assertEqual(resolveMin({ 'quota-backoff-min-seconds': '3600' }), '1h0m0s', 'fallback to -seconds numeric string');

// 两者都没有 → undefined
assertEqual(resolveMin({}), undefined, 'no fields -> undefined');

// 旧字段为 0/负数 → 不回退
assertEqual(resolveMin({ 'quota-backoff-min-seconds': 0 }), undefined, 'zero seconds ignored');
assertEqual(resolveMin({ 'quota-backoff-min-seconds': -10 }), undefined, 'negative seconds ignored');

// 新字段空白 → 回退
assertEqual(resolveMin({ 'quota-backoff-min': '   ', 'quota-backoff-min-seconds': 90 }), '1m30s', 'whitespace new field falls back');

console.log('fallback resolution: all assertions passed');
