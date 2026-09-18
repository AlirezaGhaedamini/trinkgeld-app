import type { ReactNode } from 'react';

import { Screen } from '@/components/layout/Screen';
import { EmptyState } from '@/components/ui/EmptyState';
import { useI18n } from '@/hooks/useI18n';
import { useRuleEditor } from '@/hooks/useRuleEditor';
import ui from '@/components/ui/ui.module.css';

/**
 * The frame every rule section under Settings shares.
 *
 * A section edits its part of the draft and nothing else. Activating and
 * discarding the draft happen in one place, the Settings overview, where every
 * pending change is in view at once — so a section carries no such button.
 * With no draft open it offers "Edit the rules", so a read-only section is
 * never a dead end.
 *
 * The pool screen alone keeps a note in the bottom bar: the running total the
 * sliders change ("10% still unassigned"), in view however far the list is
 * scrolled, as it was above the single Rules screen's button.
 *
 * The kicker names the version on screen, so a section read on its own is
 * never mistaken for the rules in force while a draft is open. The back arrow
 * falls back to Settings when the section was opened straight from a link.
 *
 * The content always sits in a stack rather than straight in the screen body.
 * The body is a fixed-height flex column; a clipped card placed directly in it
 * has an automatic minimum height of zero, and on a short screen — a phone
 * turned sideways — it would take all of the shrinking and collapse to a line.
 */
export function RuleSectionScreen({
  title,
  sharesInView = false,
  children,
}: {
  title: string;
  /** True on the pool screen: the running total stays in the bottom bar. */
  sharesInView?: boolean;
  children: ReactNode;
}) {
  const editor = useRuleEditor();
  const { t } = useI18n();
  const { rules, editing, active, shown } = editor;

  if (rules.status === 'error') {
    return (
      <Screen title={title} backTo="/manager/settings">
        <EmptyState title={t('authNetwork')} />
      </Screen>
    );
  }

  const kicker = editing
    ? t('ruleDraftTitle')
    : active
      ? `${t('ruleActive')} · ${t('ruleVersion')} ${active.version ?? ''}`.trim()
      : undefined;

  return (
    <Screen
      title={title}
      kicker={kicker}
      backTo="/manager/settings"
      cta={editor.editCta}
      footnote={
        sharesInView && editing
          ? {
              text: editor.hint,
              color: editor.balanced ? 'var(--color-accent)' : 'var(--color-text)',
            }
          : undefined
      }
    >
      {/* "Loading" only before the first answer. Every write reloads the
          rules, and blanking the section on each of those would throw the
          manager to the top of a screen the single Rules screen kept in
          place; only the button waits, as it did. */}
      {!rules.state ? (
        <EmptyState title={t('dLoading')} />
      ) : !shown ? (
        /* No version and no draft: say so, as the overview does, rather than
           present starting values as if they were a rule. */
        <EmptyState title={t('ruleNoActive')} />
      ) : (
        <div className={ui.stackTight}>{children}</div>
      )}
    </Screen>
  );
}
