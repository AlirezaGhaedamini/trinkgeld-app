import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { InfoNote, Lede } from '@/components/ui/Note';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { useWorkplace } from '@/hooks/useWorkplace';
import { WORKPLACE_FAILURE_KEY } from '@/workplace/errors';
import { initialsOf } from '@/data/employees';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

const CODE_LENGTH = 6;

/**
 * Join an existing workplace, or set one up.
 *
 * Three real backend paths meet on this one screen, and which one runs is never
 * the user's choice of role — it is a property of how they got here:
 *
 *   the six-character code → request_join(). This files a *request*. A manager
 *       still has to approve it, because knowing a short code that gets read out
 *       in a loud room must not be enough to get into a workplace.
 *   an invite token in the URL (#/join?token=…) → accept_invitation(). The role
 *       is whatever the manager put on the invitation; there is no argument for
 *       it and the browser cannot influence it.
 *   "set up a new workplace" → create_workplace(), which creates the workplace,
 *       seeds its areas and roles and writes the manager membership in one
 *       transaction. A workplace with no manager cannot exist.
 *
 * The layout is the prototype's, unchanged, with one addition the flow requires:
 * a workplace needs a name, so the set-up card has a name field, built from the
 * same field classes as every other input in the app.
 */
export function JoinWorkplacePage() {
  const { session, workplace: localWorkplace, dataMode } = useAppState();
  const dispatch = useAppDispatch();
  const { t, language } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const workplace = useWorkplace();
  const inputRef = useRef<HTMLInputElement>(null);

  const code = session.joinCode;
  const german = language === 'Deutsch';
  const demo = dataMode === 'demo';
  const real = workplace.enabled;
  const complete = code.length === CODE_LENGTH;
  const venueName = localWorkplace.name || t('yourWorkplace');

  const [newName, setNewName] = useState('');
  const [requested, setRequested] = useState(false);
  const acceptedToken = useRef<string | null>(null);

  const fail = (key: keyof typeof WORKPLACE_FAILURE_KEY) => show(t(WORKPLACE_FAILURE_KEY[key]));

  /**
   * An invitation link lands here as `#/join?token=…`. The token is 64 hex
   * characters, so it can never be typed into the six-cell code field — which
   * is exactly why it arrives by URL instead.
   */
  useEffect(() => {
    if (!real || workplace.busy) return;
    // Read the token from the router's location, not window.location: arriving
    // at #/join?token=… from inside the app changes the search without
    // remounting this component.
    const token = new URLSearchParams(location.search).get('token');
    if (!token || acceptedToken.current === token) return;
    acceptedToken.current = token;

    void workplace.acceptInvitation(token).then((result) => {
      if (!result.ok) {
        show(t(WORKPLACE_FAILURE_KEY[result.failure ?? 'invalidInvite']));
        return;
      }
      show(german ? 'Willkommen im Team' : 'Welcome to the team');
      navigate('/', { replace: true });
    });
  }, [real, workplace, location.search, show, t, german, navigate]);

  const submitCode = async () => {
    if (!real) {
      dispatch({ type: 'signIn', role: 'employee' });
      show(german ? 'Willkommen im Team' : 'Welcome to the team');
      navigate('/home', { replace: true });
      return;
    }
    const result = await workplace.joinWithCode(code);
    if (!result.ok) {
      fail(result.failure ?? 'invalidCode');
      return;
    }
    // request_join() files a request; there is no membership yet.
    setRequested(true);
    show(t('wpRequestSent'));
  };

  const submitCreate = async () => {
    if (!real) {
      dispatch({ type: 'signIn', role: 'manager' });
      show(german ? 'Betrieb erstellt' : 'Workplace created');
      navigate('/manager', { replace: true });
      return;
    }
    const result = await workplace.createWorkplace(newName);
    if (!result.ok) {
      fail(result.failure ?? 'createFailed');
      return;
    }
    show(german ? 'Betrieb erstellt' : 'Workplace created');
    navigate('/manager', { replace: true });
  };

  const createReady = !real || newName.trim().length > 0;

  return (
    <Screen
      title={t('yourWorkplace')}
      titleSize={26}
      back={false}
      cta={
        complete && !requested
          ? {
              label: workplace.busy ? t('wpWorking') : t('requestJoin'),
              muted: workplace.busy,
              onClick: () => {
                void submitCode();
              },
            }
          : undefined
      }
    >
      <Lede>{t('askCode')}</Lede>

      {requested ? <InfoNote icon="hourglass-medium">{t('wpRequestPending')}</InfoNote> : null}

      <div className={styles.codeField}>
        <input
          ref={inputRef}
          className={styles.codeInput}
          value={code}
          onChange={(event) => {
            // Editing the code means trying again, so the "waiting for approval"
            // state clears and the button comes back.
            setRequested(false);
            dispatch({
              type: 'setJoinCode',
              code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH),
            });
          }}
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
                {demo ? localWorkplace.name : venueName}
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

          {real ? (
            <div>
              <label className={ui.fieldLabel} htmlFor="workplace-name">
                {t('wpNameLabel')}
              </label>
              <input
                id="workplace-name"
                className={ui.fieldInput}
                autoComplete="organization"
                placeholder={t('wpNamePlaceholder')}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </div>
          ) : null}

          <Button
            variant="secondary"
            quiet
            block
            muted={!createReady}
            disabled={workplace.busy}
            onClick={() => {
              if (!createReady) {
                fail('nameRequired');
                return;
              }
              void submitCreate();
            }}
          >
            {workplace.busy ? t('wpWorking') : t('imManager')}
          </Button>
        </div>
      </Card>
    </Screen>
  );
}
