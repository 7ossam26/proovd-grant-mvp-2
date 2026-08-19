/**
 * Screen 1 — the password — Creator Flow v2, Session B, 2026-08-19.
 *
 * ── The requirement list is what the server enforces, and nothing more ──────
 * The reference draws four live checks: eight characters, an upper, a lower, a
 * special. `completeAffiliateSignup` enforces exactly one thing — twelve
 * characters — so shipping the reference's list would tick all four for an
 * eight-character password and then be refused at the claim, six screens later.
 * That is §1.1's failure with a green tick on it.
 *
 * The list matches the server rather than the server being changed to match the
 * list, and `CREATOR_PASSWORD_REQUIREMENTS` is where that decision is written
 * down. A checklist where three of four ticks decide nothing teaches people
 * that ticks are decorative, which is worse than a short list.
 *
 * ── It is written nowhere ───────────────────────────────────────────────────
 * There is no account yet, so there is nothing to send it to; and it must not
 * go into `sessionStorage` or `localStorage`, where a credential would outlive
 * the tab and be readable by anything running in the page. It is held in a
 * module variable for the length of the walk (`draft.ts`), which a reload
 * loses — and losing it costs one re-ask at the end and nothing else, because
 * every profile answer is saved as it is typed.
 *
 * The screen says so, because somebody who reloads and is asked again should
 * have been told it would happen rather than discovering it.
 *
 * ── The confirm field grows in ──────────────────────────────────────────────
 * The reference's beat, kept: it appears once the password meets the
 * requirement. `data-anim="grow"` is what `relayIn` scales in.
 */

import { useState } from 'react';
import { useParams } from 'react-router';
import {
  CREATOR_PASSWORD_NEVER_PLAIN,
  CREATOR_PASSWORD_NOT_KEPT,
  CREATOR_PASSWORD_REQUIREMENTS,
  creatorPasswordMeetsRequirements,
} from '@proovd/shared';
import { Button, Field } from '../../components/index.js';
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
    <CreatorFlowPage pageId="password" param={token}>
      <Body />
    </CreatorFlowPage>
  );
}

function Body() {
  const { leaveToPage } = useCreatorFlowNav();
  const [value, setValue] = useState(() => draftPassword() ?? '');
  const [confirm, setConfirm] = useState(() => (draftPassword() ? (draftPassword() as string) : ''));
  const [touchedConfirm, setTouchedConfirm] = useState(false);

  const strong = creatorPasswordMeetsRequirements(value);
  const matches = confirm === value;
  const mismatch = strong && touchedConfirm && confirm !== '' && !matches;
  const ready = strong && matches && confirm !== '';

  function advance() {
    if (!ready) return;
    setDraftPassword(value);
    leaveToPage('profile', 1);
  }

  return (
    <div className="crf-pw">
      <h1 className="crf-pw__head" data-anim="head">
        Set a password.
      </h1>
      <p className="crf-pw__lede" data-anim="sub">
        Keep your account yours. {CREATOR_PASSWORD_NEVER_PLAIN}
      </p>

      <div className="crf-pw__field" data-anim="field">
        <Field label="Your password">
          <input
            className="input crf-pw__input"
            type="password"
            autoComplete="new-password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>

        <ul className="crf-pw__reqs">
          {CREATOR_PASSWORD_REQUIREMENTS.map((requirement) => {
            const met = requirement.met(value);
            return (
              <li
                key={requirement.id}
                className={met ? 'crf-pw__req is-met' : 'crf-pw__req'}
                // The tick is decoration; the state is in the text, because a
                // requirement conveyed by colour alone is conveyed to nobody
                // using a screen reader (§28.5, DNA §1).
              >
                <span className="crf-pw__tick" aria-hidden="true" />
                <span className="crf-pw__req-label">
                  {requirement.label}
                  <span className="sr-only">{met ? ' — met' : ' — not yet met'}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {strong ? (
        <div className="crf-pw__confirm" data-anim="grow">
          <Field label="Confirm it" error={mismatch ? "Those do not match yet." : undefined}>
            <input
              className="input crf-pw__input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => {
                setTouchedConfirm(true);
                setConfirm(event.target.value);
              }}
            />
          </Field>
        </div>
      ) : null}

      <p className="crf-pw__note" data-anim="sub">
        {CREATOR_PASSWORD_NOT_KEPT}
      </p>

      <div className="crf-nav" data-anim="cta">
        <Button tier="tertiary" onClick={() => leaveToPage('welcome', -1)}>
          Back to Your invitation
        </Button>
        <Button tier="primary" disabled={!ready} onClick={advance}>
          Next: about you
        </Button>
      </div>
    </div>
  );
}
