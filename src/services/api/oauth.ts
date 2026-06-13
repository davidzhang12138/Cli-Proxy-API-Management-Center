/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';

export type OAuthProvider = 'codex' | 'anthropic' | 'antigravity' | 'gemini-cli' | 'kimi' | 'xai';

export interface OAuthStartResponse {
  url: string;
  state?: string;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

export interface OAuthStartOptions {
  projectId?: string;
  proxyUrl?: string;
}

export interface QwenAuthRequest {
  email: string;
  token?: string;
  accessToken?: string;
  password?: string;
  savePassword?: boolean;
  proxyUrl?: string;
  cookies?: string;
  label?: string;
}

export interface QwenAuthResponse {
  status: 'ok';
  provider: 'qwen';
  fileName: string;
  savedPath?: string;
  authId?: string;
  authKind: 'web_token' | 'password';
  hasCookies?: boolean;
}

interface RawQwenAuthResponse {
  status: 'ok';
  provider: 'qwen';
  file_name: string;
  saved_path?: string;
  auth_id?: string;
  auth_kind: 'web_token' | 'password';
  has_cookies?: boolean;
}

const WEBUI_SUPPORTED: OAuthProvider[] = ['codex', 'anthropic', 'antigravity', 'gemini-cli', 'xai'];
const CALLBACK_PROVIDER_MAP: Partial<Record<OAuthProvider, string>> = {
  'gemini-cli': 'gemini',
};

export const oauthApi = {
  startAuth: (provider: OAuthProvider, options?: OAuthStartOptions) => {
    const params: Record<string, string | boolean> = {};
    if (WEBUI_SUPPORTED.includes(provider)) {
      params.is_webui = true;
    }
    if (provider === 'gemini-cli' && options?.projectId) {
      params.project_id = options.projectId;
    }
    const proxyUrl = options?.proxyUrl?.trim();
    if (proxyUrl) {
      params['proxy-url'] = proxyUrl;
    }
    return apiClient.get<OAuthStartResponse>(`/${provider}-auth-url`, {
      params: Object.keys(params).length ? params : undefined,
    });
  },

  getAuthStatus: (state: string) =>
    apiClient.get<{ status: 'ok' | 'wait' | 'error'; error?: string }>(`/get-auth-status`, {
      params: { state },
    }),

  submitCallback: (provider: OAuthProvider, redirectUrl: string) => {
    const callbackProvider = CALLBACK_PROVIDER_MAP[provider] ?? provider;
    return apiClient.post<OAuthCallbackResponse>('/oauth-callback', {
      provider: callbackProvider,
      redirect_url: redirectUrl,
    });
  },
};

export const qwenAuthApi = {
  async submit(input: QwenAuthRequest): Promise<QwenAuthResponse> {
    const payload: Record<string, unknown> = {
      email: input.email.trim(),
    };
    const token = input.token?.trim();
    const accessToken = input.accessToken?.trim();
    const password = input.password?.trim();
    const proxyUrl = input.proxyUrl?.trim();
    const cookies = input.cookies?.trim();
    const label = input.label?.trim();

    if (token) payload.token = token;
    if (accessToken) payload.access_token = accessToken;
    if (password) payload.password = password;
    if (input.savePassword !== undefined) payload.save_password = input.savePassword;
    if (proxyUrl) payload.proxy_url = proxyUrl;
    if (cookies) payload.cookies = cookies;
    if (label) payload.label = label;

    const response = await apiClient.post<RawQwenAuthResponse>('/qwen-auth-url', payload);
    return {
      status: response.status,
      provider: response.provider,
      fileName: response.file_name,
      savedPath: response.saved_path,
      authId: response.auth_id,
      authKind: response.auth_kind,
      hasCookies: response.has_cookies,
    };
  },
};
