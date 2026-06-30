import type { AntigravityQuotaGroup } from '@/types';
import { isAntigravityGroupSelfBucket } from './quotaConfigs';

// Models-payload groups carry a single bucket mirroring the group itself
// (see buildLegacyAntigravityGroupBucket). The group header already prints the
// label, so this bucket must be detected as a self bucket to avoid rendering
// the same title twice.
const modelsGroup: AntigravityQuotaGroup = {
  id: 'claude-gpt',
  label: 'Claude/GPT',
  models: ['claude-3-5-sonnet'],
  remainingFraction: 0.8,
  resetTime: '2026-07-07T00:00:00Z',
  buckets: [
    {
      id: 'claude-gpt-quota',
      label: 'Claude/GPT',
      remainingFraction: 0.8,
      resetTime: '2026-07-07T00:00:00Z',
    },
  ],
};

const modelsSelfBucketIsTrue: boolean = isAntigravityGroupSelfBucket(
  modelsGroup,
  modelsGroup.buckets![0]
);

// The two labels come from the same source string, so strict equality is the
// contract. Superficially similar but not identical labels (case/spacing) are
// NOT treated as a self bucket — those keep their own title to avoid masking
// genuine label differences.
const lookAlikeGroup: AntigravityQuotaGroup = {
  ...modelsGroup,
  label: 'claude/gpt',
  buckets: [{ ...modelsGroup.buckets![0], label: '  Claude / GPT  ' }],
};
const lookAlikeBucketIsNotSelf: boolean = isAntigravityGroupSelfBucket(
  lookAlikeGroup,
  lookAlikeGroup.buckets![0]
);

// Summary-payload groups expose window-scoped buckets whose labels differ from
// the group label; those must NOT be treated as self buckets so their titles
// still render.
const summaryGroup: AntigravityQuotaGroup = {
  id: 'gemini-3-pro',
  label: 'Gemini 3 Pro',
  models: ['gemini-3-pro'],
  remainingFraction: 0.5,
  resetTime: '2026-07-07T00:00:00Z',
  buckets: [
    {
      id: 'gemini-3-pro-weekly',
      label: 'Weekly limit',
      window: 'weekly',
      remainingFraction: 0.5,
      resetTime: '2026-07-07T00:00:00Z',
    },
    {
      id: 'gemini-3-pro-5h',
      label: '5 hour limit',
      window: '5h',
      remainingFraction: 0.9,
      resetTime: '2026-07-01T05:00:00Z',
    },
  ],
};

const summaryBucketIsNotSelf: boolean = isAntigravityGroupSelfBucket(
  summaryGroup,
  summaryGroup.buckets![0]
);

// A group with a single bucket whose label genuinely differs from the group
// label is not a self bucket either — its title still needs to render.
const singleDistinctBucketGroup: AntigravityQuotaGroup = {
  id: 'gemini-3-pro',
  label: 'Gemini 3 Pro',
  models: ['gemini-3-pro'],
  remainingFraction: 0.5,
  resetTime: '2026-07-07T00:00:00Z',
  buckets: [
    {
      id: 'gemini-3-pro-weekly',
      label: 'Weekly limit',
      window: 'weekly',
      remainingFraction: 0.5,
      resetTime: '2026-07-07T00:00:00Z',
    },
  ],
};

const singleDistinctBucketIsNotSelf: boolean = isAntigravityGroupSelfBucket(
  singleDistinctBucketGroup,
  singleDistinctBucketGroup.buckets![0]
);

void modelsSelfBucketIsTrue;
void lookAlikeBucketIsNotSelf;
void summaryBucketIsNotSelf;
void singleDistinctBucketIsNotSelf;
