import type { AreaId, ShiftTimes, StaffSnapshot, TipDistribution, TipReport } from '@/types';
import { CURRENT_SHIFT_HOURS, EMPLOYEES } from '@/data/employees';
import { DEMO_RULE, DEMO_WORKPLACE } from '@/data/workplace';
import { workedMinutes } from '@/lib/time';

/** Labels for the demo dates. Real dates arrive with the backend. */
export const DATE_KEYS = ['sat22', 'fri21', 'thu20', 'sat15', 'fri14'] as const;
export type DateKey = (typeof DATE_KEYS)[number];

export const DATE_ISO: Record<DateKey, string> = {
  sat22: '2026-08-22',
  fri21: '2026-08-21',
  thu20: '2026-08-20',
  sat15: '2026-08-15',
  fri14: '2026-08-14',
};

const times = (rows: Array<[string, number, number, number]>): Record<string, ShiftTimes> =>
  Object.fromEntries(
    rows.map(([id, start, end, brk]) => [
      id,
      { startMinutes: start, endMinutes: end, breakMinutes: brk },
    ]),
  );

const HISTORIC_HOURS: Record<string, Record<string, ShiftTimes>> = {
  d101: times([
    ['e1', 1020, 1500, 30], ['e2', 1020, 1470, 30], ['e3', 1020, 1440, 30], ['e4', 1080, 1425, 15],
    ['e5', 990, 1500, 30], ['e6', 1020, 1500, 30], ['e7', 1050, 1470, 0], ['e8', 960, 1470, 30],
    ['e9', 960, 1470, 30], ['e10', 990, 1470, 30], ['e11', 1020, 1470, 30], ['e12', 1080, 1425, 15],
  ]),
  d102: times([
    ['e1', 1080, 1440, 0], ['e2', 1080, 1410, 30], ['e3', 1080, 1425, 30], ['e5', 1050, 1440, 0],
    ['e6', 1080, 1440, 0], ['e8', 1020, 1440, 0], ['e9', 1020, 1440, 0], ['e11', 1080, 1440, 0],
    ['e12', 1110, 1350, 0],
  ]),
  d103: times([
    ['e1', 990, 1560, 30], ['e2', 990, 1560, 30], ['e3', 1020, 1560, 30], ['e4', 1050, 1500, 30],
    ['e5', 960, 1560, 30], ['e6', 990, 1560, 30], ['e7', 1020, 1515, 15], ['e8', 930, 1500, 30],
    ['e9', 960, 1530, 30], ['e10', 990, 1530, 30], ['e11', 1020, 1530, 30], ['e12', 1050, 1455, 15],
    ['e13', 1080, 1395, 15],
  ]),
  d104: times([
    ['e1', 1020, 1530, 30], ['e2', 1020, 1500, 30], ['e3', 1020, 1470, 30], ['e5', 990, 1500, 0],
    ['e6', 1020, 1500, 30], ['e7', 1050, 1470, 30], ['e8', 960, 1470, 30], ['e9', 960, 1470, 30],
    ['e10', 990, 1470, 30], ['e11', 1020, 1470, 30], ['e12', 1080, 1395, 15],
  ]),
};

const STANDARD_SHARES: Record<AreaId, number> = { ...DEMO_RULE.areaShares };

/** Role / points / multiplier frozen at calculation time. */
export const CURRENT_STAFF_SNAPSHOT: Record<string, StaffSnapshot> = Object.fromEntries(
  EMPLOYEES.map((employee) => [
    employee.id,
    {
      area: employee.area,
      roleId: employee.roleId,
      points: employee.points,
      multiplier: employee.multiplier,
    },
  ]),
);

function countPeople(hours: Record<string, ShiftTimes>): number {
  return Object.values(hours).filter((t) => workedMinutes(t) > 0).length;
}

const historic: TipDistribution[] = (
  [
    ['d101', 'fri21', 2140.5],
    ['d102', 'thu20', 1180],
    ['d103', 'sat15', 2980],
    ['d104', 'fri14', 2010],
  ] as Array<[string, DateKey, number]>
).map(([id, dateKey, poolAmount]) => {
  const hours = HISTORIC_HOURS[id];
  const people = countPeople(hours);
  return {
    id,
    workplaceId: DEMO_WORKPLACE.id,
    date: DATE_ISO[dateKey],
    dateKey,
    poolAmount,
    status: 'confirmed' as const,
    peopleCount: people,
    acknowledgedCount: people,
    areaShares: STANDARD_SHARES,
    method: 'mPoints' as const,
    minOverlapMinutes: 15,
    hours,
    staff: CURRENT_STAFF_SNAPSHOT,
    createdAt: `${DATE_ISO[dateKey]}T23:59:00.000Z`,
  };
});

/** The still-open distribution the whole demo revolves around. */
const pending: TipDistribution = {
  id: 'd100',
  workplaceId: DEMO_WORKPLACE.id,
  date: DATE_ISO.sat22,
  dateKey: 'sat22',
  poolAmount: 2480,
  status: 'pending',
  peopleCount: 13,
  acknowledgedCount: 11,
  areaShares: STANDARD_SHARES,
  method: 'mPoints',
  minOverlapMinutes: 15,
  hours: CURRENT_SHIFT_HOURS,
  staff: CURRENT_STAFF_SNAPSHOT,
  createdAt: `${DATE_ISO.sat22}T23:59:00.000Z`,
};

export const INITIAL_DISTRIBUTIONS: TipDistribution[] = [pending, ...historic];

/** What the team counted at the end of tonight's shift. */
export const INITIAL_REPORTS: TipReport[] = [
  {
    id: 'r1',
    workplaceId: DEMO_WORKPLACE.id,
    employeeId: 'e5',
    date: DATE_ISO.sat22,
    cardCents: 96_000,
    cashCents: 31_500,
    reportedAt: '01:04',
  },
  {
    id: 'r2',
    workplaceId: DEMO_WORKPLACE.id,
    employeeId: 'e1',
    date: DATE_ISO.sat22,
    cardCents: 82_500,
    cashCents: 38_000,
    reportedAt: '01:11',
  },
];

/** Hours already submitted (and locked) by staff for tonight. */
export const INITIAL_SUBMISSIONS: Record<
  string,
  ShiftTimes & { submittedAt: string; locked: boolean }
> = Object.fromEntries(
  (
    [
      ['e1', '01:12'], ['e3', '01:20'], ['e5', '01:05'], ['e6', '01:08'], ['e8', '00:52'],
      ['e9', '00:55'], ['e12', '23:40'], ['e13', '13:20'], ['e14', '16:25'],
    ] as Array<[string, string]>
  ).map(([id, submittedAt]) => [
    id,
    { ...CURRENT_SHIFT_HOURS[id], submittedAt, locked: true },
  ]),
);

/** The employee's month-so-far sparkline on the history screen. */
export const MONTHLY_BARS = [180, 260, 0, 310, 288, 166, 402, 337];
