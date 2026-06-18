import { authFilesApi } from '@/services/api/authFiles';
import type { CredentialInfo } from '@/types/sourceInfo';
import { collectUsageDetails, normalizeAuthIndex } from '@/utils/usage';

export type UsageAuthLookupEntry = [string, CredentialInfo];

const AUTH_LOOKUP_PAGE_SIZE = 20;
const AUTH_LOOKUP_MAX_TERMS = 120;
const AUTH_LOOKUP_BATCH_SIZE = 8;
const AUTH_LOOKUP_ALL_CACHE_MS = 30_000;

const authLookupCache = new Map<string, UsageAuthLookupEntry[]>();
const inFlightAuthLookups = new Map<string, Promise<UsageAuthLookupEntry[]>>();
let allAuthLookupCache: { expiresAt: number; entries: UsageAuthLookupEntry[] } | null = null;
let inFlightAllAuthLookup: Promise<UsageAuthLookupEntry[]> | null = null;

export const normalizeUsageSourceForAuthLookup = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.startsWith('t:') ? raw.slice(2).trim() : raw;
};

export const collectUsageAuthLookupTerms = (usage: unknown): string[] => {
  const terms = new Set<string>();

  collectUsageDetails(usage).forEach((detail) => {
    const authIndex = normalizeAuthIndex(detail.auth_index);
    if (authIndex) terms.add(authIndex);

    const source = normalizeUsageSourceForAuthLookup(detail.source);
    if (source.includes('@') || source.endsWith('.json')) terms.add(source);
  });

  return Array.from(terms).slice(0, AUTH_LOOKUP_MAX_TERMS);
};

export const credentialInfoFromAuthFile = (file: unknown): UsageAuthLookupEntry | null => {
  if (!file || typeof file !== 'object') return null;
  const entry = file as Record<string, unknown>;
  const authIndex = normalizeAuthIndex(entry.auth_index ?? entry.authIndex);
  if (!authIndex) return null;

  return [
    authIndex,
    {
      name: String(entry.name || entry.email || entry.account || authIndex),
      type: String(entry.type || entry.provider || ''),
    },
  ];
};

export const collectAuthFileLookupEntries = (payload: unknown): UsageAuthLookupEntry[] => {
  if (!payload || typeof payload !== 'object') return [];
  const files = (payload as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  return files
    .map(credentialInfoFromAuthFile)
    .filter((entry): entry is UsageAuthLookupEntry => Boolean(entry));
};

const addLookupEntriesToMap = (
  map: Map<string, CredentialInfo>,
  entries: UsageAuthLookupEntry[]
) => {
  entries.forEach(([authIndex, info]) => {
    map.set(authIndex, info);
  });
};

const fetchAllAuthLookupEntries = (): Promise<UsageAuthLookupEntry[]> => {
  const now = Date.now();
  if (allAuthLookupCache && allAuthLookupCache.expiresAt > now) {
    return Promise.resolve(allAuthLookupCache.entries);
  }
  if (inFlightAllAuthLookup) return inFlightAllAuthLookup;

  inFlightAllAuthLookup = authFilesApi
    .list()
    .then((response) => {
      const entries = collectAuthFileLookupEntries(response);
      allAuthLookupCache = {
        entries,
        expiresAt: Date.now() + AUTH_LOOKUP_ALL_CACHE_MS,
      };
      return entries;
    })
    .catch(() => [])
    .finally(() => {
      inFlightAllAuthLookup = null;
    });

  return inFlightAllAuthLookup;
};

const fetchUsageAuthLookupTerm = (term: string): Promise<UsageAuthLookupEntry[]> => {
  const key = term.trim().toLowerCase();
  if (!key) return Promise.resolve([]);

  const cached = authLookupCache.get(key);
  if (cached) return Promise.resolve(cached);

  const inFlight = inFlightAuthLookups.get(key);
  if (inFlight) return inFlight;

  const request = authFilesApi
    .list({
      search: term,
      page: 1,
      pageSize: AUTH_LOOKUP_PAGE_SIZE,
    })
    .then((response) => {
      const results = collectAuthFileLookupEntries(response);
      authLookupCache.set(key, results);
      return results;
    })
    .catch(() => [])
    .finally(() => {
      if (inFlightAuthLookups.get(key) === request) {
        inFlightAuthLookups.delete(key);
      }
    });

  inFlightAuthLookups.set(key, request);
  return request;
};

export const loadUsageAuthFileMap = async (usage: unknown): Promise<Map<string, CredentialInfo>> => {
  const terms = collectUsageAuthLookupTerms(usage);
  const authFileMap = new Map<string, CredentialInfo>();

  addLookupEntriesToMap(authFileMap, await fetchAllAuthLookupEntries());

  for (let index = 0; index < terms.length; index += AUTH_LOOKUP_BATCH_SIZE) {
    const batch = terms.slice(index, index + AUTH_LOOKUP_BATCH_SIZE);
    const results = await Promise.all(batch.map(fetchUsageAuthLookupTerm));
    addLookupEntriesToMap(authFileMap, results.flat());
  }

  return authFileMap;
};
