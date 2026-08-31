import type { IconName } from '@/lib/icons';
import type { AreaId } from '@/types';

/** Display order everywhere: bands, lists, rules, results. */
export const AREA_ORDER: AreaId[] = ['Service', 'Bar', 'Kitchen', 'Runner', 'Host', 'Management'];

/** Areas a manager can put into a tip pool (Management is excluded by default). */
export const POOLABLE_AREAS: AreaId[] = AREA_ORDER.filter((area) => area !== 'Management');

/** Brand colour per area — used for band charts, dots and area icons. */
export const AREA_COLOR: Record<AreaId, string> = {
  Service: 'var(--color-area-service)',
  Bar: 'var(--color-area-bar)',
  Kitchen: 'var(--color-area-kitchen)',
  Runner: 'var(--color-area-runner)',
  Host: 'var(--color-area-host)',
  Management: 'var(--color-area-management)',
};

/** Phosphor icon name per area. */
export const AREA_ICON: Record<AreaId, IconName> = {
  Service: 'hand-heart',
  Bar: 'martini',
  Kitchen: 'cooking-pot',
  Runner: 'sneaker-move',
  Host: 'door-open',
  Management: 'briefcase',
};

/**
 * The same icons and colours, keyed by the database's area key.
 *
 * Phase 2 seeds every workplace with these six keys, so a real workplace maps
 * onto the prototype's vocabulary without a second design. An area a manager
 * adds later falls back to the neutral pair.
 */
export const AREA_ICON_BY_KEY: Record<string, IconName> = {
  service: 'hand-heart',
  bar: 'martini',
  kitchen: 'cooking-pot',
  runner: 'sneaker-move',
  reception: 'door-open',
  management: 'briefcase',
};

export const AREA_COLOR_BY_KEY: Record<string, string> = {
  service: 'var(--color-area-service)',
  bar: 'var(--color-area-bar)',
  kitchen: 'var(--color-area-kitchen)',
  runner: 'var(--color-area-runner)',
  reception: 'var(--color-area-host)',
  management: 'var(--color-area-management)',
};

export const iconForAreaKey = (key: string): IconName => AREA_ICON_BY_KEY[key] ?? 'users-three';
export const colorForAreaKey = (key: string): string =>
  AREA_COLOR_BY_KEY[key] ?? 'var(--color-text-muted)';
