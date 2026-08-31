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
import { useDistributionRows } from '@/hooks/useDistributionRows';
import { useI18n } from '@/hooks/useI18n';
import { employeeTotals, latestDistribution, ownReport, shareOf } from '@/state/selectors';
import { centsToAmount } from '@/lib/money';
import { formatClock, workedMinutes } from '@/lib/time';
import ui from '@/components/ui/ui.module.css';

/** The employee's home: last shift, tonight's report, hours and recent payouts. */
export function HomePage() {
  const state = useAppState();
  const { t, money, num, dateFor, area } = useI18n();
  const navigate = useNavigate();
  const rows = useDistributionRows();

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
