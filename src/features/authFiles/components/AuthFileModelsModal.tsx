import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { authFilesApi } from '@/services/api';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { isModelExcluded } from '@/features/authFiles/constants';
import { getErrorMessage } from '@/utils/helpers';
import styles from './AuthFileModelsModal.module.scss';

type ModelCheckState =
  | { state: 'checking' }
  | { state: 'success'; latencyMs: number }
  | { state: 'error'; message: string; statusCode?: number };

export type AuthFileModelsModalProps = {
  open: boolean;
  fileName: string;
  fileType: string;
  authIndex: string;
  loading: boolean;
  error: 'unsupported' | null;
  models: AuthFileModelItem[];
  excluded: Record<string, string[]>;
  onClose: () => void;
  onCopyText: (text: string) => void;
};

export function AuthFileModelsModal(props: AuthFileModelsModalProps) {
  const { t } = useTranslation();
  const {
    open,
    fileName,
    fileType,
    authIndex,
    loading,
    error,
    models,
    excluded,
    onClose,
    onCopyText,
  } = props;
  const [checks, setChecks] = useState<Record<string, ModelCheckState>>({});

  useEffect(() => {
    setChecks({});
  }, [fileName, open]);

  const checkModel = async (model: string) => {
    setChecks((current) => ({ ...current, [model]: { state: 'checking' } }));
    try {
      const result = await authFilesApi.checkModel(fileName, model, authIndex);
      setChecks((current) => ({
        ...current,
        [model]: result.available
          ? { state: 'success', latencyMs: result.latency_ms }
          : {
              state: 'error',
              message: result.message || `HTTP ${result.status_code}`,
              statusCode: result.status_code,
            },
      }));
    } catch (requestError) {
      setChecks((current) => ({
        ...current,
        [model]: {
          state: 'error',
          message: getErrorMessage(requestError, t('auth_files.models_check_failed')),
        },
      }));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('auth_files.models_title', { defaultValue: '支持的模型' }) + ` - ${fileName}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {loading ? (
        <div className="hint">
          {t('auth_files.models_loading', { defaultValue: '正在加载模型列表...' })}
        </div>
      ) : error === 'unsupported' ? (
        <EmptyState
          title={t('auth_files.models_unsupported', { defaultValue: '当前版本不支持此功能' })}
          description={t('auth_files.models_unsupported_desc', {
            defaultValue: '请更新 CLI Proxy API 到最新版本后重试',
          })}
        />
      ) : models.length === 0 ? (
        <EmptyState
          title={t('auth_files.models_empty', { defaultValue: '该凭证暂无可用模型' })}
          description={t('auth_files.models_empty_desc', {
            defaultValue: '该认证凭证可能尚未被服务器加载或没有绑定任何模型',
          })}
        />
      ) : (
        <div className={styles.list}>
          {models.map((model) => {
            const excludedModel = isModelExcluded(model.id, fileType, excluded);
            const check = checks[model.id];
            return (
              <div
                key={model.id}
                className={`${styles.item} ${excludedModel ? styles.itemExcluded : ''}`}
                onClick={() => {
                  onCopyText(model.id);
                }}
                title={
                  excludedModel
                    ? t('auth_files.models_excluded_hint', {
                        defaultValue: '此 OAuth 模型已被禁用',
                      })
                    : t('common.copy', { defaultValue: '点击复制' })
                }
              >
                <span className={styles.modelId}>{model.id}</span>
                {model.display_name && model.display_name !== model.id && (
                  <span className={styles.modelDisplayName}>{model.display_name}</span>
                )}
                {model.type && <span className={styles.modelType}>{model.type}</span>}
                {excludedModel && (
                  <span className={styles.excludedBadge}>
                    {t('auth_files.models_excluded_badge', { defaultValue: '已禁用' })}
                  </span>
                )}
                {check?.state === 'success' && (
                  <span className={styles.availableBadge}>
                    {t('auth_files.models_available', { latency: check.latencyMs })}
                  </span>
                )}
                {check?.state === 'error' && (
                  <span className={styles.unavailableBadge} title={check.message}>
                    {t('auth_files.models_unavailable')}
                    {check.statusCode ? ` · ${check.statusCode}` : ''}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.checkButton}
                  loading={check?.state === 'checking'}
                  disabled={excludedModel}
                  onClick={(event) => {
                    event.stopPropagation();
                    void checkModel(model.id);
                  }}
                >
                  {t('auth_files.models_check')}
                </Button>
                {check?.state === 'error' && (
                  <span className={styles.checkMessage}>{check.message}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
