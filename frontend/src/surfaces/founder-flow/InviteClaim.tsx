/**
 * Screen 1 — the invited Founder's landing page. Spec §7, §33.1.1.
 *
 * §7: it "names the Founder/product and explains what will happen before an
 * account or payment is required." This is the Phase 06b landing surface
 * re-presented as the first page of the Founder Flow v2 sequence — the same
 * read, the same address (the invitation email points here), the same one
 * failure surface.
 *
 * ── It still asks for nothing ───────────────────────────────────────────────
 * No form, no account, no payment field. One control, and it is a door rather
 * than a commitment: nothing is created by walking through it, and it can be
 * closed at any point with everything saved.
 *
 * ── Two things the reference draws here are refused ─────────────────────────
 * `We can get [product] in front of [N] new people` — a promise of results §7
 * forbids, over a number no record holds. And the passive legal line: the old
 * surface said "by continuing you're agreeing to Proovd's Terms of Service and
 * Privacy Policy", which is not true and must not be. §10 records acceptance at
 * the account claim, as three separate controls (§28.4), and no consent row
 * exists for anything a person did on this page. So the documents are linked
 * as reading, and `FLOW_NOTHING_COMMITTED` states what opening the form does
 * and does not do.
 *
 * ── `~3 mins` is a record, not an estimate ──────────────────────────────────
 * The reference puts a time beside HELP. §7's own invitation record carries
 * `expected_setup_time`, filled in by the Admin who composed the message, so
 * that is what renders — and when it is blank, nothing renders. An invented
 * "about 3 minutes" is a promise about the Founder's evening that nobody made
 * (§1.4).
 *
 * ── One failure surface ─────────────────────────────────────────────────────
 * An unusable link renders `/link-unavailable` — the same page for invalid,
 * expired, revoked, claimed, superseded, anonymised, rate-limited, and
 * never-issued. The server answers all eight identically (§5.5); branching here
 * would undo that.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { FLOW_NOTHING_COMMITTED, founderFlowPath } from '@proovd/shared';
import { Button, Measure, Section, StatePanel } from '../../components/index.js';
import {
  fetchDraftLanding,
  type DraftLanding as DraftLandingData,
} from '../../features/admin/api.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { approxSince } from '../../lib/relativeTime.js';
import { FlowPage, useFlowNav } from './FlowPage.js';

type State =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; draft: DraftLandingData };

/**
 * The brand moment, for as long as the runtime allows and no longer.
 *
 * `proovd-motion.js` owns `[data-splash]` already: once per session, skipped on
 * return, skipped entirely under `prefers-reduced-motion`, a 4-second backstop
 * that always exits, and `html.no-motion [data-splash] { display: none }`. The
 * reference's own is 2.6 seconds of a covered page, which is 2.6 seconds in
 * which §27.1's six questions have no answer — so the one thing added here is
 * that any interaction ends it immediately.
 */
function Splash() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dismiss = () => {
      el.hidden = true;
    };
    window.addEventListener('pointerdown', dismiss, { once: true });
    window.addEventListener('keydown', dismiss, { once: true });
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, []);

  return (
    <div className="ff-splash" data-splash ref={ref} aria-hidden="true">
      <span className="sticker sk-1 ff-splash__mark" />
      <span className="ff-splash__word" data-splash-word>
        Proovd
      </span>
    </div>
  );
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
  // Rendered against the reader's clock, and only when the record holds the
  // instant — no record, no claim (§1.4).
  const since = approxSince(draft.lastContactAt);

  return (
    <FlowPage pageId="invite" token={token} meta={draft.expectedSetupTime ?? undefined}>
      <Splash />
      <div className="ff-invite">
        <div className="ff-invite__band" data-anim="pill" aria-hidden="true" />

        <div className="ff-invite__body">
          {since ? (
            <p className="ff-invite__since" data-anim="note">
              {since}
            </p>
          ) : null}

          {/* §33.11.2: the page's own title. The stroked word is a treatment on
              the product name, not a replacement for it — the text is text, so
              a screen reader reads the greeting a sighted reader sees. */}
          <h1 className="ff-invite__head" data-anim="head">
            {draft.recipientName}, our meeting got us excited about{' '}
            <span className="ff-stroke">{draft.productName}</span>
          </h1>

          <p className="ff-invite__lede" data-anim="sub">
            We filled in most of your invite already so you don&rsquo;t have to &mdash; give it
            a quick check, change anything that is off, and it is yours.
          </p>

          <Claim token={token} email={draft.recipientEmail} />

          <p className="ff-invite__legal" data-anim="note">
            {FLOW_NOTHING_COMMITTED} You will be asked to accept our{' '}
            <a href="/terms">Terms of Service</a>, the{' '}
            <a href="/founder-aup">Founder Acceptable Use Policy</a> and our{' '}
            <a href="/privacy">Privacy Policy</a> when you create your account, which happens
            later and as its own step.
          </p>
        </div>
      </div>
    </FlowPage>
  );
}

/**
 * The one control, and the address the invitation reached.
 *
 * Split out because it is the only part of this page that navigates, and
 * `useFlowNav` is only available under `FlowPage`.
 */
function Claim({ token, email }: { token: string; email: string | null }) {
  const { leave } = useFlowNav();
  return (
    <div className="ff-invite__act" data-anim="cta">
      {email ? <p className="ff-invite__email">{email}</p> : null}
      <Button
        className="ff-invite__cta"
        onClick={() => leave(founderFlowPath('problem', token))}
      >
        Claim invite
      </Button>
    </div>
  );
}
