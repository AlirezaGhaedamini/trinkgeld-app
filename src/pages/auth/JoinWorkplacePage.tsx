import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { SignOutButton } from '@/auth/SignOutButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { InvitationCard } from '@/components/domain/InvitationCard';
import { InfoNote, Lede } from '@/components/ui/Note';
import { clearReturnTo, normalizeEmail } from '@/auth/returnTo';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { useWorkplace } from '@/hooks/useWorkplace';
import { WORKPLACE_FAILURE_KEY, invitationFailureFor } from '@/workplace/errors';
import { invitationTokenFrom, signInPathFor } from '@/workplace/invitationLink';
import { clearPendingJoin, readPendingJoin, writePendingJoin } from '@/workplace/pendingJoin';
import { useInvitationPreview } from '@/workplace/useInvitationPreview';
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
 *       it and the browser cannot influence it. The screen then shows the
 *       invitation instead of the code field (InvitationJoin below) and waits
 *       for the person to accept it — never silently on arrival.
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
  const { t } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const workplace = useWorkplace();
  const inputRef = useRef<HTMLInputElement>(null);

  const code = session.joinCode;
  const demo = dataMode === 'demo';
  const real = workplace.enabled;
  const complete = code.length === CODE_LENGTH;
  const venueName = localWorkplace.name || t('yourWorkplace');

  const [newName, setNewName] = useState('');
  const [requested, setRequested] = useState(false);

  const fail = (key: keyof typeof WORKPLACE_FAILURE_KEY) => show(t(WORKPLACE_FAILURE_KEY[key]));

  /**
   * A request sent from this device is remembered, so a refresh keeps saying
   * "sent, waiting for approval" instead of showing an empty field again. The
   * note ends when a membership arrives, when another code is typed, or at
   * sign-out. There is no polling: the person reopens the app once approved.
   */
  useEffect(() => {
    if (!real) return;
    const pending = readPendingJoin();
    if (!pending) return;
    if (workplace.memberships.length > 0) {
      clearPendingJoin();
      setRequested(false);
      return;
    }
    dispatch({ type: 'setJoinCode', code: pending.code });
    setRequested(true);
  }, [real, workplace.memberships.length, dispatch]);

  const submitCode = async () => {
    if (!real) {
      dispatch({ type: 'signIn', role: 'employee' });
      show(t('wpWelcome'));
      navigate('/home', { replace: true });
      return;
    }
    if (workplace.busy) return;
    const result = await workplace.joinWithCode(code);
    if (!result.ok) {
      fail(result.failure ?? 'invalidCode');
      return;
    }
    // request_join() files a request; there is no membership yet.
    writePendingJoin(code);
    setRequested(true);
    show(t('wpRequestSent'));
  };

  const submitCreate = async () => {
    if (!real) {
      dispatch({ type: 'signIn', role: 'manager' });
      show(t('wpCreated'));
      navigate('/manager', { replace: true });
      return;
    }
    if (workplace.busy) return;
    const result = await workplace.createWorkplace(newName);
    if (!result.ok) {
      fail(result.failure ?? 'createFailed');
      return;
    }
    show(t('wpCreated'));
    navigate('/manager', { replace: true });
  };

  const createReady = !real || newName.trim().length > 0;

  /* An invitation link is its own screen: what the manager entered, and one
     button. The code field and the set-up card belong to people who arrived
     without one. The token is read from the router's location, so a link
     opened from inside the app is seen without a remount. */
  const token = real ? invitationTokenFrom(location.search) : null;
  if (token) return <InvitationJoin token={token} />;

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

      {requested ? (
        <>
          <InfoNote icon="hourglass-medium">
            {t('wpRequestPending')} {t('wpRequestPendingRefresh')}
          </InfoNote>
          <Button
            variant="ghost"
            onClick={() => {
              clearPendingJoin();
              setRequested(false);
              dispatch({ type: 'setJoinCode', code: '' });
            }}
          >
            {t('wpRequestReset')}
          </Button>
        </>
      ) : null}

      <div className={styles.codeField}>
        <input
          ref={inputRef}
          className={styles.codeInput}
          value={code}
          onChange={(event) => {
            // Editing the code means trying again, so the "waiting for approval"
            // state clears and the button comes back.
            clearPendingJoin();
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

      {/* Nobody on this screen has a membership yet, so there is no tab bar
          and no route to the profile screen that normally carries this. It
          is also the screen an invitation opens on the wrong account. */}
      <SignOutButton />
    </Screen>
  );
}

/**
 * The invitation, before it is accepted.
 *
 * The same card the sign-up screen showed, so the person recognises what they
 * are about to join, then one button. Acceptance is never automatic: an
 * existing account deserves to see which workplace is adding it, and a link
 * that arrives on the wrong account must not be consumed by it.
 *
 * The address check here is the courtesy; accept_invitation() (migration 41)
 * is the rule and refuses any account but the invited one. The screen only
 * says so before the person presses anything, and offers the way out: sign
 * out, then sign in again with the token still in the URL.
 *
 * A link that can no longer be used says why, from the server's own status,
 * and offers the ordinary join screen instead.
 */
function InvitationJoin({ token }: { token: string }) {
  const { t } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();
  const auth = useAuth();
  const workplace = useWorkplace();
  const lookup = useInvitationPreview(token, true);

  const preview = lookup.status === 'ready' ? lookup.preview : null;
  const closed = preview ? invitationFailureFor(preview.status) : null;
  const signedInAs = normalizeEmail(auth.email);
  const wrongAccount =
    preview !== null && !closed && normalizeEmail(preview.email) !== signedInAs;
  const canAccept = preview !== null && !closed && !wrongAccount;

  /* A link the server calls closed or unknown has no future on this device:
     drop the stored confirmation return now rather than at the next start. */
  const dead = lookup.status === 'missing' || closed !== null;
  useEffect(() => {
    if (dead) clearReturnTo();
  }, [dead]);

  const accept = async () => {
    if (!canAccept || workplace.busy) return;
    const result = await workplace.acceptInvitation(token);
    if (!result.ok) {
      show(t(WORKPLACE_FAILURE_KEY[result.failure ?? 'invalidInvite']));
      // Whatever changed under us — used, withdrawn, expired — the card
      // should now say it, rather than keep offering the button.
      lookup.reload();
      return;
    }
    // Accepted: the token has done its job. Forget the stored return path at
    // once, and REPLACE the token-bearing entry with the app itself.
    clearReturnTo();
    show(t('wpWelcome'));
    navigate('/', { replace: true });
  };

  const problem =
    lookup.status === 'missing'
      ? t('wpInvalidInvite')
      : lookup.status === 'error'
        ? t('authNetwork')
        : closed
          ? t(WORKPLACE_FAILURE_KEY[closed])
          : null;

  return (
    <Screen
      title={t('yourWorkplace')}
      titleSize={26}
      back={false}
      cta={
        canAccept
          ? {
              label: workplace.busy ? t('wpWorking') : t('inviteAccept'),
              muted: workplace.busy,
              onClick: () => {
                void accept();
              },
            }
          : undefined
      }
    >
      {lookup.status === 'loading' || lookup.status === 'idle' ? (
        <InfoNote icon="hourglass-medium">{t('inviteLoading')}</InfoNote>
      ) : null}

      {preview && !closed ? (
        <>
          <Lede>{t('inviteLede')}</Lede>
          <InvitationCard preview={preview} />
        </>
      ) : null}

      {wrongAccount && preview ? (
        <InfoNote icon="warning-circle">
          {t('inviteWrongAccount')
            .replace('{email}', preview.email ?? '')
            .replace('{current}', auth.email || '—')}
        </InfoNote>
      ) : null}

      {problem ? <InfoNote icon="warning-circle">{problem}</InfoNote> : null}

      {lookup.status === 'error' ? (
        <Button variant="secondary" quiet block onClick={lookup.reload}>
          {t('retry')}
        </Button>
      ) : null}

      {problem && lookup.status !== 'error' ? (
        <Button variant="secondary" quiet block onClick={() => navigate('/join', { replace: true })}>
          {t('inviteUseCode')}
        </Button>
      ) : null}

      {/* The wrong account leaves towards a sign-in that still holds the
          token; anyone else leaves the ordinary way. */}
      <SignOutButton to={wrongAccount ? signInPathFor(token) : '/signin'} />
    </Screen>
  );
}
