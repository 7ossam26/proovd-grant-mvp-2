/**
 * Screen 5 — the address. Spec §5.2, §9, §33.1.
 *
 * REBUILT 2026-08-20 to the supplied reference (`Proovd Founder Flow v2.dc.html`,
 * `[data-verify]` / `kindWide`), from scratch rather than adjusted. The
 * presentation and the interaction are the reference's own; the record it
 * writes, the address it lives at, and the code it asks for are unchanged.
 *
 * ── The layout model is the reference's, not an approximation of it ─────────
 * This page is not laid out responsively there. It is authored once, on a fixed
 * 2496x1542 stage, and that stage is scaled to the viewport:
 *
 *     fitStages(){ const s = Math.min(innerWidth/2496, innerHeight/1542) * .78;
 *                  el.style.transform = 'translate(-50%,-50%) scale(' + s + ')'; }
 *
 * — `.78` is the prototype's own `pageScale` default, and unlike screens 2 and
 * 3 the verify screen takes none of `fitStages`'s per-page multipliers. Inside
 * that stage sits a 1290px column, centred. Every child below carries the
 * reference's own pixel value, exactly as `InviteClaim` and `ConfirmAnswer` do.
 * Measured against the running prototype at 1440x900: scale 0.45, column
 * 580.5x265.3 at (422.3, 317.3), headline 36.3px tall, CTA 580.5x59.4.
 *
 * `isClaimPhone()` returns `false` in the reference — "one composition
 * everywhere: the phone posture stays off" — so its `kindPhone` branch is dead
 * code and this composition is what every viewport gets, exactly as there.
 *
 * ── RECORDED DEVIATION (2026-08-20): the headline ──────────────────────────
 * `To save your progress verify your email:` ships verbatim, by explicit
 * product direction, overriding this file's earlier refusal of it — and the
 * matching entry has left `FOUNDER_FLOW_ABSENCES`, because a register saying an
 * element is absent while the page renders it is worse than no register.
 *
 * It is recorded rather than quietly swapped, the way the 2026-08-10 Admin-MFA
 * removal and screen 1's legal line are: it was refused because progress is
 * already saved — §9's autosave has been writing every answer through the draft
 * token since screen 2, and the invitation link is what brings a Founder back
 * to all of it. That is still exactly how the product BEHAVES. What changed is
 * one sentence, and nothing else: no save path moved, and confirming an address
 * still saves nothing that was not already saved.
 *
 * ── RECORDED DEVIATION (2026-08-20): the field's ink while focused ─────────
 * The reference greys the address to `#A2AFA8` on focus and returns it to
 * `#013F17` on blur (`emailFg:st.emailFocus?'#A2AFA8':'#013F17'`). That ships
 * too, and its absence-register entry has gone with the headline's. The earlier
 * refusal stands as a fact — it is `--grey` on `--white`, about 2.2:1, on text
 * a person is actively typing — so the mitigation is that the underline is what
 * marks focus and it is a real focus ring: `:focus-within` swaps the dashed
 * brand rule for a solid one, which the reference does not have and which costs
 * the composition nothing (§28.5).
 *
 * ── It writes the claim profile, not a new record ───────────────────────────
 * `founder_claim_profiles.email`, through the route that already owns it. The
 * address is prefilled from the invitation and `emailSupplier` records which of
 * the two it is (§5.2): unchanged is `invited_link`, edited is
 * `self_supplied_unverified` — and the code, next screen, is what turns either
 * into `code_verified`.
 *
 * ── The typed value never comes back from the server ────────────────────────
 * `useAutosave` reports an outcome and returns nothing, deliberately: the
 * caller's state is the only copy of what was typed, and that one decision is
 * the whole autosave bug class (§9: "a failed save never clears valid fields").
 *
 * ── What the reference does not draw, and what happened to it ───────────────
 * The reference gives this screen no chrome at all beyond one control: no
 * wordmark, no HELP, no message badge, no field label, no save status, no hint.
 * `[data-verify]` is `position:fixed;inset:0;z-index:25` over an empty page with
 * a `Back` control bottom-left. All of that is followed — `.ff__top` is hidden
 * here as it is on the invite, and no badge is asked for. Three things survive
 * it, all because they are behaviour rather than decoration:
 *
 *   1. The field has an accessible name (`aria-label`). A 104px input with no
 *      label is unusable with a screen reader, and an `aria-label` renders
 *      nothing (§28.5, §33.11.2).
 *   2. A save that FAILS says so. It renders below the CTA, absolutely
 *      positioned so it cannot move the composition, and is a `.sr-only` live
 *      region in every state the reference actually has (idle, saving, saved).
 *      §1.1 requires the failure state; a silent one is the §1.4 failure.
 *   3. The loading state before the record arrives. The reference has a record
 *      in memory and never waits for one.
 *
 * The prefill note — "Filled in from your invitation" — has no slot on this
 * screen and is not invented one. The address IS the prefill, in a field an
 * `aria-label` names and a pencil marks as editable.
 *
 * ── The CTA refuses rather than no-opping ──────────────────────────────────
 * The reference's `confirmEmail` is `if(/.+@.+\..+/.test(email)) step(...)` —
 * the same shape test, and a click on something that is not an address does
 * nothing at all. `disabled` is that behaviour with the browser announcing it,
 * and it renders identically: there is no disabled treatment in the reference
 * to contradict, and the state the reference SHOWS (a valid prefilled address)
 * is not it.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useParams } from 'react-router';
import { founderFlowPath } from '@proovd/shared';
import { Measure, Section, StatePanel } from '../../components/index.js';
import { stageRelayIn } from '../../components/anim.js';
import { describeSaveState } from '../../lib/autosave.js';
import { useAutosave } from '../../lib/useAutosave.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import {
  fetchClaim,
  saveClaim,
  requestEmailCode,
  type ClaimPatch,
  type ClaimView,
} from '../draft/api.js';
import { FlowPage, flowDirection, useFlowNav } from './FlowPage.js';

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()` for a page it treats as ordinary: the stage's own size as the
   divisors, and `pageScale` alone. Screen 1's `claimFit` divides by 1440x1420
   instead, which is why the invite reads a notch larger than this. */

const FIT_W = 2496;
const FIT_H = 1542;
/** The prototype's `pageScale` prop default. */
const PAGE_SCALE = 0.78;

function stageScale(): number {
  return (
    Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * PAGE_SCALE
  );
}

/**
 * The reference's own relay order for this screen, out of `verifyIntro`'s fixed
 * list. Passed to `stageRelayIn` rather than read from the DOM, because the
 * 0.085s stagger follows THIS order and not document order.
 */
const RELAY = ['head', 'field', 'cta'] as const;

/** The reference's own shape test, verbatim: `/.+@.+\..+/`. */
/* ── Fitting the address to the field ───────────────────────────────────────
   The reference's field is a 1290px row holding the input, a 26px gap and a
   52px pencil, so the address itself gets 1212px at 104px/700/-0.035em. Its
   own sample — `ahmed.ehab@teeb.com` — measures 1080px and fits, which is why
   the prototype never shows this: a real address often does not. Measured in
   the running app, `ahmedhamerty112@gmail.com` needs 1387px and the input
   scrolls, hiding `@gmail.com` entirely.

   An `<input>` has no ellipsis and cannot wrap, so that overflow is silent:
   the field looks perfectly correct while the value it shows is wrong, on the
   one screen whose whole job is confirming that value.

   Width scales linearly with font-size — the tracking is in `em`, so it scales
   with it — which means one measurement at the stylesheet's own size gives the
   exact fit in a single step. The size is reduced ONLY when it has to be, so
   every address that fitted before still renders at the reference's 104px and
   the composition is untouched. Nothing else moves: the column, the row, the
   gap, the dashed rule, the pencil and the button are all as they were, and
   the field's height is driven by the pencil rather than by the text. */

/** The floor. Below the pencil's own 52px the address reads as a caption
 *  beside the icon rather than as the field's value, and an address long
 *  enough to reach it (about 47 characters) is far past anything real. */
const EMAIL_MIN_SIZE = 52;

/** The width of `text` in an unscaled, detached span carrying the same face.
 *  A span rather than a canvas because `measureText` ignores letter-spacing,
 *  and this face is tracked at -0.035em — about 3.6px a character at 104px,
 *  which over a 25-character address is 91px of error. */
function textWidth(
  text: string,
  family: string,
  weight: string,
  sizePx: number,
  trackingPx: number,
): number {
  const probe = document.createElement('span');
  probe.textContent = text;
  probe.style.cssText =
    'position:fixed;left:-9999px;top:0;visibility:hidden;white-space:pre;padding:0;margin:0;border:0;';
  probe.style.fontFamily = family;
  probe.style.fontWeight = weight;
  probe.style.fontSize = sizePx + 'px';
  probe.style.letterSpacing = trackingPx + 'px';
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

function looksLikeAddress(value: string): boolean {
  return /.+@.+\..+/.test(value.trim());
}

export function EmailStep() {
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
        // Every failure, one surface. Branching here would reintroduce the
        // enumeration oracle the server carefully avoids (§5.5).
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (unavailable) return <LinkUnavailable />;

  if (!loaded) {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Opening your details"
            whatHappened="We're finding the address on your invitation. Nothing has been sent."
            next="Your email address appears in a moment."
            owner="Proovd"
            nextUpdate="Within a few seconds"
            action="No action needed"
            reference="Your invitation link"
          />
        </Measure>
      </Section>
    );
  }

  return (
    <FlowPage pageId="email" param={token}>
      <VerifyScreen token={token} loaded={loaded} />
    </FlowPage>
  );
}

/**
 * The screen, and the one place its scale and its motion are owned.
 *
 * `relayIn` still runs on this page from `FlowPage` and still finds nothing to
 * do: every marker here is `data-stage-anim`, not `data-anim`. That is the
 * whole mechanism — there is no flag to set and no branch in `FlowPage` to keep
 * in step.
 */
function VerifyScreen({ token, loaded }: { token: string; loaded: ClaimView }) {
  const { leave } = useFlowNav();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  // Read once, during the first render: `FlowPage` resets the module value in
  // its own layout effect, and a later re-render would read the reset.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  const [address, setAddress] = useState(loaded.profile.fields.email.value ?? '');
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);

  const autosave = useAutosave<ClaimPatch>(
    useCallback((patch: ClaimPatch) => saveClaim(token, patch), [token]),
  );

  // `fitStages`, for this page. First, so the first paint is already at the
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
  }, []);

  // Keep the whole address on screen. Runs on every change because the value
  // is editable here, and again once Satoshi has settled — measuring the
  // fallback face gives a width the real one does not have (DNA §6.4's own
  // reasoning, applied to a measurement rather than to a split).
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    let cancelled = false;
    const fit = () => {
      if (cancelled || !field.current) return;
      const input = field.current;
      // Clear both first, so the base reads are the stylesheet's own rather
      // than whatever this effect set last time.
      input.style.fontSize = '';
      input.style.height = '';
      const style = getComputedStyle(input);
      const base = Number.parseFloat(style.fontSize);
      const available = input.clientWidth;
      // The row's height at the reference's own size. A smaller font gives a
      // shorter line box, which would lift the dashed rule and carry the
      // button up with it — so the box is pinned to its base and only the
      // glyphs inside it get smaller. Nothing below the field moves.
      const baseHeight = input.clientHeight;
      if (!Number.isFinite(base) || !available || !input.value) return;
      const needed = textWidth(
        input.value,
        style.fontFamily,
        style.fontWeight,
        base,
        Number.parseFloat(style.letterSpacing) || 0,
      );
      // One character's worth of slack: the caret sits past the last glyph,
      // and a value that measured exactly to the edge would still scroll.
      if (needed <= available - 4) return;
      input.style.fontSize =
        Math.max(
          EMAIL_MIN_SIZE,
          Math.floor((base * (available - 4)) / needed),
        ) + 'px';
      input.style.height = baseHeight + 'px';
    };
    fit();
    void document.fonts?.ready.then(fit);
    return () => {
      cancelled = true;
    };
  }, [address]);

  const status = describeSaveState(autosave.state);
  const valid = looksLikeAddress(address);

  function change(next: string) {
    setAddress(next);
    autosave.queue({ email: next });
  }

  async function send() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      // The address has to be stored before the code is minted — the code's
      // hash binds it, so a code sent against a half-saved address would not
      // verify against the saved one.
      await autosave.flush();
      // One answer for every outcome, and nothing here branches on it.
      await requestEmailCode(token);
      leave(founderFlowPath('code', token), 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ff-verify" ref={root}>
      {/* The reference's own control, bottom-left. Its label names where it
          goes only to a screen reader: the visible word is its own `Back`, and
          §33.11.4's objectless-CTA rule is answered by the accessible name
          rather than by overriding the reference's copy. */}
      <button
        type="button"
        className="ff-verify__back"
        aria-label="Back to Campaign type"
        onClick={() => leave(founderFlowPath('campaign-type', token), -1)}
      >
        <svg
          viewBox="0 0 24 24"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 5 8 12l7 7" />
        </svg>
        Back
      </button>

      <div className="ff-verify__stage" data-page-stage="1" ref={stage}>
        <div className="ff-verify__col">
          <h1 className="ff-verify__head" data-stage-anim="head">
            To save your progress verify your email:
          </h1>

          <div className="ff-verify__field" data-stage-anim="field">
            <input
              ref={field}
              className="ff-verify__input"
              type="email"
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              aria-label="Your email address"
              value={address}
              data-focus={focused ? 'on' : undefined}
              onChange={(event) => change(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(event) => {
                // Enter advances only where the page's single control is a
                // one-line input, and this is that case. The reference binds
                // no key at all; this costs the composition nothing and is the
                // one thing a keyboard user would otherwise have to hunt for.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            {/* Decorative: the field is already named, and a pencil that
                announced itself would announce it twice. */}
            <svg
              className="ff-verify__pencil"
              viewBox="0 0 24 24"
              width="52"
              height="52"
              fill="none"
              stroke="#A2AFA8"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </div>

          <button
            type="button"
            className="ff-verify__cta"
            data-stage-anim="cta"
            disabled={!valid || busy}
            onClick={() => void send()}
          >
            Confirm email
          </button>

          {/* Absolutely positioned, so it can never move the composition, and
              visible only in the one state the reference does not have. */}
          <p
            className="ff-verify__status"
            role="status"
            aria-live="polite"
            data-state={autosave.state.status}
          >
            {status}
          </p>
        </div>
      </div>
    </div>
  );
}
