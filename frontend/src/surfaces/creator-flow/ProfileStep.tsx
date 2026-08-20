/**
 * Screen 2 — you — rebuilt 1:1 from
 * `docs/design-refrence/Proovd_Affiliate_Founder_Rebuild_v11_FIXED_SHAREABLE.html`
 * (2026-08-20).
 *
 * The reference's `moment-profile` is the authority for every value here: the
 * structure (`.obrow` → `.obhead` / `.obbody` / `.ob-inline-action`), the copy,
 * the three fields and their grid placement, the locked email row, and the
 * relay that carries the heading in from the right. PHASE 51 in `proovd.css`
 * carries the declarations; `creatorMomentIn` carries the timeline, shared with
 * screen 1, which is the same composition.
 *
 * ── It renders `bare`, and owns its own header ──────────────────────────────
 * PHASE 50's precedent, one screen later. `showBrand` is `!showBack` in the
 * reference, so on every step past the invitation the header is one thing —
 * `← Back` on the left — and the wordmark is absent by design. Reproducing the
 * screen means reproducing that, so the page goes `bare` and draws the bar.
 *
 * ── DELIBERATELY INVERTED: the email is read-only here ──────────────────────
 * It was an editable input with a supplier hint under it; the reference renders
 * the address and a `Locked` chip, and gates its CTA on `nameOk()` — the name
 * alone. Both are reproduced. §11's correction right is not withdrawn by that:
 * `CREATOR_SETTINGS_FIELDS` carries `email` and Session F built the recorded
 * correction path behind it, so what moved is which surface takes the change,
 * not whether one can be made. `CREATOR_EMAIL_IS_WHERE_WE_WRITE` says so.
 *
 * The column keeps its supplier triple and `saveSignupProfile` still accepts
 * the key — nothing about the record moved, and no route was closed.
 *
 * ── The DOM order is name, email, phone; the grid reads name, phone, email ──
 * The reference's own arrangement (`profile-field--email` is `grid-column:1/-1;
 * grid-row:2`). It is not a tab-order defect, because the email row holds no
 * focusable control: the tab path is name → phone → Continue, which is exactly
 * the visual order.
 *
 * ── What the states are ─────────────────────────────────────────────────────
 * loading    the shell's own read state, before the record arrives
 * prefilled  every field carries what §8 recorded; CTA enabled, arrow present
 * empty name the CTA is disabled and — the reference's own detail — loses its
 *            arrow, because its two button branches are different markup
 * saving     nothing visible; the reference has no slot and the write is quiet
 * retrying   the save is coming back, said where the reference puts its one
 * failed     line of trouble copy, under the fields (§1.1 wants the state)
 * unavailable the token did not resolve — one answer for all five (§5.5)
 *
 * ── Nothing here computes anything about a person ───────────────────────────
 * No age from a date, no country from an address, no validity from a phone
 * shape. §11 records what somebody states.
 */

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useParams } from 'react-router';
import {
  CREATOR_PROFILE_CTA,
  CREATOR_PROFILE_EMAIL_LABEL,
  CREATOR_PROFILE_EMAIL_LOCKED_TAG,
  CREATOR_PROFILE_HEAD,
  CREATOR_PROFILE_NAME_LABEL,
  CREATOR_PROFILE_PHONE_LABEL,
  CREATOR_PROFILE_PREFILL_NOTE,
} from '@proovd/shared';
import { creatorMomentIn } from '../../components/anim.js';
import { describeSaveState } from '../../lib/autosave.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { CreatorFlowPage, useCreatorFlowNav } from './CreatorFlowPage.js';
import { useInvitation, useInvitationSave } from './useInvitation.js';
import type { CreatorInvitationState } from '../creator/api.js';

export function ProfileStep() {
  const { token = '' } = useParams();
  const { state, unavailable } = useInvitation(token);

  if (unavailable) return <LinkUnavailable />;
  if (!state) {
    return <SurfaceLoading subject="your details" reference="Your invitation link" />;
  }

  return (
    <CreatorFlowPage pageId="profile" param={token} bare>
      <Body token={token} loaded={state} />
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

function Body({ token, loaded }: { token: string; loaded: CreatorInvitationState }) {
  const { leaveToPage } = useCreatorFlowNav();
  const stageRef = useRef<HTMLDivElement>(null);
  const fields = loaded.profile.fields;
  const autosave = useInvitationSave(token);

  // The caller's state is the only copy of what was typed. Nothing refetches
  // after a save (§9), so a failure cannot clear a valid field.
  const [legalName, setLegalName] = useState(fields['legalName']?.value ?? '');
  const [phone, setPhone] = useState(fields['phone']?.value ?? '');
  const email = fields['email']?.value ?? '';

  // `nameOk()` — the reference gates this step on the name alone.
  const ready = legalName.trim() !== '';

  // The relay: head, then lede, then the CTA when it is enabled. Keyed on
  // nothing so it plays once per mount rather than restarting mid-typing when
  // the CTA's enabled-ness changes, which is what the reference does.
  useLayoutEffect(() => creatorMomentIn(stageRef.current, 1, 'you'), []);

  async function advance() {
    if (!ready) return;
    await autosave.flush();
    leaveToPage('channel', 1);
  }

  /** `enterNext`: step 2 has no field-chaining branch, so Enter advances. */
  function onEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void advance();
  }

  const save = autosave.state;
  const trouble = save.status === 'retrying' || save.status === 'failed';

  return (
    <div className="crf-you" ref={stageRef}>
      <header className="crf-you__bar">
        {/* The visible label is the reference's own word. The accessible name
            names the destination and CONTAINS that word, so §33.11.4's point
            is served for a screen reader and voice control still matches what
            is on screen (WCAG 2.5.3). */}
        <button
          type="button"
          className="crf-you__back"
          aria-label="Back to your password"
          onClick={() => leaveToPage('password', -1)}
        >
          <BackArrow />
          Back
          {/* §33.11.4 reads `textContent`, not the accessible name, so the
              `aria-label` above does not satisfy it on its own. The visible word
              stays the reference's; the destination rides in an `sr-only` span.
              Added 2026-08-20 with screen 7's rebuild, which hit the same check. */}
          <span className="sr-only"> to your password</span>
        </button>
      </header>

      <div className="crf-you__screen">
        <div className="crf-you__row">
          <div className="crf-you__head" data-you="head">
            <h1 className="crf-you__title">{CREATOR_PROFILE_HEAD}</h1>
            <p className="crf-you__lede" data-you="lede">
              {CREATOR_PROFILE_PREFILL_NOTE}
            </p>
          </div>

          <div className="crf-you__body">
            <div className="crf-you__field crf-you__field--name">
              <label className="crf-you__label" htmlFor="crf-you-name">
                {CREATOR_PROFILE_NAME_LABEL}
              </label>
              <input
                className="crf-you__input"
                id="crf-you-name"
                autoComplete="name"
                value={legalName}
                onChange={(event) => {
                  setLegalName(event.target.value);
                  autosave.queue({ legalName: event.target.value });
                }}
                onKeyDown={onEnter}
              />
            </div>

            {/* Not an input, so there is nothing to mark readonly and nothing
                in the tab path. The chip is the reference's own word, and it
                is announced rather than left as a colour. */}
            <div className="crf-you__field crf-you__field--email">
              <span className="crf-you__label" id="crf-you-email-label">
                {CREATOR_PROFILE_EMAIL_LABEL}
              </span>
              <div
                className="crf-you__locked"
                role="group"
                aria-labelledby="crf-you-email-label"
              >
                <span className="crf-you__locked-value">{email}</span>
                <span className="crf-you__locked-tag">
                  {CREATOR_PROFILE_EMAIL_LOCKED_TAG}
                </span>
              </div>
            </div>

            <div className="crf-you__field crf-you__field--phone">
              <label className="crf-you__label" htmlFor="crf-you-phone">
                {CREATOR_PROFILE_PHONE_LABEL}
              </label>
              <input
                className="crf-you__input"
                id="crf-you-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  autosave.queue({ phone: event.target.value });
                }}
                onKeyDown={onEnter}
              />
            </div>

            {/* The reference has no save indicator, and a write that fails
                silently is a real loss rather than a stylistic one. So the
                quiet states are announced and not drawn, and only trouble takes
                a line — in the position and the treatment the reference gives
                trouble on screen 1, spanning the grid so nothing else moves. */}
            <p className="sr-only" role="status" aria-live="polite">
              {describeSaveState(save)}
            </p>
            {trouble ? (
              <p className="crf-you__trouble" aria-hidden="true">
                {describeSaveState(save)}
              </p>
            ) : null}
          </div>

          <div className="crf-you__action">
            <button
              type="button"
              className="crf-you__cta"
              data-you="cta"
              aria-label="Continue to your channel"
              disabled={!ready}
              onClick={() => void advance()}
            >
              {CREATOR_PROFILE_CTA}
              {ready ? <ForwardArrow /> : null}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
