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
