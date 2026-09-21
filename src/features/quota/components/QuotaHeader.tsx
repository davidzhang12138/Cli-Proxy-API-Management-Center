import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useCountUp } from '@/hooks/motion';
import styles from './QuotaHeader.module.scss';

export type QuotaHeaderProps = {
  totalCount: number;
  loadedCount: number;
  attentionCount: number;
  /** 作用域按钮是否正在拉取（本 tab 的凭证有 loading 即可）。 */
  scopeRefreshing: boolean;
  /** 当前页按钮是否正在拉取。 */
  pageRefreshing: boolean;
  canRefreshScope: boolean;
  canRefreshPage: boolean;
  /** 当前 tab 的刷新作用域：'all' = 全部凭证，provider = 该 provider 的凭证。 */
  refreshScopeLabel: string;
  onRefreshScope: () => void;
  onRefreshPage: () => void;
};

/**
 * 额度页头部：标题领衔 + ▍mono 遥测 meta 行 + 两枚刷新药丸。
 * 与凭证库头部同语汇（无 eyebrow —— ▍游标挂在 meta 行开头）。
 *
 * 刷新层级：主按钮跟随当前 tab —— '全部' 刷全部、provider tab 刷该 provider
 * 的所有页；次按钮只刷当前这一页（不重载文件列表，也不点一下刷全部）。
 *
 * 入场：三处 `data-reveal` 交给页面壳的 useRevealGroup 统一编排
 * （标题 0ms → meta 70ms → 动作 140ms → tabs 210ms）。
 */
export function QuotaHeader(props: QuotaHeaderProps) {
  const {
    totalCount,
    loadedCount,
    attentionCount,
    scopeRefreshing,
    pageRefreshing,
    canRefreshScope,
    canRefreshPage,
    refreshScopeLabel,
    onRefreshScope,
    onRefreshPage,
  } = props;
  const { t } = useTranslation();
  // 批量结果陆续落地时，「已加载」是页面上唯一滚动的数字
  const displayLoadedCount = useCountUp(loadedCount);

  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        <h1 className={styles.title} data-reveal>
          {t('quota_management.title')}
        </h1>
        <p className={styles.meta} data-reveal>
          <span className={styles.metaTotal}>
            {t('quota_management.meta_credentials', { count: totalCount })}
          </span>
          <span className={styles.metaDot} aria-hidden="true">
            ·
          </span>
          <span className={loadedCount > 0 ? styles.metaLoaded : styles.metaMuted}>
            {t('quota_management.meta_loaded', { count: displayLoadedCount })}
          </span>
          {attentionCount > 0 && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.metaAttention}>
                {t('quota_management.meta_attention', { count: attentionCount })}
              </span>
            </>
          )}
        </p>
      </div>
      <div className={styles.actions} data-reveal>
        <button
          type="button"
          className={styles.secondaryAction}
          onClick={onRefreshPage}
          disabled={!canRefreshPage}
        >
          <IconRefreshCw size={14} className={pageRefreshing ? styles.spinning : undefined} />
          {t('quota_management.refresh_page_credentials')}
        </button>
        <button
          type="button"
          className={styles.primaryAction}
          onClick={onRefreshScope}
          disabled={!canRefreshScope}
        >
          <IconRefreshCw size={14} className={scopeRefreshing ? styles.spinning : undefined} />
          <span className={styles.actionLabel}>
            {t('quota_management.refresh_credentials', { scope: refreshScopeLabel })}
          </span>
        </button>
      </div>
    </header>
  );
}
