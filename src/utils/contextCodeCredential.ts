const DEFAULT_SERVER = 'https://workspace.context.ai';
const DEFAULT_API_PATH = '/api/inference/vercel/v1/ai';

type JsonRecord = Record<string, unknown>;

export interface ContextCodeCredential {
  type: 'context-code';
  auth_kind: 'oauth';
  server: string;
  client_token: string;
  device_id: string;
  device_credential: string;
  org_id: string;
  api_base_url: string;
  user_id?: string;
  selected_workspace_id?: string;
  selected_workspace_name?: string;
  selected_agent_id?: string;
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (value: JsonRecord, ...keys: string[]): string => {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
};

const readReference = (value: JsonRecord, ...keys: string[]): JsonRecord => {
  for (const key of keys) {
    const candidate = value[key];
    if (isRecord(candidate)) return candidate;
  }
  return {};
};

const normalizeHttpUrl = (value: string, label: string): string => {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.host) {
      throw new Error();
    }
    return value.replace(/\/+$/, '');
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) URL`);
  }
};

export const normalizeContextCodeCredential = (value: unknown): ContextCodeCredential => {
  if (!isRecord(value)) throw new Error('credential must be a JSON object');

  const workspace = readReference(value, 'selectedWorkspace', 'selected_workspace');
  const agent = readReference(value, 'selectedAgent', 'selected_agent');
  const clientToken = readString(value, 'clientToken', 'client_token');
  const deviceId = readString(value, 'deviceId', 'device_id');
  const deviceCredential = readString(value, 'deviceCredential', 'device_credential');
  const orgId = readString(value, 'orgId', 'org_id');
  const required = [
    ['clientToken', clientToken],
    ['deviceId', deviceId],
    ['deviceCredential', deviceCredential],
    ['orgId', orgId],
  ];
  const missing = required.filter(([, field]) => !field).map(([name]) => name);
  if (missing.length) throw new Error(`missing required fields: ${missing.join(', ')}`);

  const server = normalizeHttpUrl(readString(value, 'server') || DEFAULT_SERVER, 'server');
  const apiBaseUrl = normalizeHttpUrl(
    readString(value, 'apiBaseUrl', 'api_base_url') || `${server}${DEFAULT_API_PATH}`,
    'apiBaseUrl'
  );
  const userId = readString(value, 'userId', 'user_id');
  const workspaceId =
    readString(workspace, 'id') ||
    readString(
      value,
      'selectedWorkspaceId',
      'selected_workspace_id',
      'workspaceId',
      'workspace_id'
    );
  const workspaceName =
    readString(workspace, 'name') ||
    readString(value, 'selectedWorkspaceName', 'selected_workspace_name');
  const agentId =
    readString(agent, 'id') ||
    readString(value, 'selectedAgentId', 'selected_agent_id', 'agentId', 'agent_id');

  return {
    type: 'context-code',
    auth_kind: 'oauth',
    server,
    client_token: clientToken,
    device_id: deviceId,
    device_credential: deviceCredential,
    org_id: orgId,
    api_base_url: apiBaseUrl,
    ...(userId ? { user_id: userId } : {}),
    ...(workspaceId ? { selected_workspace_id: workspaceId } : {}),
    ...(workspaceName ? { selected_workspace_name: workspaceName } : {}),
    ...(agentId ? { selected_agent_id: agentId } : {}),
  };
};

export const getContextCodeCredentialFileName = async (deviceId: string): Promise<string> => {
  if (!globalThis.crypto?.subtle) {
    // ponytail: 32-bit fallback can collide; replace with SHA-256 if legacy HTTP browsers matter.
    let hash = 2166136261;
    for (const char of deviceId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return `context-code-${hash.toString(16).padStart(8, '0')}.json`;
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(deviceId)
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return `context-code-${hash.slice(0, 24)}.json`;
};
