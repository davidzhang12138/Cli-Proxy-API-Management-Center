import type { HyperQuotaState, UsageQuotaSnapshot } from '@/types';
import { isDisabledAuthFile, isHyperFile } from '@/utils/quota';
import type { QuotaProviderData } from '../types';
import { buildUsageQuotaSnapshotState, refreshUsageQuotaSnapshot } from '../usageQuotaRefresh';

export const HYPER_CONFIG: QuotaProviderData<HyperQuotaState, UsageQuotaSnapshot> = {
  type: 'hyper',
  i18nPrefix: 'hyper_quota',
  filterFn: (file) => isHyperFile(file) && !isDisabledAuthFile(file),
  fetchQuota: (file, t) => refreshUsageQuotaSnapshot(file, 'hyper', 'hyper_quota', t),
  storeSelector: (state) => state.hyperQuota,
  storeSetter: 'setHyperQuota',
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
