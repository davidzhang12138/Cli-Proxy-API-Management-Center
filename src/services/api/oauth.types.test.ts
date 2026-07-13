import type { OAuthStartOptions } from './oauth';
import { authFilesApi } from './authFiles';

const oauthStartOptionsAcceptsProxyUrl = {
  proxyUrl: 'socks5://127.0.0.1:1080',
} satisfies OAuthStartOptions;

void oauthStartOptionsAcceptsProxyUrl;

const acceptsAuthFilesApi = (api: typeof authFilesApi) => {
  const authFilesListAcceptsUsageQuota = api.list().then((response) => {
    const totalFromPagination: number | undefined = response.pagination?.total;
    const providerCategoryCount: number | undefined = response.categories?.providers?.[0]?.count;
    void totalFromPagination;
    void providerCategoryCount;

    response.files.forEach((file) => {
      const quota = file.usage_quota ?? file.usageQuota;
      if (quota?.known) {
        const remaining: number | string | null | undefined = quota.remaining;
        void remaining;
      }
    });
  });
  void authFilesListAcceptsUsageQuota;

  const authFilesPaginatedListAcceptsFilters = api.list({
    page: 1,
    pageSize: 50,
    provider: 'kiro',
    status: 'active',
    search: 'team-a',
    quotaFilter: 'has',
    sort: 'quota_desc',
    problemOnly: true,
  });
  void authFilesPaginatedListAcceptsFilters;

  const authQuotaRefreshAcceptsRuntimeIndexes = api.refreshAuthQuotas({
    auth_indexes: ['auth-1'],
  });
  void authQuotaRefreshAcceptsRuntimeIndexes;
};

void acceptsAuthFilesApi;
