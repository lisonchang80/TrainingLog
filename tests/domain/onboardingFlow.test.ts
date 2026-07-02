import {
  recommendAppMode,
  shouldShowOnboarding,
} from '../../src/domain/onboarding/onboardingFlow';

describe('onboardingFlow — recommendAppMode (ADR-0029 D5)', () => {
  it('beginner → minimal', () => {
    expect(recommendAppMode('beginner')).toBe('minimal');
  });
  it('experienced → plan', () => {
    expect(recommendAppMode('experienced')).toBe('plan');
  });
});

describe('onboardingFlow — shouldShowOnboarding (ADR-0029 D1)', () => {
  it('fresh install (not completed, no session) → show', () => {
    expect(shouldShowOnboarding({ completed: false, hasAnySession: false })).toBe(true);
  });

  it('completed → never show, even with no data (cleared data must not re-trigger)', () => {
    expect(shouldShowOnboarding({ completed: true, hasAnySession: false })).toBe(false);
  });

  it('existing user upgrading (no flag but has data) → skip (back-fill case)', () => {
    expect(shouldShowOnboarding({ completed: false, hasAnySession: true })).toBe(false);
  });

  it('restored backup already onboarded (flag + data) → skip', () => {
    expect(shouldShowOnboarding({ completed: true, hasAnySession: true })).toBe(false);
  });
});
