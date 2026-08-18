/**
 * Screen 13 — the campaign story — Founder Flow v2, Session D.
 *
 * ── The approval is the completing act, and editing withdraws it ────────────
 * §12: "A prompt response, transcript, generated summary, or unapproved draft
 * does not count." Every one of those is this box before the Founder approves
 * it, so the approval is its own unchecked control (§28.4) — and the service
 * clears it in the same statement as any later edit, so a Founder always
 * approved the words that will actually be published. The screen says that
 * plainly rather than letting somebody discover it.
 *
 * ── Dictation is typing by voice, and §12 is what makes that safe ───────────
 * The transcript arrives in this box as ordinary editable Founder text and
 * saves through the same autosave typing does. §12 refusing a bare transcript
 * is not a reason to withhold the microphone — it is the reason the microphone
 * is harmless: the approval still has to happen afterwards, by a person, on
 * the words as they stand.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Field, Option, Textarea } from '../../components/index.js';
import { transcribeStory } from '../founder/api.js';
import { AnswerPage, HelperBlock } from './AnswerPage.js';
import { Dictation } from './Dictation.js';

export function StoryStep() {
  const { campaignId = '' } = useParams();

  return (
    <AnswerPage pageId="story" itemKey="story">
      {({ state, autosave }) => (
        <StoryControls
          campaignId={campaignId}
          initial={state.story.text ?? ''}
          approved={state.story.approved}
          readOnly={state.listingPaid}
          availability={state.transcription}
          onChange={(next) => autosave.queue({ storyText: next })}
          onApprove={(approved) => autosave.queue({ storyApproved: approved })}
        />
      )}
    </AnswerPage>
  );
}

function StoryControls({
  campaignId,
  initial,
  approved,
  readOnly,
  availability,
  onChange,
  onApprove,
}: {
  campaignId: string;
  initial: string;
  approved: boolean;
  readOnly: boolean;
  availability: { available: true } | { available: false; absentBecause: string };
  onChange: (next: string) => void;
  onApprove: (approved: boolean) => void;
}) {
  // The local copy is the only copy of what was typed (§9). A save response
  // never writes back into it, which is why it is seeded exactly once.
  const [text, setText] = useState(initial);
  const seeded = useState(() => ({ done: false }))[0];

  useEffect(() => {
    if (seeded.done) return;
    seeded.done = true;
    setText(initial);
  }, [seeded, initial]);

  function change(next: string) {
    setText(next);
    onChange(next);
  }

  return (
    <>
      <Field
        label="Your story"
        hint="Why you are building this, and what you want it to be. It goes on your public campaign page in your own words."
        id="ff-story-text"
      >
        <Textarea
          rows={12}
          value={text}
          disabled={readOnly}
          onChange={(event) => change(event.target.value)}
        />
      </Field>

      <Dictation
        availability={availability}
        transcribe={(audio) => transcribeStory(campaignId, audio)}
        onText={(said) => change(text ? `${text.trimEnd()} ${said}` : said)}
      />

      <Option
        label="I approve this story for my public campaign page"
        checked={approved}
        disabled={readOnly}
        onCheckedChange={onApprove}
      />
      <p className="ff-answer__note">
        Editing the story afterwards clears this, so what goes public is always the version you
        approved.
      </p>

      <HelperBlock subject="story" title="Help with your story" />
    </>
  );
}
