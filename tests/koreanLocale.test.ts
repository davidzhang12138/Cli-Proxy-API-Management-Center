import { describe, expect, test } from 'bun:test';

const flattenLeaves = (value: unknown, prefix = ''): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? { [prefix]: String(value ?? '') } : {};
  }

  return Object.entries(value).reduce<Record<string, string>>((leaves, [key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return { ...leaves, ...flattenLeaves(child, path) };
  }, {});
};

const interpolationTokens = (value: string): string[] => value.match(/\{\{[^}]+\}\}/g) ?? [];

describe('Korean locale', () => {
  test('covers English keys through Korean strings or the configured zh-CN fallback', async () => {
    const english = flattenLeaves(await Bun.file('src/i18n/locales/en.json').json());
    const korean = flattenLeaves(await Bun.file('src/i18n/locales/ko.json').json());
    const fallback = flattenLeaves(await Bun.file('src/i18n/locales/zh-CN.json').json());
    const resolved = { ...fallback, ...korean };
    const missing = Object.keys(english).filter((key) => !(key in resolved));
    const mismatches = Object.keys(english)
      .filter((key) => key in resolved)
      .filter(
        (key) =>
          interpolationTokens(english[key]).sort().join('|') !==
          interpolationTokens(resolved[key]).sort().join('|')
      );

    expect(missing).toEqual([]);
    expect(mismatches).toEqual([]);
  });
});
