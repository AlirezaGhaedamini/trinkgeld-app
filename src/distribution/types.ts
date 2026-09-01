/**
 * The distribution as the screens want it.
 *
 * Every amount here came out of the database as an integer number of cents and
 * stays one. Nothing in this file divides money.
 */

// The CLI's own `Tables<>` helper already spans tables and views, so the
// member-facing views are addressed through it rather than a second alias.
import type { Enums, Tables } from '@/types/database';

export type DistributionStatus = Enums<'distribution_status'>;
export type PoolStatus = Enums<'pool_status'>;
export type RuleMethod = Enums<'rule_method'>;
export type AckStatus = Enums<'entry_ack_status'>;

export interface TipPool {
  id: string;
  workplaceId: string;
  periodStart: string;
  periodEnd: string;
  label: string;
  cardCents: number;
  cashCents: number;
  totalCents: number;
  source: string;
  status: PoolStatus;
}

export interface DistributionArea {
  areaId: string;
  areaKey: string;
  areaName: string;
  percentage: number;
  units: number;
  totalCents: number;
  peopleCount: number;
}

export interface DistributionEntry {
  id: string;
  distributionId: string;
  memberId: string;
  memberName: string;
  areaId: string;
  areaKey: string;
  areaName: string;
  areaSource: Enums<'area_source'>;
  roleKey: string | null;
  roleName: string | null;
  points: number;
  multiplier: number;
  workedMinutes: number;
  overlapMinutes: number;
  units: number;
  amountCents: number;
  roundingAdjustmentCents: number;
  shiftIds: string[];
  ackStatus: AckStatus;
  acknowledgedAt: string | null;
  queriedAt: string | null;
  queryNote: string | null;
  /** Only meaningful on the member-facing view. */
  isOwn?: boolean;
}

export interface Distribution {
  id: string;
  workplaceId: string;
  tipPoolId: string;
  periodStart: string;
  periodEnd: string;
  status: DistributionStatus;
  method: RuleMethod;
  minOverlapMinutes: number;
  ruleVersion: number;
  peopleCount: number;
  /** Null for a member unless the workplace released the pool total. */
  poolCents: number | null;
  entriesTotalCents: number;
  engineVersion: string | null;
  sentAt: string | null;
  calculatedAt: string | null;
  /**
   * Frozen at calculation time, never read from today's rule — a distribution
   * keeps the requirement it was sent with. The manager reads it out of
   * rules_snapshot; the member gets it as a column on member_distributions.
   */
  acknowledgementRequired: boolean;
}

export function toPool(row: Tables<'tip_pools'>): TipPool {
  return {
    id: row.id,
    workplaceId: row.workplace_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    label: row.label,
    cardCents: row.card_cents,
    cashCents: row.cash_cents,
    totalCents: row.total_cents ?? row.card_cents + row.cash_cents,
    source: row.source,
    status: row.status,
  };
}

export function toArea(row: Tables<'tip_distribution_areas'>): DistributionArea {
  return {
    areaId: row.area_id,
    areaKey: row.area_key,
    areaName: row.area_name,
    percentage: Number(row.percentage),
    units: Number(row.units),
    totalCents: row.total_cents,
    peopleCount: row.people_count,
  };
}

export function toEntry(row: Tables<'tip_distribution_entries'>): DistributionEntry {
  return {
    id: row.id,
    distributionId: row.distribution_id,
    memberId: row.member_id,
    memberName: row.member_name,
    areaId: row.area_id,
    areaKey: row.area_key,
    areaName: row.area_name,
    areaSource: row.area_source,
    roleKey: row.role_key,
    roleName: row.role_name,
    points: Number(row.points),
    multiplier: Number(row.multiplier),
    workedMinutes: row.worked_minutes,
    overlapMinutes: row.overlap_minutes,
    units: Number(row.units),
    amountCents: row.amount_cents,
    roundingAdjustmentCents: row.rounding_adjustment_cents,
    shiftIds: row.shift_ids,
    ackStatus: row.ack_status,
    acknowledgedAt: row.acknowledged_at,
    queriedAt: row.queried_at,
    queryNote: row.query_note,
  };
}

export function toDistribution(row: Tables<'tip_distributions'>): Distribution {
  return {
    id: row.id,
    workplaceId: row.workplace_id,
    tipPoolId: row.tip_pool_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    method: row.method,
    minOverlapMinutes: row.min_overlap_minutes,
    ruleVersion: row.rule_version,
    peopleCount: row.people_count,
    poolCents: row.pool_cents,
    entriesTotalCents: row.entries_total_cents,
    engineVersion: row.engine_version,
    sentAt: row.sent_at,
    calculatedAt: row.calculated_at,
    acknowledgementRequired: ackRequiredFromSnapshot(row.rules_snapshot),
  };
}

/**
 * The manager's route to the same frozen flag the member's view exposes.
 *
 * rules_snapshot is jsonb, so it arrives as `unknown` and is narrowed here
 * rather than cast at the call site. A snapshot written before the field
 * existed defaults to true — the safer answer, because it asks for a
 * confirmation that may not be needed rather than silently dropping one that is.
 */
function ackRequiredFromSnapshot(snapshot: unknown): boolean {
  if (snapshot && typeof snapshot === 'object' && 'acknowledgement_required' in snapshot) {
    const value = (snapshot as { acknowledgement_required?: unknown }).acknowledgement_required;
    if (typeof value === 'boolean') return value;
  }
  return true;
}

/**
 * The member-facing view. `pool_cents` arrives null unless the workplace has
 * released it, and the view has no `entries_total_cents` at all — an employee
 * must not be able to reconstruct the pool from what they can read.
 */
export function toMemberDistribution(row: Tables<'member_distributions'>): Distribution {
  return {
    id: row.id ?? '',
    workplaceId: row.workplace_id ?? '',
    tipPoolId: '',
    periodStart: row.period_start ?? '',
    periodEnd: row.period_end ?? '',
    status: (row.status ?? 'sent') as DistributionStatus,
    method: (row.method ?? 'hours_points') as RuleMethod,
    minOverlapMinutes: row.min_overlap_minutes ?? 0,
    ruleVersion: row.rule_version ?? 0,
    peopleCount: row.people_count ?? 0,
    poolCents: row.pool_cents,
    entriesTotalCents: 0,
    engineVersion: null,
    sentAt: row.sent_at,
    calculatedAt: null,
    acknowledgementRequired: row.acknowledgement_required ?? true,
  };
}

/** A distribution and everything needed to explain it. */
export interface DistributionDetail {
  distribution: Distribution;
  areas: DistributionArea[];
  entries: DistributionEntry[];
}

/** Percentages are numeric(5,2) in the schema. Keep two decimals, never float. */
export function percentageToHundredths(value: number): number {
  return Math.round(value * 100);
}
export function hundredthsSumIsExactly100(values: number[]): boolean {
  return values.reduce((sum, v) => sum + percentageToHundredths(v), 0) === 10000;
}
