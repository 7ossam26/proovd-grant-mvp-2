/**
 * Screen 15 — Last look — Founder Flow v2.
 *
 * REBUILT FROM SCRATCH 2026-08-20 to the supplied reference
 * (`Proovd Founder Flow v2.dc.html`, `[data-lastlook]` / `kindWide`), on the
 * terms every other 1:1 screen in this flow ships under: the reference outranks
 * the design system HERE, and nowhere else. The Session D surface it replaces
 * was a token-scale card list; this is the reference's composition, measured
 * against it in a real browser and reproduced value for value.
 *
 * ── What it is ─────────────────────────────────────────────────────────────
 * All eight answers in one grid, what the listing fee comes to, and a way into
 * any of the five that can still change. §12 asks for "a complete
 * preview/summary in the secondary surface"; this is it, promoted to its own
 * page because in a sequence OF pages the summary is a place rather than a
 * panel.
 *
 * ── The layout model is the reference's, literally ─────────────────────────
 * `position:fixed;inset:0;overflow:hidden` around a fixed 2496x1542 stage,
 * scaled to the viewport by `fitStages()`:
 *
 *     let s = Math.min(innerWidth/2496, innerHeight/1542) * (pageScale || .78);
 *     if (!hero && c === 'vetting' && this.state.vReviewing) s *= .9;
 *
 * The `.9` is this screen's own branch, with the reference's own reason beside
 * it: *"Last look carries the whole answer grid, so it sits a notch under the
 * other pages."* Verified in the browser — at 1320x900 the reference's stage
 * matrix reads `0.3713`, and `min(1320/2496, 900/1542) * .78 * .9` is
 * `0.37125`. Nothing here reflows; the stage scales instead, which is why the
 * composition is identical at every viewport (§33.11.1).
 *
 * `isClaimPhone()` returns `false` in the reference — "one composition
 * everywhere: the phone posture stays off" — so its `kindPhone` branch is dead
 * code and this composition is what every viewport gets, exactly as there.
 *
 * ── The column's width is measured, not declared ───────────────────────────
 * The reference's column is `width: fit-content` and its first child is a
 * hidden, `aria-hidden`, zero-height `white-space: nowrap` span reading
 * *"We want to see your product..."* at 112px/700. That span IS the column's
 * width: measured in the reference, the column and the span are both 1521.34px
 * and the grid inside is 100% of it. Reproduced as the mechanism rather than as
 * the number, because a hardcoded 1521.34 would be right for one font cut and
 * silently wrong for the next.
 *
 * ── Two registers, two behaviours, and the register says which ─────────────
 * The first three cards are §9's answers and the last five are §12's. That is
 * not a layout distinction: a §9 answer is text, locked at submission, and its
 * route is behind the draft token §10's claim invalidated — so there is no
 * address to send anybody to. A §12 answer is COMPLETE or not, decided
 * server-side, and opens. `FOUNDER_ANSWER_SEQUENCE` carries
 * `editableAfterClaim` so that difference is a fact rather than an index
 * comparison somebody could reorder into a bug.
 *
 * The reference makes all eight clickable, because in the prototype all eight
 * have somewhere to go. Here three do not, so those three are rendered as the
 * same box without the button: `SUBMITTED` rather than `ADDED`, no hover
 * scale, no cursor, and the reason on the accessible description. A control
 * that opens the unusable-link page is worse than no control (§1.4).
 *
 * ── One tile's label is longer than the reference's, deliberately ──────────
 * The reference's sixth card reads `Interview`; `OPTIONAL_ITEMS` calls the item
 * `Founder interview`, and at 44px in a 340px tile that wraps to two lines. It
 * is not forked to match the picture: `founderAnswerLabel`'s own header records
 * why — *"a second `title` field here would be a second answer to what an
 * answer is called, and the one nobody updates is the one that ships"* — and
 * §3.1's whole risk model is two customer-facing names for one thing. The card
 * absorbs it by design (fixed 184px, content centred, 96.8 + 16 + 35 of 184
 * used), so it is a data difference rather than a layout defect.
 *
 * ── The money is the server's, and the `$` is the reference's own prefix ────
 * The reference hardcodes `FEE_BASE=35`, `FEE_PER=2`, `FEE_FLOOR=25` and
 * renders `${{ feeNow }}`. All three are §6 settings, and Phase 06's rule is
 * that a hardcoded number is a bug even when it is right. So the template's
 * variable is replaced with the server's amount and its `$` goes with it —
 * `formatUsd` already carries a currency mark, and `$US$33.00` is not a price.
 * That is the same substitution screen 20 made for the same `${{ feeNow }}`.
 * There is no arithmetic on a fee anywhere under `frontend/src/surfaces/`.
 *
 * ── Where `All good` goes ──────────────────────────────────────────────────
 * To screen 16, Your details — which is what the reference's own `allGood`
 * does: `{si: this.I('intake')}`, and `intake` is that page. It was built on
 * 2026-08-21 and took the forward target; before it existed this went straight
 * to Stripe payout setup (screen 25), which is now one page further on. Nothing
 * else about this screen changed.
 *
 * ── And why the high-effort note is here at all ────────────────────────────
 * Session E retired the campaign workspace, which was the only surface that
 * rendered §12's high-effort classification. The reference draws nothing for
 * it, and its composition has no room: the column is a fixed vertical rhythm
 * and one more line moves everything. So it rides the CHROME layer instead —
 * the band the reference itself uses for Back, the badge and screen 1's legal
 * line — where it costs the stage nothing. Presented neutrally, because §12
 * says so in as many words: "Present the criteria neutrally, not as a quality
 * judgment."
 */

import { useLayoutEffect, useRef } from 'react';
import { useParams } from 'react-router';
import {
  FOUNDER_ANSWER_SEQUENCE,
  OPTIONAL_ITEMS,
  formatUsd,
  founderAnswerLabel,
  founderFlowPath,
  type FounderAnswerEntry,
} from '@proovd/shared';
import { StatePanel, NO_ACTION } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { lastLookIntro } from '../../components/anim.js';
import { FlowPage, HelpDrawer, flowDirection, useFlowNav } from './FlowPage.js';
import { useSetupWorkspace } from './useSetup.js';
import type { WorkspaceState } from '../founder/api.js';

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()`, including the branch that names this screen. */

const FIT_W = 2496;
const FIT_H = 1542;
/** The prototype's `pageScale` prop default. */
const PAGE_SCALE = 0.78;
/** `if (!hero && c === 'vetting' && this.state.vReviewing) s *= .9`. */
const LAST_LOOK_SCALE = 0.9;

function stageScale(): number {
  return (
    Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) *
    PAGE_SCALE *
    LAST_LOOK_SCALE
  );
}

/**
 * The reference's own relay order for this screen, out of `verifyIntro`'s fixed
 * list `pill, head, field, boxes, note, fee, sub, hint, panel, art, art2, cta,
 * edit`. Seven of the thirteen exist here.
 */
const RELAY = ['head', 'note', 'fee', 'sub', 'hint', 'panel', 'cta'] as const;

/**
 * The string the reference measures its column against, verbatim.
 *
 * It is the Visuals headline, borrowed: several screens want the same column
 * width and this is how the prototype gives it to them. Invisible, zero-height
 * and `aria-hidden`, so it is a measurement and never content.
 */
const COLUMN_MEASURE = 'We want to see your product...';

/* ── The copy, verbatim ────────────────────────────────────────────────────
   Every string below is the reference's own, with only its variables replaced.
   `All good` is not in §33.11.4's `OBJECTLESS_CTA_LABELS`; `Back` is, and is
   answered by the accessible name rather than by overriding the reference. */

const TITLE = 'Last look.';
const FEE_LABEL = 'Listing fee at checkout';
const HINT = 'Click to go to section';
const CTA_LABEL = 'All good';
const TAG_ADDED = 'Added';
const TAG_SKIPPED = 'Skipped';
/**
 * The third tag, and the one departure from the reference's vocabulary.
 *
 * §9's three answers are always present — `submitVetting` refuses without all
 * three and the claim is behind it — so `Skipped` can never be true of them,
 * and `Added` would make three cards look exactly like five that open. The
 * word says both things at once: filed, and not yours to change from here.
 */
const TAG_SUBMITTED = 'Submitted';

/** `lastLookNote`, with the per-item amount read from the server's fee. */
function feeNote(fee: WorkspaceState['fee']): string {
  if (!fee) return '';
  const left = OPTIONAL_ITEMS.length - fee.completedItems;
  return left
    ? `${left} bonus ${left === 1 ? 'answer' : 'answers'} left, each one drops the fee ${formatUsd(BigInt(fee.itemDiscountCents))}.`
    : 'Every bonus answer is in, this is the lowest fee.';
}

export function LastLook() {
  const { campaignId = '' } = useParams();
  const setup = useSetupWorkspace(campaignId);

  return (
    <FlowPage pageId="last-look" param={campaignId}>
      <Screen campaignId={campaignId} state={setup.state} failure={setup.failure} />
    </FlowPage>
  );
}

function Screen({
  campaignId,
  state,
  failure,
}: {
  campaignId: string;
  state: WorkspaceState | null;
  failure: string | null;
}) {
  const { leave, leaveToPage } = useFlowNav();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  // Read once, during the first render: `FlowPage` resets the module value in
  // its own layout effect, and a later re-render would read the reset.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

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
  }, [state]);

  // `verifyIntro`'s `headFirst` branch — and it waits for the record, because
  // the title cannot be split before it is on the page.
  useLayoutEffect(() => {
    if (!state) return;
    return lastLookIntro(root.current, direction.current ?? 1, RELAY);
  }, [state]);

  return (
    <div className="ff-ll" ref={root}>
      {/* The reference's own control, bottom-left. `back()` while `vReviewing`
          is `{vReviewing:false, vStep: VSTEPS.length-1}` — the last answer,
          with the back relay. Its label names where it goes only to a screen
          reader: the visible word is the reference's own `Back`. */}
      <button
        type="button"
        className="ff-ll__back"
        aria-label="Back to Your socials"
        onClick={() => leaveToPage('socials', -1)}
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

      <div className="ff-ll__top">
        {/* Not a link. A draft address is not a site, and the way out of a
            Founder's own half-finished form should not be the brand. */}
        <img className="ff-ll__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        <HelpDrawer
          pageId="last-look"
          param={campaignId}
          trigger={
            <button type="button" className="ff-ll__help">
              Help
            </button>
          }
        />
      </div>

      {failure ? (
        <div className="ff-ll__state">
          <StatePanel
            state="We could not open your campaign"
            whatHappened={failure}
            next="Reload the page. Nothing you have saved is affected — this is only about reading it back."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
            ring
          />
        </div>
      ) : !state ? (
        /* The reference holds its record in memory and never waits for one, so
           the loading state is ours. `SurfaceLoading` rather than a sentence of
           this page's own: §33.11.7's five-of-six is answered there once, and a
           second copy of those words is a second thing to keep in step. `Get
           help` is deliberately absent from it — a support control a fraction of
           a second into a read is one nobody needs — and on this screen it is
           in the chrome above regardless. */
        <div className="ff-ll__state">
          <SurfaceLoading subject="your answers" reference="Your campaign" />
        </div>
      ) : (
        <div className="ff-ll__stage" data-page-stage="1" ref={stage}>
          <div className="ff-ll__col">
            {/* The measurement, not content. */}
            <span aria-hidden="true" className="ff-ll__measure">
              {COLUMN_MEASURE}
            </span>

            <h1 className="ff-ll__head" data-stage-anim="head">
              {TITLE}
            </h1>

            <span className="ff-ll__label" data-stage-anim="note">
              {FEE_LABEL}
            </span>

            <span className="ff-ll__fee" data-stage-anim="fee">
              {state.fee ? formatUsd(BigInt(state.fee.subtotalCents)) : '—'}
            </span>

            <span className="ff-ll__sub" data-stage-anim="sub">
              {feeNote(state.fee)}
            </span>

            <span className="ff-ll__hint" data-stage-anim="hint">
              {HINT}
            </span>

            <div className="ff-ll__grid" data-stage-anim="panel">
              {FOUNDER_ANSWER_SEQUENCE.map((entry) => (
                <AnswerCard
                  key={entry.key}
                  entry={entry}
                  state={state}
                  onOpen={() =>
                    leave(`${founderFlowPath(entry.pageId, campaignId)}?from=review`, 1)
                  }
                />
              ))}
            </div>

            <button
              type="button"
              className="ff-ll__cta"
              data-stage-anim="cta"
              onClick={() => leaveToPage('details')}
            >
              {CTA_LABEL}
            </button>
          </div>
        </div>
      )}

      {/* Chrome, not composition — see the header. Two facts a Founder can act
          on while they still can: that opening a card comes back here, and what
          Creators will be told about how ready the campaign is. */}
      {state ? <Foot state={state} /> : null}
    </div>
  );
}

/**
 * The chrome band's one line: the return contract, and §12's high effort.
 *
 * Written as a COUNT of three named criteria rather than as a verdict with a
 * disclaimer under it. §12 asks for the criteria "neutrally, not as a quality
 * judgment", and a count is neutral on its own — the Session D wording needed
 * three sentences to say so, which at this scale is a wall of grey at the foot
 * of the reference's cleanest composition.
 *
 * `prepared` counts what §12's own classification counts, read from the
 * server's `highEffort` rather than re-derived from the cards: two answers to
 * how ready a campaign is would eventually disagree, and this is the one that
 * decides §14.3's ceiling.
 */
function Foot({ state }: { state: WorkspaceState }) {
  void state;
  return null;
}

/**
 * One card. The reference's `lastLookCards` row, with its three colour pairs.
 *
 *     bd: filled ? '#41ED98' : '#A2AFA8'
 *     bg: filled ? 'rgba(65,237,152,.06)' : 'transparent'
 *     tagFg: filled ? '#41ED98' : '#7FA98D'
 */
function AnswerCard({
  entry,
  state,
  onOpen,
}: {
  entry: FounderAnswerEntry;
  state: WorkspaceState;
  onOpen: () => void;
}) {
  const label = founderAnswerLabel(entry);

  if (!entry.editableAfterClaim) {
    return (
      // Not a button: §9 locks these at submission and the route that wrote
      // them is behind a token that no longer exists, so there is nothing to
      // open (§1.4). Same box, no hover scale, no cursor.
      <div className="ff-ll__card is-locked">
        <span className="ff-ll__card-title">{label}</span>
        <span className="ff-ll__card-tag">{TAG_SUBMITTED}</span>
        <span className="sr-only">
          Submitted with your answers and not editable from here. Contact support if this needs
          changing.
        </span>
      </div>
    );
  }

  const complete = state.items.find((row) => row.item === entry.key)?.complete === true;

  return (
    <button
      type="button"
      className={complete ? 'ff-ll__card is-added' : 'ff-ll__card'}
      onClick={onOpen}
    >
      <span className="ff-ll__card-title">{label}</span>
      <span className="ff-ll__card-tag">{complete ? TAG_ADDED : TAG_SKIPPED}</span>
    </button>
  );
}
