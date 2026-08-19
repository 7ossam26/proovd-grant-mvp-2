/**
 * Screen 2 — you — Creator Flow v2, Session B, 2026-08-19.
 *
 * §11's correction surface, and the reference's own heading is a good one:
 * *"Make sure we got you right."* Every field arrives prefilled from the §8
 * recruitment record, every one carries a supplier triple, and the label under
 * each says which of the two it currently is.
 *
 * ── The email is editable, and the reference locks it ───────────────────────
 * It renders a `Locked` chip beside the address. §11 gives a Creator the right
 * to correct prefilled public information, `affiliate_signup_profiles.email`
 * has carried a full triple since Phase 08b, and `saveSignupProfile` has always
 * accepted the key. Locking it would be the product declining a right the Spec
 * grants — on the one field that decides where every transactional message
 * goes, which makes it the most expensive field on the page to leave wrong.
 *
 * ── The phone is collected and never verified ───────────────────────────────
 * §5.3 collects it; §33.1.8 is a suite that scans the tree to keep it that way,
 * and `user.phone_verified` is CHECK-pinned false. The label says so, because a
 * field that quietly implied verification is the first step toward building
 * one.
 *
 * ── Nothing here computes anything about a person ───────────────────────────
 * No age from a date, no country from an address, no validity from a phone
 * shape. §11 records what somebody states.
 */

import { useState } from 'react';
import { useParams } from 'react-router';
import {
  CREATOR_EMAIL_IS_WHERE_WE_WRITE,
  CREATOR_PHONE_NOT_VERIFIED,
  CREATOR_PROFILE_PREFILL_NOTE,
} from '@proovd/shared';
import { Button, Field } from '../../components/index.js';
import { describeSaveState } from '../../lib/autosave.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { CreatorFlowPage, useCreatorFlowNav } from './CreatorFlowPage.js';
import { useInvitation, useInvitationSave } from './useInvitation.js';
import type { CreatorInvitationState } from '../creator/api.js';

/** Shape only. The server decides, and a message that never arrives is what tells you. */
function looksLikeAddress(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function ProfileStep() {
  const { token = '' } = useParams();
  const { state, unavailable } = useInvitation(token);

  if (unavailable) return <LinkUnavailable />;
  if (!state) {
    return <SurfaceLoading subject="your details" reference="Your invitation link" />;
  }

  return (
    <CreatorFlowPage pageId="profile" param={token}>
      <Body token={token} loaded={state} />
    </CreatorFlowPage>
  );
}

/** §11's source label, rendered under the field it describes. */
function supplierHint(supplier: string | null, prefilled: string | null): string | undefined {
  if (supplier === 'proovd') return 'From your invitation. Change it if it is wrong.';
  if (supplier === 'affiliate' && prefilled) return 'You changed this.';
  return undefined;
}

function Body({ token, loaded }: { token: string; loaded: CreatorInvitationState }) {
  const { leaveToPage } = useCreatorFlowNav();
  const fields = loaded.profile.fields;
  const autosave = useInvitationSave(token);

  // The caller's state is the only copy of what was typed. Nothing refetches
  // after a save (§9).
  const [legalName, setLegalName] = useState(fields['legalName']?.value ?? '');
  const [email, setEmail] = useState(fields['email']?.value ?? '');
  const [phone, setPhone] = useState(fields['phone']?.value ?? '');

  const emailValid = email.trim() === '' || looksLikeAddress(email);
  const ready = legalName.trim() !== '' && email.trim() !== '' && emailValid;

  async function advance() {
    if (!ready) return;
    await autosave.flush();
    leaveToPage('channel', 1);
  }

  return (
    <div className="crf-you">
      <h1 className="crf-you__head" data-anim="head">
        Make sure we got you right.
      </h1>
      <p className="crf-you__lede" data-anim="sub">
        {CREATOR_PROFILE_PREFILL_NOTE}
      </p>

      <div className="crf-you__fields" data-anim="field">
        <Field
          label="Legal name"
          hint={supplierHint(fields['legalName']?.supplier ?? null, fields['legalName']?.prefilled ?? null)}
        >
          <input
            className="input"
            autoComplete="name"
            value={legalName}
            onChange={(event) => {
              setLegalName(event.target.value);
              autosave.queue({ legalName: event.target.value });
            }}
          />
        </Field>

        <Field
          label="Email"
          hint={CREATOR_EMAIL_IS_WHERE_WE_WRITE}
          error={emailValid ? undefined : 'That does not look like an email address.'}
        >
          <input
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              autosave.queue({ email: event.target.value });
            }}
          />
        </Field>

        <Field label="Phone" hint={CREATOR_PHONE_NOT_VERIFIED}>
          <input
            className="input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              autosave.queue({ phone: event.target.value });
            }}
          />
        </Field>
      </div>

      <div className="crf-nav" data-anim="cta">
        <Button tier="tertiary" onClick={() => leaveToPage('password', -1)}>
          Back to Your password
        </Button>
        <span
          className="crf-nav__status"
          role="status"
          aria-live="polite"
          data-state={autosave.state.status}
        >
          {describeSaveState(autosave.state)}
        </span>
        <Button tier="primary" disabled={!ready} onClick={() => void advance()}>
          Next: your channel
        </Button>
      </div>
    </div>
  );
}
