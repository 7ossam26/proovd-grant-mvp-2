/**
 * More about your brand… — Founder Flow v2, the reference's `[data-brand]`.
 *
 * BUILT FROM SCRATCH 2026-08-20 against the supplied reference
 * (`Proovd Founder Flow v2.dc.html`, `[data-brand]` / `kindWide`) and its
 * screenshot, and inserted between the branding screen and the interview.
 *
 * ── It is the SECOND HALF of one answer, not a ninth one ───────────────────
 * The reference is explicit about this and it decides everything below:
 *
 *     isBrandLogo(c){ return this.isBrand(c)&&this.state.brandStage!=='colors'; }
 *     isBrandColor(c){ return this.isBrand(c)&&this.state.brandStage==='colors'; }
 *     logoNext:()=>this.step({brandStage:'colors'}),
 *     brandNext:()=>this.afterSection({vStep:5}),
 *
 * One vetting step (`vStep` 4) rendered as two pages. Only the second calls
 * `afterSection`, which is why the logo screen's Next goes here even from Last
 * look and why this screen's Next is the one that ends the answer. So this page
 * is in `FOUNDER_FLOW_PAGES` and deliberately NOT in `FOUNDER_ANSWER_SEQUENCE`:
 * it collects no §12 answer of its own, and putting it there would make §12
 * read nine answers where there are eight and hang a second US$2 on one item.
 *
 * ── One record, and it is the one the branding screen already writes ───────
 * The reference holds `brand.colors` as an array of hex strings. There is no
 * such column here and this screen does not add one: `campaign_build` has no
 * colour array, §12 asks for "saved direction containing at least colors and
 * typography/style guidance", and the branding screen has written that
 * direction into `brandColors` — free text — since Session D, with its own hex
 * field appending `#XXXXXX — ` lines to it.
 *
 * So the three slots are a READING of that one text, through `swatchesIn`,
 * which is imported from the branding screen rather than copied. Adding a
 * colour appends a line in the shape that screen already writes, and the two
 * halves of one answer therefore cannot disagree about which colours are saved.
 * Removing one takes its whole line, note and all — the note is about that
 * colour, so a colour removed with its sentence left behind is a sentence about
 * nothing.
 *
 * ── One correction to the reference, and it is an off-by-one ───────────────
 *     onCommitColor:()=>{ if(st.brand.colors.length>=4)return; …
 *     brandSlots:[0,1,2].map(…)
 *
 * The guard admits four and the grid renders three, so a fourth Add stores a
 * colour that no slot shows. That is a dead press on the screen's own primary
 * control, which is the one failure it cannot be allowed to have (§1.4). The
 * cap here is the number of slots the reference draws — three — and a press at
 * three says so rather than doing nothing. Not one pixel moves for it: the
 * button keeps its treatment and the sentence lands in the note slot the
 * composition already leaves above the CTA.
 *
 * ── The plane and the bar are operable from a keyboard ─────────────────────
 * `FOUNDER_FLOW_ABSENCES` refused this plane for having no keyboard path; it
 * ships by explicit product direction and the refusal is deleted rather than
 * left standing. What that entry was protecting is not lost. The reference's
 * OWN keyboard path is the hex field — `onHexInput` runs `applyHex`, which sets
 * all three of H, S and V from a typed code — and arrow keys are added on both
 * surfaces on top of it. Neither costs the composition anything: no box moves,
 * no treatment changes, and the reference's pointer drag is reproduced exactly.
 *
 * ── The layout model is the reference's, not an approximation of it ────────
 * Authored once on the fixed 2496x1542 stage and scaled by `fitStages()`:
 *
 *     let s = Math.min(innerWidth/2496, innerHeight/1542) * (pageScale || .78);
 *
 * No branch of that function names this screen, so it takes `pageScale` alone.
 * Every child carries the reference's own pixel value on that stage: a 370px
 * plane, 52px above a 34px hue bar, 90px above a three-column grid at a 60px
 * gap, a 100px gutter to a 5px-framed card, 130px above a 165px CTA.
 *
 * ── The column's width is the VISUALS headline, and that is deliberate ─────
 * `width: fit-content` over a column whose widest child is a hidden span:
 *
 *     <span aria-hidden="true" style="height:0;overflow:hidden;font-size:112px;
 *       …visibility:hidden;">We want to see your product...</span>
 *
 * 1491px at Satoshi's metrics. This screen's own 136px headline is narrower, so
 * without that span the panel and the CTA would be a different width here than
 * on the two screens either side of it. It is the same borrow the socials
 * screen makes (`.ff-soc__measure`), and it is why nothing is hardcoded: the
 * number is a property of the face.
 *
 * ── The discount is the SETTING, never the reference's `$2` ────────────────
 * `FEE_PER=2` is hardcoded there; §6 makes it `listing_fee_item_discount_cents`
 * and Phase 06's rule is that a hardcoded number is a bug even when it is
 * right. There is no fee arithmetic in this file beyond rendering cents.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { founderFlowIndex, founderFlowPath } from '@proovd/shared';
import { SurfaceLoading } from '../../features/public/states.js';
import { StatePanel, NO_ACTION } from '../../components/index.js';
import { pressDown, pressUp, stageRelayIn } from '../../components/anim.js';
import { describeSaveState } from '../../lib/autosave.js';
import type { WorkspaceState } from '../founder/api.js';
import { swatchesIn } from './BrandingStep.js';
import { FlowPage, HelpDrawer, flowDirection, useFlowNav } from './FlowPage.js';
import { useSetupWorkspace, type SetupWorkspace } from './useSetup.js';

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
  // and rounds there, so this is the same number to the digit.
  return s.toFixed(4);
}

/**
 * The reference's relay order for this screen, out of `verifyIntro`'s fixed
 * list `pill, head, field, boxes, note, fee, sub, hint, panel, art, art2, cta,
 * edit`. Passed to `stageRelayIn` rather than read from the DOM, because the
 * 0.085s stagger follows THAT order and not document order.
 */
const RELAY = ['pill', 'head', 'panel', 'cta'] as const;

/** The reference's `st.dH/dS/dV` at rest. `hex(150,.66,.82)` is `#47D18C`. */
const START_H = 150;
const START_S = 0.66;
const START_V = 0.82;

/** `brandSlots:[0,1,2]` — the grid the reference draws. See the header. */
const SLOTS = 3;

/**
 * The reference's `hex(h,s,v)`, character for character.
 *
 *     const f=n=>{const kk=(n+h/60)%6,c=v-v*s*Math.max(Math.min(kk,4-kk,1),0);
 *       return Math.round(c*255).toString(16).padStart(2,'0');};
 *     return ('#'+f(5)+f(3)+f(1)).toUpperCase();
 */
function hsvHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const kk = (n + h / 60) % 6;
    const c = v - v * s * Math.max(Math.min(kk, 4 - kk, 1), 0);
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return ('#' + f(5) + f(3) + f(1)).toUpperCase();
}

/**
 * The reference's `applyHex(v)`, character for character. Returns the three
 * values rather than setting state, because here they are React state.
 *
 * A code that is not six hex digits returns null and NOTHING moves — the
 * reference's own early return, and the reason a half-typed code does not drag
 * the handle across the plane on every keystroke.
 */
function hexToHsv(value: string): { h: number; s: number; v: number } | null {
  const s = (value || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let hh = 0;
  if (d) {
    if (mx === r) hh = 60 * (((g - b) / d) % 6);
    else if (mx === g) hh = 60 * ((b - r) / d + 2);
    else hh = 60 * ((r - g) / d + 4);
  }
  if (hh < 0) hh += 360;
  return { h: hh, s: mx ? d / mx : 0, v: mx };
}

/**
 * The reference's `optional: $2 discount`, with the number read from the §6
 * setting the server calculated with. Whole dollars stay whole — `$2`, the
 * reference's own shape — and with no calculation to read it says
 * `optional: discount` rather than inventing a number this browser made up.
 */
function discountLabel(cents: string | undefined): string {
  if (!cents) return 'optional: discount';
  const value = Number(cents);
  if (!Number.isFinite(value) || value <= 0) return 'optional: discount';
  const dollars = value / 100;
  const shown = value % 100 === 0 ? String(dollars) : dollars.toFixed(2);
  return `optional: $${shown} discount`;
}

/** Said where the reference's silent no-op is. See the header. */
const SLOTS_FULL =
  'You have three colours saved. Remove one and this adds the next.';

export function ColorStep() {
  const { campaignId = '' } = useParams();
  const setup = useSetupWorkspace(campaignId);

  if (setup.failure) {
    return (
      <FlowPage pageId="color" param={campaignId}>
        <div className="ff-col__failure">
          <StatePanel
            state="We could not open your campaign"
            whatHappened={setup.failure}
            next="Reload the page. Nothing you have saved is affected — this is only about reading it back."
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

  if (!setup.state) {
    return <SurfaceLoading subject="your brand colours" reference="Your campaign" />;
  }

  return (
    <FlowPage pageId="color" param={campaignId}>
      <ColorScreen campaignId={campaignId} setup={{ ...setup, state: setup.state }} />
    </FlowPage>
  );
}

/** Split from the loader so `useFlowNav` — which only exists under `FlowPage` — is available. */
function ColorScreen({
  campaignId,
  setup,
}: {
  campaignId: string;
  setup: SetupWorkspace & { state: WorkspaceState };
}) {
  const { state, autosave } = setup;
  const { leave, leaveToPage } = useFlowNav();
  const [params] = useSearchParams();
  const fromReview = params.get('from') === 'review';

  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  // Read once, during the first render: `FlowPage` resets the module value in
  // its own layout effect, and a later re-render would read the reset.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  /* The saved colours text. §9's rule and `useSetupWorkspace`'s whole design:
     the typed value never comes back from the server, so this is the only copy
     of it and a save that raced an edit cannot reinstate a removed line. */
  const [colors, setColors] = useState(state.brand.colors ?? '');

  /* The reference's `dH/dS/dV`. It starts them at the same three numbers every
     time and never seeds them from `brand.colors` — the picker is where a NEW
     colour is chosen, and starting on one already saved would read as having
     selected it again. */
  const [h, setH] = useState(START_H);
  const [s, setS] = useState(START_S);
  const [v, setV] = useState(START_V);

  /* `st.hexDraft` — what is in the field while it is being typed, so a
     half-finished code is not overwritten by the picker's own rendering of the
     three values. Cleared the moment either surface is touched, exactly as
     `onSVDown` / `onHueDown` do. */
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [said, setSaid] = useState('');

  const locked = state.listingPaid;
  const draft = hsvHex(h, s, v);
  const shownHex = hexDraft ?? draft;
  const saved = swatchesIn(colors).slice(0, SLOTS);

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
  // no `[data-anim="grow"]`, no cupids, and it is neither `[data-lastlook]` nor
  // `[data-match]`, so every earlier branch of that function is false.
  useLayoutEffect(() => stageRelayIn(root.current, direction.current ?? 1, RELAY), []);

  const write = useCallback(
    (next: string) => {
      setColors(next);
      autosave.queue({ brandColors: next });
    },
    [autosave],
  );

  /**
   * The reference's `drag(e,kind)`, tween for tween of its own arithmetic:
   *
   *     const s=Math.min(1,Math.max(0,(ev.clientX-r.left)/r.width));
   *     const v=1-Math.min(1,Math.max(0,(ev.clientY-r.top)/r.height));
   *     … this.setState({dH:Math.min(360,Math.max(0,
   *         (ev.clientX-r.left)/r.width*360))});
   *
   * Pointer capture and native listeners on the element itself, because that is
   * what makes a drag that leaves the box keep tracking — React's own
   * `onPointerMove` would stop at the boundary.
   */
  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, kind: 'sv' | 'hue') => {
      if (locked) return;
      const el = event.currentTarget;
      setHexDraft(null);

      const apply = (ev: PointerEvent | React.PointerEvent) => {
        const r = el.getBoundingClientRect();
        if (kind === 'sv') {
          setS(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)));
          setV(1 - Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
        } else {
          setH(Math.min(360, Math.max(0, ((ev.clientX - r.left) / r.width) * 360)));
        }
      };

      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        /* Safari refuses a capture on a pointer that has already ended. The
           reference swallows it the same way; the drag still tracks. */
      }
      const move = (ev: PointerEvent) => apply(ev);
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      apply(event);
    },
    [locked],
  );

  /**
   * Arrow keys, which the reference has on neither surface.
   *
   * Added rather than reproduced, for the reason the focus rings below are:
   * a control a keyboard user cannot operate is not the same control (§28.5),
   * and it costs the composition nothing — no box moves and no treatment
   * changes. The step sizes are one percent of the axis and one degree of hue,
   * ten with Shift, which is the range-input convention a browser already
   * teaches. The reference's own keyboard path — typing a code — is untouched
   * and is still the fastest way to an exact colour.
   */
  function planeKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    if (locked) return;
    const big = event.shiftKey ? 0.1 : 0.01;
    let ds = 0;
    let dv = 0;
    if (event.key === 'ArrowLeft') ds = -big;
    else if (event.key === 'ArrowRight') ds = big;
    else if (event.key === 'ArrowUp') dv = big;
    else if (event.key === 'ArrowDown') dv = -big;
    else return;
    event.preventDefault();
    setHexDraft(null);
    if (ds) setS((current) => Math.min(1, Math.max(0, current + ds)));
    if (dv) setV((current) => Math.min(1, Math.max(0, current + dv)));
  }

  function hueKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    if (locked) return;
    const step = event.shiftKey ? 10 : 1;
    let dh = 0;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') dh = -step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') dh = step;
    else if (event.key === 'Home') dh = -h;
    else if (event.key === 'End') dh = 360 - h;
    else return;
    event.preventDefault();
    setHexDraft(null);
    setH((current) => Math.min(360, Math.max(0, current + dh)));
  }

  /**
   * `onCommitColor`. The reference appends to its `colors` array; here the
   * record is the branding answer's own text, so it appends the line that
   * screen already writes — `#XXXXXX — `, with the em dash left open for what
   * the colour is for, which is the half §12 actually reads.
   */
  function commit() {
    if (locked) return;
    if (saved.length >= SLOTS) {
      setSaid(SLOTS_FULL);
      return;
    }
    if (saved.includes(draft.toLowerCase())) {
      setSaid(`${draft} is already one of your colours.`);
      return;
    }
    const line = `${draft} — `;
    write(colors.trim() ? `${colors.trimEnd()}\n${line}` : line);
    setSaid(`${draft} added. Say what it is for on your brand page.`);
  }

  /** A filled swatch's own control. See the header for why the line goes whole. */
  function removeColor(hex: string) {
    if (locked) return;
    const kept = colors
      .split('\n')
      .filter((line) => !line.toLowerCase().includes(hex.toLowerCase()));
    write(kept.join('\n').trimEnd());
    setSaid(`${hex.toUpperCase()} removed.`);
  }

  /** `brandNext:()=>this.afterSection({vStep:5})` — the interview, or Last look. */
  function next() {
    void autosave
      .flush()
      .finally(() =>
        fromReview ? leaveToPage('last-look', 1) : leaveToPage('interview', 1),
      );
  }

  /** `back()`: `if(this.isBrandColor()){ this.step({brandStage:'logo'},'back'); }` */
  function back() {
    void autosave
      .flush()
      .finally(() =>
        leave(
          fromReview
            ? `${founderFlowPath('branding', campaignId)}?from=review`
            : founderFlowPath('branding', campaignId),
          -1,
        ),
      );
  }

  const readingCount = founderFlowIndex('color') + 1;

  return (
    <div className="ff-col" ref={root}>
      {/* The reference's own `[data-back]`, bottom-left. Drawn on every arrival
          here, unlike the visuals screen's: the page it returns to is the
          branding screen, one step back in the same stage-3 sequence and
          addressed by the same campaign, so there is nothing unreachable about
          it and no ring to close. */}
      <button
        type="button"
        className="ff-col__back"
        aria-label={fromReview ? 'Back to your brand — the logo and the direction' : 'Back to your brand'}
        onClick={back}
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

      <div className="ff-col__top">
        {/* Not a link. A campaign's own half-finished form is not a site, and
            the way out of one should not be the brand. */}
        <img className="ff-col__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        <HelpDrawer
          pageId="color"
          param={campaignId}
          trigger={
            <button type="button" className="ff-col__help">
              Help
            </button>
          }
        />
      </div>

      {/* The reference's mail bell, bottom-right, opening the same drawer HELP
          does. Its number is the reading the drawer actually holds rather than
          the reference's `mailCount` — there is no inbox in this product, and
          an unread count over a message system that does not exist is §1.4's
          failure with a number on it. It does not shake (`FlowPage`). */}
      <HelpDrawer
        pageId="color"
        param={campaignId}
        trigger={
          <button
            type="button"
            className="ff-col__mailbtn"
            aria-label={`Help and reading — ${readingCount} pages`}
          >
            <span className="ff-col__mail" aria-hidden="true">
              <img src="/assets/mail.webp" alt="" />
              <span className="ff-col__mailcount">{readingCount}</span>
            </span>
          </button>
        }
      />

      <div className="ff-col__stage" data-page-stage="1" ref={stage}>
        <div className="ff-col__col">
          {/* The reference's own hidden measure. See the header: it is what
              makes this column the same width as the two screens either side. */}
          <span className="ff-col__measure" aria-hidden="true">
            We want to see your product...
          </span>

          <span className="ff-col__pill" data-stage-anim="pill">
            {discountLabel(state.fee?.itemDiscountCents)}
          </span>

          <h1 className="ff-col__head" data-stage-anim="head">
            More about your brand...
          </h1>

          <div className="ff-col__panel" data-stage-anim="panel">
            <div className="ff-col__left">
              {/* Saturation across, brightness up. The two overlay gradients
                  are the reference's own — white to transparent, then black
                  from the bottom — over a fully saturated hue. */}
              <div
                className="ff-col__plane"
                style={{ background: hsvHex(h, 1, 1) }}
                tabIndex={locked ? -1 : 0}
                role="group"
                aria-label="Pick a shade. Left and right change how strong the colour is, up and down how light it is. Hold Shift for bigger steps."
                aria-describedby="ff-col-picked"
                onPointerDown={(event) => startDrag(event, 'sv')}
                onKeyDown={planeKeys}
              >
                <span className="ff-col__planewhite" aria-hidden="true" />
                <span className="ff-col__planeblack" aria-hidden="true" />
                <span
                  className="ff-col__planehandle"
                  aria-hidden="true"
                  style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }}
                />
              </div>

              <div
                className="ff-col__hue"
                tabIndex={locked ? -1 : 0}
                role="slider"
                aria-label="Colour"
                aria-valuemin={0}
                aria-valuemax={360}
                aria-valuenow={Math.round(h)}
                aria-valuetext={`${Math.round(h)} degrees — ${draft}`}
                onPointerDown={(event) => startDrag(event, 'hue')}
                onKeyDown={hueKeys}
              >
                <span
                  className="ff-col__huehandle"
                  aria-hidden="true"
                  style={{ left: `${(h / 360) * 100}%` }}
                />
              </div>

              {/* Three slots. A filled one is its own remove control — the X
                  appears on hover, and on a touch device it is always there
                  (`@media (hover:none)`), which is the reference's own rule. */}
              <ul className="ff-col__slots">
                {Array.from({ length: SLOTS }, (_, index) => {
                  const hex = saved[index];
                  if (!hex) {
                    return (
                      <li key={`empty-${index}`}>
                        <span className="ff-col__slotempty" aria-hidden="true" />
                      </li>
                    );
                  }
                  const shown = hex.toUpperCase();
                  return (
                    <li key={hex}>
                      <button
                        type="button"
                        className="ff-col__swatch"
                        style={{ background: hex }}
                        title="Remove colour"
                        aria-label={`Remove ${shown}`}
                        disabled={locked}
                        onPointerDown={(event) => pressDown(event.currentTarget)}
                        onPointerUp={(event) => pressUp(event.currentTarget)}
                        onPointerCancel={(event) => pressUp(event.currentTarget)}
                        onPointerLeave={(event) => pressUp(event.currentTarget)}
                        onClick={() => removeColor(hex)}
                      >
                        <span className="ff-col__x" aria-hidden="true">
                          <svg
                            viewBox="0 0 24 24"
                            width="30"
                            height="30"
                            fill="none"
                            stroke="#013F17"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                          >
                            <path d="M6 6l12 12M18 6 6 18" />
                          </svg>
                        </span>
                      </button>
                      <span className="ff-col__slothex">{shown}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="ff-col__card">
              <div className="ff-col__cardtop">
                <span
                  className="ff-col__preview"
                  aria-hidden="true"
                  style={{ background: draft }}
                />
                <span className="ff-col__selected">Selected</span>
                <span className="ff-col__hexwrap">
                  <span className="ff-col__hexrow">
                    {/* The reference's own field, `maxlength="7"` and all.
                        `onHexInput` sets the draft AND applies it, so a
                        complete code moves both handles as it is typed and an
                        incomplete one leaves them where they are. */}
                    <input
                      className="ff-col__hexinput"
                      value={shownHex}
                      maxLength={7}
                      spellCheck={false}
                      autoComplete="off"
                      aria-label="Colour code"
                      disabled={locked}
                      onChange={(event) => {
                        const value = event.target.value;
                        setHexDraft(value);
                        const parsed = hexToHsv(value);
                        if (parsed) {
                          setH(parsed.h);
                          setS(parsed.s);
                          setV(parsed.v);
                        }
                      }}
                      onBlur={() => setHexDraft(null)}
                      onKeyDown={(event) => {
                        /* Enter presses Add, which is this field's own action.
                           The reference binds Enter GLOBALLY (`enterAdvance`)
                           and excludes only a TEXTAREA, so pressing it here
                           leaves the page and somebody who typed a code and
                           expected to add it is on the next screen instead.
                           Every rebuilt screen in this flow binds Enter to the
                           field's own control and nothing binds it to
                           navigation. */
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          setHexDraft(null);
                          commit();
                        }
                      }}
                    />
                    <svg
                      className="ff-col__pencil"
                      viewBox="0 0 24 24"
                      width="34"
                      height="34"
                      fill="none"
                      stroke="#013F17"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </span>
                  <span className="ff-col__hexrule" aria-hidden="true" />
                </span>
              </div>

              <button
                type="button"
                className="ff-col__add"
                aria-describedby="ff-col-note"
                disabled={locked}
                onClick={commit}
              >
                Add
              </button>
            </div>
          </div>

          {/* The reference's own word, and it is `next` in §33.11.4's
              `OBJECTLESS_CTA_LABELS` — the same knowing exception the visuals,
              socials and confirm screens already carry, where the reference's
              copy is the specification. Naming the destination to a screen
              reader costs the composition nothing, so the accessible name does
              and it contains the visible word (WCAG 2.5.3). */}
          <button
            type="button"
            className="ff-col__cta"
            data-stage-anim="cta"
            aria-label={fromReview ? 'Next — back to Last look' : 'Next — your interview'}
            onClick={next}
          >
            Next
          </button>

          {/* ONE absolutely positioned block inside the 130px gap the
              composition already leaves above the CTA, so neither line can move
              a reference box — and, because they stack in flow rather than at
              two fixed offsets, the second cannot print on top of the first
              when the first wraps. The browser pass caught exactly that.

              The note is what the picker is FOR: §12 reads the writing, not the
              code. It is kept to one line at this column width for the same
              reason — two lines plus a save status is taller than the gap. */}
          <div className="ff-col__gap">
            {locked ? (
              <p className="ff-col__note" id="ff-col-note">
                Your listing fee is paid, so your brand direction stays as it was checked.
              </p>
            ) : null}
            <p className="ff-col__status" data-state={autosave.state.status}>
              {describeSaveState(autosave.state)}
            </p>
          </div>
          <p className="ff-col__live sr-only" id="ff-col-picked" role="status" aria-live="polite">
            {said || `Selected ${shownHex}`}
          </p>
        </div>
      </div>
    </div>
  );
}
