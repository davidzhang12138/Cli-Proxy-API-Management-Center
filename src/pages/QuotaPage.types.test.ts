import type { AuthFilesListOptions } from '@/types';

import { withActiveAuthFileStatus } from './QuotaPage.helpers';

const quotaAuthFilesListOptions = withActiveAuthFileStatus({
  page: 1,
  pageSize: 6,
  provider: 'antigravity',
}) satisfies AuthFilesListOptions;

const quotaAuthFilesStatus: 'active' = quotaAuthFilesListOptions.status;

void quotaAuthFilesStatus;
