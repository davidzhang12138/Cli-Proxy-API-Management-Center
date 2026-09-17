import { describe, expect, test } from 'bun:test';
import type { CredentialInfo } from '../src/types/sourceInfo';
import { buildChannelDisplay } from '../src/utils/monitor';
import { credentialInfoFromAuthFile } from '../src/utils/usageAuthFileLookup';

const AUTH_INDEX = '2beec9e4f4afdd91';

const withEmail = new Map<string, CredentialInfo>([
  [AUTH_INDEX, { name: 'cline-a', type: 'cline', email: 'kirmeierzakariea696@gmail.com' }],
]);

const withoutEmail = new Map<string, CredentialInfo>([
  [AUTH_INDEX, { name: 'morphllm', type: 'openai' }],
]);

describe('buildChannelDisplay', () => {
  test('pairs the provider name with the credential email', () => {
    expect(buildChannelDisplay('cline', AUTH_INDEX, 'cline', withEmail)).toEqual({
      name: 'cline',
      email: 'kirmeierzakariea696@gmail.com',
      display: 'cline-kirmeierzakariea696@gmail.com',
    });
  });

  test('normalizes the auth index before the lookup', () => {
    expect(buildChannelDisplay('cline', `  ${AUTH_INDEX}  `, 'cline', withEmail).display).toBe(
      'cline-kirmeierzakariea696@gmail.com'
    );
  });

  test('falls back to the masked key when the credential has no email', () => {
    const apiKey = 'sk-2kKjXhEGMASP0c8LjAawvqKpeQvTwPbNrmeXKH875TyA4Ylx';
    expect(buildChannelDisplay(apiKey, AUTH_INDEX, 'morphllm', withoutEmail)).toEqual({
      name: 'morphllm',
      email: null,
      display: 'morphllm (sk-2***4Ylx)',
    });
  });

  /**
   * 无渠道名时不能拼出「sk-2***4Ylx-kirmeier…」这种既非渠道-邮箱、
   * 也不是脱敏 key 的假身份。
   */
  test('never pairs a missing provider name with an email', () => {
    const result = buildChannelDisplay('sk-abc', AUTH_INDEX, null, withEmail);
    expect(result.email).toBeNull();
    expect(result.display).toBe('sk-a***');
  });

  test('ignores an unknown auth index', () => {
    expect(buildChannelDisplay('cline', '', 'cline', withEmail).display).toBe('cline (clin***)');
  });
});

describe('credentialInfoFromAuthFile email', () => {
  test('keeps a trimmed email field', () => {
    expect(
      credentialInfoFromAuthFile({
        auth_index: AUTH_INDEX,
        name: 'codex-a.json',
        email: '  user@example.com  ',
        type: 'Cline',
      })?.[1]
    ).toEqual({
      name: 'cline-user@example.com',
      type: 'cline',
      rawName: 'codex-a.json',
      email: 'user@example.com',
    });
  });

  /**
   * 文件名不是邮箱。后端 api-key 类凭证不下发 email，此时不能拿 name 冒充，
   * 否则渠道列会渲染出「morphllm-codex-a.json」。
   */
  test('does not fall back to name when email is absent', () => {
    expect(
      credentialInfoFromAuthFile({ auth_index: AUTH_INDEX, name: 'codex-a.json', type: 'codex' })?.[1]
        .email
    ).toBeUndefined();
  });

  /** account 在 api-key 类凭证里就是 API key，绝不能当邮箱。 */
  test('ignores account when email is absent', () => {
    expect(
      credentialInfoFromAuthFile({
        auth_index: AUTH_INDEX,
        name: 'kimi.json',
        account: 'sk-secret-key-value',
        type: 'kimi',
      })?.[1]
    ).toEqual({ name: 'kimi.json', type: 'kimi', rawName: 'kimi.json' });
  });
});
