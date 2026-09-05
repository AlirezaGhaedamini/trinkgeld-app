import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { Card, CardButton } from '@/components/ui/Card';
import { HeroCard } from '@/components/ui/HeroCard';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListRow } from '@/components/ui/ListRow';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { StatCard } from '@/components/ui/StatCard';
import { HistoryRow, type HistoryRowData } from '@/components/domain/HistoryRow';
import { useAppState } from '@/hooks/useAppState';
import { useDistributionRows } from '@/hooks/useDistributionRows';
import { useNotifications } from '@/notifications/useNotifications';
import { useI18n } from '@/hooks/useI18n';
import { useShiftLabel } from '@/hooks/useShiftLabel';
import { useWorkplace } from '@/hooks/useWorkplace';
import { useDashboard } from '@/dashboard/useDashboard';
import { attentionCount, type DashboardRecent, type PoolState } from '@/dashboard/types';
import { DASHBOARD_FAILURE_KEY } from '@/dashboard/errors';
import { PAYOUT_STATE_LABEL } from '@/distribution/ack';
import type { DistributionStatus } from '@/distribution/types';
import type { StringKey } from '@/i18n/strings';
import { centsToAmount } from '@/lib/money';
import { pendingDistribution, reportsTotalCents, submissionCount } from '@/state/selectors';
import ui from '@/components/ui/ui.module.css';

/**
 * The manager's overview: what needs doing, tonight, the last night sent, the
 * week's money, and shortcuts.
 *
 * Two dashboards, one screen. With real credentials every figure comes from
 * one call to `manager_dashboard()`, where the database decided what day it
 * is, what is current and what is owed. Without them the sample workplace is
 * rendered from the local dataset exactly as the prototype was signed off, and
 * makes no request at all.
 */
export function DashboardPage() {
  /* One hook instance, passed down: the real branch must not call it again,
     or the RPC would be issued twice per mount. */
  const dashboard = useDashboard();
  return dashboard.enabled ? <RealDashboard dashboard={dashboard} /> : <DemoDashboard />;
}

const DIST_STATUS_LABEL: Record<DistributionStatus, StringKey> = {
  draft: 'dDraftLabel',
  sent: 'dSentLabel',
  confirmed: 'dConfirmedLabel',
  cancelled: 'dCancelledLabel',
};

const POOL_STATE_LABEL: Record<PoolState, StringKey> = {
  open: 'dbPoolOpen',
  locked: 'dbPoolLocked',
  distributed: 'dbPoolDistributed',
};

/* ── real ─────────────────────────────────────────────────────────────────── */

function RealDashboard({ dashboard }: { dashboard: ReturnType<typeof useDashboard> }) {
  const { t, money, people, hours, day } = useI18n();
  const navigate = useNavigate();
  const workplace = useWorkplace();
  const membership = workplace.activeMembership;
  const inbox = useNotifications();
  const d = dashboard.data;

  const onDate = (iso: string) => day(new Date(`${iso}T12:00:00`));
  const n = (key: StringKey, count: number) => t(key).replace('{n}', String(count));

  const title = membership?.workplace.name || t('yourWorkplace');
  const kicker = membership?.displayName
    ? `${membership.displayName} · ${t('mgrRole')}`
    : t('mgrRole');

  /* The attention card: only the rows that are non-zero, in priority order.
     Each links to the one place the work gets done — the distribution when the
     server named one, the filtered list when it did not. */
  const attention = d
    ? ([
        [d.attention.submittedShifts, 'dbAttnSubmitted', '/manager/hours'],
        [
          d.attention.openQuestions,
          'dbAttnQuestions',
          d.attention.openQuestionDistributionId
            ? `/manager/distributions/${d.attention.openQuestionDistributionId}`
            : '/manager/distributions?filter=pending',
        ],
        [
          d.attention.agreedCorrectionsNotSent,
          'dbAttnAgreed',
          d.attention.agreedCorrectionDistributionId
            ? `/manager/distributions/${d.attention.agreedCorrectionDistributionId}`
            : '/manager/distributions',
        ],
        [
          d.attention.draftDistributions,
          'dbAttnDrafts',
          d.attention.draftDistributionId
            ? `/manager/distributions/${d.attention.draftDistributionId}`
            : '/manager/distributions?filter=pending',
        ],
        [
          d.attention.draftCorrections,
          'dbAttnDraftCorr',
          d.attention.draftCorrectionId
            ? `/manager/distributions/${d.attention.draftCorrectionId}`
            : '/manager/distributions?filter=pending',
        ],
        [d.attention.pendingJoinRequests, 'dbAttnJoin', '/manager/invite'],
      ] as const).filter(([count]) => count > 0)
    : [];

  const latest = d?.latest ?? null;
  const latestNeedsYou = latest
    ? latest.pendingPeople + latest.queriedPeople + latest.openQuestions > 0
    : false;

  const recentRows: HistoryRowData[] = (d?.recent ?? []).map((row: DashboardRecent) => ({
    id: row.id,
    date: onDate(row.periodStart),
    meta: people(row.peopleCount),
    amount: money(centsToAmount(row.entitlementCents)),
    status: row.isCorrection && row.status !== 'draft'
      ? t('corrCorrected')
      : t(DIST_STATUS_LABEL[row.status]),
    statusColor: row.status === 'draft' ? 'var(--color-accent)' : 'var(--color-text-subtle)',
    chip: undefined,
    onOpen: () => navigate(`/manager/distributions/${row.id}`),
  }));

  return (
    <Screen
      title={title}
      kicker={kicker}
      titleSize={22}
      back={false}
      aboveTabs
      action={{
        icon: 'bell',
        label: inbox.unread > 0 ? String(inbox.unread) : undefined,
        onClick: () => navigate('/notifications'),
      }}
    >
      {dashboard.status === 'error' ? (
        <EmptyState title={t('dbLoadFailed')}>
          {t(DASHBOARD_FAILURE_KEY[dashboard.failure ?? 'unknown'])}
        </EmptyState>
      ) : null}

      {d && attention.length > 0 && attentionCount(d.attention) > 0 ? (
        <Card tone="warning" padding="padded">
          <p className={ui.inline} style={{ fontSize: 12, color: 'var(--color-accent)' }}>
            <Icon name="warning-circle" size={15} />
            {t('needsYou')}
          </p>
          {attention.map(([count, key, to]) => (
            <ListRow
              key={key}
              inset
              title={n(key, count)}
              chevron
              onClick={() => navigate(to)}
            />
          ))}
        </Card>
      ) : null}

      {d ? (
        <HeroCard
          compact
          kicker={t('tipsWeek')}
          amount={money(centsToAmount(d.week.entitlementCents))}
          meta={`${n('dbNightsN', d.week.distributions)} · ${onDate(d.weekStart)} – ${onDate(d.weekEnd)}`}
        />
      ) : null}

      {d ? (
        <div className={ui.inline} style={{ gap: 10, alignItems: 'stretch' }}>
          <StatCard
            label={t('dbAwaitingReview')}
            value={String(d.attention.submittedShifts)}
            valueColor={
              d.attention.submittedShifts > 0 ? 'var(--color-accent)' : 'var(--color-text)'
            }
            onClick={() => navigate('/manager/hours')}
          />
          <StatCard
            label={t('dbAwaitingOk')}
            value={String(latest?.pendingPeople ?? 0)}
            valueColor={
              (latest?.pendingPeople ?? 0) > 0 ? 'var(--color-accent)' : 'var(--color-text)'
            }
            onClick={() =>
              navigate(latest ? `/manager/distributions/${latest.id}` : '/manager/distributions')
            }
          />
          <StatCard
            label={t('tabTeam')}
            value={String(d.team.activeMembers)}
            onClick={() => navigate('/manager/team')}
          />
        </div>
      ) : null}

      {/* Tonight: the business day the SERVER decided, and the three things that
          make a night ready to distribute. */}
      {d ? (
        <Card padding="padded">
          <p className={ui.rowMeta} style={{ display: 'block' }}>
            {t('dbTonight')} · {onDate(d.businessDate)}
          </p>
          <ListRow
            inset
            title={t('dbHoursApproved')}
            meta={
              d.tonight.approvedPeople > 0
                ? [
                    `${people(d.tonight.approvedPeople)} · ${hours(d.tonight.approvedMinutes / 60)}`,
                    d.tonight.submittedShifts > 0 ? n('dbSubmittedToday', d.tonight.submittedShifts) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : d.tonight.submittedShifts > 0
                  ? n('dbSubmittedToday', d.tonight.submittedShifts)
                  : t('dbNoHoursYet')
            }
            chevron
            onClick={() => navigate('/manager/hours')}
          />
          <ListRow
            inset
            title={t('reportsHead')}
            meta={d.tonight.reportsCount > 0 ? n('dbReportsLine', d.tonight.reportsCount) : t('noReports')}
            trailing={
              d.tonight.reportsCount > 0 ? (
                <span className="tabular" style={{ fontSize: 16, fontWeight: 500 }}>
                  {money(centsToAmount(d.tonight.reportsTotalCents))}
                </span>
              ) : null
            }
            chevron
            onClick={() => navigate('/manager/reports')}
          />
          <ListRow
            inset
            title={t('dbPool')}
            meta={
              d.tonight.pool
                ? [
                    t(POOL_STATE_LABEL[d.tonight.pool.status]),
                    d.tonight.distribution
                      ? d.tonight.distribution.isCorrection && d.tonight.distribution.status !== 'draft'
                        ? t('corrCorrected')
                        : t(DIST_STATUS_LABEL[d.tonight.distribution.status])
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : t('dbPoolNone')
            }
            trailing={
              d.tonight.pool ? (
                <span className="tabular" style={{ fontSize: 16, fontWeight: 500 }}>
                  {money(centsToAmount(d.tonight.pool.totalCents))}
                </span>
              ) : null
            }
            chevron
            onClick={() =>
              navigate(
                d.tonight.distribution
                  ? `/manager/distributions/${d.tonight.distribution.id}`
                  : '/manager/new/pool',
              )
            }
          />
        </Card>
      ) : null}

      {/* The last night sent, in the shape the prototype's "needs you" card
          had: date, money, people, who still owes an answer, and one button. */}
      {d ? (
        latest ? (
          <Card tone={latestNeedsYou ? 'warning' : 'default'} padding="roomy">
            <div className={ui.stackTight}>
              <p className={ui.inline} style={{ fontSize: 12, color: 'var(--color-accent)' }}>
                {t('dbLatest')}
                {latest.isCorrection ? ` · ${t('corrCorrected')}` : ''}
              </p>
              <div>
                <p className={`${ui.rowTitle} ${ui.rowTitleStrong}`}>{onDate(latest.periodStart)}</p>
                <p className={ui.noteBody} style={{ marginTop: 2 }}>
                  {money(centsToAmount(latest.entitlementCents))} · {people(latest.peopleCount)} ·{' '}
                  {t(DIST_STATUS_LABEL[latest.status])}
                </p>
                <p className={ui.noteBody} style={{ marginTop: 2 }}>
                  {latest.acknowledgementRequired
                    ? t('dbAckLine')
                        .replace('{c}', String(latest.confirmedPeople))
                        .replace('{p}', String(latest.pendingPeople))
                        .replace('{q}', String(latest.queriedPeople))
                    : t('ackNotRequired')}
                  {latest.openQuestions > 0 ? ` · ${n('dbAttnQuestions', latest.openQuestions)}` : ''}
                </p>
                <p className={ui.noteBody} style={{ marginTop: 2 }}>
                  {t(PAYOUT_STATE_LABEL[latest.payoutState])}
                </p>
              </div>
              <Button quiet block onClick={() => navigate(`/manager/distributions/${latest.id}`)}>
                {t('reviewDist')}
              </Button>
            </div>
          </Card>
        ) : (
          <EmptyState title={t('dbLatestNone')}>{t('emptyResultBody')}</EmptyState>
        )
      ) : null}

      {/* Money not yet moved, and where the books stand. Both figures are the
          database's: settlement_due summed over current versions, and the most
          recent close. Nothing here adds an original to its correction. */}
      {d ? (
        <Card padding="padded">
          <ListRow
            inset
            title={t('dbSettlement')}
            meta={
              d.settlement.unpaidDistributions > 0
                ? n('dbUnpaidN', d.settlement.unpaidDistributions)
                : t('dbAllSettled')
            }
            trailing={
              <span
                className="tabular"
                style={{
                  fontSize: 16,
                  fontWeight: 500,
                  color:
                    d.settlement.outstandingCents > 0
                      ? 'var(--color-warning)'
                      : 'var(--color-text-subtle)',
                }}
              >
                {money(centsToAmount(d.settlement.outstandingCents))}
              </span>
            }
            chevron
            onClick={() => navigate('/manager/distributions')}
          />
          <ListRow
            inset
            title={t('dbLastClose')}
            meta={
              d.close
                ? `${onDate(d.close.periodStart)} – ${onDate(d.close.periodEnd)}`
                : t('dbNoClose')
            }
            chevron
            onClick={() => navigate('/manager/rules/period')}
          />
        </Card>
      ) : null}

      <Button block icon="plus-circle" onClick={() => navigate('/manager/new/pool')}>
        {t('newDistribution')}
      </Button>

      <SectionLabel>{t('recentDist')}</SectionLabel>
      {recentRows.length > 0 ? (
        <div className={ui.stackFlush}>
          {recentRows.map((row) => (
            <HistoryRow key={row.id} row={row} />
          ))}
        </div>
      ) : d ? (
        <EmptyState title={t('emptyDistributions')}>{t('emptyResultBody')}</EmptyState>
      ) : null}
    </Screen>
  );
}

/* ── demo ─────────────────────────────────────────────────────────────────── */

/** The prototype's overview, rendered from the sample dataset. Unchanged. */
function DemoDashboard() {
  const state = useAppState();
  const { t, money, people, dateFor, language } = useI18n();
  const shift = useShiftLabel();
  const navigate = useNavigate();
  const rows = useDistributionRows();
  const inbox = useNotifications();

  const managerName = state.employees.find((e) => e.id === state.session.employeeId)?.name ?? '';
  const pending = pendingDistribution(state);
  const hasDistributions = state.distributions.length > 0;
  const submitted = submissionCount(state);
  const weekTotal = state.distributions.reduce((sum, d) => sum + d.poolAmount, 0);
  const reportsTotal = centsToAmount(reportsTotalCents(state));

  return (
    <Screen
      title={state.workplace.name || t('yourWorkplace')}
      kicker={managerName ? `${managerName} · ${t('mgrRole')}` : t('mgrRole')}
      titleSize={22}
      back={false}
      aboveTabs
      action={{
        icon: 'bell',
        label: inbox.unread > 0 ? String(inbox.unread) : undefined,
        onClick: () => navigate('/notifications'),
      }}
    >
      {pending ? (
        <Card tone="warning" padding="roomy">
          <div className={ui.stackTight}>
            <p className={ui.inline} style={{ fontSize: 12, color: 'var(--color-accent)' }}>
              <Icon name="warning-circle" size={15} />
              {t('needsYou')}
            </p>
            <div>
              <p className={`${ui.rowTitle} ${ui.rowTitleStrong}`}>
                {dateFor(pending.dateKey, pending.date)}
              </p>
              <p className={ui.noteBody} style={{ marginTop: 2 }}>
                {money(pending.poolAmount)} · {people(pending.peopleCount)} ·{' '}
                {pending.peopleCount - pending.acknowledgedCount} {t('awaitingN')}
              </p>
            </div>
            <Button
              quiet
              block
              onClick={() => navigate(`/manager/distributions/${pending.id}`)}
            >
              {t('reviewDist')}
            </Button>
          </div>
        </Card>
      ) : null}

      <HeroCard
        compact
        kicker={t('tipsWeek')}
        amount={money(weekTotal)}
        meta={`${state.distributions.length} ${
          language === 'Deutsch' ? 'Schichten' : 'shifts'
        } · ${t(state.draft.method)}`}
      />

      <div className={ui.inline} style={{ gap: 10, alignItems: 'stretch' }}>
        <StatCard
          label={t('hoursHead')}
          value={`${submitted}/${state.employees.length}`}
          valueColor={
            submitted < state.employees.length ? 'var(--color-accent)' : 'var(--color-text)'
          }
          onClick={() => navigate('/manager/hours')}
        />
        <StatCard
          label={t('pendingAcks')}
          value={String(pending ? pending.peopleCount - pending.acknowledgedCount : 0)}
          valueColor="var(--color-accent)"
          onClick={() => navigate('/manager/distributions?filter=pending')}
        />
        <StatCard
          label={t('tabTeam')}
          value={String(state.employees.length)}
          onClick={() => navigate('/manager/team')}
        />
      </div>

      <CardButton padding="padded" onClick={() => navigate('/manager/reports')}>
        <span className={ui.inline}>
          <Icon name="notebook" size={19} color="var(--color-accent)" />
          <span className={ui.rowMain}>
            <span className={`${ui.rowTitle} ${ui.rowTitleStrong}`}>{t('reportsHead')}</span>
            <span className={ui.rowMeta} style={{ display: 'block' }}>
              {state.reports.length
                ? `${people(state.reports.length)} · ${shift.short}`
                : t('noReports')}
            </span>
          </span>
          <span className="tabular" style={{ fontSize: 16, fontWeight: 500 }}>
            {money(reportsTotal)}
          </span>
          <Icon name="caret-right" size={14} color="var(--color-text-muted)" />
        </span>
      </CardButton>

      <Button block icon="plus-circle" onClick={() => navigate('/manager/new/pool')}>
        {t('newDistribution')}
      </Button>

      <SectionLabel>{t('recentDist')}</SectionLabel>
      {hasDistributions ? (
        <div className={ui.stackFlush}>
          {rows.slice(0, 4).map((row) => (
            <HistoryRow key={row.id} row={row} />
          ))}
        </div>
      ) : (
        <EmptyState title={t('emptyDistributions')}>{t('emptyResultBody')}</EmptyState>
      )}
    </Screen>
  );
}
