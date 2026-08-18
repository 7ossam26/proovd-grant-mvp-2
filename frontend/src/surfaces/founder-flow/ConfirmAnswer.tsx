/**
 * Screens 2 and 3 — confirming what Proovd understood. Spec §9, §33.1.5.
 *
 * One component, two configurations. Both render the same record and the same
 * provenance rules: the Proovd-supplied text is what the Founder sees, editing
 * it flips the supplier to `founder`, and a failed save never clears a valid
 * field.
 *
 * ── The typed value never comes back from the server ────────────────────────
 * `value` is loaded once and is the only copy from then on. A save reports
 * whether it landed; it never replaces what is in the box. The obvious
 * implementation — clear-on-error-and-refetch — is the single most common
 * autosave bug, and §9 names it: "a failed save never clears valid fields."
 *
 * ── Read first, edit on purpose ─────────────────────────────────────────────
 * The field is a `readOnly` textarea rather than a paragraph that swaps into
 * one. It is the same element in both states, so a keyboard user scrolls a long
 * answer natively in either, focus is not lost when the mode changes, and there
 * is no second DOM shape to keep accessible. Editing grows it — the reference's
 * own 220 → 478px beat, in rows rather than pixels.
 *
 * ── Two differences from the reference, both deliberate ─────────────────────
 * 1. The reference COLLAPSES the Next button while editing. It does not
 *    collapse here. A disappearing primary action inside a twenty-six page
 *    sequence is a trap at 320px, where `Done editing` and `Continue` need not
 *    be on screen together — and the collapse exists to stop a fixed-height
 *    2496px stage overflowing, which is a constraint responsive units remove.
 *    One primary action is still true: while editing, `Done editing` is the
 *    quiet control and Continue is the loud one, exactly as before.
 * 2. The custom 9px scrollbar rail with a JS-tracked thumb is the platform's
 *    own scrollbar, styled. Same design, no second scroll position to keep in
 *    step with the real one, and nothing to go wrong when a tween drops.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import {
  FLOW_PREFILL_NOTE,
  VETTING_STEPS,
  founderFlowPage,
  founderFlowPath,
  type VettingStepCopy,
} from '@proovd/shared';
import {
  Button,
  Field,
  Measure,
  Section,
  StatePanel,
  Tag,
  Textarea,
} from '../../components/index.js';
import { describeSaveState } from '../../lib/autosave.js';
import { useAutosave } from '../../lib/useAutosave.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import {
  fetchVetting,
  saveVetting,
  type VettingPatch,
  type VettingState,
} from '../draft/api.js';
import { FlowPage, useFlowNav } from './FlowPage.js';

type AnswerField = 'problem' | 'solution';

interface Config {
  field: AnswerField;
  /** The sentence the page leads with. The emphasised word is the record. */
  lead: string;
  emphasis: string;
  /** Where Continue goes, and what it is called. */
  nextPageId: string;
  /** Where Back goes. */
  prevPageId: string;
}

const CONFIG: Record<AnswerField, Config> = {
  problem: {
    field: 'problem',
    lead: 'This is how we understood your',
    emphasis: 'problem',
    nextPageId: 'solution',
    prevPageId: 'invite',
  },
  solution: {
    field: 'solution',
    lead: 'And this is how we understood your',
    emphasis: 'solution',
    nextPageId: 'campaign-type',
    prevPageId: 'problem',
  },
};

const copyFor = (id: AnswerField): VettingStepCopy =>
  VETTING_STEPS.find((step) => step.id === id)!;

export function ProblemConfirm() {
  return <ConfirmAnswer config={CONFIG.problem} />;
}

export function SolutionConfirm() {
  return <ConfirmAnswer config={CONFIG.solution} />;
}

function ConfirmAnswer({ config }: { config: Config }) {
  const { token = '' } = useParams();
  const [loaded, setLoaded] = useState<VettingState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchVetting(token)
      .then((state) => {
        if (cancelled) return;
        setLoaded(state);
        setValue(state[config.field] ?? '');
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, config.field]);

  if (unavailable) return <LinkUnavailable />;

  if (loaded === null || value === null) {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Opening your saved answers"
            whatHappened="We're finding anything you've already written. Nothing has been submitted."
            next="Your answer appears in a moment."
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
    <FlowPage pageId={config.field} param={token} badge>
      <Body config={config} token={token} loaded={loaded} initial={value} />
    </FlowPage>
  );
}

/**
 * Split from the loader so `useFlowNav` — which only exists under `FlowPage` —
 * and the autosave both mount once the record is in hand.
 */
function Body({
  config,
  token,
  loaded,
  initial,
}: {
  config: Config;
  token: string;
  loaded: VettingState;
  initial: string;
}) {
  const { leave } = useFlowNav();
  const [value, setValue] = useState(initial);
  const [editing, setEditing] = useState(false);
  const copy = copyFor(config.field);
  const provenance = loaded.provenance[config.field];

  const autosave = useAutosave<VettingPatch>(
    useCallback((patch: VettingPatch) => saveVetting(token, patch), [token]),
  );

  const status = describeSaveState(autosave.state);
  const answered = value.trim() !== '';
  const nextTitle = founderFlowPage(config.nextPageId)?.title ?? 'the next step';
  const prevTitle = founderFlowPage(config.prevPageId)?.title ?? 'the previous step';

  function update(next: string) {
    setValue(next);
    autosave.queue({ [config.field]: next } as VettingPatch);
  }

  async function go(pageId: string, direction: 1 | -1) {
    // Land what is typed before moving. Nothing here depends on the answer
    // having reached the server, but the next page reads it back.
    await autosave.flush();
    leave(founderFlowPath(pageId, token), direction);
  }

  return (
    <div className="ff-confirm">
      {/* §33.11.2: the page's own title. The emphasised word is a treatment on
          real text — the reference sets it as a sticker image, which would take
          the word out of the sentence for anybody not looking at it. */}
      <h1 className="ff-confirm__head" data-anim="head">
        {config.lead} <span className="ff-word">{config.emphasis}</span>
      </h1>

      <div className="ff-panel" data-anim="panel">
        <Field label={copy.title} hint={copy.expected} id={`ff-${config.field}`}>
          <Textarea
            className="ff-panel__text"
            rows={editing ? 12 : 7}
            readOnly={!editing}
            value={value}
            onChange={(event) => update(event.target.value)}
          />
        </Field>
      </div>

      <div className="ff-confirm__meta" data-anim="note">
        {/* §9 stores the supplier of the current value; showing it is what makes
            "we drafted this, you can change it" honest rather than a surprise. */}
        <p className="ff-confirm__provenance">
          {provenance.supplier === 'proovd' ? (
            <>
              <Tag variant="mint">Drafted by Proovd</Tag> {FLOW_PREFILL_NOTE}
            </>
          ) : (
            <>
              <Tag variant="moss">Your words</Tag>{' '}
              {provenance.prefilledText
                ? 'You edited what we drafted. We still have our original if you want it back — ask us.'
                : 'This one is yours from a blank page.'}
            </>
          )}
        </p>
        <span
          className="ff-confirm__status"
          role="status"
          aria-live="polite"
          data-state={autosave.state.status}
        >
          {status || (autosave.dirty ? '' : 'Saved')}
        </span>
      </div>

      <p className="ff-confirm__next-note" data-anim="hint">
        {copy.next}
      </p>

      <div className="ff-nav" data-anim="cta">
        <Button tier="tertiary" onClick={() => void go(config.prevPageId, -1)}>
          {`Back to ${prevTitle}`}
        </Button>
        <Button
          tier="secondary"
          className="ff-nav__edit"
          onClick={() => setEditing((on) => !on)}
        >
          {editing ? 'Done editing' : 'Edit this'}
        </Button>
        <Button
          tier="primary"
          disabled={!answered}
          onClick={() => void go(config.nextPageId, 1)}
        >
          {`Continue to ${nextTitle}`}
        </Button>
      </div>
    </div>
  );
}
