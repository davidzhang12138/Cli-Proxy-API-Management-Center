/**
 * Dev-only stand-in for a CLI Proxy API backend, so the dev server can be
 * driven without a real instance. Started by `bun run dev:mock`.
 *
 * Holds config in memory: PUT/PATCH mutate it, so save flows round-trip.
 * Deliberately seeded with one uniform group (codex, both keys priority 5)
 * and one divergent group (claude, priorities 7/7/2).
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_API_PORT ?? 8317);

const CONFIG = {
  'routing-strategy': 'round-robin',
  'codex-api-key': [
    { 'api-key': 'sk-codex-aaaaaaaaAAAAAAAAAAAAAAAA', priority: 5, 'base-url': 'https://codex.example.com' },
    { 'api-key': 'sk-codex-bbbbbbbbBBBBBBBBBBBBBBBB', priority: 5 },
  ],
  'claude-api-key': [
    { 'api-key': 'sk-ant-ccccccccCCCCCCCCCCCCCCCC', priority: 7 },
    { 'api-key': 'sk-ant-ddddddddDDDDDDDDDDDDDDDD', priority: 7 },
    { 'api-key': 'sk-ant-eeeeeeeeEEEEEEEEEEEEEEEE', priority: 2 },
  ],
  'gemini-api-key': [
    { 'api-key': 'AIzaSyGeminiKEY1111111111111111111', priority: 4, weight: 2 },
  ],
  'xai-api-key': [{ 'api-key': 'xai-1111111111111111111111111111', priority: 1 }],
  'openai-compatibility': [
    {
      name: 'hypercharm',
      'base-url': 'https://api.hypercharm.example.com',
      'api-key-entries': [
        { 'api-key': 'sk-hc-111111111111111111111111', weight: 3 },
        { 'api-key': 'sk-hc-222222222222222222222222', weight: 1 },
      ],
      models: [{ name: 'deepseek-v4-pro', alias: 'deepseek-v4-pro' }],
    },
  ],
};

const AUTH_FILES = {
  files: [
    { name: 'antigravity-acct.json', type: 'gemini', email: 'antigravity@example.com', priority: 9 },
    { name: 'codex-team.json', type: 'codex', email: 'codex@example.com', priority: 5 },
    { name: 'freebuff.json', type: 'claude', email: 'freebuff@example.com', priority: 0 },
    { name: 'hyper.json', type: 'gemini', email: 'hyper@example.com', disabled: true },
    {
      name: 'morphllm.json',
      type: 'openai',
      email: 'morph@example.com',
      status: 'error',
      statusMessage: 'token refresh failed',
    },
    { name: 'vertex-runtime.json', type: 'vertex', email: 'vertex@example.com', runtimeOnly: true },
  ],
};

const CATALOG = [
  'claude-opus-4-6-thinking',
  'claude-sonnet-4-6',
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'gemini-3-flash',
  'gemini-3.7-flash-high',
  'kimi-k3',
  'gpt-5-codex',
];

// Per-credential catalogs. Deliberately different per file so the model column
// proves it is reading each credential's own endpoint.
const FILE_MODELS = {
  'antigravity-acct.json': ['gemini-3-flash', 'gemini-3.7-flash-high'],
  'codex-team.json': ['gpt-5-codex', 'kimi-k3'],
  'freebuff.json': ['claude-opus-4-6', 'claude-sonnet-4-6'],
  'hyper.json': ['gemini-3-flash'],
  'morphllm.json': ['deepseek-v4-pro'],
  'vertex-runtime.json': ['gemini-3-flash'],
};

const OAUTH_ALIASES = {
  claude: [{ name: 'claude-opus-4-6', alias: 'claude-opus-4-6-thinking' }],
};

const json = (res, payload, status = 200) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-CPA-Version': '1.4.2-mock',
    'X-CPA-Support-Plugin': 'true',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*',
  });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });

const server = createServer(async (req, res) => {
  const path = (req.url ?? '').split('?')[0];

  if (req.method === 'OPTIONS') return json(res, {});

  if (req.method === 'GET') {
    if (path.endsWith('/config')) return json(res, CONFIG);
    if (path.endsWith('/auth-files/models')) {
      const name = decodeURIComponent((req.url.split('?')[1] ?? '').replace(/^name=/, ''));
      console.log(`GET auth-files/models?name=${name}`);
      return json(res, { models: (FILE_MODELS[name] ?? []).map((id) => ({ id })) });
    }
    if (path.endsWith('/auth-files')) return json(res, AUTH_FILES);
    if (path.endsWith('/auth-quotas')) return json(res, { quotas: {} });
    if (path.endsWith('/api-keys')) return json(res, { 'api-keys': ['sk-mgmt-mock'] });
    if (path.endsWith('/oauth-model-alias')) return json(res, OAUTH_ALIASES);
    if (path.endsWith('/routing/strategy')) return json(res, { strategy: CONFIG['routing-strategy'] });
    if (path.endsWith('/models')) return json(res, { data: CATALOG.map((id) => ({ id })) });
    return json(res, {});
  }

  if (req.method === 'PUT') {
    const payload = await readBody(req);
    const section = path.split('/').pop();
    if (section === 'strategy') {
      CONFIG['routing-strategy'] = payload.value ?? 'round-robin';
      console.log(`PUT strategy -> ${CONFIG['routing-strategy']}`);
    } else if (Array.isArray(payload) && section in CONFIG) {
      CONFIG[section] = payload;
      console.log(`PUT ${section} -> ${payload.length} entries`);
      for (const item of payload) {
        const shown = {};
        for (const key of ['api-key', 'priority', 'weight']) {
          if (key in item) shown[key] = item[key];
        }
        if (Object.keys(shown).length) console.log('   ', JSON.stringify(shown));
      }
    }
    return json(res, {});
  }

  if (req.method === 'PATCH') {
    const payload = await readBody(req);
    if (path.endsWith('/auth-files/fields')) {
      const file = AUTH_FILES.files.find((item) => item.name === payload.name);
      if (file) {
        Object.assign(file, Object.fromEntries(Object.entries(payload).filter(([k]) => k !== 'name')));
        console.log(`PATCH ${file.name} -> priority=${file.priority} weight=${file.weight}`);
      }
    }
    return json(res, {});
  }

  json(res, {});
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock CPA management API on http://localhost:${PORT}`);
});
