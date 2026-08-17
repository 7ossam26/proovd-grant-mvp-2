/**
 * The last four customer messages §27 named and nothing sent — Spec §27.3,
 * §27.4, §27.5, §5.5, §27.8, §28.1 (Phase 22b).
 *
 *   founder_password_reset                    §5.5's reset link. Better Auth has
 *                                             produced the URL since Phase 04
 *                                             and handed it to a function that
 *                                             threw, because Phase 04 had no
 *                                             transport
 *   founder_roster_update                     §14.5's transitions, recorded and
 *                                             unannounced
 *   affiliate_disclosure_tracking_available    §14.2 mints the link at
 *                                             acceptance; §27.4 makes its
 *                                             availability its own message
 *   backer_support_followup                   §27.8: "Even without resolution,
 *                                             send an update at the promised
 *                                             checkpoint"
 *   backer_magic_link_reissue                 §27.5's reissue, which needed a
 *                                             way to ask for one first
 *
 * ── The reset link never becomes an identifier ─────────────────────────────
 * §28.1: the raw token exists only in the delivered URL — never at rest, never
 * in a log, never in an error. The dedup entity is therefore an HMAC of the URL
 * rather than the URL or any part of it, and the resulting hex is meaningless
 * outside this table. Keying on the USER would be the tempting alternative and
 * would swallow every reset after the first, which is §7's resend failure
 * applied to the one flow where being locked out is the whole problem.
 */

import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignBuild } from '../db/schema/build.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { user } from '../db/schema/auth.js';
import type { Notifier } from './send.js';
import {
  FOUNDER_PASSWORD_RESET,
  AFFILIATE_PASSWORD_RESET,
  AFFILIATE_DISCLOSURE_TRACKING_AVAILABLE,
} from './events.js';
import { renderPlainNotice } from './templates/plain.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';

export interface CustomerNotifyDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
}

/* ── §5.5 password reset ─────────────────────────────────────────────────── */

/**
 * An opaque, stable id for one reset URL.
 *
 * §28.1 forbids the raw token at rest, and `notification_deliveries.entity_id`
 * is at rest. An HMAC over the URL is stable for retries of the same request,
 * different for every new request, and reveals nothing — you cannot reset an
 * account from a digest of a link.
 */
export function deliveredUrlId(label: string, url: string, secret: string): string {
  return createHmac('sha256', secret).update(`${label}:${url}`).digest('hex').slice(0, 32);
}

export function resetRequestId(url: string, secret: string): string {
  return deliveredUrlId('password-reset', url, secret);
}

export async function sendPasswordReset(
  deps: CustomerNotifyDeps & { authSecret: string },
  input: { email: string; name: string | null; url: string },
): Promise<void> {
  if (!deps.notifier || !deps.context) {
    // §1.4: an unconfigured transport must fail visibly rather than let someone
    // wait for an email nothing will send. This is the shape `index.ts` used
    // before a transport existed, kept for the same reason.
    throw new Error('Password-reset delivery is not configured: no notifier is available.');
  }

  /*
   * The key follows the ACCOUNT'S ROLE (Session B of the Affiliate rebuild,
   * 2026-08-17). §27's registry prefixes every key with its audience and
   * Phase 22c's history filters on that prefix — so an Affiliate's reset
   * recorded under `founder_password_reset` would be invisible on their own
   * notification history. One path, one template, the key chosen by who the
   * account belongs to; an account this query cannot find keeps the Founder
   * key, because Founder is the only role with a public sign-in surface.
   */
  const [account] = await deps.db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.email, input.email))
    .limit(1);
  const eventKey =
    account?.role === 'affiliate' ? AFFILIATE_PASSWORD_RESET : FOUNDER_PASSWORD_RESET;

  const notice = await renderPlainNotice({
    subject: 'Reset your Proovd password',
    headline: 'Set a new password',
    facts: [
      { label: 'Account', value: input.email },
      { label: 'Who owns it', value: 'You' },
      {
        label: 'If this was not you',
        value: 'Nothing has changed. You can ignore this and your password stays as it is.',
      },
    ],
    paragraphs: [
      'Use the link below to choose a new password. It works once.',
    ],
    action: { label: 'Set a new password', url: input.url },
    // §28.1: an opaque id, not the token and not anything derived from the
    // account — it exists so support can match a delivery, and nothing else.
    reference: resetRequestId(input.url, deps.authSecret),
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey,
    entityType: 'password_reset_request',
    // Per REQUEST. Keying on the account would send the first reset and swallow
    // every later one, in the one flow where the person is already locked out.
    entityId: resetRequestId(input.url, deps.authSecret),
    to: input.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}

/* ── §14.2 / §27.4 disclosure and tracking ───────────────────────────────── */

export async function notifyDisclosureAvailable(
  deps: CustomerNotifyDeps,
  input: {
    associationId: string;
    campaignId: string;
    trackingUrl: string;
    disclosureText: string;
  },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  const [row] = await deps.db
    .select({ email: affiliateSignupProfiles.email })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.associationId, input.associationId))
    .limit(1);
  if (!row?.email) return;

  const [build] = await deps.db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, input.campaignId))
    .limit(1);
  const title = build?.title ?? 'your campaign';

  const notice = await renderPlainNotice({
    subject: `Your link and disclosure for ${title}`,
    headline: 'Your tracking link and the disclosure you must use.',
    facts: [
      { label: 'Campaign', value: title },
      { label: 'Your link', value: input.trackingUrl },
      { label: 'Required disclosure', value: input.disclosureText },
      { label: 'Status', value: 'Not active yet — it starts earning at launch' },
    ],
    paragraphs: [
      // §14.2/§18: the link exists inactive, and a Creator who shares it early
      // sends traffic that earns nothing. Saying so is kinder than a ledger row.
      'Your link is created but not yet active. Clicks before it activates earn nothing, so wait for the message that says your campaign is live.',
      'The disclosure above is required on every post that carries this link. It is not optional and it is not ours to waive.',
    ],
    action: {
      label: 'Open your campaign',
      url: `${deps.context.appBaseUrl}/creator/campaigns/${input.associationId}/partnership`,
    },
    reference: input.associationId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey: AFFILIATE_DISCLOSURE_TRACKING_AVAILABLE,
    entityType: 'tracking_link',
    // One link per association, minted once (unique index), so the association
    // IS the link here.
    entityId: input.associationId,
    to: row.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}
