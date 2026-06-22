/**
 * quota-backoff 读取链路的集成验证:直接调用真实 normalizeConfigResponse,
 * 覆盖 normalizeOpenAIProvider 的回退分支(字符串优先 -> 否则 -seconds 回退)。
 *
 * 运行:npx tsx src/services/api/transformers.fallback.test.ts
 * (tsx 解析 tsconfig paths,可处理 @/ 别名,故能直接调真实实现而非复制逻辑)
 */
import { normalizeConfigResponse } from './transformers.ts';

const assertEqual = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
};

const resolve = (provider: Record<string, unknown>) => {
  const cfg = normalizeConfigResponse({ 'openai-compatibility': [provider] });
  const entry = cfg.openaiCompatibility?.[0];
  return { min: entry?.quotaBackoffMin, max: entry?.quotaBackoffMax };
};

// 新字段优先,原样保留(含 trim)
assertEqual(
  resolve({ name: 'a', 'base-url': 'http://a', 'quota-backoff-min': ' 5m ' }).min,
  '5m',
  'new string field trimmed'
);

// 新字段为空字符串 -> 回退旧数字字段
assertEqual(
  resolve({
    name: 'a',
    'base-url': 'http://a',
    'quota-backoff-min': '',
    'quota-backoff-min-seconds': 1800,
  }).min,
  '30m0s',
  'fallback to -seconds number'
);

// 新字段不存在 -> 回退旧数字字符串
assertEqual(
  resolve({ name: 'a', 'base-url': 'http://a', 'quota-backoff-min-seconds': '3600' }).min,
  '1h0m0s',
  'fallback to -seconds numeric string'
);

// 两者都没有 -> undefined
assertEqual(
  resolve({ name: 'a', 'base-url': 'http://a' }).min,
  undefined,
  'no fields -> undefined'
);

// 旧字段为 0/负数 -> 不回退
assertEqual(
  resolve({ name: 'a', 'base-url': 'http://a', 'quota-backoff-min-seconds': 0 }).min,
  undefined,
  'zero seconds ignored'
);
assertEqual(
  resolve({ name: 'a', 'base-url': 'http://a', 'quota-backoff-min-seconds': -10 }).min,
  undefined,
  'negative seconds ignored'
);

// 新字段空白 -> 回退
assertEqual(
  resolve({
    name: 'a',
    'base-url': 'http://a',
    'quota-backoff-min': '   ',
    'quota-backoff-min-seconds': 90,
  }).min,
  '1m30s',
  'whitespace new field falls back'
);

// max 分支同样回退(对称覆盖,防字段名拼写回归)
assertEqual(
  resolve({ name: 'a', 'base-url': 'http://a', 'quota-backoff-max-seconds': 1800 }).max,
  '30m0s',
  'max fallback to -seconds number'
);
assertEqual(
  resolve({ name: 'a', 'base-url': 'http://a', 'quota-backoff-max': '2h' }).max,
  '2h',
  'max new string field'
);

console.log('fallback resolution: all assertions passed');
