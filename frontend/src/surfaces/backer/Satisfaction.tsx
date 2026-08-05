/**
 * §31.8's satisfaction question — Spec §31.8, §30, §33.10.10.
 *
 * ── "Under 30 seconds" is the absence of steps, not a fast form ─────────────
 * The first interaction records the answer. There is nothing to read past,
 * nothing to tick, and nothing required before the click — so the flow cannot
 * take thirty seconds however slowly someone moves. The reason field appears
 * only AFTER the answer is in, and skipping it is a complete interaction.
 *
 * ── And there is no newsletter here ────────────────────────────────────────
 * §31.8: "does not coerce newsletter consent." No consent control, prechecked
 * or otherwise, and no marketing copy — the backend has nowhere to store one
 * either. The suite asserts both halves.
 *
 * ── The progression above it never predicts ────────────────────────────────
 * §31.8's status line is derived from stored state, and the server returns
 * only the steps that actually happened. This renders what it is given and
 * adds no greyed-out "Delivered" ahead of a delivery (§30).
 */

import { useState } from 'react';
import { Button, StatePanel, Field, Textarea, NO_ACTION, Tag } from '../../components/index.js';

export interface ProgressionStep {
  key: string;
  label: string;
  state: 'done' | 'current' | 'upcoming';
}

export interface SatisfactionProps {
  reservationId: string;
  progression: ProgressionStep[];
  /** True while a delivery has happened and no answer exists yet. */
  askable: boolean;
  answered: boolean;
  onAnswer: (satisfied: boolean) => Promise<{ followUp: string } | null>;
  onReason: (reason: string) => Promise<void>;
}

export function Satisfaction({
  progression,
  askable,
  answered,
  onAnswer,
  onReason,
}: SatisfactionProps) {
  const [state, setState] = useState<'idle' | 'sending' | 'answered'>(
    answered ? 'answered' : 'idle',
  );
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonSent, setReasonSent] = useState(false);

  async function answer(satisfied: boolean): Promise<void> {
    if (state !== 'idle') return;
    setState('sending');
    const result = await onAnswer(satisfied);
    setFollowUp(result?.followUp ?? null);
    setState('answered');
  }

  return (
    <section aria-labelledby="backer-progress-heading">
      <h2 id="backer-progress-heading" className="h3">
        Where your pre-order stands
      </h2>
      {/*
        A list, not a bar. §31.8's progression is a sequence of facts and the
        last one is where things are — a bar implies a remaining distance the
        product has not promised.
      */}
      <ol className="progression">
        {progression.map((step) => (
          <li key={step.key} data-state={step.state}>
            {step.label}
            {step.state === 'current' ? <Tag variant="sage">Now</Tag> : null}
          </li>
        ))}
      </ol>

      {state === 'answered' ? (
        <>
          <StatePanel
            state="Thank you"
            whatHappened={followUp ?? 'We have your answer.'}
            next="Nothing else is needed from you."
            owner={followUp?.includes('Proovd') ? 'Proovd' : 'You'}
            nextUpdate={followUp?.includes('Proovd') ? 'Within one business day' : 'No further updates'}
            action={NO_ACTION}
            reference="Your answer changes nothing about your order."
          />
          {/* §31.8: "then optional reason." Optional means skippable, and
              skipping it is what happens if this is simply ignored. */}
          {!reasonSent ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!reason.trim()) return;
                void onReason(reason.trim()).then(() => setReasonSent(true));
              }}
            >
              <Field label="Anything you want to add? (optional)">
                <Textarea
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              <Button tier="secondary" type="submit" disabled={!reason.trim()}>
                Send that too
              </Button>
            </form>
          ) : (
            <p>Thank you — we have that as well.</p>
          )}
        </>
      ) : askable ? (
        <>
          <h3>How did it go?</h3>
          {/*
            Two buttons, one click, done. No scale to read, no consent, and no
            "tell us why" gate — §31.8's whole shape.
          */}
          <Button
            tier="primary"
            onClick={() => void answer(true)}
            disabled={state === 'sending'}
          >
            It was what I expected
          </Button>
          <Button
            tier="secondary"
            onClick={() => void answer(false)}
            disabled={state === 'sending'}
          >
            Something was wrong
          </Button>
        </>
      ) : null}
    </section>
  );
}

export default Satisfaction;
