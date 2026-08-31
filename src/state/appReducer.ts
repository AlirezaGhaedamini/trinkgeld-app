import type { AppAction, AppState } from '@/state/types';
import { ROLE_POINTS, defaultRoleForArea } from '@/data/roles';
import { DATE_ISO } from '@/data/distributions';
import {
  ACCOUNT_ID,
  createAccountEmployee,
  createDemoState,
  createEmptyState,
  createInitialState,
  demoEmployeeIdFor,
  nameFromEmail,
  rememberDataMode,
} from '@/state/createState';
import type { StaffSnapshot, TipDistribution } from '@/types';

/**
 * A fresh install starts empty. The sample workplace is opt-in — see
 * src/state/createState.ts.
 */
export const initialState: AppState = createInitialState();

const MIN_SHIFT_MINUTES = 15;

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'signIn': {
      if (state.dataMode === 'demo') {
        return {
          ...state,
          session: {
            ...state.session,
            signedIn: true,
            role: action.role,
            employeeId: demoEmployeeIdFor(action.role),
          },
        };
      }

      // Empty install: you are the account, and the first person in the team.
      const email = action.email ?? state.session.accountEmail;
      const name = action.name || state.session.accountName || nameFromEmail(email);
      const existing = state.employees.find((employee) => employee.id === ACCOUNT_ID);
      const me = existing
        ? { ...existing, name: name || existing.name, userRole: action.role }
        : createAccountEmployee(state.workplace.id, action.role, name);

      return {
        ...state,
        session: {
          ...state.session,
          signedIn: true,
          role: action.role,
          employeeId: ACCOUNT_ID,
          accountName: name,
          accountEmail: email,
        },
        employees: existing
          ? state.employees.map((employee) => (employee.id === ACCOUNT_ID ? me : employee))
          : [...state.employees, me],
      };
    }

    case 'signOut':
      return { ...state, session: { ...state.session, signedIn: false, joinCode: '' } };

    case 'setRole': {
      if (state.dataMode === 'demo') {
        return {
          ...state,
          session: {
            ...state.session,
            role: action.role,
            employeeId: demoEmployeeIdFor(action.role),
          },
        };
      }
      return {
        ...state,
        session: { ...state.session, role: action.role, employeeId: ACCOUNT_ID },
        employees: state.employees.map((employee) =>
          employee.id === ACCOUNT_ID
            ? {
                ...employee,
                userRole: action.role,
                area: action.role === 'manager' ? 'Management' : 'Service',
                roleId: action.role === 'manager' ? 'rManager' : 'rServer',
                points: ROLE_POINTS[action.role === 'manager' ? 'rManager' : 'rServer'],
              }
            : employee,
        ),
      };
    }

    case 'loadDemoData':
      rememberDataMode('demo');
      return createDemoState();

    case 'resetToEmpty':
      rememberDataMode('empty');
      return createEmptyState();

    case 'setJoinCode':
      return { ...state, session: { ...state.session, joinCode: action.code } };

    case 'setPoolCents':
      return {
        ...state,
        draft:
          action.field === 'card'
            ? { ...state.draft, cardCents: action.cents }
            : { ...state.draft, cashCents: action.cents },
      };

    case 'usePoolAmounts':
      return {
        ...state,
        draft: { ...state.draft, cardCents: action.cardCents, cashCents: action.cashCents },
      };

    case 'setPoolFromReports': {
      const cardCents = state.reports.reduce((sum, r) => sum + r.cardCents, 0);
      const cashCents = state.reports.reduce((sum, r) => sum + r.cashCents, 0);
      return { ...state, draft: { ...state.draft, cardCents, cashCents } };
    }

    case 'setPeriod':
      return { ...state, draft: { ...state.draft, period: action.period } };

    case 'setAreaShare':
      return {
        ...state,
        draft: {
          ...state.draft,
          areaShares: { ...state.draft.areaShares, [action.area]: action.percentage },
        },
      };

    case 'toggleArea': {
      const current = state.draft.areaShares[action.area] ?? 0;
      return {
        ...state,
        draft: {
          ...state.draft,
          areaShares: { ...state.draft.areaShares, [action.area]: current > 0 ? 0 : 5 },
        },
      };
    }

    case 'setMethod':
      return {
        ...state,
        draft: { ...state.draft, method: action.method },
        rule: { ...state.rule, method: action.method },
      };

    case 'setMinOverlap':
      return { ...state, rule: { ...state.rule, minOverlapMinutes: action.minutes } };

    case 'toggleAcknowledgementRequired':
      return {
        ...state,
        rule: { ...state.rule, acknowledgementRequired: !state.rule.acknowledgementRequired },
      };

    case 'setRuleAreaShare':
      return {
        ...state,
        rule: {
          ...state.rule,
          areaShares: { ...state.rule.areaShares, [action.area]: action.percentage },
        },
        draft: {
          ...state.draft,
          areaShares: { ...state.draft.areaShares, [action.area]: action.percentage },
        },
      };

    case 'toggleRuleArea': {
      const next = (state.rule.areaShares[action.area] ?? 0) > 0 ? 0 : 5;
      return {
        ...state,
        rule: { ...state.rule, areaShares: { ...state.rule.areaShares, [action.area]: next } },
        draft: { ...state.draft, areaShares: { ...state.draft.areaShares, [action.area]: next } },
      };
    }

    case 'setEmployeeArea':
      return {
        ...state,
        employees: state.employees.map((employee) => {
          if (employee.id !== action.employeeId) return employee;
          const roleId = defaultRoleForArea(action.area);
          return { ...employee, area: action.area, roleId, points: ROLE_POINTS[roleId] };
        }),
      };

    case 'setEmployeeRole':
      return {
        ...state,
        employees: state.employees.map((employee) =>
          employee.id === action.employeeId
            ? { ...employee, roleId: action.roleId, points: ROLE_POINTS[action.roleId] }
            : employee,
        ),
      };

    case 'adjustMultiplier':
      return {
        ...state,
        employees: state.employees.map((employee) =>
          employee.id === action.employeeId
            ? {
                ...employee,
                multiplier: clamp(round2(employee.multiplier + action.delta), 0.5, 2),
              }
            : employee,
        ),
      };

    case 'setHours':
      return {
        ...state,
        currentHours: { ...state.currentHours, [action.employeeId]: action.times },
      };

    case 'adjustEnd': {
      const current = state.currentHours[action.employeeId];
      if (!current) return state;
      const endMinutes = Math.max(
        current.startMinutes + MIN_SHIFT_MINUTES,
        current.endMinutes + action.deltaMinutes,
      );
      return {
        ...state,
        currentHours: { ...state.currentHours, [action.employeeId]: { ...current, endMinutes } },
      };
    }

    case 'toggleLock': {
      const existing = state.submissions[action.employeeId];
      const base = existing ?? {
        ...(state.currentHours[action.employeeId] ?? {
          startMinutes: 0,
          endMinutes: 0,
          breakMinutes: 0,
        }),
        submittedAt: '—',
        locked: false,
      };
      return {
        ...state,
        submissions: {
          ...state.submissions,
          [action.employeeId]: { ...base, locked: !base.locked },
        },
      };
    }

    case 'submitOwnHours':
      return {
        ...state,
        submissions: {
          ...state.submissions,
          [action.employeeId]: { ...action.times, submittedAt: action.at, locked: true },
        },
        currentHours: { ...state.currentHours, [action.employeeId]: action.times },
      };

    case 'submitReport': {
      const others = state.reports.filter((report) => report.employeeId !== action.employeeId);
      return {
        ...state,
        reports: [
          {
            id: `r${state.reports.length + 1}`,
            workplaceId: state.workplace.id,
            employeeId: action.employeeId,
            date: state.dataMode === 'demo' ? DATE_ISO.sat22 : todayIso(),
            cardCents: action.cardCents,
            cashCents: action.cashCents,
            reportedAt: action.at,
          },
          ...others,
        ],
      };
    }

    case 'sendDistribution': {
      const distribution: TipDistribution = {
        id: action.id,
        workplaceId: state.workplace.id,
        date: state.dataMode === 'demo' ? DATE_ISO.sat22 : todayIso(),
        // Demo distributions carry a label key; real ones are labelled by date.
        dateKey: state.dataMode === 'demo' ? 'sat22' : '',
        poolAmount: action.poolAmount,
        status: 'pending',
        peopleCount: action.peopleCount,
        acknowledgedCount: 0,
        areaShares: { ...state.draft.areaShares },
        method: state.draft.method,
        minOverlapMinutes: state.rule.minOverlapMinutes,
        hours: { ...state.currentHours },
        staff: snapshotStaff(state),
        createdAt: new Date().toISOString(),
      };
      return {
        ...state,
        distributions: [
          distribution,
          ...state.distributions.filter((d) => d.status !== 'pending'),
        ],
        lastSentId: action.id,
        acknowledged: state.acknowledged.filter((id) => id !== action.id),
      };
    }

    case 'acknowledge':
      return state.acknowledged.includes(action.distributionId)
        ? state
        : {
            ...state,
            acknowledged: [...state.acknowledged, action.distributionId],
            distributions: state.distributions.map((d) =>
              d.id === action.distributionId
                ? { ...d, acknowledgedCount: Math.min(d.acknowledgedCount + 1, d.peopleCount) }
                : d,
            ),
          };

    case 'toggleClock':
      return { ...state, clockedIn: !state.clockedIn };

    default:
      return state;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Freeze role, points and multiplier so history never rewrites itself. */
function snapshotStaff(state: AppState) {
  const snapshot: Record<string, StaffSnapshot> = {};
  for (const employee of state.employees) {
    snapshot[employee.id] = {
      area: employee.area,
      roleId: employee.roleId,
      points: employee.points,
      multiplier: employee.multiplier,
    };
  }
  return snapshot;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
