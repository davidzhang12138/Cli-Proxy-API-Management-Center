export interface ApiKeyEntryLike {
  apiKey?: string;
  existingApiKey?: string;
  disabled?: boolean;
}

export interface ApiKeyEntryAvailabilityStats {
  available: number;
  disabled: number;
}

export const isConfiguredApiKeyEntry = (entry: ApiKeyEntryLike): boolean =>
  Boolean(entry.apiKey?.trim() || entry.existingApiKey?.trim());

export const getApiKeyEntryAvailabilityStats = (
  entries: ApiKeyEntryLike[]
): ApiKeyEntryAvailabilityStats =>
  entries.reduce<ApiKeyEntryAvailabilityStats>(
    (stats, entry) => {
      if (!isConfiguredApiKeyEntry(entry)) return stats;
      if (entry.disabled) {
        stats.disabled += 1;
      } else {
        stats.available += 1;
      }
      return stats;
    },
    { available: 0, disabled: 0 }
  );
