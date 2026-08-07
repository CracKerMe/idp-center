/**
 * Post-login navigation helpers.
 *
 * Two problems live here, both specific to the moment a login completes:
 *
 * 1. The router's `context.user` is React state owned by App.tsx. Calling `setUser()`
 *    and then navigating in the same tick means route guards still observe the *old*
 *    (null) user, bounce to /login, and by the time that guard runs the URL has already
 *    moved on — so `search.redirect` is gone and the user lands on "/". Doing a real
 *    document load instead lets App re-bootstrap the user from localStorage before any
 *    guard runs, which removes the stale-context window entirely.
 *
 * 2. When MFA enrollment is required we divert to /profile, which would otherwise
 *    discard a pending OAuth /authorize request. We park it here and resume once a
 *    factor is actually enrolled.
 */

const PENDING_REDIRECT_KEY = 'pending_post_login_redirect';

/** Only same-origin, path-absolute targets — never "//evil.com" or an absolute URL. */
export function isSafeRedirect(target: string | undefined | null): target is string {
  return !!target && target.startsWith('/') && !target.startsWith('//');
}

/**
 * Navigate via a full document load rather than a router transition.
 *
 * `location.replace` with a different path already triggers a full document load,
 * so no explicit reload() is needed here.
 */
export function hardNavigate(target: string): void {
  window.location.replace(target);
}

export function setPendingRedirect(target: string | undefined | null): void {
  if (isSafeRedirect(target)) sessionStorage.setItem(PENDING_REDIRECT_KEY, target);
}

/** Reads and clears the parked target — resuming it is a one-shot operation. */
export function takePendingRedirect(): string | null {
  const target = sessionStorage.getItem(PENDING_REDIRECT_KEY);
  sessionStorage.removeItem(PENDING_REDIRECT_KEY);
  return isSafeRedirect(target) ? target : null;
}
