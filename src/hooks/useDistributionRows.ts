import { useNavigate } from 'react-router-dom';
import type { HistoryRowData } from '@/components/domain/HistoryRow';
import { shareOf } from '@/state/selectors';
import { useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useActiveRole } from '@/hooks/useWorkplace';
import { ACK_VIEW, ackViewFor } from '@/distribution/ack';
import { useDistributionHistory, useMyShare } from '@/distribution/useDistribution';

/**
 * The list of past distributions, rendered from the point of view of whoever is
 * signed in: a manager sees the whole pool and who still owes a confirmation,
 * an employee sees their own share and whether they have confirmed it.
 */
export function useDistributionRows(options: { chips?: boolean } = {}): HistoryRowData[] {
  const state = useAppState();
  const { t, money, hours, people, dateFor, chipFor, area, day } = useI18n();
  const navigate = useNavigate();

  const role = useActiveRole();
  const managerHistory = useDistributionHistory();
  const mine = useMyShare();

  const manager = role === 'manager';
  const employeeId = state.session.employeeId;

  /**
   * Real history.
   *
   * Every row is read from a stored distribution — the manager's from
   * tip_distributions, the employee's from member_distributions and their own
   * entries. Nothing is recomputed, so a row means the same thing today as on
   * the night it was sent.
   */
  if (managerHistory.enabled) {
    return managerHistory.distributions.map((distribution) => ({
      id: distribution.id,
      date: day(new Date(`${distribution.periodStart}T12:00:00`)),
      meta: people(distribution.peopleCount),
      amount: money((distribution.poolCents ?? 0) / 100),
      status:
        distribution.status === 'draft'
          ? t('dDraftLabel')
          : distribution.status === 'cancelled'
            ? t('dCancelledLabel')
            : distribution.status === 'confirmed'
              ? t('dConfirmedLabel')
              : t('dSentLabel'),
      statusColor:
        distribution.status === 'draft' ? 'var(--color-accent)' : 'var(--color-text-subtle)',
      chip: undefined,
      onOpen: () => navigate(`/manager/distributions/${distribution.id}`),
    }));
  }

  if (mine.enabled) {
    return mine.distributions.map((distribution) => {
      const own = mine.entries.filter(
        (e) => e.distributionId === distribution.id && e.isOwn !== false,
      );
      const amountCents = own.reduce((sum, e) => sum + e.amountCents, 0);
      const minutes = own.reduce((sum, e) => sum + e.workedMinutes, 0);
      // Three states, not two: a distribution sent when confirmation was not
      // required is not "waiting", and never was.
      const view = ackViewFor(own, distribution.acknowledgementRequired);
      const presentation = ACK_VIEW[view];
      return {
        id: distribution.id,
        date: day(new Date(`${distribution.periodStart}T12:00:00`)),
        meta: `${own[0]?.areaName ?? ''} · ${hours(minutes / 60)}`.replace(/^ · /, ''),
        amount: money(amountCents / 100),
        status: t(presentation.label),
        statusColor:
          presentation.tone === 'subtle' ? 'var(--color-text-subtle)' : 'var(--color-accent)',
        chip: undefined,
        onOpen: () => navigate(`/payout/${distribution.id}`),
      };
    });
  }

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
