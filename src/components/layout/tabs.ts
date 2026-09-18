/**
 * Which tab a route belongs to, and whether the tab bar is under the screen.
 *
 * WHY THIS EXISTS
 * The tab bar used to render on four manager routes only, so "which tab am I
 * in" never had to answer for anything but those four exact paths. Now that the
 * bar stays under the manager's pushed screens as well — a distribution, a
 * member, a settings subpage, the period close — the question is real: a manager
 * reading a distribution is in History, and a manager inviting somebody is in
 * Team, and neither pathname starts with the tab's own path.
 *
 * The rule is a table rather than a `startsWith` chain because the two are not
 * the same thing: `/manager/sent/<id>` is a distribution and belongs to History
 * although it shares no prefix with it, and `/manager` must NOT swallow every
 * path beneath it. Keeping it here, pure and exported, means the offline check
 * drives the same function the bar does.
 */

/** Longest-prefix wins, so `/manager/settings/period` beats `/manager/settings`. */
interface TabRule {
  /** The pathname, or the pathname prefix, this rule matches. */
  match: string;
  /** True when only an exact match counts — `/manager` must not claim its children. */
  exact?: boolean;
  /** The tab's own route, i.e. the `to` of the tab that lights up. */
  tab: string;
}

const MANAGER_RULES: readonly TabRule[] = [
  { match: '/manager', exact: true, tab: '/manager' },
  // Everything the dashboard launches reads as Overview: these are the
  // manager's operational screens, not a section of their own.
  { match: '/manager/hours', tab: '/manager' },
  { match: '/manager/reports', tab: '/manager' },
  { match: '/manager/overlap', tab: '/manager' },
  // A distribution, whichever door it was opened through. The sent
  // confirmation is a distribution too, so it belongs to the same tab.
  { match: '/manager/distributions', tab: '/manager/distributions' },
  { match: '/manager/sent', tab: '/manager/distributions' },
  // People.
  { match: '/manager/team', tab: '/manager/team' },
  { match: '/manager/invite', tab: '/manager/team' },
  // Configuration, including every subpage of it. The account screen is
  // shared with the employee shell but a manager only ever arrives there from
  // the Settings tab (SettingsPage's account card), so that is where they
  // still are.
  { match: '/manager/settings', tab: '/manager/settings' },
  { match: '/profile', tab: '/manager/settings' },
  // The inbox is one page for both roles. A manager opens it from the bell in
  // the Overview header, so Overview is the honest answer for them.
  { match: '/notifications', tab: '/manager' },
  // The wizard deliberately shows no tab bar (see src/router.tsx), so it has
  // no rule: nothing to light up, and nothing claiming to.
];

const EMPLOYEE_RULES: readonly TabRule[] = [
  { match: '/home', tab: '/home' },
  // The rejected-shift deep link is /hours?shift=<id>. A query string is not
  // part of the pathname, so it needs no rule of its own and cannot get one
  // wrong: the person is on the hours screen either way.
  { match: '/hours', tab: '/hours' },
  { match: '/history', tab: '/history' },
  // A share is the detail of a history row, whichever screen opened it.
  { match: '/payout', tab: '/history' },
  // Reporting the night's tips is launched from Home's own card.
  { match: '/report', tab: '/home' },
  // Account, and the language screen beneath it.
  { match: '/profile', tab: '/profile' },
  // Same page as the manager's inbox, reached from the bell in Home's header.
  { match: '/notifications', tab: '/home' },
];

/**
 * The tab that should read as active for a pathname, or null when none does.
 *
 * Null is a real answer, not a failure: a screen outside the tabbed area has no
 * section, and lighting one up would be a claim about where the person is that
 * is not true.
 */
export function activeTabFor(pathname: string, role: 'manager' | 'employee'): string | null {
  const rules = role === 'manager' ? MANAGER_RULES : EMPLOYEE_RULES;
  let best: TabRule | null = null;

  for (const rule of rules) {
    const hit = rule.exact
      ? pathname === rule.match
      : pathname === rule.match || pathname.startsWith(`${rule.match}/`);
    if (!hit) continue;
    if (!best || rule.match.length > best.match.length) best = rule;
  }

  return best ? best.tab : null;
}
