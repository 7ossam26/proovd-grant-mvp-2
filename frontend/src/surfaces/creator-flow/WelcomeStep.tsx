/**
 * Screen 0 — the invitation — Creator Flow v2, Session B, 2026-08-19.
 *
 * The address the §8 invitation email points at, and the first thing a Creator
 * ever sees of Proovd. It is a name, a sentence, and one control.
 *
 * ── The splash is deviation 1's narrowest part ──────────────────────────────
 * A brand animation before a person may act is, at any length, a thing that
 * holds them. §30 defers general product tours and DNA §6.1 caps every duration
 * at 0.90s, so three mechanisms keep it inside what was authorised: it is
 * capped by `playSplash`, the Skip control is a real button rendered from the
 * first frame rather than something the animation reveals, and it plays once
 * per token in memory (`draft.ts`) so navigating back does not replay it.
 * `reduced()` short-circuits it before it starts — the caller never mounts it,
 * which is the jump-cut rather than a second animated path.
 *
 * ── Two sentences the reference draws that are not here ─────────────────────
 * *"…pay you every time they bite"* is re-authored: §22.1 pays a share of the
 * CAPTURED, validly attributed, pre-tax subtotal after §17's post is verified,
 * not per visit. And the passive *"By continuing you're agreeing to Proovd's
 * Terms"* is refused outright — §28.4 records acceptance as separate unchecked
 * controls at the claim, and no `policy_consents` row exists for anything done
 * on this page. Both are in `CREATOR_FLOW_ABSENCES` with the rule named.
 *
 * ── The name is a record, not a greeting the page invents ───────────────────
 * `readInvitationLanding().recipientName` is what §8's Admin recorded. A
 * missing one renders the headline without it rather than "Hi there".
 */

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  CREATOR_INVITE_NO_OBLIGATION,
  CREATOR_INVITE_PROMISE,
} from '@proovd/shared';
import { Button } from '../../components/index.js';
import { playSplash } from '../../components/anim.js';
import { reduced } from '../../components/anim.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { CreatorFlowHelp, CreatorFlowPage, useCreatorFlowNav } from './CreatorFlowPage.js';
import { markSplashSeen, shouldPlaySplash } from './draft.js';
import { useInvitation } from './useInvitation.js';

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
  const sceneRef = useRef<HTMLDivElement>(null);
  // Decided once, before the first paint, so the overlay is either in the tree
  // from the start or never in it at all. Deciding it in the effect would flash
  // a full-screen overlay onto a page that had already rendered.
  const [splash, setSplash] = useState(() => !reduced() && shouldPlaySplash(token));
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!splash) {
      markSplashSeen(token);
      return;
    }
    const handle = playSplash(sceneRef.current, () => {
      markSplashSeen(token);
      setSplash(false);
    });
    stopRef.current = handle.stop;
    if (!handle.ran) {
      // The runtime is absent, failed, or motion is off. There is one way the
      // splash ends, so it ends.
      markSplashSeen(token);
      setSplash(false);
    }
    return () => {
      stopRef.current = null;
      handle.stop();
    };
  }, [splash, token]);

  return (
    <div className="crf-welcome">
      {splash ? (
        <div className="crf-splash" ref={sceneRef}>
          <div className="crf-splash__sticker" data-splash="sticker" aria-hidden="true" />
          <div className="crf-splash__flash" data-splash="flash" aria-hidden="true" />
          {/* Present from the first frame, and a real control rather than
              something the animation reveals (§28.5). */}
          <Button
            tier="tertiary"
            small
            className="crf-splash__skip"
            onClick={() => {
              stopRef.current?.();
              markSplashSeen(token);
              setSplash(false);
            }}
          >
            Skip
          </Button>
        </div>
      ) : null}

      <div className="crf-welcome__top">
        <span className="wordmark crf__mark">Proovd</span>
        <CreatorFlowHelp pageId="welcome" param={token} />
      </div>

      <div className="crf-welcome__lockup">
        <h1 className="crf-welcome__head" data-anim="head">
          {name ? `${name}, you` : 'You'} should never go hunting for the next thing to promote.
        </h1>
        <p className="crf-welcome__copy" data-anim="sub">
          {CREATOR_INVITE_PROMISE}
        </p>
        <p className="crf-welcome__note" data-anim="sub">
          {CREATOR_INVITE_NO_OBLIGATION}
        </p>
        <div className="crf-welcome__cta" data-anim="cta">
          <Button tier="primary" onClick={() => leaveToPage('password', 1)}>
            Set your password
          </Button>
        </div>
      </div>
    </div>
  );
}
