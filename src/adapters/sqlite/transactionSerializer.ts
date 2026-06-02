/**
 * Transaction serializer for the expo-sqlite production adapter.
 *
 * Why: expo-sqlite drives a SINGLE underlying connection. Its
 * `withTransactionAsync` issues `BEGIN … COMMIT` spanning multiple awaited
 * statements, and the connection lets OTHER awaited calls interleave in the
 * gaps. So two `withTransactionAsync` calls that overlap in time race on the
 * connection: the second's `BEGIN` lands inside the first's open transaction →
 *   "cannot start a transaction within a transaction"
 * and the failed path's stray `ROLLBACK` then hits
 *   "cannot rollback - no transaction is active".
 *
 * This bit the WC live session: a `replaceLiveMirror` live-mirror tick
 * (`reconcileSessionTree` → `withTransactionAsync`) firing while
 * `onStartFromWatch` → `startSessionFromTemplate` (also a transaction) was mid-
 * flight (2026-06-02 device smoke). The two WC channels (live-mirror on
 * sendMessage/appContext vs start on transferUserInfo) have no cross-channel
 * ordering, so the overlap is inherent.
 *
 * Fix: chain every transaction onto the previous one so each waits for the
 * prior to SETTLE (commit or rollback) before it issues its own `BEGIN`.
 * Reads and bare single-statement writes are NOT serialized — only
 * transactions, which is the minimal scope that removes the nested-BEGIN race.
 *
 * Deadlock-safe: no caller nests `withTransactionAsync` inside another
 * transaction's callback (audited 2026-06-02 — every call site is flat), so a
 * queued transaction can never be waiting on the connection it itself holds.
 *
 * Pure + dependency-free (no `expo-sqlite` import) so it is unit-testable in
 * the node test env; the better-sqlite3 test adapter is synchronous and can't
 * reproduce the race, so this serializer is the only place the ordering
 * guarantee is checked.
 */
export function createTransactionSerializer(): (
  runTx: () => Promise<void>,
) => Promise<void> {
  // The tail of the queue. Always a SETTLED-tolerant promise: it resolves
  // whether the previous transaction committed or threw, so one failed
  // transaction never poisons serialization for the next.
  let chain: Promise<unknown> = Promise.resolve();

  return (runTx) => {
    // Start this transaction only after the previous one settles. Use the
    // same `runTx` for both branches so a prior rejection still lets us run.
    const result = chain.then(runTx, runTx);
    // Advance the tail, swallowing this transaction's outcome so the NEXT
    // caller waits for it to settle without inheriting its rejection.
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    // The original caller still gets the real result / rejection.
    return result;
  };
}
