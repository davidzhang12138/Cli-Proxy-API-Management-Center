import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIRO_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
  type QuotaConfig,
} from '@/components/quota';
import { refreshManagedQuotaStates } from '@/components/quota/managedQuotaRefresh';
import { useNotificationStore, useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import {
  isRuntimeOnlyAuthFile,
  resolveQuotaErrorMessage,
  type QuotaProviderType,
} from '@/features/authFiles/constants';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { QuotaProgressBar } from '@/features/authFiles/components/QuotaProgressBar';
import styles from '@/pages/AuthFilesPage.module.scss';

type QuotaState = { status?: string; error?: string; errorStatus?: number } | undefined;

const getQuotaConfig = (type: QuotaProviderType) => {
  if (type === 'antigravity') return ANTIGRAVITY_CONFIG;
  if (type === 'claude') return CLAUDE_CONFIG;
  if (type === 'codex') return CODEX_CONFIG;
  if (type === 'kiro') return KIRO_CONFIG;
  if (type === 'kimi') return KIMI_CONFIG;
  if (type === 'xai') return XAI_CONFIG;
  return GEMINI_CLI_CONFIG;
};

export type AuthFileQuotaSectionProps = {
  file: AuthFileItem;
  quotaType: QuotaProviderType;
  disableControls: boolean;
};

export function AuthFileQuotaSection(props: AuthFileQuotaSectionProps) {
  const { file, quotaType, disableControls } = props;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [resettingQuota, setResettingQuota] = useState(false);

  const quota = useQuotaStore((state) => {
    if (quotaType === 'antigravity') return state.antigravityQuota[file.name] as QuotaState;
    if (quotaType === 'claude') return state.claudeQuota[file.name] as QuotaState;
    if (quotaType === 'codex') return state.codexQuota[file.name] as QuotaState;
    if (quotaType === 'kiro') return state.kiroQuota[file.name] as QuotaState;
    if (quotaType === 'kimi') return state.kimiQuota[file.name] as QuotaState;
    if (quotaType === 'xai') return state.xaiQuota[file.name] as QuotaState;
    return state.geminiCliQuota[file.name] as QuotaState;
  });

  const updateQuotaState = useQuotaStore((state) => {
    if (quotaType === 'antigravity')
      return state.setAntigravityQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'claude')
      return state.setClaudeQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'codex') return state.setCodexQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'kiro') return state.setKiroQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'kimi') return state.setKimiQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'xai') return state.setXaiQuota as unknown as (updater: unknown) => void;
    return state.setGeminiCliQuota as unknown as (updater: unknown) => void;
  });

  const refreshQuotaForFile = useCallback(async () => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (quota?.status === 'loading') return;

    const config = getQuotaConfig(quotaType) as QuotaConfig<unknown, unknown>;

    updateQuotaState((prev: Record<string, unknown>) => ({
      ...prev,
      [file.name]: config.buildLoadingState(),
    }));

    try {
      const managedResults = await refreshManagedQuotaStates(config, [file]).catch(() => null);
      const managedResult = managedResults?.[0];
      if (managedResult?.status === 'success') {
        updateQuotaState((prev: Record<string, unknown>) => ({
          ...prev,
          [file.name]: managedResult.state,
        }));
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
        return;
      }
      if (managedResult?.status === 'error' && managedResult.error && !managedResult.fallbackable) {
        throw new Error(managedResult.error);
      }

      const data = await config.fetchQuota(file, t);
      updateQuotaState((prev: Record<string, unknown>) => ({
        ...prev,
        [file.name]: config.buildSuccessState(data),
      }));
      showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      updateQuotaState((prev: Record<string, unknown>) => ({
        ...prev,
        [file.name]: config.buildErrorState(message, status),
      }));
      showNotification(t('auth_files.quota_refresh_failed', { name: file.name, message }), 'error');
    }
  }, [disableControls, file, quota?.status, quotaType, showNotification, t, updateQuotaState]);

  const config = getQuotaConfig(quotaType) as QuotaConfig<unknown, unknown>;
  const snapshotQuota = useMemo(
    () => config.buildSnapshotState?.(file) as QuotaState,
    [config, file]
  );
  useEffect(() => {
    if (!snapshotQuota || quota?.status === 'loading') return;
    updateQuotaState((prev: Record<string, unknown>) => ({
      ...prev,
      [file.name]: snapshotQuota,
    }));
  }, [file.name, quota?.status, snapshotQuota, updateQuotaState]);

  const displayQuota: QuotaState =
    quota?.status === 'loading' || quota?.status === 'error' ? quota : (quota ?? snapshotQuota);

  const resetQuotaForFile = useCallback(() => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (quota?.status === 'loading') return;
    if (resettingQuota) return;

    const resetQuota = config.resetQuota;
    if (!resetQuota) return;

    showConfirmation({
      title: t('codex_quota.reset_confirm_title'),
      message: t('codex_quota.reset_confirm_message', { name: file.name }),
      confirmText: t('codex_quota.reset_confirm_button'),
      variant: 'primary',
      onConfirm: async () => {
        setResettingQuota(true);
        try {
          const data = await resetQuota(file, t);
          updateQuotaState((prev: Record<string, unknown>) => ({
            ...prev,
            [file.name]: config.buildSuccessState(data),
          }));
          showNotification(t('codex_quota.reset_success', { name: file.name }), 'success');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('common.unknown_error');
          showNotification(t('codex_quota.reset_failed', { name: file.name, message }), 'error');
        } finally {
          setResettingQuota(false);
        }
      },
    });
  }, [
    disableControls,
    config,
    file,
    quota?.status,
    resettingQuota,
    showConfirmation,
    showNotification,
    t,
    updateQuotaState,
  ]);

  const renderConfig = config as unknown as {
    i18nPrefix: string;
    resetQuota?: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
    canResetQuota?: (quota: unknown) => boolean;
    renderQuotaItems: (quota: unknown, t: TFunction, helpers: unknown) => unknown;
  };

  const quotaStatus = displayQuota?.status ?? 'idle';
  const canRefreshQuota = !disableControls && !file.disabled && !resettingQuota;
  const canUseResetQuota = canRefreshQuota && quotaStatus !== 'loading';
  const showResetQuotaAction =
    displayQuota !== undefined && Boolean(renderConfig.canResetQuota?.(displayQuota));
  const resetQuotaAction = renderConfig.resetQuota && showResetQuotaAction ? (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={styles.quotaResetCreditButton}
      onClick={() => resetQuotaForFile()}
      disabled={!canUseResetQuota}
      loading={resettingQuota}
      title={t('codex_quota.reset_button')}
      aria-label={t('codex_quota.reset_button')}
    >
      {!resettingQuota && <IconRefreshCw size={14} />}
      {t('codex_quota.reset_button')}
    </Button>
  ) : undefined;
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    displayQuota?.errorStatus,
    displayQuota?.error || t('common.unknown_error')
  );

  return (
    <div className={styles.quotaSection}>
      <div className={styles.quotaSectionHeader}>
        <span className={styles.quotaSectionTitle}>{t('auth_files.quota_refresh_single')}</span>
        <button
          type="button"
          className={styles.cardRefreshButton}
          onClick={() => void refreshQuotaForFile()}
          disabled={!canRefreshQuota || quotaStatus === 'loading'}
          title={t('auth_files.quota_refresh_hint')}
          aria-label={t('auth_files.quota_refresh_single')}
        >
          <IconRefreshCw
            size={15}
            className={quotaStatus === 'loading' ? styles.cardRefreshIconSpinning : undefined}
          />
        </button>
      </div>
      {quotaStatus === 'loading' ? (
        <div className={styles.quotaMessage}>{t(`${renderConfig.i18nPrefix}.loading`)}</div>
      ) : quotaStatus === 'idle' ? (
        <div className={styles.quotaMessage}>{t(`${renderConfig.i18nPrefix}.idle`)}</div>
      ) : quotaStatus === 'error' ? (
        <div className={styles.quotaError}>
          {t(`${renderConfig.i18nPrefix}.load_failed`, {
            message: quotaErrorMessage,
          })}
        </div>
      ) : displayQuota ? (
        (renderConfig.renderQuotaItems(displayQuota, t, { styles, QuotaProgressBar }) as ReactNode)
      ) : (
        <div className={styles.quotaMessage}>{t(`${renderConfig.i18nPrefix}.idle`)}</div>
      )}
      {quotaStatus !== 'idle' && resetQuotaAction && (
        <div className={styles.quotaCardActions}>{resetQuotaAction}</div>
      )}
    </div>
  );
}
