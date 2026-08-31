import type { DistributionRule, Invite, Workplace } from '@/types';
import { AREA_ORDER } from '@/data/areas';

/**
 * Sample workplace — demo data only.
 *
 * Nothing in here is loaded by a normal app start; see
 * src/state/createState.ts, which boots the empty state instead.
 */

export const DEMO_WORKPLACE: Workplace = {
  id: 'w1',
  name: 'Café Alto',
  city: 'Rotterdam',
  joinCode: 'ALT492',
  areas: AREA_ORDER,
};

/** The sample workplace's rules. Only loaded with the demo dataset. */
export const DEMO_RULE: DistributionRule = {
  id: 'rule1',
  workplaceId: DEMO_WORKPLACE.id,
  areaShares: { Service: 45, Bar: 30, Kitchen: 20, Runner: 5, Host: 0, Management: 0 },
  method: 'mPoints',
  minOverlapMinutes: 15,
  acknowledgementRequired: true,
  roundingArea: 'Service',
};

/** Choices a manager gets for the minimum-overlap rule. */
export const MIN_OVERLAP_CHOICES = [15, 30, 60];

export const DEMO_PENDING_INVITES: Invite[] = [
  { id: 'i1', name: 'Jonas Vega', area: 'Bar', roleId: 'rBartender', status: 'invited' },
  { id: 'i2', name: 'Ella Brandt', area: 'Service', roleId: 'rTrainee', status: 'requested' },
];
