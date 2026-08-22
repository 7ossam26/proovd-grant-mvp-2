/**
 * The panel's confirmation line — the reference's `.toast`.
 *
 * `role="status"` rather than `role="alert"`: every message this carries is a
 * confirmation that something completed or a refusal of something that was not
 * attempted, and an assertive live region would interrupt a screen reader
 * mid-sentence for each one.
 *
 * The 2,600ms clear is the reference's own. It is deliberately NOT a dismissal
 * control: a toast that has to be dismissed competes with the action that
 * produced it, which §30 forbids in exactly the states this panel lives in.
 * Nothing consequential is ever said only here — every one of these messages
 * also lands in the record it belongs to.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** The reference's own timeout, verbatim. */
const CLEAR_AFTER_MS = 2600;

export interface ToastController {
  message: string;
  show: (message: string) => void;
}

export function useToast(): ToastController {
  const [message, setMessage] = useState('');
  const timer = useRef<number | null>(null);

  const show = useCallback((next: string) => {
    setMessage(next);
    // A second message inside the window replaces the first and restarts the
    // clock; leaving the original timer running would clear the NEW message
    // early, which is how a confirmation disappears before it is read.
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setMessage('');
      timer.current = null;
    }, CLEAR_AFTER_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return { message, show };
}

export function Toast({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}
