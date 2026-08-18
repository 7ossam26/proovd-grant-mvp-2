/**
 * Screen 6 — the six-digit code — Founder Flow v2, Session C.
 *
 * ── A RECORDED §1 rule 6 DEVIATION ──────────────────────────────────────────
 * `shared/src/vetting/email-code.ts` is the record. The short version: it
 * verifies an email. It creates no account and signs nobody into anything, and
 * `EMAIL_CODE_CREATES_NO_ACCOUNT` says so on the screen — because the person
 * who most needs to read it is the one looking at six empty boxes wondering
 * what they have just been signed up for.
 *
 * ── Six inputs is the accessibility problem, not the layout problem ─────────
 * The reference draws six 168px boxes that auto-advance on keystroke, and the
 * hard part is everything around that:
 *
 *  - **Every box has a label.** Six unlabelled inputs are six things a screen
 *    reader announces as "edit text". Each is labelled `Digit N of 6`,
 *    visually hidden, and the group carries the question.
 *  - **Paste works.** People paste the whole code from their mail client, and
 *    a per-box `maxLength=1` swallows five of the six digits. `onPaste` reads
 *    the whole value, fills every box, and moves focus to the end.
 *  - **Backspace works.** An empty box that eats the keystroke and leaves focus
 *    where it is makes a mistyped code unfixable without a mouse. Backspace in
 *    an empty box clears the one before it and moves there.
 *  - **Arrow keys move between boxes**, and the browser's own caret movement
 *    inside a one-character field is not the same thing.
 *
 * ── The sixth digit advances, and there is still a button ───────────────────
 * The reference has no submit control: the sixth digit fires the check. That is
 * good for the common case and cannot be the only path — a rejected code leaves
 * six full boxes and nothing to press, and a keyboard or screen-reader user
 * needs an operable control they chose to operate (§28.5, §33.11.4). So the
 * sixth digit advances AND `Confirm your email` is on the page.
 *
 * ── One rejection, and the surface knows nothing more ───────────────────────
 * Wrong, expired, already used, too many tries, never requested: the server
 * answers one frozen body for all five and this renders one sentence. There is
 * deliberately no client-side "is this code right" check — that would be the
 * enumeration oracle the frozen answer exists to prevent, running in the
 * browser.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  EMAIL_CODE_CREATES_NO_ACCOUNT,
  EMAIL_CODE_LENGTH,
  EMAIL_CODE_REJECTION,
  EMAIL_CODE_RESEND_SECONDS,
  founderFlowPath,
} from '@proovd/shared';
import { Button } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { fetchClaim, requestEmailCode, verifyEmailCode, type ClaimView } from '../draft/api.js';
import { FlowPage, useFlowNav } from './FlowPage.js';

const SLOTS = Array.from({ length: EMAIL_CODE_LENGTH }, (_, i) => i);

export function CodeStep() {
  const { token = '' } = useParams();
  const [loaded, setLoaded] = useState<ClaimView | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchClaim(token)
      .then((view) => {
        if (!cancelled) setLoaded(view);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (unavailable) return <LinkUnavailable />;
  if (!loaded) {
    return <SurfaceLoading subject="your confirmation step" reference="Your invitation link" />;
  }

  return (
    <FlowPage pageId="code" token={token} badge>
      <Body token={token} loaded={loaded} />
    </FlowPage>
  );
}

function Body({ token, loaded }: { token: string; loaded: ClaimView }) {
  const { leave } = useFlowNav();
  const [digits, setDigits] = useState<string[]>(() => SLOTS.map(() => ''));
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [resendIn, setResendIn] = useState(EMAIL_CODE_RESEND_SECONDS);
  const [resent, setResent] = useState(false);
  const boxes = useRef<Array<HTMLInputElement | null>>([]);

  const address = loaded.profile.fields.email.value ?? 'your email address';
  const already = loaded.profile.emailOwnership === 'code_verified';

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const submit = useCallback(
    async (code: string) => {
      if (busy || code.length !== EMAIL_CODE_LENGTH) return;
      setBusy(true);
      setRejected(false);
      try {
        await verifyEmailCode(token, code);
        leave(founderFlowPath('positioning', token), 1);
      } catch {
        // One sentence for every failure mode, because the server gives one
        // answer for every failure mode. Nothing here inspects the body.
        setRejected(true);
        setDigits(SLOTS.map(() => ''));
        boxes.current[0]?.focus();
      } finally {
        setBusy(false);
      }
    },
    [busy, leave, token],
  );

  function place(index: number, value: string) {
    const next = [...digits];
    next[index] = value;
    setDigits(next);
    const joined = next.join('');
    if (value && index < EMAIL_CODE_LENGTH - 1) boxes.current[index + 1]?.focus();
    /*
     * The sixth digit advances. The button below does the same thing, and
     * both are needed — see the header.
     *
     * The check is over the SLOTS, not over the joined value: `'418306'
     * .includes('')` is TRUE, because every string contains the empty string,
     * so the obvious guard looked right and never fired once.
     */
    if (next.every((digit) => digit !== '')) void submit(joined);
  }

  async function resend() {
    if (resendIn > 0) return;
    // One answer for every outcome, and 202 whether or not a code was minted.
    await requestEmailCode(token);
    setResent(true);
    setResendIn(EMAIL_CODE_RESEND_SECONDS);
    setDigits(SLOTS.map(() => ''));
    setRejected(false);
    boxes.current[0]?.focus();
  }

  const code = digits.join('');

  return (
    <div className="ff-code">
      <h1 className="ff-code__head" data-anim="head">
        Enter the six-digit code we just sent you
      </h1>
      <p className="ff-code__lede" data-anim="sub">
        Sent to <strong>{address}</strong>. {EMAIL_CODE_CREATES_NO_ACCOUNT}
      </p>

      {already ? (
        <p className="ff-code__done" role="status" data-anim="note">
          This address is already confirmed. You can carry on.
        </p>
      ) : null}

      <fieldset className="ff-code__boxes" data-anim="field">
        <legend className="sr-only">The six-digit code we emailed you</legend>
        {SLOTS.map((index) => (
          <label key={index} className="ff-code__slot">
            <span className="sr-only">Digit {index + 1} of {EMAIL_CODE_LENGTH}</span>
            <input
              ref={(node) => {
                boxes.current[index] = node;
              }}
              className="ff-code__box"
              type="text"
              inputMode="numeric"
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              maxLength={1}
              value={digits[index] ?? ''}
              onChange={(event) => {
                const value = event.target.value.replace(/\D/g, '').slice(-1);
                place(index, value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Backspace' && !digits[index] && index > 0) {
                  event.preventDefault();
                  const next = [...digits];
                  next[index - 1] = '';
                  setDigits(next);
                  boxes.current[index - 1]?.focus();
                }
                if (event.key === 'ArrowLeft' && index > 0) {
                  event.preventDefault();
                  boxes.current[index - 1]?.focus();
                }
                if (event.key === 'ArrowRight' && index < EMAIL_CODE_LENGTH - 1) {
                  event.preventDefault();
                  boxes.current[index + 1]?.focus();
                }
              }}
              onPaste={(event) => {
                const pasted = event.clipboardData
                  .getData('text')
                  .replace(/\D/g, '')
                  .slice(0, EMAIL_CODE_LENGTH);
                if (!pasted) return;
                event.preventDefault();
                const next = SLOTS.map((slot) => pasted[slot] ?? '');
                setDigits(next);
                boxes.current[Math.min(pasted.length, EMAIL_CODE_LENGTH) - 1]?.focus();
                if (pasted.length === EMAIL_CODE_LENGTH) void submit(pasted);
              }}
            />
          </label>
        ))}
      </fieldset>

      {rejected ? (
        <p className="ff-code__error" role="alert" data-anim="note">
          {EMAIL_CODE_REJECTION}
        </p>
      ) : null}

      <p className="ff-code__resend" data-anim="note">
        {resendIn > 0 ? (
          <span>
            {resent ? 'A new code is on its way. ' : null}
            You can ask for another in {resendIn}s.
          </span>
        ) : (
          <button type="button" className="ff-code__resend-btn" onClick={() => void resend()}>
            Send the code again
          </button>
        )}
      </p>

      <div className="ff-nav" data-anim="cta">
        <Button tier="tertiary" onClick={() => leave(founderFlowPath('email', token), -1)}>
          Back to Your email
        </Button>
        <Button
          tier="primary"
          disabled={busy || code.length !== EMAIL_CODE_LENGTH}
          onClick={() => void submit(code)}
        >
          Confirm your email
        </Button>
      </div>
    </div>
  );
}
