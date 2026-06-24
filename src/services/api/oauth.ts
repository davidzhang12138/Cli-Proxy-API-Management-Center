/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';

export type OAuthProvider = 'codex' | 'anthropic' | 'antigravity' | 'kimi' | 'xai' | 'freebuff';

export interface OAuthStartResponse {
  url: string;
  state?: string;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

export interface OAuthStartOptions {
  proxyUrl?: string;
}

export interface FreebuffStartOptions {
  proxyUrl?: string;
}

// 后端返回的原始字段为 snake_case，apiClient 不做命名转换，这里保持一致
export interface FreebuffStartResponse {
  status: 'ok';
  url: string;
  login_url?: string;
  fingerprint_id?: string;
  fingerprint_hash?: string;
  expires_at?: string;
  state?: string;
}

export interface FreebuffStatusRequest {
  fingerprintId: string;
  fingerprintHash: string;
  expiresAt: string;
  proxyUrl?: string;
}

export interface FreebuffStatusResponse {
  status: 'ok' | 'pending';
  token_added?: boolean;
  file_name?: string;
  path?: string;
  user?: { email?: string; name?: string };
  error?: string;
}

const WEBUI_SUPPORTED: OAuthProvider[] = ['codex', 'anthropic', 'antigravity', 'xai'];

export const oauthApi = {
  startAuth: (provider: OAuthProvider, options?: OAuthStartOptions) => {
    const params: Record<string, string | boolean> = {};
    if (WEBUI_SUPPORTED.includes(provider)) {
      params.is_webui = true;
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
    return apiClient.post<OAuthCallbackResponse>('/oauth-callback', {
      provider,
      redirect_url: redirectUrl,
    });
  },
};

export const freebuffAuthApi = {
  startAuth: (options?: FreebuffStartOptions) => {
    const params: Record<string, string> = {};
    const proxyUrl = options?.proxyUrl?.trim();
    if (proxyUrl) {
      params['proxy-url'] = proxyUrl;
    }
    return apiClient.get<FreebuffStartResponse>('/freebuff-auth-url', {
      params: Object.keys(params).length ? params : undefined,
    });
  },

  getStatus: (input: FreebuffStatusRequest) => {
    const payload: Record<string, unknown> = {
      fingerprintId: input.fingerprintId,
      fingerprintHash: input.fingerprintHash,
      expiresAt: input.expiresAt,
    };
    const proxyUrl = input.proxyUrl?.trim();
    if (proxyUrl) {
      payload.proxy_url = proxyUrl;
    }
    return apiClient.post<FreebuffStatusResponse>('/freebuff-auth-status', payload);
  },
};
