import { AREA_ORDER } from '@/data/areas';
import { groupByOverlap, toHours, workedMinutes } from '@/lib/time';
import type {
  AreaDistribution,
  AreaId,
  DistributionMethod,
  Employee,
  ShiftTimes,
  StaffSnapshot,
} from '@/types';

export interface CalculationInput {
  /** Total pool in euros. */
  pool: number;
  /** Percentage of the pool per area; areas at 0 are skipped. */
  areaShares: Record<AreaId, number>;
  /** Hours worked, keyed by employee id. */
  hours: Record<string, ShiftTimes>;
  /** Area/role/points/multiplier per employee at calculation time. */
  staff: Record<string, StaffSnapshot>;
  /** The roster the ids refer to (for names). */
  employees: Employee[];
  method: DistributionMethod;
  minOverlapMinutes: number;
}

/**
 * The tip engine.
 *
 * Two steps, in this order — the order is the product:
 *   1. **Eligibility.** Everyone is measured against the night's longest shift.
 *      Anyone sharing less than `minOverlapMinutes` with it is out, so a lunch
 *      shift never draws from an evening pool.
 *   2. **Division.** The pool is split between areas by percentage, then each
 *      area's pot is split between its eligible people by *units*:
 *        - `mPoints` — hours x role points x personal multiplier
 *        - `mHours`  — hours only
 *        - `mEqual`  — one unit each, hours ignored
 *
 * Kept pure and dependency-free so it can move to a Supabase edge function or
 * a Postgres function unchanged.
 */
export function calculateDistribution(input: CalculationInput): AreaDistribution[] {
  const { pool, areaShares, hours, staff, employees, method, minOverlapMinutes } = input;

  const names: Record<string, string> = {};
  for (const employee of employees) names[employee.id] = employee.name;

  const grouping = groupByOverlap(hours, names, minOverlapMinutes);

  /** employeeId -> eligible hours. Absent means "not in this pool". */
  const eligibleHours: Record<string, number> = {};
  for (const row of grouping.rows) {
    if (row.included) eligibleHours[row.employeeId] = toHours(row.workedMinutes);
  }

  const result: AreaDistribution[] = [];

  for (const area of AREA_ORDER) {
    const percentage = areaShares[area] ?? 0;
    if (percentage <= 0) continue;

    const members = employees.filter((employee) => {
      const snapshot = staff[employee.id];
      const employeeArea = snapshot ? snapshot.area : employee.area;
      return employeeArea === area && (eligibleHours[employee.id] ?? 0) > 0;
    });

    const total = (pool * percentage) / 100;

    const unitsOf = (employeeId: string): number => {
      const hoursWorked = eligibleHours[employeeId] ?? 0;
      if (method === 'mEqual') return 1;
      if (method === 'mHours') return hoursWorked;
      const snapshot = staff[employeeId];
      const employee = employees.find((e) => e.id === employeeId);
      const points = snapshot?.points ?? employee?.points ?? 1;
      const multiplier = snapshot?.multiplier ?? employee?.multiplier ?? 1;
      return hoursWorked * points * multiplier;
    };

    const units = members.reduce((sum, employee) => sum + unitsOf(employee.id), 0);

    result.push({
      area,
      percentage,
      total,
      units,
      entries: members.map((employee) => {
        const snapshot = staff[employee.id];
        const employeeUnits = unitsOf(employee.id);
        return {
          employeeId: employee.id,
          name: employee.name,
          area,
          hours: eligibleHours[employee.id] ?? 0,
          points: snapshot?.points ?? employee.points,
          multiplier: snapshot?.multiplier ?? employee.multiplier,
          units: employeeUnits,
          amount: units > 0 ? (total * employeeUnits) / units : 0,
          times: hours[employee.id],
        };
      }),
    });
  }

  return result;
}

/** Flatten a calculation to a single person's line, or null if they are out. */
export function entryForEmployee(result: AreaDistribution[], employeeId: string) {
  for (const block of result) {
    const entry = block.entries.find((e) => e.employeeId === employeeId);
    if (entry) return { block, entry };
  }
  return null;
}

/** Total number of people who receive money in a calculation. */
export function peopleInResult(result: AreaDistribution[]): number {
  return result.reduce((sum, block) => sum + block.entries.length, 0);
}

/** Sum of allocated percentages — the wizard blocks until this is exactly 100. */
export function allocatedPercentage(areaShares: Record<AreaId, number>): number {
  return AREA_ORDER.reduce((sum, area) => sum + (areaShares[area] ?? 0), 0);
}

/** Convenience: total hours an area contributed, ignoring excluded people. */
export function eligibleHoursForArea(
  area: AreaId,
  employees: Employee[],
  staff: Record<string, StaffSnapshot>,
  hours: Record<string, ShiftTimes>,
  minOverlapMinutes: number,
): number {
  const names: Record<string, string> = {};
  for (const employee of employees) names[employee.id] = employee.name;
  const grouping = groupByOverlap(hours, names, minOverlapMinutes);
  return grouping.rows
    .filter((row) => row.included)
    .filter((row) => {
      const employee = employees.find((e) => e.id === row.employeeId);
      if (!employee) return false;
      return (staff[employee.id]?.area ?? employee.area) === area;
    })
    .reduce((sum, row) => sum + toHours(row.workedMinutes), 0);
}

/** Re-derive worked minutes for a map of shift times. */
export function totalWorkedMinutes(hours: Record<string, ShiftTimes>): number {
  return Object.values(hours).reduce((sum, times) => sum + workedMinutes(times), 0);
}
