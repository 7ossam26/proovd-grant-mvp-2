/**
 * Screen 1 — the invited Founder's landing page. Spec §7, §33.1.1.
 *
 * Rebuilt 2026-08-20 to the supplied reference (`Proovd Founder Flow v2.dc.html`,
 * `[data-claim]`) and its screenshot. The presentation layer is new; the read,
 * the address, the one failure surface and the one control are unchanged.
 *
 * §7: it "names the Founder/product and explains what will happen before an
 * account or payment is required."
 *
 * ── Six elements, and that is the whole screen ──────────────────────────────
 * The reference's wide claim stage is a meta row, a pale band, the headline,
 * one line of copy, one control and one legal line — in that order, as one
 * vertically centred column. The band is empty in the reference and empty here:
 * it is the space the Founder's own visual will occupy, not a placeholder to
 * fill with a caption.
 *
 * ── It still asks for nothing ───────────────────────────────────────────────
 * No form, no account, no payment field. One control, and it is a door rather
 * than a commitment: nothing is created by walking through it, and it can be
 * closed at any point with everything saved.
 *
 * ── One thing the reference draws here is refused ───────────────────────────
 * The passive legal line. The reference reads "by continuing you're agreeing to
 * Proovd's Terms of Service and Privacy Policy", which is not true and must not
 * be: §10 records acceptance at the account claim, as three separate controls
 * (§28.4), and no consent row exists for anything a person does on this page.
 * The reference's TREATMENT of that line is reproduced exactly — the same slot,
 * the same centring, the same small grey type, the same underlined links — and
 * the sentence inside it is `FLOW_NOTHING_COMMITTED`, which is what is actually
 * true. Appearance follows the screenshot; what the page claims about somebody's
 * legal position does not.
 *
 * ── `~3 mins` is a record, not an estimate ──────────────────────────────────
 * §7's own invitation record carries `expected_setup_time`, filled in by the
 * Admin who composed the message, so that is what renders in the reference's
 * meta slot — and when it is blank, nothing renders. An invented "about 3
 * minutes" is a promise about the Founder's evening that nobody made (§1.4).
 *
 * ── One failure surface ─────────────────────────────────────────────────────
 * An unusable link renders `/link-unavailable` — the same page for invalid,
 * expired, revoked, claimed, superseded, anonymised, rate-limited, and
 * never-issued. The server answers all eight identically (§5.5); branching here
 * would undo that.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { FLOW_NOTHING_COMMITTED, founderFlowPath } from '@proovd/shared';
import { Button, Measure, Section, StatePanel } from '../../components/index.js';
import { inviteIntro, motionLive } from '../../components/anim.js';
import {
  fetchDraftLanding,
  type DraftLanding as DraftLandingData,
} from '../../features/admin/api.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { FlowPage, useFlowNav } from './FlowPage.js';

type State =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; draft: DraftLandingData };

/**
 * Once per session, and the record of that is the session — not a prop.
 *
 * The reference replays its splash on every mount of the claim screen, which
 * means a Founder who walks forward and comes back watches the brand animate at
 * them a second time. `sessionStorage` is what the motion runtime already uses
 * for its own splash (§6.5, "once per session, skipped on return"), so this
 * follows it rather than inventing a second answer; the module flag is the
 * fallback for a browser that refuses storage, so a private window plays it
 * once rather than every time.
 */
let splashPlayed = false;

function claimSplash(): boolean {
  if (splashPlayed) return false;
  splashPlayed = true;
  try {
    if (sessionStorage.getItem('pvInviteSplash')) return false;
    sessionStorage.setItem('pvInviteSplash', '1');
  } catch {
    /* storage may be unavailable — the module flag still plays it once */
  }
  return true;
}

export function InviteClaim() {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchDraftLanding(token)
      .then((draft) => {
        if (!cancelled) setState({ status: 'ready', draft });
      })
      .catch(() => {
        // Every failure, one surface. Branching here would reintroduce the
        // enumeration oracle the server carefully avoids (§5.5).
        if (!cancelled) setState({ status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === 'unavailable') return <LinkUnavailable />;

  if (state.status === 'loading') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Opening your invite"
            whatHappened="We're checking your link. Nothing has been submitted and nothing has been charged."
            next="Your invite appears here as soon as it opens."
            owner="Proovd"
            nextUpdate="Within a few seconds"
            action="No action needed"
            reference="Your invitation link"
          />
        </Measure>
      </Section>
    );
  }

  const { draft } = state;

  return (
    <FlowPage pageId="invite" param={token} meta={draft.expectedSetupTime ?? undefined}>
      <InviteScreen token={token} draft={draft} />
    </FlowPage>
  );
}

/**
 * The stage, and the one place its motion is owned.
 *
 * Split from `InviteClaim` because the choreography has to run against the page
 * that is actually mounted: the reference animates the meta row, which is
 * `FlowPage`'s own child rather than this component's, so the timeline is
 * scoped to the nearest `.ff__stage` rather than to this subtree. Reaching it
 * with `closest` costs nothing and leaves `FlowPage` untouched, which is what
 * keeps the other twenty-three screens exactly as they were.
 *
 * `relayIn` still runs on this page and still finds nothing to do: every marker
 * here is `data-invite`, not `data-anim`. That is the whole mechanism — there
 * is no flag to set and no branch in `FlowPage` to keep in step.
 */
function InviteScreen({ token, draft }: { token: string; draft: DraftLandingData }) {
  const root = useRef<HTMLDivElement>(null);
  const splashRef = useRef<HTMLDivElement>(null);
  // Decided once per instance, during render, because the overlay has to be in
  // the DOM before the layout effect can animate it — a splash mounted a frame
  // late is a flash of the page it exists to cover.
  //
  // Through a ref rather than a `useState` initialiser: `claimSplash` writes
  // the session record, StrictMode invokes a component body twice on mount, and
  // the second call would read back the flag the first one had just set and
  // answer `false`. A ref survives the double render on the same fiber, so the
  // question is asked exactly once however many times this renders.
  const decided = useRef<boolean | null>(null);
  if (decided.current === null) decided.current = motionLive() && claimSplash();
  const [splash, setSplash] = useState(decided.current);

  useLayoutEffect(() => {
    const stage = root.current?.closest<HTMLElement>('.ff__stage') ?? null;
    return inviteIntro(stage, splash ? splashRef.current : null, () => setSplash(false));
    // The splash decision is made once at mount and never re-runs the intro:
    // re-entering this effect when it lifts would stage the page a second time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="ff-invite" ref={root}>
      {splash ? (
        /* The reference's own splash: the page ground, a brand square, and a
           dark square inside it at 52%. No wordmark — the brand mark on the
           front door of somebody's own half-finished form is the thing §5.12's
           "position survives" is protecting them from. Decorative, so it is
           hidden from the accessibility tree and never takes focus. */
        <div className="ff-invite__splash" ref={splashRef} aria-hidden="true">
          <span className="ff-invite__splash-outer" data-invite-splash="outer">
            <span className="ff-invite__splash-inner" data-invite-splash="inner" />
          </span>
        </div>
      ) : null}

      {/* Empty in the reference and empty here. `aria-hidden` because a band
          with nothing in it announces nothing. */}
      <div className="ff-invite__band" data-invite="band" aria-hidden="true" />

      {/* §33.11.2: the page's own title, and it is text. The reference sets the
          headline with a 28px mint text-stroke behind the glyphs, which is a
          treatment on the words rather than a replacement for them — so a
          screen reader reads the same greeting a sighted reader sees. */}
      <h1 className="ff-invite__head" data-invite="head">
        {draft.recipientName}, we loved talking to you about {draft.productName}!
      </h1>

      <p className="ff-invite__lede" data-invite="lede">
        &hellip;we filled in most of your invite already so you don&rsquo;t have to, just
        give it a quick check.
      </p>

      <Claim token={token} />

      <p className="ff-invite__legal" data-invite="legal">
        {FLOW_NOTHING_COMMITTED} You will be asked to accept our{' '}
        <a href="/terms">Terms of Service</a>, the{' '}
        <a href="/founder-aup">Founder Acceptable Use Policy</a> and our{' '}
        <a href="/privacy">Privacy Policy</a> when you create your account, which happens
        later and as its own step.
      </p>
    </div>
  );
}

/**
 * The one control.
 *
 * Split out because it is the only part of this page that navigates, and
 * `useFlowNav` is only available under `FlowPage`.
 *
 * `data-hover="colors"` rather than the primary tier's default `swap`: swap
 * carries a 1.3 scale, which is right for a sticker and wrong for a control
 * that is the full width of the measure. The reference's own hover here is a
 * background darken and nothing else, and `colors` is the runtime's name for
 * exactly that — the same `--h-*` slots, no second mechanism (§7.1).
 */
function Claim({ token }: { token: string }) {
  const { leave } = useFlowNav();
  return (
    <div className="ff-invite__act" data-invite="cta">
      <Button
        className="ff-invite__cta"
        data-hover="colors"
        onClick={() => leave(founderFlowPath('problem', token))}
      >
        Check info
      </Button>
    </div>
  );
}
