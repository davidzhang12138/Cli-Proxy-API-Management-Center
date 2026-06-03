import {
  buildUsageQueryParams,
  normalizeModelPricesResponse,
  usageApi,
  type UsageQueryParams,
} from './usage';
import type { UsageTimeRange } from '@/utils/usage';

const acceptsUsageQueryParams = {
  all: true,
  days: 7,
  start: '2026-05-31T16:00:00.000Z',
  end: '2026-06-01T16:00:00.000Z',
} satisfies UsageQueryParams;

void acceptsUsageQueryParams;

const canFetchUsageWithDateParams = usageApi.getUsage({
  start: '2026-06-01',
  end: '2026-06-02',
});

void canFetchUsageWithDateParams;

const canFetchAuthUsage = usageApi.getAuthUsage({
  auth_index: 'auth-1',
  name: 'codex-user.json',
  include_details: true,
}).then((response) => {
  const windowStart: string = response.window_start;
  const totalTokens: number = response.summary.total_tokens;
  const modelTokens: number | undefined = response.models['gpt-5.5']?.total_tokens;
  const apiKeyRequests: number | undefined = response.api_keys['sk-a']?.total_requests;
  void windowStart;
  void totalTokens;
  void modelTokens;
  void apiKeyRequests;
});

void canFetchAuthUsage;

const normalizedModelPrices = normalizeModelPricesResponse({
  model_prices: {
    'gpt-5.5': {
      prompt: 1.25,
      completion: 2.5,
      cache: 0.125,
    },
  },
});
const normalizedPromptPrice: number | undefined = normalizedModelPrices['gpt-5.5']?.prompt;
void normalizedPromptPrice;

const canFetchModelPrices = usageApi.getModelPrices().then((response) => {
  const prices = normalizeModelPricesResponse(response);
  const completionPrice: number | undefined = prices['gpt-5.5']?.completion;
  void completionPrice;
});

void canFetchModelPrices;

const canReplaceModelPrices = usageApi.replaceModelPrices({
  'gpt-5.5': {
    prompt: 1.25,
    completion: 2.5,
    cache: 0.125,
  },
});

void canReplaceModelPrices;

const usageRange: UsageTimeRange = '24h';
const paramsFromUsageRange = buildUsageQueryParams(usageRange, new Date('2026-06-01T12:00:00Z'));

void paramsFromUsageRange;
