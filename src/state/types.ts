import type {
  AreaId,
  Invite,
  DistributionMethod,
  DistributionRule,
  Employee,
  Language,
  PoolPeriod,
  RoleId,
  ShiftTimes,
  TipDistribution,
  TipReport,
  UserRole,
  Workplace,
} from '@/types';

/** Hours a person submitted for the live shift, plus their lock state. */
export interface Submission extends ShiftTimes {
  submittedAt: string;
  locked: boolean;
}

/** The manager's in-progress distribution (the four wizard steps). */
export interface DistributionDraft {
  cardCents: number;
  cashCents: number;
  period: PoolPeriod;
  areaShares: Record<AreaId, number>;
  method: DistributionMethod;
}

/** Which dataset the app booted with. */
export type DataMode = 'empty' | 'demo';

export interface AppState {
  /**
   * `empty` is the real default: a fresh install with nothing in it.
   * `demo` loads the sample workplace, which exists only for testing.
   */
  dataMode: DataMode;
  session: {
    signedIn: boolean;
    role: UserRole;
    /** Which roster entry the signed-in person is. */
    employeeId: string;
    /** Code typed on the join screen; empty until the user types one. */
    joinCode: string;
    /** Name the account holder gave at sign-up, or derived from their email. */
    accountName: string;
    accountEmail: string;
  };
  workplace: Workplace;
  employees: Employee[];
  rule: DistributionRule;
  /** Tonight's hours as the manager currently sees them. */
  currentHours: Record<string, ShiftTimes>;
  submissions: Record<string, Submission>;
  reports: TipReport[];
  distributions: TipDistribution[];
  invites: Invite[];
  /** Eight columns for the employee history sparkline. Empty install: zeros. */
  monthlyBars: number[];
  draft: DistributionDraft;
  /** Distributions the signed-in employee has confirmed. */
  acknowledged: string[];
  clockedIn: boolean;
  /** Id of the distribution the last send produced, for the success screen. */
  lastSentId: string | null;
}

export type AppAction =
  | { type: 'signIn'; role: UserRole; name?: string; email?: string }
  | { type: 'signOut' }
  | { type: 'loadDemoData' }
  | { type: 'resetToEmpty' }
  | { type: 'setRole'; role: UserRole }
  | { type: 'setJoinCode'; code: string }
  | { type: 'setPoolCents'; field: 'card' | 'cash'; cents: number }
  | { type: 'setPoolFromReports' }
  | { type: 'setPeriod'; period: PoolPeriod }
  | { type: 'setAreaShare'; area: AreaId; percentage: number }
  | { type: 'toggleArea'; area: AreaId }
  | { type: 'setMethod'; method: DistributionMethod }
  | { type: 'setMinOverlap'; minutes: number }
  | { type: 'toggleAcknowledgementRequired' }
  | { type: 'setRuleAreaShare'; area: AreaId; percentage: number }
  | { type: 'toggleRuleArea'; area: AreaId }
  | { type: 'setEmployeeArea'; employeeId: string; area: AreaId }
  | { type: 'setEmployeeRole'; employeeId: string; roleId: RoleId }
  | { type: 'adjustMultiplier'; employeeId: string; delta: number }
  | { type: 'setHours'; employeeId: string; times: ShiftTimes }
  | { type: 'adjustEnd'; employeeId: string; deltaMinutes: number }
  | { type: 'toggleLock'; employeeId: string }
  | { type: 'submitOwnHours'; employeeId: string; times: ShiftTimes; at: string }
  | { type: 'submitReport'; employeeId: string; cardCents: number; cashCents: number; at: string }
  | { type: 'usePoolAmounts'; cardCents: number; cashCents: number }
  | { type: 'sendDistribution'; id: string; peopleCount: number; poolAmount: number }
  | { type: 'acknowledge'; distributionId: string }
  | { type: 'toggleClock' };

export type Dispatch = (action: AppAction) => void;

export type { Language };
