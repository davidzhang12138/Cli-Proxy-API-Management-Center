import type { AuthFilesListOptions } from '@/types';

export type ActiveAuthFilesListOptions = AuthFilesListOptions & { status: 'active' };

export const withActiveAuthFileStatus = (
  options: AuthFilesListOptions = {}
): ActiveAuthFilesListOptions => ({
  ...options,
  status: 'active',
});
