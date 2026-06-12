import { resolveCodexQuotaWindowMeta } from '@/utils/quota';

const codexWeeklyWindowLabelKey: string | undefined = resolveCodexQuotaWindowMeta({
  resourceType: 'primary_window',
  windowSeconds: 604800,
  isFreePlan: true,
}).labelKey;

void codexWeeklyWindowLabelKey;
