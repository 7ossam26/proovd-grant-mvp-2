/**
 * Screen 6 — the six-digit code. Founder Flow v2.
 *
 * Rebuilt 2026-08-20 to the supplied reference (`Proovd Founder Flow v2.dc.html`,
 * `[data-code]` / `kindWide`). The read, the two routes, the one rejection and
 * the accessibility work are unchanged; the presentation and the entrance are
 * the reference's own.
 *
 * ── A RECORDED §1 rule 6 DEVIATION ──────────────────────────────────────────
 * `shared/src/vetting/email-code.ts` is the record. The short version: it
 * verifies an email. It creates no account and signs nobody into anything.
 *
 * ── The layout model is the reference's, not an approximation of it ─────────
 * The reference does not lay this screen out responsively. It authors it once,
 * on a fixed 2496x1542 stage inside a `position:fixed;inset:0` page, and scales
 * that stage to the viewport with `fitStages()`:
 *
 *     let s = Math.min(innerWidth / 2496, innerHeight / 1542) * (pageScale || .78);
 *
 * — the same function screens 2, 3 and 5 use, with none of its per-screen
 * boosts, because `c === 'type'` is in none of those branches. Inside the stage
 * sits an 1860px column, centred, and every child carries the reference's own
 * pixel value: a 78px headline, six 210px boxes 28px apart 134px below it, and
 * a 38px note 126px below those. Nothing reflows; the stage scales instead,
 * which is why the composition is identical at every viewport.
 *
 * `isClaimPhone()` returns `false` — "one composition everywhere: the phone
 * posture stays off" — so the reference's phone markup is dead code and this is
 * what every viewport gets, exactly as there.
 *
 * ── Three elements, a Back control, and that is the whole screen ────────────
 * The reference draws no wordmark, no HELP and no message badge here (nor on
 * screen 5 beside it), so `FlowPage`'s chrome is not rendered on this page and
 * `badge` is not passed. Help is still one gesture away: the Back control's own
 * page is screen 5, and the drawer is on every page that draws it.
 *
 * ── Six inputs is the accessibility problem, not the layout problem ─────────
 *  - **Every box has a label.** Six unlabelled inputs are six things a screen
 *    reader announces as "edit text". Each is labelled `Digit N of 6`,
 *    visually hidden, and the group carries the question.
 *  - **Paste works.** People paste the whole code from their mail client, and
 *    a per-box `maxLength=1` swallows five of the six digits.
 *  - **Backspace works.** An empty box that eats the keystroke and leaves focus
 *    where it is makes a mistyped code unfixable without a mouse.
 *  - **Arrow keys move between boxes**, which the browser's own caret movement
 *    inside a one-character field is not.
 *
 * ── Three things the reference does not draw, and why each is still here ────
 * The reference is a prototype: any six digits advance, so it models no
 * rejection, and it needs no compliance line. Each of these is required
 * application functionality (§1.1, §28.5, §1.4) and none of them changes the
 * screen a person sees in the state the reference actually renders.
 *
 *  1. **`EMAIL_CODE_CREATES_NO_ACCOUNT`** is the accessible description of the
 *     code group rather than a fourth block of copy. It is the one sentence
 *     that keeps this screen from reading as a sign-in, so removing it was not
 *     an option; the reference's composition is three elements, so adding a
 *     visible paragraph was not either.
 *  2. **`Confirm your email`** is in the accessibility tree, correctly labelled,
 *     and visually hidden until it is focused — the skip-link pattern, so the
 *     default composition is the reference's.
 *
 *     What it is NOT is the keyboard path, and the previous build's header
 *     claimed it was. Measured: it is `disabled` below six digits, a disabled
 *     button is not focusable, and the sixth digit submits — so the window in
 *     which it can be tabbed to is the width of one request. That is fine,
 *     because §28.5 is satisfied without it: focus box 1, type six digits, and
 *     the screen advances; Enter submits a complete code from any box; every
 *     box is labelled, reachable and correctable with arrows and Backspace.
 *     The control is the deliberate act for somebody who wants one, not the
 *     thing that makes the screen operable.
 *
 *     It stays `disabled` rather than `aria-disabled` on purpose: a control
 *     that is focusable, announced as available and then silently does nothing
 *     is the §1.4 failure with a keyboard attached.
 *  3. **The rejection** renders below the note, in the note's own type. It is a
 *     state the reference does not have, so it is drawn in the reference's
 *     language rather than invented in the project's.
 *
 * ── One rejection, and the surface knows nothing more ───────────────────────
 * Wrong, expired, already used, too many tries, never requested: the server
 * answers one frozen body for all five and this renders one sentence. There is
 * deliberately no client-side "is this code right" check — that would be the
 * enumeration oracle the frozen answer exists to prevent, running in the
 * browser.
 *
 * ── The resend is available on arrival, and the cooldown starts on the ask ──
 * The reference's own shape: `resendLeft` is 0 until `startResend()` runs, so
 * the control reads `resend` in brand green when the page opens and becomes
 * `resend again in 49s` in grey, unclickable, once it has been used. The
 * previous build counted down from mount, which meant a Founder whose code
 * never arrived watched a timer before they could do anything about it.
 * `EMAIL_CODE_RESEND_SECONDS` governs a countdown on one screen and no service
 * reads it (`backend/src/vetting/email-code-logic.ts` records that), so it now
 * carries the reference's 49.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router';
import {
  EMAIL_CODE_CREATES_NO_ACCOUNT,
  EMAIL_CODE_LENGTH,
  EMAIL_CODE_REJECTION,
  EMAIL_CODE_RESEND_SECONDS,
  founderFlowPath,
} from '@proovd/shared';
import { SurfaceLoading } from '../../features/public/states.js';
import { stageRelayIn } from '../../components/anim.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { fetchClaim, requestEmailCode, verifyEmailCode, type ClaimView } from '../draft/api.js';
import { FlowPage, flowDirection, useFlowNav } from './FlowPage.js';

const SLOTS = Array.from({ length: EMAIL_CODE_LENGTH }, (_, i) => i);

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()`, for this screen. `c === 'type'` is a hero in none of the
   reference's branches and takes none of its per-screen boosts, so this is the
   plain form — the same one every page from here to the fee screen gets. */

const FIT_W = 2496;
const FIT_H = 1542;
/** The prototype's `pageScale` prop default. */
const PAGE_SCALE = 0.78;

/**
 * Rounded to four places, because `fitStages` is:
 *
 *     el.style.transform = 'translate(-50%,-50%) scale(' + s.toFixed(4) + ')';
 *
 * It looks like formatting and it is not. At 1853x980 the unrounded scale is
 * 0.495721… and the reference's is 0.4957, which makes each box 104.0970px
 * rather than 104.1012 and moves the sixth one 0.02px — enough that a pixel
 * diff of the two renders picks the box borders out as a seam. `claimFit` on
 * screen 1 deliberately does NOT round, which is why `InviteClaim` does not.
 */
function stageScale(): string {
  return (
    Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * PAGE_SCALE
  ).toFixed(4);
}

/**
 * The reference's own relay order for this page.
 *
 * `verifyIntro` builds its list from one fixed sequence — `pill, head, field,
 * boxes, note, …` — and filters it to what the page has. Here that is three,
 * and the stagger follows THIS order rather than document order.
 */
const RELAY = ['head', 'boxes', 'note'] as const;

/**
 * The beat between the last digit and the screen changing.
 *
 * `this.later(() => this.step({ si: this.I('vetting') }), 260)` — the reference
 * pauses so the sixth digit is seen to land rather than vanishing under a page
 * transition. Here the verification request is already in flight during it, so
 * it costs nothing in the common case: whichever of the two finishes last is
 * what the transition waits for.
 */
const LAST_DIGIT_BEAT = 260;

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
  if (loaded.founderSessionAuthorized) {
    return <Navigate to={founderFlowPath('confirm-problem', token)} replace />;
  }

  // No `badge`: the reference draws none on this screen. `FlowPage`'s top row
  // is hidden by `.ff[data-flow-page='code'] .ff__top { display: none }`.
  return (
    <FlowPage pageId="code" param={token}>
      <CodeScreen token={token} loaded={loaded} />
    </FlowPage>
  );
}

function CodeScreen({ token, loaded }: { token: string; loaded: ClaimView }) {
  const { leave } = useFlowNav();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const boxes = useRef<Array<HTMLInputElement | null>>([]);

  const [digits, setDigits] = useState<string[]>(() => SLOTS.map(() => ''));
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  // 0 until the control is used, which is the reference's own initial state.
  const [resendIn, setResendIn] = useState(0);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  // State updates render asynchronously; the ref closes the double-click gap
  // synchronously, before a second event can start another request.
  const resendLock = useRef(false);

  const address = loaded.profile.fields.email.value ?? 'your email address';
  const already = loaded.profile.emailOwnership === 'code_verified';

  // Captured on the first render: `FlowPage` resets the pending direction in
  // its own layout effect, and a later re-render would read forward.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  // `fitStages`, for this screen. First, so the first paint is already at the
  // right scale — and on resize, because the reference refits there too.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      el.style.transform = `translate(-50%, -50%) scale(${stageScale()})`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useLayoutEffect(() => {
    return stageRelayIn(root.current, direction.current ?? 1, RELAY);
    // Mount only: re-running it would stage the page a second time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // The reference's 260ms beat, run alongside the request rather than
      // after it: whichever finishes last is what the transition waits for.
      const beat = new Promise((resolve) => window.setTimeout(resolve, LAST_DIGIT_BEAT));
      try {
        await verifyEmailCode(token, code);
        await beat;
        // The reference's own destination for a landed code: `next()` on the
        // `type` screen runs `this.step({si:this.I('vetting'), vStep:0})`, and
        // vStep 0 of `vetting` is the last look at the problem.
        leave(founderFlowPath('confirm-problem', token), 1);
      } catch {
        // One sentence for every failure mode, because the server gives one
        // answer for every failure mode. Nothing here inspects the body.
        await beat;
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
    if (value && index < EMAIL_CODE_LENGTH - 1) boxes.current[index + 1]?.focus();
    /*
     * The sixth digit advances, which is the reference's whole submit path.
     *
     * The check is over the SLOTS, not over the joined value: `'418306'
     * .includes('')` is TRUE, because every string contains the empty string,
     * so the obvious guard looked right and never fired once.
     */
    if (next.every((digit) => digit !== '')) void submit(next.join(''));
  }

  async function resend() {
    if (resendIn > 0 || resendLock.current) return;
    resendLock.current = true;
    setResending(true);
    try {
      await requestEmailCode(token);
      // The cooldown starts only after the server confirms provider acceptance.
      setResent(true);
      setResendIn(EMAIL_CODE_RESEND_SECONDS);
      setDigits(SLOTS.map(() => ''));
      setRejected(false);
      boxes.current[0]?.focus();
    } catch {
      // Keep the current digits/code path intact and make Resend usable again.
      setResent(false);
    } finally {
      resendLock.current = false;
      setResending(false);
    }
  }

  const code = digits.join('');
  const counting = resendIn > 0;

  return (
    <div className="ff-code" ref={root}>
      <button
        type="button"
        className="ff-code__back"
        onClick={() => leave(founderFlowPath('email', token), -1)}
      >
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 5 8 12l7 7" />
        </svg>
        Back
        {/* §33.11.4: a nav control names where it goes. The reference's label
            is the bare word, so the destination is said to a screen reader and
            drawn to nobody — the visible control is the reference's. */}
        <span className="sr-only"> to your email</span>
      </button>

      <div className="ff-code__stage" ref={stage}>
        <div className="ff-code__col">
          <h1 className="ff-code__head" data-stage-anim="head">
            Enter the six digit code we just sent you
          </h1>

          <fieldset className="ff-code__boxes" data-stage-anim="boxes">
            <legend className="sr-only">The six-digit code we emailed you</legend>
            {/* The one sentence that keeps this screen from reading as a
                sign-in, as the group's description. See the header. */}
            <p className="sr-only" id="ff-code-scope">
              {EMAIL_CODE_CREATES_NO_ACCOUNT}
            </p>
            {SLOTS.map((index) => (
              <label key={index} className="ff-code__slot">
                <span className="sr-only">
                  Digit {index + 1} of {EMAIL_CODE_LENGTH}
                </span>
                <input
                  ref={(node) => {
                    boxes.current[index] = node;
                  }}
                  className="ff-code__box"
                  type="text"
                  inputMode="numeric"
                  autoComplete={index === 0 ? 'one-time-code' : 'off'}
                  maxLength={1}
                  aria-describedby="ff-code-scope"
                  value={digits[index] ?? ''}
                  onChange={(event) => {
                    const value = event.target.value.replace(/\D/g, '').slice(-1);
                    place(index, value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      // The reference's own `enterAdvance()`: this screen's
                      // `ctaState` is `{ show: true }`, so Enter advances.
                      // With fewer than six digits there is nothing to send.
                      event.preventDefault();
                      void submit(code);
                      return;
                    }
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

          <p className="ff-code__note" data-stage-anim="note">
            {/* The reference's own sentence, verbatim — including the full stop
                inside the bold address, the lower-case `didn’t`, and its curly
                apostrophe. */}
            Code sent to <strong>{address}.</strong> didn&rsquo;t get a code?{' '}
            <button
              type="button"
              className="ff-code__resend"
              data-counting={counting ? '1' : undefined}
              // The reference's `pointer-events:none` while counting. Disabled
              // rather than unclickable, so the state is announced and not just
              // unreachable.
              disabled={counting || resending}
              onClick={() => void resend()}
            >
              {counting ? `resend again in ${resendIn}s` : 'resend'}
            </button>
          </p>

          {/* Two states the reference does not model. Both sit under the note,
              in the note's own type, so nothing about the composition it does
              draw is changed by either being absent. */}
          {rejected ? (
            <p className="ff-code__alert" role="alert">
              {EMAIL_CODE_REJECTION}
            </p>
          ) : null}
          {!rejected && resent ? (
            <p className="ff-code__alert is-quiet" role="status">
              A new code is on its way.
            </p>
          ) : null}
          {already ? (
            <p className="ff-code__alert is-quiet" role="status">
              This address is already confirmed. You can carry on.
            </p>
          ) : null}

          {/* Visually hidden until focused — see the header. */}
          <button
            type="button"
            className="ff-code__confirm"
            disabled={busy || code.length !== EMAIL_CODE_LENGTH}
            onClick={() => void submit(code)}
          >
            Confirm your email
          </button>
        </div>
      </div>
    </div>
  );
}
