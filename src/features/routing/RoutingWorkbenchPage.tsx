import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconChevronDown,
  IconChevronUp,
  IconInfo,
  IconLoader2,
  IconModelCluster,
  IconNetwork,
  IconRefreshCw,
  IconSearch,
  IconSlidersHorizontal,
} from '@/components/ui/icons';
import { useNotificationStore } from '@/stores';
import {
  type RoutingCandidate,
  type RoutingGroup,
  type RoutingStrategy,
  useRoutingWorkbench,
} from './useRoutingWorkbench';
import styles from './RoutingWorkbenchPage.module.scss';

const ALL_MODELS = '__all__';
const MAX_WEIGHT = 1_000_000;

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
  expanded,
  saving,
  draftPriority,
  onToggle,
  onPriorityChange,
  onSave,
}: {
  group: RoutingGroup;
  expanded: boolean;
  saving: boolean;
  draftPriority: string;
  onToggle: () => void;
  onPriorityChange: (value: string) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const dirty = draftPriority !== String(group.priority);
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
          <span className={styles.groupMark}>{initials(group.provider)}</span>
          <div>
            <strong>{group.provider}</strong>
            <span>
              {t('routing_page.group_candidate_count', { count: group.candidates.length })}
            </span>
          </div>
        </div>
        <div className={styles.groupModels} title={group.models.join('\n')}>
          {group.models.length
            ? group.models.slice(0, 4).join(' · ')
            : t('routing_page.unscoped_model')}
          {group.models.length > 4 ? ` +${group.models.length - 4}` : ''}
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
            disabled={!group.editable || saving}
            onChange={(event) => onPriorityChange(event.target.value)}
          />
        </div>
        <div className={styles.groupState}>
          <span className={group.enabled ? styles.groupReady : styles.groupDisabled}>
            {group.enabled ? t('routing_page.status_ready') : t('routing_page.status_disabled')}
          </span>
          {group.mixedPriority ? (
            <span className={styles.mixedBadge}>{t('routing_page.mixed_priority')}</span>
          ) : null}
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
          {group.candidates.map((candidate, index) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              rank={candidate.enabled ? index + 1 : null}
              draft={{ priority: String(candidate.priority), weight: String(candidate.weight) }}
              saving={false}
              detailsOnly
              onDraftChange={() => undefined}
              onSave={() => undefined}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

interface DraftValues {
  priority: string;
  weight: string;
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
  draft,
  saving,
  detailsOnly = false,
  onDraftChange,
  onSave,
}: {
  candidate: RoutingCandidate;
  rank: number | null;
  draft: DraftValues;
  saving: boolean;
  detailsOnly?: boolean;
  onDraftChange: (field: keyof DraftValues, value: string) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const modelSummary = candidate.models.length
    ? candidate.models.slice(0, 3).join(' · ')
    : t('routing_page.unscoped_model');
  const dirty =
    draft.priority !== String(candidate.priority) || draft.weight !== String(candidate.weight);

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
          <span className={styles.providerMark}>{initials(providerLabel(candidate))}</span>
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
        {detailsOnly ? (
          <span className={styles.detailValue}>{candidate.priority}</span>
        ) : (
          <input
            id={`priority-${candidate.id}`}
            className={styles.numberInput}
            type="number"
            step="1"
            value={draft.priority}
            disabled={!candidate.editable || saving}
            onChange={(event) => onDraftChange('priority', event.target.value)}
            aria-label={t('routing_page.priority')}
          />
        )}
      </div>

      <div className={styles.numberCell}>
        <label className={styles.srOnly} htmlFor={`weight-${candidate.id}`}>
          {t('routing_page.weight')}
        </label>
        {detailsOnly ? (
          <span className={styles.detailValue}>{candidate.weight}</span>
        ) : (
          <input
            id={`weight-${candidate.id}`}
            className={styles.numberInput}
            type="number"
            min="0"
            max={MAX_WEIGHT}
            step="1"
            value={draft.weight}
            disabled={!candidate.editable || saving}
            onChange={(event) => onDraftChange('weight', event.target.value)}
            aria-label={t('routing_page.weight')}
          />
        )}
      </div>

      <div className={styles.statusCell}>
        <CandidateStatus candidate={candidate} />
      </div>

      <div className={styles.actionCell}>
        {!detailsOnly && candidate.editable ? (
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
  const [savingGroupId, setSavingGroupId] = useState<string | null>(null);

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

  const groups = useMemo(() => workbench.snapshot?.groups ?? [], [workbench.snapshot?.groups]);
  const visibleGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const scoped = groups.filter((group) => {
      if (selectedModel === ALL_MODELS) return true;
      return group.models.length === 0 || group.models.includes(selectedModel);
    });
    const searched = normalizedQuery
      ? scoped.filter((group) =>
          [
            group.provider,
            group.providerKey,
            ...group.models,
            ...group.candidates.map((candidate) => candidate.identity),
          ].some((value) => value.toLowerCase().includes(normalizedQuery))
        )
      : scoped;

    return [...searched].sort((left, right) => {
      if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
      if (left.priority !== right.priority) return right.priority - left.priority;
      return left.id.localeCompare(right.id);
    });
  }, [groups, query, selectedModel]);

  const modelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    groups.forEach((group) =>
      group.models.forEach((model) => counts.set(model, (counts.get(model) ?? 0) + 1))
    );
    return counts;
  }, [groups]);

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

  const saveGroup = useCallback(
    async (group: RoutingGroup) => {
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

  if (workbench.loading && !workbench.snapshot) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingState}>
          <IconLoader2 className={styles.spin} size={22} />
          <span>{t('routing_page.loading')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>
            <IconSlidersHorizontal size={14} />
            {t('routing_page.eyebrow')}
          </span>
          <h1>{t('routing_page.title')}</h1>
          <p>{t('routing_page.subtitle')}</p>
          <div className={styles.heroActions}>
            <Button
              variant="secondary"
              size="sm"
              disabled={workbench.refreshing}
              onClick={() => void workbench.refresh()}
            >
              <IconRefreshCw className={workbench.refreshing ? styles.spin : ''} size={15} />
              {workbench.refreshing ? t('routing_page.refreshing') : t('common.refresh')}
            </Button>
            <Link className={styles.textLink} to="/config">
              {t('routing_page.open_config')}
              <span aria-hidden="true"> ↗</span>
            </Link>
          </div>
        </div>

        <section className={styles.strategyCard}>
          <div className={styles.strategyCardTopline}>
            <span className={styles.cardKicker}>{t('routing_page.active_strategy')}</span>
            <IconNetwork size={19} />
          </div>
          <Select
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
      </header>

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
        <div className={`${styles.metricCard} ${styles.metricAccent}`}>
          <span>{t('routing_page.metric_active')}</span>
          <strong>{activeCount}</strong>
          <small>{t('routing_page.metric_active_hint', { total: candidates.length })}</small>
        </div>
        <div className={styles.metricCard}>
          <span>{t('routing_page.metric_models')}</span>
          <strong>{models.length}</strong>
          <small>{t('routing_page.metric_models_hint')}</small>
        </div>
        <div className={styles.metricCard}>
          <span>{t('routing_page.metric_providers')}</span>
          <strong>{providerCount}</strong>
          <small>{t('routing_page.metric_providers_hint')}</small>
        </div>
        <div className={styles.metricCard}>
          <span>{t('routing_page.metric_priority')}</span>
          <strong>{highestPriority}</strong>
          <small>{t('routing_page.metric_priority_hint')}</small>
        </div>
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
            <b>{candidates.length}</b>
          </button>
          <div className={styles.modelList}>
            {models.map((model) => (
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
          {models.length === 0 ? (
            <p className={styles.emptyRail}>{t('routing_page.no_models')}</p>
          ) : null}
        </aside>

        <main className={styles.poolPanel}>
          <div className={styles.poolHeader}>
            <div>
              <span className={styles.cardKicker}>{t('routing_page.pool_kicker')}</span>
              <h2>
                {selectedModel === ALL_MODELS ? t('routing_page.all_candidates') : selectedModel}
              </h2>
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
            {visibleGroups.length === 0 ? (
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
                  expanded={expandedGroups[group.id] === true}
                  saving={savingGroupId === group.id}
                  draftPriority={getGroupDraft(group)}
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
