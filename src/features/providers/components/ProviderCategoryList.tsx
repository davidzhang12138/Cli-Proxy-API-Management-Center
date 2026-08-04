import { useTranslation } from 'react-i18next';
import { PROVIDER_LOGOS } from '../brandLogos';
import type { ProviderBrand, ProviderGroup } from '../types';
import styles from './ProviderCategoryList.module.scss';

interface ProviderCategoryListProps {
  groups: ProviderGroup[];
  activeBrand: ProviderBrand;
  onSelect: (brand: ProviderBrand) => void;
}

export function ProviderCategoryList({ groups, activeBrand, onSelect }: ProviderCategoryListProps) {
  const { t } = useTranslation();

  return (
    <nav className={styles.tabs} role="tablist" aria-label={t('providersPage.categories.title')}>
      {groups.map((group) => {
        const active = group.id === activeBrand;
        const total = group.resources.length;
        const logo = PROVIDER_LOGOS[group.id];
        const logoClassName = [
          styles.logo,
          logo?.transparent ? styles.logoTransparent : '',
          logo?.themeSurface ? styles.logoThemeSurface : '',
          logo?.darkSrc ? styles.logoThemeLight : '',
          logo?.invertOnDark ? styles.logoInvertOnDark : '',
        ]
          .filter(Boolean)
          .join(' ');
        const darkLogoClassName = [
          styles.logo,
          logo?.transparent ? styles.logoTransparent : '',
          logo?.themeSurface ? styles.logoThemeSurface : '',
          styles.logoThemeDark,
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={group.id}
            type="button"
            role="tab"
            className={`${styles.tab} ${active ? styles.tabActive : ''}`}
            aria-selected={active}
            onClick={() => onSelect(group.id)}
            title={t(`providersPage.providerNames.${group.id}`)}
          >
            <span className={styles.tabIconWrap} aria-hidden="true">
              {logo ? (
                <>
                  <img src={logo.src} alt="" className={logoClassName} />
                  {logo.darkSrc ? (
                    <img src={logo.darkSrc} alt="" className={darkLogoClassName} />
                  ) : null}
                </>
              ) : null}
            </span>
            <span className={styles.tabLabel}>{t(`providersPage.providerNames.${group.id}`)}</span>
            <span className={styles.tabCount}>{total}</span>
          </button>
        );
      })}
    </nav>
  );
}
