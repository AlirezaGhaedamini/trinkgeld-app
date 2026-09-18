import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import type { ScreenCta } from '@/components/layout/Screen';
import { useLeaveGuard } from '@/components/layout/useLeaveGuard';
import { Button } from '@/components/ui/Button';
import { Note } from '@/components/ui/Note';
import { Sheet } from '@/components/ui/Sheet';
import { useI18n } from '@/hooks/useI18n';
import { useToast } from '@/hooks/useToast';
import { RULE_FAILURE_KEY } from '@/rules/errors';
import { RuleEditorContext, type RuleEditorValue } from '@/rules/ruleEditorContext';
import { insideSettings, savesElsewhere } from '@/rules/settingsPaths';
import {
  allocated as sumShares,
  strandedMembers,
  type AreaShare,
  type DraftPatch,
  type OverlapBasis,
  type RuleMethod,
  type RuleVersion,
} from '@/rules/types';
import { useRules } from '@/rules/useRules';
import ui from '@/components/ui/ui.module.css';

/**
 * The rules editor behind Settings — a layout route around the WHOLE Settings
 * subtree, so it stays mounted while the manager moves anywhere inside it.
 *
 * WHY IT SITS ABOVE THE ROUTES
 * The editor was one long screen, and the manager's unactivated changes were
 * that screen's own state. Split into a screen per section — and with areas,
 * roles, the workplace settings and the period close beside them — the same
 * state has to outlive every step between them. React keeps a layout route's
 * element mounted across its child routes, so it lives here, once: the
 * overview, the six rule sections and those four screens all see one working
 * copy of one draft, and moving between them loses nothing.
 *
 * WHY CHANGES ARE NOT WRITTEN TO THE DRAFT AS THEY ARE MADE
 * That would be the obvious way to make them last, and it would change what a
 * rule means. Step 2 of the distribution wizard calls create_rule_draft(),
 * which hands back the workplace's EXISTING draft when one is open, writes its
 * shares onto it and activates it (saveAreaShares in distribution/queries.ts).
 * A draft already carrying a method or overlap change the manager had not
 * activated would go live with the next distribution, under the wizard's name.
 * So nothing reaches the database until saveAndActivate() — the draft write and
 * the activation in one go — exactly as on the single Rules screen.
 *
 * WHEN THE WORKING COPY IS RESET
 * Only when the version on screen becomes a different version: a draft is
 * opened, activated or discarded. Reading the rules again — after the manager
 * renamed an area or changed a role's points — does not reset it, so a change
 * waiting in one section survives a trip to Areas and back. An area added in
 * the meantime simply starts at 0%, and one taken out of the pool drops out of
 * the shares, exactly as the engine would treat it.
 *
 * LEAVING
 * Leaving the Settings subtree unmounts this provider, and with it the changes.
 * While any are waiting, the move is held (useLeaveGuard) and the manager is
 * asked first. "Discard changes" lets go of the working copy only: the draft
 * row stays open, as it always did when the manager left the Rules screen, and
 * deleting it stays the overview's "Discard the draft".
 */
export function RuleEditorProvider() {
  const rules = useRules();
  const { t, percent } = useI18n();
  const { show } = useToast();
  const { pathname } = useLocation();

  const state = rules.state;
  const active = state?.active ?? null;
  const draft = state?.draft ?? null;

  /** The version on screen: the draft while one is open, otherwise the active one. */
  const shown = draft ?? active;
  const editing = Boolean(draft);

  const [shares, setShares] = useState<Record<string, number>>({});
  const [basis, setBasis] = useState<OverlapBasis>('longest_shift');
  const [method, setMethod] = useState<RuleMethod>('hours_points');
  const [minOverlap, setMinOverlap] = useState(15);
  const [roundingAreaId, setRoundingAreaId] = useState<string | null>(null);
  const [ack, setAck] = useState(true);

  const seedFrom = useCallback((version: RuleVersion) => {
    const next: Record<string, number> = {};
    for (const share of version.shares) next[share.areaId] = share.percentage;
    setShares(next);
    setBasis(version.overlapBasis);
    setMethod(version.method);
    setMinOverlap(version.minOverlapMinutes);
    setRoundingAreaId(version.roundingAreaId);
    setAck(version.acknowledgementRequired);
  }, []);

  /* Seeded once per version: a version is its row and its status, so opening a
     draft (new row), activating it (same row, now active) and discarding it
     (back to the active row) each seed again, and a plain re-read does not. A
     layout effect rather than a plain one: the overview prints these values
     as summaries, and a plain effect would paint one frame of the old ones. */
  const seededKey = useRef<string | null>(null);
  const shownKey = shown ? `${shown.id}:${shown.status}` : null;
  useLayoutEffect(() => {
    if (!shown || !shownKey || seededKey.current === shownKey) return;
    seededKey.current = shownKey;
    seedFrom(shown);
  }, [shown, shownKey, seedFrom]);

  /* Back from a screen that saved to the workplace directly: read again. */
  const previousPath = useRef(pathname);
  const refresh = rules.refresh;
  useEffect(() => {
    const from = previousPath.current;
    previousPath.current = pathname;
    if (from !== pathname && savesElsewhere(from)) void refresh();
  }, [pathname, refresh]);

  const poolAreas = useMemo(
    () => (shown?.shares ?? []).filter((s) => s.isPoolEligible),
    [shown],
  );

  const liveShares: AreaShare[] = useMemo(
    () =>
      (shown?.shares ?? []).map((s) => ({
        ...s,
        percentage: s.isPoolEligible ? (shares[s.areaId] ?? 0) : 0,
      })),
    [shown, shares],
  );

  const total = sumShares(liveShares);
  const balanced = total === 100;
  const stranded = strandedMembers(state?.members ?? [], liveShares);

  /* Changes waiting to be activated: the working copy differs from the draft
     it was seeded from. Only once seeded for THIS version — in the one render
     between a new version arriving and its seeding, the copy still holds the
     previous version's values, and that is not a change anybody made. */
  const dirty =
    editing &&
    shown !== null &&
    seededKey.current === shownKey &&
    (basis !== shown.overlapBasis ||
      method !== shown.method ||
      minOverlap !== shown.minOverlapMinutes ||
      roundingAreaId !== shown.roundingAreaId ||
      ack !== shown.acknowledgementRequired ||
      shown.shares.some((s) => s.isPoolEligible && (shares[s.areaId] ?? 0) !== s.percentage));

  const guard = useLeaveGuard(dirty, insideSettings);

  const patch = (): DraftPatch => ({
    method,
    minOverlapMinutes: minOverlap,
    overlapBasis: basis,
    roundingAreaId,
    acknowledgementRequired: ack,
    shares: liveShares.map((s) => ({
      areaId: s.areaId,
      areaKey: s.areaKey,
      percentage: s.percentage,
    })),
  });

  const openDraft = async () => {
    const result = await rules.openDraft();
    if (!result.ok) show(t(RULE_FAILURE_KEY[result.failure ?? 'unknown']));
  };

  const activate = async () => {
    if (!draft) return;
    if (!balanced) {
      show(t('dErrShares'));
      return;
    }
    const result = await rules.saveAndActivate(draft.id, patch());
    if (!result.ok) {
      show(t(RULE_FAILURE_KEY[result.failure ?? 'unknown']));
      return;
    }
    show(`${t('ruleActivated')} · ${t('ruleVersion')} ${result.value ?? ''}`.trim());
  };

  const discard = async () => {
    if (!draft) return;
    const result = await rules.discardDraft(draft.id);
    show(result.ok ? t('ruleDiscarded') : t(RULE_FAILURE_KEY[result.failure ?? 'unknown']));
  };

  const hint = balanced
    ? t('hintOK')
    : total < 100
      ? `${percent(100 - total)} ${t('hintUnder')}`
      : `${percent(total - 100)} ${t('hintOver')}`;

  const editCta: ScreenCta = {
    label: t('ruleEdit'),
    muted: rules.busy,
    onClick: () => void openDraft(),
  };

  const cta: ScreenCta = editing
    ? {
        label: t('ruleActivateCta'),
        muted: !balanced || rules.busy,
        note: hint,
        noteColor: balanced ? 'var(--color-accent)' : 'var(--color-text)',
        onClick: () => (balanced ? void activate() : show(hint)),
        secondary: { label: t('ruleDiscard'), onClick: () => void discard() },
      }
    : editCta;

  const ready = rules.status === 'ready';

  const value: RuleEditorValue = {
    rules,
    active,
    draft,
    shown,
    editing,
    shares,
    setShares,
    basis,
    setBasis,
    method,
    setMethod,
    minOverlap,
    setMinOverlap,
    roundingAreaId,
    setRoundingAreaId,
    ack,
    setAck,
    poolAreas,
    liveShares,
    balanced,
    hint,
    stranded,
    areaName: (areaId) =>
      (shown?.shares ?? []).find((s) => s.areaId === areaId)?.areaName ?? '—',
    nudge: () => show(t('ruleEdit')),
    cta: ready ? cta : undefined,
    editCta: ready && !editing ? editCta : undefined,
  };

  /* Let go of the working copy, then make the move that was held. */
  const discardAndLeave = () => {
    if (shown) seedFrom(shown);
    guard.proceed();
  };

  return (
    <RuleEditorContext.Provider value={value}>
      <Outlet />
      <Sheet open={guard.held} title={t('settingsLeaveTitle')} onClose={guard.stay}>
        <div className={ui.stackTight}>
          <Note>{t('settingsLeaveBody')}</Note>
          <Button onClick={guard.stay}>{t('settingsLeaveStay')}</Button>
          <Button variant="ghost" onClick={discardAndLeave}>
            {t('settingsLeaveDiscard')}
          </Button>
        </div>
      </Sheet>
    </RuleEditorContext.Provider>
  );
}
