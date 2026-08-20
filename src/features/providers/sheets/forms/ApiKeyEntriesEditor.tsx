import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconChevronDown,
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconPlus,
  IconSearch,
  IconShield,
  IconX,
} from '@/components/ui/icons';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { maskApiKey } from '@/utils/format';
import { MAX_CREDENTIAL_WEIGHT } from '@/utils/credentialWeight';
import { getApiKeyEntryAvailabilityStats, isConfiguredApiKeyEntry } from '../../apiKeyEntryStatus';
import type { ApiKeyEntryInput } from '../../types';
import {
  getOpenAIBulkDisableCandidateIndexes,
  getOpenAIBulkDisableGroups,
  getOpenAITestCandidateIndexes,
  type ConnectivityState,
  type ConnectivityStatus,
  type OpenAITestScope,
} from './useConnectivityTest';
import { ConnectivityStatusIcon } from './ConnectivityStatusIcon';
import { ModelEntriesEditor } from './ModelEntriesEditor';
import styles from './sharedForm.module.scss';

const COLLAPSED_LIMIT = 10;

const idleStatus: ConnectivityStatus = { state: 'idle' as ConnectivityState, message: '' };

const isBlankEntry = (entry: ApiKeyEntryInput): boolean =>
  !entry.apiKey.trim() && !entry.existingApiKey?.trim();

interface ApiKeyEntriesEditorProps {
  entries: ApiKeyEntryInput[];
  removeDisabled: boolean;
  mutating: boolean;
  statuses: ConnectivityStatus[];
  isTestingAny: boolean;
  batchCompleted: boolean;
  onUpdate: (idx: number, patch: Partial<ApiKeyEntryInput>) => void;
  /** Appends a new blank entry and returns its index. */
  onAdd: () => number;
  onRemove: (idx: number) => void;
  onTest: (idx: number) => void;
  onTestAll: (scope: OpenAITestScope) => void;
  onDisableFailed: (indexes: number[]) => void;
}

export function ApiKeyEntriesEditor({
  entries,
  removeDisabled,
  mutating,
  statuses,
  isTestingAny,
  batchCompleted,
  onUpdate,
  onAdd,
  onRemove,
  onTest,
  onTestAll,
  onDisableFailed,
}: ApiKeyEntriesEditorProps) {
  const { t } = useTranslation();
  const [expandedIdx, setExpandedIdx] = useState<number | null>(() =>
    entries.length === 1 && isBlankEntry(entries[0]) ? 0 : null
  );
  const [showPasswords, setShowPasswords] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [entryFilter, setEntryFilter] = useState<OpenAITestScope>('all');
  const [testScope, setTestScope] = useState<OpenAITestScope>('all');
  const [selectedFailureGroupKeys, setSelectedFailureGroupKeys] = useState<Set<string>>(new Set());

  const togglePasswordVisibility = (idx: number) => {
    setShowPasswords((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const handleAdd = () => {
    const idx = onAdd();
    setSearchQuery('');
    setEntryFilter('all');
    setExpandedIdx(idx);
  };

  const handleRemove = (removeIdx: number) => {
    setShowPasswords((prev) => {
      if (!prev.size) return prev;
      const next = new Set<number>();
      prev.forEach((idx) => {
        if (idx < removeIdx) {
          next.add(idx);
        } else if (idx > removeIdx) {
          next.add(idx - 1);
        }
      });
      return next;
    });
    setExpandedIdx((prev) => {
      if (prev === null || prev === removeIdx) return null;
      return prev > removeIdx ? prev - 1 : prev;
    });
    onRemove(removeIdx);
  };

  // Newest entries first, matching the append-on-add order.
  const reversed = entries.map((entry, idx) => ({ entry, idx })).reverse();
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const availabilityFiltered = reversed.filter(({ entry }) => {
    if (entryFilter === 'all') return true;
    if (!isConfiguredApiKeyEntry(entry)) return false;
    return entryFilter === 'disabled' ? entry.disabled : !entry.disabled;
  });
  const filtered = normalizedQuery
    ? availabilityFiltered.filter(({ entry }) => {
        const apiKey = entry.apiKey.trim() || entry.existingApiKey?.trim() || '';
        return (
          apiKey.toLowerCase().includes(normalizedQuery) ||
          entry.proxyUrl.trim().toLowerCase().includes(normalizedQuery) ||
          (entry.baseUrl ?? '').trim().toLowerCase().includes(normalizedQuery) ||
          (entry.models ?? []).some(
            (model) =>
              model.name.toLowerCase().includes(normalizedQuery) ||
              (model.alias ?? '').toLowerCase().includes(normalizedQuery)
          )
        );
      })
    : availabilityFiltered;
  const visible =
    normalizedQuery || entryFilter !== 'all' || showAll
      ? filtered
      : filtered.slice(0, COLLAPSED_LIMIT);
  const availabilityStats = getApiKeyEntryAvailabilityStats(entries);
  const testScopeCounts: Record<OpenAITestScope, number> = {
    all: getOpenAITestCandidateIndexes(entries, 'all').length,
    available: getOpenAITestCandidateIndexes(entries, 'available').length,
    disabled: getOpenAITestCandidateIndexes(entries, 'disabled').length,
  };
  const selectedTestCount = testScopeCounts[testScope];
  const failedIndexes = statuses.flatMap((status, idx) =>
    status?.state === 'error' && status.canDisable ? [idx] : []
  );
  const failureGroups = getOpenAIBulkDisableGroups(entries, statuses);
  const failureGroupSignature = failureGroups.map((group) => group.key).join('|');
  const actionableFailedIndexes = getOpenAIBulkDisableCandidateIndexes(entries, statuses);
  const selectedFailedIndexes = getOpenAIBulkDisableCandidateIndexes(
    entries,
    statuses,
    selectedFailureGroupKeys
  );
  const setupFailureCount = statuses.filter(
    (status) => status?.state === 'error' && !status.canDisable
  ).length;

  useEffect(() => {
    if (!batchCompleted) {
      setSelectedFailureGroupKeys(new Set());
      return;
    }
    const availableKeys = new Set(failureGroupSignature ? failureGroupSignature.split('|') : []);
    setSelectedFailureGroupKeys((previous) => {
      if (previous.size === 0) return availableKeys;
      return new Set([...previous].filter((key) => availableKeys.has(key)));
    });
  }, [batchCompleted, failureGroupSignature]);

  const toggleFailureGroup = (key: string) => {
    setSelectedFailureGroupKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleEntryFilter = (filter: Exclude<OpenAITestScope, 'all'>) => {
    setEntryFilter((current) => (current === filter ? 'all' : filter));
  };

  const batchSummary = batchCompleted
    ? actionableFailedIndexes.length > 0
      ? t('providersPage.connectivity.batchFailures', {
          count: actionableFailedIndexes.length,
        })
      : failedIndexes.length > 0
        ? t('providersPage.connectivity.batchFailuresDisabled')
        : setupFailureCount > 0
          ? t('providersPage.connectivity.batchNeedsFix')
          : t('providersPage.connectivity.batchNoFailures')
    : '';

  return (
    <div className={styles.entriesList}>
      <div className={`${styles.entriesToolbar} ${styles.entriesToolbarSplit}`}>
        <button type="button" className={styles.addBtn} disabled={mutating} onClick={handleAdd}>
          <IconPlus size={12} />
          <span>{t('providersPage.form.addApiKeyEntry')}</span>
        </button>
        <div className={styles.entriesToolbarActions}>
          <label className={styles.testScopePicker}>
            <span className={styles.testScopeLabel}>
              {t('providersPage.connectivity.testScopeLabel')}
            </span>
            <select
              className={styles.testScopeSelect}
              value={testScope}
              onChange={(event) => setTestScope(event.target.value as OpenAITestScope)}
              disabled={mutating || isTestingAny}
              aria-label={t('providersPage.connectivity.testScopeLabel')}
            >
              <option value="all">
                {t('providersPage.connectivity.testScopeAll', { count: testScopeCounts.all })}
              </option>
              <option value="available">
                {t('providersPage.connectivity.testScopeAvailable', {
                  count: testScopeCounts.available,
                })}
              </option>
              <option value="disabled">
                {t('providersPage.connectivity.testScopeDisabled', {
                  count: testScopeCounts.disabled,
                })}
              </option>
            </select>
          </label>
          <button
            type="button"
            className={styles.connectivityBtn}
            disabled={mutating || isTestingAny || selectedTestCount === 0}
            onClick={() => onTestAll(testScope)}
          >
            {isTestingAny ? (
              <span className={`${styles.statusIcon} ${styles.statusIconLoading}`}>
                <IconLoader2 size={14} />
              </span>
            ) : null}
            <span>
              {t('providersPage.connectivity.testSelectedCount', {
                count: selectedTestCount,
              })}
            </span>
          </button>
        </div>
      </div>
      <div className={styles.entryFilterRow}>
        <div className={styles.entrySearchWrap}>
          <IconSearch className={styles.entrySearchIcon} size={14} />
          <input
            className={styles.entrySearchInput}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('providersPage.form.apiKeySearchPlaceholder')}
            aria-label={t('providersPage.form.apiKeySearchPlaceholder')}
          />
        </div>
        <div className={styles.entryAvailabilityStats}>
          <button
            type="button"
            className={`${styles.entryAvailabilityStat} ${styles.entryAvailabilityStatButton} ${
              styles.entryAvailabilityStatActive
            } ${entryFilter === 'available' ? styles.entryAvailabilityStatSelected : ''}`}
            aria-pressed={entryFilter === 'available'}
            onClick={() => toggleEntryFilter('available')}
          >
            <span>{t('providersPage.form.apiKeyAvailableStat')}</span>
            <strong>{availabilityStats.available}</strong>
          </button>
          <button
            type="button"
            className={`${styles.entryAvailabilityStat} ${styles.entryAvailabilityStatButton} ${
              styles.entryAvailabilityStatDisabled
            } ${entryFilter === 'disabled' ? styles.entryAvailabilityStatSelected : ''}`}
            aria-pressed={entryFilter === 'disabled'}
            onClick={() => toggleEntryFilter('disabled')}
          >
            <span>{t('providersPage.form.apiKeyDisabledStat')}</span>
            <strong>{availabilityStats.disabled}</strong>
          </button>
        </div>
      </div>
      {batchCompleted && batchSummary ? (
        <div className={styles.batchTestPanel}>
          <div className={styles.batchTestHeader}>
            <span>{batchSummary}</span>
            {failureGroups.length > 0 ? (
              <span className={styles.batchTestFilterLabel}>
                {t('providersPage.connectivity.failureCodeFilter')}
              </span>
            ) : null}
          </div>
          {failureGroups.length > 0 ? (
            <>
              <div className={styles.failureCodeGroups}>
                {failureGroups.map((group) => {
                  const selected = selectedFailureGroupKeys.has(group.key);
                  const label = group.statusCode
                    ? t('providersPage.connectivity.httpStatus', { code: group.statusCode })
                    : t('providersPage.connectivity.failureCodeOther');
                  return (
                    <button
                      key={group.key}
                      type="button"
                      className={`${styles.failureCodeGroup} ${
                        selected ? styles.failureCodeGroupSelected : ''
                      }`}
                      aria-pressed={selected}
                      onClick={() => toggleFailureGroup(group.key)}
                    >
                      <span>{label}</span>
                      <strong>{group.count}</strong>
                    </button>
                  );
                })}
              </div>
              <div className={styles.batchTestFooter}>
                <span>{t('providersPage.connectivity.disableFailedHint')}</span>
                <button
                  type="button"
                  className={`${styles.connectivityBtn} ${styles.batchDisableBtn}`}
                  disabled={mutating || isTestingAny || selectedFailedIndexes.length === 0}
                  onClick={() => onDisableFailed(selectedFailedIndexes)}
                >
                  <IconShield size={14} />
                  <span>
                    {selectedFailedIndexes.length > 0
                      ? t('providersPage.connectivity.disableFailedCount', {
                          count: selectedFailedIndexes.length,
                        })
                      : t('providersPage.connectivity.disableFailed')}
                  </span>
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {visible.map(({ entry, idx }) => {
        const status = statuses[idx] ?? idleStatus;
        const expanded = expandedIdx === idx;
        const summaryKey = entry.apiKey.trim() || entry.existingApiKey?.trim() || '';
        const entryModels = entry.models?.length ? entry.models : [{ name: '', alias: '' }];
        const modelCount = entryModels.filter((model) => model.name.trim()).length;
        return (
          <div
            key={idx}
            className={`${styles.entryCard} ${entry.disabled ? styles.entryCardDisabled : ''}`}
          >
            <div className={styles.entryCardHeader}>
              <button
                type="button"
                className={styles.entryCardToggle}
                aria-expanded={expanded}
                onClick={() => setExpandedIdx(expanded ? null : idx)}
              >
                <span>{t('providersPage.form.apiKeyEntry', { index: idx + 1 })}</span>
                <span className={styles.entrySummary}>
                  {entry.baseUrl?.trim() ? (
                    <span className={styles.entryBadge} title={entry.baseUrl}>
                      {t('providersPage.form.endpointBadge')}
                    </span>
                  ) : null}
                  {modelCount > 0 ? (
                    <span className={styles.entryBadge}>
                      {t('providersPage.form.entryModelCountBadge', { count: modelCount })}
                    </span>
                  ) : null}
                  {entry.proxyUrl.trim() ? (
                    <span className={styles.entryBadge} title={entry.proxyUrl}>
                      {t('providersPage.form.proxyBadge')}
                    </span>
                  ) : null}
                  {entry.disabled ? (
                    <span className={`${styles.entryBadge} ${styles.entryBadgeDisabled}`}>
                      {t('providersPage.form.apiKeyDisabledBadge')}
                    </span>
                  ) : null}
                  <span className={styles.entrySummaryKey}>
                    {summaryKey ? maskApiKey(summaryKey) : t('providersPage.status.notConfigured')}
                  </span>
                </span>
              </button>
              <div className={styles.entryCardHeaderRight}>
                {status.statusCode ? (
                  <span className={styles.entryErrorCodeBadge}>
                    {t('providersPage.connectivity.httpStatus', { code: status.statusCode })}
                  </span>
                ) : null}
                <ConnectivityStatusIcon state={status.state} />
                <button
                  type="button"
                  className={styles.connectivityBtnGhost}
                  disabled={mutating || status.state === 'loading'}
                  onClick={() => onTest(idx)}
                >
                  {status.state === 'loading' ? (
                    <span className={`${styles.statusIcon} ${styles.statusIconLoading}`}>
                      <IconLoader2 size={14} />
                    </span>
                  ) : null}
                  <span>{t('providersPage.connectivity.test')}</span>
                </button>
                <button
                  type="button"
                  className={styles.entryCardIconBtn}
                  onClick={() => setExpandedIdx(expanded ? null : idx)}
                  title={expanded ? t('common.collapse') : t('common.expand')}
                  aria-label={expanded ? t('common.collapse') : t('common.expand')}
                >
                  <IconChevronDown
                    className={[
                      styles.entryCardChevron,
                      expanded ? styles.entryCardChevronOpen : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    size={14}
                  />
                </button>
                <button
                  type="button"
                  className={styles.removeBtn}
                  disabled={mutating || removeDisabled}
                  onClick={() => handleRemove(idx)}
                >
                  <IconX size={12} />
                </button>
              </div>
            </div>
            {status.state === 'error' ? (
              <div className={styles.connectivityError}>{status.message}</div>
            ) : null}
            {expanded ? (
              <div className={styles.entryCardBody}>
                <div className={styles.entryStatusRow}>
                  <span className={styles.entryStatusCopy}>
                    <span className={styles.entryStatusLabel}>
                      {t('providersPage.form.apiKeyEnabled')}
                    </span>
                    <span className={styles.entryStatusHint}>
                      {t('providersPage.form.apiKeyEnabledHint')}
                    </span>
                  </span>
                  <ToggleSwitch
                    checked={!entry.disabled}
                    onChange={(enabled) => onUpdate(idx, { disabled: !enabled })}
                    disabled={mutating}
                    ariaLabel={t('providersPage.form.apiKeyEnabled')}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>{t('providersPage.form.endpointUrl')}</label>
                  <input
                    className={styles.input}
                    type="url"
                    value={entry.baseUrl ?? ''}
                    onChange={(e) => onUpdate(idx, { baseUrl: e.target.value })}
                    disabled={mutating}
                    placeholder="https://workspace--app-server.us-east.modal.direct/v1"
                  />
                  <span className={styles.labelHint}>
                    {t('providersPage.form.endpointUrlHint')}
                  </span>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>{t('providersPage.form.entryModels')}</label>
                  <span className={styles.labelHint}>
                    {t('providersPage.form.entryModelsHint')}
                  </span>
                  <div className={styles.entryModelsPanel}>
                    <ModelEntriesEditor
                      models={entryModels}
                      supportsImage
                      supportsThinking
                      mutating={mutating}
                      removeDisabled={entryModels.length <= 1}
                      onUpdate={(modelIdx, patch) =>
                        onUpdate(idx, {
                          models: entryModels.map((model, currentIdx) =>
                            currentIdx === modelIdx ? { ...model, ...patch } : model
                          ),
                        })
                      }
                      onAdd={() =>
                        onUpdate(idx, {
                          models: [...entryModels, { name: '', alias: '' }],
                        })
                      }
                      onRemove={(modelIdx) =>
                        onUpdate(idx, {
                          models: entryModels.filter((_, currentIdx) => currentIdx !== modelIdx),
                        })
                      }
                    />
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>{t('providersPage.form.apiKey')}</label>
                  <div className={styles.passwordField}>
                    <input
                      className={styles.passwordInput}
                      type={showPasswords.has(idx) ? 'text' : 'password'}
                      value={entry.apiKey}
                      onChange={(e) => onUpdate(idx, { apiKey: e.target.value })}
                      autoComplete="new-password"
                      data-1p-ignore="true"
                      data-lpignore="true"
                      data-bwignore="true"
                      disabled={mutating}
                      placeholder={
                        entry.existingApiKey
                          ? t('providersPage.form.apiKeyEditPlaceholder')
                          : t('providersPage.form.apiKeyCreatePlaceholder')
                      }
                    />
                    <button
                      type="button"
                      className={styles.passwordToggle}
                      onClick={() => togglePasswordVisibility(idx)}
                      disabled={mutating}
                      aria-label={
                        showPasswords.has(idx)
                          ? t('providersPage.form.hideApiKey')
                          : t('providersPage.form.showApiKey')
                      }
                      title={
                        showPasswords.has(idx)
                          ? t('providersPage.form.hideApiKey')
                          : t('providersPage.form.showApiKey')
                      }
                    >
                      {showPasswords.has(idx) ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                    </button>
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>{t('providersPage.form.proxyUrl')}</label>
                  <input
                    className={styles.input}
                    value={entry.proxyUrl}
                    onChange={(e) => onUpdate(idx, { proxyUrl: e.target.value })}
                    disabled={mutating}
                    placeholder="http://127.0.0.1:7890"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>{t('providersPage.form.weight')}</label>
                  <input
                    className={styles.input}
                    type="number"
                    step="1"
                    max={MAX_CREDENTIAL_WEIGHT}
                    value={entry.weight ?? ''}
                    onChange={(e) =>
                      onUpdate(idx, {
                        weight: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                    disabled={mutating}
                    placeholder="1"
                  />
                  <span className={styles.labelHint}>{t('providersPage.form.weightHint')}</span>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      {(normalizedQuery || entryFilter !== 'all') && visible.length === 0 ? (
        <div className={styles.entrySearchEmpty}>
          {normalizedQuery
            ? t('providersPage.form.apiKeySearchEmpty')
            : t('providersPage.form.apiKeyFilterEmpty')}
        </div>
      ) : null}
      {!normalizedQuery && entryFilter === 'all' && entries.length > COLLAPSED_LIMIT ? (
        <button type="button" className={styles.showMoreBtn} onClick={() => setShowAll((v) => !v)}>
          {showAll
            ? t('providersPage.form.showFewerEntries')
            : t('providersPage.form.showAllEntries', { count: entries.length })}
        </button>
      ) : null}
    </div>
  );
}
