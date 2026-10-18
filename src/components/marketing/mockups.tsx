import type { ReactNode } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { BandBar } from '@/components/ui/BandBar';
import { HeroCard } from '@/components/ui/HeroCard';
import { Icon, type IconName } from '@/components/ui/Icon';
import { StatCard } from '@/components/ui/StatCard';
import styles from '@/components/marketing/marketing.module.css';
import { useI18n } from '@/hooks/useI18n';
import type { StringKey } from '@/i18n/strings';

/**
 * Product compositions for the marketing page.
 *
 * Built from the app's own primitives — HeroCard, BandBar, StatCard, Avatar,
 * Badge — and its tokens, so the page shows what TipCrew actually looks like
 * rather than a drawing of it. They are pictures, not UI: every composition is
 * one `role="img"` with a label, its insides are presentational, and nothing in
 * them is focusable or clickable. All names and amounts are invented sample
 * data; none of it is read from the database or from the demo state.
 */

const AREA = {
  service: 'var(--color-area-service)',
  bar: 'var(--color-area-bar)',
  kitchen: 'var(--color-area-kitchen)',
};

/** The rounded device frame the phone compositions sit in. */
export function Phone({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className={styles.phone} role="img" aria-label={label}>
      <div className={styles.phoneScreen}>
        <div className={styles.phoneIsland} />
        {children}
      </div>
    </div>
  );
}

function Person({
  name,
  meta,
  hours,
  amount,
}: {
  name: string;
  meta: string;
  hours: string;
  amount: string;
}) {
  return (
    <div className={styles.person}>
      <Avatar name={name} size={32} tinted />
      <div>
        <div className={styles.personName}>{name}</div>
        <div className={styles.personMeta}>{meta}</div>
      </div>
      <div className={`${styles.personAmount} tabular`}>
        {amount}
        <span className={styles.personHours}>{hours}</span>
      </div>
    </div>
  );
}

function Legend() {
  const { t } = useI18n();
  const items: Array<{ key: StringKey; color: string; pct: number }> = [
    { key: 'areaService', color: AREA.service, pct: 60 },
    { key: 'areaBar', color: AREA.bar, pct: 25 },
    { key: 'areaKitchen', color: AREA.kitchen, pct: 15 },
  ];
  return (
    <div className={styles.legend}>
      {items.map((item) => (
        <span key={item.key} className={styles.legendItem}>
          <span className={styles.dot} style={{ background: item.color }} />
          {t(item.key)} {item.pct}%
        </span>
      ))}
    </div>
  );
}

const BANDS = [
  { id: 'service', weight: 60, color: AREA.service },
  { id: 'bar', weight: 25, color: AREA.bar },
  { id: 'kitchen', weight: 15, color: AREA.kitchen },
];

/** Hero: a sent distribution for one evening, with two status cards. */
export function HeroComposition() {
  const { t, money, hours } = useI18n();
  return (
    <div className={styles.heroVisual}>
      <div className={styles.heroDisc} aria-hidden />
      <Phone label={t('mkVisualLabel')}>
        <div className={styles.phoneHeader}>
          <span className={styles.phoneTitle}>{t('mkMockEvening')}</span>
          <Badge>{t('mkMockSent')}</Badge>
        </div>
        <div className={styles.mockStack}>
          <HeroCard kicker={t('mkMockPool')} amount={money(486)} meta={t('mkMockPeople')} compact />
          <div>
            <BandBar bands={BANDS} height={8} />
            <Legend />
          </div>
          <div className={styles.personList}>
            <Person
              name="Lena Hoffmann"
              meta={`${t('areaService')} · ${t('rServer')}`}
              hours={hours(6.5)}
              amount={money(84.2)}
            />
            <Person
              name="Jonas Weber"
              meta={`${t('areaBar')} · ${t('rBartender')}`}
              hours={hours(7)}
              amount={money(60.75)}
            />
            <Person
              name="Aylin Demir"
              meta={`${t('areaKitchen')} · ${t('rCook')}`}
              hours={hours(6)}
              amount={money(36.45)}
            />
          </div>
        </div>
      </Phone>
      <div className={`${styles.float} ${styles.floatA}`} aria-hidden>
        <span className={styles.floatIcon}>
          <Icon name="check" size={15} />
        </span>
        {t('mkMockApproved')}
      </div>
      <div className={`${styles.float} ${styles.floatB} ${styles.floatGold}`} aria-hidden>
        <span className={styles.floatIcon}>
          <Icon name="shield-check" size={15} />
        </span>
        {t('mkMockRuleActive')}
      </div>
    </div>
  );
}

/* ── the four small visuals under "How it works" ────────────────────────── */

export function StepRulesVisual() {
  const { t } = useI18n();
  const rows: Array<{ key: StringKey; color: string; pct: number }> = [
    { key: 'areaService', color: AREA.service, pct: 60 },
    { key: 'areaBar', color: AREA.bar, pct: 25 },
    { key: 'areaKitchen', color: AREA.kitchen, pct: 15 },
  ];
  return (
    <div className={styles.stepVisual} aria-hidden>
      {rows.map((row) => (
        <div key={row.key} className={styles.miniRow}>
          <span>{t(row.key)}</span>
          <span className={styles.miniTrack}>
            <span className={styles.miniFill} style={{ width: `${row.pct}%`, background: row.color }} />
          </span>
          <span className={`${styles.miniValue} tabular`}>{row.pct}%</span>
        </div>
      ))}
    </div>
  );
}

export function StepShiftVisual() {
  const { t } = useI18n();
  return (
    <div className={styles.stepVisual} aria-hidden>
      <div className={styles.miniLine}>
        <Icon name="clock" size={16} color="var(--color-accent)" />
        <span className={`${styles.grow} tabular`}>{t('mkMockShift')}</span>
      </div>
      <div className={styles.miniLine}>
        <Avatar name="Lena Hoffmann" size={24} tinted />
        <span className={styles.grow}>Lena</span>
        <Badge>{t('shStatusApproved')}</Badge>
      </div>
    </div>
  );
}

export function StepCalcVisual() {
  const { t, money } = useI18n();
  return (
    <div className={styles.stepVisual} aria-hidden>
      <div className={styles.miniMuted}>{t('mkMockPool')}</div>
      <div className={`${styles.miniAmount} tabular`}>{money(486)}</div>
      <div style={{ marginTop: 10 }}>
        <BandBar bands={BANDS} height={6} />
      </div>
    </div>
  );
}

export function StepShareVisual() {
  const { t, money } = useI18n();
  return (
    <div className={styles.stepVisual} aria-hidden>
      <div className={styles.miniLine}>
        <Avatar name="Lena Hoffmann" size={32} tinted />
        <span className={styles.grow}>
          <span className={styles.miniMuted}>{t('mkMockYourShare')}</span>
          <br />
          <strong className="tabular" style={{ color: 'var(--color-money)', fontSize: 18 }}>
            {money(84.2)}
          </strong>
        </span>
        <Icon name="check-circle" fill size={22} color="var(--color-money)" />
      </div>
    </div>
  );
}

/* ── rules builder ──────────────────────────────────────────────────────── */

export function RulesMock() {
  const { t, duration } = useI18n();
  const areas: Array<{ key: StringKey; color: string; pct: number }> = [
    { key: 'areaService', color: AREA.service, pct: 60 },
    { key: 'areaBar', color: AREA.bar, pct: 25 },
    { key: 'areaKitchen', color: AREA.kitchen, pct: 15 },
  ];
  return (
    <div className={styles.mockPanel}>
      <div className={styles.mockCard} role="img" aria-label={t('mkRulesTitle')}>
        <div className={styles.mockCardHead}>
          <div>
            <div className={styles.mockLabel}>{t('methodPrefix')}</div>
            <div className={styles.mockCardTitle}>{t('mPoints')}</div>
          </div>
          <Badge>{t('mkMockVersion')}</Badge>
        </div>
        <div style={{ paddingBlock: 8, boxShadow: 'var(--shadow-row)' }}>
          {areas.map((area) => (
            <div key={area.key} className={styles.areaRow}>
              <span className={styles.dot} style={{ background: area.color }} />
              <span>{t(area.key)}</span>
              <strong className="tabular">{area.pct}%</strong>
              <span className={styles.areaBar}>
                <span
                  className={styles.areaBarFill}
                  style={{ width: `${area.pct}%`, background: area.color }}
                />
              </span>
            </div>
          ))}
        </div>
        <MockRow icon="hourglass-medium" label={t('minOverlapRule')} value={duration(60)} />
        <MockRow icon="money" label={t('mkMockRounding')} value={t('areaService')} />
        <div className={styles.mockRow}>
          <Icon name="users-three" size={18} color="var(--color-accent)" />
          <span>{t('mkMockConfirm')}</span>
          <span className={styles.fakeToggle} />
        </div>
      </div>
    </div>
  );
}

function MockRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className={styles.mockRow}>
      <Icon name={icon} size={18} color="var(--color-accent)" />
      <span>{label}</span>
      <span className={`${styles.mockRowValue} tabular`}>{value}</span>
    </div>
  );
}

/* ── manager dashboard ──────────────────────────────────────────────────── */

export function ManagerMock() {
  const { t, money, hours } = useI18n();
  const team: Array<{ name: string; meta: string; status: StringKey; approved: boolean }> = [
    { name: 'Lena H.', meta: `${t('areaService')} · ${hours(6.5)}`, status: 'shStatusApproved', approved: true },
    { name: 'Jonas W.', meta: `${t('areaBar')} · ${hours(7)}`, status: 'shStatusApproved', approved: true },
    { name: 'Mira K.', meta: `${t('areaBar')} · ${hours(5.5)}`, status: 'shStatusSubmitted', approved: false },
  ];
  return (
    <div className={styles.mockPanel} role="img" aria-label={t('mkManagerTitle')}>
      <div className={styles.statPair}>
        <StatCard label={t('mkMockHoursToReview')} value="4" valueColor="var(--color-accent)" />
        <StatCard label={t('mkMockOpenPool')} value={money(312.5)} valueColor="var(--color-money)" />
      </div>
      <div className={styles.mockCard}>
        {team.map((member) => (
          <div key={member.name} className={styles.mockRow}>
            <Avatar name={member.name} size={34} tinted />
            <div className={styles.grow}>
              <div style={{ fontWeight: 600 }}>{member.name}</div>
              <div className={styles.mockLabel}>{member.meta}</div>
            </div>
            <Badge tone={member.approved ? 'tint' : 'quiet'}>{t(member.status)}</Badge>
          </div>
        ))}
      </div>
      <div className={styles.mockOffset}>
        <div className={styles.mockCard}>
          <div className={styles.mockRow}>
            <span className={styles.iconBox} style={{ width: 34, height: 34, borderRadius: 10 }}>
              <Icon name="user-plus" size={17} />
            </span>
            <div className={styles.grow}>
              <div style={{ fontWeight: 600 }}>{t('mkMockInvite')}</div>
              <div className={styles.mockLabel}>
                Mira · {t('areaBar')} · {t('rBartender')}
              </div>
            </div>
            <Icon name="paper-plane-tilt" size={18} color="var(--color-accent)" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── employee home ──────────────────────────────────────────────────────── */

export function EmployeeMock() {
  const { t, money, hours, dateLabel } = useI18n();
  return (
    <div className={styles.heroVisual}>
      <div className={styles.heroDisc} aria-hidden />
      <Phone label={t('mkTeamTitle')}>
        <div className={styles.mockStack}>
          <div className={styles.notif}>
            <Icon name="bell" size={18} color="var(--color-accent)" />
            {t('mkMockNotif')}
          </div>
          <HeroCard
            kicker={t('mkMockYourShare')}
            amount={money(84.2)}
            meta={`${hours(6.5)} · ${t('areaService')} · ${t('rServer')}`}
            pill={
              <>
                <Icon name="check-circle" size={14} /> {t('mkMockApproved')}
              </>
            }
            compact
          />
          <div className={styles.personList}>
            <HistoryRow when={dateLabel('sat22')} hoursText={hours(6.5)} amount={money(84.2)} />
            <HistoryRow when={dateLabel('fri21')} hoursText={hours(5)} amount={money(61.3)} />
            <HistoryRow when={dateLabel('thu20')} hoursText={hours(4.5)} amount={money(48.9)} />
          </div>
        </div>
      </Phone>
    </div>
  );
}

function HistoryRow({ when, hoursText, amount }: { when: string; hoursText: string; amount: string }) {
  return (
    <div className={styles.person}>
      <span className={styles.iconBox} style={{ width: 32, height: 32, borderRadius: 10 }}>
        <Icon name="calendar-blank" size={16} />
      </span>
      <div>
        <div className={styles.personName}>{when}</div>
        <div className={styles.personMeta}>{hoursText}</div>
      </div>
      <div className={`${styles.personAmount} tabular`}>{amount}</div>
    </div>
  );
}

/* ── a distribution record and its correction ───────────────────────────── */

export function HistoryMock() {
  const { t, money, duration } = useI18n();
  return (
    <div className={styles.mockPanel} role="img" aria-label={t('mkHistoryTitle')}>
      <div className={styles.recordStack}>
        <div className={`${styles.mockCard} ${styles.recordOld}`}>
          <div className={styles.mockCardHead}>
            <span className={styles.mockCardTitle}>{t('mkMockRecord')}</span>
            <span className={`${styles.mockRowValue} tabular`}>{money(486)}</span>
          </div>
        </div>
        <div className={styles.chainNote}>
          <Icon name="arrow-counter-clockwise" size={16} />
          {t('mkMockCorrection')}
        </div>
        <div className={styles.mockCard}>
          <div className={styles.mockCardHead}>
            <span className={styles.mockCardTitle}>{t('mkMockRecord')}</span>
            <Badge>{t('mkMockSent')}</Badge>
          </div>
          <MockRow icon="shield-check" label={t('mkMockRuleVersion')} value="v3" />
          <MockRow icon="clock" label={t('mkMockShiftsUsed')} value="8" />
          <MockRow icon="hourglass-medium" label={t('minOverlapRule')} value={duration(60)} />
          <div className={styles.mockRow}>
            <Icon name="money" size={18} color="var(--color-accent)" />
            <span>{t('mkMockPool')}</span>
            <span className={`${styles.mockRowValue} tabular`} style={{ color: 'var(--color-money)' }}>
              {money(486)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── quick hours entry, for the mobile section ──────────────────────────── */

export function HoursEntryMock() {
  const { t, duration } = useI18n();
  return (
    <Phone label={t('mkMobileTitle')}>
      <div className={styles.phoneHeader}>
        <span className={styles.phoneTitle}>{t('mkMockEvening')}</span>
      </div>
      <div className={styles.mockStack}>
        <Field label={t('startT')} value="17:00" />
        <Field label={t('endT')} value="23:30" />
        <Field label={t('breakT')} value={duration(30)} />
        <div className={styles.fakeButton}>
          <Icon name="check" size={18} />
          {t('saveHours')}
        </div>
      </div>
    </Phone>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={`${styles.fieldValue} tabular`}>{value}</span>
    </div>
  );
}
