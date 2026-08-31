import { Screen } from '@/components/layout/Screen';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Note } from '@/components/ui/Note';
import { useI18n } from '@/hooks/useI18n';
import type { Language } from '@/types';
import ui from '@/components/ui/ui.module.css';

const SAMPLES: Record<Language, string> = {
  English: '€2,480.00 · Sat 22 Aug',
  Deutsch: '2.480,00 € · Sa 22. Aug',
};

/** Language applies to the whole app, including exports and notifications. */
export function LanguagePage() {
  const { t, language, setLanguage } = useI18n();
  const options: Language[] = ['English', 'Deutsch'];

  return (
    <Screen title={t('sLang')}>
      <Card padding="none" clip>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`${ui.insetRow} ${ui.insetRowInteractive} ${ui.insetRowTall}`}
            onClick={() => setLanguage(option)}
            aria-pressed={option === language}
          >
            <span className={ui.rowMain}>
              <span style={{ fontSize: 16 }}>{option}</span>
              <span className={ui.rowMeta} style={{ display: 'block' }}>
                {SAMPLES[option]}
              </span>
            </span>
            {option === language ? (
              <Icon name="check-circle" fill size={22} color="var(--color-accent)" />
            ) : null}
          </button>
        ))}
      </Card>
      <Note>{t('langNote')}</Note>
    </Screen>
  );
}
