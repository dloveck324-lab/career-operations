/**
 * Returns true when the router should redirect an authenticated user to the
 * onboarding flow. Extracted as a pure function so it can be unit-tested
 * without a DOM environment.
 *
 * @param needsOnboarding  server-side flag set on app mount (may be stale)
 * @param pathname         current router pathname
 * @param dismissed        whether the user has already completed onboarding
 *                         (localStorage.getItem('onboardingDismissed') === '1')
 */
export function shouldRedirectToOnboarding(
  needsOnboarding: boolean,
  pathname: string,
  dismissed: boolean,
): boolean {
  if (pathname.startsWith('/welcome') || pathname === '/login') return false
  return needsOnboarding && !dismissed
}
