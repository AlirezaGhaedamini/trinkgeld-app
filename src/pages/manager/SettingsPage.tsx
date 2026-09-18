import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card, CardButton } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { InfoNote } from '@/components/ui/Note';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { AREA_ORDER } from '@/data/areas';
import { useAppState } from '@/hooks/useAppState';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/hooks/useI18n';
import { useRuleEditor } from '@/hooks/useRuleEditor';
import { useToast } from '@/hooks/useToast';
import { useWorkplace } from '@/hooks/useWorkplace';
import { usePeriodClose } from '@/period/usePeriod';
import { BASIS_LABEL, METHOD_LABEL } from '@/rules/types';
import ui from '@/components/ui/ui.module.css';

/**
 * Settings — the manager's configuration, as an index.
 *
 * It used to be one long screen, "Rules", with every control on it at once; on
 * a phone that was a scroll past six decisions to reach one. This screen names
 * each setting, shows its current value, and opens a screen that holds that one
 * setting and nothing else.
 *
 * What the settings MEAN did not move. The six rule sections are still one
 * versioned rule: they share one working copy (RuleEditorProvider), the button
 * at the bottom still opens, activates or discards the whole draft, and nothing
 * reaches a distribution until activate_rule() succeeds. The values printed
 * here are that working copy — the draft's while one is open, the active
 * version's otherwise — which is why the draft card sits above them. Areas,
 * roles, the workplace settings and the period close are what they always
 * were: their own screens, saving straight to the workplace.
 */
export function SettingsPage() {
  const editor = useRuleEditor();
  return editor.rules.enabled ? <RealSettings /> : <DemoSettings />;
}

/**
 * One row of the index: the setting's name, its current value under it, and a
 * chevron. The name wraps — German names run long, and a truncated name is a
 * row nobody can read — while the value keeps to one line and ends in an
 * ellipsis, so a long list of areas can never push the row wider than the card.
 */
function SettingsRow({
  title,
  summary,
  onClick,
}: {
  title: string;
  summary: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${ui.insetRow} ${ui.insetRowInteractive} ${ui.insetRowStacked}`}
      style={{ alignItems: 'center' }}
      onClick={onClick}
    >
      <span className={ui.rowMain}>
        <span className={ui.rowTitle}>{title}</span>
        <span className={`${ui.rowMeta} ${ui.truncate}`} style={{ marginTop: 2 }}>
          {summary}
        </span>
      </span>
      <Icon name="caret-right" size={13} className={ui.chevron} />
    </button>
  );
}

/* ── real mode ────────────────────────────────────────────────────────────── */

function RealSettings() {
  const editor = useRuleEditor();
  const { t, num, percent, day, language } = useI18n();
  const navigate = useNavigate();
  const auth = useAuth();
  const membership = useWorkplace().activeMembership;
  const period = usePeriodClose();

  const { rules, active, shown, editing } = editor;
  const state = rules.state;

  if (rules.status === 'error') {
    return (
      <Screen title={t('tabSettings')} titleSize={26} back={false} aboveTabs>
        <EmptyState title={t('authNetwork')} />
      </Screen>
    );
  }

  /* Until a version is on screen there is nothing true to print: the working
     copy still holds its starting values, and "15 min" before the rules have
     loaded would be a claim, not a reading. */
  const value = (text: string) => (shown ? text : '—');

  const poolSummary =
    editor.liveShares
      .filter((s) => s.isPoolEligible && s.percentage > 0)
      .map((s) => `${s.areaName} ${percent(s.percentage)}`)
      .join(' · ') || '—';
  const basisKey = BASIS_LABEL[editor.basis];
  const activeBasisKey = active ? BASIS_LABEL[active.overlapBasis] : undefined;

  const onDate = (iso: string) => day(new Date(`${iso}T12:00:00`));
  const lastClose = period.closes[0] ?? null;

  return (
    <Screen
      title={t('tabSettings')}
      kicker={shown ? undefined : t('workplace')}
      titleSize={26}
      back={false}
      aboveTabs
      cta={editor.cta}
    >
      {/* ── the manager's own account ───────────────────────────────────── */}
      {/* An employee has a "You" tab; a manager's four tabs belong to the
          workplace. This card is the manager's door to the shared profile
          screen — language, the workplace chooser, sign out — and it sits
          first on this tab, where the employee's identity block sits on
          theirs, so it is found rather than searched for. */}
      {membership ? (
        <CardButton padding="padded" onClick={() => navigate('/profile')}>
          <span className={ui.inline}>
            <Avatar name={membership.displayName} size={44} tinted />
            <span className={ui.rowMain}>
              <span
                className={`${ui.rowTitle} ${ui.rowTitleStrong} ${ui.truncate}`}
                style={{ display: 'block' }}
              >
                {membership.displayName}
              </span>
              <span className={`${ui.rowMeta} ${ui.truncate}`} style={{ display: 'block' }}>
                {auth.email ? `${t('mgrRole')} · ${auth.email}` : t('mgrRole')}
              </span>
            </span>
            <Icon name="caret-right" size={13} color="var(--color-text-subtle)" />
          </span>
        </CardButton>
      ) : null}

      {/* ── which version is in force ───────────────────────────────────── */}
      <Card padding="padded">
        <div className={ui.spread}>
          <span className={ui.rowTitle}>{t('ruleActive')}</span>
          {active ? (
            <Badge tone="quiet">
              {t('ruleVersion')} {active.version}
            </Badge>
          ) : null}
        </div>
        {active ? (
          <p className={ui.rowMeta} style={{ marginTop: 4 }}>
            {t('ruleActivatedOn')}{' '}
            {active.effectiveFrom
              ? new Intl.DateTimeFormat(language === 'Deutsch' ? 'de-DE' : 'en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                }).format(new Date(active.effectiveFrom))
              : '—'}
            {/* While a draft is open the rows below show the DRAFT's values,
                so this card carries what is in force — the comparison the
                single Rules screen offered. Without a draft the rows already
                say it, and the card stays compact. */}
            {editing ? (
              <>
                {' · '}
                {activeBasisKey ? t(activeBasisKey) : '—'}
                {' · '}
                {active.minOverlapMinutes} {t('minutesShort')}
                {' · '}
                {t(METHOD_LABEL[active.method])}
              </>
            ) : null}
          </p>
        ) : (
          <p className={ui.rowMeta} style={{ marginTop: 4 }}>
            {t('ruleNoActive')}
          </p>
        )}
      </Card>

      {editing ? (
        <Card padding="padded" tone="warning">
          <div className={ui.spread}>
            <span className={ui.rowTitle}>{t('ruleDraftTitle')}</span>
            <Badge>{t('ruleVersion')} {(active?.version ?? 0) + 1}</Badge>
          </div>
          <p className={ui.rowMeta} style={{ marginTop: 4 }}>
            {t('ruleDraftBody')}
          </p>
        </Card>
      ) : null}

      {/* ── the rule: six sections of one version ───────────────────────── */}
      {/* Grouped in a stack, never a bare child of the screen body: the body
          is a fixed-height flex column, and a clipped card placed straight
          in it has an automatic minimum height of zero — once the screen
          overflows, it absorbs all of the shrinking and collapses to a line. */}
      <div className={ui.stackTight}>
        <Card padding="none" clip>
          <SettingsRow
            title={t('areasInPool')}
            summary={value(poolSummary)}
            onClick={() => navigate('/manager/settings/pool')}
          />
          <SettingsRow
            title={t('ruleBasis')}
            summary={value(basisKey ? t(basisKey) : '—')}
            onClick={() => navigate('/manager/settings/working-together')}
          />
          <SettingsRow
            title={t('withinArea')}
            summary={value(t(METHOD_LABEL[editor.method]))}
            onClick={() => navigate('/manager/settings/within-area')}
          />
          <SettingsRow
            title={t('minOverlapRule')}
            summary={value(`${editor.minOverlap} ${t('minutesShort')}`)}
            onClick={() => navigate('/manager/settings/minimum-shared-time')}
          />
          <SettingsRow
            title={t('rr1')}
            summary={value(editor.areaName(editor.roundingAreaId))}
            onClick={() => navigate('/manager/settings/rounding')}
          />
          <SettingsRow
            title={t('rr2')}
            summary={value(editor.ack ? t('rr2v') : t('rr2v2'))}
            onClick={() => navigate('/manager/settings/confirmation')}
          />
        </Card>

        {/* The one warning the pool section carries is repeated here: the
            engine pays these people nothing, and a manager who never opens the
            pool screen would otherwise not hear about it before the money is
            divided. */}
        {editor.stranded.count > 0 ? (
          <InfoNote icon="warning-circle">
            {editor.stranded.count}{' '}
            {editor.stranded.count === 1 ? t('zeroShareWarn1') : t('zeroShareWarnN')}
            {editor.stranded.areaNames.length > 0 ? ` (${editor.stranded.areaNames.join(', ')})` : ''}
          </InfoNote>
        ) : null}
      </div>

      {/* ── the workplace: saved directly, not part of a rule version ───── */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('workplace')}</SectionLabel>
        <Card padding="none" clip>
          <SettingsRow
            title={t('cfgAreasTitle')}
            summary={(state?.areas ?? []).map((a) => a.areaName).join(' · ') || '—'}
            onClick={() => navigate('/manager/settings/areas')}
          />
          <SettingsRow
            title={t('rolePointsTitle')}
            summary={
              (state?.roles ?? [])
                .map((r) => `${r.roleName} ×${num(r.points, 1)}`)
                .join(' · ') || '—'
            }
            onClick={() => navigate('/manager/settings/roles')}
          />
          <SettingsRow
            title={t('wsTitle')}
            summary={state?.settings.timezone ?? '—'}
            onClick={() => navigate('/manager/settings/workplace')}
          />
        </Card>
      </div>

      {/* ── the books ────────────────────────────────────────────────────── */}
      {/* Closing a period and taking the figures away is not a rule, and while
          it sat as the last row of a card of rules a manager testing the real
          app did not find it at all. Its own heading is the whole fix. The
          value is the last close when there is one; with none (or none known
          yet) it says what the screen is for rather than claiming "never". */}
      <div className={ui.stackTight}>
        <SectionLabel>{t('pcRecordsHead')}</SectionLabel>
        <Card padding="none" clip>
          <SettingsRow
            title={t('pcHubRow')}
            summary={
              lastClose
                ? t('dbLastClosedRange')
                    .replace('{from}', onDate(lastClose.periodStart))
                    .replace('{to}', onDate(lastClose.periodEnd))
                : t('pcHubRowBody')
            }
            onClick={() => navigate('/manager/settings/period')}
          />
        </Card>
      </div>
    </Screen>
  );
}

/* ── demo mode — unchanged local state, no Supabase call ──────────────────── */

function DemoSettings() {
  const state = useAppState();
  const { t, num, percent, area, language } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();

  const german = language === 'Deutsch';

  const poolSummary =
    AREA_ORDER.filter((areaId) => (state.rule.areaShares[areaId] ?? 0) > 0)
      .map((areaId) => `${area(areaId)} ${percent(state.rule.areaShares[areaId] ?? 0)}`)
      .join(' · ') || '—';

  return (
    <Screen
      title={t('tabSettings')}
      kicker={state.workplace.name}
      titleSize={26}
      back={false}
      aboveTabs
    >
      <div className={ui.stackTight}>
        <Card padding="none" clip>
          <SettingsRow
            title={t('areasInPool')}
            summary={poolSummary}
            onClick={() => navigate('/manager/settings/pool')}
          />
          <SettingsRow
            title={t('withinArea')}
            summary={t(state.draft.method)}
            onClick={() => navigate('/manager/settings/within-area')}
          />
          <SettingsRow
            title={t('minOverlapRule')}
            summary={`${state.rule.minOverlapMinutes} ${t('minutesShort')}`}
            onClick={() => navigate('/manager/settings/minimum-shared-time')}
          />
          {/* The demo has no rounding to choose; the row answers as it always has. */}
          <SettingsRow
            title={t('rr1')}
            summary={area(state.rule.roundingArea)}
            onClick={() =>
              show(german ? 'Rundungsrest geht an Service' : 'Rounding leftover goes to Service')
            }
          />
          <SettingsRow
            title={t('rr2')}
            summary={state.rule.acknowledgementRequired ? t('rr2v') : t('rr2v2')}
            onClick={() => navigate('/manager/settings/confirmation')}
          />
          <SettingsRow
            title={t('rr3')}
            summary={`×${num(0.5, 1)}`}
            onClick={() => navigate('/manager/team')}
          />
        </Card>
      </div>
    </Screen>
  );
}
