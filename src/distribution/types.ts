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
  };
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
