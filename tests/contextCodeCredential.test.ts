import { describe, expect, test } from 'bun:test';
import {
  getContextCodeCredentialFileName,
  normalizeContextCodeCredential,
} from '../src/utils/contextCodeCredential';

describe('Context Code credential import', () => {
  test('converts the official CLI context file into a CPA auth file', async () => {
    const credential = normalizeContextCodeCredential({
      server: 'https://workspace.context.ai/',
      orgId: 'org-1',
      clientToken: 'ctxc-token',
      deviceId: 'device-1',
      deviceCredential: 'ctxd-token',
      userId: 'user-1',
      selectedWorkspace: { id: 'workspace-1', name: 'Main workspace' },
      selectedAgent: { id: 'agent-1' },
    });

    expect(credential).toEqual({
      type: 'context-code',
      server: 'https://workspace.context.ai',
      client_token: 'ctxc-token',
      device_id: 'device-1',
      device_credential: 'ctxd-token',
      org_id: 'org-1',
      api_base_url: 'https://workspace.context.ai/api/inference/vercel/v1/ai',
      user_id: 'user-1',
      selected_workspace_id: 'workspace-1',
      selected_workspace_name: 'Main workspace',
      selected_agent_id: 'agent-1',
    });
    expect(await getContextCodeCredentialFileName(credential.device_id)).toMatch(
      /^context-code-[a-f0-9]{24}\.json$/
    );
  });

  test('rejects incomplete paired-device files', () => {
    expect(() => normalizeContextCodeCredential({ clientToken: 'ctxc-token' })).toThrow(
      'deviceId, deviceCredential, orgId'
    );
  });
});
