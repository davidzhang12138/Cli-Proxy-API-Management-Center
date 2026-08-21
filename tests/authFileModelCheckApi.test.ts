import { afterEach, expect, test } from 'bun:test';
import { authFilesApi } from '../src/services/api/authFiles';
import { apiClient } from '../src/services/api/client';

const originalPost = apiClient.post;

afterEach(() => {
  apiClient.post = originalPost;
});

test('checks an OAuth model with the stable auth index', async () => {
  let request: { url: string; data?: unknown } | undefined;
  apiClient.post = (async (url: string, data?: unknown) => {
    request = { url, data };
    return { available: true, status_code: 200, latency_ms: 12 };
  }) as typeof apiClient.post;

  const result = await authFilesApi.checkModel('codex-user.json', 'gpt-5.6-sol', 'auth-123');

  expect(request).toEqual({
    url: '/auth-files/model-check',
    data: {
      name: 'codex-user.json',
      model: 'gpt-5.6-sol',
      auth_index: 'auth-123',
    },
  });
  expect(result.available).toBe(true);
});
