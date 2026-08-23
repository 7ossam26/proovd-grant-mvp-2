/**
 * Screen 0 — the invitation — rebuilt 1:1 from
 * `docs/design-refrence/Proovd_Affiliate_Founder_Rebuild_v11_FIXED_SHAREABLE.html`
 * (2026-08-20).
 *
 * The address the §8 invitation email points at, and the first thing a Creator
 * ever sees of Proovd. The reference's `obSplash` screen is the authority for
 * every value here: the structure (`.claim-intro` → `.claim-wide` →
 * `.claim-wide-stage` → `.claim-wide-shell`), the copy, the 84px headline with
 * its 28px mint text stroke, the #DEFAFC band, the 122px CTA, and the four
 * animation beats. PHASE 57 in `proovd.css` carries the declarations.
 *
 * ── The stage is scaled by measurement, not by a media query ────────────────
 * The reference authors this screen at a fixed 2496×1542 stage and then, in
 * `_fit()`, scales it to whatever viewport it lands in:
 *
 *   scale = min(innerWidth / 1440, innerHeight / 1420, 1)
 *
 * on mount, on every resize, and once more at 2100ms — the late pass is the
 * reference's own, and it is what corrects a first measurement taken before
 * the webfont settles. Reproduced exactly, including the third pass.
 *
 * ── The entry sequence ──────────────────────────────────────────────────────
 * t=0      the splash covers the viewport; the brand square scales in (.4s),
 *          its dark inner square .15s behind it (.35s)
 * t=0.68s  the splash slides up and away (.56s)
 * t=0.92s  the band grows 0 → 285px (.62s)
 * t=1.27s  the headline's words rise, one every 0.04s
 * t=1.56s  the sentence fades up
 * t=1.76s  the CTA scales in
 *
 * All of it is CSS, exactly as the reference has it, so the choreography needs
 * no runtime and cannot desynchronise. `prefers-reduced-motion` drops the
 * splash and lands every element in its end state — also the reference's rule.
 *
 * ── The name is a record, not a greeting the page invents ───────────────────
 * `readInvitationLanding().recipientName` is what §8's Admin recorded. A
 * missing one renders the headline without it rather than "Hi there".
 */

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { CreatorFlowPage, useCreatorFlowNav } from './CreatorFlowPage.js';
import { markSplashSeen, shouldPlaySplash } from './draft.js';
import { useInvitation } from './useInvitation.js';

/** The reference's own sentence, under the headline. */
const CLAIM_COPY =
  'We bring you products people actually want, and pay you every time they bite.';

/** The reference's headline, everything after the recipient's name. */
const CLAIM_HEAD_TAIL = 'You should never go hunting for the next thing to promote.';

/** `.claim-word` delays: 1.27s, then one every 0.04s. */
const WORD_DELAY_BASE = 1.27;
const WORD_DELAY_STEP = 0.04;

export function WelcomeStep() {
  const { token = '' } = useParams();
  const { state, unavailable } = useInvitation(token);

  if (unavailable) return <LinkUnavailable />;
  if (!state) {
    return <SurfaceLoading subject="your invitation" reference="Your invitation link" />;
  }

  return (
    <CreatorFlowPage pageId="welcome" param={token} bare>
      <Body token={token} name={state.landing.recipientName} />
    </CreatorFlowPage>
  );
}

function Body({ token, name }: { token: string; name: string }) {
  const { leaveToPage } = useCreatorFlowNav();
  const stageRef = useRef<HTMLDivElement>(null);

  /*
   * The splash is decided once, before the first paint, so the overlay is
   * either in the tree from the start or never in it at all — deciding it in
   * an effect would flash a full-screen overlay onto a page that had already
   * rendered.
   *
   * Once per token, in memory (`draft.ts`): the reference is a single-component
   * prototype whose screen 0 mounts once, and navigating back to this address
   * must not replay a brand beat. §30 defers general product tours, and a
   * splash that runs on every arrival is a tour with one slide.
   */
  const [splash] = useState(() => shouldPlaySplash(token));
  useEffect(() => {
    markSplashSeen(token);
  }, [token]);

  /*
   * `_fit()`, verbatim. Three passes for the reference's three reasons: now,
   * on resize, and once at 2100ms — the late one corrects a measurement taken
   * before the webfont and the scrollbar settle.
   */
  useEffect(() => {
    const fit = () => {
      const el = stageRef.current;
      if (!el) return;
      const scale = Math.min(window.innerWidth / 1440, window.innerHeight / 1420, 1);
      el.style.transform = `translate(-50%,-50%) scale(${scale})`;
    };
    fit();
    window.addEventListener('resize', fit);
    const late = window.setTimeout(fit, 2100);
    return () => {
      window.removeEventListener('resize', fit);
      window.clearTimeout(late);
    };
  }, []);

  const headline = `${name ? `${name},` : ''} ${CLAIM_HEAD_TAIL}`.trim();
  // The reference splits on whitespace and separates the spans with a margin
  // rather than a space, so `textContent` reads "Mohab,Youshould…". A
  // multi-word name simply earns a beat per word, which is the same rule.
  const words = headline.split(/\s+/);

  return (
    <div className="claim-intro">
      {splash ? (
        <div className="claim-motion-splash" aria-hidden="true">
          <div className="claim-splash-outer">
            <div className="claim-splash-inner" />
          </div>
        </div>
      ) : null}

      <div className="claim-wide">
        <div className="claim-wide-stage" ref={stageRef}>
          <div className="claim-wide-shell">
            <div className="claim-meta-space" aria-hidden="true" />
            {/* The same envelope the Founder invitation opens on, so the two
                private invitations arrive the same way. Decorative: the band is
                `aria-hidden` and the image carries an empty alt. The inset is
                expressed on the art rather than as padding on the band, because
                the band animates from `height: 0` and padding would start it
                72px tall. */}
            <div className="claim-band" aria-hidden="true">
              <img
                className="claim-band-art"
                src="/assets/email-invite.webp"
                alt=""
                width={1354}
                height={471}
                decoding="async"
                fetchPriority="high"
              />
            </div>
            {/* The label is the only thing here the reference does not have,
                and it changes no pixel and no behaviour: the mint stroke needs
                the spans, and the spans are separated by a margin rather than
                a space, so without it a screen reader reads the whole headline
                as one unbroken word. */}
            <h1 className="claim-head" aria-label={headline}>
              {words.map((word, index) => (
                <span
                  // The words are fixed for a given name, and a duplicate word
                  // in a sentence is ordinary — the position is the identity.
                  key={`${index}-${word}`}
                  className="claim-word"
                  style={{
                    animationDelay: `${(WORD_DELAY_BASE + index * WORD_DELAY_STEP).toFixed(2)}s`,
                  }}
                >
                  {word}
                </span>
              ))}
            </h1>
            <p className="claim-copy">{CLAIM_COPY}</p>
            <button
              type="button"
              className="claim-cta"
              onClick={() => leaveToPage('password', 1)}
            >
              Get started
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
