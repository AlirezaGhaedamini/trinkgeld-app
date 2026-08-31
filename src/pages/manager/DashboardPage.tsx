import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/Button';
import { Card, CardButton } from '@/components/ui/Card';
import { HeroCard } from '@/components/ui/HeroCard';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { StatCard } from '@/components/ui/StatCard';
import { HistoryRow } from '@/components/domain/HistoryRow';
import { useAppState } from '@/hooks/useAppState';
import { useDistributionRows } from '@/hooks/useDistributionRows';
import { useI18n } from '@/hooks/useI18n';
import { useShiftLabel } from '@/hooks/useShiftLabel';
import { centsToAmount } from '@/lib/money';
import { pendingDistribution, reportsTotalCents, submissionCount } from '@/state/selectors';
import ui from '@/components/ui/ui.module.css';

/** The manager's overview: what needs doing, the week's money, and shortcuts. */
export function DashboardPage() {
  const state = useAppState();
  const { t, money, people, dateFor, language } = useI18n();
  const shift = useShiftLabel();
  const navigate = useNavigate();
  const rows = useDistributionRows();

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
