import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { Lede } from '@/components/ui/Note';
import { AUTH_FAILURE_KEY } from '@/auth/errors';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import ui from '@/components/ui/ui.module.css';

/**
 * Where a recovery link lands.
 *
 * Following the emailed link gives supabase-js a session — that is what makes
 * the password changeable — so this screen is deliberately NOT behind the
 * "already signed in? go to the app" guard, which would bounce the person
 * straight past the thing they came to do.
 *
 * No session means the link was already used, or expired, or was opened in a
 * browser that never received it. That is a state worth naming rather than an
 * error worth showing: the way out is another link, not a retry.
 *
 * The session is left in place afterwards. It is a real session for the right
 * account, and signing somebody out of the app the moment they fix their
 * password would be a strange thing to do to them.
 */
export function NewPasswordPage() {
  const { t } = useI18n();
  const auth = useAuth();
  const navigate = useNavigate();
  const { show } = useToast();

  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);

  const ready = password.length > 0;

  const submit = async () => {
    if (!ready || auth.busy) return;
    const result = await auth.setPassword(password);
    if (result.ok) {
      setPassword('');
      setDone(true);
      return;
    }
    show(t(AUTH_FAILURE_KEY[result.failure ?? 'unknown']));
  };

  // Wait for supabase-js to finish reading the link out of the URL before
  // deciding there is nothing there.
  if (auth.status === 'restoring') {
    return (
      <Screen title={t('pwNewTitle')} back={false}>
        <Lede>{t('pwNewBody')}</Lede>
      </Screen>
    );
  }

  if (auth.status !== 'signedIn') {
    return (
      <Screen title={t('pwLinkExpired')} back={false}>
        <Lede>{t('pwLinkExpiredBody')}</Lede>
        <Button block onClick={() => navigate('/reset', { replace: true })}>
          {t('pwResetAgain')}
        </Button>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen title={t('pwNewDone')} back={false}>
        <Lede>{t('pwNewDoneBody')}</Lede>
        <Button block onClick={() => navigate('/', { replace: true })}>
          {t('continue')}
        </Button>
      </Screen>
    );
  }

  return (
    <Screen title={t('pwNewTitle')} back={false}>
      <Lede>{t('pwNewBody')}</Lede>

      <form
        className={ui.stackTight}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div>
          <label className={ui.fieldLabel} htmlFor="new-password">
            {t('pwNewLabel')}
          </label>
          <input
            id="new-password"
            className={ui.fieldInput}
            type="password"
            autoComplete="new-password"
            placeholder={t('pwNewLabel')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>


        <Button type="submit" block muted={!ready} disabled={auth.busy} aria-busy={auth.busy}>
          {auth.busy ? t('pwNewSaving') : t('pwNewSave')}
        </Button>
      </form>
    </Screen>
  );
}
