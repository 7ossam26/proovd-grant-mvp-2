/**
 * The last look at the problem — Founder Flow v2, the reference's `probConfirm`.
 *
 * BUILT 2026-08-20 from the supplied reference (`Proovd Founder Flow v2.dc.html`,
 * `[data-pconfirm]` / `kindWide`), from scratch. It sits between the six-digit
 * code and Positioning, which is where the reference puts it: `next()` on the
 * `type` screen runs `this.step({si:this.I('vetting'), vStep:0})`, and vStep 0
 * of `vetting` IS this page — `isProbConfirm(c){ return n==='vetting' &&
 * !this.state.vReviewing && this.state.vStep<2; }`.
 *
 * ── This is not `ConfirmAnswer`, and the two must not be merged ─────────────
 * `ConfirmAnswer` is the reference's `[data-problem]` — screens 2 and 3, where
 * the answer is first read and edited, on a 1304px column with a sticker in the
 * headline, a scroll rail, a `Next` CTA and a `1.38` stage boost. This is
 * `[data-pconfirm]`: a different composition (1760px column, no sticker, no
 * rail, no boost), a different headline, a different CTA, and a different job —
 * a last look before the rest of the questions build on the answer. They share
 * one RECORD and nothing else, which is exactly the reference's own
 * arrangement: `pcText` reads `st.probText`, the same state `[data-problem]`
 * writes.
 *
 * ── The layout model is the reference's, not an approximation of it ─────────
 * Authored once on a fixed 2496x1542 stage and scaled to the viewport by
 * `fitStages()`:
 *
 *     let s = Math.min(innerWidth/2496, innerHeight/1542) * (pageScale || .78);
 *
 * No branch of that function names this screen, so it takes `pageScale` alone —
 * unlike `problem`/`solution`, which carry its `s *= 1.38`. Inside the stage
 * sits a 1760px column, centred and pushed 70px down (`translate(-50%,
 * calc(-50% + 70px))`), and every child below carries the reference's own pixel
 * value. Nothing reflows; the stage scales instead.
 *
 * ── Two states, one field, and the CTA is REMOVED rather than hidden ────────
 * Read, and edit. The reference's `sc-if value="{{ pcView }}"` wraps the green
 * CTA and the pencil, so entering edit unmounts the button entirely and the
 * panel grows 470 → 640px into the space it leaves. That is why the two states
 * are almost the same total height — 1260px against 1270px on the stage — and
 * why the composition does not jump. Reproducing it as a collapsed-to-zero
 * button instead would leave a 0px control in the tab order and would animate
 * a height the reference does not animate.
 *
 * The `Save` label its `pcCta` computes for the editing state is unreachable
 * for the same reason: `pcView` is false whenever `pcEditing` is true, so the
 * button that would carry it is not rendered. It is not implemented here, and
 * that is the reference's own behaviour rather than an omission.
 *
 * ── The typed value never comes back from the server ────────────────────────
 * `value` is loaded once and is the only copy from then on. A save reports
 * whether it landed; it never replaces what is in the box (§9: "a failed save
 * never clears valid fields").
 *
 * ── Recorded consequences of taking the reference's copy verbatim ───────────
 * `Confirm` and `edit` are its own labels. `Confirm` is in §33.11.4's
 * `OBJECTLESS_CTA_LABELS`, so this screen is the same knowing exception
 * `ConfirmAnswer` already records — the copy is the specification here.
 * `Still my problem` is not objectless and needs none.
 *
 * ── What the reference draws that is not decoration, and survives ───────────
 * The wordmark and HELP are drawn INSIDE this screen's own `z-index: 25` fixed
 * layer, where the reference puts them, so `FlowPage`'s `.ff__top` is hidden
 * for this page exactly as it is for Positioning: left in place it would sit
 * under that layer and be unreachable. A save that FAILS says so, below the
 * column and absolutely positioned so it can never move the composition; the
 * reference has a record in memory and never waits for one, so the loading
 * state is ours.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { founderFlowPath } from '@proovd/shared';
import { SurfaceLoading } from '../../features/public/states.js';
import { stageRelayIn, stageToggleHead } from '../../components/anim.js';
import { describeSaveState } from '../../lib/autosave.js';
import { useAutosave } from '../../lib/useAutosave.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import {
  fetchVetting,
  saveVetting,
  type VettingPatch,
  type VettingState,
} from '../draft/api.js';
import { FlowPage, HelpDrawer, flowDirection, useFlowNav } from './FlowPage.js';

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
 * edit`. Passed to `stageRelayIn` rather than read from the DOM, because the
 * 0.085s stagger follows THIS order and not document order.
 */
const RELAY = ['head', 'panel', 'cta', 'edit'] as const;

/** `pcH`: the field's read height, and its edit height. Its own numbers. */
const FIELD_H = { read: 470, edit: 640 } as const;

/** `pcHead`, for `vStep` 0. Verbatim. */
const HEAD = 'You confirmed this was the problem, just double checking.';
/** `pcCta`, for `vStep` 0. Verbatim. */
const CTA_LABEL = 'Still my problem';

export function ConfirmProblem() {
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
  if (!loaded) return <SurfaceLoading subject="your answer" reference="Your invitation link" />;

  return (
    <FlowPage pageId="confirm-problem" param={token}>
      <ConfirmScreen token={token} initial={loaded.problem ?? ''} />
    </FlowPage>
  );
}

function ConfirmScreen({ token, initial }: { token: string; initial: string }) {
  const { leave } = useFlowNav();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // Read once, during the first render: `FlowPage` resets the module value in
  // its own layout effect, and a later re-render would read the reset.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  const [value, setValue] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const autosave = useAutosave<VettingPatch>(
    useCallback((patch: VettingPatch) => saveVetting(token, patch), [token]),
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
  // `[data-paynow]`, so every one of that function's earlier branches is false.
  useLayoutEffect(() => stageRelayIn(root.current, direction.current ?? 1, RELAY), []);

  // `pcToggle`. Keyed on the previous value rather than on a "skip the first
  // invocation" flag: React re-invokes an effect immediately after tearing it
  // down on mount under StrictMode, and a flag that has already been flipped
  // lets the second pass through — which would run the toggle before anybody
  // had touched anything and `clearProps` away the entrance that had just
  // staged the page. `ConfirmAnswer` records finding that the hard way.
  const wasEditing = useRef(editing);
  useLayoutEffect(() => {
    if (wasEditing.current === editing) return;
    wasEditing.current = editing;
    const stop = stageToggleHead(root.current, head.current, editing);
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
    return stop;
  }, [editing]);

  function update(next: string) {
    setValue(next);
    autosave.queue({ problem: next });
  }

  /**
   * `toggleProbEdit`. Its `pcToggle` saves the answer whenever it LEAVES the
   * editor (`if(!on){ ... this.setAns(...) }`); the autosave has already queued
   * every keystroke, so what that means here is flushing what is queued.
   */
  function toggleEdit() {
    setEditing((on) => {
      if (on) void autosave.flush();
      return !on;
    });
  }

  /**
   * `stillMine`. Its editing branch — "Save just closes the editor" — is
   * unreachable, because the button carrying it is not rendered while editing.
   */
  async function stillMine() {
    if (busy) return;
    setBusy(true);
    try {
      // Land what is typed before moving. The rest of the questions build on
      // this answer, and Positioning's own submit gate refuses while it is
      // empty.
      await autosave.flush();
    } finally {
      setBusy(false);
    }
    // `afterSection({vStep: st.vStep+1})` — `vStep` 1, which `isProbConfirm`
    // still matches: the same composition asking about the solution. Built
    // 2026-08-20; before it, this went straight on to Positioning.
    leave(founderFlowPath('confirm-solution', token), 1);
  }

  const status = describeSaveState(autosave.state);
  const loud = autosave.state.status === 'failed' || autosave.state.status === 'retrying';

  return (
    <div className="ff-pc" ref={root}>
      {/* The reference's own control, bottom-left. Its label names where it
          goes only to a screen reader: the visible word is its own `Back`, and
          §33.11.4's objectless-CTA rule is answered by the accessible name
          rather than by overriding the reference's copy. */}
      <button
        type="button"
        className="ff-pc__back"
        aria-label="Back to Confirm your email"
        onClick={() => leave(founderFlowPath('code', token), -1)}
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

      <div className="ff-pc__top">
        {/* Not a link. A draft address is not a site, and the way out of a
            Founder's own half-finished form should not be the brand. */}
        <img className="ff-pc__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        <HelpDrawer
          pageId="confirm-problem"
          param={token}
          trigger={
            <button type="button" className="ff-pc__help">
              Help
            </button>
          }
        />
      </div>

      <div className="ff-pc__stage" data-page-stage="1" ref={stage}>
        <div className="ff-pc__col">
          <h1 className="ff-pc__head" data-stage-anim="head" ref={head}>
            {HEAD}
          </h1>

          <div className="ff-pc__panel" data-stage-anim="panel">
            <textarea
              className="ff-pc__field"
              ref={field}
              // A 470px box with no label is unusable with a screen reader, and
              // an `aria-label` renders nothing. The reference gives it none.
              aria-label="The problem you described"
              readOnly={!editing}
              value={value}
              onChange={(event) => update(event.target.value)}
              style={{ height: editing ? FIELD_H.edit : FIELD_H.read }}
            />
          </div>

          {/* `sc-if value="{{ pcView }}"`: removed rather than hidden while the
              editor is open, which is what the panel grows into. */}
          {editing ? null : (
            <button
              type="button"
              className="ff-pc__cta"
              data-stage-anim="cta"
              onClick={() => void stillMine()}
              disabled={busy}
            >
              {CTA_LABEL}
            </button>
          )}

          <button
            type="button"
            className="ff-pc__edit"
            data-stage-anim="edit"
            onClick={toggleEdit}
          >
            {editing ? null : (
              /* The reference's own pencil, at its own weights and its own
                 53px box — which is a stage measurement, so it scales with
                 everything else on the stage. */
              <svg
                viewBox="0 0 24 24"
                width="53"
                height="53"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            )}
            {editing ? 'Confirm' : 'edit'}
          </button>

          {/* Absolutely positioned under the column, so it can never move the
              composition. Announced in every state and drawn in one. */}
          <p
            className={loud ? 'ff-pc__save is-loud' : 'ff-pc__save sr-only'}
            role="status"
            aria-live="polite"
            data-state={autosave.state.status}
          >
            {status}
          </p>
        </div>
      </div>
    </div>
  );
}
