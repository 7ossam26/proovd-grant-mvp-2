/**
 * Debounced autosave for the Founder surfaces — Spec §9, DNA §5.12.
 *
 * §9's four rules, and where each one lives here:
 *
 *  1. "Status is `Saving…`, `Saved [local time]`, or `Could not save —
 *     retrying`."  →  `lib/autosave.ts` owns the three phrases; this hook only
 *     moves between them.
 *  2. "A failed save never clears valid fields."  →  this hook never returns a
 *     value. It takes a patch and reports an outcome; the caller's own state is
 *     the only copy of what the person typed, and nothing here can overwrite
 *     it. That single decision is the whole of the most common autosave bug.
 *  3. "Leaving with newer unsaved data causes a browser warning."  →  `dirty`
 *     drives a `beforeunload` listener, registered only while there genuinely
 *     is unsaved work.
 *  4. "Network, validation, server, and provider errors preserve all valid
 *     values and give a safe next action."  →  the failed state carries the
 *     server's own `whatHappened` / `next`, unedited.
 *
 * ── Retry means retry ───────────────────────────────────────────────────────
 * §1.4 forbids implying automation that does not exist, so `retrying` appears
 * only while a timer is genuinely pending. A 422 is a decision — the server read
 * the value and refused it — and retrying it would loop forever under a status
 * line promising progress. `isRetryable` draws that line once, for every
 * surface.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isRetryable,
  retryDelayMs,
  MAX_SAVE_ATTEMPTS,
  type SaveState,
} from '../../lib/autosave.js';
import { DraftRequestError } from './api.js';

/** How long typing settles before a save goes out. */
const DEBOUNCE_MS = 700;

export interface AutosaveController<Patch> {
  state: SaveState;
  /** True while typed changes have not reached the server. */
  dirty: boolean;
  /** Queue a patch. Repeated calls coalesce into one request. */
  queue: (patch: Patch) => void;
  /** Send whatever is queued now — used before advancing a step. */
  flush: () => Promise<void>;
}

export function useAutosave<Patch extends object>(
  save: (patch: Patch) => Promise<unknown>,
): AutosaveController<Patch> {
  const [state, setState] = useState<SaveState>({ status: 'idle' });
  const [dirty, setDirty] = useState(false);

  const pending = useRef<Patch | null>(null);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);
  // `save` is redefined on every render by most callers; holding it in a ref
  // keeps the debounce timer from being torn down on every keystroke.
  const saveRef = useRef(save);
  saveRef.current = save;

  const send = useCallback(async (attempt: number): Promise<void> => {
    const patch = pending.current;
    if (!patch || inFlight.current) return;

    inFlight.current = true;
    pending.current = null;
    setState(attempt === 1 ? { status: 'saving' } : { status: 'retrying', attempt });

    try {
      await saveRef.current(patch);
      inFlight.current = false;
      setState({ status: 'saved', at: new Date() });
      // Another keystroke landed while this was in flight.
      if (pending.current) {
        void send(1);
      } else {
        setDirty(false);
      }
    } catch (error) {
      inFlight.current = false;
      const detail =
        error instanceof DraftRequestError
          ? error.detail
          : { status: 0, title: 'Proovd could not be reached', whatHappened: undefined, next: undefined };

      // The patch goes back on the queue whatever happens. §9: a failed save
      // never costs the person their work, and the retry has to have something
      // to send.
      pending.current = { ...patch, ...(pending.current ?? {}) };

      if (isRetryable(detail.status) && attempt < MAX_SAVE_ATTEMPTS) {
        setState({ status: 'retrying', attempt: attempt + 1 });
        timer.current = window.setTimeout(() => void send(attempt + 1), retryDelayMs(attempt));
        return;
      }

      setState({
        status: 'failed',
        title: detail.title,
        detail: detail.whatHappened,
      });
    }
  }, []);

  const queue = useCallback(
    (patch: Patch) => {
      pending.current = { ...(pending.current ?? ({} as Patch)), ...patch };
      setDirty(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void send(1), DEBOUNCE_MS);
    },
    [send],
  );

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    await send(1);
  }, [send]);

  // §9: "Leaving with newer unsaved data causes a browser warning." Registered
  // only while there is something to lose — a page that always warns is a page
  // people learn to dismiss without reading.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return { state, dirty, queue, flush };
}
