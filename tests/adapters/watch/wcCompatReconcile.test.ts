/**
 * expo-wcsession compat — Phase 2 seq-gap reconciliation tests (issue #54).
 *
 * The compat shim tracks the highest (epoch, seq) actually delivered to JS
 * and heals event-lane deafness by pulling the gap from the native journal.
 * These tests drive the shim against a controllable fake of the clean
 * `index.ts` API: live events, a deaf window (live drops while the journal
 * keeps growing), process restarts (epoch change), and the 5s poll.
 */

type FakeEvt = {
  seq: number;
  epoch: string;
  payload: Record<string, unknown>;
  replyId?: string;
  channel?: 'message' | 'user-info' | 'application-context';
};

type LiveListener = (evt: FakeEvt) => void;

const INDEX_PATH = '../../../modules/expo-wcsession/index';
const COMPAT_PATH = '../../../modules/expo-wcsession/compat';

describe('expo-wcsession compat — seq-gap reconciliation (#54 Phase 2)', () => {
  let journal: FakeEvt[];
  let epoch: string;
  let live: Record<'message' | 'user-info' | 'application-context', Set<LiveListener>>;
  let replySpy: jest.Mock;

  /** Append to the journal AND fire live listeners (the healthy path). */
  function emitLive(channel: FakeEvt['channel'], payload: Record<string, unknown>, replyId?: string): FakeEvt {
    const evt: FakeEvt = {
      seq: (journal[journal.length - 1]?.seq ?? 0) + 1,
      epoch,
      payload,
      ...(replyId !== undefined ? { replyId } : {}),
      channel,
    };
    journal.push(evt);
    for (const cb of live[channel as keyof typeof live]) {
      // Live lane delivers WITHOUT the channel field (mirrors native event body).
      const { channel: _c, ...body } = evt;
      cb(body as FakeEvt);
    }
    return evt;
  }

  function fakeIndexFactory() {
    return {
      getIsPaired: jest.fn().mockResolvedValue(true),
      getIsWatchAppInstalled: jest.fn().mockResolvedValue(true),
      getReachability: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue({}),
      transferUserInfo: jest.fn(),
      updateApplicationContext: jest.fn(),
      replyToMessage: replySpy,
      getLatestSeq: jest.fn(() => ({
        epoch,
        seq: journal[journal.length - 1]?.seq ?? 0,
      })),
      getEventsSince: jest.fn((after: number) => journal.filter((e) => e.seq > after)),
      drainPending: jest.fn(() => []),
      addMessageListener: jest.fn((cb: LiveListener) => {
        live.message.add(cb);
        return () => live.message.delete(cb);
      }),
      addUserInfoListener: jest.fn((cb: LiveListener) => {
        live['user-info'].add(cb);
        return () => live['user-info'].delete(cb);
      }),
      addApplicationContextListener: jest.fn((cb: LiveListener) => {
        live['application-context'].add(cb);
        return () => live['application-context'].delete(cb);
      }),
      addReachabilityListener: jest.fn(() => () => {}),
    };
  }

  // Loaded fresh per test via jest.resetModules so compat module state resets.
  let compat: {
    watchEvents: { addListener: (e: string, h: (...args: unknown[]) => void) => () => void };
    reconcileNow: () => { pulled: number; epochChanged: boolean };
    startReconcilePolling: (ms?: number) => void;
    stopReconcilePolling: () => void;
    __setDebugDropLiveEventsForTests: (d: boolean) => void;
    __resetCompatStateForTests: () => void;
  };

  beforeEach(() => {
    journal = [];
    epoch = 'epoch-A';
    live = { message: new Set(), 'user-info': new Set(), 'application-context': new Set() };
    replySpy = jest.fn();
    jest.resetModules();
    jest.doMock(INDEX_PATH, fakeIndexFactory);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    compat = require(COMPAT_PATH);
  });

  afterEach(() => {
    compat.__resetCompatStateForTests();
    jest.dontMock(INDEX_PATH);
    jest.useRealTimers();
  });

  it('live deliveries advance the watermark — no gap, nothing pulled', () => {
    const seen: unknown[] = [];
    compat.watchEvents.addListener('message', (payload) => seen.push(payload));
    emitLive('message', { kind: 'a', msgId: 'm1' });
    emitLive('message', { kind: 'b', msgId: 'm2' });
    expect(seen).toEqual([{ kind: 'a', msgId: 'm1' }, { kind: 'b', msgId: 'm2' }]);

    const r = compat.reconcileNow();
    expect(r).toEqual({ pulled: 0, epochChanged: false });
    expect(seen).toHaveLength(2); // no double delivery
  });

  it('deaf window: journal grows while live drops → reconcile pulls the gap in order', () => {
    const seen: unknown[] = [];
    compat.watchEvents.addListener('message', (payload) => seen.push(payload));
    emitLive('message', { kind: 'a', msgId: 'm1' });

    compat.__setDebugDropLiveEventsForTests(true); // the deaf event lane
    emitLive('message', { kind: 'b', msgId: 'm2' });
    emitLive('message', { kind: 'c', msgId: 'm3' });
    expect(seen).toHaveLength(1); // JS heard nothing

    const r = compat.reconcileNow();
    expect(r).toEqual({ pulled: 2, epochChanged: false });
    expect(seen).toEqual([
      { kind: 'a', msgId: 'm1' },
      { kind: 'b', msgId: 'm2' },
      { kind: 'c', msgId: 'm3' },
    ]);

    // Watermark advanced by the pull — a second reconcile is a no-op.
    expect(compat.reconcileNow()).toEqual({ pulled: 0, epochChanged: false });
  });

  it('pull spans channels and preserves old-lib payload shapes', () => {
    const messages: unknown[] = [];
    const userInfos: unknown[] = [];
    compat.watchEvents.addListener('message', (payload) => messages.push(payload));
    compat.watchEvents.addListener('user-info', (payload) => userInfos.push(payload));

    compat.__setDebugDropLiveEventsForTests(true);
    emitLive('message', { kind: 'end', msgId: 'e1' });
    emitLive('user-info', { kind: 'end', msgId: 'e1-tui' });

    const r = compat.reconcileNow();
    expect(r.pulled).toBe(2);
    expect(messages).toEqual([{ kind: 'end', msgId: 'e1' }]);
    // user-info keeps the old lib's ARRAY contract even via the pull path.
    expect(userInfos).toEqual([[{ kind: 'end', msgId: 'e1-tui' }]]);
  });

  it('pulled message with replyId still gets a working replyHandler', () => {
    const handlers: unknown[] = [];
    compat.watchEvents.addListener('message', (_payload, replyHandler) => handlers.push(replyHandler));

    compat.__setDebugDropLiveEventsForTests(true);
    emitLive('message', { kind: 'handshake', msgId: 'h1' }, 'reply-42');

    compat.reconcileNow();
    expect(handlers).toHaveLength(1);
    const reply = handlers[0] as (resp: Record<string, unknown>) => void;
    expect(typeof reply).toBe('function');
    reply({ ok: true });
    expect(replySpy).toHaveBeenCalledWith('reply-42', { ok: true });
  });

  it('epoch change = process restart → baseline reset, nothing pulled, flag reported', () => {
    const seen: unknown[] = [];
    compat.watchEvents.addListener('message', (payload) => seen.push(payload));
    emitLive('message', { kind: 'a', msgId: 'm1' });

    // Native process restarts: new epoch, fresh journal with unrelated history.
    epoch = 'epoch-B';
    journal = [{ seq: 5, epoch, payload: { kind: 'stale', msgId: 'old' }, channel: 'message' }];

    const r = compat.reconcileNow();
    expect(r).toEqual({ pulled: 0, epochChanged: true });
    expect(seen).toHaveLength(1); // stale history NOT replayed

    // New-epoch live traffic flows normally afterwards.
    emitLive('message', { kind: 'fresh', msgId: 'm2' });
    expect(seen).toHaveLength(2);
    expect(compat.reconcileNow()).toEqual({ pulled: 0, epochChanged: false });
  });

  it('first contact baselines to the journal head (pre-JS history is drain\'s job)', () => {
    // Journal has history before any live delivery or listener existed.
    journal = [
      { seq: 1, epoch, payload: { kind: 'boot1', msgId: 'b1' }, channel: 'message' },
      { seq: 2, epoch, payload: { kind: 'boot2', msgId: 'b2' }, channel: 'message' },
    ];
    const seen: unknown[] = [];
    compat.watchEvents.addListener('message', (payload) => seen.push(payload));

    expect(compat.reconcileNow()).toEqual({ pulled: 0, epochChanged: false });
    expect(seen).toHaveLength(0);

    // But anything AFTER the baseline that the live lane drops is pulled.
    compat.__setDebugDropLiveEventsForTests(true);
    emitLive('message', { kind: 'c', msgId: 'm3' });
    expect(compat.reconcileNow()).toEqual({ pulled: 1, epochChanged: false });
    expect(seen).toEqual([{ kind: 'c', msgId: 'm3' }]);
  });

  it('5s poll heals a deaf window without manual calls', () => {
    jest.useFakeTimers();
    const seen: unknown[] = [];
    compat.watchEvents.addListener('message', (payload) => seen.push(payload));
    emitLive('message', { kind: 'a', msgId: 'm1' });

    compat.startReconcilePolling(5000);
    compat.__setDebugDropLiveEventsForTests(true);
    emitLive('message', { kind: 'b', msgId: 'm2' });
    expect(seen).toHaveLength(1);

    jest.advanceTimersByTime(5000);
    expect(seen).toEqual([{ kind: 'a', msgId: 'm1' }, { kind: 'b', msgId: 'm2' }]);

    compat.stopReconcilePolling();
  });
});
