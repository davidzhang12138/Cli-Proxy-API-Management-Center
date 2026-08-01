import type { FreebuffQuotaState, UsageQuotaSnapshot } from '@/types';
import { isDisabledAuthFile, isFreebuffFile } from '@/utils/quota';
import type { QuotaProviderData } from '../types';
import { buildUsageQuotaSnapshotState, refreshUsageQuotaSnapshot } from '../usageQuotaRefresh';

export const FREEBUFF_CONFIG: QuotaProviderData<FreebuffQuotaState, UsageQuotaSnapshot> = {
  type: 'freebuff',
  i18nPrefix: 'freebuff_quota',
  filterFn: (file) => isFreebuffFile(file) && !isDisabledAuthFile(file),
  fetchQuota: (file, t) => refreshUsageQuotaSnapshot(file, 'freebuff', 'freebuff_quota', t),
  storeSelector: (state) => state.freebuffQuota,
  storeSetter: 'setFreebuffQuota',
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
