/**
 * The reach orbit — the screen between the solution and the campaign path.
 *
 * BUILT 2026-08-20 from the supplied reference (`Proovd Founder Flow v2.dc.html`,
 * `[data-reach]` / `scReach`), from scratch, on the same instruction and the
 * same precedent as `InviteClaim` (screen 1), `ConfirmAnswer` (2 and 3) and
 * `CampaignTypeStep` (4): the presentation, the copy, the geometry and the
 * motion are the reference's own.
 *
 * The reference's own screen order is
 * `['claim','problem','solution','reach','kind', …]`, so this sits exactly
 * where it does there — `onProbNext` on the solution goes here, `reachNext`
 * goes to the campaign path, and the campaign path's `Back` returns here.
 *
 * ── This is a recorded reversal, and saying so is the point ─────────────────
 * `FOUNDER_FLOW_ABSENCES` refused this screen from the day the flow was
 * rebuilt: §7 forbids Admin promising results, and no record in this product
 * holds an audience number — the reference's own is the constant `RTARGET`.
 * That entry has now left the register, on explicit product direction, because
 * a register saying an element is absent while a surface renders it is worse
 * than no register (`EmailStep`'s own precedent, 2026-08-18). Two things
 * narrow it, and both are mechanisms rather than intentions:
 *
 *   1. **Nothing is read and nothing is stored.** There is no fetch for a
 *      reach figure, no column that could hold one, and no path from this file
 *      to `possible_creator_results`. The figure is the reference's own
 *      `RTARGET` constant and nothing about it can become a measurement.
 *
 *      A caveat sentence beneath the headline was added on 2026-08-20 and
 *      REMOVED the same day, by product direction. It is recorded here rather
 *      than forgotten: the screen now renders the reference's copy and nothing
 *      else, so the whole of what keeps the figure from reading as a
 *      measurement is the absence of any record behind it.
 *   2. **§10's relevance signal is not this screen.** The Match beat now has
 *      its own campaign route after Details. This screen does not stand in for
 *      it: it names no Creator, no category, and no participation.
 *
 * A later phase asked to make this number dynamic — to read it from a record,
 * to vary it per campaign, or to derive it from §10's count — is asking for
 * exactly the §7 promise the register entry refused, and this file is not the
 * licence for it.
 *
 * ── The product name is the real one ───────────────────────────────────────
 * The reference hardcodes `Teeb`. The sentence structure is kept exactly and
 * the value comes from `fetchDraftLanding`, which is the same read the invite
 * page has used for `productName` since Session B. A draft that has no product
 * name recorded renders the sentence without one rather than a bracket.
 *
 * ── The layout model is NOT the fixed stage ────────────────────────────────
 * Unlike screens 1–4, this page carries no `[data-page-stage]` at all: it is
 * authored fluidly in `clamp()` and the orbit is laid out in JS against the
 * viewport. That is load-bearing rather than incidental, and it is what makes
 * the exit an instant cut — `pageGo` fades
 * `document.querySelector('[data-claim-stage],[data-page-stage]')`, finds
 * nothing on this screen, and steps immediately. See `next()` below.
 *
 * ── The chrome is the reference's, and it is drawn here ────────────────────
 * Screens 1–4 hide `FlowPage`'s wordmark and HELP because `[data-problem]`,
 * `[data-kind]` and the invite draw none. This screen draws BOTH — the logo
 * top-left and an outlined HELP top-right — so `.ff__top` stays, restyled to
 * the reference's own header in `PHASE 52` rather than replaced with a second
 * one. §27.1's sixth question is answered by the same drawer every other page
 * in the flow uses.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { founderFlowPath } from '@proovd/shared';
import { Measure, Section, StatePanel } from '../../components/index.js';
import { REACH_TARGET, reachCtaIn, reachIntro } from '../../components/anim.js';
import {
  fetchDraftLanding,
  type DraftLanding,
} from '../../features/admin/api.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { FlowPage, useFlowNav } from './FlowPage.js';

/** The reference renders forty; `reachLayout` hides the ones a narrow viewport
 *  cannot hold, which is why they are all in the DOM and none is conditional. */
const PHONE_SLOTS = 40;

export function ReachStep() {
  const { token = '' } = useParams();
  const [draft, setDraft] = useState<DraftLanding | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchDraftLanding(token)
      .then((data) => {
        if (!cancelled) setDraft(data);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (unavailable) return <LinkUnavailable />;

  if (draft === null) {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Opening your invitation"
            whatHappened="We're reading your invitation. Nothing has been submitted and nothing is being charged."
            next="This page appears in a moment."
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
    <FlowPage pageId="reach" param={token}>
      <ReachScreen token={token} productName={draft.productName} />
    </FlowPage>
  );
}

function ReachScreen({
  token,
  productName,
}: {
  token: string;
  productName: string;
}) {
  const navigate = useNavigate();
  const { leave } = useFlowNav();
  const root = useRef<HTMLDivElement>(null);
  const cta = useRef<HTMLButtonElement>(null);

  /** The reference's `reachCta`: the button does not exist until the orbit
   *  has collapsed, which is why this is state rather than an opacity. */
  const [ctaShown, setCtaShown] = useState(false);

  // The whole screen: layout, ticker, count, pop, collapse, then the CTA.
  // Mount only — re-running it would restart the count under somebody.
  useLayoutEffect(() => {
    return reachIntro(root.current, () => setCtaShown(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The reference's `setState` callback: the button's own arrival, run on the
  // render that put it in the DOM.
  useLayoutEffect(() => {
    if (ctaShown) reachCtaIn(cta.current);
  }, [ctaShown]);

  /**
   * `reachNext`, and it is an INSTANT cut rather than a fade.
   *
   * `pageGo` fades `[data-claim-stage],[data-page-stage]` before it steps.
   * This screen has neither — it is fluid, not staged — so `querySelector`
   * returns null there and the reference goes straight to `go()`. Using
   * `leave()` here would introduce a 200ms fade the reference does not have,
   * on the one transition in the flow that has none, so this navigates
   * directly and the campaign path runs its own `kindIntro` on arrival.
   *
   * `leave` is still what `FlowPage` hands this screen and is deliberately
   * unused for that reason; the direction it would have set is `1`, which is
   * what a fresh navigation already leaves it at.
   */
  function next() {
    void navigate(founderFlowPath('campaign-type', token));
  }

  return (
    <div className="ff-reach" ref={root}>
      {/* `[data-reach-stage]`. `perspective` is authored at 1400px and
          overwritten per layout with `1.75 * unit`; the authored value is what
          renders for the frame before the effect runs. */}
      <div className="ff-reach__stage" data-reach-stage="1">
        {/* `[data-reach-group]`. Its transform is written once per layout —
            the camera never moves, so it is not a per-frame write. */}
        <div className="ff-reach__group" data-reach-group="1">
          {Array.from({ length: PHONE_SLOTS }, (_, i) => (
            <div className="ff-reach__phone" data-rphone="1" key={i}>
              {/* Decorative: the headline is the content. The image carries
                  no alt text in the reference either. */}
              <img src="/assets/reach-phone-front.webp" alt="" />
            </div>
          ))}
        </div>
      </div>

      {/* §33.11.2: the page's own title, and the number is inside it so a
          screen reader reads one sentence rather than a fragment and a digit.
          `min-width: 5.4ch` + tabular figures on the span is what stops the
          words either side of it shifting as the count runs. */}
      <h1 className="ff-reach__head" data-reach-head="1">
        We can get {productName} in front
        <br />
        of{' '}
        <span className="ff-reach__num" data-reach-num="1">
          {REACH_TARGET.toLocaleString('en-US')}
        </span>
        &nbsp;new people
      </h1>

      {ctaShown ? (
        <button
          type="button"
          className="ff-reach__cta"
          data-reach-cta="1"
          ref={cta}
          onClick={next}
        >
          Accept invite
        </button>
      ) : null}
    </div>
  );
}
