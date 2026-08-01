/**
 * The campaign reference the interview embed carries — Spec §12.
 *
 * ── The problem it solves ───────────────────────────────────────────────────
 * The Founder books inside Cal.com's embed, and Cal.com tells us about it by
 * webhook. The webhook has to say *which campaign* the booking is for, and the
 * only channel for that is the embed's prefilled metadata — which the Founder,
 * sitting in front of the embed, can edit. A campaign id taken at face value
 * would let one Founder attach a booking, its US$2 discount, and the high-effort
 * input that governs Phase 12's compensation ceiling to another Founder's
 * campaign.
 *
 * The webhook signature does not help here. It proves the payload came from
 * Cal.com; it says nothing about who typed what into it.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 * `<campaignId>.<hmac>` where the tag is an HMAC-SHA256 over the campaign id,
 * truncated to 128 bits. Verification recomputes and compares in constant time,
 * so a forged reference does not verify and a modified campaign id does not
 * carry its tag with it. Nothing is stored to issue one and nothing is looked
 * up to check one, so there is no row to race and no window to expire.
 *
 * ── It is not an authentication credential ─────────────────────────────────
 * It binds a booking to a campaign. On its own it grants no access to anything:
 * `interviews/webhook.ts` also requires the attendee's email to match that
 * campaign's Founder before a booking binds, so two independent facts have to
 * agree. That is why this can travel through a vendor's metadata at all, and
 * why it does not go through the §28.1 token service — which exists for values
 * that *do* grant access, and which deliberately stores nothing in the clear.
 *
 * ── Domain separation ───────────────────────────────────────────────────────
 * The key is `BETTER_AUTH_SECRET`, which the environment already requires and
 * already floors at 32 characters. The label below is what makes reusing it
 * safe: a tag computed under this label cannot be replayed as any other HMAC
 * this system computes, now or later.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const LABEL = 'proovd:interview-reference:v1';

/** 128 bits of tag. Long enough that guessing is not a strategy. */
const TAG_HEX_LENGTH = 32;

export function interviewReference(campaignId: string, secret: string): string {
  const tag = createHmac('sha256', secret)
    .update(`${LABEL}:${campaignId}`)
    .digest('hex')
    .slice(0, TAG_HEX_LENGTH);
  return `${campaignId}.${tag}`;
}

/**
 * The campaign this reference is for, or null.
 *
 * Returns null for every failure — malformed, wrong tag, wrong length — because
 * the caller has nothing useful to do with the difference and the ingest's
 * answer to all of them is the same: record that a delivery arrived that could
 * not be bound, and route it to Admin.
 */
export function verifyInterviewReference(
  reference: string | null | undefined,
  secret: string,
): string | null {
  if (!reference) return null;

  const separator = reference.lastIndexOf('.');
  if (separator <= 0) return null;

  const campaignId = reference.slice(0, separator);
  const provided = reference.slice(separator + 1);
  if (provided.length !== TAG_HEX_LENGTH) return null;

  const expected = interviewReference(campaignId, secret).slice(-TAG_HEX_LENGTH);
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return null;

  return timingSafeEqual(a, b) ? campaignId : null;
}
