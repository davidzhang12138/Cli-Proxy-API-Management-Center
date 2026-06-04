export const ALL_PROVIDER_FILTER = 'all';

export const normalizeProviderScope = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/_/g, '-');
  const normalized = key === 'x-ai' || key === 'grok' ? 'xai' : key;
  return normalized && normalized !== ALL_PROVIDER_FILTER ? normalized : null;
};

export const resolveProviderScopeFromSearchValues = (
  ...searchValues: Array<string | null | undefined>
): string | null => {
  for (const value of searchValues) {
    if (typeof value !== 'string' || value.trim() === '') continue;
    const params = new URLSearchParams(value.startsWith('?') ? value : `?${value}`);
    const provider = normalizeProviderScope(params.get('provider'));
    if (provider) return provider;
  }
  return null;
};

export const readBrowserProviderScope = (routeProvider?: string | null): string | null =>
  normalizeProviderScope(routeProvider) ??
  (typeof window === 'undefined'
    ? null
    : resolveProviderScopeFromSearchValues(window.location.search));

export const resolveProviderFilterValue = (
  filter: string,
  providerScope?: string | null
): string | undefined =>
  normalizeProviderScope(providerScope) ?? normalizeProviderScope(filter) ?? undefined;

export const resolveProviderUiFilterValue = (
  filter: string,
  providerScope?: string | null
): string => resolveProviderFilterValue(filter, providerScope) ?? ALL_PROVIDER_FILTER;
