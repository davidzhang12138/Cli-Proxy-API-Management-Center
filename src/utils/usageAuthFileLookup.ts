import { authFilesApi } from '@/services/api/authFiles';
import type { CredentialInfo } from '@/types/sourceInfo';
import { collectUsageDetails, normalizeAuthIndex } from '@/utils/usage';

export type UsageAuthLookupEntry = [string, CredentialInfo];

const AUTH_LOOKUP_PAGE_SIZE = 20;
const AUTH_LOOKUP_MAX_TERMS = 120;
const AUTH_LOOKUP_BATCH_SIZE = 8;

const authLookupCache = new Map<string, UsageAuthLookupEntry[]>();
const inFlightAuthLookups = new Map<string, Promise<UsageAuthLookupEntry[]>>();

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
      const results = (response.files || [])
        .map(credentialInfoFromAuthFile)
        .filter((entry): entry is UsageAuthLookupEntry => Boolean(entry));
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

  for (let index = 0; index < terms.length; index += AUTH_LOOKUP_BATCH_SIZE) {
    const batch = terms.slice(index, index + AUTH_LOOKUP_BATCH_SIZE);
    const results = await Promise.all(batch.map(fetchUsageAuthLookupTerm));
    results.flat().forEach(([authIndex, info]) => {
      authFileMap.set(authIndex, info);
    });
  }

  return authFileMap;
};
