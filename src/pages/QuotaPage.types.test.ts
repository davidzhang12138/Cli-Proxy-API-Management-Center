import type { AuthFilesListOptions } from '@/types';

import { withEnabledAuthFileStatus } from './QuotaPage.helpers';

const quotaAuthFilesListOptions = withEnabledAuthFileStatus({
  page: 1,
  pageSize: 6,
  provider: 'antigravity',
}) satisfies AuthFilesListOptions;

const quotaAuthFilesStatus: 'enabled' = quotaAuthFilesListOptions.status;

void quotaAuthFilesStatus;
