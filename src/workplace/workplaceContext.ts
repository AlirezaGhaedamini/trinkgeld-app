import { createContext } from 'react';

import type { WorkplaceFailure } from '@/workplace/errors';
import type { Membership, MemberRole } from '@/workplace/types';

/**
 * loading — memberships are being fetched. Guards must WAIT, exactly as they do
 *           for session restoration: treating "not known yet" as "no workplace"
 *           throws a manager onto the onboarding screen on every refresh.
 * ready   — the list is current (it may legitimately be empty).
 * error   — the fetch failed. Distinct from "empty", because sending someone to
 *           create a second workplace because the network blipped would be bad.
 */
export type WorkplaceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface WorkplaceActionResult {
  ok: boolean;
  failure?: WorkplaceFailure;
  /** request_join() only: a manager still has to approve. */
  pendingApproval?: boolean;
}

export interface WorkplaceValue {
  /** False in demo mode or with no credentials — the local Phase 1 state rules. */
  enabled: boolean;
  status: WorkplaceStatus;
  memberships: Membership[];
  activeMembership: Membership | null;
  /**
   * The authoritative role, read from the active `workplace_members` row.
   * Null when there is no active membership. Nothing the browser stores can
   * change this — local storage only picks *which* workplace, never the role.
   */
  role: MemberRole | null;
  busy: boolean;
  setActiveWorkplace: (workplaceId: string) => void;
  refresh: () => Promise<void>;
  createWorkplace: (name: string) => Promise<WorkplaceActionResult>;
  joinWithCode: (code: string) => Promise<WorkplaceActionResult>;
  acceptInvitation: (token: string) => Promise<WorkplaceActionResult>;
}

export const WorkplaceContext = createContext<WorkplaceValue | null>(null);
