import { collectUsageAuthLookupTerms, credentialInfoFromAuthFile } from './usageAuthFileLookup';

const lookupTerms = collectUsageAuthLookupTerms({
  apis: {
    chat: {
      models: {
        codex: {
          details: [
            {
              timestamp: '2026-06-03T07:44:20Z',
              source: 'codex-a@example.com-free.json',
              auth_index: '9288679c39585525',
              tokens: {},
            },
          ],
        },
      },
    },
  },
});

const authLookupEntry = credentialInfoFromAuthFile({
  auth_index: '9288679c39585525',
  name: 'codex-a@example.com-free.json',
  provider: 'codex',
});

void lookupTerms;
void authLookupEntry;
