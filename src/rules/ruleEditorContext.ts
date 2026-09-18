import { createContext, type Dispatch, type SetStateAction } from 'react';

import type { ScreenCta } from '@/components/layout/Screen';
import type { useRules } from '@/rules/useRules';
import type { AreaShare, OverlapBasis, RuleMethod, RuleVersion } from '@/rules/types';

/**
 * What every screen under Settings shares: one rules hook, and one working copy
 * of the rule the manager is looking at.
 *
 * The working copy is the six values the single Rules screen used to hold in
 * its own state — shares, overlap basis, method, minimum overlap, rounding
 * area, confirmation — seeded from the version on screen. It is not a second
 * source of truth: it is written to the database only by `saveAndActivate()`,
 * as one patch, exactly as before. See RuleEditorProvider for why it must not
 * be written any earlier, and for how long it lives.
 */
export interface RuleEditorValue {
  /** The one rules hook the whole Settings area shares: one fetch, one busy flag. */
  rules: ReturnType<typeof useRules>;
  active: RuleVersion | null;
  draft: RuleVersion | null;
  /** The version on screen: the draft while one is open, otherwise the active one. */
  shown: RuleVersion | null;
  /** True while a draft is open. Every control is read-only otherwise. */
  editing: boolean;

  shares: Record<string, number>;
  setShares: Dispatch<SetStateAction<Record<string, number>>>;
  basis: OverlapBasis;
  setBasis: Dispatch<SetStateAction<OverlapBasis>>;
  method: RuleMethod;
  setMethod: Dispatch<SetStateAction<RuleMethod>>;
  minOverlap: number;
  setMinOverlap: Dispatch<SetStateAction<number>>;
  roundingAreaId: string | null;
  setRoundingAreaId: Dispatch<SetStateAction<string | null>>;
  ack: boolean;
  setAck: Dispatch<SetStateAction<boolean>>;

  /** The areas the pool can pay, from the version on screen. */
  poolAreas: AreaShare[];
  /** Every area, with the working copy's percentages applied. */
  liveShares: AreaShare[];
  /** True when the working copy's pool shares total exactly 100. */
  balanced: boolean;
  /** The running total in words: "Adds up", or how much is missing or over. */
  hint: string;
  /** Members whose default area the working copy gives nothing to. */
  stranded: { count: number; areaNames: string[] };
  /** An area's name, or a dash for none. */
  areaName: (areaId: string | null) => string;
  /** What a control says when it is pressed with no draft open. */
  nudge: () => void;
  /**
   * The Settings overview's bottom button — the only place a draft is
   * activated or discarded: "Edit the rules" with no draft, "Activate these
   * rules" and "Discard the draft" with one. Undefined until loaded.
   */
  cta: ScreenCta | undefined;
  /**
   * A rule section's bottom button: "Edit the rules" while no draft is open,
   * so a section is never a dead end, and nothing at all once one is — a
   * section only edits its part of the draft.
   */
  editCta: ScreenCta | undefined;
}

export const RuleEditorContext = createContext<RuleEditorValue | null>(null);
