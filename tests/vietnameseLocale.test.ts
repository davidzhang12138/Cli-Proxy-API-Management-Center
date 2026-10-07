import { describe, expect, test } from 'bun:test';
import i18n from '@/i18n';

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

describe('Vietnamese locale', () => {
  test('resolves every English key through Vietnamese or the configured fork fallback', async () => {
    const english = flattenLeaves(await Bun.file('src/i18n/locales/en.json').json());
    const vietnamese = flattenLeaves(await Bun.file('src/i18n/locales/vi.json').json());
    const translations = i18n.cloneInstance({ lng: 'vi' });
    // Fork-only strings use the existing zh-CN fallback until translated upstream.
    const missing = Object.keys(english).filter((key) => !translations.exists(key));
    const mismatches = Object.keys(english)
      .filter((key) => key in vietnamese)
      .filter(
        (key) =>
          interpolationTokens(english[key]).sort().join('|') !==
          interpolationTokens(vietnamese[key]).sort().join('|')
      );

    expect(missing).toEqual([]);
    expect(mismatches).toEqual([]);
    expect(translations.t('common.login')).toBe(vietnamese['common.login']);
    expect(translations.t('nav.routing_workbench')).toBe(
      i18n.getFixedT('zh-CN')('nav.routing_workbench')
    );
  });
});
