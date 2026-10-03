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
  access: { 'api-keys': ['fixture-client-key'] },
  routing: { strategy: 'round-robin' },
  oauth: {
    // Exercises exact and wildcard exclusions.
    'excluded-models': { claude: ['claude-sonnet-4-6'], gemini: ['gemini-3-flash*'] },
    'model-alias': {
      claude: [{ name: 'claude-opus-4-6', alias: 'claude-opus-4-6-thinking' }],
    },
  },
  'api-keys': {
    codex: [
      {
        name: 'codex-team',
        'base-url': 'https://codex.example.com',
        keys: [
          { 'api-key': 'fixture-codex-a', priority: 5 },
          { 'api-key': 'fixture-codex-b', priority: 5 },
        ],
      },
    ],
    claude: [
      {
        name: 'claude-team',
        keys: [
          { 'api-key': 'fixture-claude-a', priority: 7 },
          { 'api-key': 'fixture-claude-b', priority: 7 },
          { 'api-key': 'fixture-claude-c', priority: 2 },
        ],
      },
    ],
    gemini: [
      {
        name: 'gemini-team',
        keys: [{ 'api-key': 'fixture-gemini', priority: 4, weight: 2 }],
      },
    ],
    xai: [
      {
        name: 'xai-disabled',
        keys: [{ 'api-key': 'fixture-xai', priority: 1, 'excluded-models': ['*'] }],
      },
    ],
    'openai-compatibility': [
      {
        name: 'hypercharm',
        'base-url': 'https://api.hypercharm.example.com',
        keys: [
          { 'api-key': 'fixture-compatible-a', weight: 3 },
          { 'api-key': 'fixture-compatible-b', weight: 1 },
        ],
        models: [{ name: 'deepseek-v4-pro', alias: 'deepseek-v4-pro' }],
      },
    ],
  },
};

const AUTH_FILES = {
  files: [
    {
      name: 'antigravity-acct.json',
      type: 'gemini',
      email: 'antigravity@example.com',
      priority: 9,
    },
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

// What the proxy reports as routable via /v1/models. Deliberately only a subset
// of what /model-definitions advertises, so the intersection is observable:
// gemini-3.7-flash-high is offered but not served, so it must not be listed.
const SERVED = [
  'gemini-3-flash',
  'claude-opus-4-6',
  'claude-opus-4-6-thinking',
  'gpt-5-codex',
  'kimi-k3',
  'deepseek-v4-pro',
];

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

// Per-provider catalogs, served by the same batch endpoint the real backend
// exposes. Distinct per provider so the model column proves it reads them.
const PROVIDER_MODELS = {
  gemini: ['gemini-3-flash', 'gemini-3.7-flash-high'],
  codex: ['gpt-5-codex', 'kimi-k3'],
  claude: ['claude-opus-4-6', 'claude-sonnet-4-6'],
  vertex: ['gemini-3-flash'],
  openai: ['deepseek-v4-pro'],
};

const json = (res, payload, status = 200) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-CPA-Version': 'v8.0.0-mock',
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
    if (path.includes('/model-definitions/')) {
      const provider = decodeURIComponent(path.split('/model-definitions/')[1] ?? '');
      console.log(`GET model-definitions/${provider}`);
      return json(res, { models: (PROVIDER_MODELS[provider] ?? []).map((id) => ({ id })) });
    }
    if (path.endsWith('/credentials')) return json(res, AUTH_FILES);
    if (path.endsWith('/auth-quotas')) return json(res, { quotas: {} });
    if (path.startsWith('/v8/management/config/')) {
      const fields = path.slice('/v8/management/config/'.length).split('/').map(decodeURIComponent);
      const value = fields.reduce((current, field) => current?.[field], CONFIG);
      return value === undefined
        ? json(res, { error: { code: 'not_found', message: 'Config value not found' } }, 404)
        : json(res, value);
    }
    if (path === '/v1/models') return json(res, { data: SERVED.map((id) => ({ id })) });
    if (path.endsWith('/models')) return json(res, { data: CATALOG.map((id) => ({ id })) });
    return json(res, {});
  }

  if (req.method === 'PUT') {
    const payload = await readBody(req);
    if (path.startsWith('/v8/management/config/')) {
      const fields = path.slice('/v8/management/config/'.length).split('/').map(decodeURIComponent);
      const field = fields.pop();
      const parent = fields.reduce((current, key) => (current[key] ??= {}), CONFIG);
      parent[field] = payload;
      console.log(`PUT config/${[...fields, field].join('/')}`);
    }
    return json(res, {});
  }

  if (req.method === 'PATCH') {
    const payload = await readBody(req);
    if (path.endsWith('/credentials/fields')) {
      const file = AUTH_FILES.files.find((item) => item.name === payload.name);
      if (file) {
        Object.assign(
          file,
          Object.fromEntries(Object.entries(payload).filter(([k]) => k !== 'name'))
        );
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
