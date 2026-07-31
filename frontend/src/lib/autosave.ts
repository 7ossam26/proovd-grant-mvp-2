/**
 * The save vocabulary every Admin form uses — Spec §9.
 *
 * §9 fixes three phrases and Phase 06 establishes them here so Phase 07's
 * vetting flow inherits them rather than inventing a fourth:
 *
 *   `Saving…`                  a write is in flight
 *   `Saved <time>`             it landed, and when
 *   `Could not save — retrying` it did not, and something is still trying
 *
 * ── Why "retrying" is a promise, not a label ────────────────────────────────
 * §1.4 forbids implying automation that does not exist. So the failed state
 * says `retrying` only while a retry is genuinely scheduled; once retries are
 * exhausted it becomes an explicit, honest stop with the server's own
 * explanation and a manual action. A status line that says "retrying" forever
 * while nothing retries is the exact failure that rule names.
 */

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; at: Date }
  /** A retry is scheduled and will run. */
  | { status: 'retrying'; attempt: number }
  /** Retries are exhausted. `title`/`detail` come from the server. */
  | { status: 'failed'; title: string; detail?: string | undefined };

/** How many automatic attempts a transient failure gets before it stops. */
export const MAX_SAVE_ATTEMPTS = 3;

/** Exponential, and short — an Admin is watching this line. */
export function retryDelayMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** (attempt - 1));
}

/**
 * A refusal is not a transient failure.
 *
 * 422 means the server read the value and rejected it; 400 means the request
 * was malformed; 403 means the session is not fresh enough. Retrying any of
 * those changes nothing and would show `retrying` over a state that will never
 * resolve on its own. Only 0 (unreachable) and 5xx are worth another attempt.
 */
export function isRetryable(status: number): boolean {
  return status === 0 || (status >= 500 && status !== 503);
}

/** `Saved 14:32` — local time, seconds omitted; the history has the exact one. */
export function formatSavedAt(at: Date): string {
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function describeSaveState(state: SaveState): string {
  switch (state.status) {
    case 'idle':
      return '';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return `Saved ${formatSavedAt(state.at)}`;
    case 'retrying':
      return `Could not save — retrying (attempt ${state.attempt} of ${MAX_SAVE_ATTEMPTS})`;
    case 'failed':
      return `Not saved — ${state.title}`;
  }
}
