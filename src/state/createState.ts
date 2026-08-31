import { AREA_ORDER } from '@/data/areas';
import { ROLE_POINTS } from '@/data/roles';
import {
  CURRENT_SHIFT_HOURS,
  DEMO_EMPLOYEE_ID,
  DEMO_MANAGER_ID,
  EMPLOYEES,
} from '@/data/employees';
import {
  INITIAL_DISTRIBUTIONS,
  INITIAL_REPORTS,
  INITIAL_SUBMISSIONS,
  MONTHLY_BARS,
} from '@/data/distributions';
import { DEMO_PENDING_INVITES, DEMO_RULE, DEMO_WORKPLACE } from '@/data/workplace';
import type { AppState, DataMode } from '@/state/types';
import type { AreaId, Employee, UserRole, Workplace } from '@/types';

/**
 * Two starting points.
 *
 * `createEmptyState()` is what a real install looks like: no team, no shifts,
 * no reports, no distributions, no percentages set. It is the default.
 *
 * `createDemoState()` is the sample workplace (Café Alto, 15 people, five
 * distributions). It exists to exercise the calculation and to check the design
 * with realistic content, and is never loaded unless someone asks for it.
 */

/** The one employee record an empty install has: the account holder. */
export const ACCOUNT_ID = 'me';

const EMPTY_SHARES: Record<AreaId, number> = {
  Service: 0,
  Bar: 0,
  Kitchen: 0,
  Runner: 0,
  Host: 0,
  Management: 0,
};

/** Six characters a manager can read out over the phone. */
function generateJoinCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

const EMPTY_WORKPLACE: Workplace = {
  id: 'workplace-local',
  // Left blank on purpose: the screens fall back to "Your workplace" rather
  // than inventing a name the user never typed.
  name: '',
  city: '',
  joinCode: generateJoinCode(),
  areas: AREA_ORDER,
};

export function createEmptyState(): AppState {
  return {
    dataMode: 'empty',
    session: {
      signedIn: false,
      role: 'employee',
      employeeId: ACCOUNT_ID,
      joinCode: '',
      accountName: '',
      accountEmail: '',
    },
    workplace: EMPTY_WORKPLACE,
    employees: [],
    rule: {
      id: 'rule-local',
      workplaceId: EMPTY_WORKPLACE.id,
      // Nobody has decided how to split the pool yet — the manager does that
      // on the Rules screen before the first distribution.
      areaShares: { ...EMPTY_SHARES },
      // These four are settings with sensible defaults rather than user
      // content, so a fresh install still has a working rule to start from.
      method: 'mPoints',
      minOverlapMinutes: 15,
      acknowledgementRequired: true,
      roundingArea: 'Service',
    },
    currentHours: {},
    submissions: {},
    reports: [],
    distributions: [],
    invites: [],
    monthlyBars: [0, 0, 0, 0, 0, 0, 0, 0],
    draft: {
      cardCents: 0,
      cashCents: 0,
      period: 'segShift',
      areaShares: { ...EMPTY_SHARES },
      method: 'mPoints',
    },
    acknowledged: [],
    clockedIn: false,
    lastSentId: null,
  };
}

export function createDemoState(): AppState {
  return {
    dataMode: 'demo',
    session: {
      signedIn: false,
      role: 'employee',
      employeeId: DEMO_EMPLOYEE_ID,
      joinCode: '',
      accountName: '',
      accountEmail: '',
    },
    workplace: DEMO_WORKPLACE,
    employees: EMPLOYEES,
    rule: DEMO_RULE,
    currentHours: CURRENT_SHIFT_HOURS,
    submissions: INITIAL_SUBMISSIONS,
    reports: INITIAL_REPORTS,
    distributions: INITIAL_DISTRIBUTIONS,
    invites: DEMO_PENDING_INVITES,
    monthlyBars: MONTHLY_BARS,
    draft: {
      cardCents: 178_500,
      cashCents: 69_500,
      period: 'segShift',
      areaShares: { ...DEMO_RULE.areaShares },
      method: DEMO_RULE.method,
    },
    acknowledged: [],
    clockedIn: false,
    lastSentId: null,
  };
}

export function demoEmployeeIdFor(role: UserRole): string {
  return role === 'manager' ? DEMO_MANAGER_ID : DEMO_EMPLOYEE_ID;
}

/**
 * Turn an email into a display name, so a fresh account is not nameless:
 * "lena.mertens@cafealto.nl" -> "Lena Mertens". Nothing is invented — every
 * character comes from what the person typed.
 */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** The account holder's own roster entry, created when they first sign in. */
export function createAccountEmployee(
  workplaceId: string,
  role: UserRole,
  name: string,
): Employee {
  const roleId = role === 'manager' ? 'rManager' : 'rServer';
  return {
    id: ACCOUNT_ID,
    workplaceId,
    name,
    area: role === 'manager' ? 'Management' : 'Service',
    roleId,
    points: ROLE_POINTS[roleId],
    multiplier: 1,
    userRole: role,
  };
}

/* ── which dataset to boot with ─────────────────────────────────────────── */

const STORAGE_KEY = 'tipcrew.dataMode';

/**
 * Empty unless someone opted into the sample data — either with the switch
 * above the phone on a wide screen, or with `?demo=1` in the URL, which is how
 * you turn it on when testing on a phone.
 */
export function readDataMode(): DataMode {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('demo');
    if (fromUrl === '1' || fromUrl === 'true') {
      window.localStorage.setItem(STORAGE_KEY, 'demo');
      return 'demo';
    }
    if (fromUrl === '0' || fromUrl === 'false') {
      window.localStorage.setItem(STORAGE_KEY, 'empty');
      return 'empty';
    }
    if (window.localStorage.getItem(STORAGE_KEY) === 'demo') return 'demo';
  } catch {
    /* blocked storage — fall through to the empty default */
  }
  return 'empty';
}

export function rememberDataMode(mode: DataMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* non-fatal: the choice just will not survive a reload */
  }
}

export function createInitialState(): AppState {
  return readDataMode() === 'demo' ? createDemoState() : createEmptyState();
}
