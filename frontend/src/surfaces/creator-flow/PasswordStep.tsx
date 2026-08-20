/**
 * Screen 1 — the password — rebuilt 1:1 from
 * `docs/design-refrence/Proovd_Affiliate_Founder_Rebuild_v11_FIXED_SHAREABLE.html`
 * (2026-08-20).
 *
 * The reference's `moment-password` is the authority for every value here: the
 * structure (`.obrow` → `.obhead` / `.obbody` / `.ob-inline-action`), the copy,
 * the four live checks, the confirm field that appears once all four pass, and
 * the relay that carries the heading in from the right. PHASE 50 in
 * `proovd.css` carries the declarations; `creatorPasswordIn` carries the
 * timeline.
 *
 * ── It renders `bare`, and owns its own header ──────────────────────────────
 * PHASE 49's precedent, one screen later. The shell's top bar is a wordmark and
 * a Help control; the reference's header on this step is one thing — `← Back`
 * on the left, with `showBrand` explicitly `!showBack` so the wordmark is
 * absent by design. Reproducing the screen means reproducing that, so the page
 * goes `bare` and draws the reference's own bar.
 *
 * ── The four checks, and the one number that is ours ────────────────────────
 * `CREATOR_PASSWORD_REQUIREMENTS` is the register and it says why: the
 * reference's first check is eight characters and `completeAffiliateSignup`
 * refuses anything under twelve, so the reference's own number would tick all
 * four for a password the server rejects six screens later. The label reads the
 * constant. Everything else — the order, the wording, the regexes, the 2×2
 * grid they fill row-major — is the reference's.
 *
 * ── What the states are ─────────────────────────────────────────────────────
 * empty      placeholder copy, four unticked boxes, no confirm field, CTA
 *            disabled and — the reference's own detail — WITHOUT its arrow
 * partial    ticks fill one at a time, .2s, colour and fill only
 * strong     all four met: the confirm field appears under a hairline rule
 * mismatch   pw2 typed and different: the reference's red line, exact copy
 * ready      pw2 matches: CTA enabled, brand fill, arrow present
 *
 * ── Enter moves, it does not submit ─────────────────────────────────────────
 * `enterNext` in the reference: on this step Enter in a field that has another
 * field after it focuses the NEXT one, and Enter in the last one advances. So
 * Enter in the password box goes to the confirm box rather than submitting a
 * half-finished form, and there is no `<form>` for a stray keystroke to submit.
 *
 * ── The password is still written nowhere ───────────────────────────────────
 * Unchanged, and load-bearing: there is no account yet, so there is nothing to
 * send it to, and it must not go into `sessionStorage` or `localStorage` where
 * a credential would outlive the tab. It is held in a module variable for the
 * length of the walk (`draft.ts`); a reload loses it and costs one re-ask at
 * the Agree screen, which asks rather than sending anybody backwards.
 *
 * The sentence that said so on this screen is gone, because the reference's
 * `.obbody` ends at the mismatch line and adding a paragraph would change the
 * composition. `CREATOR_PASSWORD_NOT_KEPT` is still exported for the surface
 * that wants to say it.
 */

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useParams } from 'react-router';
import {
  CREATOR_PASSWORD_CONFIRM_PLACEHOLDER,
  CREATOR_PASSWORD_CTA,
  CREATOR_PASSWORD_HEAD,
  CREATOR_PASSWORD_LEDE,
  CREATOR_PASSWORD_MISMATCH,
  CREATOR_PASSWORD_PLACEHOLDER,
  CREATOR_PASSWORD_REQUIREMENTS,
  creatorPasswordMeetsRequirements,
} from '@proovd/shared';
import { creatorPasswordIn } from '../../components/anim.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { CreatorFlowPage, useCreatorFlowNav } from './CreatorFlowPage.js';
import { draftPassword, setDraftPassword } from './draft.js';
import { useInvitation } from './useInvitation.js';

export function PasswordStep() {
  const { token = '' } = useParams();
  const { state, unavailable } = useInvitation(token);

  if (unavailable) return <LinkUnavailable />;
  if (!state) {
    return <SurfaceLoading subject="your invitation" reference="Your invitation link" />;
  }

  return (
    <CreatorFlowPage pageId="password" param={token} bare>
      <Body />
    </CreatorFlowPage>
  );
}

/** The reference's back chevron: 18px, stroke-width 2.4, round caps. */
function BackArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

/** The CTA arrow: 24px, stroke-width 2.6. Absent on the disabled control,
 *  which is the reference's own difference between its two button branches. */
function ForwardArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/** The tick: 12px in a 24 viewBox, stroke-width 3.4. Always present; PHASE 50
 *  moves its stroke from transparent so the box never reflows as it fills. */
function Tick() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      strokeWidth="3.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function Body() {
  const { leaveToPage } = useCreatorFlowNav();
  const stageRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState(() => draftPassword() ?? '');
  const [confirm, setConfirm] = useState(() => draftPassword() ?? '');

  const strong = creatorPasswordMeetsRequirements(value);
  // `pwMismatch()`: pw2 has been typed and differs. It says nothing while the
  // field is empty, so nobody is told they are wrong before they have answered.
  const mismatch = confirm.length > 0 && confirm !== value;
  // `pwOk()`: strong AND equal. An empty pw2 against an empty pw cannot pass,
  // because `strong` is false for an empty password.
  const ready = strong && confirm === value;

  // The relay: head, then lede, then the CTA when it is enabled. Re-run when
  // the CTA's enabled-ness changes would restart the entry mid-typing, so it is
  // keyed on nothing — it plays once per mount, as the reference's does.
  useLayoutEffect(() => creatorPasswordIn(stageRef.current, 1), []);

  function advance() {
    if (!ready) return;
    setDraftPassword(value);
    leaveToPage('profile', 1);
  }

  /** `enterNext`: move to the next field, or advance from the last one. */
  function onPasswordEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    if (confirmRef.current) {
      confirmRef.current.focus();
      return;
    }
    advance();
  }

  function onConfirmEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    advance();
  }

  return (
    <div className="crf-pw" ref={stageRef}>
      <header className="crf-pw__bar">
        <button
          type="button"
          className="crf-pw__back"
          onClick={() => leaveToPage('welcome', -1)}
        >
          <BackArrow />
          Back
        </button>
      </header>

      <div className="crf-pw__screen">
        <div className="crf-pw__row">
          <div className="crf-pw__head" data-pw="head">
            <h1 className="crf-pw__title">{CREATOR_PASSWORD_HEAD}</h1>
            <p className="crf-pw__lede" data-pw="lede">
              {CREATOR_PASSWORD_LEDE}
            </p>
          </div>

          <div className="crf-pw__body">
            <input
              className="crf-pw__input"
              type="password"
              autoComplete="new-password"
              placeholder={CREATOR_PASSWORD_PLACEHOLDER}
              aria-label={CREATOR_PASSWORD_PLACEHOLDER}
              aria-describedby="crf-pw-reqs"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={onPasswordEnter}
            />

            {/* A list, because it is one — the reference's four sibling divs
                read as four unrelated lines to a screen reader. The met/not-met
                state is in the text as well as the fill, because a requirement
                conveyed by colour alone is conveyed to nobody using one. */}
            <ul className="crf-pw__reqs" id="crf-pw-reqs">
              {CREATOR_PASSWORD_REQUIREMENTS.map((requirement) => {
                const met = requirement.met(value);
                return (
                  <li
                    key={requirement.id}
                    className={met ? 'crf-pw__req is-met' : 'crf-pw__req'}
                  >
                    <span className="crf-pw__box">
                      <Tick />
                    </span>
                    <span className="crf-pw__req-label">
                      {requirement.label}
                      <span className="sr-only">{met ? ' — met' : ' — not yet met'}</span>
                    </span>
                  </li>
                );
              })}
            </ul>

            {strong ? (
              <div className="crf-pw__confirm">
                <input
                  className="crf-pw__input"
                  type="password"
                  ref={confirmRef}
                  autoComplete="new-password"
                  placeholder={CREATOR_PASSWORD_CONFIRM_PLACEHOLDER}
                  aria-label={CREATOR_PASSWORD_CONFIRM_PLACEHOLDER}
                  aria-invalid={mismatch || undefined}
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  onKeyDown={onConfirmEnter}
                />
              </div>
            ) : null}

            {mismatch ? (
              <p className="crf-pw__mismatch" role="alert">
                {CREATOR_PASSWORD_MISMATCH}
              </p>
            ) : null}
          </div>

          <div className="crf-pw__action">
            <button
              type="button"
              className="crf-pw__cta"
              data-pw="cta"
              disabled={!ready}
              onClick={advance}
            >
              {CREATOR_PASSWORD_CTA}
              {ready ? <ForwardArrow /> : null}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
