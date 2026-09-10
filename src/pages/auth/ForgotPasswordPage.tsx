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
 * Ask for a recovery link.
 *
 * The one thing this screen must not do is tell anybody whether an address is
 * registered. So the confirmation is the same for an address that has an
 * account and one that does not — "if that address has an account, a link is on
 * its way" — and the provider swallows the refusals that would give it away,
 * reporting only what the person can act on: too many attempts, an address that
 * is not an address, and no network.
 */
export function ForgotPasswordPage() {
  const { t } = useI18n();
  const auth = useAuth();
  const navigate = useNavigate();
  const { show } = useToast();

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const ready = email.trim().length > 0;

  const submit = async () => {
    if (!ready || auth.busy) return;
    const result = await auth.requestPasswordReset(email);
    if (result.ok) {
      setSent(true);
      return;
    }
    show(t(AUTH_FAILURE_KEY[result.failure ?? 'unknown']));
  };

  if (sent) {
    return (
      <Screen title={t('pwResetSent')} back="arrow">
        <Lede>{t('pwResetSentBody')}</Lede>
        <Button block onClick={() => navigate('/signin', { replace: true })}>
          {t('pwResetBack')}
        </Button>
      </Screen>
    );
  }

  return (
    <Screen title={t('pwResetTitle')} back="arrow">
      <Lede>{t('pwResetBody')}</Lede>

      <form
        className={ui.stackTight}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div>
          <label className={ui.fieldLabel} htmlFor="reset-email">
            {t('emailLabel')}
          </label>
          <input
            id="reset-email"
            className={ui.fieldInput}
            type="email"
            inputMode="email"
            autoComplete="username"
            placeholder={t('emailLabel')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>


        <Button type="submit" block muted={!ready} disabled={auth.busy} aria-busy={auth.busy}>
          {auth.busy ? t('pwResetSending') : t('pwResetSend')}
        </Button>
      </form>
    </Screen>
  );
}
