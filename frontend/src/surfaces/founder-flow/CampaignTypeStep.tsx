/**
 * Screen 4 — the campaign path. Spec §9 step 1, §33.1.7.
 *
 * ── This screen locks nothing, and that is the trap ─────────────────────────
 * §9's lock is at SUBMISSION. What happens here is a draft answer the Back
 * button may revisit as often as the Founder likes, and the permanence warning
 * says so in the same words the review will. A screen that reads as the moment
 * of decision and a screen that IS the moment of decision are different things;
 * the database enforces the second (the 0007 trigger), and this one is the
 * first.
 *
 * ── Two stages, one route ───────────────────────────────────────────────────
 * Pick, then confirm. One address, because it is one decision: a bookmark to
 * the confirm stage of a choice nobody has made restores nothing. Position
 * survives at the granularity that means something (DNA §5.12).
 *
 * ── The pager is both options at once, and the reason is the viewport ───────
 * The reference shows ONE campaign type at a time between two pager arrows.
 * That is its answer to a fixed 2496px stage on which two 440px stickers plus
 * their copy do not fit; in responsive units they sit side by side at 1280 and
 * stack at 320, which is also what §33.11.1's reflow requirement wants. And §9
 * is explicit that "the step must explain what is being chosen in plain
 * language BEFORE it is chosen" — behind a pager, half of that explanation is
 * one interaction away from a Founder who never presses the arrow.
 *
 * It is a real `Choice` radio group. Two exclusive answers browsed with arrow
 * keys and one tab stop, announced as one question with two answers — not two
 * checkboxes that clear each other.
 *
 * ── The FLIP ────────────────────────────────────────────────────────────────
 * The reference's own sequence: the chosen sticker swells while the page copy
 * fades, then the stage swaps and the sticker is inverted to where it was and
 * tweened home. `captureFlip` runs before the state change and `flipHome` in
 * the layout effect after, which is React's expression of "invert set
 * synchronously before paint, tween starts on the next frame". The two stickers
 * are different DOM nodes, so they are matched by `data-flip-id`.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  CAMPAIGN_PATH_CHOICES,
  CAMPAIGN_TYPE_LOCK_WARNING,
  founderFlowPath,
} from '@proovd/shared';
import {
  Button,
  Choice,
  Measure,
  Section,
  StatePanel,
  Sticker,
} from '../../components/index.js';
import { captureFlip, flipHome, swellChoice } from '../../components/anim.js';
import { describeSaveState } from '../../lib/autosave.js';
import { useAutosave } from '../../lib/useAutosave.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import {
  fetchVetting,
  saveVetting,
  type CampaignTypeValue,
  type VettingPatch,
  type VettingState,
} from '../draft/api.js';
import { FlowPage, useFlowNav } from './FlowPage.js';

/** The `Sticker` number each path uses. Decorative; the label carries meaning. */
const STICKER: Record<CampaignTypeValue, number> = { pre_build: 3, pre_launch: 4 };

const FLIP_ID = 'ff-type-sticker';

export function CampaignTypeStep() {
  const { token = '' } = useParams();
  const [loaded, setLoaded] = useState<VettingState | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchVetting(token)
      .then((state) => {
        if (!cancelled) setLoaded(state);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (unavailable) return <LinkUnavailable />;

  if (!loaded) {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Opening your campaign type"
            whatHappened="We're checking whether you have already chosen. Nothing has been submitted and nothing is locked."
            next="Your two options appear in a moment."
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
    <FlowPage pageId="campaign-type" token={token} badge>
      <Body token={token} loaded={loaded} />
    </FlowPage>
  );
}

function Body({ token, loaded }: { token: string; loaded: VettingState }) {
  const { leave } = useFlowNav();
  // Pre-selected from Admin's discovery answer where there is one; the
  // Founder's own choice supersedes it and the server records which.
  const [chosen, setChosen] = useState<CampaignTypeValue | null>(loaded.selectedType);
  const [stage, setStage] = useState<'pick' | 'confirm'>('pick');
  const [busy, setBusy] = useState(false);
  const stickerRef = useRef<HTMLSpanElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const flipState = useRef<unknown>(null);

  const autosave = useAutosave<VettingPatch>(
    useCallback((patch: VettingPatch) => saveVetting(token, patch), [token]),
  );

  useLayoutEffect(() => {
    if (stage !== 'confirm' || !flipState.current) return;
    const state = flipState.current;
    flipState.current = null;
    flipHome(state);
  }, [stage]);

  const choice = chosen ? CAMPAIGN_PATH_CHOICES.find((c) => c.type === chosen) : undefined;
  const status = describeSaveState(autosave.state);

  function select(next: CampaignTypeValue) {
    setChosen(next);
    autosave.queue({ selectedType: next });
  }

  function toConfirm() {
    if (!chosen || busy) return;
    setBusy(true);
    // Captured BEFORE the stage swaps: after it, the element the state
    // describes has been replaced by the confirm row's own sticker, which Flip
    // matches by `data-flip-id`.
    flipState.current = captureFlip(`[data-flip-id="${FLIP_ID}"]`);
    const fading = bodyRef.current
      ? Array.from(bodyRef.current.querySelectorAll('[data-fade]'))
      : [];
    swellChoice(stickerRef.current, fading, () => {
      setBusy(false);
      setStage('confirm');
    });
  }

  async function confirm() {
    await autosave.flush();
    leave(`/draft/${encodeURIComponent(token)}/vetting`, 1);
  }

  if (stage === 'confirm' && choice) {
    return (
      <div className="ff-type" ref={bodyRef}>
        <h1 className="ff-type__head" data-anim="head">
          You are running {choice.name === 'Idea Campaign' ? 'an' : 'a'} {choice.name}
        </h1>

        <ul className="ff-type__rows" data-anim="boxes">
          {CAMPAIGN_PATH_CHOICES.map((entry) => {
            const current = entry.type === chosen;
            return (
              <li
                key={entry.type}
                className={current ? 'ff-type__row is-chosen' : 'ff-type__row'}
              >
                <span data-flip-id={current ? FLIP_ID : undefined}>
                  <Sticker n={STICKER[entry.type]} />
                </span>
                <span className="ff-type__row-label">{entry.prompt}</span>
                <span className="ff-type__row-name">{entry.name}</span>
              </li>
            );
          })}
        </ul>

        <section className="ff-type__commitments" data-anim="field">
          <h2>What a {choice.name} commits you to</h2>
          <ul className="doc-list">
            {choice.commitments.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <p className="ff-type__warning" data-anim="note">
          {CAMPAIGN_TYPE_LOCK_WARNING}
        </p>

        <div className="ff-nav" data-anim="cta">
          <Button tier="tertiary" onClick={() => setStage('pick')}>
            Back to the two options
          </Button>
          <span
            className="ff-confirm__status"
            role="status"
            aria-live="polite"
            data-state={autosave.state.status}
          >
            {status || (autosave.dirty ? '' : 'Saved')}
          </span>
          <Button tier="primary" onClick={() => void confirm()}>
            Confirm and answer the last question
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="ff-type" ref={bodyRef}>
      <h1 className="ff-type__head" data-anim="head" data-fade>
        I&rsquo;m working on an&hellip;
      </h1>
      <p className="ff-type__lede" data-anim="sub" data-fade>
        It decides how your campaign works end to end &mdash; whether there is an order
        threshold, how many pre-orders one Backer can place, which refund policy applies, and
        when you are paid.
      </p>

      {/* The sticker that travels. Decorative — it carries no meaning the two
          labels below do not already carry — and it is the one thing on this
          page that survives the stage change. Its space is reserved, so
          choosing a path does not shift the explanations under the reader. */}
      <span className="ff-type__hero" ref={stickerRef} data-flip-id={FLIP_ID}>
        {chosen ? <Sticker n={STICKER[chosen]} /> : null}
      </span>

      <div className="ff-type__cards" data-anim="boxes">
        <Choice<CampaignTypeValue>
          label="Which of these is closer to where you are today?"
          entries={CAMPAIGN_PATH_CHOICES.map((entry) => ({
            value: entry.type,
            label: entry.prompt,
            sub: entry.summary,
          }))}
          value={chosen ?? undefined}
          onValueChange={select}
        />
      </div>

      {/* §9: "the step must explain what is being chosen in plain language
          before it is chosen". Both, before the choice — not behind a pager. */}
      <div className="ff-type__explain" data-anim="field" data-fade>
        {CAMPAIGN_PATH_CHOICES.map((entry) => (
          <section key={entry.type} className="ff-type__explain-card">
            <h2>{entry.name}</h2>
            <ul className="doc-list">
              {entry.commitments.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="ff-type__warning" data-anim="note" data-fade>
        {CAMPAIGN_TYPE_LOCK_WARNING}
      </p>

      <div className="ff-nav" data-anim="cta" data-fade>
        <Button
          tier="tertiary"
          onClick={() => leave(founderFlowPath('solution', token), -1)}
        >
          Back to Your solution
        </Button>
        <Button tier="primary" disabled={!chosen || busy} onClick={toConfirm}>
          {chosen
            ? `Select ${CAMPAIGN_PATH_CHOICES.find((c) => c.type === chosen)!.name}`
            : 'Select a campaign type'}
        </Button>
      </div>
    </div>
  );
}
