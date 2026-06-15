import { resolveCodexQuotaWindowMeta } from '@/utils/quota';
import { CODEX_CONFIG } from './quotaConfigs';

const codexWeeklyWindowLabelKey: string | undefined = resolveCodexQuotaWindowMeta({
  resourceType: 'primary_window',
  windowSeconds: 604800,
  isFreePlan: true,
}).labelKey;

void codexWeeklyWindowLabelKey;

const codexCanResetQuotaHandlesMissingState: boolean | undefined =
  CODEX_CONFIG.canResetQuota?.(null);

void codexCanResetQuotaHandlesMissingState;
