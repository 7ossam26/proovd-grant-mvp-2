/**
 * The save vocabulary every Proovd form uses — Spec §9.
 *
 * Established by Phase 06 for the Admin settings surface and moved here by
 * Phase 07, which is where §9 actually puts it: the vetting flow, the account
 * claim, and the Admin settings all speak the same three phrases, and a Founder
 * surface importing its status vocabulary out of `features/admin` was one
 * refactor away from two of them.
 *
 * §9 fixes three phrases:
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
      /*
       * The server's own explanation, not just its headline.
       *
       * The title is the server naming the act that failed, so on its own this
       * line read `Not saved — That was not saved` — the same thing twice, and
       * an answer to nothing. `detail` is `whatHappened`, and on the refusal
       * people actually hit it is `You have already submitted this form, so
       * its answers are now read-only`: the whole reason, sitting in state and
       * rendered by nobody. §1.1 and §27.1 both ask for it, and it belongs
       * here rather than in each of the twelve surfaces that render this.
       */
      return state.detail ? `Not saved — ${state.title} ${state.detail}` : `Not saved — ${state.title}`;
  }
}
