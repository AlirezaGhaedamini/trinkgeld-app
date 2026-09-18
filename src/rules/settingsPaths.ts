/**
 * Where the Settings subtree begins and ends — the one rule the leave warning
 * and the editor's lifetime both depend on.
 *
 * Pure and exported so the offline check drives the same function the app
 * does. The prefix test needs the slash: "/manager/settingsx" is not Settings,
 * and a warning that fires (or stays silent) on the wrong page is worse than
 * none.
 */

const ROOTS = [
  '/manager/settings',
  // Only redirects into Settings, so following one is not leaving it.
  '/manager/rules',
];

/** True for Settings, anything beneath it, and the old paths that lead into it. */
export function insideSettings(pathname: string): boolean {
  return ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/**
 * The screens under Settings that save straight to the workplace — areas,
 * roles, the workplace's own settings — each through a hook of its own. When
 * the manager comes back from one, the rules are read again so the names and
 * areas on screen are current.
 */
export function savesElsewhere(pathname: string): boolean {
  return ['/manager/settings/areas', '/manager/settings/roles', '/manager/settings/workplace'].some(
    (page) => pathname === page || pathname.startsWith(`${page}/`),
  );
}
