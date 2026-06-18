import type { AuthFilesListOptions } from '@/types';

export type EnabledAuthFilesListOptions = AuthFilesListOptions & { status: 'enabled' };

export const withEnabledAuthFileStatus = (
  options: AuthFilesListOptions = {}
): EnabledAuthFilesListOptions => ({
  ...options,
  status: 'enabled',
});
