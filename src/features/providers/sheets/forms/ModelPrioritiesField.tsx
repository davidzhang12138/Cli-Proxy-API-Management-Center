import { useTranslation } from 'react-i18next';
import { parseModelPrioritiesText } from '@/utils/modelPriorities';
import styles from './sharedForm.module.scss';

export function ModelPrioritiesField({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const valid = parseModelPrioritiesText(value).valid;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {t('providersPage.form.modelPriorities')}
      </label>
      <textarea
        id={id}
        className={styles.textarea}
        value={value}
        rows={5}
        placeholder={t('providersPage.form.modelPrioritiesPlaceholder')}
        aria-invalid={!valid}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className={styles.labelHint}>{t('providersPage.form.modelPrioritiesHint')}</span>
      {!valid ? (
        <div className={styles.errorBox}>{t('providersPage.form.validation.modelPrioritiesInvalid')}</div>
      ) : null}
    </div>
  );
}
