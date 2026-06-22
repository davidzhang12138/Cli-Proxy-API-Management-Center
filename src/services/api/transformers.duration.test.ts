import { secondsToDurationString } from './durationString.ts';

const assertEqual = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
};

// 整秒 → 秒段
assertEqual(secondsToDurationString(30), '30s', '30s');

// 整分(秒数 = 60 的倍数)→ 分+秒,秒段保留 0
assertEqual(secondsToDurationString(1800), '30m0s', '1800s -> 30m0s');

// 整时
assertEqual(secondsToDurationString(3600), '1h0m0s', '3600s -> 1h0m0s');

// 时分秒混合
assertEqual(secondsToDurationString(90), '1m30s', '90s -> 1m30s');
assertEqual(secondsToDurationString(5410), '1h30m10s', '5410s -> 1h30m10s');

// 0 / 非正 → 退化处理(返回 '0s')
assertEqual(secondsToDurationString(0), '0s', '0 -> 0s');
assertEqual(secondsToDurationString(-5), '0s', 'negative -> 0s');

console.log('secondsToDurationString: all assertions passed');
