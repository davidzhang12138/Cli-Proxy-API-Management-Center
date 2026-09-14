import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconChevronDown,
  IconTimer,
  IconCode,
  IconInfo,
  IconModelCluster,
  IconRefreshCw,
  IconDiamond,
  IconSearch,
} from '@/components/ui/icons';
import { runBenchmarkRequest } from '@/services/api/benchmark';
import { useNotificationStore } from '@/stores';
import { useRoutingWorkbench } from '@/features/routing/useRoutingWorkbench';
import type { BenchmarkResponse, BenchmarkTarget, BenchmarkThinkingLevel } from '@/types';
import {
  BENCHMARK_CASES,
  BENCHMARK_SYSTEM_PROMPT,
  formatBenchmarkNumber,
  randomize,
  THINKING_LEVELS,
  type BenchmarkCase,
  type BenchmarkEvaluation,
} from './logic';
import {
  loadBenchmarkTargets,
  resolveTargetModel,
  targetServesModel,
  type BenchmarkDiscovery,
} from './benchmark';
import styles from './BenchmarkPage.module.scss';

type CaseSelection = 'suite' | 'custom' | string;
type AttemptState = 'success' | 'error';

const CASE_LABEL_KEYS: Record<string, string> = {
  'constraint-json': 'benchmark.case_constraint_json',
  'async-code': 'benchmark.case_async_code',
  'arithmetic-json': 'benchmark.case_arithmetic_json',
  custom: 'benchmark.case_custom',
};

const CREDENTIAL_PAGE_SIZE = 20;

interface BenchmarkAttempt {
  id: string;
  targetId: string;
  targetLabel: string;
  identity: string;
  model: string;
  caseId: string;
  caseLabel: string;
  run: number;
  state: AttemptState;
  score: number | null;
  note: string;
  answer: string;
  latencyMs: number | null;
  error: string;
  usage?: BenchmarkResponse['usage'];
}

interface TargetSummary {
  target: BenchmarkTarget;
  attempts: BenchmarkAttempt[];
  score: number | null;
  successRate: number;
  latencyMs: number | null;
}

interface BenchmarkTargetGroup {
  id: string;
  provider: string;
  providerKey: string;
  models: string[];
  targets: BenchmarkTarget[];
  runnableTargets: BenchmarkTarget[];
}

const CUSTOM_CASE: BenchmarkCase = {
  id: 'custom',
  category: '自定义',
  label: '自定义题目',
  prompt: '',
  evaluate: (): BenchmarkEvaluation => ({ score: 0, note: '自定义题目需要人工评估' }),
};

const normalizeError = (cause: unknown, fallback = 'Request failed'): string =>
  cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : fallback;

const runTasks = async <T,>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> => {
  const results: T[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(concurrency, 1), tasks.length) }, () => worker())
  );
  return results;
};

const average = (values: number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function TargetIcon({ target }: { target: BenchmarkTarget }) {
  if (target.source === 'openai-compat') return <IconCode size={16} />;
  if (target.source === 'oauth') return <IconDiamond size={16} />;
  return <IconModelCluster size={16} />;
}

function ScorePill({ score }: { score: number | null }) {
  const { t } = useTranslation();
  if (score === null)
    return <span className={styles.scoreMuted}>{t('benchmark.manual_review')}</span>;
  const tone = score >= 80 ? styles.scoreGood : score >= 50 ? styles.scoreMid : styles.scoreLow;
  return (
    <span className={`${styles.scorePill} ${tone}`}>
      {t('benchmark.score_points', { score: formatBenchmarkNumber(score) })}
    </span>
  );
}

export function BenchmarkPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const routingWorkbench = useRoutingWorkbench();
  const [discovery, setDiscovery] = useState<BenchmarkDiscovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState<BenchmarkThinkingLevel>('high');
  const [repetitions, setRepetitions] = useState('2');
  const [caseSelection, setCaseSelection] = useState<CaseSelection>('suite');
  const [customPrompt, setCustomPrompt] = useState('');
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [credentialQueries, setCredentialQueries] = useState<Record<string, string>>({});
  const [credentialPages, setCredentialPages] = useState<Record<string, number>>({});
  const [attempts, setAttempts] = useState<BenchmarkAttempt[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');

  const load = useCallback(
    async (background = false) => {
      if (background) setRefreshing(true);
      else setLoading(true);
      setDiscoveryError('');
      try {
        const result = await loadBenchmarkTargets();
        setDiscovery(result);
        setModelInput((current) => current || result.models[0] || '');
        setSelectedTargets((current) => {
          const valid = new Set(result.targets.map((target) => target.id));
          const retained = new Set([...current].filter((id) => valid.has(id)));
          if (retained.size > 0) return retained;
          return new Set();
        });
      } catch (cause: unknown) {
        setDiscoveryError(normalizeError(cause, t('benchmark.request_failed')));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const selectedCase = useMemo(() => {
    if (caseSelection === 'custom') return CUSTOM_CASE;
    return BENCHMARK_CASES.find((item) => item.id === caseSelection) ?? null;
  }, [caseSelection]);

  const localizedCaseLabel = useCallback(
    (caseId: string, fallback: string) =>
      t(CASE_LABEL_KEYS[caseId] ?? 'benchmark.case_custom', { defaultValue: fallback }),
    [t]
  );

  const casesToRun = useMemo(() => {
    if (caseSelection === 'suite') return BENCHMARK_CASES;
    return selectedCase ? [selectedCase] : [];
  }, [caseSelection, selectedCase]);

  const eligibleTargets = useMemo(
    () =>
      (discovery?.targets ?? []).filter(
        (target) =>
          selectedTargets.has(target.id) &&
          target.enabled &&
          target.supported &&
          targetServesModel(target, modelInput)
      ),
    [discovery?.targets, modelInput, selectedTargets]
  );

  const routingModelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    routingWorkbench.snapshot?.groups
      .filter(
        (group) =>
          group.candidates.some((candidate) => candidate.enabled) &&
          (routingWorkbench.modelCoverage.get(group.id) ?? []).length > 0
      )
      .forEach((group) => {
        (routingWorkbench.modelCoverage.get(group.id) ?? []).forEach((model) =>
          counts.set(model, (counts.get(model) ?? 0) + 1)
        );
      });
    return counts;
  }, [routingWorkbench.modelCoverage, routingWorkbench.snapshot?.groups]);

  const indexedModels = useMemo(
    () =>
      routingWorkbench.snapshot
        ? [...routingModelCounts.keys()].sort((left, right) => left.localeCompare(right))
        : (discovery?.models ?? []),
    [discovery?.models, routingModelCounts, routingWorkbench.snapshot]
  );

  useEffect(() => {
    if (!modelInput && indexedModels[0]) {
      setModelInput(indexedModels[0]);
    }
  }, [indexedModels, modelInput]);

  const modelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (routingWorkbench.snapshot) {
      routingModelCounts.forEach((count, model) => counts.set(model, count));
    } else {
      indexedModels.forEach((model) => {
        counts.set(
          model,
          (discovery?.targets ?? []).filter(
            (target) => target.enabled && target.supported && targetServesModel(target, model)
          ).length
        );
      });
    }
    return counts;
  }, [discovery?.targets, indexedModels, routingModelCounts, routingWorkbench.snapshot]);

  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    return [...modelCounts.keys()].filter((model) => !query || model.toLowerCase().includes(query));
  }, [modelCounts, modelQuery]);

  const targetGroups = useMemo<BenchmarkTargetGroup[]>(() => {
    const targetByProvider = new Map<string, BenchmarkTarget[]>();
    (discovery?.targets ?? []).forEach((target) => {
      const current = targetByProvider.get(target.providerKey) ?? [];
      current.push(target);
      targetByProvider.set(target.providerKey, current);
    });

    const routeGroups = routingWorkbench.snapshot?.groups ?? [];
    const groups = routeGroups.length
      ? routeGroups.map((group) => ({
          id: group.id,
          provider: group.provider,
          providerKey: group.providerKey,
          models: routingWorkbench.modelCoverage.get(group.id) ?? group.models,
        }))
      : [...targetByProvider.entries()].map(([providerKey, targets]) => ({
          id: providerKey,
          provider: targets[0]?.label.split(' · ')[0] ?? providerKey,
          providerKey,
          models: [...new Set(targets.flatMap((target) => target.models.map((model) => model.id)))],
        }));

    return groups
      .filter((group) => !modelInput || group.models.includes(modelInput))
      .map((group) => {
        const targets = targetByProvider.get(group.providerKey) ?? [];
        return {
          ...group,
          targets,
          runnableTargets: targets.filter(
            (target) => target.enabled && target.supported && targetServesModel(target, modelInput)
          ),
        };
      })
      .filter((group) => group.runnableTargets.length > 0);
  }, [
    discovery?.targets,
    modelInput,
    routingWorkbench.modelCoverage,
    routingWorkbench.snapshot?.groups,
  ]);

  const summaries = useMemo<TargetSummary[]>(() => {
    const byTarget = new Map<string, BenchmarkAttempt[]>();
    attempts.forEach((attempt) => {
      const rows = byTarget.get(attempt.targetId) ?? [];
      rows.push(attempt);
      byTarget.set(attempt.targetId, rows);
    });

    return [...byTarget.entries()]
      .map(([targetId, rows]) => {
        const target = discovery?.targets.find((item) => item.id === targetId);
        if (!target) return null;
        const scored = rows
          .map((row) => row.score)
          .filter((score): score is number => score !== null);
        const latency = rows
          .map((row) => row.latencyMs)
          .filter((value): value is number => value !== null);
        return {
          target,
          attempts: rows,
          score: average(scored),
          successRate: rows.length
            ? (rows.filter((row) => row.state === 'success').length / rows.length) * 100
            : 0,
          latencyMs: average(latency),
        };
      })
      .filter((summary): summary is TargetSummary => summary !== null)
      .sort((left, right) => {
        const scoreDelta = (right.score ?? -1) - (left.score ?? -1);
        if (scoreDelta !== 0) return scoreDelta;
        return (
          (left.latencyMs ?? Number.POSITIVE_INFINITY) -
          (right.latencyMs ?? Number.POSITIVE_INFINITY)
        );
      });
  }, [attempts, discovery?.targets]);

  const toggleGroupExpanded = (groupId: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else {
        next.add(groupId);
        setCredentialPages((pages) => ({ ...pages, [groupId]: pages[groupId] ?? 1 }));
      }
      return next;
    });
  };

  const updateCredentialQuery = (groupId: string, value: string) => {
    setCredentialQueries((queries) => ({ ...queries, [groupId]: value }));
    setCredentialPages((pages) => ({ ...pages, [groupId]: 1 }));
  };

  const setCredentialPage = (groupId: string, page: number) => {
    setCredentialPages((pages) => ({ ...pages, [groupId]: page }));
  };

  const run = async () => {
    if (running) return;
    const prompt = caseSelection === 'custom' ? customPrompt.trim() : '';
    if (!modelInput.trim()) {
      showNotification(t('benchmark.validation_model'), 'error');
      return;
    }
    if (casesToRun.length === 0 || (caseSelection === 'custom' && !prompt)) {
      showNotification(t('benchmark.validation_prompt'), 'error');
      return;
    }
    if (eligibleTargets.length === 0) {
      showNotification(t('benchmark.validation_targets'), 'error');
      return;
    }

    const repeatCount = Math.min(5, Math.max(1, Number.parseInt(repetitions, 10) || 1));
    setRunning(true);
    setRunError('');
    setAttempts([]);

    const tasks: Array<() => Promise<BenchmarkAttempt>> = [];
    for (let runIndex = 1; runIndex <= repeatCount; runIndex += 1) {
      casesToRun.forEach((benchmarkCase) => {
        randomize(eligibleTargets).forEach((target) => {
          tasks.push(async () => {
            const actualModel = resolveTargetModel(target, modelInput);
            const attemptId = `${runIndex}:${benchmarkCase.id}:${target.id}`;
            try {
              const response = await runBenchmarkRequest({
                target,
                model: actualModel,
                prompt: benchmarkCase.id === 'custom' ? prompt : benchmarkCase.prompt,
                systemPrompt: BENCHMARK_SYSTEM_PROMPT,
                thinkingLevel,
                maxOutputTokens: 1200,
              });
              const evaluation =
                benchmarkCase.id === 'custom'
                  ? { score: null, note: t('benchmark.manual_review') }
                  : benchmarkCase.evaluate(response.answer);
              return {
                id: attemptId,
                targetId: target.id,
                targetLabel: target.label,
                identity: target.identity,
                model: actualModel,
                caseId: benchmarkCase.id,
                caseLabel: localizedCaseLabel(benchmarkCase.id, benchmarkCase.label),
                run: runIndex,
                state: 'success',
                score: evaluation.score,
                note: evaluation.note,
                answer: response.answer,
                latencyMs: response.latencyMs,
                error: '',
                usage: response.usage,
              } satisfies BenchmarkAttempt;
            } catch (cause: unknown) {
              return {
                id: attemptId,
                targetId: target.id,
                targetLabel: target.label,
                identity: target.identity,
                model: actualModel,
                caseId: benchmarkCase.id,
                caseLabel: localizedCaseLabel(benchmarkCase.id, benchmarkCase.label),
                run: runIndex,
                state: 'error',
                score: null,
                note: '',
                answer: '',
                latencyMs: null,
                error: normalizeError(cause, t('benchmark.request_failed')),
              } satisfies BenchmarkAttempt;
            }
          });
        });
      });
    }

    try {
      const result = await runTasks(tasks, 3);
      setAttempts(result);
      const successCount = result.filter((attempt) => attempt.state === 'success').length;
      showNotification(
        t('benchmark.run_complete', { success: successCount, total: result.length }),
        successCount ? 'success' : 'error'
      );
    } catch (cause: unknown) {
      setRunError(normalizeError(cause, t('benchmark.request_failed')));
    } finally {
      setRunning(false);
    }
  };

  const totalRuns = attempts.length;
  const successRuns = attempts.filter((attempt) => attempt.state === 'success').length;
  const winningTarget = summaries[0]?.target;
  const runnableTargets = (discovery?.targets ?? []).filter((target) => target.supported).length;
  const routedGroupCount = targetGroups.length;
  const activeCandidates =
    routingWorkbench.snapshot?.candidates.filter((candidate) => candidate.enabled).length ??
    runnableTargets;

  return (
    <div className={styles.page}>
      <div className={styles.ambient} aria-hidden="true">
        <div className={styles.ambientGrid} />
        <div className={styles.ambientGlow} />
      </div>

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>MODEL / BENCHMARK</p>
          <h1>{t('benchmark.title')}</h1>
          <p className={styles.subtitle}>{t('benchmark.subtitle')}</p>
        </div>
        <div className={styles.heroActions}>
          <button
            type="button"
            className={styles.quietAction}
            disabled={refreshing || loading}
            onClick={() => void load(true)}
          >
            <IconRefreshCw className={refreshing ? styles.spin : ''} size={15} />
            {refreshing ? t('benchmark.refreshing') : t('common.refresh')}
          </button>
          <Link className={styles.textLink} to="/routing">
            {t('benchmark.open_routing')} →
          </Link>
        </div>
      </header>

      <section className={styles.metrics} aria-label={t('benchmark.metrics_label')}>
        <div className={`${styles.metric} ${styles.metricAccent}`}>
          <span>{t('benchmark.metric_targets')}</span>
          <strong>{activeCandidates}</strong>
          <small>{t('benchmark.metric_targets_hint')}</small>
        </div>
        <div className={styles.metric}>
          <span>{t('benchmark.metric_models')}</span>
          <strong>{indexedModels.length}</strong>
          <small>{t('benchmark.metric_models_hint')}</small>
        </div>
        <div className={styles.metric}>
          <span>{t('benchmark.metric_last_run')}</span>
          <strong>{totalRuns ? `${successRuns}/${totalRuns}` : '—'}</strong>
          <small>{t('benchmark.metric_last_run_hint')}</small>
        </div>
        <div className={styles.metric}>
          <span>{t('benchmark.metric_winner')}</span>
          <strong className={styles.metricWinner}>{winningTarget?.providerKey ?? '—'}</strong>
          <small>{t('benchmark.metric_winner_hint')}</small>
        </div>
      </section>

      {discoveryError ? (
        <div className={styles.errorBanner} role="alert">
          <IconAlertTriangle size={17} />
          <span>{discoveryError}</span>
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            {t('common.retry', { defaultValue: '重试' })}
          </Button>
        </div>
      ) : null}

      <section className={styles.setupCard}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.kicker}>RUN CONFIGURATION</span>
            <h2>{t('benchmark.setup_title')}</h2>
          </div>
          <span className={styles.liveTag}>
            <span className={styles.liveDot} />
            {t('benchmark.live_config')}
          </span>
        </div>

        <div className={styles.controlGrid}>
          <div className={styles.field}>
            <label htmlFor="benchmark-thinking">{t('benchmark.thinking_label')}</label>
            <Select
              id="benchmark-thinking"
              value={thinkingLevel}
              options={THINKING_LEVELS.map((level) => ({ value: level.value, label: level.label }))}
              onChange={(value) => setThinkingLevel(value as BenchmarkThinkingLevel)}
              disabled={running}
              ariaLabel={t('benchmark.thinking_label')}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="benchmark-repetitions">{t('benchmark.repetitions_label')}</label>
            <Select
              id="benchmark-repetitions"
              value={repetitions}
              options={['1', '2', '3', '4', '5'].map((value) => ({
                value,
                label: t('benchmark.repetitions_option', { count: value }),
              }))}
              onChange={setRepetitions}
              disabled={running}
              ariaLabel={t('benchmark.repetitions_label')}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="benchmark-case">{t('benchmark.case_label')}</label>
            <Select
              id="benchmark-case"
              value={caseSelection}
              options={[
                { value: 'suite', label: t('benchmark.case_suite') },
                ...BENCHMARK_CASES.map((item) => ({
                  value: item.id,
                  label: localizedCaseLabel(item.id, item.label),
                })),
                { value: 'custom', label: t('benchmark.case_custom') },
              ]}
              onChange={setCaseSelection}
              disabled={running}
              ariaLabel={t('benchmark.case_label')}
            />
          </div>
        </div>

        {caseSelection === 'custom' ? (
          <div className={styles.promptField}>
            <label htmlFor="benchmark-custom-prompt">{t('benchmark.custom_prompt_label')}</label>
            <textarea
              id="benchmark-custom-prompt"
              className={styles.promptInput}
              value={customPrompt}
              onChange={(event) => setCustomPrompt(event.target.value)}
              placeholder={t('benchmark.custom_prompt_placeholder')}
              rows={4}
              disabled={running}
            />
            <span className={styles.fieldHint}>{t('benchmark.custom_prompt_hint')}</span>
          </div>
        ) : (
          <div className={styles.casePreview}>
            <div className={styles.casePreviewIcon}>
              <IconCode size={16} />
            </div>
            <div>
              <strong>
                {caseSelection === 'suite'
                  ? t('benchmark.case_suite_preview_title')
                  : selectedCase
                    ? localizedCaseLabel(selectedCase.id, selectedCase.label)
                    : ''}
              </strong>
              <p>
                {caseSelection === 'suite'
                  ? t('benchmark.case_suite_preview_desc')
                  : selectedCase?.prompt}
              </p>
            </div>
          </div>
        )}

        <section className={styles.modelWorkspace}>
          <aside className={styles.modelRail}>
            <div className={styles.railHeading}>
              <div>
                <span className={styles.kicker}>{t('benchmark.model_index')}</span>
                <h3>{t('benchmark.models_title')}</h3>
              </div>
              <IconModelCluster size={20} />
            </div>
            <div className={styles.modelSearch}>
              <IconSearch size={15} />
              <input
                value={modelQuery}
                onChange={(event) => setModelQuery(event.target.value)}
                placeholder={t('benchmark.model_search_placeholder')}
                aria-label={t('benchmark.model_search_label')}
                disabled={loading || running}
              />
            </div>
            <div className={styles.modelList}>
              {loading ? (
                <span className={styles.modelLoading}>{t('benchmark.loading_targets')}</span>
              ) : filteredModels.length ? (
                filteredModels.map((model) => (
                  <button
                    type="button"
                    key={model}
                    className={`${styles.modelItem} ${modelInput === model ? styles.modelItemActive : ''}`}
                    onClick={() => setModelInput(model)}
                    disabled={running}
                  >
                    <span title={model}>{model}</span>
                    <b>{modelCounts.get(model) ?? 0}</b>
                  </button>
                ))
              ) : (
                <span className={styles.modelEmpty}>{t('benchmark.no_models')}</span>
              )}
            </div>
            {modelInput ? (
              <div className={styles.selectedModelNote}>
                <span>{t('benchmark.selected_model')}</span>
                <strong title={modelInput}>{modelInput}</strong>
              </div>
            ) : null}
          </aside>

          <div className={styles.targetPanel}>
            <div className={styles.targetHeader}>
              <div>
                <span className={styles.kicker}>TARGET POOL</span>
                <h3>{modelInput || t('benchmark.choose_model')}</h3>
              </div>
              <div className={styles.targetHeaderActions}>
                <span className={styles.targetCount}>
                  {t('benchmark.targets_selected', {
                    selected: eligibleTargets.length,
                    groups: routedGroupCount,
                  })}
                </span>
              </div>
            </div>

            <div className={styles.targetGrid}>
              {loading ? (
                <div className={styles.loadingTarget}>{t('benchmark.loading_targets')}</div>
              ) : targetGroups.length ? (
                targetGroups.map((group) => {
                  const selectedCount = group.runnableTargets.filter((target) =>
                    selectedTargets.has(target.id)
                  ).length;
                  const expanded = expandedGroups.has(group.id);
                  const credentialQuery = (credentialQueries[group.id] ?? '').trim().toLowerCase();
                  const filteredCredentials = group.runnableTargets.filter((target) =>
                    [target.label, target.identity, target.authFileName, target.id]
                      .filter(Boolean)
                      .some((value) => value!.toLowerCase().includes(credentialQuery))
                  );
                  const pageCount = Math.max(
                    1,
                    Math.ceil(filteredCredentials.length / CREDENTIAL_PAGE_SIZE)
                  );
                  const page = Math.min(credentialPages[group.id] ?? 1, pageCount);
                  const visibleCredentials = filteredCredentials.slice(
                    (page - 1) * CREDENTIAL_PAGE_SIZE,
                    page * CREDENTIAL_PAGE_SIZE
                  );
                  return (
                    <article
                      key={group.id}
                      className={`${styles.targetGroupCard} ${selectedCount ? styles.targetSelected : ''}`}
                    >
                      <button
                        type="button"
                        className={styles.targetGroupHeader}
                        onClick={() => toggleGroupExpanded(group.id)}
                        aria-expanded={expanded}
                      >
                        <span className={styles.groupExpandMark} aria-hidden="true">
                          {expanded ? '⌄' : '›'}
                        </span>
                        <span className={styles.targetIcon}>
                          <IconModelCluster size={16} />
                        </span>
                        <span className={styles.targetGroupInfo}>
                          <strong>
                            {group.provider} <em>· {group.runnableTargets.length}</em>
                          </strong>
                          <small>
                            {t('benchmark.group_credentials', {
                              count: group.runnableTargets.length,
                            })}
                            {selectedCount
                              ? ` · ${selectedCount} ${t('benchmark.group_selected')}`
                              : ''}
                          </small>
                          <span title={group.models.join(' · ')}>
                            {group.models.slice(0, 3).join(' · ')}
                          </span>
                        </span>
                        <span className={styles.targetStatus}>
                          <IconCheckCircle2 size={14} />
                        </span>
                      </button>
                      {expanded ? (
                        <div className={styles.credentialList}>
                          <div className={styles.credentialToolbar}>
                            <div className={styles.credentialSearch}>
                              <IconSearch size={14} />
                              <input
                                value={credentialQueries[group.id] ?? ''}
                                onChange={(event) =>
                                  updateCredentialQuery(group.id, event.target.value)
                                }
                                placeholder={t('benchmark.credential_search_placeholder')}
                                aria-label={t('benchmark.credential_search_label')}
                                disabled={running}
                              />
                            </div>
                            <span>
                              {t('benchmark.credential_count', {
                                visible: filteredCredentials.length,
                                total: group.runnableTargets.length,
                              })}
                            </span>
                          </div>
                          <div className={styles.credentialRows}>
                            {visibleCredentials.length ? (
                              visibleCredentials.map((target) => (
                                <label className={styles.credentialRow} key={target.id}>
                                  <input
                                    type="checkbox"
                                    checked={selectedTargets.has(target.id)}
                                    disabled={running}
                                    onChange={(event) => {
                                      setSelectedTargets((current) => {
                                        const next = new Set(current);
                                        if (event.target.checked) next.add(target.id);
                                        else next.delete(target.id);
                                        return next;
                                      });
                                    }}
                                  />
                                  <span className={styles.targetIcon}>
                                    <TargetIcon target={target} />
                                  </span>
                                  <span className={styles.credentialInfo}>
                                    <strong>{target.label}</strong>
                                    <small>{target.identity || target.source}</small>
                                  </span>
                                </label>
                              ))
                            ) : (
                              <span className={styles.credentialEmpty}>
                                {t('benchmark.credential_search_empty')}
                              </span>
                            )}
                          </div>
                          {pageCount > 1 ? (
                            <div className={styles.credentialPagination}>
                              <button
                                type="button"
                                disabled={page <= 1}
                                onClick={() => setCredentialPage(group.id, page - 1)}
                                aria-label={t('benchmark.credential_previous')}
                              >
                                ‹
                              </button>
                              <span>
                                {t('benchmark.credential_page', { page, pages: pageCount })}
                              </span>
                              <button
                                type="button"
                                disabled={page >= pageCount}
                                onClick={() => setCredentialPage(group.id, page + 1)}
                                aria-label={t('benchmark.credential_next')}
                              >
                                ›
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })
              ) : (
                <div className={styles.emptyTargets}>
                  <IconInfo size={18} />
                  <span>{t('benchmark.no_targets')}</span>
                  <Link to="/ai-providers">{t('benchmark.open_providers')} →</Link>
                </div>
              )}
            </div>
          </div>
        </section>

        <div className={styles.setupFooter}>
          <div className={styles.protocolNote}>
            <IconInfo size={15} />
            <span>{t('benchmark.protocol_note')}</span>
          </div>
          <Button variant="primary" onClick={() => void run()} loading={running} disabled={loading}>
            {running ? t('benchmark.running') : t('benchmark.run_button')}
          </Button>
        </div>
      </section>

      {runError ? (
        <div className={styles.errorBanner} role="alert">
          <IconAlertTriangle size={17} />
          <span>{runError}</span>
        </div>
      ) : null}

      {attempts.length > 0 ? (
        <section className={styles.resultsSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.kicker}>RESULTS / BLIND ORDER</span>
              <h2>{t('benchmark.results_title')}</h2>
            </div>
            <span className={styles.resultMeta}>
              {t('benchmark.result_meta', {
                thinking: thinkingLevel,
                runs: attempts.length,
              })}
            </span>
          </div>

          <div className={styles.resultsCard}>
            <div className={styles.tableWrap}>
              <table className={styles.resultsTable}>
                <thead>
                  <tr>
                    <th>{t('benchmark.rank')}</th>
                    <th>{t('benchmark.provider')}</th>
                    <th>{t('benchmark.quality_score')}</th>
                    <th>{t('benchmark.success_rate')}</th>
                    <th>{t('benchmark.latency')}</th>
                    <th>{t('benchmark.answer_count')}</th>
                    <th aria-label={t('benchmark.details')} />
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((summary, index) => (
                    <tr key={summary.target.id}>
                      <td>
                        <span className={`${styles.rank} ${index === 0 ? styles.rankWinner : ''}`}>
                          {String(index + 1).padStart(2, '0')}
                        </span>
                      </td>
                      <td>
                        <div className={styles.providerCell}>
                          <span className={styles.providerCellIcon}>
                            <TargetIcon target={summary.target} />
                          </span>
                          <span>
                            <strong>{summary.target.label}</strong>
                            <small>{summary.target.identity || summary.target.source}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <ScorePill score={summary.score} />
                      </td>
                      <td>
                        <span className={styles.rateValue}>
                          {formatBenchmarkNumber(summary.successRate)}%
                        </span>
                      </td>
                      <td>
                        <span className={styles.latencyValue}>
                          <IconTimer size={14} />
                          {summary.latencyMs === null
                            ? '—'
                            : `${formatBenchmarkNumber(summary.latencyMs)} ms`}
                        </span>
                      </td>
                      <td>
                        {summary.attempts.filter((attempt) => attempt.state === 'success').length}/
                        {summary.attempts.length}
                      </td>
                      <td>
                        <details className={styles.detailDisclosure}>
                          <summary aria-label={t('benchmark.open_details')}>
                            <IconChevronDown size={15} />
                          </summary>
                          <div className={styles.detailPopover}>
                            {summary.attempts.map((attempt) => (
                              <div className={styles.attemptRow} key={attempt.id}>
                                <div className={styles.attemptMeta}>
                                  <span>
                                    {attempt.caseLabel} · #{attempt.run}
                                  </span>
                                  <span>
                                    {attempt.latencyMs === null ? '—' : `${attempt.latencyMs} ms`}
                                    {attempt.state === 'success'
                                      ? ` · ${attempt.note}`
                                      : ` · ${attempt.error}`}
                                  </span>
                                </div>
                                {attempt.state === 'success' ? (
                                  <ScorePill score={attempt.score} />
                                ) : (
                                  <span className={styles.errorScore}>失败</span>
                                )}
                                {attempt.answer ? <pre>{attempt.answer}</pre> : null}
                              </div>
                            ))}
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.resultsFootnote}>
              <IconInfo size={15} />
              <span>{t('benchmark.results_note')}</span>
            </div>
          </div>
        </section>
      ) : (
        <section className={styles.emptyResults}>
          <div className={styles.emptyResultsMark}>
            <IconDiamond size={24} />
          </div>
          <div>
            <h2>{t('benchmark.empty_results_title')}</h2>
            <p>{t('benchmark.empty_results_desc')}</p>
          </div>
        </section>
      )}
    </div>
  );
}
