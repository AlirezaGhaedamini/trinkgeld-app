import type { Employee, ShiftTimes } from '@/types';
import { ROLE_POINTS } from '@/data/roles';
import { DEMO_WORKPLACE } from '@/data/workplace';

/**
 * The demo roster of Café Alto — fifteen people across five areas.
 *
 * Times are minutes from midnight of the shift's calendar day, so 1530 is
 * 01:30 the next morning. Luis works a day shift on purpose: he shares no time
 * with the evening anchor and the overlap rule keeps him out of the pool. Bea
 * leaves twenty minutes after the evening starts, which puts her in at a 15
 * minute threshold and out at 30 — the cleanest way to feel the rule.
 */
interface RosterEntry {
  employee: Employee;
  shift: ShiftTimes;
}

const seed = (
  id: string,
  name: string,
  area: Employee['area'],
  roleId: Employee['roleId'],
  start: number,
  end: number,
  breakMinutes: number,
  userRole: Employee['userRole'] = 'employee',
): RosterEntry => ({
  employee: {
    id,
    workplaceId: DEMO_WORKPLACE.id,
    name,
    area,
    roleId,
    points: ROLE_POINTS[roleId],
    multiplier: 1,
    userRole,
  },
  shift: { startMinutes: start, endMinutes: end, breakMinutes },
});

const ROSTER: RosterEntry[] = [
  seed('e1', 'Sofia Talin', 'Service', 'rSenior', 1020, 1530, 30),
  seed('e2', 'Lena Mertens', 'Service', 'rServer', 990, 1530, 30),
  seed('e3', 'Marco Riva', 'Service', 'rServer', 1020, 1470, 30),
  seed('e4', 'Youssef Ben Ali', 'Service', 'rTrainee', 1080, 1455, 15),
  seed('e5', 'Nina Kovač', 'Bar', 'rBartender', 960, 1530, 30),
  seed('e6', 'Tom Haugen', 'Bar', 'rBartender', 1020, 1530, 30),
  seed('e7', 'Iris Dahl', 'Bar', 'rBarback', 1050, 1515, 15),
  seed('e8', 'Pablo Sanz', 'Kitchen', 'rChef', 930, 1440, 30),
  seed('e9', 'Mei Chen', 'Kitchen', 'rCook', 960, 1470, 30),
  seed('e10', 'Adam Kraus', 'Kitchen', 'rCook', 960, 1470, 30),
  seed('e11', 'Sara Lund', 'Kitchen', 'rDish', 1020, 1530, 30),
  seed('e12', 'Ana Pires', 'Runner', 'rRunner', 1080, 1455, 15),
  // Day shift — no shared time with the evening pool, so the rule excludes him.
  seed('e13', 'Luis Ferro', 'Runner', 'rRunner', 540, 790, 10),
  // Leaves 20 minutes after the evening anchor arrives: in at 15, out at 30.
  seed('e14', 'Bea Ruiz', 'Host', 'rHost', 720, 980, 20),
  seed('e15', 'Daan Visser', 'Management', 'rManager', 1020, 1530, 30, 'manager'),
];

export const EMPLOYEES: Employee[] = ROSTER.map((entry) => entry.employee);

/** Hours worked on the live shift, keyed by employee id. */
export const CURRENT_SHIFT_HOURS: Record<string, ShiftTimes> = Object.fromEntries(
  ROSTER.map((entry) => [entry.employee.id, entry.shift]),
);

/** The signed-in employee in the demo. */
export const DEMO_EMPLOYEE_ID = 'e2';
/** The signed-in manager in the demo. */
export const DEMO_MANAGER_ID = 'e15';

export function employeeById(employees: Employee[], id: string): Employee | undefined {
  return employees.find((employee) => employee.id === id);
}

export function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((word) => word[0] ?? '')
    .slice(0, 2)
    .join('');
}
