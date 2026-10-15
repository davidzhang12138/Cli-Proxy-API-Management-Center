import { useId } from 'react';
import { IconExternalLink, IconPlus } from '@/components/ui/icons';
import type { ProviderFlowState } from '../hooks/useOAuthFlows';
import { BrandGlyph } from './BrandGlyph';
import styles from './SponsorCard.module.scss';

export interface SponsorCardSite {
  id: string;
  /** 完整站点名（如「Kimi 国内站」），作为登录按钮的可访问名称。 */
  name: string;
  domain: string;
  status?: ProviderFlowState['status'];
  statusLabel?: string;
  signUpUrl: string;
}

export interface SponsorCardProps {
  title: string;
  caption: string;
  icon: string;
  signUpLabel: string;
  sites: SponsorCardSite[];
  /** 点站点入口：开始该站登录并打开授权对话框。 */
  onOpen: (siteId: string) => void;
}

/** 赞助商站点与普通磁贴等大，保留各站登录及开放平台注册入口。 */
export function SponsorCard({
  title,
  caption,
  icon,
  signUpLabel,
  sites,
  onOpen,
}: SponsorCardProps) {
  const captionId = useId();

  return (
    <div className={styles.card} role="group" aria-label={title} aria-describedby={captionId}>
      <span className={styles.srOnly} id={captionId}>
        {caption}
      </span>
      {sites.map((site) => (
        <SiteEntry
          key={site.id}
          site={site}
          icon={icon}
          caption={caption}
          signUpLabel={signUpLabel}
          onOpen={() => onOpen(site.id)}
        />
      ))}
    </div>
  );
}

function SiteEntry({
  site,
  icon,
  caption,
  signUpLabel,
  onOpen,
}: {
  site: SponsorCardSite;
  icon: string;
  caption: string;
  signUpLabel: string;
  onOpen: () => void;
}) {
  const metaId = useId();

  return (
    <div className={styles.site} data-status={site.status ?? 'idle'}>
      <BrandGlyph src={icon} size={38} className={styles.glyph} />
      <span className={styles.siteText}>
        <button
          type="button"
          className={styles.siteMain}
          onClick={onOpen}
          aria-label={site.name}
          aria-haspopup="dialog"
          aria-describedby={metaId}
          title={caption}
        >
          {site.name}
        </button>
        <span className={styles.siteMeta}>
          <span id={metaId} className={styles.siteDetail}>
            {site.status && site.statusLabel ? (
              <span className={styles.status}>
                <span className={styles.statusDot} aria-hidden="true" />
                {site.statusLabel}
              </span>
            ) : (
              <span className={styles.domain}>{site.domain}</span>
            )}
          </span>
          <a
            className={styles.signUp}
            href={site.signUpUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${signUpLabel} · ${site.name}`}
          >
            {signUpLabel}
            <IconExternalLink size={12} aria-hidden="true" />
          </a>
        </span>
      </span>
      <span className={styles.trail} aria-hidden="true">
        <IconPlus size={15} />
      </span>
    </div>
  );
}
