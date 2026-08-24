/**
 * Screen 1 — the invited Founder's landing page. Spec §7, §33.1.1.
 *
 * Rebuilt 2026-08-20 to the supplied reference (`Proovd Founder Flow v2.dc.html`,
 * `[data-claim]` / `claimWide`). The presentation layer is the reference's own;
 * the read, the address, the one failure surface and the one control are
 * unchanged.
 *
 * ── The layout model is the reference's, not an approximation of it ─────────
 * The reference does NOT lay this screen out responsively. It authors it once,
 * on a fixed 2496x1542 stage, and scales that stage to the viewport:
 *
 *     claimFit(){ const s = Math.min(innerWidth / 1440, innerHeight / 1420);
 *                 el.style.transform = 'translate(-50%,-50%) scale(' + s + ')'; }
 *
 * — a function of its own, separate from the `fitStages()` every later screen
 * uses. Inside that stage sits a 1295px column, centred, at `scale(0.92)`.
 *
 * An earlier pass reproduced the RATIOS of that column against a fluid
 * container instead. That is correct at exactly one viewport height and wrong
 * at every other one, because the reference's scale is driven by
 * `innerHeight / 1420` on any ordinary desktop window — so the same page at
 * 1280x800 renders its column at 671px there and rendered it at 824px here.
 * The stage is reproduced literally now, and every child carries the
 * reference's own pixel value.
 *
 * `isClaimPhone()` returns `false` — "one composition everywhere: the phone
 * posture stays off" — so the phone markup in the reference is dead code and
 * this composition is what every viewport gets, exactly as there.
 *
 * ── Six elements, and that is the whole screen ──────────────────────────────
 * A meta row (the setup time, and HELP), a full-width envelope, the headline,
 * one line of copy, one control, one legal line. The reference's empty band is
 * now the transparent reveal frame for the Founder's invitation visual.
 *
 * ── It still asks for nothing ───────────────────────────────────────────────
 * No form, no account, no payment field. One control, and it is a door rather
 * than a commitment: nothing is created by walking through it, and it can be
 * closed at any point with everything saved.
 *
 * ── RECORDED DEVIATION (2026-08-20): the passive legal line ────────────────
 * The reference's own line — "By continuing you're agreeing to Proovd's Terms
 * of Service and Privacy Policy." — ships verbatim, by explicit product
 * direction, overriding this file's earlier refusal of it.
 *
 * It is recorded the way the 2026-08-10 Admin-MFA removal and the
 * `campaign_followers` record are, because an undocumented reversal reads as
 * somebody inventing a rule: it was refused because §10 records acceptance at
 * the account claim as three separate controls (§28.4) and no consent row
 * exists for anything a person does on this page. That is still how the product
 * BEHAVES — the sentence is a claim on a page, not a mechanism — so what
 * changed is the copy and nothing else. `completeClaim` is untouched, no
 * consent row is written here, and there is no route that could write one.
 *
 * Not a licence for its neighbours: the six-digit code screen and the Creator's
 * welcome both still assert the same sentence is absent, by test.
 *
 * ── `~3 mins` is the reference's own string, and is now literal ────────────
 * CHANGED 2026-08-20, by explicit product direction, and this replaces the
 * opposite rule that stood here before.
 *
 * The slot used to render §7's `expected_setup_time` — an Admin-composed field
 * on the invitation record — so that a blank record rendered nothing rather
 * than inventing a duration (§1.4). What that produced in practice is the
 * seeded copy: "About 20 to 30 minutes to tell us about the product, and a
 * short interview if we ask for one. Building the campaign page comes later
 * and takes as long as you want to spend on it." — a paragraph in a slot the
 * reference sizes for four characters, which then squeezed HELP out of its own
 * width in the `space-between` row.
 *
 * The reference hardcodes `~3 mins`, and the copy instruction was to take its
 * time estimate verbatim. So it is a constant. `expected_setup_time` is still
 * collected, still stored, and still rendered where an Admin reads it — it is
 * this screen that no longer shows it.
 *
 * ── One failure surface ─────────────────────────────────────────────────────
 * An unusable link renders `/link-unavailable` — the same page for invalid,
 * expired, revoked, claimed, superseded, anonymised, rate-limited, and
 * never-issued. The server answers all eight identically (§5.5); branching here
 * would undo that.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { founderFlowPath } from '@proovd/shared';
import { Measure, Section, StatePanel } from '../../components/index.js';
import { inviteIntro, motionLive } from '../../components/anim.js';
import {
  fetchDraftLanding,
  type DraftLanding as DraftLandingData,
} from '../../features/admin/api.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { FlowPage, HelpDrawer, useFlowNav } from './FlowPage.js';

type State =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; draft: DraftLandingData };

/**
 * The reference's own fit divisors. They are deliberately NOT the stage's own
 * 2496x1542 — `claimFit` divides by 1440 and 1420, which is what makes the
 * claim screen read a notch larger than every later page's `fitStages()`.
 */
const FIT_W = 1440;
const FIT_H = 1420;

function claimScale(): number {
  return Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H);
}

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

  // No `meta` prop: the reference puts the setup time on the stage's own first
  // row beside HELP, not in page chrome, so `FlowPage`'s top bar is not rendered
  // on this page at all (`.ff[data-flow-page='invite'] .ff__top { display:none }`).
  return (
    <FlowPage pageId="invite" param={token}>
      <InviteScreen token={token} draft={state.draft} />
    </FlowPage>
  );
}

/**
 * The stage, and the one place its scale and its motion are owned.
 *
 * `relayIn` still runs on this page from `FlowPage` and still finds nothing to
 * do: every marker here is `data-invite`, not `data-anim`. That is the whole
 * mechanism — there is no flag to set and no branch in `FlowPage` to keep in
 * step.
 */
function InviteScreen({ token, draft }: { token: string; draft: DraftLandingData }) {
  const { leave } = useFlowNav();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
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

  // `claimFit`, verbatim. First, so the first paint is already at the right
  // scale — and on resize, because the reference refits there too.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      el.style.transform = `translate(-50%, -50%) scale(${claimScale()})`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useLayoutEffect(() => {
    return inviteIntro(root.current, splash ? splashRef.current : null, () =>
      setSplash(false),
    );
    // The splash decision is made once at mount and never re-runs the intro:
    // re-entering this effect when it lifts would stage the page a second time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="ff-invite" ref={root}>
      {splash ? (
        /* The reference's own splash: the page ground, a brand square, and a
           dark square inside it at 52%. Decorative, so it is hidden from the
           accessibility tree and never takes focus. */
        <div className="ff-invite__splash" ref={splashRef} aria-hidden="true">
          <span className="ff-invite__splash-outer" data-invite-splash="outer">
            <span className="ff-invite__splash-inner" data-invite-splash="inner" />
          </span>
        </div>
      ) : null}

      <div className="ff-invite__stage" data-claim-stage="1" ref={stage}>
        <div className="ff-invite__col">
          <div className="ff-invite__meta" data-invite="meta">
            {/* The reference's own string. See the note at the top of this
                file: this used to render the invitation record's own
                `expected_setup_time`, and that field is a paragraph. */}
            <span className="ff-invite__time">~3 mins</span>
            <HelpDrawer
              pageId="invite"
              param={token}
              trigger={
                <button type="button" className="ff-invite__help">
                  Help
                </button>
              }
            />
          </div>

          {/* The full-width envelope sits in a transparent wrapper retained for
              the opening height animation. `aria-hidden` because the envelope
              says nothing the headline below does not say better, and `alt=""`
              keeps it out of the reading order either way.

              `fetchPriority` is not premature: this is the first screen of the
              flow, so there is no preceding screen to preload from the way
              `MatchStep` does, and the envelope opens about 0.9s in. */}
          <div className="ff-invite__band" data-invite="band" aria-hidden="true">
            <img
              className="ff-invite__band-art"
              src="/assets/email-invite.webp"
              alt=""
              width={1354}
              height={471}
              decoding="async"
              fetchPriority="high"
            />
          </div>

          {/* §33.11.2: the page's own title, and it is text. The reference sets
              it with a 28px mint text-stroke behind the glyphs — a treatment on
              the words rather than a replacement for them, so a screen reader
              reads the same greeting a sighted reader sees. */}
          <h1 className="ff-invite__head" data-invite="head">
            {draft.recipientName}, we loved talking to you about {draft.productName}!
          </h1>

          <p className="ff-invite__lede" data-invite="lede">
            {/* Three ASCII periods, which is what the reference has — not an
                ellipsis character. */}
            ...we filled in most of your invite already so you don&rsquo;t have to, just
            give it a quick check.
          </p>

          <button
            type="button"
            className="ff-invite__cta"
            data-invite="cta"
            onClick={() => leave(founderFlowPath('problem', token))}
          >
            Check info
          </button>

          {/* The reference's own sentence, verbatim — including the straight
              apostrophe in `you&#39;re` against the curly one in `Proovd&rsquo;s`,
              and the full stop inside the second link where it underlines. See
              the recorded deviation at the top of this file. */}
          <p className="ff-invite__legal" data-invite="legal">
            By continuing you&#39;re agreeing to Proovd&rsquo;s{' '}
            <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy.</a>
          </p>
        </div>
      </div>
    </div>
  );
}
