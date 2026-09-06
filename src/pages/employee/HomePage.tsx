import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { Card, CardButton } from '@/components/ui/Card';
import { HeroCard } from '@/components/ui/HeroCard';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { HistoryRow } from '@/components/domain/HistoryRow';
import { useAppState } from '@/hooks/useAppState';
import { rowsForMyShare, useDistributionRows } from '@/hooks/useDistributionRows';
import { useNotifications } from '@/notifications/useNotifications';
import { useI18n } from '@/hooks/useI18n';
import { useWorkplace } from '@/hooks/useWorkplace';
import { employeeTotals, latestDistribution, ownReport, shareOf } from '@/state/selectors';
import { centsToAmount } from '@/lib/money';
import { formatClock, workedMinutes } from '@/lib/time';
import { ACK_VIEW, PAYOUT_STATE_LABEL, ackViewFor } from '@/distribution/ack';
import { useMyShare } from '@/distribution/useDistribution';
import { instantToWallMinutes } from '@/shifts/time';
import { SHIFT_STATUS_LABEL } from '@/shifts/types';
import { useOwnShifts } from '@/shifts/useShifts';
import { useTipReports } from '@/tips/useTips';
import { useAssignment } from '@/workplace/useAssignment';
import ui from '@/components/ui/ui.module.css';

/** The employee's home: latest share, tonight's report, tonight's hours, recent payouts. */
export function HomePage() {
  const workplace = useWorkplace();
  const real = workplace.enabled && workplace.activeMembership !== null;
  return real ? <RealHome /> : <DemoHome />;
}

/**
 * Home, from the person's own records.
 *
 * Four questions the database answers for a member, four hooks: the latest
 * distribution they are in (member_distributions and their own entries),
 * tonight's shift (their own rows), tonight's tip report (their own row), and
 * the unread count. Nothing here comes from the Phase 1 reducer any more.
 *
 * Two Phase 1 tiles are gone rather than wired up: "This month" and "Hours
 * logged". Neither can be answered honestly from what a member may read. A
 * month total would add a replaced version to its replacement, and the hours
 * a pool actually weighted live on the distribution entries — each row below
 * shows its own — not on a running counter that would drift from them.
 */
function RealHome() {
  const i18n = useI18n();
  const { t, money, day } = i18n;
  const navigate = useNavigate();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const inbox = useNotifications();
  const mine = useMyShare();
  const shifts = useOwnShifts();
  const tips = useTipReports();
  const assignment = useAssignment();

  if (!membership) return null;

  // The latest *current* distribution: not replaced, not cancelled. A replaced
  // version stays in the list below as history; the hero shows the money that
  // stands, with the payout state the workplace recorded for it.
  const latest =
    mine.distributions.find((d) => !d.supersededBy && d.status !== 'cancelled') ?? null;
  const ownEntries = latest
    ? mine.entries.filter((e) => e.distributionId === latest.id && e.isOwn !== false)
    : [];
  const ownCents = ownEntries.reduce((sum, e) => sum + e.amountCents, 0);
  // The requirement frozen into that distribution, not today's rule.
  const presentation = latest
    ? ACK_VIEW[ackViewFor(ownEntries, latest.acknowledgementRequired, mine.queryFor(latest.id))]
    : null;

  const rows = rowsForMyShare(mine, i18n, navigate);

  // Tonight, by the same business day the shifts hook already derives.
  const tonight = shifts.businessDate
    ? (shifts.shifts.find((s) => s.workDate === shifts.businessDate) ?? null)
    : null;
  const report = tips.own;

  const firstName = membership.displayName.trim().split(/\s+/)[0] ?? membership.displayName;
  // The area the membership points at, by name — or the truth that there is
  // none yet. Never a default.
  const areaLabel = assignment.status === 'ready' ? (assignment.areaName ?? t('tmNoArea')) : null;
  const workplaceLabel = [membership.workplace.name, membership.workplace.city]
    .filter(Boolean)
    .join(', ');

  return (
    <Screen
      title={areaLabel ? `${firstName} · ${areaLabel}` : firstName}
      kicker={workplaceLabel}
      back={false}
      aboveTabs
      action={{
        icon: 'bell',
        label: inbox.unread > 0 ? String(inbox.unread) : undefined,
        onClick: () => navigate('/notifications'),
      }}
    >
      {mine.status === 'error' ? (
        <>
          <EmptyState title={t('loadFailed')} />
          <Button variant="secondary" block onClick={() => void mine.refresh()}>
            {t('retry')}
          </Button>
        </>
      ) : mine.status !== 'ready' ? (
        <EmptyState title={t('dLoading')} />
      ) : latest && presentation ? (
        <>
          <HeroCard
            kicker={t('hmLatestShare')}
            amount={money(ownCents / 100)}
            meta={`${day(new Date(`${latest.periodStart}T12:00:00`))} · ${t(
              PAYOUT_STATE_LABEL[latest.payoutStatus],
            )}`}
            pill={
              <>
                <Icon
                  name={presentation.tone === 'subtle' ? 'check' : 'clock'}
                  size={14}
                  color="currentColor"
                />
                {t(presentation.label)}
              </>
            }
          />
          <Button variant="secondary" block quiet onClick={() => navigate(`/payout/${latest.id}`)}>
            {t('seeCalc')}
          </Button>
        </>
      ) : (
        <EmptyState title={t('hmNoShareTitle')}>{t('emptyShiftsBody')}</EmptyState>
      )}

      <CardButton tone="primary" padding="roomy" onClick={() => navigate('/report')}>
        <div className={ui.stackTight}>
          <span className={ui.inline}>
            <Icon name="notebook" size={19} color="var(--color-accent)" />
            <span className={`${ui.rowMain} ${ui.rowTitle} ${ui.rowTitleStrong}`}>
              {report ? t('reportAgain') : t('reportCta')}
            </span>
            <Icon name="caret-right" size={14} color="var(--color-text-muted)" />
          </span>
          <span className={ui.noteBody} style={{ fontSize: 12.5 }}>
            {tips.status === 'error'
              ? t('loadFailed')
              : tips.status !== 'ready'
                ? t('dLoading')
                : report
                  ? `${t('reportedByYou')} ${money(report.totalCents / 100)} · ${formatClock(
                      instantToWallMinutes(report.reportedAt, membership.workplace.timezone),
                    )}`
                  : t('reportBody')}
          </span>
        </div>
      </CardButton>

      <CardButton padding="padded" onClick={() => navigate('/hours')}>
        <span className={ui.inline} style={{ gap: 14 }}>
          <span
            className={ui.avatar}
            style={{
              width: 34,
              height: 34,
              borderRadius: 14,
              background: 'var(--color-tint)',
              boxShadow: 'none',
              color: 'var(--color-accent)',
            }}
            aria-hidden
          >
            <Icon name="clock" size={16} />
          </span>
          <span className={ui.rowMain}>
            <span className={`${ui.rowTitle} ${ui.rowTitleStrong}`}>{t('myHoursTitle')}</span>
            <span
              className={ui.rowMeta}
              style={{
                color: tonight ? 'var(--color-text-subtle)' : 'var(--color-accent)',
                display: 'block',
              }}
            >
              {shifts.status === 'error'
                ? t('loadFailed')
                : shifts.status !== 'ready'
                  ? t('dLoading')
                  : tonight
                    ? `${formatClock(tonight.startMinutes)} – ${formatClock(tonight.endMinutes)} · ${t(
                        SHIFT_STATUS_LABEL[tonight.status],
                      )}${tonight.locked ? ` · ${t('shLockedShort')}` : ''}`
                    : t('hmAddShift')}
            </span>
          </span>
          <Icon name="caret-right" size={14} color="var(--color-text-muted)" />
        </span>
      </CardButton>

      {/* Recent rows, including replaced versions, which say so. When there is
          nothing at all the hero above has already said it. */}
      {mine.status === 'ready' && rows.length > 0 ? (
        <>
          <SectionLabel>{t('recent')}</SectionLabel>
          <div className={ui.stackFlush}>
            {rows.slice(0, 4).map((row) => (
              <HistoryRow key={row.id} row={row} />
            ))}
          </div>
          {rows.length > 4 ? (
            <Button variant="ghost" block onClick={() => navigate('/history')}>
              {t('tabHistory')}
            </Button>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

/** The Phase 1 demo, unchanged: everything from the reducer. */
function DemoHome() {
  const state = useAppState();
  const { t, money, num, dateFor, area } = useI18n();
  const navigate = useNavigate();
  const rows = useDistributionRows();
  const inbox = useNotifications();

  const employeeId = state.session.employeeId;
  const employee = state.employees.find((e) => e.id === employeeId);
  const latest = latestDistribution(state);
  const mine = latest ? shareOf(state, latest, employeeId) : null;
  const acknowledged = latest ? state.acknowledged.includes(latest.id) : false;
  const totals = employeeTotals(state, employeeId);
  const submission = state.submissions[employeeId];
  const report = ownReport(state);

  const workplaceLabel = [state.workplace.name || t('yourWorkplace'), state.workplace.city]
    .filter(Boolean)
    .join(', ');
  const pending = latest?.status === 'pending';
  const hasDistributions = state.distributions.length > 0;

  return (
    <Screen
      title={`${employee?.name.split(' ')[0] ?? ''} · ${area(employee?.area ?? 'Service')}`}
      kicker={workplaceLabel}
      back={false}
      aboveTabs
      action={{
        icon: 'bell',
        label: inbox.unread > 0 ? String(inbox.unread) : undefined,
        onClick: () => navigate('/notifications'),
      }}
    >
      <HeroCard
        kicker={t('lastShift')}
        amount={money(mine?.amount ?? 0)}
        meta={latest ? dateFor(latest.dateKey, latest.date) : t('emptyShifts')}
        pill={
          hasDistributions ? (
            <>
              <Icon
                name={pending && !acknowledged ? 'clock' : 'check'}
                size={14}
                color="currentColor"
              />
              {pending ? (acknowledged ? t('ackDone') : t('waitingOK')) : t('paid')}
            </>
          ) : undefined
        }
      />

      {hasDistributions ? (
        <Button
          variant="secondary"
          block
          quiet
          onClick={() => navigate(`/payout/${latest?.id ?? ''}`)}
        >
          {t('seeCalc')}
        </Button>
      ) : null}

      <CardButton tone="primary" padding="roomy" onClick={() => navigate('/report')}>
        <div className={ui.stackTight}>
          <span className={ui.inline}>
            <Icon name="notebook" size={19} color="var(--color-accent)" />
            <span className={`${ui.rowMain} ${ui.rowTitle} ${ui.rowTitleStrong}`}>
              {report ? t('reportAgain') : t('reportCta')}
            </span>
            <Icon name="caret-right" size={14} color="var(--color-text-muted)" />
          </span>
          <span className={ui.noteBody} style={{ fontSize: 12.5 }}>
            {report
              ? `${t('reportedByYou')} ${money(
                  centsToAmount(report.cardCents + report.cashCents),
                )} · ${report.reportedAt}`
              : t('reportBody')}
          </span>
        </div>
      </CardButton>

      <div className={ui.inline} style={{ gap: 10, alignItems: 'stretch' }}>
        <Card padding="padded" className={ui.statCard}>
          <span className={ui.statLabel}>{t('thisMonth')}</span>
          <div
            className={`${ui.statValue} tabular`}
            style={{ color: 'var(--color-money-row)', fontWeight: 600, fontSize: 21 }}
          >
            {money(totals.amount)}
          </div>
        </Card>
        <Card padding="padded" className={ui.statCard}>
          <span className={ui.statLabel}>{t('hoursLogged')}</span>
          <div className={`${ui.statValue} tabular`} style={{ fontSize: 21 }}>
            {num(totals.hours, 1)}
          </div>
        </Card>
      </div>

      <CardButton padding="padded" onClick={() => navigate('/hours')}>
        <span className={ui.inline} style={{ gap: 14 }}>
          <span
            className={ui.avatar}
            style={{
              width: 34,
              height: 34,
              borderRadius: 14,
              background: 'var(--color-tint)',
              boxShadow: 'none',
              color: 'var(--color-accent)',
            }}
            aria-hidden
          >
            <Icon name="clock" size={16} />
          </span>
          <span className={ui.rowMain}>
            <span className={`${ui.rowTitle} ${ui.rowTitleStrong}`}>{t('myHoursTitle')}</span>
            <span
              className={ui.rowMeta}
              style={{
                color: submission ? 'var(--color-text-subtle)' : 'var(--color-accent)',
                display: 'block',
              }}
            >
              {submission
                ? `${formatClock(submission.startMinutes)} – ${formatClock(
                    submission.endMinutes,
                  )} · ${num(workedMinutes(submission) / 60, 2)} ${t('hSuffix')}`
                : t('notSubmitted')}
            </span>
          </span>
          <Icon name="caret-right" size={14} color="var(--color-text-muted)" />
        </span>
      </CardButton>

      <SectionLabel>{t('recent')}</SectionLabel>
      {hasDistributions ? (
        <div className={ui.stackFlush}>
          {rows.slice(0, 4).map((row) => (
            <HistoryRow key={row.id} row={row} />
          ))}
        </div>
      ) : (
        <EmptyState title={t('emptyShifts')}>{t('emptyShiftsBody')}</EmptyState>
      )}
    </Screen>
  );
}
