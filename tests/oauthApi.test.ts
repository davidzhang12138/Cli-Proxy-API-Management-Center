import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { freebuffAuthApi, oauthApi } from '../src/services/api/oauth';

const originalGet = apiClient.get;
const originalPost = apiClient.post;

afterEach(() => {
  apiClient.get = originalGet;
  apiClient.post = originalPost;
});

describe('OAuth management API', () => {
  test('starts Charm Hyper device OAuth with the scoped proxy and exposes device metadata', async () => {
    let request: { url: string; config?: unknown } | undefined;
    apiClient.get = (async (url: string, config?: unknown) => {
      request = { url, config };
      return {
        status: 'ok',
        url: 'https://auth.hyper.example/device',
        verification_uri: 'https://auth.hyper.example/device',
        user_code: 'ABCD-EFGH',
        device_name: 'Crush (Mias-MacBook-Air.local)',
        device_hostname: 'Mias-MacBook-Air.local',
        state: 'hyp-123',
        flow: 'device',
        expires_in: 900,
      };
    }) as typeof apiClient.get;

    const response = await oauthApi.startAuth('hyper', {
      proxyUrl: '  socks5://127.0.0.1:1080  ',
    });

    expect(request).toEqual({
      url: '/hyper-auth-url',
      config: { params: { 'proxy-url': 'socks5://127.0.0.1:1080' } },
    });
    expect(response).toMatchObject({
      state: 'hyp-123',
      flow: 'device',
      user_code: 'ABCD-EFGH',
      device_name: 'Crush (Mias-MacBook-Air.local)',
      device_hostname: 'Mias-MacBook-Air.local',
      expires_in: 900,
    });
  });

  test('polls Hyper through the shared OAuth status endpoint', async () => {
    let request: { url: string; config?: unknown } | undefined;
    apiClient.get = (async (url: string, config?: unknown) => {
      request = { url, config };
      return { status: 'wait' };
    }) as typeof apiClient.get;

    await oauthApi.getAuthStatus('hyp-123');

    expect(request).toEqual({
      url: '/get-auth-status',
      config: { params: { state: 'hyp-123' } },
    });
  });

  test('keeps the existing Freebuff start and dedicated status contracts intact', async () => {
    const calls: Array<{ method: string; url: string; data?: unknown; config?: unknown }> = [];
    apiClient.get = (async (url: string, config?: unknown) => {
      calls.push({ method: 'GET', url, config });
      return {
        status: 'ok',
        url: 'https://freebuff.example/login',
        fingerprint_id: 'fingerprint-id',
        fingerprint_hash: 'fingerprint-hash',
        expires_at: '2026-08-01T12:00:00Z',
      };
    }) as typeof apiClient.get;
    apiClient.post = (async (url: string, data?: unknown) => {
      calls.push({ method: 'POST', url, data });
      return { status: 'pending' };
    }) as typeof apiClient.post;

    await freebuffAuthApi.startAuth({ proxyUrl: ' direct ' });
    await freebuffAuthApi.getStatus({
      fingerprintId: 'fingerprint-id',
      fingerprintHash: 'fingerprint-hash',
      expiresAt: '2026-08-01T12:00:00Z',
      proxyUrl: ' direct ',
    });

    expect(calls).toEqual([
      {
        method: 'GET',
        url: '/freebuff-auth-url',
        config: { params: { 'proxy-url': 'direct' } },
      },
      {
        method: 'POST',
        url: '/freebuff-auth-status',
        data: {
          fingerprintId: 'fingerprint-id',
          fingerprintHash: 'fingerprint-hash',
          expiresAt: '2026-08-01T12:00:00Z',
          proxy_url: 'direct',
        },
      },
    ]);
  });
});
