import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useAppDispatch } from '@/hooks/useAppState';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/hooks/useI18n';

/**
 * The way out, for the screens that have no tab bar under them.
 *
 * The profile screen has carried a sign-out button since Phase 3; the two
 * onboarding screens never did, because they were reached through a shell that
 * always had one. They are not: AppLayout hides the tab bar until there is an
 * active membership, so anybody signed in WITHOUT one — waiting for a join
 * request to be approved, or landing on an invitation as the wrong account —
 * had no route to the profile screen and no way to leave. The 3S-A audit
 * found them trapped short of clearing site data.
 *
 * Same three steps as the profile screen's own button, in the same order and
 * for the same reason: the local state is cleared only after the network call
 * has returned, so nobody is left looking at a signed-in screen they cannot
 * get off.
 */
export function SignOutButton() {
  const { t } = useI18n();
  const auth = useAuth();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  return (
    <Button
      variant="ghost"
      block
      disabled={auth.busy}
      onClick={() => {
        void (async () => {
          await auth.signOut();
          dispatch({ type: 'signOut' });
          navigate('/signin', { replace: true });
        })();
      }}
    >
      {t('signOut')}
    </Button>
  );
}
