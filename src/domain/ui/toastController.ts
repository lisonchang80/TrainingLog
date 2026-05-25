/**
 * Toast controller — pure state + timer logic for the shared Toast UI
 * (ADR-0019 Q10 Round F: save-template success uses toast instead of Alert).
 *
 * Lives under `src/domain/ui/` so the timer / auto-dismiss / subscribe pattern
 * can be unit-tested with jest fake timers in the `node` env — the React
 * Native view layer (`components/ui/Toast.tsx`) consumes this controller and
 * is the only place that touches Animated / native modules.
 *
 * Contract:
 *   - `show(message, opts?)` queues a toast; if one is already visible the
 *     new one REPLACES it (single-slot — keeps the API small, matches the
 *     in-app pattern of "tell me what just happened, dismiss in 2.5s").
 *   - Auto-dismiss after `durationMs` (default 2500).
 *   - `hide()` dismisses immediately and clears any pending timer.
 *   - `subscribe(listener)` notifies on every state change; returns an
 *     unsubscribe fn. The React layer hooks into this via `useSyncExternalStore`
 *     (or a simple useEffect).
 *
 * The controller is intentionally framework-agnostic — no React imports — so
 * the same instance could in principle drive multiple renderers (e.g. a
 * web layer later). For now it's owned by the React Provider in Toast.tsx.
 */

export type ToastIcon = 'success' | 'info' | 'error' | null;

interface ToastState {
  /** When `null`, no toast is visible. */
  message: string | null;
  /** Optional icon hint for the renderer. */
  icon: ToastIcon;
  /** Monotonic id — increments every `show()`; lets renderers key Animated values. */
  id: number;
}

export interface ShowToastOptions {
  /** Optional icon hint (default: 'success'). */
  icon?: ToastIcon;
  /** Auto-dismiss after N ms (default: 2500). */
  durationMs?: number;
}

const DEFAULT_DURATION_MS = 2500;

export class ToastController {
  private state: ToastState = { message: null, icon: null, id: 0 };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private setTimeoutFn: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private clearTimeoutFn: (handle: ReturnType<typeof setTimeout>) => void;

  constructor(opts?: {
    /** Injectable for tests; defaults to global setTimeout/clearTimeout. */
    setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
  }) {
    this.setTimeoutFn = opts?.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = opts?.clearTimeout ?? ((h) => clearTimeout(h));
  }

  getState(): ToastState {
    return this.state;
  }

  show(message: string, opts: ShowToastOptions = {}): void {
    if (this.timer != null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
    const duration = opts.durationMs ?? DEFAULT_DURATION_MS;
    this.state = {
      message,
      icon: opts.icon ?? 'success',
      id: this.state.id + 1,
    };
    this.notify();
    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      this.state = { message: null, icon: null, id: this.state.id };
      this.notify();
    }, duration);
  }

  hide(): void {
    if (this.timer != null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
    if (this.state.message == null) return;
    this.state = { message: null, icon: null, id: this.state.id };
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
