/**
 * Domain model for TipCrew.
 *
 * These types are deliberately shaped like rows in a relational database so the
 * move to Supabase is a mapping exercise, not a rewrite: every entity has a
 * string `id`, foreign keys are `<entity>Id`, and timestamps are ISO strings.
 *
 * Times inside a shift are stored as **minutes from 00:00 of the shift's
 * calendar day**, so a shift that ends at 01:30 the next morning is `1530`.
 * That keeps overlap arithmetic to plain integer maths and avoids timezone
 * bugs; see src/lib/time.ts.
 */

/** Areas of the business that can take a share of the pool. */
export type AreaId = 'Service' | 'Bar' | 'Kitchen' | 'Runner' | 'Host' | 'Management';

/** Roles within an area. The id doubles as the i18n key for its label. */
export type RoleId =
  | 'rSenior'
  | 'rServer'
  | 'rTrainee'
  | 'rHost'
  | 'rBartender'
  | 'rBarback'
  | 'rChef'
  | 'rCook'
  | 'rDish'
  | 'rRunner'
  | 'rManager';

/** Who is using the app. Permissions hang off this. */
export type UserRole = 'employee' | 'manager';

/** How a single area's pot is divided between the people in it. */
export type DistributionMethod = 'mPoints' | 'mHours' | 'mEqual';

export type Language = 'English' | 'Deutsch';

export interface Workplace {
  id: string;
  name: string;
  city: string;
  /** Six-character code new staff type in to join. */
  joinCode: string;
  areas: AreaId[];
}

export interface Role {
  id: RoleId;
  area: AreaId;
  /** How one hour of this role counts against one hour of another. */
  points: number;
}

export interface Employee {
  id: string;
  workplaceId: string;
  name: string;
  /** Set by a manager; an employee cannot change their own area or role. */
  area: AreaId;
  roleId: RoleId;
  /** Role points, denormalised onto the employee so history stays truthful. */
  points: number;
  /** Personal multiplier applied on top of role points. Manager-only. */
  multiplier: number;
  userRole: UserRole;
}

/**
 * One person's working time on one date.
 * `startMinutes`/`endMinutes` are minutes from midnight of `date`.
 */
export interface Shift {
  id: string;
  employeeId: string;
  /** ISO date of the shift's calendar day, e.g. "2026-08-22". */
  date: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  /** end - start - break, never negative. Derived; see lib/time.ts. */
  workedMinutes: number;
  status: ShiftStatus;
  /** Who last wrote these numbers. Drives the "submitted by" line. */
  source: 'employee' | 'manager';
  /** Clock time the employee submitted, e.g. "01:12". */
  submittedAt?: string;
  /** Locked shifts cannot be edited by the employee until a manager unlocks. */
  locked: boolean;
  createdAt: string;
}

export type ShiftStatus = 'draft' | 'submitted' | 'approved';

/** What one person counted at the end of their shift. */
export interface TipReport {
  id: string;
  workplaceId: string;
  employeeId: string;
  date: string;
  /** Cents — money is never held in floats. */
  cardCents: number;
  cashCents: number;
  reportedAt: string;
}

/** The money to be divided for one shift, plus where it came from. */
export interface TipPool {
  id: string;
  workplaceId: string;
  date: string;
  period: PoolPeriod;
  cardCents: number;
  cashCents: number;
}

export type PoolPeriod = 'segShift' | 'segDay' | 'segWeek';

/**
 * The rules a workplace divides tips by. Manager-only; employees read them.
 */
export interface DistributionRule {
  id: string;
  workplaceId: string;
  /** Percentage of the pool per area. Must total 100 across active areas. */
  areaShares: Record<AreaId, number>;
  /** How each area's pot is split between its people. */
  method: DistributionMethod;
  /**
   * Two people count as having worked together only if their shifts overlap by
   * at least this many minutes. Employees cannot change it.
   */
  minOverlapMinutes: number;
  /** Whether every employee must confirm their share. */
  acknowledgementRequired: boolean;
  /** Area that absorbs rounding remainders. */
  roundingArea: AreaId;
}

export type DistributionStatus = 'pending' | 'confirmed';

/** A distribution that has been sent to the team. */
export interface TipDistribution {
  id: string;
  workplaceId: string;
  date: string;
  /** Human label key for the date, e.g. "sat22". Mock data only. */
  dateKey: string;
  /** Total pool in euros. */
  poolAmount: number;
  status: DistributionStatus;
  peopleCount: number;
  acknowledgedCount: number;
  areaShares: Record<AreaId, number>;
  method: DistributionMethod;
  minOverlapMinutes: number;
  /** Snapshot of hours worked at the time of calculation, keyed by employee. */
  hours: Record<string, ShiftTimes>;
  /** Snapshot of role/points/multiplier at the time of calculation. */
  staff?: Record<string, StaffSnapshot>;
  createdAt: string;
}

/** The three numbers that define a worked shift. */
export interface ShiftTimes {
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
}

export interface StaffSnapshot {
  area: AreaId;
  roleId: RoleId;
  points: number;
  multiplier: number;
}

/** One person's line in a calculated distribution. */
export interface TipDistributionEntry {
  employeeId: string;
  name: string;
  area: AreaId;
  hours: number;
  points: number;
  multiplier: number;
  units: number;
  amount: number;
  times?: ShiftTimes;
}

/** A calculated area block: the pot, the units in it and who shares it. */
export interface AreaDistribution {
  area: AreaId;
  percentage: number;
  total: number;
  units: number;
  entries: TipDistributionEntry[];
}

/** One row of the "who worked together" analysis. */
export interface OverlapRow {
  employeeId: string;
  name: string;
  times: ShiftTimes;
  workedMinutes: number;
  /** Minutes shared with the anchor shift. */
  overlapMinutes: number;
  isAnchor: boolean;
  /** Whether this person clears the minimum-overlap rule. */
  included: boolean;
}

export interface OverlapGrouping {
  anchor: OverlapRow | null;
  rows: OverlapRow[];
}

/** A person invited but not yet in the team. */
export interface Invite {
  id: string;
  name: string;
  area: AreaId;
  roleId: RoleId;
  status: 'invited' | 'requested';
}
