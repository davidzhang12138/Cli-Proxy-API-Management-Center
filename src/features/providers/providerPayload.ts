import {
  parsePayloadFilterRules,
  parsePayloadRules,
  parseRawPayloadRules,
  serializePayloadFilterRulesForYaml,
  serializePayloadRulesForYaml,
  serializeRawPayloadRulesForYaml,
} from '@/hooks/useVisualConfig';
import type { PayloadFilterRule, PayloadRule } from '@/types/visualConfig';

export interface ProviderPayloadFormState {
  defaultRules: PayloadRule[];
  defaultRawRules: PayloadRule[];
  overrideRules: PayloadRule[];
  overrideRawRules: PayloadRule[];
  filterRules: PayloadFilterRule[];
}

export const EMPTY_PROVIDER_PAYLOAD: ProviderPayloadFormState = {
  defaultRules: [],
  defaultRawRules: [],
  overrideRules: [],
  overrideRawRules: [],
  filterRules: [],
};

export function parseProviderPayload(raw: unknown): ProviderPayloadFormState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      defaultRules: [],
      defaultRawRules: [],
      overrideRules: [],
      overrideRawRules: [],
      filterRules: [],
    };
  }

  const payload = raw as Record<string, unknown>;
  return {
    defaultRules: parsePayloadRules(payload.default),
    defaultRawRules: parseRawPayloadRules(payload['default-raw']),
    overrideRules: parsePayloadRules(payload.override),
    overrideRawRules: parseRawPayloadRules(payload['override-raw']),
    filterRules: parsePayloadFilterRules(payload.filter),
  };
}

export function serializeProviderPayload(
  state: ProviderPayloadFormState
): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = {};
  const defaultRules = serializePayloadRulesForYaml(state.defaultRules);
  const defaultRawRules = serializeRawPayloadRulesForYaml(state.defaultRawRules);
  const overrideRules = serializePayloadRulesForYaml(state.overrideRules);
  const overrideRawRules = serializeRawPayloadRulesForYaml(state.overrideRawRules);
  const filterRules = serializePayloadFilterRulesForYaml(state.filterRules);

  if (defaultRules.length) payload.default = defaultRules;
  if (defaultRawRules.length) payload['default-raw'] = defaultRawRules;
  if (overrideRules.length) payload.override = overrideRules;
  if (overrideRawRules.length) payload['override-raw'] = overrideRawRules;
  if (filterRules.length) payload.filter = filterRules;

  return Object.keys(payload).length ? payload : undefined;
}
