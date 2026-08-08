import { describe, expect, test } from 'bun:test';
import { mergeAuthQuotaSnapshots, normalizeAuthFilesResponse } from '../src/services/api/authFiles';
import type { AuthFilesResponse } from '../src/types/authFile';

const responseWithRawFiles = (files: Array<Record<string, unknown>>): AuthFilesResponse =>
  ({ files }) as unknown as AuthFilesResponse;

describe('auth-files response normalization', () => {
  test('normalizes WRR weights while preserving zero and negative values', () => {
    const result = normalizeAuthFilesResponse(
      responseWithRawFiles([
        { name: 'positive.json', weight: 5 },
        { name: 'string.json', weight: '7' },
        { name: 'zero.json', weight: 0 },
        { name: 'negative.json', weight: -2 },
      ])
    );

    expect(result.files.map((file) => file.weight)).toEqual([-2, 5, 7, 0]);
  });

  test('omits missing, fractional, and unsafe WRR weights from the normalized field', () => {
    const result = normalizeAuthFilesResponse(
      responseWithRawFiles([
        { name: 'missing.json' },
        { name: 'fractional.json', weight: '1.5' },
        { name: 'unsafe.json', weight: Number.MAX_SAFE_INTEGER + 1 },
      ])
    );

    expect(result.files.map((file) => file.weight)).toEqual([undefined, undefined, undefined]);
  });

  test('applies the same safe-integer normalization to priority', () => {
    const result = normalizeAuthFilesResponse(
      responseWithRawFiles([
        { name: 'valid.json', priority: '-3' },
        { name: 'invalid.json', priority: '3.5' },
      ])
    );

    expect(result.files.map((file) => file.priority)).toEqual([undefined, -3]);
  });

  test('surfaces the trimmed account email', () => {
    const result = normalizeAuthFilesResponse(
      responseWithRawFiles([{ name: 'codex-a.json', email: '  user@example.com  ' }])
    );

    expect(result.files[0]?.email).toBe('user@example.com');
  });

  test('leaves an empty backend email as the raw empty string', () => {
    const result = normalizeAuthFilesResponse(
      responseWithRawFiles([{ name: 'kimi-1.json', email: '' }])
    );

    expect(result.files[0]?.email).toBe('');
  });

  test('normalizes project_id to projectId while keeping the raw key', () => {
    const result = normalizeAuthFilesResponse(
      responseWithRawFiles([{ name: 'vertex-a.json', project_id: ' my-proj ' }])
    );

    expect(result.files[0]?.projectId).toBe('my-proj');
    expect(result.files[0]?.project_id).toBe(' my-proj ');
  });

  test('recovers a non-empty email from the lower-priority duplicate entry', () => {
    const result = normalizeAuthFilesResponse(
      responseWithRawFiles([
        { name: 'codex-a.json', source: 'file', path: '/auths/codex-a.json', email: '' },
        { name: 'codex-a.json', source: 'memory', email: 'user@example.com' },
      ])
    );

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.email).toBe('user@example.com');
  });

  test('prefers the higher-scored entry when both emails are non-empty and differ', () => {
    const result = normalizeAuthFilesResponse(
      responseWithRawFiles([
        { name: 'codex-a.json', source: 'memory', email: 'stale@example.com' },
        {
          name: 'codex-a.json',
          source: 'file',
          path: '/auths/codex-a.json',
          email: 'fresh@example.com',
        },
      ])
    );

    expect(result.files[0]?.email).toBe('fresh@example.com');
  });

  test('passes account through raw without deriving a camelCase field', () => {
    const result = normalizeAuthFilesResponse(
      responseWithRawFiles([
        { name: 'gemini-apikey.json', account: 'sk-live-abcd', account_type: 'api_key' },
      ])
    );

    expect(result.files[0]?.account).toBe('sk-live-abcd');
    expect(result.files[0]?.accountType).toBeUndefined();
  });

  test('preserves quota summary fields for matched and synthetic auth entries', () => {
    const result = mergeAuthQuotaSnapshots(
      responseWithRawFiles([{ id: 'matched', name: 'matched.json', type: 'freebuff' }]),
      {
        auths: [
          {
            id: 'matched',
            provider: 'freebuff',
            usage_quota: null,
            quota_supported: true,
            quota_status: 'available',
            quota_remaining_ratio: 0.8,
            quota_next_reset: '2026-08-09T07:00:00Z',
          },
          {
            id: 'synthetic',
            auth_index: 'freebuff:synthetic',
            provider: 'freebuff',
            label: 'Synthetic FreeBuff',
            usage_quota: { known: true },
            quotaSupported: true,
            quotaStatus: 'partial',
            quotaRemainingRatio: 0.5,
            quotaNextReset: '2026-08-10T07:00:00Z',
          },
        ],
      }
    );

    const matched = result.files.find((file) => file.id === 'matched');
    expect(matched).toMatchObject({
      quota_supported: true,
      quotaSupported: true,
      quota_status: 'available',
      quotaStatus: 'available',
      quota_remaining_ratio: 0.8,
      quotaRemainingRatio: 0.8,
      quota_next_reset: '2026-08-09T07:00:00Z',
      quotaNextReset: '2026-08-09T07:00:00Z',
    });

    const synthetic = result.files.find((file) => file.id === 'synthetic');
    expect(synthetic).toMatchObject({
      runtimeOnly: true,
      quota_supported: true,
      quotaSupported: true,
      quota_status: 'partial',
      quotaStatus: 'partial',
      quota_remaining_ratio: 0.5,
      quotaRemainingRatio: 0.5,
      quota_next_reset: '2026-08-10T07:00:00Z',
      quotaNextReset: '2026-08-10T07:00:00Z',
    });
  });
});
