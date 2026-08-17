/**
 * Asks the workspace sends to the Affiliate — Spec §11, §27.4, §27.2 (the
 * Affiliate rebuild, Session B, 2026-08-17).
 *
 * One message, two occasions. `affiliate_correction_request` is §11's right to
 * correct prefilled public information, exercised as an ask: an Admin names an
 * account field (the correction dialog) or an evidence metric (the
 * request-more-evidence dialog) and says what to check. Nothing about the
 * record changes — `CORRECTION_REQUEST_LEAVES_VALUE` is the surface's own
 * sentence, and this module writes no table.
 *
 * ── The dedup entity is the recorded ask ────────────────────────────────────
 * §1.3 makes manual work valid only when the app records it, so every ask
 * exists as a record before it sends: the §25.6 audit row for a field
 * correction, the `affiliate_evidence_verifications` row for an evidence
 * request. Keying the delivery on that row means a deliberate second ask is a
 * second message (§7's resend rule) while a replay of the same ask is not.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { affiliateProspects } from '../../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../../db/schema/affiliate-signup.js';
import type { Notifier } from '../../notifications/send.js';
import { AFFILIATE_CORRECTION_REQUEST } from '../../notifications/events.js';
import { renderPlainNotice } from '../../notifications/templates/plain.js';

export interface AskContext {
  appBaseUrl: string;
  supportEmail: string;
  fromAddress: string;
}

export interface AskDeps {
  db: Database;
  notifier?: Notifier | undefined;
  context?: AskContext | undefined;
}

/**
 * Sends the §11 correction/evidence ask.
 *
 * The recipient is the address the person actually holds: the signup profile's
 * once they claimed, the research record's before that — the same precedence
 * the Account & Eligibility block renders. No notifier configured means the
 * ask was recorded and nothing sent, and the caller reports that rather than
 * pretending (§1.4).
 */
export async function sendCorrectionRequest(
  deps: AskDeps,
  input: {
    prospectId: string;
    /** What is being asked about, in the words the surface showed. */
    subjectLabel: string;
    /** The Admin's ask — what should be checked, and the evidence needed. */
    note: string;
    /** The record row this ask exists as. The delivery dedups on it. */
    entityType: string;
    entityId: string;
  },
): Promise<{ sent: boolean; reason: string | null }> {
  if (!deps.notifier || !deps.context) {
    return {
      sent: false,
      reason: 'No email transport is configured, so the ask was recorded and nothing was sent.',
    };
  }

  const [prospect] = await deps.db
    .select({
      email: affiliateProspects.email,
      handle: affiliateProspects.publicHandle,
      name: affiliateProspects.legalName,
    })
    .from(affiliateProspects)
    .where(eq(affiliateProspects.id, input.prospectId))
    .limit(1);
  if (!prospect) return { sent: false, reason: 'There is no Affiliate at that address.' };

  const [profile] = await deps.db
    .select({ email: affiliateSignupProfiles.email })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.prospectId, input.prospectId))
    .limit(1);

  const to = profile?.email ?? prospect.email;
  if (!to) return { sent: false, reason: 'This Affiliate has no recorded email address.' };

  const notice = await renderPlainNotice({
    subject: 'Please review one detail on your Proovd record',
    headline: 'One thing to check on your record',
    facts: [
      { label: 'What to review', value: input.subjectLabel },
      { label: 'What we ask', value: input.note },
      // §1.4 and the pinned sentence: asking changes nothing.
      {
        label: 'What has changed',
        value: 'Nothing. The current value stays until you supply a correction.',
      },
    ],
    paragraphs: [
      'Proovd keeps a record of your public channel and audience so campaigns can be matched honestly. You have the right to correct anything on it.',
      'Reply to this message with the correction or the evidence, and a person will record it.',
    ],
    reference: input.entityId,
    supportEmail: deps.context.supportEmail,
  });

  const outcome = await deps.notifier.send({
    eventKey: AFFILIATE_CORRECTION_REQUEST,
    entityType: input.entityType,
    entityId: input.entityId,
    to,
    from: deps.context.fromAddress,
    replyTo: deps.context.supportEmail,
    ...notice,
  });
  if (outcome.status === 'sent') return { sent: true, reason: null };
  return {
    sent: false,
    reason:
      outcome.status === 'duplicate'
        ? 'This exact ask was already delivered.'
        : `The email provider refused the send. The ask is recorded; nothing reached the Affiliate. (${outcome.reason})`,
  };
}
