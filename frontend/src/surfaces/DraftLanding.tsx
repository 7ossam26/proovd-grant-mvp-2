/**
 * The invited-draft landing state — Spec §7, §33.1.1.
 *
 * §7: it "names the Founder/product and explains what will happen before an
 * account or payment is required."
 *
 * ── One composition, from the reference design ──────────────────────────────
 * Left: how long since we last spoke (the §7 discovery record, rendered as
 * "~3 mins" against the reader's clock), the greeting that names the Founder
 * and the product, and the one sentence of what has been done for them. Right:
 * the invite card — the address the invitation reached and the single action.
 * Every value is the record's own: the name is the resolved recipient the
 * email greeted, the product is the prospect's, the address is the one the
 * link arrived at. Nothing here is hardcoded and nothing is invented (§1.4);
 * a fact that is missing renders as nothing rather than as an example.
 *
 * ── It still asks for nothing ───────────────────────────────────────────────
 * No form, no account, no payment field. One control — `Claim invite`, the
 * door onto the vetting questions — and it is a door, not a commitment:
 * nothing is created by walking through it, and it can be closed at any point
 * with everything saved. A Founder who lands here and closes the tab has
 * still lost nothing.
 *
 * ── One failure surface ─────────────────────────────────────────────────────
 * An unusable link renders `/link-unavailable` — the same page for invalid,
 * expired, revoked, claimed, superseded, anonymised, rate-limited, and
 * never-issued. The server already answers all eight identically (§5.5); this
 * must not undo that by rendering a different message for a different status.
 *
 * ── The dashboard stays behind ──────────────────────────────────────────────
 * This is a Founder surface, so it reads like the public site: one question
 * per moment, generous space, no density. §26 licenses the dashboard in Admin
 * and nowhere else.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Button, Measure, Section, StatePanel } from '../components/index.js';
import { fetchDraftLanding, type DraftLanding as DraftLandingData } from '../features/admin/api.js';
import { LinkUnavailable } from './LinkUnavailable.js';
import { supportMailto } from '../features/public/states.js';
import { approxSince } from '../lib/relativeTime.js';

type State =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; draft: DraftLandingData };

/** The line-drawn envelope that sits astride the invite card's top border. */
function EnvelopeMark() {
  return (
    <svg
      width="72"
      height="58"
      viewBox="0 0 72 58"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="6" y="12" width="60" height="40" />
      <path d="M6 14 L36 36 L66 14" />
      <path d="M24 12 L36 2 L48 12" />
      <path d="M30 18 L42 13 L34 24 L46 20" />
    </svg>
  );
}

export function DraftLanding() {
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
            state="Opening your draft"
            whatHappened="We're checking your link. Nothing has been submitted and nothing has been charged."
            next="Your draft appears here as soon as it opens."
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
  // Rendered against the reader's clock, and rendered only when the record
  // holds the instant — no record, no claim (§1.4).
  const since = approxSince(draft.lastContactAt);

  return (
    <main className="invite-landing">
      <div className="invite-landing__grid">
        <header className="invite-landing__intro">
          {since ? <p className="invite-landing__time">{since}</p> : null}
          <h1 className="invite-landing__headline">
            {draft.recipientName}, our meeting got us excited about {draft.productName}&hellip;
          </h1>
          <p className="invite-landing__lede">
            &hellip;we filled in most of your invite already so you don&rsquo;t have to, just
            give it a quick check.
          </p>
        </header>

        <div className="invite-landing__aside">
          <div className="invite-card">
            <span className="invite-card__icon">
              <EnvelopeMark />
            </span>
            {draft.recipientEmail ? (
              <p className="invite-card__email">{draft.recipientEmail}</p>
            ) : null}
            <Button
              href={`/draft/${encodeURIComponent(token)}/vetting`}
              className="invite-card__cta"
            >
              Claim invite
            </Button>
          </div>
          <p className="invite-card__terms">
            By continuing you&rsquo;re agreeing to Proovd&rsquo;s{' '}
            <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.
          </p>
        </div>
      </div>

      <Button
        tier="secondary"
        small
        href={supportMailto(`Question about my Proovd invitation (${draft.reference})`)}
        className="invite-landing__help"
      >
        Help
      </Button>
    </main>
  );
}
