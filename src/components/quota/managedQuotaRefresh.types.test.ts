import type { AuthFileItem } from '@/types';
import type { ManagedQuotaRefreshResult } from './managedQuotaRefresh';

const refreshedFile: AuthFileItem = {
  name: 'codex-a@example.com-free.json',
  provider: 'codex',
  usage_quota: {
    known: true,
    total_limit: 100,
    current_usage: 100,
    exhausted: true,
  },
};

const managedRefreshResultCarriesUpdatedFile: ManagedQuotaRefreshResult<unknown> = {
  name: refreshedFile.name,
  status: 'success',
  state: {},
  file: refreshedFile,
};

void managedRefreshResultCarriesUpdatedFile;
