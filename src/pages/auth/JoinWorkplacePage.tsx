import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Lede } from '@/components/ui/Note';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { initialsOf } from '@/data/employees';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

const CODE_LENGTH = 6;

/**
 * Join an existing workplace with a six-character code, or set up a new one.
 *
 * The code is typed, not pre-filled: the six cells are a display over one real
 * input, so the design is unchanged but the field behaves like a field. Without
 * a backend the code cannot be looked up yet, so joining takes you in with the
 * code you entered; Supabase turns it into a real lookup.
 */
export function JoinWorkplacePage() {
  const { session, workplace, dataMode } = useAppState();
  const dispatch = useAppDispatch();
  const { t, language } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const code = session.joinCode;
  const german = language === 'Deutsch';
  const demo = dataMode === 'demo';
  const complete = code.length === CODE_LENGTH;
  const venueName = workplace.name || t('yourWorkplace');

  return (
    <Screen
      title={t('yourWorkplace')}
      titleSize={26}
      cta={
        complete
          ? {
              label: t('requestJoin'),
              onClick: () => {
                dispatch({ type: 'signIn', role: 'employee' });
                show(german ? 'Willkommen im Team' : 'Welcome to the team');
                navigate('/home', { replace: true });
              },
            }
          : undefined
      }
    >
      <Lede>{t('askCode')}</Lede>

      <div className={styles.codeField}>
        <input
          ref={inputRef}
          className={styles.codeInput}
          value={code}
          onChange={(event) =>
            dispatch({
              type: 'setJoinCode',
              code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH),
            })
          }
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          aria-label={t('workplaceCode')}
        />
        <div className={styles.codeCells} aria-hidden>
          {Array.from({ length: CODE_LENGTH }, (_, index) => (
            <div
              key={index}
              className={`${styles.codeCell} ${code[index] ? styles.codeCellFilled : ''}`}
            >
              {code[index] ?? ''}
            </div>
          ))}
        </div>
      </div>

      {complete ? (
        <Card tone="primary" padding="padded">
          <div className={ui.inline}>
            <span className={styles.venueBadge}>{initialsOf(venueName) || code.slice(0, 2)}</span>
            <span className={ui.rowMain}>
              <span className={`${ui.rowTitle} ${ui.rowTitleStrong}`}>
                {demo ? workplace.name : venueName}
              </span>
              <span className={ui.rowMeta}>
                {demo ? t('venueMeta') : `${t('workplaceCode')} ${code}`}
              </span>
            </span>
            <Icon name="check-circle" fill size={21} color="var(--color-accent)" />
          </div>
        </Card>
      ) : (
        <Button
          variant="secondary"
          quiet
          block
          icon="clipboard-text"
          onClick={async () => {
            try {
              const pasted = await navigator.clipboard.readText();
              const cleaned = pasted.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
              if (cleaned) {
                dispatch({ type: 'setJoinCode', code: cleaned });
                return;
              }
            } catch {
              /* clipboard blocked — fall through to focusing the field */
            }
            inputRef.current?.focus();
            show(t('joinCodePrompt'));
          }}
        >
          {t('pasteCode')}
        </Button>
      )}

      <p className={styles.orRule}>{t('or')}</p>

      <Card padding="roomy">
        <div className={ui.stackTight}>
          <span className={`${ui.rowTitle} ${ui.rowTitleStrong}`}>{t('setupNew')}</span>
          <p className={ui.noteBody}>{t('setupBody')}</p>
          <Button
            variant="secondary"
            quiet
            block
            onClick={() => {
              dispatch({ type: 'signIn', role: 'manager' });
              show(german ? 'Betrieb erstellt' : 'Workplace created');
              navigate('/manager', { replace: true });
            }}
          >
            {t('imManager')}
          </Button>
        </div>
      </Card>
    </Screen>
  );
}
