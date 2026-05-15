import { describe, it, expect } from 'vitest'
import { shouldRedirectToOnboarding } from '../onboardingGuard.js'

describe('shouldRedirectToOnboarding', () => {
  it('redirects when onboarding is needed and not dismissed', () => {
    expect(shouldRedirectToOnboarding(true, '/pipeline', false)).toBe(true)
  })

  it('does NOT redirect when dismissed flag is set — regression: stale needsOnboarding state', () => {
    // This is the bug Taylor hit: finish() sets dismissed=true and navigates,
    // but the React state (needsOnboarding=true) never updates in the same render.
    // The guard must honour the localStorage flag even when state is stale.
    expect(shouldRedirectToOnboarding(true, '/pipeline', true)).toBe(false)
  })

  it('does not redirect when onboarding is not needed regardless of dismissed flag', () => {
    expect(shouldRedirectToOnboarding(false, '/pipeline', false)).toBe(false)
    expect(shouldRedirectToOnboarding(false, '/pipeline', true)).toBe(false)
  })

  it('does not redirect when already on a /welcome path', () => {
    expect(shouldRedirectToOnboarding(true, '/welcome/resume', false)).toBe(false)
    expect(shouldRedirectToOnboarding(true, '/welcome/welcome', false)).toBe(false)
  })

  it('does not redirect when on /login', () => {
    expect(shouldRedirectToOnboarding(true, '/login', false)).toBe(false)
  })
})
