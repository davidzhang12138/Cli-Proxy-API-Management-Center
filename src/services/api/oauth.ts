/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';
import {
  isManagementOAuthProviderKey,
  normalizeManagementOAuthProviderKey,
} from '@/utils/providerKeys';

export type BuiltInOAuthProvider =
  | 'codex'
  | 'devin'
  | 'anthropic'
  | 'antigravity'
  | 'kimi'
  | 'xai'
  | 'hyper'
  | 'context-code'
  | 'cline';

export type OAuthProvider = BuiltInOAuthProvider | 'freebuff';

export interface OAuthStartResponse {
  url: string;
  state?: string;
  method?: 'device_code';
  flow?: 'device';
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  device_name?: string;
  device_hostname?: string;
  expires_in?: number;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

export interface OAuthStartOptions {
  proxyUrl?: string;
  signal?: AbortSignal;
}

export interface FreebuffStartOptions {
  proxyUrl?: string;
  signal?: AbortSignal;
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

export interface OAuthCancelResponse {
  status: 'ok';
  cancelled: boolean;
}

const WEBUI_SUPPORTED = new Set<string>(['codex', 'anthropic', 'antigravity', 'xai', 'devin']);

const normalizeProviderForManagementPath = (provider: string): string => {
  const key = normalizeManagementOAuthProviderKey(provider);
  if (!isManagementOAuthProviderKey(key)) {
    throw new Error('Invalid OAuth provider');
  }
  return key;
};

export const oauthApi = {
  startAuth: (provider: string, options?: OAuthStartOptions) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    const params: Record<string, string | boolean> = {};
    if (WEBUI_SUPPORTED.has(providerKey)) {
      params.is_webui = true;
    }
    if (providerKey === 'xai') {
      params.device = true;
    }
    const proxyUrl = options?.proxyUrl?.trim();
    if (proxyUrl) {
      params['proxy-url'] = proxyUrl;
    }
    return apiClient.get<OAuthStartResponse>(`/${providerKey}-auth-url`, {
      params: Object.keys(params).length ? params : undefined,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  },

  getAuthStatus: (state: string, signal?: AbortSignal) =>
    apiClient.get<{ status: 'ok' | 'wait' | 'error'; error?: string }>(`/get-auth-status`, {
      params: { state },
      ...(signal ? { signal } : {}),
    }),

  cancelSession: (state: string, signal?: AbortSignal) =>
    apiClient.delete<OAuthCancelResponse>('/oauth-session', {
      params: { state },
      ...(signal ? { signal } : {}),
    }),

  submitCallback: (provider: string, redirectUrl: string, signal?: AbortSignal) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    return apiClient.post<OAuthCallbackResponse>(
      '/oauth-callback',
      { provider: providerKey, redirect_url: redirectUrl },
      signal ? { signal } : undefined
    );
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
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  },

  getStatus: (input: FreebuffStatusRequest, signal?: AbortSignal) => {
    const payload: Record<string, unknown> = {
      fingerprintId: input.fingerprintId,
      fingerprintHash: input.fingerprintHash,
      expiresAt: input.expiresAt,
    };
    const proxyUrl = input.proxyUrl?.trim();
    if (proxyUrl) {
      payload.proxy_url = proxyUrl;
    }
    return apiClient.post<FreebuffStatusResponse>(
      '/freebuff-auth-status',
      payload,
      signal ? { signal } : undefined
    );
  },
};
