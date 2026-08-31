import { useState } from 'react';
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
import { useAppDispatch, useAppState } from '@/hooks/useAppState';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { draftPoolAmount, draftResult, liveOverlap } from '@/state/selectors';
import { peopleInResult } from '@/lib/distribution';
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

  const pool = draftPoolAmount(state);
  const result = draftResult(state);
  const headcount = peopleInResult(result);
  const grouping = liveOverlap(state);
  const excluded = grouping.rows.filter((row) => !row.included).length;

  const bands: Partial<Record<AreaId, number>> = {};
  for (const block of result) bands[block.area] = block.percentage;

  return (
    <Screen
      title={t('calculated')}
      kicker={`${t('step')} 4/4`}
      cta={{
        label: t('reviewConfirm'),
        muted: headcount === 0 || pool <= 0,
        onClick: () => {
          if (headcount === 0 || pool <= 0) {
            show(t('emptyResultBody'));
            return;
          }
          setConfirmOpen(true);
        },
        secondary: { label: t('adjust'), onClick: () => navigate(-1) },
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

      <BandBar shares={bands} label={t('areaSplit')} />

      {headcount === 0 ? (
        <EmptyState title={t('emptyResult')}>{t('emptyResultBody')}</EmptyState>
      ) : null}

      {result.map((block) => (
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
              {excluded
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
        {t('methodPrefix')}: {t(state.draft.method)}
      </Note>

      <Sheet open={confirmOpen} title={t('confirmSend')} onClose={() => setConfirmOpen(false)}>
        <div className={ui.stackFlush}>
          {[
            { label: t('cPool'), value: money(pool) },
            {
              label: t('cAreas'),
              value: result.map((block) => `${area(block.area)} ${block.percentage}`).join(' · '),
            },
            { label: t('cPeople'), value: String(headcount) },
            { label: t('cRule'), value: t(state.draft.method) },
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
            onClick={() => {
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
            {t('sendTo')} {people(headcount)}
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}
