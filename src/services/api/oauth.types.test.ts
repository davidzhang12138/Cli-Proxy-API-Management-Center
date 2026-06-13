import type { OAuthStartOptions, QwenAuthRequest } from './oauth';
import { qwenAuthApi } from './oauth';
import { authFilesApi } from './authFiles';

const oauthStartOptionsAcceptsProxyUrl = {
  proxyUrl: 'socks5://127.0.0.1:1080',
} satisfies OAuthStartOptions;

void oauthStartOptionsAcceptsProxyUrl;

const qwenAuthRequestAcceptsTokenOrPassword = {
  email: 'qwen@example.com',
  token: 'web-token',
  password: 'secret-password',
  savePassword: true,
  proxyUrl: 'socks5://127.0.0.1:1080',
  cookies: 'token=web-token',
  label: 'Qwen main',
} satisfies QwenAuthRequest;

void qwenAuthRequestAcceptsTokenOrPassword;

const qwenAuthSubmitReturnsSavedFile = qwenAuthApi
  .submit(qwenAuthRequestAcceptsTokenOrPassword)
  .then((response) => {
    const fileName: string = response.fileName;
    const authKind: 'web_token' | 'password' = response.authKind;
    const hasCookies: boolean | undefined = response.hasCookies;
    void fileName;
    void authKind;
    void hasCookies;
  });

void qwenAuthSubmitReturnsSavedFile;

const authFilesListAcceptsUsageQuota = authFilesApi.list().then((response) => {
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

const authFilesPaginatedListAcceptsFilters = authFilesApi.list({
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

const authQuotaRefreshAcceptsRuntimeIndexes = authFilesApi.refreshAuthQuotas({
  auth_indexes: ['auth-1'],
});

void authQuotaRefreshAcceptsRuntimeIndexes;
