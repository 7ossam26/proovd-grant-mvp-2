/**
 * "Send me my link again" — Spec §5.5, §27.5, §28.1, §33.5.13 (Phase 22b).
 *
 * This was the last unsent §27 key, and it was never a missing template. Every
 * magic-link route in the product sits BEHIND a working magic link, so a Backer
 * whose link expired had no way to ask for another and nothing existed to
 * trigger a reissue. The message needed the ask first.
 *
 * ── The whole difficulty is that this route is an oracle by default ─────────
 * §5.5: "invalid, expired, revoked, claimed, and never-existed are
 * indistinguishable to the caller." A Backer has no account, so the only thing
 * to look up is an email against a campaign — and a route that answers
 * differently for a hit and a miss tells anyone who asks which addresses
 * pre-ordered which campaign. Given a leaked address list and a campaign id,
 * that is a Backer roster.
 *
 * So the answer is `MAGIC_LINK_REISSUE_ACK`, a frozen constant, returned
 * identically for:
 *   - an address with a live pre-order on that campaign
 *   - an address with no pre-order on that campaign
 *   - an address that has never existed
 *   - a campaign id that has never existed
 *   - a malformed address
 *   - a caller over the rate limit
 *
 * The rate-limit case is the one that looks wrong and is not. Phase 04's
 * `token-rejection.ts` already records the reasoning: "a limiter that announces
 * itself is the same enumeration oracle wearing a different hat" — a 429 on the
 * fifth try tells you the first four were interesting.
 *
 * ── Timing is part of the answer ────────────────────────────────────────────
 * A hit mints a token and sends an email; a miss returns immediately. That is a
 * timing oracle even when the bodies match, so the route responds FIRST and
 * does the work afterwards. The Backer's own email is where the result of this
 * request actually arrives, which is what makes returning before the work is
 * honest rather than a lie about completion.
 *
 * ── Only a live pre-order gets a link ───────────────────────────────────────
 * The page a magic link opens shows this Backer's transactions on this
 * campaign, so an identity with nothing on it is an identity with nothing to
 * see. §4.1's dedup means an identity row can exist without a reservation.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { backerIdentities } from '../db/schema/reservations.js';
import { reservations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import type { TokenService } from '../auth/token-service.js';
import type { Notifier } from '../notifications/send.js';
import { BACKER_MAGIC_LINK_REISSUE } from '../notifications/events.js';
import { renderPlainNotice } from '../notifications/templates/plain.js';
import { normalizeEmail } from './restated.js';
import { mintOrReissueMagicLink } from './magic-link.js';
import { deliveredUrlId } from '../notifications/customer-remaining.js';

/**
 * The one answer. Frozen, and deliberately carrying nothing per-request — no
 * timestamp, no request id, no retry hint. Anything that varies is a channel.
 */
export const MAGIC_LINK_REISSUE_ACK = Object.freeze({
  status: 'requested' as const,
  title: 'Check your email',
  whatHappened:
    'If that address has a pre-order on this campaign, we have sent it a fresh link.',
  next: 'The link works once and expires. If nothing arrives, check your spam folder, then contact support.',
});

/**
 * The reservation states whose Backer still has something to open.
 *
 * A canceled or killed pre-order leaves a page that says so, which is worth
 * reaching — §27.1's six questions apply hardest to a state someone did not
 * choose. What is excluded is an identity with no reservation at all.
 */
const REACHABLE_STATUSES = [
  'reserved_active',
  'reserved_canceled',
  'pending_capture',
  'capture_failed_retrying',
  'captured',
  'refunded',
  'disputed',
  'reversed',
  'capture_failed_dropped',
  'threshold_not_met_no_charge',
  'killed_no_charge',
] as const;

export interface ReissueDeps {
  db: Database;
  tokenService: TokenService;
  notifier?: Notifier | undefined;
  appBaseUrl: string;
  fromAddress: string;
  supportEmail: string;
  /** Keys the delivery id. `BETTER_AUTH_SECRET`. */
  secret: string;
}

/**
 * Mints and sends a fresh link where one is owed, and does nothing otherwise.
 *
 * Returns nothing a caller could branch on, because there is no caller that
 * should: the route has already answered. Kept exported so the suite can drive
 * it directly and assert what it did — the alternative is a test that asserts
 * on the email, which is exactly what a real caller cannot see either.
 */
export async function reissueMagicLink(
  deps: ReissueDeps,
  input: { email: string; campaignId: string },
): Promise<void> {
  if (!deps.notifier) return;

  // §4.1's own normalisation, so an address that reserved as `A.B@Gmail.com`
  // is found when it is typed back as `a.b@gmail.com`. A second rule here
  // would make the reissue miss identities the dedup key considers the same.
  const normalised = normalizeEmail(input.email);
  if (!normalised) return;

  // Both conditions in one query. A two-step "find the identity, then find its
  // reservations" would answer faster for a campaign that does not exist.
  const rows = await deps.db
    .selectDistinct({
      identityId: backerIdentities.id,
      email: backerIdentities.email,
      campaignId: backerIdentities.campaignId,
    })
    .from(backerIdentities)
    .innerJoin(reservations, eq(reservations.backerIdentityId, backerIdentities.id))
    .where(
      and(
        eq(backerIdentities.emailNormalized, normalised),
        eq(backerIdentities.campaignId, input.campaignId),
        inArray(reservations.status, [...REACHABLE_STATUSES]),
      ),
    )
    .limit(1);

  const identity = rows[0];
  if (!identity) return;

  const link = await mintOrReissueMagicLink(
    { db: deps.db, tokenService: deps.tokenService, appBaseUrl: deps.appBaseUrl },
    { campaignId: identity.campaignId, backerIdentityId: identity.identityId },
  );

  const [build] = await deps.db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, identity.campaignId))
    .limit(1);
  const title = build?.title ?? 'your campaign';

  const notice = await renderPlainNotice({
    subject: `Your link to ${title}`,
    headline: 'Here is a fresh link to your pre-order.',
    facts: [
      { label: 'Campaign', value: title },
      { label: 'What this link does', value: 'Opens your pre-orders on this campaign' },
      { label: 'How long it lasts', value: 'It works once, and the previous link stops working' },
      {
        label: 'If you did not ask for this',
        value: 'Nothing has changed and nothing has been charged. You can ignore this email.',
      },
    ],
    paragraphs: [
      // §30: this message must not imply a charge, in either direction. It is
      // the one email a Backer receives that is about access rather than money.
      'You asked for a new link to your pre-order page. Opening it changes nothing on its own — you can cancel, update your card, or ask for help from there.',
    ],
    // §27.2: at most one primary action.
    action: { label: 'Open your pre-order', url: link.url },
    reference: identity.campaignId,
    supportEmail: deps.supportEmail,
  });

  await deps.notifier.send({
    eventKey: BACKER_MAGIC_LINK_REISSUE,
    entityType: 'magic_link_request',
    /*
     * Per REQUEST, on §5.5's own reasoning and the password reset's precedent:
     * someone asking twice is someone whose first link did not arrive, and
     * keying on the identity would swallow every ask after the first in the
     * one flow where being locked out is the entire problem. §28.1 keeps the
     * raw token out of storage, so the id is an HMAC of the delivered URL —
     * meaningless outside this table and unusable to reach the page.
     */
    entityId: deliveredUrlId('magic-link-reissue', link.url, deps.secret),
    to: identity.email,
    from: deps.fromAddress,
    replyTo: deps.supportEmail,
    ...notice,
  });
}
