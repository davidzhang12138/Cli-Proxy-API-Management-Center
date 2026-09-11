import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconChevronDown,
  IconChevronUp,
  IconInfo,
  IconModelCluster,
  IconNetwork,
  IconRefreshCw,
  IconSearch,
} from '@/components/ui/icons';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { useNotificationStore, useThemeStore } from '@/stores';
import {
  type RoutingCandidate,
  type RoutingGroup,
  type RoutingStrategy,
  useRoutingWorkbench,
} from './useRoutingWorkbench';
import styles from './RoutingWorkbenchPage.module.scss';

const ALL_MODELS = '__all__';

const groupEnabled = (group: RoutingGroup): boolean =>
  group.candidates.some((candidate) => candidate.enabled);

const providerLabels: Record<string, string> = {
  gemini: 'Gemini',
  interactions: 'Interactions',
  codex: 'Codex',
  xai: 'xAI',
  claude: 'Claude',
  vertex: 'Vertex',
};

const sourceLabels: Record<RoutingCandidate['source'], string> = {
  oauth: 'OAuth / Auth file',
  'api-key': 'API key',
  'openai-compat': 'OpenAI compatible',
};

const providerLabel = (candidate: RoutingCandidate): string =>
  providerLabels[candidate.provider] ?? candidate.provider;

/** Provider marks reuse the auth-files brand icon set, falling back to initials. */
function ProviderMark({ provider, size = 31 }: { provider: string; size?: number }) {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const icon = getAuthFileIcon(provider, resolvedTheme);
  if (!icon) {
    return (
      <span className={styles.groupMark} style={{ width: size, height: size }}>
        {initials(provider)}
      </span>
    );
  }
  return (
    <span className={styles.groupMarkImage} style={{ width: size, height: size }}>
      <img
        src={icon}
        alt=""
        style={
          isThemeSurfaceIconProvider(provider)
            ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
            : undefined
        }
      />
    </span>
  );
}

const initials = (value: string): string => {
  const parts = value
    .split(/[^a-zA-Z0-9一-鿿]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0] ?? '?').slice(0, 2).toUpperCase();
};

const parseInteger = (value: string, fallback: number | null): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const formatTime = (value: number, locale: string): string => {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(value);
};

function GroupRow({
  group,
  coverage,
  expanded,
  saving,
  draftPriority,
  draftPriorities,
  candidateSavingId,
  saveError,
  onToggle,
  onPriorityChange,
  onSave,
  onCandidatePriorityChange,
  onCandidatePrioritySave,
}: {
  group: RoutingGroup;
  coverage: string[];
  expanded: boolean;
  saving: boolean;
  draftPriority: string;
  draftPriorities: Record<string, string>;
  candidateSavingId: string | null;
  saveError: string | null;
  onToggle: () => void;
  onPriorityChange: (value: string) => void;
  onSave: () => void;
  onCandidatePriorityChange: (candidateId: string, value: string) => void;
  onCandidatePrioritySave: (candidateId: string) => void;
}) {
  const { t } = useTranslation();
  const dirty = draftPriority !== String(group.priority);
  const enabled = group.candidates.some((candidate) => candidate.enabled);
  const priorityLocked = !group.uniformPriority;
  return (
    <article className={styles.groupBlock}>
      <div className={styles.groupRow}>
        <button
          type="button"
          className={styles.groupExpand}
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={t('routing_page.toggle_group')}
        >
          {expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
        </button>
        <div className={styles.groupIdentity}>
          <ProviderMark provider={group.provider} />
          <div>
            <strong>{group.provider}</strong>
            <span>
              {t('routing_page.group_candidate_count', { count: group.candidates.length })}
            </span>
          </div>
        </div>
        <div className={styles.groupModels} title={coverage.join('\n')}>
          {coverage.length
            ? coverage.slice(0, 4).join(' · ')
            : t('routing_page.unscoped_model')}
          {coverage.length > 4 ? ` +${coverage.length - 4}` : ''}
        </div>
        <div className={styles.groupPriorityCell}>
          <label className={styles.srOnly} htmlFor={`group-priority-${group.id}`}>
            {t('routing_page.priority')}
          </label>
          <input
            id={`group-priority-${group.id}`}
            className={styles.numberInput}
            type="number"
            step="1"
            value={draftPriority}
            disabled={!group.editable || saving || priorityLocked}
            aria-describedby={priorityLocked ? `group-priority-note-${group.id}` : undefined}
            onChange={(event) => onPriorityChange(event.target.value)}
          />
        </div>
        <div className={styles.groupState}>
          <span className={enabled ? styles.groupReady : styles.groupDisabled}>
            {enabled ? t('routing_page.status_ready') : t('routing_page.status_disabled')}
          </span>
          {group.uniformPriority ? null : (
            <span
              id={`group-priority-note-${group.id}`}
              className={styles.mixedBadge}
              title={t('routing_page.group_priority_hint')}
            >
              {t('routing_page.mixed_priority')}
            </span>
          )}
        </div>
        <div className={styles.actionCell}>
          {group.editable ? (
            <Button
              size="sm"
              variant={dirty ? 'primary' : 'secondary'}
              disabled={!dirty || saving}
              loading={saving}
              onClick={onSave}
            >
              {t('common.save')}
            </Button>
          ) : (
            <span className={styles.readOnly}>{t('routing_page.read_only')}</span>
          )}
        </div>
      </div>
      {expanded ? (
        <div className={styles.groupChildren}>
          {group.editable && !group.uniformPriority ? (
            <div className={styles.groupHint}>
              <IconAlertTriangle size={14} />
              <span>{t('routing_page.group_priority_hint')}</span>
            </div>
          ) : null}
          {saveError ? (
            <div className={styles.groupError} role="alert">
              {saveError}
            </div>
          ) : null}
          {group.candidates.map((candidate, index) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              rank={candidate.enabled ? index + 1 : null}
              draftPriority={draftPriorities[candidate.id] ?? String(candidate.priority)}
              saving={candidateSavingId === candidate.id}
              onPriorityChange={onCandidatePriorityChange}
              onSave={onCandidatePrioritySave}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function CandidateStatus({ candidate }: { candidate: RoutingCandidate }) {
  const { t } = useTranslation();
  if (candidate.status === 'disabled') {
    return (
      <span className={`${styles.status} ${styles.statusDisabled}`}>
        <IconAlertTriangle size={14} />
        {t('routing_page.status_disabled')}
      </span>
    );
  }
  if (candidate.status === 'warning') {
    return (
      <span className={`${styles.status} ${styles.statusWarning}`}>
        <IconAlertTriangle size={14} />
        {t('routing_page.status_warning')}
      </span>
    );
  }
  return (
    <span className={`${styles.status} ${styles.statusReady}`}>
      <IconCheckCircle2 size={14} />
      {t('routing_page.status_ready')}
    </span>
  );
}

function CandidateRow({
  candidate,
  rank,
  draftPriority,
  saving,
  onPriorityChange,
  onSave,
}: {
  candidate: RoutingCandidate;
  rank: number | null;
  draftPriority: string;
  saving: boolean;
  onPriorityChange: (candidateId: string, value: string) => void;
  onSave: (candidateId: string) => void;
}) {
  const { t } = useTranslation();
  const modelSummary = candidate.models.length
    ? candidate.models.slice(0, 3).join(' · ')
    : t('routing_page.unscoped_model');
  const dirty = draftPriority !== String(candidate.priority);

  return (
    <article className={`${styles.candidateRow} ${!candidate.enabled ? styles.rowDisabled : ''}`}>
      <div className={styles.rankCell} aria-label={t('routing_page.rank')}>
        {rank ? (
          <span className={styles.rank}>{rank}</span>
        ) : (
          <span className={styles.rankMuted}>—</span>
        )}
      </div>

      <div className={styles.credentialCell}>
        <div className={styles.credentialTopline}>
          <ProviderMark provider={candidate.provider} size={21} />
          <span className={styles.providerName}>{providerLabel(candidate)}</span>
          <span className={styles.sourceTag}>{sourceLabels[candidate.source]}</span>
        </div>
        <strong className={styles.identity} title={candidate.identity}>
          {candidate.identity}
        </strong>
        <span className={styles.detail} title={candidate.detail}>
          {candidate.detail}
        </span>
      </div>

      <div className={styles.modelCell}>
        <span className={styles.modelSummary} title={candidate.models.join('\n')}>
          {modelSummary}
        </span>
        {candidate.models.length > 3 ? (
          <span className={styles.moreModels}>
            {t('routing_page.more_models', { count: candidate.models.length - 3 })}
          </span>
        ) : null}
      </div>

      <div className={styles.numberCell}>
        <label className={styles.srOnly} htmlFor={`priority-${candidate.id}`}>
          {t('routing_page.priority')}
        </label>
        {candidate.editable ? (
          <input
            id={`priority-${candidate.id}`}
            className={styles.numberInput}
            type="number"
            step="1"
            value={draftPriority}
            disabled={saving}
            onChange={(event) => onPriorityChange(candidate.id, event.target.value)}
            aria-label={t('routing_page.priority')}
          />
        ) : (
          <span className={styles.detailValue}>{candidate.priority}</span>
        )}
      </div>

      <div className={styles.numberCell}>
        <span className={styles.detailValue} title={t('routing_page.weight')}>
          {candidate.weight}
        </span>
      </div>

      <div className={styles.statusCell}>
        <CandidateStatus candidate={candidate} />
      </div>

      <div className={styles.actionCell}>
        {candidate.editable ? (
          <Button
            size="sm"
            variant={dirty ? 'primary' : 'secondary'}
            disabled={!dirty || saving}
            loading={saving}
            onClick={() => onSave(candidate.id)}
          >
            {t('common.save')}
          </Button>
        ) : (
          <span className={styles.readOnly}>{t('routing_page.read_only')}</span>
        )}
      </div>
    </article>
  );
}

export function RoutingWorkbenchPage() {
  const { t, i18n } = useTranslation();
  const { showNotification } = useNotificationStore();
  const workbench = useRoutingWorkbench();
  const [selectedModel, setSelectedModel] = useState(ALL_MODELS);
  const [query, setQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [groupDrafts, setGroupDrafts] = useState<Record<string, string>>({});
  const [candidateDrafts, setCandidateDrafts] = useState<Record<string, string>>({});
  const [savingGroupId, setSavingGroupId] = useState<string | null>(null);
  const [savingCandidateId, setSavingCandidateId] = useState<string | null>(null);
  const [failedGroups, setFailedGroups] = useState<Record<string, string>>({});

  const candidates = useMemo(
    () => workbench.snapshot?.candidates ?? [],
    [workbench.snapshot?.candidates]
  );
  const models = useMemo(() => workbench.snapshot?.models ?? [], [workbench.snapshot?.models]);

  useEffect(() => {
    if (selectedModel !== ALL_MODELS && !models.includes(selectedModel)) {
      setSelectedModel(ALL_MODELS);
    }
  }, [models, selectedModel]);

  const modelCoverage = useMemo(() => workbench.modelCoverage, [workbench.modelCoverage]);

  const groups = useMemo(() => workbench.snapshot?.groups ?? [], [workbench.snapshot?.groups]);
  /** A group with no known model cannot serve anything, so it stays out of the pool. */
  const coveredGroups = useMemo(
    () => groups.filter((group) => (modelCoverage.get(group.id) ?? []).length > 0),
    [groups, modelCoverage]
  );
  const visibleGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const scoped = coveredGroups.filter((group) => {
      if (selectedModel === ALL_MODELS) return true;
      return (modelCoverage.get(group.id) ?? []).includes(selectedModel);
    });
    const searched = normalizedQuery
      ? scoped.filter((group) =>
          [
            group.provider,
            group.providerKey,
            ...(modelCoverage.get(group.id) ?? []),
            ...group.candidates.map((candidate) => candidate.identity),
          ].some((value) => value.toLowerCase().includes(normalizedQuery))
        )
      : scoped;

    return [...searched].sort((left, right) => {
      const leftEnabled = groupEnabled(left);
      const rightEnabled = groupEnabled(right);
      if (leftEnabled !== rightEnabled) return leftEnabled ? -1 : 1;
      if (left.priority !== right.priority) return right.priority - left.priority;
      return left.id.localeCompare(right.id);
    });
  }, [coveredGroups, modelCoverage, query, selectedModel]);

  /** How many groups can actually serve each model — matches the group list, not credential rows. */
  const modelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    modelCoverage.forEach((coverage) =>
      coverage.forEach((model) => counts.set(model, (counts.get(model) ?? 0) + 1))
    );
    return counts;
  }, [modelCoverage]);

  const activeCount = candidates.filter((candidate) => candidate.enabled).length;
  const providerCount = new Set(candidates.map((candidate) => candidate.providerKey)).size;
  const highestPriority = candidates.reduce(
    (current, candidate) => (candidate.enabled ? Math.max(current, candidate.priority) : current),
    0
  );

  const getGroupDraft = useCallback(
    (group: RoutingGroup): string => groupDrafts[group.id] ?? String(group.priority),
    [groupDrafts]
  );

  /** Group priority is a uniform level: refuse to flatten a group whose members differ. */
  const saveGroup = useCallback(
    async (group: RoutingGroup) => {
      if (!group.uniformPriority) {
        showNotification(t('routing_page.group_priority_blocked'), 'error');
        return;
      }
      const priority = parseInteger(getGroupDraft(group), 0);
      if (priority === null) {
        showNotification(t('routing_page.invalid_priority'), 'error');
        return;
      }

      try {
        setSavingGroupId(group.id);
        await group.updatePriority(priority);
        setGroupDrafts((current) => {
          const nextDrafts = { ...current };
          delete nextDrafts[group.id];
          return nextDrafts;
        });
        await workbench.refresh();
        showNotification(t('routing_page.saved'), 'success');
      } catch (cause: unknown) {
        showNotification(
          `${t('routing_page.save_failed')}: ${cause instanceof Error ? cause.message : String(cause)}`,
          'error'
        );
      } finally {
        setSavingGroupId(null);
      }
    },
    [getGroupDraft, showNotification, t, workbench]
  );

  const handleCandidatePriorityChange = useCallback((candidateId: string, value: string) => {
    setCandidateDrafts((current) => ({ ...current, [candidateId]: value }));
  }, []);

  const saveCandidatePriority = useCallback(
    async (group: RoutingGroup, candidateId: string) => {
      const priority = parseInteger(candidateDrafts[candidateId] ?? '', null);
      if (priority === null) {
        showNotification(t('routing_page.invalid_priority'), 'error');
        return;
      }

      try {
        setSavingCandidateId(candidateId);
        await group.updateCandidatePriority(candidateId, priority);
        setCandidateDrafts((current) => {
          const nextDrafts = { ...current };
          delete nextDrafts[candidateId];
          return nextDrafts;
        });
        // A group-wide refresh would race sibling saves; patch the row locally instead.
        setFailedGroups((current) => {
          if (!(group.id in current)) return current;
          const next = { ...current };
          delete next[group.id];
          return next;
        });
        showNotification(t('routing_page.saved'), 'success');
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setFailedGroups((current) => ({ ...current, [group.id]: message }));
        showNotification(`${t('routing_page.save_failed')}: ${message}`, 'error');
      } finally {
        setSavingCandidateId(null);
      }
    },
    [candidateDrafts, showNotification, t]
  );

  const handleStrategyChange = useCallback(
    async (value: string) => {
      try {
        await workbench.updateStrategy(value as RoutingStrategy);
        showNotification(t('routing_page.strategy_saved'), 'success');
      } catch (cause: unknown) {
        showNotification(
          `${t('routing_page.save_failed')}: ${cause instanceof Error ? cause.message : String(cause)}`,
          'error'
        );
      }
    },
    [showNotification, t, workbench]
  );

  // Matches the other pages' convention: keep the header and its telemetry, and
  // skeleton the content region instead of taking over the whole viewport.
  const firstLoad = workbench.loading && !workbench.snapshot;
  const selectedModelLabel =
    selectedModel === ALL_MODELS ? t('routing_page.all_candidates') : selectedModel;

  return (
    <div className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />

      <header className={styles.hero}>
        <div className={styles.heroRow}>
          <div className={styles.heroCopy}>
            <h1>{t('routing_page.title')}</h1>
            <p className={styles.heroMeta}>
              <span>{t('routing_page.metric_active', { count: activeCount })}</span>
              <span className={styles.heroMetaDot} aria-hidden="true">
                ·
              </span>
              <span>{t('routing_page.group_count', { count: coveredGroups.length })}</span>
              <span className={styles.heroMetaDot} aria-hidden="true">
                ·
              </span>
              <span>{t('routing_page.metric_models_hint')}</span>
            </p>
          </div>
          <div className={styles.heroActions}>
            <button
              type="button"
              className={styles.heroAction}
              disabled={workbench.refreshing}
              onClick={() => void workbench.refresh()}
            >
              <IconRefreshCw className={workbench.refreshing ? styles.spin : ''} size={15} />
              {workbench.refreshing ? t('routing_page.refreshing') : t('common.refresh')}
            </button>
            <Link className={`${styles.heroAction} ${styles.heroActionPrimary}`} to="/config">
              {t('routing_page.open_config')}
            </Link>
          </div>
        </div>
        <p className={styles.heroNote}>{t('routing_page.subtitle')}</p>
      </header>

      <section className={styles.strategyCard}>
        <div className={styles.strategyCardTopline}>
          <span className={styles.cardKicker}>{t('routing_page.active_strategy')}</span>
          <IconNetwork size={19} />
        </div>
        <Select
          className={styles.strategySelect}
          value={workbench.snapshot?.strategy ?? 'round-robin'}
          options={[
            { value: 'round-robin', label: t('basic_settings.routing_strategy_round_robin') },
            {
              value: 'weighted-round-robin',
              label: t('basic_settings.routing_strategy_weighted_round_robin'),
            },
            { value: 'fill-first', label: t('basic_settings.routing_strategy_fill_first') },
          ]}
          onChange={(value) => void handleStrategyChange(value)}
          disabled={workbench.savingStrategy}
          ariaLabel={t('routing_page.strategy_label')}
        />
        <div className={styles.strategyFlow}>
          <span>01&nbsp; {t('routing_page.flow_priority')}</span>
          <span>02&nbsp; {t('routing_page.flow_strategy')}</span>
          <span>03&nbsp; {t('routing_page.flow_failover')}</span>
        </div>
      </section>

      {workbench.error ? (
        <div className={styles.errorBanner} role="alert">
          <IconAlertTriangle size={17} />
          <span>{workbench.error}</span>
          <Button size="sm" variant="secondary" onClick={() => void workbench.refresh()}>
            {t('common.retry', { defaultValue: '重试' })}
          </Button>
        </div>
      ) : null}

      <section className={styles.metrics} aria-label={t('routing_page.metrics_label')}>
        {firstLoad
          ? Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} height={120} rounded={14} />
            ))
          : (
              [
                ['metric_active', activeCount, t('routing_page.metric_active_hint', { total: candidates.length })],
                ['metric_models', models.length, t('routing_page.metric_models_hint')],
                ['metric_providers', providerCount, t('routing_page.metric_providers_hint')],
                ['metric_priority', highestPriority, t('routing_page.metric_priority_hint')],
              ] as const
            ).map(([label, value, hint], index) => (
              <div
                key={label}
                className={`${styles.metricCard} ${index === 0 ? styles.metricAccent : ''}`}
              >
                <span>{t(`routing_page.${label}`)}</span>
                <strong>{value}</strong>
                <small>{hint}</small>
              </div>
            ))}
      </section>

      <div className={styles.notice}>
        <IconInfo size={16} />
        <span>{t('routing_page.session_hint')}</span>
      </div>

      <section className={styles.workspace}>
        <aside className={styles.modelRail}>
          <div className={styles.railHeading}>
            <div>
              <span className={styles.cardKicker}>{t('routing_page.model_index')}</span>
              <h2>{t('routing_page.models_title')}</h2>
            </div>
            <IconModelCluster size={21} />
          </div>
          <div className={styles.searchBox}>
            <IconSearch size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('routing_page.search_placeholder')}
              aria-label={t('routing_page.search_label')}
            />
          </div>
          <button
            type="button"
            className={`${styles.modelItem} ${selectedModel === ALL_MODELS ? styles.modelItemActive : ''}`}
            onClick={() => setSelectedModel(ALL_MODELS)}
          >
            <span>{t('routing_page.all_models')}</span>
            <b>{coveredGroups.length}</b>
          </button>
          <div className={styles.modelList}>
            {firstLoad
              ? Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} height={32} rounded={9} />
                ))
              : models.map((model) => (
                  <button
                    type="button"
                    key={model}
                    className={`${styles.modelItem} ${selectedModel === model ? styles.modelItemActive : ''}`}
                    onClick={() => setSelectedModel(model)}
                  >
                    <span title={model}>{model}</span>
                    <b>{modelCounts.get(model) ?? 0}</b>
                  </button>
                ))}
          </div>
          {!firstLoad && models.length === 0 ? (
            <p className={styles.emptyRail}>{t('routing_page.no_models')}</p>
          ) : null}
        </aside>

        <main className={styles.poolPanel}>
          <div className={styles.poolHeader}>
            <div>
              <span className={styles.cardKicker}>{t('routing_page.pool_kicker')}</span>
              <h2>{selectedModelLabel}</h2>
            </div>
            <span className={styles.poolCount}>
              {t('routing_page.group_count', { count: visibleGroups.length })}
            </span>
          </div>

          <div className={styles.tableHead}>
            <span aria-hidden="true" />
            <span>{t('routing_page.group')}</span>
            <span>{t('routing_page.models')}</span>
            <span>{t('routing_page.priority')}</span>
            <span>{t('common.status')}</span>
            <span>{t('common.action')}</span>
          </div>

          <div className={styles.candidateList}>
            {firstLoad ? (
              <div className={styles.poolSkeleton} aria-hidden="true">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} height={94} rounded={0} />
                ))}
              </div>
            ) : visibleGroups.length === 0 ? (
              <div className={styles.emptyPool}>
                <IconModelCluster size={25} />
                <strong>{t('routing_page.empty_title')}</strong>
                <span>{t('routing_page.empty_desc')}</span>
              </div>
            ) : (
              visibleGroups.map((group) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  coverage={modelCoverage.get(group.id) ?? []}
                  expanded={expandedGroups[group.id] === true}
                  saving={savingGroupId === group.id}
                  draftPriority={getGroupDraft(group)}
                  draftPriorities={candidateDrafts}
                  candidateSavingId={savingCandidateId}
                  saveError={failedGroups[group.id] ?? null}
                  onToggle={() =>
                    setExpandedGroups((current) => ({
                      ...current,
                      [group.id]: !current[group.id],
                    }))
                  }
                  onPriorityChange={(value) =>
                    setGroupDrafts((current) => ({ ...current, [group.id]: value }))
                  }
                  onSave={() => void saveGroup(group)}
                  onCandidatePriorityChange={handleCandidatePriorityChange}
                  onCandidatePrioritySave={(candidateId) =>
                    void saveCandidatePriority(group, candidateId)
                  }
                />
              ))
            )}
          </div>

          <div className={styles.poolFooter}>
            <span>
              {t('routing_page.updated_at', {
                time: formatTime(workbench.snapshot?.fetchedAt ?? 0, i18n.language),
              })}
            </span>
            <span>{t('routing_page.default_weight_hint')}</span>
          </div>
        </main>
      </section>
    </div>
  );
}
