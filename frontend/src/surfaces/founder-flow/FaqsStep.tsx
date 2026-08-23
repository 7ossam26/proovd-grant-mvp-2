/**
 * Step 25 — add your FAQ's, rebuilt 1:1 from the reference.
 *
 * REBUILT FROM SCRATCH 2026-08-21 against the supplied reference
 * (`Proovd Founder Flow v2.dc.html`, `[data-faq]` / `kindWide`) and its
 * screenshot. What stood here was Session F's `BuildStepPage` layout — a
 * token-scale form on the left, a stacked card list on the right, an
 * `Add this question` button and the shared nav row. None of it is left.
 *
 * `isFaq(c){ return (c||this.cur())==='build' && this.state.buildStep===2 &&
 * this.state.pageStatus==='draft'; }` — the third of its six build pages, which
 * is where `buildFlowStepsFor` puts ours for an Idea campaign and the second
 * for a Product one, because §14.4 gives a Product campaign no public
 * threshold.
 *
 * ── The layout model is the reference's, not an approximation of it ─────────
 * Authored once on a fixed 2496x1542 stage and scaled to the viewport by
 * `fitStages()`:
 *
 *     let s = Math.min(innerWidth/2496, innerHeight/1542) * (pageScale || .78);
 *
 * No branch of that function names `build`, so this screen takes `pageScale`
 * alone — unlike Last look's `s *= .9` or `problem`/`solution`'s `s *= 1.38`.
 * Measured against the reference in Chrome at 1600x793 it reports
 * `scale(0.4011)`, which is exactly that expression.
 *
 * Inside the stage sits a 2260px two-column grid, centred, `minmax(0,1.12fr)
 * minmax(0,1.08fr)` with a 130px gutter and `align-items:center` — so the
 * preview column is centred against the taller form rather than sharing its top
 * edge, and the left column's height changes with the preview text while the
 * right column's 1333px never moves. Every child carries the reference's own
 * pixel value on that stage: a 150/130 padded preview card with an 820px floor,
 * two 130px arrows, 110px above the guide row, and on the right 44/70/26/56/26/
 * 50 between eight elements ending in two 150px buttons. Nothing reflows; the
 * stage scales, which is why the composition is identical at every viewport
 * (§33.11.1) — and `isClaimPhone()` is `false` in the reference, so its
 * `kindPhone` branch is dead code and this composition is what every viewport
 * gets.
 *
 * ── The reference's record is an array with a cursor. Ours is rows ─────────
 * There, `faqs:[{t:'',b:''}]` with `faqIx` — `faqAdd` appends a blank and moves
 * the cursor onto it, `faqDelete` drops the current one, the arrows move the
 * cursor, and the preview renders whichever card the cursor is on. That whole
 * interaction is reproduced exactly, because it is the screen.
 *
 * What differs is underneath: `campaign_faqs` is rows with ids, and `upsertFaq`
 * REFUSES a blank — "An FAQ needs both a question and an answer." So a blank
 * card cannot be persisted and must not be, or a Founder's public page grows a
 * heading with nothing under it. The cursor list is therefore local and seeded
 * from the server's rows, a card writes through autosave once BOTH halves are
 * non-blank, and `Add FAQ` is a purely local act until the new card has
 * something in it. That is the server's rule surfaced, not a rule invented here.
 *
 * ── What the reference draws that is refused, and why ──────────────────────
 *   - `Our guide on FAQ's` as a live control. It is a `<button>` there with no
 *     `onClick` at all — a control that does nothing. §12's helper resources
 *     are real and this flow's answer for them is HELP, which is one gesture
 *     away on every page, so the button's own reading is in the drawer and the
 *     control opens it. That is the `VoiceStep` arrangement.
 *   - The document-level Enter handler. `enterAdvance` is global in the
 *     reference and its early return catches only a `TEXTAREA` — so pressing
 *     Enter in the FAQ TITLE field leaves the page, and somebody who typed a
 *     question and expected to add it is on the rewards screen instead. Every
 *     other rebuilt screen in this flow binds Enter to the field's own control
 *     (`EmailStep` sends, `BrandingStep` adds a swatch, `VisualsStep` adds a
 *     link), so Enter in the title moves to the answer and Enter in the answer
 *     does what Enter in a textarea does.
 *
 * ── What is added that the reference has none of, and why ──────────────────
 * A visible focus ring on every control, an accessible name on the two arrows
 * and on `X Delete FAQ N`, §9's three autosave phrases, and the failure and
 * lock states §1.1 requires. The reference holds its record in memory and never
 * waits for one; none of this changes the composition, because every added line
 * is absolutely positioned in the chrome rather than in the stage.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { founderFlowPath } from '@proovd/shared';
import { SurfaceLoading } from '../../features/public/states.js';
import { StatePanel, NO_ACTION } from '../../components/index.js';
import { stageFlourishIn, stageRelayIn } from '../../components/anim.js';
import { describeSaveState } from '../../lib/autosave.js';
import { useAutosave } from '../../lib/useAutosave.js';
import { removeFaq, saveFaq, type FaqView } from '../founder/api.js';
import { FlowPage, HelpDrawer, flowDirection, useFlowNav } from './FlowPage.js';
import { useBuildFlow, type BuildFlowState } from './useBuild.js';
import {
  isReferenceWalkthrough,
  readReferenceDraft,
  writeReferenceDraft,
} from './referenceWalkthrough.js';

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()` for a page it treats as ordinary: the stage's own size as the
   divisors and `pageScale` alone. */

const FIT_W = 2496;
const FIT_H = 1542;
/** The prototype's `pageScale` prop default. */
const PAGE_SCALE = 0.78;

function stageScale(): string {
  const s = Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * PAGE_SCALE;
  // `s.toFixed(4)` is the reference's own — it writes the transform as a string
  // and rounds there, so this is the same number to the digit rather than one
  // that agrees to five decimal places.
  return s.toFixed(4);
}

/**
 * The reference's own relay order for this screen, out of `verifyIntro`'s fixed
 * list `pill, head, field, boxes, note, fee, sub, hint, panel, art, art2, cta,
 * edit`. This screen carries three of the thirteen and they are written to the
 * DOM in the other order — `art` is the first column and `panel` the second —
 * so document order and the stagger disagree, which is exactly why the list is
 * passed in rather than read from the markup.
 *
 * Sampled against the reference at 1600x793: panel starts at 0ms, art at 85ms,
 * cta at 170ms, each `x: 150 → 0` over 620ms.
 */
const RELAY = ['panel', 'art', 'cta'] as const;

/**
 * The two statuses `upsertFaq` accepts a write in. `CampaignBuild.tsx` — the
 * other surface over this record — reads the same pair inline, and both are the
 * browser's courtesy: the server re-decides and its refusal is what a Founder
 * actually reads (§1.1).
 */
const EDITABLE_STATUSES: readonly string[] = ['affiliate_response_and_build', 'changes_required'];

/** The reference's `faqPreviewTitle` fallback, with its own curly apostrophe. */
const previewTitleFor = (index: number) => `You’ll see FAQ ${String(index + 1)} here`;
/** Its `faqPreviewBody` fallback. */
const previewBodyFor = (index: number) =>
  `You’ll see FAQ ${String(index + 1)}’s body here explaining the answer for the backer here`;

/**
 * One card in the cursor list.
 *
 * `id` is the persisted row when there is one and `undefined` while the card is
 * still only a draft — which is the whole of the difference between the
 * reference's model and this one.
 */
interface Card {
  id?: string;
  t: string;
  b: string;
}

/** One queued write: the row, and which card in the cursor list it belongs to. */
interface FaqPatch {
  at: number;
  faq: { faqId?: string; question: string; answer: string; sortOrder: number };
}

/** The reference's `faqs:[{t:'',b:''}]`, over the rows the server actually has. */
function seed(faqs: readonly FaqView[]): Card[] {
  if (!faqs.length) return [{ t: '', b: '' }];
  return faqs.map((faq) => ({ id: faq.id, t: faq.question, b: faq.answer }));
}

function readWalkthroughCards(campaignId: string): Card[] | null {
  const value = readReferenceDraft(campaignId, 'faqs');
  if (!Array.isArray(value) || value.length === 0) return null;
  const cards = value.filter(
    (entry): entry is Card =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Partial<Card>).t === 'string' &&
      typeof (entry as Partial<Card>).b === 'string' &&
      (typeof (entry as Partial<Card>).id === 'string' ||
        typeof (entry as Partial<Card>).id === 'undefined'),
  );
  return cards.length === value.length ? cards : null;
}

export function FaqsStep() {
  const { campaignId = '' } = useParams();
  const build = useBuildFlow(campaignId);

  if (build.failure) {
    return (
      <FlowPage pageId="faqs" param={campaignId}>
        <div className="ff-faq__state">
          <StatePanel
            state="We could not open your campaign page"
            whatHappened={build.failure}
            next="Reload the page. Every question you have already saved is on your campaign."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
            ring
          />
        </div>
      </FlowPage>
    );
  }

  if (!build.state) {
    return <SurfaceLoading subject="your FAQs" reference="Your campaign" />;
  }

  return (
    <FlowPage pageId="faqs" param={campaignId}>
      <FaqScreen campaignId={campaignId} build={build} />
    </FlowPage>
  );
}

/** Split from the loader so `useFlowNav` — which only exists under `FlowPage` — is available. */
function FaqScreen({ campaignId, build }: { campaignId: string; build: BuildFlowState }) {
  const { leave, leaveToPage } = useFlowNav();

  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const bodyField = useRef<HTMLTextAreaElement>(null);

  // Read once, during the first render: `FlowPage` resets the module value in
  // its own layout effect, and a later re-render would read the reset.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  // The record, read once. §9's rule, and `useBuildFlow`'s: the typed value
  // never comes back from the server, because a save that raced a keystroke
  // would otherwise reinstate the sentence the Founder had just deleted.
  const walkthrough = isReferenceWalkthrough(campaignId);
  const stored = build.state?.faqs;
  const initial = useMemo(
    () => (walkthrough ? (readWalkthroughCards(campaignId) ?? seed(stored ?? [])) : seed(stored ?? [])),
    [campaignId, stored, walkthrough],
  );
  const [cards, setCards] = useState<Card[]>(initial);
  const [index, setIndex] = useState(0);
  const [said, setSaid] = useState('');

  const locked =
    !walkthrough && !EDITABLE_STATUSES.includes(build.state?.campaignStatus ?? '');

  const current = cards[index] ?? { t: '', b: '' };
  const canDelete = cards.length > 1;
  const hasPrev = index > 0;
  const hasNext = index < cards.length - 1;

  // `fitStages`, for this screen. First, so the first paint is already at the
  // right scale — and on resize, because the reference refits there too.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      el.style.transform = `translate(-50%, -50%) scale(${stageScale()})`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // The entrance — `verifyIntro`'s `runRelay` plus its flourish branch. This
  // screen has no `[data-anim="grow"]` and no cupids, and it is neither
  // `[data-lastlook]` nor `[data-paynow]` nor `[data-match]`, so every one of
  // that function's earlier branches is false and these two are all it gets.
  useLayoutEffect(() => stageRelayIn(root.current, direction.current ?? 1, RELAY), []);
  useLayoutEffect(() => stageFlourishIn(root.current), []);

  /**
   * The FAQ's own autosave — the flow's §9 vocabulary over `saveFaq`.
   *
   * Deliberately NOT `build.autosave`, which is `saveBuild` over
   * `Partial<BuildFields>`: an FAQ is its own row through its own route, and
   * routing one through a patch type that has no field for it would mean either
   * a fake key or a lie in the type. It is the same hook, so the three phrases,
   * the retry rule, and the `beforeunload` warning are the ones every other
   * Founder surface uses.
   *
   * The response carries the row's id back, which is what turns the next save on
   * the same card into an UPDATE rather than a second INSERT. `useAutosave`
   * never returns a value (§9 rule 2), so the id is written here — onto the
   * card, and never over the text, which stays the caller's own copy.
   */
  const persist = useCallback(
    async (patch: FaqPatch) => {
      const { faq } = await saveFaq(campaignId, patch.faq);
      setCards((list) => list.map((card, i) => (i === patch.at ? { ...card, id: faq.id } : card)));
    },
    [campaignId],
  );
  const autosave = useAutosave<FaqPatch>(persist);

  /**
   * Write one card.
   *
   * The patch is a whole FAQ rather than a merge, so `useAutosave`'s coalescing
   * is last-write-wins on the same card — which is correct, and is why every
   * cursor move flushes first: a debounce still in flight when the cursor moved
   * would otherwise send the new card's text under the old card's id.
   *
   * A card with a blank half is held and not sent: `upsertFaq` refuses it by
   * name, and a queued refusal would sit under a status line reading `Could not
   * save — retrying` for something that is not a failure. It saves itself the
   * moment the other half is typed.
   */
  const write = useCallback(
    (next: Card, at: number) => {
      const question = next.t.trim();
      const answer = next.b.trim();
      if (!question || !answer) return;
      autosave.queue({
        at,
        faq: {
          ...(next.id && !next.id.startsWith('walkthrough-faq-') ? { faqId: next.id } : {}),
          question,
          answer,
          sortOrder: at,
        },
      });
    },
    [autosave],
  );

  const edit = useCallback(
    (patch: Partial<Card>) => {
      setCards((list) => {
        const next = list.map((card, i) => (i === index ? { ...card, ...patch } : card));
        if (walkthrough) writeReferenceDraft(campaignId, 'faqs', next);
        write(next[index]!, index);
        return next;
      });
    },
    [campaignId, index, walkthrough, write],
  );

  /** `faqPrev:()=>{ if(st.faqIx>0)this.setState({faqIx:st.faqIx-1}); }` */
  async function prev() {
    if (!hasPrev) return;
    await autosave.flush();
    setIndex((i) => Math.max(0, i - 1));
  }

  /** `faqNextCard:()=>{ if(st.faqIx<st.faqs.length-1)this.setState({faqIx:st.faqIx+1}); }` */
  async function nextCard() {
    if (!hasNext) return;
    await autosave.flush();
    setIndex((i) => Math.min(cards.length - 1, i + 1));
  }

  /** `faqAdd:()=>this.setState({faqs:[...st.faqs,{t:'',b:''}],faqIx:st.faqs.length})` */
  async function add() {
    await autosave.flush();
    const at = cards.length;
    setCards((list) => {
      const next = [...list, { t: '', b: '' }];
      if (walkthrough) writeReferenceDraft(campaignId, 'faqs', next);
      return next;
    });
    setIndex(at);
    setSaid(`FAQ ${String(at + 1)} added. Write the question and the answer.`);
    titleField.current?.focus();
  }

  /**
   * `faqDelete:()=>{ if(st.faqs.length<2)return;
   *   const f=st.faqs.filter((_,i)=>i!==st.faqIx);
   *   this.setState({faqs:f,faqIx:Math.max(0,st.faqIx-1)}); }`
   *
   * A card that reached the server is removed there too; one that never did is
   * only ever local, which is the same distinction `write` draws.
   */
  async function drop() {
    if (!canDelete) return;
    const going = cards[index];
    const label = `FAQ ${String(index + 1)}`;
    setCards((list) => {
      const next = list.filter((_, i) => i !== index);
      if (walkthrough) writeReferenceDraft(campaignId, 'faqs', next);
      return next;
    });
    setIndex((i) => Math.max(0, i - 1));
    if (going?.id && !going.id.startsWith('walkthrough-faq-')) {
      try {
        await removeFaq(campaignId, going.id);
      } catch {
        setSaid(
          `${label} is still on your campaign — we could not remove it. Nothing else changed.`,
        );
        return;
      }
    }
    setSaid(`${label} removed.`);
  }

  /** `faqNext:()=>this.step({buildStep:3})` — the rewards page. */
  async function goOn() {
    await autosave.flush();
    leaveToPage('rewards', 1);
  }

  const status = describeSaveState(autosave.state);
  const loud = autosave.state.status === 'failed' || autosave.state.status === 'retrying';

  return (
    <div className="ff-faq" ref={root}>
      {/* The reference's own control, bottom-left. `back()`'s build branch is
          `this.step({buildStep: st.buildStep - 1})`; ours is the step before
          this one in the product's own walk — the threshold on an Idea campaign
          and the brand voice on a Product one, because §14.4 gives a Product
          campaign no public threshold and so no screen 22. The visible word is
          the reference's `Back` and §33.11.4's objectless-CTA rule is answered
          by the accessible name rather than by overriding its copy. */}
      <button
        type="button"
        className="ff-faq__back"
        aria-label={
          'Back to your order goal'
        }
        onClick={() => {
          void autosave.flush().finally(() => leave(founderFlowPath('threshold', campaignId), -1));
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 5 8 12l7 7" />
        </svg>
        Back
      </button>

      <div className="ff-faq__top">
        {/* Not a link. A half-written campaign page is not a site, and the way
            out of a Founder's own form should not be the brand. */}
        <img className="ff-faq__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        <HelpDrawer
          pageId="faqs"
          param={campaignId}
          trigger={
            <button type="button" className="ff-faq__help">
              Help
            </button>
          }
        />
      </div>

      <div className="ff-faq__stage" data-page-stage="1" ref={stage}>
        <div className="ff-faq__grid">
          {/* `data-anim="art"` — the left column. Second in the relay. */}
          <div className="ff-faq__art" data-stage-anim="art">
            {/* `data-flourish="1"` — the preview card, which scales up on its
                own beat rather than travelling with the column. It renders the
                same question and answer the public page will, from the same
                values, and falls back to the reference's own placeholder
                sentences while the card is still blank. */}
            <div className="ff-faq__card" data-stage-flourish="1">
              <span className="ff-faq__cardq">{current.t.trim() || previewTitleFor(index)}</span>
              <p className="ff-faq__carda">{current.b.trim() || previewBodyFor(index)}</p>
            </div>

            <div className="ff-faq__nav">
              {/* The arrows are the reference's own glyphs. A glyph is not an
                  accessible name, so each carries one and the glyph itself is
                  out of the reading order (§28.5). They are not `disabled`: the
                  reference greys them to `#A2AFA8` and leaves them focusable,
                  and a control a keyboard user can reach and be told about is
                  better than one that leaves the tab order as the list grows
                  and shrinks under them. */}
              <button
                type="button"
                className="ff-faq__arrow"
                data-on={hasPrev ? 'true' : 'false'}
                aria-disabled={hasPrev ? undefined : true}
                aria-label={hasPrev ? `Back to FAQ ${String(index)}` : 'This is the first FAQ'}
                onClick={() => void prev()}
              >
                <span aria-hidden="true">◀</span>
              </button>
              <button
                type="button"
                className="ff-faq__arrow ff-faq__arrow--next"
                data-on={hasNext ? 'true' : 'false'}
                aria-disabled={hasNext ? undefined : true}
                aria-label={hasNext ? `On to FAQ ${String(index + 2)}` : 'This is the last FAQ'}
                onClick={() => void nextCard()}
              >
                <span aria-hidden="true">▶</span>
              </button>
            </div>

            <div className="ff-faq__row">
              {/* The reference's button has no handler at all. §12's helper
                  resources are real and this flow's answer for them is HELP, so
                  it opens the drawer the guidance is in. */}
              <HelpDrawer
                pageId="faqs"
                param={campaignId}
                trigger={
                  <button type="button" className="ff-faq__guide">
                    Our guide on FAQ&rsquo;s
                  </button>
                }
              />
              {canDelete ? (
                <button
                  type="button"
                  className="ff-faq__delete"
                  aria-label={`Delete FAQ ${String(index + 1)}`}
                  onClick={() => void drop()}
                  disabled={locked}
                >
                  <span aria-hidden="true">X&nbsp;&nbsp;</span>
                  Delete FAQ {index + 1}
                </button>
              ) : null}
            </div>
          </div>

          {/* `data-anim="panel"` — the right column, and first in the relay. */}
          <div className="ff-faq__panel" data-stage-anim="panel">
            {/* §33.11.2 wants exactly one `h1`, and this is the only thing on
                the screen that names it. The reference draws a `span`; the level
                is ours and every pixel of the treatment is its own. */}
            <h1 className="ff-faq__head">Add your FAQ&rsquo;s</h1>
            <p className="ff-faq__lede">
              These are the FAQ about your product you expect backers to ask and how you would
              answer them .
            </p>

            <label className="ff-faq__label" htmlFor="ff-faq-title">
              {`FAQ ${String(index + 1)} Title`}
            </label>
            <input
              id="ff-faq-title"
              ref={titleField}
              className="ff-faq__input"
              value={current.t}
              placeholder="Does it come with..."
              disabled={locked}
              onChange={(event) => edit({ t: event.target.value })}
              onKeyDown={(event) => {
                // See the header: the reference's global Enter leaves the page
                // from this field. Here it moves to the answer, which is the
                // field's own next step.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  bodyField.current?.focus();
                }
              }}
            />

            <label className="ff-faq__label" htmlFor="ff-faq-body">
              {`FAQ ${String(index + 1)} Body`}
            </label>
            <textarea
              id="ff-faq-body"
              ref={bodyField}
              className="ff-faq__area"
              value={current.b}
              placeholder="Yes, it comes with..."
              disabled={locked}
              onChange={(event) => edit({ b: event.target.value })}
            />

            <div className="ff-faq__buttons">
              <button
                type="button"
                className="ff-faq__add"
                onClick={() => void add()}
                disabled={locked}
              >
                Add FAQ
              </button>
              {/* The reference's own word, and `next` is in §33.11.4's
                  `OBJECTLESS_CTA_LABELS` — the same knowing exception
                  `VisualsStep`, `SocialsStep` and `ConfirmProblem` already carry
                  on these pages, where the reference's copy is the
                  specification. What costs the composition nothing is naming the
                  destination to a screen reader, so the accessible name does and
                  it contains the visible word (WCAG 2.5.3). */}
              <button
                type="button"
                className="ff-faq__cta"
                data-stage-anim="cta"
                aria-label="Next — your Backer rewards"
                onClick={() => void goOn()}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Everything below is absolutely positioned in the chrome rather than in
          the stage, so a save that fails, a lock, or an announcement can never
          move the composition by a pixel. The reference has none of it, and each
          line is behaviour rather than decoration. */}
      {locked ? (
        <p className="ff-faq__note">
          Your campaign is with us for review, so these questions stay as you submitted them.
          Changing one is a support request.
        </p>
      ) : null}

      <p
        className="ff-faq__save"
        role="status"
        aria-live="polite"
        data-loud={loud ? 'true' : 'false'}
      >
        {status}
      </p>

      <p className="ff-faq__live sr-only" role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
