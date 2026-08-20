/**
 * Screens 2 and 3 — confirming what Proovd understood. Spec §9, §33.1.5.
 *
 * REBUILT 2026-08-20 to the supplied reference (`Proovd Founder Flow v2.dc.html`,
 * `[data-problem]` / `probWide`), from scratch rather than adjusted. The
 * presentation and the interaction are the reference's own; the read, the
 * autosave, the address and the provenance rules are unchanged.
 *
 * ── The layout model is the reference's, not an approximation of it ─────────
 * These pages are not laid out responsively there. They are authored once, on
 * a fixed 2496x1542 stage, and that stage is scaled to the viewport:
 *
 *     fitStages(){ let s = Math.min(innerWidth/2496, innerHeight/1542) * .78;
 *                  if (c==='problem' || c==='solution') s *= 1.38; }
 *
 * — `.78` is the prototype's own `pageScale` default and `1.38` is its comment
 * "one panel, one button: reads bigger". Inside that stage sits a 1304px
 * column, centred. Every child below carries the reference's own pixel value,
 * exactly as `InviteClaim` does for screen 1. Reproducing the ratios against a
 * fluid container instead is correct at one viewport height and wrong at every
 * other one, because the scale is driven by `innerHeight / 1542` on any
 * ordinary desktop window.
 *
 * `isClaimPhone()` returns `false` in the reference — "one composition
 * everywhere: the phone posture stays off" — so its `probPhone` branch is dead
 * code and this composition is what every viewport gets, exactly as there.
 *
 * ── Measured against the prototype, its stage sometimes reads 2% larger ─────
 * Worth knowing before somebody "corrects" the numbers above. The prototype
 * puts `ref="{{ stage }}"` on this screen's stage as well as the invite's, so
 * `claimFit` — `min(innerWidth / 1440, innerHeight / 1420)`, screen 1's own
 * function — writes the same element and, depending on which ran last, can be
 * the value left on it. At 1600x1000 that is 0.704225 where `fitStages` gives
 * 0.690. `fitStages` is what this screen follows: it is the function that
 * carries the `problem`/`solution` branch at all (`s *= 1.38`), it is what the
 * README documents for every page after the invite, and it is the only one of
 * the two that cannot overflow the viewport — `claimFit` divides by 1440, so a
 * tall narrow window would scale a 2496px stage past the screen and clip the
 * panel. Every proportion is identical either way; only the overall size moves.
 *
 * ── Two states, and the second is the same field ────────────────────────────
 * Read, and edit. The field is a `readOnly` textarea rather than a paragraph
 * that swaps into one: it is the same element in both states, so a long answer
 * scrolls natively either way, focus survives the mode change, and there is no
 * second DOM shape to keep accessible. Entering edit swaps the headline for
 * "Tell us what we got wrong", grows the field 220 → 478px, and collapses the
 * Next button's height and margin to zero — all three the reference's own, and
 * the last two through the CSS transitions it states inline.
 *
 * ── The typed value never comes back from the server ────────────────────────
 * `value` is loaded once and is the only copy from then on. A save reports
 * whether it landed; it never replaces what is in the box. The obvious
 * implementation — clear-on-error-and-refetch — is the single most common
 * autosave bug, and §9 names it: "a failed save never clears valid fields."
 *
 * ── What the reference does not draw, and what happened to it ───────────────
 * The reference gives these two screens no chrome at all: no wordmark, no
 * HELP, no message badge, no Back control, no provenance line, no save status.
 * `[data-problem]` is `position:fixed;inset:0;z-index:25` over an empty page.
 * All of that is followed — `.ff__top` is hidden here as it is on the invite,
 * and no badge is asked for. Two things survive it, both because they are
 * behaviour rather than decoration:
 *
 *   1. A save that FAILS says so. It renders below the CTA, absolutely
 *      positioned so it cannot move the composition, and is a `.sr-only` live
 *      region in every state the reference actually has (idle, saving, saved).
 *      §1.1 requires the failure state; a silent one is the §1.4 failure.
 *   2. The loading state before the record arrives. The reference has a record
 *      in memory and never waits for one.
 *
 * ── Recorded consequences of taking the reference's copy verbatim ───────────
 * `Next`, `Confirm` and `edit` are its own labels and ship as they are. `Next`
 * and `Confirm` are both in §33.11.4's `OBJECTLESS_CTA_LABELS`, so this screen
 * is a knowing exception to that rule rather than an oversight — the copy is
 * the specification here. The lead sentence is the same on both screens ("This
 * is how we understood your"); the earlier build said "And this is how…" on
 * the solution, which the reference does not.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useParams, useSearchParams } from 'react-router';
import { founderFlowPath } from '@proovd/shared';
import { Measure, Section, StatePanel } from '../../components/index.js';
import { problemIntro, problemToggle } from '../../components/anim.js';
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
  /** The word after the sticker. The reference's own `probWord`. */
  word: string;
  /** Where Next goes. */
  nextPageId: string;
  /** The field's accessible name. The reference gives it none. */
  label: string;
}

const CONFIG: Record<AnswerField, Config> = {
  problem: {
    field: 'problem',
    word: 'problem',
    nextPageId: 'solution',
    label: 'How we understood your problem',
  },
  solution: {
    // Capitalised in the reference, where the problem's is not. Its own string.
    field: 'solution',
    word: 'Solution',
    // The reach orbit, built 2026-08-20 — the reference's own
    // `onProbNext:()=>this.pageGo(c==='solution'?'reach':'solution')`.
    nextPageId: 'reach',
    label: 'How we understood your solution',
  },
};

/**
 * What `Next` says when the box is empty, per answer.
 *
 * Written so it is true whether Proovd drafted this answer or not: an Admin who
 * recorded nothing at intake and a Founder who deleted what was drafted arrive
 * at the same empty box, and a sentence naming a draft that never existed would
 * be wrong for one of them.
 */
const EMPTY_ANSWER: Record<AnswerField, string> = {
  problem:
    'Your campaign cannot be submitted without the problem, so this one cannot be skipped. Write it in your own words — a sentence or two is plenty.',
  solution:
    'Your campaign cannot be submitted without the solution, so this one cannot be skipped. Write it in your own words — a sentence or two is plenty.',
};

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()`, for the two screens it treats specially. The divisors are the
   stage's own size, unlike screen 1's `claimFit`, which divides by 1440x1420
   and is why the invite reads a notch larger than every later page. */

const FIT_W = 2496;
const FIT_H = 1542;
/** The prototype's `pageScale` prop default. */
const PAGE_SCALE = 0.78;
/** `if(!hero&&(c==='problem'||c==='solution'))s*=1.38` — its own comment:
 *  "one panel, one button: reads bigger". */
const PAPER_BOOST = 1.38;

function stageScale(): number {
  return (
    Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) *
    PAGE_SCALE *
    PAPER_BOOST
  );
}

/** The reference's read-state field height, and its edit-state one. */
const FIELD_H = { read: 220, edit: 478 } as const;
/** The reference's CTA height and its gap above the panel. Both go to 0. */
const CTA = { height: 129, marginTop: 62 } as const;

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
    <FlowPage pageId={config.field} param={token}>
      <PaperScreen config={config} token={token} initial={value} />
    </FlowPage>
  );
}

interface RailState {
  /** The reference's `probBar`: 1 while the field overflows, 0 otherwise. */
  on: boolean;
  top: string;
  height: string;
}

const RAIL_REST: RailState = { on: false, top: '0%', height: '30%' };

/**
 * The screen, and the one place its scale, its motion and its rail are owned.
 *
 * `relayIn` still runs on this page from `FlowPage` and still finds nothing to
 * do: every marker here is `data-prob-part`, not `data-anim`. That is the whole
 * mechanism — there is no flag to set and no branch in `FlowPage` to keep in
 * step.
 */
function PaperScreen({
  config,
  token,
  initial,
}: {
  config: Config;
  token: string;
  initial: string;
}) {
  const { leave } = useFlowNav();
  const [params] = useSearchParams();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  /**
   * Where `Next` goes when Positioning sent somebody here to fill this in.
   *
   * `AnswerPage`'s `?from=review` contract, applied to the one other place in
   * the flow that sends a Founder back for an answer. Without it, filling the
   * problem costs seven screens to return — solution, reach, the campaign path,
   * the address, a NEW six-digit code, and both confirms — which is the ring
   * again, walked by hand rather than by the router.
   *
   * In the address rather than in state, for the reason Session D records: it
   * survives a reload in the middle of the edit.
   */
  const returnTo = params.get('from') === 'positioning' ? 'positioning' : null;

  const [value, setValue] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [rail, setRail] = useState<RailState>(RAIL_REST);
  const [alert, setAlert] = useState<string | null>(null);

  const autosave = useAutosave<VettingPatch>(
    useCallback((patch: VettingPatch) => saveVetting(token, patch), [token]),
  );

  /**
   * `probBar()`, verbatim.
   *
   * The rail is the reference's own 9px track outside the sheet's right edge,
   * with a thumb whose height and offset track the scroll. The native bar is
   * hidden, so this is the only one — measured from the field rather than
   * mirrored from a second scroll position, which is why there is nothing to
   * fall out of step.
   *
   * The `sh <= h + 1` slack and the `.12` floor are both its numbers: a thumb
   * shorter than an eighth of the rail is a dot nobody can grab, and a one
   * pixel difference is a rounding error rather than an overflow.
   */
  const measureRail = useCallback(() => {
    const ta = field.current;
    if (!ta) return;
    const h = ta.clientHeight;
    const sh = ta.scrollHeight;
    if (sh <= h + 1) {
      setRail((prev) => (prev.on ? RAIL_REST : prev));
      return;
    }
    const ratio = Math.max(h / sh, 0.12);
    const offset = (ta.scrollTop / (sh - h)) * (1 - ratio);
    const next: RailState = {
      on: true,
      height: `${(ratio * 100).toFixed(2)}%`,
      top: `${(offset * 100).toFixed(2)}%`,
    };
    setRail((prev) =>
      prev.on && prev.top === next.top && prev.height === next.height ? prev : next,
    );
  }, []);

  // `fitStages`, for this screen. First, so the first paint is already at the
  // right scale — and on resize, because the reference refits there too. The
  // rail is re-measured with it: a narrower window is a shorter field.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      el.style.transform = `translate(-50%, -50%) scale(${stageScale()})`;
      measureRail();
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [measureRail]);

  // The entrance. `onSettled` is the reference's own `probBar()` call at the
  // end of `revealHead` — the rail's geometry is only true once the field is
  // at its real size.
  useLayoutEffect(() => {
    return problemIntro(root.current, measureRail);
    // Mount only: re-running it would stage the page a second time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The read/edit swap.
  //
  // Keyed on the previous VALUE, not on a "skip the first invocation" flag.
  // React re-invokes an effect immediately after tearing it down on mount
  // under StrictMode, and a flag that has already been flipped lets the second
  // pass through — which here ran `problemToggle` before anybody had touched
  // anything, and its `clearProps` wiped every element the entrance had just
  // staged. The whole reveal was gone in development and present in
  // production, which is the worst way to find that out. Comparing values
  // makes a re-invocation with nothing changed a genuine no-op.
  const wasEditing = useRef(editing);
  useLayoutEffect(() => {
    if (wasEditing.current === editing) return;
    wasEditing.current = editing;
    const stop = problemToggle(root.current, head.current, editing);
    const ta = field.current;
    if (ta) {
      if (editing) {
        ta.focus();
        const end = ta.value.length;
        try {
          ta.setSelectionRange(end, end);
        } catch {
          /* a field that refuses a caret is still an editable field */
        }
      } else {
        ta.blur();
      }
    }
    // The reference's own 520ms: the field's height is mid-transition until
    // then, so a rail measured now would be measured against the wrong box.
    const settle = window.setTimeout(measureRail, 520);
    return () => {
      window.clearTimeout(settle);
      stop();
    };
  }, [editing, measureRail]);

  function update(next: string) {
    setValue(next);
    // The refusal is about an empty box, so typing into it answers it. Leaving
    // it up while somebody writes would be the product arguing with them.
    if (alert && next.trim()) setAlert(null);
    autosave.queue({ [config.field]: next } as VettingPatch);
    measureRail();
  }

  async function next() {
    /*
      An empty answer does not go past this screen, and that is a routing fix
      rather than a new rule.

      §9 submits all three answers together and `submitVetting` refuses a short
      set by name, so letting an empty one through here saved nobody a step — it
      deferred the refusal to Positioning, six pages later, which answered it by
      navigating BACKWARD to this page. That closed a ring: problem → solution →
      reach → campaign type → email → code → the two confirms → positioning →
      back to problem, and `visuals` was never reached. The refusal belongs
      where the empty box is.

      It opens the editor rather than sitting under an inert button: the field
      is read-only until Edit, so a refusal with the box still closed names a
      control the person cannot see. The editing effect focuses it and puts the
      caret at the end.
    */
    if (!value.trim()) {
      setAlert(EMPTY_ANSWER[config.field]);
      setEditing(true);
      return;
    }

    setAlert(null);
    // Land what is typed before moving. Nothing here depends on the answer
    // having reached the server, but the next page reads it back — and when
    // Positioning is the next page, it reads it back as `completeness`, which
    // is the whole point of the flush.
    await autosave.flush();
    leave(founderFlowPath(returnTo ?? config.nextPageId, token), 1);
  }

  const status = describeSaveState(autosave.state);
  const loud =
    autosave.state.status === 'failed' || autosave.state.status === 'retrying';

  return (
    <div className="ff-prob" data-answer={config.field} ref={root}>
      <div className="ff-prob__stage" data-page-stage="1" ref={stage}>
        <div className="ff-prob__col">
          {editing ? (
            /* The edit headline: a flex row, sticker first, 33px gap. */
            <h1
              className="ff-prob__head ff-prob__head--edit"
              data-prob-part="head"
              ref={head}
            >
              <img
                className="ff-prob__sticker ff-prob__sticker--edit"
                src={`/assets/sticker-${config.field}.webp`}
                alt=""
              />
              Tell us what we got wrong
            </h1>
          ) : (
            /* The read headline. The sticker is inline in the sentence and
               sits on the baseline through its own negative `vertical-align`;
               the words either side of it carry no space of their own, because
               the reference's spacing is the image's margins. */
            <h1 className="ff-prob__head" data-prob-part="head" ref={head}>
              {'This is how we understood your'}
              <img
                className="ff-prob__sticker"
                src={`/assets/sticker-${config.field}.webp`}
                alt=""
              />
              {config.word}
            </h1>
          )}

          <div className="ff-prob__panel" data-prob-part="panel">
            <div className="ff-prob__sheet">
              <div
                className="ff-prob__rail"
                style={{ opacity: rail.on ? 1 : 0 }}
                aria-hidden="true"
              >
                <div
                  className="ff-prob__thumb"
                  style={{ top: rail.top, height: rail.height }}
                />
              </div>
              <textarea
                className="ff-prob__text"
                data-prob-part="field"
                ref={field}
                aria-label={config.label}
                readOnly={!editing}
                value={value}
                onChange={(event) => update(event.target.value)}
                onScroll={measureRail}
                style={{ height: editing ? FIELD_H.edit : FIELD_H.read }}
              />
            </div>

            <div className="ff-prob__editrow" data-prob-part="edit">
              <button
                type="button"
                className="ff-prob__edit"
                onClick={() => setEditing((on) => !on)}
              >
                {editing ? null : (
                  /* The reference's own pencil, at its own weights. */
                  <svg
                    viewBox="0 0 24 24"
                    width="34"
                    height="34"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                )}
                {editing ? 'Confirm' : 'edit'}
              </button>
            </div>
          </div>

          {/* Collapsed rather than hidden, exactly as there — its height and
              margin are what animate. `aria-hidden` and `tabIndex={-1}` while
              it is 0px tall, so a keyboard user cannot land on a control with
              no size; Confirm brings it back, which is what the eye sees too. */}
          <button
            type="button"
            className="ff-prob__cta"
            data-prob-part="cta"
            onClick={() => void next()}
            style={{
              height: editing ? 0 : CTA.height,
              marginTop: editing ? 0 : CTA.marginTop,
            }}
            aria-hidden={editing || undefined}
            tabIndex={editing ? -1 : undefined}
          >
            Next
          </button>

          {/* Absolutely positioned under the column, so it can never move the
              composition. Announced in every state and drawn in one.

              The refusal replaces it rather than stacking beside it: they share
              one absolute slot, and it is its own element so mounting it is
              what announces it — swapping `role` on a live region does not. */}
          {alert ? (
            <p className="ff-prob__save is-loud" role="alert" data-state="blocked">
              {alert}
            </p>
          ) : (
            <p
              className={loud ? 'ff-prob__save is-loud' : 'ff-prob__save sr-only'}
              role="status"
              aria-live="polite"
              data-state={autosave.state.status}
            >
              {status}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
