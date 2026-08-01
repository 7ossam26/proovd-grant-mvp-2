/**
 * The embedded interview booking — Spec §12, tech-stack §12.
 *
 * §12: "The Founder can book a human Proovd interview without leaving the
 * product." So it is an embed, and the Founder never sees a hand-off to another
 * site.
 *
 * ── An iframe, not an injected script ──────────────────────────────────────
 * Cal.com ships an embed script that runs in the host page. This page also
 * holds the Founder's session and their unreleased product information, and a
 * third-party script in it can read both. An iframe gets the same booking
 * experience with the vendor confined to its own origin, which is the right
 * trade for a surface that carries someone else's confidential material.
 *
 * `SupportChat` does inject a script, and the difference is deliberate: it runs
 * on public marketing pages that hold no session and no Founder content.
 *
 * ── The reference is what binds the booking ────────────────────────────────
 * `reference` is minted by the server for this campaign and this Founder, and
 * travels as prefilled metadata. The webhook recomputes it — see
 * `backend/src/interviews/reference.ts` — so it cannot be forged, and the
 * booker's email is checked against the campaign's Founder independently.
 * Nothing here is trusted; this only carries it.
 *
 * ── Nothing renders when there is nothing to offer ─────────────────────────
 * §6 names the interview providers, availability, interviewers, and reminder
 * lead time as settings and fixes a value for none of them, and Cal.com is
 * Track A4. The server folds both facts into `embed.available`; when it is
 * false this renders nothing and the step's own panel says which is missing.
 * An empty frame would be §1.4's failure with a border on it.
 */

import { useMemo } from 'react';

export interface InterviewEmbedProps {
  eventTypeLink: string;
  reference: string;
  /** Prefills the booking form so the Founder is not retyping what we know. */
  founderName?: string | null;
  founderEmail?: string | null;
}

/** The vendor's origin. Fixed, so nothing user-supplied decides what is framed. */
const EMBED_ORIGIN = 'https://cal.com';

export function InterviewEmbed({
  eventTypeLink,
  reference,
  founderName,
  founderEmail,
}: InterviewEmbedProps) {
  const src = useMemo(() => {
    // The link is a Cal.com path such as `proovd/founder-interview`. Encoded
    // segment by segment: it comes from configuration rather than from a user,
    // and encoding it anyway costs nothing and removes the question.
    const path = eventTypeLink
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/');

    const url = new URL(`${EMBED_ORIGIN}/${path}`);
    url.searchParams.set('embed', 'true');
    url.searchParams.set('metadata[proovdReference]', reference);
    if (founderName) url.searchParams.set('name', founderName);
    if (founderEmail) url.searchParams.set('email', founderEmail);
    return url.toString();
  }, [eventTypeLink, reference, founderName, founderEmail]);

  return (
    <div className="interview-embed">
      <iframe
        // Named, because a screen reader announcing "iframe" tells nobody what
        // is in it (§33.11).
        title="Book your Proovd interview"
        src={src}
        className="interview-embed__frame"
        // Scripts and forms are what a booking needs. Same-origin is
        // deliberately absent: the vendor does not need access to this page's
        // storage or cookies to take a booking, and withholding it is the whole
        // reason this is an iframe rather than a script.
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="strict-origin"
        loading="lazy"
      />
      <p className="fine">
        Booking opens in the panel above. Once it is confirmed we will email you the joining link,
        and the interview will show as complete here.
      </p>
    </div>
  );
}
