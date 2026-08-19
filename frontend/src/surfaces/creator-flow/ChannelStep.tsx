/**
 * Screen 3 — your channel — Creator Flow v2, Session B, 2026-08-19.
 *
 * The reference's heading is accurate and is kept: this IS the §11 public card
 * — the seven columns `listFounderVisibleRoster` projects to a Founder.
 *
 * ── Nine tiles over seven subtypes, and there is still one subtype register ──
 * The reference splits social into YouTube, TikTok and Instagram, which is a
 * presentation question a Creator can answer. §5.3's seven subtypes are what
 * decide which VERIFICATION EVIDENCE an Admin had to record, which is not.
 * `CREATOR_CHANNEL_TILES` carries the subtype each tile belongs to plus, for
 * the three social ones, a platform — landing in the `platform` evidence input
 * §5.3 already names, so the split costs no new field.
 *
 * A tile that disagrees with the recorded classification is NOT resolved here.
 * Overwriting `affiliate_prospects.subtype` would silently invalidate a
 * verification recorded against it, which is the exact reason the subtype has
 * rendered read-only since Phase 08b. The disagreement is a fact for an Admin
 * (`creatorChannelDisagreesWithSubtype`) and the screen says so.
 *
 * The ninth tile is `niche_marketer` — a real §5.3 subtype — rather than the
 * reference's `Other`, which maps to nothing and would leave a Creator
 * classified as a subtype that does not exist.
 *
 * ── The niche is a closed list over a free-text column ──────────────────────
 * `audience_niche` is `text` with a supplier triple, and an Admin who wrote
 * "B2B SaaS founders" during §8 research has said something more useful than
 * any list entry. So the register owns the twelve options and the select
 * additionally offers whatever is already stored — a select that silently
 * dropped a prefilled value would lose §11's prefill on first render.
 *
 * ── The outreach plan is §5.3's own field ───────────────────────────────────
 * `student_affiliate`'s evidence input is literally `promotion_plan`, so the
 * student-only textarea IS that field and is keyed to it. It is asked of a
 * student and of nobody else, because §5.3 asks it of nobody else.
 *
 * ── One sentence the reference draws that is not true yet ───────────────────
 * *"You can edit all of this later under Profile."* Settings is Session F, and
 * §5.3 licenses that right while the product has no route for it — which is the
 * gap the last session closes. Until then the honest sentence is that a
 * correction goes through a person, and it is a constant so the swap is one
 * edit.
 */

import { useState } from 'react';
import { useParams } from 'react-router';
import {
  CHANNEL_TYPE_IS_ADMIN_CLASSIFICATION,
  CREATOR_AUDIENCE_NICHES,
  CREATOR_CHANNEL_CORRECTIONS_TODAY,
  CREATOR_CHANNEL_IS_THE_PUBLIC_CARD,
  CREATOR_CHANNEL_TILES,
  creatorChannelDisagreesWithSubtype,
} from '@proovd/shared';
import type { AffiliateSubtype } from '@proovd/shared';
import { Button, Field, Textarea } from '../../components/index.js';
import { describeSaveState } from '../../lib/autosave.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { CreatorFlowPage, useCreatorFlowNav } from './CreatorFlowPage.js';
import { useInvitation, useInvitationSave } from './useInvitation.js';
import type { CreatorInvitationState } from '../creator/api.js';

export function ChannelStep() {
  const { token = '' } = useParams();
  const { state, unavailable } = useInvitation(token);

  if (unavailable) return <LinkUnavailable />;
  if (!state) {
    return <SurfaceLoading subject="your channel" reference="Your invitation link" />;
  }

  return (
    <CreatorFlowPage pageId="channel" param={token}>
      <Body token={token} loaded={state} />
    </CreatorFlowPage>
  );
}

function Body({ token, loaded }: { token: string; loaded: CreatorInvitationState }) {
  const { leave, leaveToPage } = useCreatorFlowNav();
  const fields = loaded.profile.fields;
  const autosave = useInvitationSave(token);

  const [tile, setTile] = useState(fields['channelType']?.value ?? '');
  const [reference, setReference] = useState(fields['channelReference']?.value ?? '');
  const [niche, setNiche] = useState(fields['audienceNiche']?.value ?? '');
  const [description, setDescription] = useState(fields['nicheDescription']?.value ?? '');
  const [plan, setPlan] = useState(fields['outreachPlan']?.value ?? '');

  const chosen = CREATOR_CHANNEL_TILES.find((t) => t.id === tile);
  const isStudent = chosen?.subtype === 'student_affiliate';
  const recorded = loaded.profile.channelSubtype as AffiliateSubtype | null;
  const disagrees =
    tile !== '' && recorded !== null && creatorChannelDisagreesWithSubtype(tile, recorded);

  // The stored value survives even when it is not one of the twelve — §8's
  // research is often more specific than any list entry.
  const nicheOptions =
    niche !== '' && !CREATOR_AUDIENCE_NICHES.includes(niche)
      ? [niche, ...CREATOR_AUDIENCE_NICHES]
      : CREATOR_AUDIENCE_NICHES;

  const ready = tile !== '' && reference.trim() !== '';

  async function advance() {
    if (!ready) return;
    await autosave.flush();
    // Screen 4 is Session C's. Until it lands, forward is Phase 08b's compact
    // signup at its interim address — which is a real page that finishes the
    // account, not a placeholder. The Founder flow's Session B handed off to
    // `/draft/:token/vetting` for exactly this stretch and Session C retired
    // it; this is the same arrangement and the same ending.
    //
    // It is addressed directly rather than through `creatorFlowPath`, because
    // it is NOT one of the flow's pages: it is in no register, has no help
    // card, and is going away. A register entry for a page about to be deleted
    // is a register that lies.
    leave(`/creator-invitation/${encodeURIComponent(token)}/finish`, 1);
  }

  return (
    <div className="crf-channel">
      <h1 className="crf-channel__head" data-anim="head">
        What founders see.
      </h1>
      <p className="crf-channel__lede" data-anim="sub">
        {CREATOR_CHANNEL_IS_THE_PUBLIC_CARD}
      </p>

      <fieldset className="crf-channel__tiles" data-anim="field">
        <legend className="crf-channel__legend">Where do you post?</legend>
        <div className="crf-channel__grid">
          {CREATOR_CHANNEL_TILES.map((option) => {
            const pressed = option.id === tile;
            return (
              <button
                key={option.id}
                type="button"
                className={pressed ? 'crf-tile is-on' : 'crf-tile'}
                aria-pressed={pressed}
                onClick={() => {
                  setTile(option.id);
                  autosave.queue({ channelType: option.id });
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {disagrees ? (
        <p className="crf-channel__disagree" role="status">
          {CHANNEL_TYPE_IS_ADMIN_CLASSIFICATION}
        </p>
      ) : null}

      <div className="crf-channel__fields" data-anim="field">
        <Field label="Handle or link">
          <input
            className="input"
            value={reference}
            spellCheck={false}
            onChange={(event) => {
              setReference(event.target.value);
              autosave.queue({ channelReference: event.target.value });
            }}
          />
        </Field>

        <Field label="Audience niche">
          <select
            className="input"
            value={niche}
            onChange={(event) => {
              setNiche(event.target.value);
              autosave.queue({ audienceNiche: event.target.value });
            }}
          >
            <option value="">Choose one</option>
            {nicheOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Niche description">
          <Textarea
            rows={3}
            placeholder="What your content is about"
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              autosave.queue({ nicheDescription: event.target.value });
            }}
          />
        </Field>

        {isStudent ? (
          <div className="crf-channel__student" data-anim="grow">
            <Field
              label="How you reach your network"
              hint="Your promotion plan — this is what we check a student channel on."
            >
              <Textarea
                rows={3}
                value={plan}
                onChange={(event) => {
                  setPlan(event.target.value);
                  autosave.queue({ outreachPlan: event.target.value });
                }}
              />
            </Field>
          </div>
        ) : null}
      </div>

      <p className="crf-channel__note" data-anim="sub">
        {CREATOR_CHANNEL_CORRECTIONS_TODAY}
      </p>

      <div className="crf-nav" data-anim="cta">
        <Button tier="tertiary" onClick={() => leaveToPage('profile', -1)}>
          Back to You
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
          Next: finish your account
        </Button>
      </div>
    </div>
  );
}
