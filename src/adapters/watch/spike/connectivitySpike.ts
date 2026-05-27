/**
 * Slice 13d / D0 spike C — react-native-watch-connectivity@2.0.0 New Arch
 * validation harness.
 *
 * Throwaway code. ADR-0019 NEW-Q47 spec: run 3 spikes 實機 + 結果寫 D0 commit
 * body. This file ships on `slice/13d-d0-spike-c` branch ONLY — do NOT
 * cherry-pick to main. After spike confirms PASS/FAIL we either:
 *   - PASS → absorb subset into D3 `connectivity.ts` proper, delete this file
 *   - FAIL → file deleted、Branch A fallback (Swift Nitro module ~150 LOC)
 *
 * What this verifies (Q5):
 *   1. TurboModule registration of WatchConnectivity does not throw at import
 *      under Expo SDK 54 + New Arch (= biggest unknown — lib uses
 *      `TurboModuleRegistry.getEnforcing` which throws sync if the native
 *      module isn't found)
 *   2. `getIsPaired` / `getIsWatchAppInstalled` / `getReachability` return
 *      sensible booleans (paired=true expected; installed=false since
 *      Watch app not built yet)
 *   3. `sendMessage` doesn't crash JS — expected outcome at this stage is
 *      `WCErrorCodeNotReachable` (7008) via errCb because no Watch app
 *      installed
 *   4. `watchEvents.addListener` subscription + unsubscribe works
 *
 * Output: structured `SpikeReport` JSON-serializable, surfaced via Settings
 * 「執行 WC spike」row. User copies the JSON into the D0 commit body when
 * filing spike results.
 */

import {
  getIsPaired,
  getIsWatchAppInstalled,
  getReachability,
  sendMessage,
  watchEvents,
} from 'react-native-watch-connectivity';

/** Single-step outcome — each spike phase records one of these. */
export interface SpikeStepResult {
  step: string;
  ok: boolean;
  value?: unknown;
  error?: string;
  errorCode?: string;
  errorDomain?: string;
  durationMs: number;
}

/** Final spike output — what gets pasted into D0 commit body. */
export interface SpikeReport {
  startedAt: number;
  finishedAt: number;
  totalMs: number;
  /** `true` iff the top-level `require` of the lib at file load didn't crash.
   *  False is theoretically impossible to observe here (we'd crash before
   *  this function runs) — kept as defensive field for completeness. */
  importOk: boolean;
  /** Each phase of the spike, in order. Partial failure still produces full
   *  report. */
  steps: SpikeStepResult[];
  /** `pass` = all steps ok; `partial` = state-read steps ok but sendMessage
   *  errored predictably (no Watch app installed); `fail` = TurboModule
   *  crash, state-read returned non-boolean, or subscription threw. */
  verdict: 'pass' | 'partial' | 'fail';
  /** Human-readable summary line. */
  summary: string;
}

async function timed<T>(
  step: string,
  fn: () => Promise<T> | T,
): Promise<SpikeStepResult> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return {
      step,
      ok: true,
      value,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    const err = e as Error & { code?: string; domain?: string };
    return {
      step,
      ok: false,
      error: err?.message ?? String(e),
      errorCode: err?.code,
      errorDomain: err?.domain,
      durationMs: Date.now() - t0,
    };
  }
}

/**
 * sendMessage is callback-style (no native Promise). Wrap in a 5-sec timeout
 * Promise. Since no Watch app is installed at spike time, we expect EITHER:
 *   - errCb fires immediately with `WCErrorCodeNotReachable` (好結果、確認
 *     bridge alive)
 *   - 5-sec timeout (less ideal — means bridge accepted message but no
 *     channel to deliver)
 *
 * Both outcomes are recorded but only the first counts as a clean "bridge
 * works" signal.
 */
function spikeSendMessage(): Promise<SpikeStepResult> {
  const t0 = Date.now();
  return new Promise<SpikeStepResult>((resolve) => {
    let settled = false;
    const settle = (result: Omit<SpikeStepResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, durationMs: Date.now() - t0 });
    };

    const timeoutHandle = setTimeout(() => {
      settle({
        step: 'sendMessage',
        ok: false,
        error: '5s timeout — no reply, no error callback',
      });
    }, 5000);

    try {
      sendMessage(
        { type: 'spike-ping', sentAt: Date.now() },
        (reply) => {
          clearTimeout(timeoutHandle);
          settle({
            step: 'sendMessage',
            ok: true,
            value: { kind: 'reply', payload: reply },
          });
        },
        (err) => {
          clearTimeout(timeoutHandle);
          // Expected at spike time — Watch app not installed → not reachable.
          // We treat this as "bridge alive" because errCb firing means the
          // native side processed our call.
          settle({
            step: 'sendMessage',
            ok: true,
            value: { kind: 'expected-error-cb' },
            error: err?.message ?? String(err),
            errorCode: err?.code,
            errorDomain: err?.domain,
          });
        },
      );
    } catch (e) {
      clearTimeout(timeoutHandle);
      const err = e as Error;
      settle({
        step: 'sendMessage',
        ok: false,
        error: `sync throw: ${err?.message ?? String(e)}`,
      });
    }
  });
}

function spikeSubscription(): SpikeStepResult {
  const t0 = Date.now();
  try {
    // 'reachability' is the public string event name (lib internally maps
    // it to the native WatchReachabilityChanged event). The public
    // `WatchEvent` re-export is a type alias only, not a value enum.
    const unsub = watchEvents.addListener('reachability', () => {
      // no-op — we only want to verify the subscription handle returned
    });
    if (typeof unsub !== 'function') {
      return {
        step: 'subscribe+unsubscribe',
        ok: false,
        error: `addListener returned non-function: ${typeof unsub}`,
        durationMs: Date.now() - t0,
      };
    }
    unsub();
    return {
      step: 'subscribe+unsubscribe',
      ok: true,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    const err = e as Error;
    return {
      step: 'subscribe+unsubscribe',
      ok: false,
      error: err?.message ?? String(e),
      durationMs: Date.now() - t0,
    };
  }
}

/**
 * Run the full spike. Caller is the Settings 「執行 WC spike」 row — it should
 * await this then render the report inline.
 *
 * Why all-in-one rather than per-step UI: the user runs this once, copies the
 * full JSON to the D0 commit body. Per-step interaction would be noise.
 */
export async function runConnectivitySpike(): Promise<SpikeReport> {
  const startedAt = Date.now();
  const steps: SpikeStepResult[] = [];

  steps.push(await timed('getIsPaired', () => getIsPaired()));
  steps.push(
    await timed('getIsWatchAppInstalled', () => getIsWatchAppInstalled()),
  );
  steps.push(await timed('getReachability', () => getReachability()));
  steps.push(spikeSubscription());
  steps.push(await spikeSendMessage());

  const finishedAt = Date.now();
  const stateReadsOk = steps
    .slice(0, 3)
    .every((s) => s.ok && typeof s.value === 'boolean');
  const subOk = steps[3].ok;
  const sendOk = steps[4].ok;

  let verdict: SpikeReport['verdict'];
  let summary: string;
  if (stateReadsOk && subOk && sendOk) {
    verdict = 'pass';
    summary =
      'PASS — TurboModule loaded, state-reads OK, subscribe/unsubscribe OK, sendMessage produced expected errCb (bridge alive).';
  } else if (stateReadsOk && subOk) {
    verdict = 'partial';
    summary =
      'PARTIAL — state-reads + subscription OK, but sendMessage did not produce expected errCb within 5s. Bridge may need real Watch app to fully validate.';
  } else {
    verdict = 'fail';
    const broken = steps.filter((s) => !s.ok).map((s) => s.step);
    summary = `FAIL — broken steps: ${broken.join(', ')}. Likely TurboModule registration failure; consider Branch A fallback (Swift Nitro module).`;
  }

  return {
    startedAt,
    finishedAt,
    totalMs: finishedAt - startedAt,
    importOk: true,
    steps,
    verdict,
    summary,
  };
}
