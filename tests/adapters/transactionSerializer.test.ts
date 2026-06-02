import { createTransactionSerializer } from '../../src/adapters/sqlite/transactionSerializer';

/**
 * Transaction serializer (expo-sqlite single-connection guard, 2026-06-02).
 * Reproduces the overlap that crashed start-from-watch ("cannot start a
 * transaction within a transaction") and asserts the serializer removes it.
 */

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createTransactionSerializer', () => {
  it('runs overlapping transactions strictly sequentially (no interleave)', async () => {
    const serialize = createTransactionSerializer();
    const events: string[] = [];
    const tx = (id: string) =>
      serialize(async () => {
        events.push(`start-${id}`);
        await tick(); // an async gap where a naive impl would let the next BEGIN in
        events.push(`end-${id}`);
      });
    // Fire all three concurrently (no per-call await) — the danger scenario.
    await Promise.all([tx('a'), tx('b'), tx('c')]);
    expect(events).toEqual([
      'start-a',
      'end-a',
      'start-b',
      'end-b',
      'start-c',
      'end-c',
    ]);
  });

  it('never has two transactions active at once (concurrency cap = 1)', async () => {
    const serialize = createTransactionSerializer();
    let active = 0;
    let maxActive = 0;
    const tx = () =>
      serialize(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await tick();
        active -= 1;
      });
    await Promise.all([tx(), tx(), tx(), tx(), tx()]);
    expect(maxActive).toBe(1);
  });

  it('a throwing transaction does not break serialization of the next', async () => {
    const serialize = createTransactionSerializer();
    const events: string[] = [];
    const ok = (id: string) =>
      serialize(async () => {
        events.push(`start-${id}`);
        await tick();
        events.push(`end-${id}`);
      });
    const bad = () =>
      serialize(async () => {
        events.push('start-bad');
        throw new Error('boom');
      });
    const results = await Promise.allSettled([ok('a'), bad(), ok('b')]);
    // The failing transaction's own caller still sees the rejection…
    expect(results[1].status).toBe('rejected');
    // …and the next transaction still runs, strictly after the bad one settled.
    expect(events).toEqual(['start-a', 'end-a', 'start-bad', 'start-b', 'end-b']);
  });

  it('propagates each transaction result / rejection to its own caller', async () => {
    const serialize = createTransactionSerializer();
    await expect(
      serialize(async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    await expect(serialize(async () => {})).resolves.toBeUndefined();
  });
});
