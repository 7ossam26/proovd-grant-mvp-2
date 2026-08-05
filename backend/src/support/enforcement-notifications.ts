/**
 * §26.7 "notify affected roles" — Phase 20b.
 *
 * 16b left `notifyRoles` an optional dep nothing supplied, so the effect was
 * never claimed as applied. This is the real implementation, wired in app.ts
 * and in the admin-support router: the Founder, every Creator whose
 * partnership the enforcement touches, and every Backer with a reservation the
 * decision affects each receive the outcome-specific notice — the
 * Admin-recorded customer explanation plus the audience's own money fact,
 * never one generic `Campaign ended` (§18).
 *
 * Dedup: every send keys on the enforcement's stable idempotency key
 * (`campaign_<action>:<campaignId>`), so a replayed enforcement sends nothing
 * and a later DISTINCT action (suspend, then kill) sends its own set (§27.2).
 *
 * `founder_payment_blocked` (§27.3) finally has a detectable trigger: a
 * post-capture hold restricting an existing unreleased payment. It sends per
 * payment row beside the campaign notice, with the exact amount affected.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignAffiliateAssociations, reservations } from '../db/schema/domain.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { campaignBuild } from '../db/schema/build.js';
import { founderPayments } from '../db/schema/founder-payments.js';
import type { Notifier } from '../notifications/send.js';
import {
  AFFILIATE_SUSPENSION,
  BACKER_CAMPAIGN_KILLED,
  BACKER_CAMPAIGN_SUSPENDED,
  FOUNDER_CAMPAIGN_KILLED,
  FOUNDER_CAMPAIGN_SUSPENDED,
  FOUNDER_PAYMENT_BLOCKED,
} from '../notifications/events.js';
import { renderEnforcementNotice } from '../notifications/templates/enforcement.js';
import { loadFounder, type LaunchNotificationContext } from '../launch/notifications.js';
import { formatCents } from '../reservations/restated.js';
import type { EnforcementActionKind, EnforcementPhaseKind } from './logic.js';

export interface EnforcementNotifierDeps {
  db: Database;
  notifier: Notifier;
  context: LaunchNotificationContext;
}

export interface NotifyEnforcementInput {
  campaignId: string;
  action: EnforcementActionKind;
  phase: EnforcementPhaseKind;
  explanation: string;
  dedupeKey: string;
}

/** The customer word for each action — §3.1: never `killed` in an inbox. */
function outcomeWord(action: EnforcementActionKind): string {
  return action === 'kill' ? 'stopped' : 'paused';
}

async function campaignTitle(db: Database, campaignId: string): Promise<string> {
  const [build] = await db
    .select({ title: campaignBuild.title })
    .from(campaignBuild)
    .where(eq(campaignBuild.campaignId, campaignId))
    .limit(1);
  return build?.title ?? 'Your campaign';
}

export async function notifyEnforcementRoles(
  deps: EnforcementNotifierDeps,
  input: NotifyEnforcementInput,
): Promise<void> {
  const { db, notifier, context } = deps;
  const title = await campaignTitle(db, input.campaignId);
  const word = outcomeWord(input.action);
  const founderKey =
    input.action === 'kill' ? FOUNDER_CAMPAIGN_KILLED : FOUNDER_CAMPAIGN_SUSPENDED;
  const backerKey = input.action === 'kill' ? BACKER_CAMPAIGN_KILLED : BACKER_CAMPAIGN_SUSPENDED;

  /* ── The Founder (§27.3) ─────────────────────────────────────────────────── */
  const founder = await loadFounder(db, input.campaignId);
  if (founder.email) {
    const rendered = await renderEnforcementNotice({
      outcomeWord: word,
      campaignTitle: title,
      explanation: input.explanation,
      moneyFact:
        input.phase === 'post_capture'
          ? 'Charged pre-orders keep their recorded state. Unreleased campaign payments are restricted while this stands; any refund follows the recorded cause rules.'
          : 'No pre-order has been charged, and none will be. Saved cards lose future-charge eligibility for this campaign.',
      nextStep:
        input.action === 'kill'
          ? 'The campaign page stays accessible in its ended state. Proovd will contact you about anything that needs your action.'
          : 'The campaign is on hold while Proovd reviews it. Proovd will contact you with the outcome.',
      supportEmail: context.supportEmail,
    });
    await notifier.send({
      eventKey: founderKey,
      entityType: 'campaign_enforcement',
      entityId: input.dedupeKey,
      to: founder.email,
      from: context.fromAddress,
      replyTo: context.supportEmail,
      ...rendered,
    });
  }

  /* ── Creators with a live stake (§27.4) ──────────────────────────────────── */
  const creatorRows = await db
    .select({
      associationId: campaignAffiliateAssociations.id,
      email: affiliateSignupProfiles.email,
    })
    .from(campaignAffiliateAssociations)
    .leftJoin(
      affiliateSignupProfiles,
      eq(affiliateSignupProfiles.associationId, campaignAffiliateAssociations.id),
    )
    .where(
      and(
        eq(campaignAffiliateAssociations.campaignId, input.campaignId),
        inArray(sql`${campaignAffiliateAssociations.status}::text`, [
          'accepted',
          'readiness_blocked',
          'ready',
          'active',
          'paused',
          'ended',
        ]),
      ),
    );
  for (const row of creatorRows) {
    if (!row.email) continue;
    const rendered = await renderEnforcementNotice({
      outcomeWord: word,
      campaignTitle: title,
      explanation: input.explanation,
      moneyFact:
        input.phase === 'post_capture'
          ? 'Finalized earnings keep their recorded state; anything not yet transferred is restricted while this stands, and any change follows the recorded cause rules — never an automatic clawback.'
          : 'No Backer was charged, so no commission exists on this campaign. Your standing with Proovd is unaffected by this decision about the campaign.',
      nextStep: 'Your money status view shows the current state of every amount.',
      supportEmail: context.supportEmail,
    });
    await notifier.send({
      eventKey: AFFILIATE_SUSPENSION,
      entityType: 'campaign_enforcement',
      entityId: `${input.dedupeKey}:${row.associationId}`,
      to: row.email,
      from: context.fromAddress,
      replyTo: context.supportEmail,
      ...rendered,
    });
  }

  /* ── Backers whose reservations the decision touches (§27.5) ─────────────── */
  const backerRows = await db
    .select({
      id: reservations.id,
      email: reservations.backerEmail,
      status: sql<string>`${reservations.status}::text`,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.campaignId, input.campaignId),
        inArray(sql`${reservations.status}::text`, [
          'reserved_active',
          'pending_capture',
          'capture_failed_retrying',
          'killed_no_charge',
          'captured',
          'disputed',
          'refunded',
          'reversed',
        ]),
      ),
    );
  const charged = new Set(['captured', 'disputed', 'refunded', 'reversed']);
  for (const row of backerRows) {
    if (!row.email) continue;
    const wasCharged = charged.has(row.status);
    const rendered = await renderEnforcementNotice({
      outcomeWord: word,
      campaignTitle: title,
      explanation: input.explanation,
      moneyFact: wasCharged
        ? 'Your card was charged the exact total you authorized. What happens to that charge follows the recorded refund rules — your pre-order page shows its current state, and your card issuer rights are unaffected.'
        : 'Your card was NOT charged, and it will not be. This pre-order is closed at US$0.',
      nextStep: wasCharged
        ? 'Open your pre-order page from your confirmation email for the current state and to get help without repeating anything.'
        : 'Nothing further happens, and you were not billed.',
      supportEmail: context.supportEmail,
    });
    await notifier.send({
      eventKey: backerKey,
      entityType: 'campaign_enforcement',
      entityId: `${input.dedupeKey}:${row.id}`,
      to: row.email,
      from: context.fromAddress,
      replyTo: context.supportEmail,
      ...rendered,
    });
  }

  /* ── §27.3: the exact amount a post-capture hold restricts ───────────────── */
  if (input.phase === 'post_capture' && founder.email) {
    const heldPayments = await db
      .select()
      .from(founderPayments)
      .where(
        and(
          eq(founderPayments.campaignId, input.campaignId),
          eq(founderPayments.status, 'eligible'),
        ),
      );
    for (const payment of heldPayments) {
      const amount = formatCents(payment.amountCents);
      const text =
        `A campaign payment of US$${amount} is on hold: the campaign has been ${word} and ` +
        'unreleased payments are restricted while that stands (§26.7). No action is needed from you; ' +
        `Proovd will contact you with the outcome. Questions: ${context.supportEmail}.`;
      await notifier.send({
        eventKey: FOUNDER_PAYMENT_BLOCKED,
        entityType: 'campaign_enforcement',
        entityId: `${input.dedupeKey}:payment:${payment.id}`,
        to: founder.email,
        from: context.fromAddress,
        replyTo: context.supportEmail,
        subject: `Campaign payment on hold — ${title}`,
        html: `<p>${text}</p>`,
        text,
      });
    }
  }
}
