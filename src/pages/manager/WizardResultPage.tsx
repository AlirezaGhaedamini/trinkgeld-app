import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/layout/Screen';
import { BandBar } from '@/components/ui/BandBar';
import { Button } from '@/components/ui/Button';
import { Card, CardButton } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Note } from '@/components/ui/Note';
import { Sheet } from '@/components/ui/Sheet';
import { AreaResultBlock } from '@/components/domain/AreaResultBlock';
import { RealAreaResultBlock } from '@/components/domain/RealAreaResultBlock';
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { draftPoolAmount, draftResult, liveOverlap } from '@/state/selectors';
import { peopleInResult } from '@/lib/distribution';
import { colorForAreaKey } from '@/data/areas';
import { DISTRIBUTION_FAILURE_KEY } from '@/distribution/errors';
import { useDistributionWizard } from '@/distribution/useDistribution';
import type { AreaId } from '@/types';
import ui from '@/components/ui/ui.module.css';
import styles from '@/pages/pages.module.css';

/** Wizard step 4 — the calculated result, then confirm and send. */
export function WizardResultPage() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { t, money, people, area } = useI18n();
  const { show } = useToast();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const wizard = useDistributionWizard();
  const real = wizard.enabled;

  /**
   * In real mode this screen shows what the DATABASE calculated.
   *
   * calculate_distribution() writes a draft distribution with its area
   * subtotals and one entry per member per area; this reads them back. The
   * client-side engine in lib/distribution.ts is not consulted for a real
   * distribution — it stays the demo engine and the preview parity check.
   */
  const detail = wizard.detail;
  const realEntriesByArea = useMemo(() => {
    const grouped = new Map<string, typeof detail extends null ? never : NonNullable<typeof detail>['entries']>();
    for (const entry of detail?.entries ?? []) {
      const list = grouped.get(entry.areaId);
      if (list) list.push(entry);
      else grouped.set(entry.areaId, [entry]);
    }
    return grouped;
  }, [detail]);

  const localPool = draftPoolAmount(state);
  const result = draftResult(state);
  const localHeadcount = peopleInResult(result);
  const grouping = liveOverlap(state);
  const excluded = grouping.rows.filter((row) => !row.included).length;

  const pool = real ? (wizard.pool?.totalCents ?? 0) / 100 : localPool;
  const headcount = real ? (detail?.distribution.peopleCount ?? 0) : localHeadcount;
  const isDraft = real && detail?.distribution.status === 'draft';

  const bands: Partial<Record<AreaId, number>> = {};
  for (const block of result) bands[block.area] = block.percentage;

  const realBands = (detail?.areas ?? []).map((entry) => ({
    id: entry.areaId,
    weight: entry.percentage,
    color: colorForAreaKey(entry.areaKey),
  }));

  /** Recalculate: the engine replaces any existing draft for this pool. */
  const calculate = async () => {
    const done = await wizard.calculate();
    if (!done.ok) {
      const base = t(DISTRIBUTION_FAILURE_KEY[done.failure ?? 'unknown']);
      // The empty-area refusal names the area; showing it is the difference
      // between "something is wrong" and "fix Bar".
      show(done.areas ? `${base} (${done.areas})` : base);
    }
  };

  /** Finalise. send_distribution() re-checks the inputs and refuses if stale. */
  const finalise = async () => {
    const done = await wizard.send();
    setConfirmOpen(false);
    if (!done.ok) {
      show(t(DISTRIBUTION_FAILURE_KEY[done.failure ?? 'unknown']));
      return;
    }
    navigate('/manager/sent', { replace: true });
  };

  return (
    <Screen
      title={t('calculated')}
      kicker={`${t('step')} 4/4`}
      cta={{
        label: wizard.busy
          ? t(detail ? 'dSending' : 'dCalculating')
          : real && !detail
            ? t('calculate')
            : t('reviewConfirm'),
        muted: wizard.busy || (real ? pool <= 0 : headcount === 0 || pool <= 0),
        onClick: () => {
          if (real && !detail) {
            void calculate();
            return;
          }
          if (headcount === 0 || pool <= 0) {
            show(t('emptyResultBody'));
            return;
          }
          setConfirmOpen(true);
        },
        secondary: real && detail
          ? { label: t('dRecalculate'), onClick: () => void calculate() }
          : { label: t('adjust'), onClick: () => navigate(-1) },
      }}
    >
      <div className={styles.resultHead}>
        <div>
          <p className={styles.displayLabel}>{t('distributed')}</p>
          <p className={`${styles.displayAmount} ${styles.displayAmountSmall} tabular`}>
            {money(pool)}
          </p>
        </div>
        <p className={styles.resultHeadMeta}>
          {people(headcount)}
          <br />
          {money(headcount ? pool / headcount : 0)} {t('avg')}
        </p>
      </div>

      {real ? (
        <BandBar bands={realBands} label={t('areaSplit')} />
      ) : (
        <BandBar shares={bands} label={t('areaSplit')} />
      )}

      {/* A draft is a preview. Saying so is the difference between a number on
          a screen and a payment record. */}
      {isDraft ? (
        <Card padding="padded" tone="primary">
          <p className={ui.infoNote}>
            <Icon name="info" size={18} color="var(--color-accent)" />
            <span>
              <strong>{t('dPreview')}</strong>
              <br />
              {t('dPreviewBody')}
            </span>
          </p>
        </Card>
      ) : null}

      {real && wizard.status === 'loading' ? <EmptyState title={t('dLoading')} /> : null}

      {(real ? !detail || headcount === 0 : headcount === 0) && wizard.status !== 'loading' ? (
        <EmptyState title={t('emptyResult')}>{t('emptyResultBody')}</EmptyState>
      ) : null}

      {real
        ? (detail?.areas ?? []).map((entry) => (
            <RealAreaResultBlock
              key={entry.areaId}
              area={entry}
              entries={realEntriesByArea.get(entry.areaId) ?? []}
              method={detail?.distribution.method ?? 'hours_points'}
            />
          ))
        : result.map((block) => (
            <AreaResultBlock
              key={block.area}
              block={block}
              method={state.draft.method}
              onOpenEntry={(employeeId) => navigate(`/manager/team/${employeeId}`)}
            />
          ))}

      <CardButton padding="padded" onClick={() => navigate('/manager/overlap')}>
        <span className={ui.inline}>
          <Icon name="users-four" size={18} color="var(--color-accent)" />
          <span className={ui.rowMain}>
            <span style={{ fontSize: 14 }}>{t('seeOverlap')}</span>
            <span className={ui.rowMeta} style={{ display: 'block' }}>
              {real
                ? `${headcount} ${t('people')} · ${
                    detail?.distribution.minOverlapMinutes ?? 0
                  } ${t('minutesShort')}`
                : excluded
                  ? `${excluded} ${t('excludedCount')}`
                  : `${grouping.rows.length} ${t('people')} · ${state.rule.minOverlapMinutes} ${t(
                      'minutesShort',
                    )}`}
            </span>
          </span>
          <Icon name="caret-right" size={13} color="var(--color-text-subtle)" />
        </span>
      </CardButton>

      <Note>
        {real && detail
          ? `${t('methodPrefix')}: ${detail.distribution.method} · ${t('dRuleVersion')} ${
              detail.distribution.ruleVersion
            } · ${t('dEngine')} ${detail.distribution.engineVersion ?? '—'}`
          : `${t('methodPrefix')}: ${t(state.draft.method)}`}
      </Note>
      {real ? <Note>{t('dAnchorNote')}</Note> : null}

      <Sheet open={confirmOpen} title={t('confirmSend')} onClose={() => setConfirmOpen(false)}>
        <div className={ui.stackFlush}>
          {[
            { label: t('cPool'), value: money(pool) },
            {
              label: t('cAreas'),
              value: real
                ? (detail?.areas ?? [])
                    .map((entry) => `${entry.areaName} ${entry.percentage}`)
                    .join(' · ')
                : result.map((block) => `${area(block.area)} ${block.percentage}`).join(' · '),
            },
            { label: t('cPeople'), value: String(headcount) },
            {
              label: t('cRule'),
              value: real ? (detail?.distribution.method ?? '') : t(state.draft.method),
            },
          ].map((row) => (
            <div key={row.label} className={ui.row} style={{ padding: '12px 0' }}>
              <span style={{ flex: 'none', fontSize: 14, color: 'var(--color-text-muted)' }}>
                {row.label}
              </span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500, textAlign: 'right' }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>

        <Card padding="padded">
          <p className={ui.infoNote}>
            <Icon name="info" size={18} color="var(--color-accent)" />
            <span>{t('infoNote')}</span>
          </p>
        </Card>

        <div className={ui.inline} style={{ gap: 10 }}>
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
            {t('back')}
          </Button>
          <Button
            block
            disabled={wizard.busy}
            onClick={() => {
              if (real) {
                void finalise();
                return;
              }
              const id = `dnew${state.distributions.length}`;
              dispatch({
                type: 'sendDistribution',
                id,
                peopleCount: headcount,
                poolAmount: pool,
              });
              setConfirmOpen(false);
              navigate('/manager/sent', { replace: true });
            }}
          >
            {wizard.busy ? t('dSending') : `${t('sendTo')} ${people(headcount)}`}
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}
