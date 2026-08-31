import type { AreaId, RoleId } from '@/types';

/**
 * Role points decide how one hour of a role counts against another. A trainee
 * hour is worth half a senior hour; that is the whole idea of `mPoints`.
 */
export const ROLE_POINTS: Record<RoleId, number> = {
  rSenior: 1.2,
  rServer: 1.0,
  rTrainee: 0.5,
  rHost: 0.9,
  rBartender: 1.0,
  rBarback: 0.7,
  rChef: 1.2,
  rCook: 1.0,
  rDish: 0.8,
  rRunner: 1.0,
  rManager: 1.0,
};

export const ROLES_BY_AREA: Record<AreaId, RoleId[]> = {
  Service: ['rSenior', 'rServer', 'rTrainee'],
  Bar: ['rBartender', 'rBarback'],
  Kitchen: ['rChef', 'rCook', 'rDish'],
  Runner: ['rRunner'],
  Host: ['rHost'],
  Management: ['rManager'],
};

export function defaultRoleForArea(area: AreaId): RoleId {
  return ROLES_BY_AREA[area][0];
}
