export type ModelPriorities = Record<string, number>;

export type ModelPrioritiesParseResult = {
  value: ModelPriorities | null;
  valid: boolean;
};

export const parseModelPrioritiesText = (text: string): ModelPrioritiesParseResult => {
  const trimmed = text.trim();
  if (!trimmed) return { value: {}, valid: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { value: null, valid: false };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { value: null, valid: false };
  }

  const result: ModelPriorities = {};
  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    const key = rawKey.trim();
    if (!key || typeof rawValue !== 'number' || !Number.isSafeInteger(rawValue)) {
      return { value: null, valid: false };
    }
    result[key] = rawValue;
  }
  return { value: result, valid: true };
};

export const formatModelPrioritiesText = (value?: ModelPriorities): string =>
  JSON.stringify(value ?? {}, null, 2);
