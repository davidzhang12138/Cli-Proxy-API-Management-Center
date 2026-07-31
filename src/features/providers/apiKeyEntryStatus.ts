interface ApiKeyEntryLike {
  apiKey?: string;
  existingApiKey?: string;
  disabled?: boolean;
}

export interface ApiKeyEntryAvailabilityStats {
  available: number;
  disabled: number;
}

export const getApiKeyEntryAvailabilityStats = (
  entries: ApiKeyEntryLike[]
): ApiKeyEntryAvailabilityStats =>
  entries.reduce<ApiKeyEntryAvailabilityStats>(
    (stats, entry) => {
      const configured = Boolean(entry.apiKey?.trim() || entry.existingApiKey?.trim());
      if (!configured) return stats;
      if (entry.disabled) {
        stats.disabled += 1;
      } else {
        stats.available += 1;
      }
      return stats;
    },
    { available: 0, disabled: 0 }
  );
