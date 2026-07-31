/**
 * The invited-draft landing state — Spec §7, §33.1.1.
 *
 * §7: it "names the Founder/product and explains what will happen before an
 * account or payment is required."
 *
 * ── It does not ask for anything ────────────────────────────────────────────
 * No form, no account, no payment field, no "get started" that quietly begins
 * something. Phase 07 owns the vetting flow; this surface exists to tell a
 * person what they have been invited to and what happens next, so that when
 * they are asked for something they already know why. A Founder who lands here
 * and closes the tab has lost nothing.
 *
 * ── One failure surface ─────────────────────────────────────────────────────
 * An unusable link renders `/link-unavailable` — the same page for invalid,
 * expired, revoked, claimed, superseded, anonymised, rate-limited, and
 * never-issued. The server already answers all eight identically (§5.5); this
 * must not undo that by rendering a different message for a different status.
 *
 * ── The dashboard stays behind ──────────────────────────────────────────────
 * This is a Founder surface, so it reads like the public site: one question per
 * moment, generous space, no density. §26 licenses the dashboard in Admin and
 * nowhere else.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import {
  Button,
  Card,
  Measure,
  Mode,
  Section,
  StatePanel,
} from '../components/index.js';
import { fetchDraftLanding, type DraftLanding as DraftLandingData } from '../features/admin/api.js';
import { LinkUnavailable } from './LinkUnavailable.js';
import { supportMailto } from '../features/public/states.js';

type State =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; draft: DraftLandingData };

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

  return (
    <>
      <Mode kind="light">
        <Section breathe>
          <Measure>
            <p className="draft-eyebrow">An invitation from Proovd</p>
            <h1>
              {draft.recipientName}, we&rsquo;d like {draft.productName} to run a campaign
              on Proovd.
            </h1>
            {draft.whatWeUnderstood ? (
              <p className="draft-lede">{draft.whatWeUnderstood}</p>
            ) : null}
            {draft.senderName ? (
              <p className="draft-sender">Sent by {draft.senderName} at Proovd.</p>
            ) : null}
          </Measure>
        </Section>
      </Mode>

      <Section>
        <Measure>
          <h2>What happens from here</h2>
          <ol className="steps">
            {draft.processSummary.map((step, index) => (
              <li key={index}>
                <h3>{step}</h3>
              </li>
            ))}
          </ol>
        </Measure>
      </Section>

      <Section>
        <Measure>
          <h2>What this is not</h2>
          {/* The same fixed paragraph the email carried, from the same constant,
              so the two cannot drift and a Founder reads one story (§27.1). */}
          <Card>
            <p>{draft.noGuarantee}</p>
          </Card>
        </Measure>
      </Section>

      <Section>
        <Measure>
          <StatePanel
            state="Nothing is needed from you yet"
            whatHappened={
              <>
                You&rsquo;ve opened your draft. <strong>No account has been created, no
                card has been asked for, and nothing has been charged.</strong>
                {draft.expectedSetupTime ? ` ${draft.expectedSetupTime}` : ''}
              </>
            }
            next="When you're ready to go ahead, we'll ask you about the product, the problem it solves, and who else is solving it. You can stop at any point."
            owner="You"
            nextUpdate="Whenever you come back to this link"
            action="No action needed"
            reference={draft.reference}
            getHelp={{
              href: supportMailto(`Question about my Proovd invitation (${draft.reference})`),
            }}
          />
          <p className="draft-note">
            This link is personal to you. If it stops working, reply to the invitation
            email and we&rsquo;ll send a new one — we can&rsquo;t recover the old one, so a
            replacement is always a fresh link.
          </p>
          <p className="draft-note">
            Proovd will never ask you for your bank details, tax details, password, or
            identity documents by email.
          </p>
          <Button tier="tertiary" href="/how-payments-work">
            Read how payments work
          </Button>
        </Measure>
      </Section>
    </>
  );
}
