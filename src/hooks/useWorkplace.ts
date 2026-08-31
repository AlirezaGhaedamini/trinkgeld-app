import { useContext } from 'react';

import { WorkplaceContext, type WorkplaceValue } from '@/workplace/workplaceContext';
import type { MemberRole } from '@/workplace/types';
import { useAppState } from '@/hooks/useAppState';

/** Memberships, the active workplace, and the real role. */
export function useWorkplace(): WorkplaceValue {
  const value = useContext(WorkplaceContext);
  if (!value) throw new Error('useWorkplace must be used inside <WorkplaceProvider>');
  return value;
}

/**
 * The role the app must act on.
 *
 * In real mode it is the role on the active `workplace_members` row and
 * nothing else — not the sign-in screen's toggle, not the reducer, not a value
 * in local storage. In demo mode it is the local choice, because the demo
 * dataset has no database behind it and switching roles is the whole point of
 * it.
 *
 * This is the single function that decides, so there is one place to audit.
 */
export function useActiveRole(): MemberRole {
  const workplace = useWorkplace();
  const { session } = useAppState();
  if (workplace.enabled) return workplace.role ?? 'employee';
  return session.role;
}
