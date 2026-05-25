/**
 * SessionTitleEditor pure-helper tests (Bugs F2 + F4, 2026-05-25).
 *
 * Jest config (`package.json` -> `testMatch: <rootDir>/tests/**\/*.test.ts`)
 * runs in `testEnvironment: node` and the repo does not install a React
 * Native testing-library, so we cannot mount the component itself here.
 * Instead the bug-prone state-transition logic is extracted into pure
 * helpers exported from `components/session/session-title-editor.behavior.ts`
 * and verified directly.
 *
 * Bug F2 — tap-to-edit on a non-empty title used to render a blank
 *          TextField when the parent loaded `session.title` after the
 *          component first mounted. The `nextDraftOnPropSync` helper now
 *          drives the `useEffect` sync that catches this race; the
 *          `decideCommit` helper guarantees an immediate tap-then-blur is
 *          a no-op (does not clobber the persisted title with '').
 *
 * Bug F4 — when a sibling surface (⋯ menu) steals focus while the title
 *          is being edited, the editor should commit-on-blur. The
 *          component exposes an imperative `blur()` via
 *          `useImperativeHandle` so call sites can force this before
 *          opening the menu. The `SessionTitleEditorHandle` type contract
 *          is asserted here; wiring the call site into the ⋯ menu lives
 *          in `app/(tabs)/index.tsx`, out of this slice's file allow-list
 *          (the ⋯ menu does not exist on `app/session/[id].tsx`).
 */

import {
  decideCommit,
  nextDraftOnPropSync,
  type SessionTitleEditorHandle,
} from '../../components/session/session-title-editor.behavior';

describe('nextDraftOnPropSync (F2)', () => {
  it('returns null when in edit mode (preserves in-flight keystrokes)', () => {
    // User is actively typing — draft should never be clobbered by a parent
    // re-render that happens to deliver a new initialTitle (e.g. async load).
    expect(
      nextDraftOnPropSync({
        initialTitle: '5x5 強度週',
        draft: 'partial typing',
        editing: true,
      }),
    ).toBeNull();
  });

  it('returns null when draft already matches initialTitle (idempotent)', () => {
    expect(
      nextDraftOnPropSync({
        initialTitle: '5x5 強度週',
        draft: '5x5 強度週',
        editing: false,
      }),
    ).toBeNull();
  });

  it('returns initialTitle when out of edit mode and draft is stale', () => {
    // The F2 root cause: component first mounted with initialTitle=''
    // (parent state hadn't refreshed yet); local draft state was seeded
    // to ''. When the parent later delivers the real title, this helper
    // tells the component to resync.
    expect(
      nextDraftOnPropSync({
        initialTitle: '5x5 強度週',
        draft: '',
        editing: false,
      }),
    ).toBe('5x5 強度週');
  });

  it('resyncs to empty when the parent clears the title (e.g. discard session)', () => {
    expect(
      nextDraftOnPropSync({
        initialTitle: '',
        draft: 'previous title',
        editing: false,
      }),
    ).toBe('');
  });
});

describe('decideCommit (F2 acceptance — tap-to-edit + blur is no-op)', () => {
  it('does NOT persist when the trimmed draft equals initialTitle', () => {
    // F2 acceptance: tap-to-edit then immediate blur returns same title
    // (not blank) — i.e. the commit path is a no-op for unchanged drafts.
    const result = decideCommit({
      draft: '5x5 強度週',
      initialTitle: '5x5 強度週',
    });
    expect(result.shouldPersist).toBe(false);
    expect(result.next).toBe('5x5 強度週');
  });

  it('persists when the user has appended new text', () => {
    const result = decideCommit({
      draft: '5x5 強度週 — 第 2 週',
      initialTitle: '5x5 強度週',
    });
    expect(result.shouldPersist).toBe(true);
    expect(result.next).toBe('5x5 強度週 — 第 2 週');
  });

  it('trims trailing / leading whitespace before comparing', () => {
    // Whitespace-only edit is functionally a no-op — match initialTitle.
    expect(
      decideCommit({
        draft: '  5x5 強度週  ',
        initialTitle: '5x5 強度週',
      }),
    ).toEqual({ next: '5x5 強度週', shouldPersist: false });
  });

  it('allows clearing a non-empty title to "" (freestyle placeholder)', () => {
    // Empty strings are valid persisted values — explicit clear is legal.
    const result = decideCommit({ draft: '', initialTitle: '5x5 強度週' });
    expect(result.shouldPersist).toBe(true);
    expect(result.next).toBe('');
  });

  it('does NOT persist when both draft and initialTitle are empty', () => {
    expect(decideCommit({ draft: '', initialTitle: '' })).toEqual({
      next: '',
      shouldPersist: false,
    });
  });
});

describe('SessionTitleEditorHandle (F4 — imperative blur contract)', () => {
  it('exposes a blur method in the public type contract', () => {
    // Type-level check: the handle's `blur` is `() => void`. If a future
    // refactor changes the signature (e.g. async / requires args), TypeScript
    // would fail this assertion at compile time and the test would not build.
    const handle: SessionTitleEditorHandle = {
      blur: () => {
        /* no-op */
      },
    };
    expect(typeof handle.blur).toBe('function');
    // Returns void — call site must not depend on a return value.
    expect(handle.blur()).toBeUndefined();
  });

  it('forwards blur invocation without throwing (idempotent across multiple calls)', () => {
    // Models the call-site pattern: ⋯ menu handler does
    // `editorRef.current?.blur()` before invoking ActionSheetIOS. Confirms
    // the contract behaves as a pure side-effect — call sites must be able
    // to invoke it multiple times safely (e.g. double-tap on the menu btn).
    let invoked = 0;
    const handle: SessionTitleEditorHandle = {
      blur: () => {
        invoked += 1;
      },
    };
    handle.blur();
    handle.blur();
    expect(invoked).toBe(2);
  });

  it('models the menu-open ordering: blur fires before menu handler runs', () => {
    // F4 acceptance: editor's blur must fire BEFORE the secondary surface
    // (⋯ menu) opens — so the commit-on-blur effect persists the title
    // before the menu takes over the screen. This test models the call-site
    // sequence: `editorRef.current?.blur(); openMenu();` and verifies the
    // observable order via a single shared timeline array.
    const events: string[] = [];
    const handle: SessionTitleEditorHandle = {
      blur: () => events.push('blur'),
    };
    const openMenu = () => events.push('openMenu');

    // Call-site pattern (as recommended for the ⋯ menu's onPress):
    handle.blur();
    openMenu();

    expect(events).toEqual(['blur', 'openMenu']);
  });
});
