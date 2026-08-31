import { useNavigate } from 'react-router-dom';
import type { HistoryRowData } from '@/components/domain/HistoryRow';
import { shareOf } from '@/state/selectors';
import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';

/**
 * The list of past distributions, rendered from the point of view of whoever is
 * signed in: a manager sees the whole pool and who still owes a confirmation,
 * an employee sees their own share and whether they have confirmed it.
 */
export function useDistributionRows(options: { chips?: boolean } = {}): HistoryRowData[] {
  const state = useAppState();
  const { t, money, hours, people, dateFor, chipFor, area } = useI18n();
  const navigate = useNavigate();

  const manager = state.session.role === 'manager';
  const employeeId = state.session.employeeId;

  return state.distributions.map((distribution) => {
    const mine = manager ? null : shareOf(state, distribution, employeeId);
    const acknowledged = state.acknowledged.includes(distribution.id);

    const status =
      distribution.status === 'pending'
        ? manager
          ? {
              label: `${distribution.peopleCount - distribution.acknowledgedCount} ${t('awaitingN')}`,
              color: 'var(--color-accent)',
            }
          : acknowledged
            ? { label: t('acknowledged'), color: 'var(--color-text-subtle)' }
            : { label: t('needsOK'), color: 'var(--color-accent)' }
        : { label: t('confirmed'), color: 'var(--color-text-subtle)' };

    return {
      id: distribution.id,
      date: dateFor(distribution.dateKey, distribution.date),
      meta: manager
        ? people(distribution.peopleCount)
        : `${area(mine?.entry?.area ?? 'Service')} · ${hours(mine?.hours ?? 0)}`,
      amount: money(manager ? distribution.poolAmount : (mine?.amount ?? 0)),
      status: status.label,
      statusColor: status.color,
      chip: options.chips ? chipFor(distribution.dateKey, distribution.date) : undefined,
      onOpen: () =>
        navigate(
          manager
            ? `/manager/distributions/${distribution.id}`
            : `/payout/${distribution.id}`,
        ),
    };
  });
}
