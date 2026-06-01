import {
  buildUsageQueryParams,
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

const usageRange: UsageTimeRange = '24h';
const paramsFromUsageRange = buildUsageQueryParams(usageRange, new Date('2026-06-01T12:00:00Z'));

void paramsFromUsageRange;
