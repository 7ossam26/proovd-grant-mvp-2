/**
 * Screen 5 — your bio — Creator Flow v2, Session C, 2026-08-19.
 *
 * ── One handle field, not two ───────────────────────────────────────────────
 * The reference draws a `Username` input here, beside the `public_handle`
 * screen 3 conceptually owns. That is one column and two boxes: two values that
 * eventually disagree, and a surface that would have to pick one to show a
 * Founder. `CREATOR_FLOW_ABSENCES` refuses it, and what renders instead is the
 * one field, editable — because §11's correction right applies to it and it is
 * the only name a Founder ever sees.
 *
 * ── The photo is a named absence, not a dead control ────────────────────────
 * §12's object storage is Track A4 and `unconfiguredStorage` throws rather than
 * pretending. So there is no presign route to call, no `<input type="file">` on
 * this page, and `profile_photo_key` stays unread. §1.4's two honest options
 * are hide the control or say what it IS; hiding it would make the flow
 * describe a smaller product than the one being built. The Affiliate evidence
 * uploader took the same position on 2026-08-17, and the server sends
 * `uploads.available` so the surface is not guessing at the deployment.
 *
 * ── The bio is Proovd's draft and the Creator's answer ──────────────────────
 * `affiliate_prospects.admin_bio` is what somebody at Proovd wrote after
 * researching the channel. §11 requires both the label saying so and the
 * ability to change it, and the label flips the moment they type.
 */

import { useState } from 'react';
import { useParams } from 'react-router';
import {
  CREATOR_BIO_PREFILL_NOTE,
  CREATOR_PHOTO_UNAVAILABLE,
  CREATOR_PRESENCE_HEAD,
  CREATOR_PRESENCE_LEDE,
} from '@proovd/shared';
import { Button, Field, Textarea } from '../../components/index.js';
import { describeSaveState } from '../../lib/autosave.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { CreatorFlowPage, useCreatorFlowNav } from './CreatorFlowPage.js';
import { useInvitation, useInvitationSave } from './useInvitation.js';
import type { CreatorInvitationState } from '../creator/api.js';

export function PresenceStep() {
  const { token = '' } = useParams();
  const { state, unavailable } = useInvitation(token);

  if (unavailable) return <LinkUnavailable />;
  if (!state) {
    return <SurfaceLoading subject="your bio" reference="Your invitation link" />;
  }

  return (
    <CreatorFlowPage pageId="presence" param={token}>
      <Body token={token} loaded={state} />
    </CreatorFlowPage>
  );
}

function Body({ token, loaded }: { token: string; loaded: CreatorInvitationState }) {
  const { leaveToPage } = useCreatorFlowNav();
  const fields = loaded.profile.fields;
  const autosave = useInvitationSave(token);

  const [handle, setHandle] = useState(fields['publicHandle']?.value ?? '');
  const [bio, setBio] = useState(fields['bio']?.value ?? '');

  const bioIsProovds = fields['bio']?.supplier === 'proovd' && bio === fields['bio']?.prefilled;
  const ready = handle.trim() !== '';

  async function advance() {
    if (!ready) return;
    await autosave.flush();
    leaveToPage('verify', 1);
  }

  return (
    <div className="crf-presence">
      <h1 className="crf-presence__head" data-anim="head">
        {CREATOR_PRESENCE_HEAD}
      </h1>
      <p className="crf-presence__lede" data-anim="sub">
        {CREATOR_PRESENCE_LEDE}
      </p>

      {/* Where the reference draws its photo control. The reason is in the
          place the control would have been, and there is nothing to press. */}
      {loaded.uploads.available ? null : (
        <p className="crf-presence__absent" data-anim="panel">
          {CREATOR_PHOTO_UNAVAILABLE}
        </p>
      )}

      <div className="crf-presence__fields" data-anim="field">
        <Field
          label="Public name or handle"
          hint="What your audience knows you as. This is the only name a Founder sees."
        >
          <input
            className="input"
            value={handle}
            spellCheck={false}
            onChange={(event) => {
              setHandle(event.target.value);
              autosave.queue({ publicHandle: event.target.value });
            }}
          />
        </Field>

        <Field label="Short bio" hint={bioIsProovds ? CREATOR_BIO_PREFILL_NOTE : 'You wrote this.'}>
          <Textarea
            rows={5}
            placeholder="Who you are and what you cover. Founders read this."
            value={bio}
            onChange={(event) => {
              setBio(event.target.value);
              autosave.queue({ bio: event.target.value });
            }}
          />
        </Field>
      </div>

      <div className="crf-nav" data-anim="cta">
        <Button tier="tertiary" onClick={() => leaveToPage('voice', -1)}>
          Back to Your voice
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
          Next: your numbers
        </Button>
      </div>
    </div>
  );
}
