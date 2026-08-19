/**
 * Screen 4 — your voice — Creator Flow v2, Session C, 2026-08-19.
 *
 * ── The question was re-authored, and the field was kept ────────────────────
 * The reference asks *"Pick a tone we should write your scripts in."* §30
 * defers AI pitch rewriting and refinement, §12 makes the helper resources
 * "static, copy-ready guidance—not an embedded AI product", and there is no
 * model client anywhere in this tree. Nothing writes anything in a tone, so
 * that question is a promise the product cannot keep (§1.4).
 *
 * What survives the re-authoring is real: the answer is what a Founder reads on
 * the §11 public card when deciding whether this Creator suits their campaign,
 * and it is the Creator's own statement about what they are good at.
 * `VOICE_IS_NEVER_USED_TO_REWRITE` travels with the control so the sentence
 * that makes the question honest is beside the question rather than in a
 * footer.
 *
 * ── It is a PUT, not an autosave patch ──────────────────────────────────────
 * The SET is the answer. Dropping a chip is expressed by sending the remaining
 * ones, so a merge would make removal unrepresentable — and 0055 supersedes
 * rather than edits, so every save is a new row and the previous answer
 * survives. Saving on `advance` rather than on every keystroke follows from
 * that: a row per chip-tap would be a history of somebody deciding.
 *
 * ── Every violation is named, and there are up to four at once ──────────────
 * `creatorVoiceViolations` returns a list rather than a boolean, so a Creator
 * who typed a long custom tone AND picked six chips is told both things rather
 * than fixing one and discovering the other. The same vocabulary runs on the
 * server, because the browser is not the boundary (`lib/session.ts`).
 */

import { useState } from 'react';
import { useParams } from 'react-router';
import {
  CREATOR_VOICE_CHIPS_HELP,
  CREATOR_VOICE_CHIPS_LABEL,
  CREATOR_VOICE_CUSTOM_LABEL,
  CREATOR_VOICE_FLEXIBLE_LABEL,
  CREATOR_VOICE_HEAD,
  CREATOR_VOICE_LEDE,
  CREATOR_VOICE_CUSTOM_MAX_LENGTH,
  CREATOR_VOICE_TONES,
  VOICE_IS_NEVER_USED_TO_REWRITE,
  creatorVoiceViolations,
  type CreatorVoiceViolation,
} from '@proovd/shared';
import { Button, Field } from '../../components/index.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { CreatorFlowPage, useCreatorFlowNav } from './CreatorFlowPage.js';
import { useInvitation } from './useInvitation.js';
import { saveCreatorVoice, CreatorRequestError } from '../creator/api.js';
import type { CreatorInvitationState } from '../creator/api.js';

/** One sentence per problem. The shape of the violation decides the words. */
function describeViolation(violation: CreatorVoiceViolation): string {
  switch (violation.kind) {
    case 'unknown_tone':
      return 'One of those tones is not one we recognise. Pick from the list or add your own.';
    case 'duplicate_tone':
      return 'That tone is already on your list.';
    case 'custom_too_long':
      return `"${violation.value}" is long for a chip — keep it to ${CREATOR_VOICE_CUSTOM_MAX_LENGTH} characters.`;
    case 'custom_blank':
      return 'A tone of your own needs some words in it.';
    case 'too_many_custom':
      return `That is ${violation.count} tones of your own. A Founder reads these at a glance, so keep it short.`;
    case 'too_many_total':
      return `That is ${violation.count} tones in total. Picking everything describes nothing — narrow it down.`;
  }
}

export function VoiceStep() {
  const { token = '' } = useParams();
  const { state, unavailable } = useInvitation(token);

  if (unavailable) return <LinkUnavailable />;
  if (!state) {
    return <SurfaceLoading subject="your voice" reference="Your invitation link" />;
  }

  return (
    <CreatorFlowPage pageId="voice" param={token}>
      <Body token={token} loaded={state} />
    </CreatorFlowPage>
  );
}

function Body({ token, loaded }: { token: string; loaded: CreatorInvitationState }) {
  const { leaveToPage } = useCreatorFlowNav();

  const [tones, setTones] = useState<string[]>(loaded.voice.tones);
  const [customTones, setCustomTones] = useState<string[]>(loaded.voice.customTones);
  const [flexible, setFlexible] = useState(loaded.voice.flexible);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const violations = creatorVoiceViolations({ tones, customTones, flexible });
  const saysSomething = tones.length > 0 || customTones.length > 0 || flexible;
  const ready = saysSomething && violations.length === 0;

  function toggle(id: string) {
    setRefusal(null);
    setTones((current) =>
      current.includes(id) ? current.filter((t) => t !== id) : [...current, id],
    );
  }

  function addCustom() {
    const value = draft.trim();
    if (value === '') return;
    setRefusal(null);
    // A duplicate is dropped rather than refused: somebody adding the same word
    // twice meant to add it once, and a refusal here would be a sentence about
    // nothing they did wrong.
    setCustomTones((current) => (current.includes(value) ? current : [...current, value]));
    setDraft('');
  }

  async function advance() {
    if (!ready || saving) return;
    setSaving(true);
    setRefusal(null);
    try {
      await saveCreatorVoice(token, { tones, customTones, flexible });
      leaveToPage('presence', 1);
    } catch (caught) {
      // The server re-decides over the same vocabulary. If the two disagree,
      // the server's sentence is the one that is true about the record.
      setRefusal(
        caught instanceof CreatorRequestError
          ? (caught.detail.whatHappened ?? 'That could not be saved.')
          : 'That could not be saved, and nothing was changed.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="crf-voice">
      <h1 className="crf-voice__head" data-anim="head">
        {CREATOR_VOICE_HEAD}
      </h1>
      <p className="crf-voice__lede" data-anim="sub">
        {CREATOR_VOICE_LEDE}
      </p>

      <fieldset className="crf-voice__chips" data-anim="field">
        <legend className="crf-voice__legend">{CREATOR_VOICE_CHIPS_LABEL}</legend>
        <p className="crf-voice__help">{CREATOR_VOICE_CHIPS_HELP}</p>
        <div className="crf-voice__grid">
          {CREATOR_VOICE_TONES.map((tone) => {
            const pressed = tones.includes(tone.id);
            return (
              <button
                key={tone.id}
                type="button"
                className={pressed ? 'crf-tone is-on' : 'crf-tone'}
                aria-pressed={pressed}
                onClick={() => toggle(tone.id)}
              >
                <span className="crf-tone__label">{tone.label}</span>
                {/* The help is the tone's own meaning, not a tooltip: a chip
                    reading "Understated" tells somebody nothing about what
                    they would be claiming. */}
                <span className="crf-tone__help">{tone.help}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {customTones.length > 0 ? (
        <ul className="crf-voice__custom-list" data-anim="field">
          {customTones.map((value) => (
            <li key={value} className="crf-voice__custom">
              <span>{value}</span>
              <button
                type="button"
                className="crf-voice__remove"
                onClick={() =>
                  setCustomTones((current) => current.filter((t) => t !== value))
                }
              >
                {/* The accessible name says which one. "Remove" on four buttons
                    is four identically-named controls (§28.5). */}
                <span aria-hidden="true">×</span>
                <span className="sr-only">Remove {value}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="crf-voice__add" data-anim="field">
        <Field label={CREATOR_VOICE_CUSTOM_LABEL}>
          <input
            className="input"
            value={draft}
            maxLength={CREATOR_VOICE_CUSTOM_MAX_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter adds a chip, and does NOT advance the page. There is no
              // global Enter handler in this flow — a stray keystroke must not
              // walk somebody toward a screen that accepts an agreement.
              if (event.key === 'Enter') {
                event.preventDefault();
                addCustom();
              }
            }}
          />
        </Field>
        <Button tier="secondary" onClick={addCustom} disabled={draft.trim() === ''}>
          Add this tone
        </Button>
      </div>

      {/* Its own control rather than a seventh chip: it says something about
          the OTHER answers — "these are what I default to, not what I am
          limited to" — and a tone that modified its siblings' meaning would be
          a vocabulary that is not a vocabulary. */}
      <button
        type="button"
        className={flexible ? 'crf-voice__flex is-on' : 'crf-voice__flex'}
        aria-pressed={flexible}
        data-anim="field"
        onClick={() => {
          setRefusal(null);
          setFlexible((current) => !current);
        }}
      >
        <span>{CREATOR_VOICE_FLEXIBLE_LABEL}</span>
        {/* The state in TEXT, not in the fill alone. The rule is
            `space-between` and the reference put a toggle knob here; without a
            second child the row read as a bordered box with a hole in it, and
            the on/off state was conveyed by colour only (DNA §1) — the same
            reasoning `.crf-pw__tick` already carries. */}
        <span className="crf-voice__flex-state">{flexible ? 'Yes' : 'No'}</span>
      </button>

      {violations.length > 0 ? (
        <ul className="crf-voice__problems" role="alert">
          {violations.map((violation, index) => (
            <li key={`${violation.kind}-${index}`}>{describeViolation(violation)}</li>
          ))}
        </ul>
      ) : null}

      {refusal ? (
        <p className="crf-voice__problems" role="alert">
          {refusal}
        </p>
      ) : null}

      <p className="crf-voice__note" data-anim="sub">
        {VOICE_IS_NEVER_USED_TO_REWRITE}
      </p>

      <div className="crf-nav" data-anim="cta">
        <Button tier="tertiary" onClick={() => leaveToPage('channel', -1)}>
          Back to Your channel
        </Button>
        <Button tier="primary" disabled={!ready || saving} onClick={() => void advance()}>
          {saving ? 'Saving…' : 'Next: your bio'}
        </Button>
      </div>
    </div>
  );
}
