/**
 * Step 23 — your brand voice, rebuilt 1:1 from the reference.
 *
 * REBUILT 2026-08-21 from the supplied reference (`Proovd Founder Flow v2.dc.html`,
 * `[data-voice]` / `kindWide`), from scratch. The Session F surface it replaces
 * was a token-scale chip list with a textarea under it; this is the reference's
 * own composition — a sentence a Founder edits by tapping the adjectives inside
 * it, with a replacement sheet behind each chip and an "add more" sheet behind
 * `+ add more`.
 *
 * `isVoice(c){ return (c||this.cur())==='build' && this.state.buildStep===0 &&
 * this.state.pageStatus==='draft'; }` — the first of its six build pages, which
 * is where `buildFlowStepsFor` puts ours too.
 *
 * ── The layout model is the reference's, not an approximation of it ─────────
 * Authored once on a fixed 2496x1542 stage and scaled to the viewport by
 * `fitStages()`:
 *
 *     let s = Math.min(innerWidth/2496, innerHeight/1542) * (pageScale || .78);
 *
 * No branch of that function names `build`, so this screen takes `pageScale`
 * alone — unlike Last look's `s *= .9` or `problem`/`solution`'s `s *= 1.38`.
 * Measured at 1320x900 the reference reports `scale(0.4125)`, which is exactly
 * that expression. Inside the stage sits a 2000px column, centred, and every
 * child below carries the reference's own pixel value. Nothing reflows; the
 * stage scales instead, so the composition is identical at every viewport
 * (§33.11.1) — and `isClaimPhone()` is `false` there, so its `kindPhone` branch
 * is dead code and this composition is what every viewport gets.
 *
 * ── The chips are a way into ONE field ─────────────────────────────────────
 * `campaign_build.brand_voice`, a §14.4-required text column. The words compose
 * the text, the text is what is stored, and `parseBrandVoice` reads them back
 * out — which is what lets the same record be edited from
 * `/campaigns/:campaignId/build`, whose textarea is the other surface over this
 * column. A repeater beside it would make §14.4's field and the Founder's chips
 * two answers to one question, and the one nobody updated is the one that ships.
 *
 * ── What the reference draws that is refused, and why ──────────────────────
 *   - `.slice(0, 6)` on the words. §14.4 caps nothing, and a Founder with a
 *     seventh adjective would be refused by a number nobody agreed to (§1 rule
 *     6). `FOUNDER_FLOW_ABSENCES` already records that refusal by name.
 *   - `voiceBrand: 'Teeb'`, hardcoded. The brand name is not a record this
 *     campaign-scoped read carries — it lives on `founder_prospects`, which is
 *     Admin's — so the sentence is built from `campaign_build.title`, the
 *     Founder's own words for this campaign, and reads `Your brand is …` when
 *     even that is unwritten. Inventing a name would be §1 rule 6; leaving the
 *     subject out would be a sentence somebody failed to finish.
 *   - The document-level Enter handler. `enterAdvance` is global in the
 *     reference and fires on every screen; implementing it on this one page of
 *     twenty-four would make Enter mean something here and nothing next door.
 *     It is also a live defect there: the custom-word field is an `<input>`
 *     rather than a `<textarea>`, so `enterAdvance`'s early return does not
 *     catch it and pressing Enter to add a word ALSO advances to the next build
 *     step, out of a sheet that is still open. Enter inside that field is
 *     screen-local and intentional, and that half is reproduced exactly.
 *
 * ── What is added that the reference has none of, and why ──────────────────
 * Escape closes a sheet by its own `Close` path (which discards nothing a
 * `Confirm` would have kept), focus enters the sheet and returns to the control
 * that opened it, and every control has a visible focus ring. The reference has
 * no focus treatment anywhere and no way out of a sheet but its own button; a
 * control a keyboard user cannot locate is not the same control (§28.5,
 * §33.11), and none of it changes the composition or a single tween.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Navigate, useParams } from 'react-router';
import {
  BRAND_VOICE_CHIP_FILLS,
  BRAND_VOICE_NO_WORDS_YET,
  BRAND_VOICE_WORDS_ALL,
  BRAND_VOICE_WORDS_SHORT,
  brandVoiceChipAffixes,
  composeBrandVoice,
  founderFlowPath,
  parseBrandVoice,
} from '@proovd/shared';
import { StatePanel, NO_ACTION } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { stageRelayIn, voiceSheetIn } from '../../components/anim.js';
import { describeSaveState } from '../../lib/autosave.js';
import { FlowPage, HelpDrawer, flowDirection, useFlowNav } from './FlowPage.js';
import { useBuildFlow, type BuildFlowState } from './useBuild.js';
import { isReferenceWalkthrough } from './referenceWalkthrough.js';

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()` for a page it treats as ordinary: the stage's own size as the
   divisors and `pageScale` alone. */

const FIT_W = 2496;
const FIT_H = 1542;
/** The prototype's `pageScale` prop default. */
const PAGE_SCALE = 0.78;

function stageScale(): number {
  return Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * PAGE_SCALE;
}

/**
 * The reference's own relay order for this screen, out of `verifyIntro`'s fixed
 * list `pill, head, field, boxes, note, fee, sub, hint, panel, art, art2, cta,
 * edit`.
 *
 * It is NOT document order — `hint` sits before `panel` in that list and after
 * it on the page — and the 0.085s stagger follows THIS order, which is why it
 * is passed rather than read from the DOM. Sampled frame by frame against the
 * reference at 1320x900, each element's first movement: note 112ms, hint 196,
 * panel 278, cta 362.
 */
const RELAY = ['note', 'hint', 'panel', 'cta'] as const;

/* Verbatim, from `[data-voice]`'s `kindWide` branch and its two sheets. */
const NOTE = 'Brand Voice and tone';
const ADD_MORE = '+ add more';
const CTA_LABEL = 'Continue';
const REPLACE_TITLE = 'Select the replacement';
const ADD_TITLE_TAIL = 'is also:';
const ADD_TITLE_HINT = 'Select one or multiple';
const TELL_US_MORE = 'Tell us more';
const MORE_PLACEHOLDER = 'My brand is a brand that...';
const CONFIRM = 'Confirm';
const CLOSE = 'Close';

/** `voiceBrand`'s stand-in while the Founder has not titled the campaign. */
const FALLBACK_BRAND = 'Your brand';

/** The same two campaign states accepted by the build write routes. */
const EDITABLE_STATUSES: readonly string[] = ['affiliate_response_and_build', 'changes_required'];

export function VoiceStep() {
  const { campaignId = '' } = useParams();
  const build = useBuildFlow(campaignId);

  if (build.failure) {
    return (
      <FlowPage pageId="voice" param={campaignId}>
        <div className="ff-vc__state">
          <StatePanel
            state="We could not open your campaign page"
            whatHappened={build.failure}
            next="Reload the page. Everything you have already saved is on your campaign."
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
    return <SurfaceLoading subject="your campaign page" reference="Your campaign" />;
  }

  // The reference's `scVoice` is true only while `pageStatus === 'draft'`.
  // Do not render a read-only imitation of that screen for a campaign already
  // in review; send it to the lifecycle screen instead.
  if (
    !EDITABLE_STATUSES.includes(build.state.campaignStatus) &&
    !isReferenceWalkthrough(campaignId)
  ) {
    return <Navigate to={founderFlowPath('in-review', campaignId)} replace />;
  }

  return (
    <FlowPage pageId="voice" param={campaignId}>
      <VoiceScreen campaignId={campaignId} build={build} />
    </FlowPage>
  );
}

/** Which sheet is open, and which word it was opened against. */
type Sheet = { kind: 'none' } | { kind: 'replace'; index: number } | { kind: 'add' };

function VoiceScreen({
  campaignId,
  build,
}: {
  campaignId: string;
  build: BuildFlowState;
}) {
  const { leave, swapToPage } = useFlowNav();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  // Read once, during the first render: `FlowPage` resets the module value in
  // its own layout effect, and a later re-render would read the reset.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  // The record, read once. §9's rule: the typed value never comes back from the
  // server, because a save that raced a click would otherwise reinstate the
  // word the Founder had just replaced.
  const stored = build.state?.build?.brandVoice;
  const initial = useMemo(() => parseBrandVoice(stored), [stored]);
  const [words, setWords] = useState<readonly string[]>(initial.words);
  const [more, setMore] = useState(initial.more);

  const [sheet, setSheet] = useState<Sheet>({ kind: 'none' });
  const [busy, setBusy] = useState(false);

  const brand = (build.state?.build?.title ?? '').trim() || FALLBACK_BRAND;
  const write = useCallback(
    (next: { words?: readonly string[]; more?: string }) => {
      const value = { words: next.words ?? words, more: next.more ?? more };
      if (next.words) setWords(next.words);
      if (next.more !== undefined) setMore(next.more);
      build.autosave.queue({ brandVoice: composeBrandVoice(value) });
    },
    [build.autosave, more, words],
  );

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

  // The entrance — `verifyIntro`'s `runRelay`, which is all this screen gets:
  // it has no `[data-anim="grow"]`, it is not `[data-lastlook]` and it is not
  // `[data-match]`, so every one of that function's earlier branches is false.
  useLayoutEffect(() => stageRelayIn(root.current, direction.current ?? 1, RELAY), []);

  async function goOn() {
    if (busy) return;
    setBusy(true);
    try {
      // Land what is chosen before moving. §14.4 counts this column among its
      // required ten, and `deriveBuildStatus` reads it on the next page.
      await build.autosave.flush();
    } finally {
      setBusy(false);
    }
    // The reference goes straight into the model-specific build walk here:
    // Idea campaigns have a threshold; Product campaigns do not.
    swapToPage(build.state?.model === 'idea' ? 'threshold' : 'faqs', 1);
  }

  const status = describeSaveState(build.autosave.state);
  const loud =
    build.autosave.state.status === 'failed' || build.autosave.state.status === 'retrying';

  return (
    <div className="ff-vc" ref={root}>
      {/* The reference's own control, bottom-left. `back()`'s build branch goes
          to its `fee` screen. Its label names the
          destination only to a screen reader: the visible word is the
          reference's own `Back`, and §33.11.4's objectless-CTA rule is answered
          by the accessible name rather than by overriding its copy. */}
      <button
        type="button"
        className="ff-vc__back"
        aria-label="Back to your listing fee"
        onClick={() => leave(founderFlowPath('fee', campaignId), -1)}
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

      <div className="ff-vc__top">
        {/* Not a link. A half-written campaign page is not a site, and the way
            out of a Founder's own form should not be the brand. */}
        <img className="ff-vc__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        {/* §30's own position — no model writes anything in the tone a Founder
            picks here — reads on the drawer rather than on the add sheet. It
            was on the sheet first, and it made that card 42px taller than the
            reference's, which moved every row inside it because the sheet is
            centred. HELP is where this flow puts reading and it is one gesture
            from the screen, so the promise ships and the composition holds. */}
        <HelpDrawer
          pageId="voice"
          param={campaignId}
          trigger={
            <button type="button" className="ff-vc__help">
              Help
            </button>
          }
        />
      </div>

      <div className="ff-vc__stage" data-page-stage="1" ref={stage}>
        <div className="ff-vc__col">
          {/* §33.11.2 wants exactly one `h1`, and this is the only thing on the
              screen that names it. The reference draws a `span`; the level is
              ours and every pixel of the treatment is its own. */}
          <h1 className="ff-vc__note" data-stage-anim="note">
            {NOTE}
          </h1>

          <div className="ff-vc__panel" data-stage-anim="panel">
            <span className="ff-vc__brand">{brand} is</span>
            {words.length === 0 ? (
              <span className="ff-vc__empty">{BRAND_VOICE_NO_WORDS_YET}</span>
            ) : null}
            {words.map((word, index) => {
              const { pre, post } = brandVoiceChipAffixes(index, words.length);
              return (
                <span className="ff-vc__chipwrap" key={`${word}-${String(index)}`}>
                  {/* Both affixes are rendered even when empty. In the reference
                      they are always present and always 96px, so the wrapper's
                      26px gaps apply either side of the chip whether or not a
                      word sits in one — the first chip measures 502.44 stage px,
                      which is 0 + 26 + 450.44 + 26 + 0. Dropping an empty affix
                      would move the chip by 26 of them. */}
                  <span className="ff-vc__word">{pre}</span>
                  <button
                    type="button"
                    className="ff-vc__chip"
                    style={{
                      background:
                        BRAND_VOICE_CHIP_FILLS[index % BRAND_VOICE_CHIP_FILLS.length],
                    }}
                    aria-label={`Replace ${word}`}
                    onClick={(event) => {
                      markOrigin(event.currentTarget);
                      setSheet({ kind: 'replace', index });
                    }}
                  >
                    {word}
                    <span className="ff-vc__caret" aria-hidden="true">
                      ▼
                    </span>
                  </button>
                  <span className="ff-vc__word">{post}</span>
                </span>
              );
            })}
          </div>

          <button
            type="button"
            className="ff-vc__hint"
            data-stage-anim="hint"
            onClick={(event) => {
              markOrigin(event.currentTarget);
              setSheet({ kind: 'add' });
            }}
          >
            {ADD_MORE}
          </button>

          <button
            type="button"
            className="ff-vc__cta"
            data-stage-anim="cta"
            aria-label={build.state?.model === 'idea' ? 'Continue to your pre-order threshold' : 'Continue to your FAQs'}
            onClick={() => void goOn()}
            disabled={busy}
          >
            {CTA_LABEL}
          </button>
        </div>
      </div>

      {/* The reference has no success/status line. Keep only a failure visible:
          it requires action and cannot honestly disappear, while routine
          “Saving…” / “Saved” states remain out of the composition. */}
      {loud ? (
        <p className="ff-vc__save" role="alert">
          {status}
        </p>
      ) : null}
      {sheet.kind === 'replace' ? (
        <ReplaceSheet
          brand={brand}
          word={words[sheet.index] ?? ''}
          index={sheet.index}
          onClose={() => {
            setSheet({ kind: 'none' });
            restoreOrigin();
          }}
          onConfirm={(picked) => {
            // `voiceReplaceDone`: `ws[st.voiceEdit] = st.voicePick`.
            write({ words: words.map((w, i) => (i === sheet.index ? picked : w)) });
            setSheet({ kind: 'none' });
            restoreOrigin();
          }}
        />
      ) : null}

      {sheet.kind === 'add' ? (
        <AddSheet
          brand={brand}
          chosen={words}
          more={more}
          onMore={(text) => write({ more: text })}
          onClose={() => {
            setSheet({ kind: 'none' });
            restoreOrigin();
          }}
          onConfirm={(picks, text) => {
            // `voiceAddDone`, minus its `.slice(0, 6)`.
            write({
              words: [...words, ...picks.filter((w) => !words.includes(w))],
              more: text,
            });
            setSheet({ kind: 'none' });
            restoreOrigin();
          }}
        />
      ) : null}
    </div>
  );
}

/* ── `markOrigin` ──────────────────────────────────────────────────────────
   `this._org = e.currentTarget.getBoundingClientRect()`, captured at the click
   and read by `modalIntro` once the sheet has mounted. Module-scoped rather
   than a ref for the same reason `pendingDirection` is: it is a fact about the
   transition rather than about either surface, and by the time the sheet exists
   the element it describes may already have re-rendered. The element itself is
   kept beside it so focus can go back where it came from — the reference does
   neither, and a keyboard user who closes a sheet there has to start again from
   the top of the page. */

let origin: DOMRect | null = null;
let originEl: HTMLElement | null = null;

function markOrigin(el: HTMLElement): void {
  origin = el.getBoundingClientRect();
  originEl = el;
}

function restoreOrigin(): void {
  const el = originEl;
  originEl = null;
  // After the sheet has unmounted, so focus is never moved into a dying tree.
  requestAnimationFrame(() => el?.focus());
}

/** The two sheets' shared entrance, Escape handling and opening focus. */
function useSheet(onClose: () => void) {
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => voiceSheetIn(box.current, origin), []);

  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return { box, first };
}

/**
 * `voiceReplaceOpen` — "Select the replacement".
 *
 * Its frame wears the chip's own fill (`voiceModalBg: (st.voiceEdit%2) ?
 * '#DFFAFC' : '#F4FFA0'`), which is what makes the sheet read as having grown
 * out of the word that was pressed rather than as a dialog that arrived.
 *
 * Nothing is written until `Confirm`, and the control says so before it is
 * pressed: `voiceReplaceLabel` is `Close` while nothing is picked and
 * `voiceReplaceBg` is grey, so the same button is honestly two different acts.
 */
function ReplaceSheet({
  brand,
  word,
  index,
  onClose,
  onConfirm,
}: {
  brand: string;
  word: string;
  index: number;
  onClose: () => void;
  onConfirm: (picked: string) => void;
}) {
  const { box, first } = useSheet(onClose);
  const [pick, setPick] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [own, setOwn] = useState<readonly string[]>([]);
  const customRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (customOpen) customRef.current?.focus();
  }, [customOpen]);

  // `this.VOICE_SHORT.concat(st.voiceCustomWords || [])`.
  const options = [...BRAND_VOICE_WORDS_SHORT, ...own];

  return (
    <div className="ff-vc__scrim">
      <div
        className="ff-vc__sheet"
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={REPLACE_TITLE}
        style={{
          background: BRAND_VOICE_CHIP_FILLS[index % BRAND_VOICE_CHIP_FILLS.length],
        }}
      >
        {/* `modalIntro` staggers `box.querySelector(':scope > div').children`,
            so this inner card is the element whose children are the rows. */}
        <div className="ff-vc__card">
          <span className="ff-vc__sheet-title">{REPLACE_TITLE}</span>
          <span className="ff-vc__sheet-title ff-vc__sheet-title--gap">
            {brand} isn’t <span className="ff-vc__was">{word}</span> it is:
          </span>
          <div className="ff-vc__opts">
            {options.map((option, i) => (
              <button
                type="button"
                key={option}
                ref={i === 0 ? first : undefined}
                className={pick === option ? 'ff-vc__opt is-on' : 'ff-vc__opt'}
                aria-pressed={pick === option}
                onClick={() => setPick(option)}
              >
                {option}
              </button>
            ))}
            {customOpen ? (
              <input
                className="ff-vc__custom"
                ref={customRef}
                value={custom}
                aria-label="A word of your own"
                onChange={(event) => setCustom(event.target.value)}
                onKeyDown={(event) => {
                  // `onVoiceCustomKey`: Enter adds the word and picks it. It
                  // does not confirm, and it does not leave the page.
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  const value = custom.trim();
                  if (!value) return;
                  setOwn((list) => (list.includes(value) ? list : [...list, value]));
                  setPick(value);
                  setCustomOpen(false);
                  setCustom('');
                }}
              />
            ) : (
              <button
                type="button"
                className="ff-vc__opt ff-vc__opt--plus"
                aria-label="Add a word of your own"
                onClick={() => setCustomOpen(true)}
              >
                +
              </button>
            )}
          </div>
          <div className="ff-vc__sheet-foot">
            <button
              type="button"
              className={pick ? 'ff-vc__done' : 'ff-vc__done is-off'}
              onClick={() => (pick ? onConfirm(pick) : onClose())}
            >
              {pick ? CONFIRM : CLOSE}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * `voiceAddOpen` — "{brand} is also:".
 *
 * Multi-select, with the "Tell us more" paragraph beside it. That paragraph is
 * the one thing in the reference's own sheet that is collected and then never
 * read: `voiceMore` is written by `onVoiceMore` and appears on no later screen
 * and in no output. Here it is part of the record — `composeBrandVoice` writes
 * it after the words — because §14.4's field is a description of how the
 * campaign should sound, and a sentence the Founder wrote about their brand is
 * exactly that. Collecting it and storing it nowhere would be the §1.4 failure.
 */
function AddSheet({
  brand,
  chosen,
  more,
  onMore,
  onClose,
  onConfirm,
}: {
  brand: string;
  chosen: readonly string[];
  more: string;
  onMore: (text: string) => void;
  onClose: () => void;
  onConfirm: (picks: readonly string[], more: string) => void;
}) {
  const { box, first } = useSheet(onClose);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [own, setOwn] = useState<readonly string[]>([]);
  const [text, setText] = useState(more);
  const customRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (customOpen) customRef.current?.focus();
  }, [customOpen]);

  // `this.VOICE_ALL.concat(st.addCustomWords || [])`.
  const options = [...BRAND_VOICE_WORDS_ALL, ...own];
  const toggle = (word: string) =>
    setPicked((list) =>
      list.includes(word) ? list.filter((w) => w !== word) : [...list, word],
    );

  return (
    <div className="ff-vc__scrim">
      <div
        className="ff-vc__sheet ff-vc__sheet--add"
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={`${brand} ${ADD_TITLE_TAIL}`}
      >
        <div className="ff-vc__card">
          {/* The brand is its own element, and that is layout rather than
              markup taste: this row is `display: flex`, so the reference's
              three children — its `{{ voiceBrand }}` span, the bare text, and
              the hint — are three flex items with TWO 14px gaps between them.
              Written as one text node the two words would be a single
              anonymous item with one gap and a real space glyph, which puts
              the hint 7.85px to the left of where it sits there. */}
          <span className="ff-vc__sheet-title ff-vc__sheet-title--row">
            <span>{brand}</span> {ADD_TITLE_TAIL}{' '}
            <span className="ff-vc__sheet-hint">{ADD_TITLE_HINT}</span>
          </span>
          <div className="ff-vc__opts">
            {options.map((option, i) => {
              const on = picked.includes(option);
              const already = chosen.includes(option);
              return (
                <button
                  type="button"
                  key={option}
                  ref={i === 0 ? first : undefined}
                  className={
                    on ? 'ff-vc__opt ff-vc__opt--sm is-on' : 'ff-vc__opt ff-vc__opt--sm'
                  }
                  aria-pressed={on}
                  // `voiceAddDone` filters a word already in the sentence, so
                  // picking one is a no-op there and silently so. Saying it is
                  // the same behaviour with the reason attached (§1.4).
                  aria-describedby={already ? 'ff-vc-already' : undefined}
                  onClick={() => toggle(option)}
                >
                  {option}
                </button>
              );
            })}
            {customOpen ? (
              <input
                className="ff-vc__custom ff-vc__custom--sm"
                ref={customRef}
                value={custom}
                aria-label="A word of your own"
                onChange={(event) => setCustom(event.target.value)}
                onKeyDown={(event) => {
                  // `onAddCustomKey`: adds the word AND selects it.
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  const value = custom.trim();
                  if (!value) return;
                  setOwn((list) => (list.includes(value) ? list : [...list, value]));
                  setPicked((list) => (list.includes(value) ? list : [...list, value]));
                  setCustomOpen(false);
                  setCustom('');
                }}
              />
            ) : (
              <button
                type="button"
                className="ff-vc__opt ff-vc__opt--sm ff-vc__opt--plus"
                aria-label="Add a word of your own"
                onClick={() => setCustomOpen(true)}
              >
                +
              </button>
            )}
          </div>
          <span className="ff-vc__more-label" id="ff-vc-more-label">
            {TELL_US_MORE}
          </span>
          <div className="ff-vc__more-row">
            <textarea
              className="ff-vc__more"
              placeholder={MORE_PLACEHOLDER}
              aria-labelledby="ff-vc-more-label"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onBlur={() => onMore(text)}
            />
            <button
              type="button"
              className="ff-vc__done ff-vc__done--sm"
              onClick={() => onConfirm(picked, text)}
            >
              {CONFIRM}
            </button>
            {/* Not on the reference's sheet, and available to a screen reader
                only: it says why a word already in the sentence does nothing,
                which there is silent.

                It sits INSIDE this row rather than beside it, and that is
                `modalIntro`'s doing: the row stagger runs over the card's own
                children, so a fifth child would add a fifth 60ms step to a
                four-step sequence. Absolutely positioned either way, so it
                costs no height — the visible sentence that was here first made
                the card 42px taller than the reference's and moved every row
                in it; that one is in the HELP drawer now. */}
            <p className="sr-only" id="ff-vc-already">
              Already in your sentence.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
