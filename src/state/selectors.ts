import { calculateDistribution, entryForEmployee, peopleInResult } from '@/lib/distribution';
import { groupByOverlap, workedMinutes } from '@/lib/time';
import { centsToAmount } from '@/lib/money';
import type { AppState } from '@/state/types';
import type { AreaDistribution, Employee, StaffSnapshot, TipDistribution } from '@/types';

/** Role/points/multiplier as they stand right now. */
export function liveStaffSnapshot(state: AppState): Record<string, StaffSnapshot> {
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

/** The draft pool in euros. */
export function draftPoolAmount(state: AppState): number {
  return centsToAmount(state.draft.cardCents + state.draft.cashCents);
}

/** The wizard's live result, recalculated from the draft on every render. */
export function draftResult(state: AppState): AreaDistribution[] {
  return calculateDistribution({
    pool: draftPoolAmount(state),
    areaShares: state.draft.areaShares,
    hours: state.currentHours,
    staff: liveStaffSnapshot(state),
    employees: state.employees,
    method: state.draft.method,
    minOverlapMinutes: state.rule.minOverlapMinutes,
  });
}

export function draftPeopleCount(state: AppState): number {
  return peopleInResult(draftResult(state));
}

/** Overlap grouping for tonight's hours under the current rule. */
export function liveOverlap(state: AppState) {
  const names: Record<string, string> = {};
  for (const employee of state.employees) names[employee.id] = employee.name;
  return groupByOverlap(state.currentHours, names, state.rule.minOverlapMinutes);
}

/** Recalculate a stored distribution from its own frozen snapshot. */
export function resultForDistribution(
  state: AppState,
  distribution: TipDistribution,
): AreaDistribution[] {
  return calculateDistribution({
    pool: distribution.poolAmount,
    areaShares: distribution.areaShares,
    hours: distribution.hours,
    staff: distribution.staff ?? {},
    employees: state.employees,
    method: distribution.method,
    minOverlapMinutes: distribution.minOverlapMinutes,
  });
}

/** One person's line in a stored distribution — amount, hours and area block. */
export function shareOf(state: AppState, distribution: TipDistribution, employeeId: string) {
  const result = resultForDistribution(state, distribution);
  const found = entryForEmployee(result, employeeId);
  return {
    result,
    block: found?.block ?? null,
    entry: found?.entry ?? null,
    amount: found?.entry.amount ?? 0,
    hours: found?.entry.hours ?? 0,
  };
}

export function distributionById(state: AppState, id: string): TipDistribution | undefined {
  return state.distributions.find((distribution) => distribution.id === id);
}

export function pendingDistribution(state: AppState): TipDistribution | undefined {
  return state.distributions.find((distribution) => distribution.status === 'pending');
}

export function latestDistribution(state: AppState): TipDistribution | undefined {
  return state.distributions[0];
}

export function currentEmployee(state: AppState): Employee | undefined {
  return state.employees.find((employee) => employee.id === state.session.employeeId);
}

/** How many people have handed in hours for the live shift. */
export function submissionCount(state: AppState): number {
  return Object.values(state.submissions).filter((s) => workedMinutes(s) > 0).length;
}

/** The signed-in employee's report for tonight, if they filed one. */
export function ownReport(state: AppState) {
  return state.reports.find((report) => report.employeeId === state.session.employeeId);
}

export function reportsTotalCents(state: AppState): number {
  return state.reports.reduce((sum, report) => sum + report.cardCents + report.cashCents, 0);
}

/** Everything the signed-in employee earned across the distributions on file. */
export function employeeTotals(state: AppState, employeeId: string) {
  return state.distributions.reduce(
    (totals, distribution) => {
      const { amount, hours } = shareOf(state, distribution, employeeId);
      return { amount: totals.amount + amount, hours: totals.hours + hours };
    },
    { amount: 0, hours: 0 },
  );
}
