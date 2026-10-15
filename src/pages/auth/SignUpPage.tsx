import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { InvitationCard } from '@/components/domain/InvitationCard';
import { Button } from '@/components/ui/Button';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { InfoNote, Lede, Note } from '@/components/ui/Note';
import { AUTH_FAILURE_KEY } from '@/auth/errors';
import { rememberReturnTo, safeReturnTo, takeReturnTo } from '@/auth/returnTo';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useAuth, useRealAuth } from '@/hooks/useAuth';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { WORKPLACE_FAILURE_KEY, invitationFailureFor } from '@/workplace/errors';
import { invitationTokenFrom, joinPathFor, signInPathFor } from '@/workplace/invitationLink';
import { useInvitationPreview } from '@/workplace/useInvitationPreview';
import type { UserRole } from '@/types';
import ui from '@/components/ui/ui.module.css';

/**
 * Create an account.
 *
 * The name is handed to Supabase as user metadata, which is where
 * `app.handle_new_user()` reads it from when it creates the profile row. The
 * browser never inserts into `public.profiles` — it has no policy to do so, by
 * design.
 *
 * Opened from an invitation (`#/signup?token=…`, where RequireSession sends a
 * signed-out visit to the link) the screen becomes the invitation's sign-up:
 * it reads the invitation by its token, shows the workplace, name, address,
 * area and role the manager entered, and asks only for what the manager could
 * not know — a password. The address is the invited one and is not a field:
 * accept_invitation() admits only the account that owns it, so offering to
 * change it would only build an account that cannot join. The name IS a
 * field, prefilled with the invited name: it becomes the person's own profile
 * name, which is theirs to spell, and this is the one place it is set. The
 * workplace's name for them stays on the roster row either way.
 *
 * The token lives in this screen's URL, so a refresh keeps it. When the
 * project asks for an email confirmation, the way back to the invitation is
 * stored for the invited address alone (src/auth/returnTo.ts), and the
 * confirmation lands on the invitation instead of an empty start.
 *
 * If the project has email confirmation switched on, sign-up returns a user but
 * no session; the screen then says so and waits, rather than pretending the
 * account is ready. Supabase deliberately returns the same shape for an address
 * that is already registered, so this path leaks nothing either way.
 */
export function SignUpPage() {
  const { session } = useAppState();
  const dispatch = useAppDispatch();
  const auth = useAuth();
  const real = useRealAuth();
  const { t } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  /* An invitation's token, in this screen's own URL. */
  const token = real ? invitationTokenFrom(location.search) : null;
  const lookup = useInvitationPreview(token, token !== null);
  const preview = lookup.status === 'ready' ? lookup.preview : null;
  const closed = preview ? invitationFailureFor(preview.status) : null;
  /* The invitation this sign-up is for: found, still open, and addressed. */
  const invited = preview && !closed && preview.email ? preview : null;

  /* Where to go once the account exists. With a token: the invitation, unless
     the server already said it is closed or unknown — a dead link is not
     worth storing or returning to. A failed lookup still counts, because the
     link may well be fine. Without one: wherever sign-in was sent from. */
  const deadLink = closed !== null || lookup.status === 'missing';
  const from = token
    ? deadLink
      ? null
      : joinPathFor(token)
    : safeReturnTo((location.state as { from?: unknown } | null)?.from);

  const [name, setName] = useState(session.accountName);
  const [email, setEmail] = useState(session.accountEmail);
  const [password, setPassword] = useState('');
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  // The invited name fills an empty name field once. Clearing it afterwards
  // is the person's choice and is not undone.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!invited || prefilled.current) return;
    prefilled.current = true;
    if (invited.invitedName) setName((current) => (current.trim() ? current : invited.invitedName ?? ''));
  }, [invited]);

  // Sign-up finishes with a live session and then continues to the workplace
  // step, so this screen cannot be behind a blanket "already signed in" guard.
  // It turns away someone who arrived here with a session instead.
  const ownSession = useRef(false);
  const arrivedSignedIn = real && auth.status === 'signedIn' && !ownSession.current;

  /* The address the account is created with: the invited one, or the field. */
  const accountEmail = invited?.email ?? email;
  const named = name.trim().length > 0 && accountEmail.trim().length > 0;
  const ready = real ? named && password.length > 0 : named;
  const waiting = token !== null && lookup.status === 'loading';

  const submit = async () => {
    if (auth.busy || waiting) return;
    if (!named) {
      show(t('needName'));
      return;
    }
    if (real && password.length === 0) {
      show(t('authNeedPassword'));
      return;
    }

    if (!real) {
      dispatch({ type: 'signIn', role: session.role, name: name.trim(), email: email.trim() });
      navigate('/join');
      return;
    }

    ownSession.current = true;
    const result = await auth.signUp(name.trim(), accountEmail.trim(), password);
    if (!result.ok) {
      ownSession.current = false;
      show(t(AUTH_FAILURE_KEY[result.failure ?? 'unknown']));
      return;
    }

    if (result.needsEmailConfirmation) {
      // The confirmation link reopens the app at its root. Keep the way back
      // to the invitation, if there was one, for that moment — stored with
      // the address that signed up, so only that account can use it, once.
      if (from) rememberReturnTo(from, accountEmail);
      setPassword('');
      setAwaitingConfirmation(true);
      return;
    }

    // Signed in already: back to the invitation if there was one, otherwise
    // the workplace step, exactly as before. The invitation REPLACES this
    // screen, so no second token-bearing entry is left in the history.
    if (token) navigate(from ?? '/join', { replace: true });
    else navigate(from ?? takeReturnTo(accountEmail) ?? '/join');
  };

  if (arrivedSignedIn) return <Navigate to={token ? joinPathFor(token) : '/'} replace />;

  /* Why a link that was followed here cannot be used. The ordinary sign-up
     stays below it: an account is still worth creating. */
  const linkProblem =
    token === null
      ? null
      : closed
        ? t(WORKPLACE_FAILURE_KEY[closed])
        : lookup.status === 'missing'
          ? t('wpInvalidInvite')
          : null;

  return (
    <Screen
      title={t('signUp')}
      cta={{
        label: auth.busy ? t('authCreating') : t('continue'),
        muted: !ready || auth.busy || waiting,
        onClick: () => {
          void submit();
        },
      }}
    >
      <div className={ui.stackTight}>
        {awaitingConfirmation ? <InfoNote icon="paper-plane-tilt">{t('authCheckInboxBody')}</InfoNote> : null}

        {waiting ? <InfoNote icon="hourglass-medium">{t('inviteLoading')}</InfoNote> : null}
        {linkProblem ? <InfoNote icon="warning-circle">{linkProblem}</InfoNote> : null}

        {invited ? (
          <>
            <Lede>{t('inviteSignupLede')}</Lede>
            <InvitationCard preview={invited} />
          </>
        ) : null}

        <div>
          <label className={ui.fieldLabel} htmlFor="signup-name">
            {t('nameLabel')}
          </label>
          <input
            id="signup-name"
            className={ui.fieldInput}
            autoComplete="name"
            placeholder={t('nameLabel')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {invited ? (
          // The invited address is shown on the card and is the account's
          // address; it is not a field. Kept in the form, hidden, so a
          // password manager saves the credential under the right address.
          <input type="email" autoComplete="username" value={accountEmail} readOnly hidden />
        ) : (
          <div>
            <label className={ui.fieldLabel} htmlFor="signup-email">
              {t('emailLabel')}
            </label>
            <input
              id="signup-email"
              className={ui.fieldInput}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t('emailLabel')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
        )}
        <div>
          <label className={ui.fieldLabel} htmlFor="signup-password">
            {t('pwLabel')}
          </label>
          <input
            id="signup-password"
            className={ui.fieldInput}
            type="password"
            autoComplete="new-password"
            placeholder={t('pwLabel')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {invited ? <Note>{t('inviteEmailFixed')}</Note> : null}

        {/* The role chips are the demo's: they decide which sample account
            the local sign-in creates. A real account has no role until it
            joins or creates a workplace, so they are not shown there. */}
        {real ? null : (
          <div style={{ marginTop: 4 }}>
            <span className={ui.fieldLabel}>{t('iAm')}</span>
            <ChipGroup<UserRole>
              label={t('iAm')}
              fill
              value={session.role}
              options={[
                { value: 'employee', label: t('empRole') },
                { value: 'manager', label: t('mgrRole') },
              ]}
              onChange={(role) => dispatch({ type: 'setRole', role })}
            />
          </div>
        )}

        {/* Somebody who already has an account takes the invitation through
            sign-in, which keeps the token in its own URL. */}
        {token && !linkProblem ? (
          <Button
            variant="secondary"
            quiet
            block
            disabled={auth.busy}
            onClick={() => navigate(signInPathFor(token), { replace: true })}
          >
            {t('inviteHaveAccount')}
          </Button>
        ) : null}

        <Note>{t('termsNote')}</Note>
      </div>
    </Screen>
  );
}
