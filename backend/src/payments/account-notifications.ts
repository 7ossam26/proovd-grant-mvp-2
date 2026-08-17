/**
 * The connected-account status messages — Spec §13, §27.3, §27.4 (Phase 22b).
 *
 * §13's four derived states have moved on their own from `account.updated`
 * since Phase 10a, and nobody was ever told. A Founder whose seller account
 * slipped to `more_information_required` learned by trying to pay a listing fee
 * and being refused; a Creator whose recipient account went incomplete learned
 * when their tracking link would not activate. Both are the §27.1 failure — a
 * state changed, it has a consequence, and the person who owns the next step
 * finds out by hitting the wall.
 *
 * ── The message is keyed to the state CHANGE, not to the account ────────────
 * `account.updated` arrives for every provider-side touch, most of which change
 * nothing (`upsertConnectedAccount` already reports `changed`). Sending on
 * arrival would be a stream of identical mail; sending on the account would
 * announce the first slip and swallow every later one — §7's failure in another
 * phase. So the dedup entity is `<stripeAccountId>:<newState>` and the sender
 * runs only when the state actually moved.
 *
 * A complete → restricted → complete round trip therefore sends three
 * messages, which is right: each of those is a different fact about whether
 * this person can be paid.
 *
 * ── `not_started` is not an event ───────────────────────────────────────────
 * The only transition into it is the account being created, and Phase 10b's
 * onboarding surface is what the person is looking at when that happens.
 * Mailing someone about a step they are mid-way through is noise.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { user } from '../db/schema/auth.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import type { Notifier } from '../notifications/send.js';
import {
  FOUNDER_CONNECTED_ACCOUNT_STATUS,
  AFFILIATE_CONNECTED_ACCOUNT_INFO_REQUIRED,
} from '../notifications/events.js';
import { renderPlainNotice } from '../notifications/templates/plain.js';
import type { ListingNotificationContext } from './listing-notifications.js';

export type AccountState =
  | 'not_started'
  | 'more_information_required'
  | 'under_review'
  | 'complete'
  | 'restricted';

export interface AccountNotificationDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: ListingNotificationContext | undefined;
}

/**
 * §13's words, and the honest next step for each. `restricted` deliberately
 * offers no retry: §13 says restricted lands "with safe support path and no
 * misleading ability to pay the listing fee", and looping someone through
 * onboarding that will fail the same way is worse than telling them plainly
 * (Phase 10b's posture, carried into the message).
 */
const STATE_COPY: Record<
  Exclude<AccountState, 'not_started'>,
  { headline: string; status: string; owner: string; next: string; action: boolean }
> = {
  more_information_required: {
    headline: 'Stripe needs more information before you can be paid.',
    status: 'More information required',
    owner: 'You — Stripe collects it directly, and Proovd never sees it',
    next: 'Open your payout setup and supply what is listed below. It usually takes a few minutes.',
    action: true,
  },
  under_review: {
    headline: 'Stripe is reviewing your payout account.',
    status: 'Under review',
    owner: 'Stripe — there is nothing for you to do',
    next: 'No action needed. We will tell you as soon as the review finishes.',
    action: false,
  },
  complete: {
    headline: 'Your payout account is ready.',
    status: 'Complete',
    owner: 'Nobody — this step is done',
    next: 'Nothing further is needed from you for payouts.',
    action: false,
  },
  restricted: {
    headline: 'Stripe has restricted your payout account.',
    status: 'Restricted',
    owner: 'Proovd support — a person will help you work out what happened',
    next: 'There is no retry to run. Reply to this message and we will take it from there.',
    action: false,
  },
};

async function ownerEmail(db: Database, ownerUserId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, ownerUserId))
    .limit(1);
  return row?.email ?? null;
}

/**
 * §27.3's "Connected-account requirement/status" and §27.4's "Connected-account
 * info required", from one state change. The role decides which key, because
 * `complete` means different things for a seller and a recipient (§24.1) and
 * the two inventories name the message separately.
 */
export async function notifyAccountStateChange(
  deps: AccountNotificationDeps,
  input: {
    stripeAccountId: string;
    role: 'founder_seller' | 'affiliate_recipient';
    ownerUserId: string;
    priorState: AccountState | null;
    state: AccountState;
    /** The provider's own requirement names, past-due first (§13). */
    missingRequirements: readonly string[];
  },
): Promise<void> {
  if (!deps.notifier || !deps.context) return;
  if (input.state === 'not_started') return;
  if (input.priorState === input.state) return;

  const email = await ownerEmail(deps.db, input.ownerUserId);
  if (!email) return;

  const copy = STATE_COPY[input.state];
  const facts = [
    { label: 'Status', value: copy.status },
    { label: 'Who owns it', value: copy.owner },
  ];
  if (input.state === 'more_information_required' && input.missingRequirements.length > 0) {
    // §13: "the exact missing requirement" — never an empty "more information
    // needed". Stripe's own names, which is what Phase 10b decided to show
    // rather than swallow anything it could not translate.
    facts.push({
      label: 'What Stripe still needs',
      value: input.missingRequirements.join(', '),
    });
  }

  const notice = await renderPlainNotice({
    subject:
      input.state === 'complete'
        ? 'Your Proovd payout account is ready'
        : `Action on your Proovd payout account — ${copy.status.toLowerCase()}`,
    headline: copy.headline,
    facts,
    paragraphs: [
      copy.next,
      'Stripe collects and holds the identity, tax, and bank details for this account. Proovd never asks for them and never stores them.',
    ],
    ...(copy.action
      ? { action: { label: 'Open payout setup', url: `${deps.context.appBaseUrl}/payouts` } }
      : {}),
    reference: input.stripeAccountId,
    supportEmail: deps.context.supportEmail,
  });

  await deps.notifier.send({
    eventKey:
      input.role === 'founder_seller'
        ? FOUNDER_CONNECTED_ACCOUNT_STATUS
        : AFFILIATE_CONNECTED_ACCOUNT_INFO_REQUIRED,
    entityType: 'connected_account_state',
    // The state change, not the account: a slip and a later recovery are
    // different facts and each is worth one message (§27.2).
    entityId: `${input.stripeAccountId}:${input.state}`,
    to: email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
}

/**
 * The Admin-initiated payout reminder (the Affiliate rebuild's gap 3).
 *
 * §27 defines no new reminder message; this SENDS THE SAME notice the state
 * change already sends, under the same key — the copy object above is the one
 * source of its words. What differs is the dedup entity: the state-change
 * sender keys on `<account>:<state>` so a slip is announced once, and a
 * deliberate Admin re-ask keys on the RECORDED ask (its audit row), so asking
 * again is a second message and a replay of one ask is not (§7's resend rule,
 * the Session B correction-request arrangement).
 *
 * The caller gates on the stored payout state before recording the ask —
 * reminding somebody about nothing would be §1.4's failure — and reports the
 * outcome beside the re-read rather than swallowing a transport refusal.
 */
export async function sendAffiliatePayoutReminder(
  deps: Pick<AccountNotificationDeps, 'notifier' | 'context'>,
  input: {
    stripeAccountId: string;
    email: string;
    missingRequirements: readonly string[];
    /** The recorded ask this send dedups on. */
    entityId: string;
  },
): Promise<{ sent: boolean; reason: string | null }> {
  if (!deps.notifier || !deps.context) {
    return { sent: false, reason: 'No email transport is configured, so nothing was sent.' };
  }

  const copy = STATE_COPY.more_information_required;
  const facts = [
    { label: 'Status', value: copy.status },
    { label: 'Who owns it', value: copy.owner },
  ];
  if (input.missingRequirements.length > 0) {
    facts.push({
      label: 'What Stripe still needs',
      value: input.missingRequirements.join(', '),
    });
  }

  const notice = await renderPlainNotice({
    subject: `Action on your Proovd payout account — ${copy.status.toLowerCase()}`,
    headline: copy.headline,
    facts,
    paragraphs: [
      copy.next,
      'Stripe collects and holds the identity, tax, and bank details for this account. Proovd never asks for them and never stores them.',
    ],
    action: { label: 'Open payout setup', url: `${deps.context.appBaseUrl}/payouts` },
    reference: input.stripeAccountId,
    supportEmail: deps.context.supportEmail,
  });

  const outcome = await deps.notifier.send({
    eventKey: AFFILIATE_CONNECTED_ACCOUNT_INFO_REQUIRED,
    entityType: 'affiliate_payout_reminder',
    entityId: input.entityId,
    to: input.email,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });

  if (outcome.status === 'sent') return { sent: true, reason: null };
  if (outcome.status === 'duplicate') {
    return { sent: false, reason: 'This ask was already sent — a replay is not a second message.' };
  }
  return { sent: false, reason: `The provider refused the send: ${outcome.reason}` };
}

/** The role and owner behind a Stripe account id, for the webhook path. */
export async function findAccountOwner(
  db: Database,
  stripeAccountId: string,
): Promise<{ role: 'founder_seller' | 'affiliate_recipient'; ownerUserId: string } | null> {
  const [row] = await db
    .select({
      role: stripeConnectedAccounts.role,
      ownerUserId: stripeConnectedAccounts.ownerUserId,
    })
    .from(stripeConnectedAccounts)
    .where(eq(stripeConnectedAccounts.stripeAccountId, stripeAccountId))
    .limit(1);
  if (!row) return null;
  return {
    role: row.role as 'founder_seller' | 'affiliate_recipient',
    ownerUserId: row.ownerUserId,
  };
}
