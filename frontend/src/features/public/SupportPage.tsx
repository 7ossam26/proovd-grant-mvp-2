/**
 * `/support` — Spec §27.1, §27.8, §26.7. Founder Dashboard Session B (B5).
 *
 * ── This route did not exist, and everything pointed at it ──────────────────
 * `support` was declared INSIDE the `admin` route group, so the only address it
 * ever had was `/admin/support`. Meanwhile `/support` is the `getHelp` target
 * in every Founder Flow step, in the global `ErrorBoundary`, in §20's Act
 * ranks, and in the 404 body `founder-home.ts` returns. §27.1's sixth question
 * — "how do I get help without losing context" — was answered product-wide
 * with a link to nothing.
 *
 * ── Public, and that is forced rather than chosen ───────────────────────────
 * The Founder Flow's stage-1 and stage-2 pages are behind a DRAFT TOKEN, not a
 * session (§10's claim is what creates the account), and `ErrorBoundary` wraps
 * the whole tree including routes nobody is signed in for. A `/support` behind
 * `RequireRole` would send exactly the people whose page just broke to a sign-in
 * form. So it renders inside `PublicLayout` like the rest of the site.
 *
 * ── What it does NOT do, and why ────────────────────────────────────────────
 * There is no form. §26.7's case machinery — the `PVD-…` reference, the owner,
 * §27.8's business-day deadline stored beside its calendar version — is reached
 * today by an Admin (`/admin/support`) and by a Backer holding a magic link
 * (`POST /api/link/:token/support`). There is no Founder or Creator intake
 * route on the server. Rendering an intake form over an endpoint that does not
 * exist would be the §1.4 failure this page was written to fix, one layer down;
 * building the endpoint is §26.7's work and not a chrome session's.
 *
 * What ships is the commitment that IS published: §27.8's exact contact block,
 * already rendered verbatim in the site footer and compared against the
 * constant by `public-site.test.tsx`. The promise a person reads here is the
 * same promise the case machinery is measured against.
 */

import { Link as RouterLink } from 'react-router';
import { Measure, Mode, Section } from '../../components/index.js';
import { SERVICE_SLA_BLOCK, SUPPORT_EMAIL } from './site.js';

/**
 * §27.8's published response promise, as one sentence for prose. The footer
 * renders `SERVICE_SLA_BLOCK` line for line; this page renders the block too,
 * so the two cannot drift.
 */
const RESPONSE_LINE = SERVICE_SLA_BLOCK[2];

export function SupportPage() {
  return (
    <>
      <Section breathe>
        <Measure>
          <p className="kicker">Support</p>
          <h1>Tell us what happened and a person will read it.</h1>
          <p className="lede">
            Proovd is small and deliberately manual. There is no bot on this
            page and no ticket number to guess — you email a person, and a
            person answers.
          </p>
        </Measure>
      </Section>

      <Section>
        <Measure>
          <h2>How to reach us</h2>
          <p>
            Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. {RESPONSE_LINE}
          </p>
          <p>
            {/*
              §27.1's sixth question is about not losing context. We cannot
              prefill what a person was doing from a static page, so we ask for
              the two things that let support find the record without making
              somebody describe it: the address and the reference.
            */}
            It helps to include the web address you were on and any reference
            shown on the screen — a campaign, a pre-order, or a case reference
            beginning <code>PVD-</code>. That is what lets us open your record
            instead of asking you to describe it.
          </p>
        </Measure>
      </Section>

      <Mode kind="light">
        <Section>
          <Measure>
            <h2>What we can help with</h2>
            <p>
              Anything on Proovd: your campaign, a payment, a pre-order, a
              Creator partnership, your account, or a page that will not load.
              If a charge is involved, say so first — money questions are
              handled by Proovd rather than routed to anybody else.
            </p>
            <h2>If you are a Backer</h2>
            <p>
              Use the link in your pre-order email. It opens your own pre-order
              page, which has a support form that arrives with your order
              already attached — you will not have to explain which one it is.
            </p>
          </Measure>
        </Section>
      </Mode>

      <Section>
        <Measure>
          <h2>Our contact details</h2>
          {/*
            §27.8, exact text. The same constant the footer renders, so the
            promise on this page and the promise in the footer are literally the
            same string.
          */}
          <ul className="doc-list">
            {SERVICE_SLA_BLOCK.slice(1).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>
            <RouterLink to="/">Go to the Proovd homepage</RouterLink>
          </p>
        </Measure>
      </Section>
    </>
  );
}
