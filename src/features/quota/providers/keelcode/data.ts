import type { KeelCodeQuotaState, UsageQuotaSnapshot } from '@/types';
import { isDisabledAuthFile, isKeelCodeFile } from '@/utils/quota';
import type { QuotaProviderData } from '../types';
import { buildUsageQuotaSnapshotState, refreshUsageQuotaSnapshot } from '../usageQuotaRefresh';

export const KEELCODE_CONFIG: QuotaProviderData<KeelCodeQuotaState, UsageQuotaSnapshot> = {
  type: 'keelcode',
  i18nPrefix: 'keelcode_quota',
  filterFn: (file) => isKeelCodeFile(file) && !isDisabledAuthFile(file),
  fetchQuota: (file, t) => refreshUsageQuotaSnapshot(file, 'keelcode', 'keelcode_quota', t),
  storeSelector: (state) => state.keelcodeQuota,
  storeSetter: 'setKeelCodeQuota',
  buildLoadingState: () => ({ status: 'loading', snapshot: null }),
  buildSuccessState: (snapshot) => ({ status: 'success', snapshot }),
  buildErrorState: (message, status) => ({
    status: 'error',
    snapshot: null,
    error: message,
    errorStatus: status,
  }),
  buildSnapshotState: (file) => {
    const snapshot = buildUsageQuotaSnapshotState(file);
    return snapshot ? { status: 'success', snapshot } : null;
  },
};
