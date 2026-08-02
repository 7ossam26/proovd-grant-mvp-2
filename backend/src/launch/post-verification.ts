/**
 * First-post submission and verification — Spec §17, §33.4.7, §33.4.8.
 *
 * §17 steps 4–5: a Creator submits the public post URL, and Admin verifies the
 * live post against the seven checks. The three outcomes and their effects:
 *
 *   passed            → valid post-activation traffic stays provisionally
 *                       attributable and may later finalize (Phase 14b/19).
 *   correction_needed → pause the Creator's link, name the exact correction and
 *                       its due time, and prevent invalid earnings finalizing.
 *   rejected          → pause the link, open an enforcement review, preserve the
 *                       evidence. The public launch is NOT reversed.
 *
 * ── Verification releases US$0 (§33.4.7) ────────────────────────────────────
 * Nothing here writes a payment flag, touches an allocation, or moves money.
 * The outcome decides only whether traffic through the link may finalize — a
 * compliance gate, never a payment trigger. §33.4.7 tests exactly this.
 *
 * ── A rejection pauses the Creator, not the campaign (§33.4.8) ───────────────
 * The pause is on the tracking link (`paused_at`) and the association (active →
 * paused). `campaigns.status` is never touched: a rejected post leaves the page
 * live. The absence of any write to `campaigns` here is the enforcement.
 *
 * ── Duplicate verification is idempotent (§33.4.6) ──────────────────────────
 * Verification is a conditional UPDATE from `submitted`; a second verify of an
 * already-decided submission matches nothing and returns `already_verified`,
 * so no second transition, no second pause, and no second message.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignAffiliateAssociations } from '../db/schema/domain.js';
import { trackingLinks } from '../db/schema/decisions.js';
import { creatorPostSubmissions, type CreatorPostSubmission } from '../db/schema/launch.js';
import type { AuditWriter } from '../auth/audit.js';
import { transitionAssociation } from '../affiliates/recruitment.js';
import { OUTCOME_EFFECTS, checklistComplete, failedChecks, type PostOutcome } from './logic.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update'>;

export interface PostVerificationDeps {
  audit: AuditWriter;
}

/* ── Submit (§17 step 4) ───────────────────────────────────────────────────── */

export type SubmitOutcome =
  | { status: 'submitted'; submission: CreatorPostSubmission; alreadyExisted: boolean }
  | { status: 'not_found' }
  | { status: 'not_active'; message: string };

/**
 * A Creator submits a post URL. It is refused unless their tracking link has
 * been activated — a post carries a working link, and a working link exists only
 * after step 2 (this is "posts third", after "links second"). A `paused` Creator
 * may still resubmit, because that is exactly how a correction is fixed; a Creator
 * who has not launched (`ready`, link inactive) cannot. Re-submitting the exact
 * same URL is idempotent by the unique (association,url) index; a different URL is
 * a new submission (a resubmission after a correction).
 */
export async function submitPost(
  db: Database,
  deps: PostVerificationDeps,
  input: { associationId: string; postUrl: string; channel?: string | undefined; submittedBy: string; now?: Date },
): Promise<SubmitOutcome> {
  const now = input.now ?? new Date();

  const [association] = await db
    .select({ id: campaignAffiliateAssociations.id, campaignId: campaignAffiliateAssociations.campaignId, status: campaignAffiliateAssociations.status })
    .from(campaignAffiliateAssociations)
    .where(eq(campaignAffiliateAssociations.id, input.associationId))
    .limit(1);
  if (!association) return { status: 'not_found' };

  const [link] = await db
    .select({ active: trackingLinks.active, pausedAt: trackingLinks.pausedAt })
    .from(trackingLinks)
    .where(eq(trackingLinks.associationId, input.associationId))
    .limit(1);

  const launched = link?.active === true;
  const canPost = association.status === 'active' || association.status === 'paused';
  if (!launched || !canPost) {
    return {
      status: 'not_active',
      message:
        'Your tracking link is not live yet, so there is no working link to post. Submit your post once the campaign is live.',
    };
  }

  const [inserted] = await db
    .insert(creatorPostSubmissions)
    .values({
      associationId: input.associationId,
      campaignId: association.campaignId,
      postUrl: input.postUrl,
      channel: input.channel ?? null,
      submittedAt: now,
      submittedBy: input.submittedBy,
    })
    .onConflictDoNothing({ target: [creatorPostSubmissions.associationId, creatorPostSubmissions.postUrl] })
    .returning();

  if (inserted) {
    await deps.audit({
      action: 'creator_post.submitted',
      targetType: 'campaign_affiliate_association',
      targetId: input.associationId,
      internalReason: `first-post URL submitted for §17 verification`,
      newValue: { submissionId: inserted.id, postUrl: input.postUrl },
      actorId: input.submittedBy.replace(/^user:/, ''),
    });
    return { status: 'submitted', submission: inserted, alreadyExisted: false };
  }

  // Idempotent re-submit of the same URL: return the existing row unchanged.
  const [existing] = await db
    .select()
    .from(creatorPostSubmissions)
    .where(
      and(
        eq(creatorPostSubmissions.associationId, input.associationId),
        eq(creatorPostSubmissions.postUrl, input.postUrl),
      ),
    )
    .limit(1);
  return { status: 'submitted', submission: existing!, alreadyExisted: true };
}

/* ── Verify (§17 step 5) ───────────────────────────────────────────────────── */

export type VerifyOutcome =
  | {
      status: 'verified';
      outcome: PostOutcome;
      submission: CreatorPostSubmission;
      linkPaused: boolean;
      associationPaused: boolean;
      associationResumed: boolean;
    }
  | { status: 'already_verified'; submission: CreatorPostSubmission }
  | { status: 'not_found' }
  | { status: 'checklist_incomplete'; failed: string[] };

export interface VerifyInput {
  submissionId: string;
  outcome: PostOutcome;
  /** The seven §17 checks, each with its recorded boolean result. */
  checklist: Record<string, boolean>;
  correctionDetail?: string | undefined;
  correctionDueAt?: Date | undefined;
  enforcementReason?: string | undefined;
  evidence?: Record<string, unknown> | undefined;
  actor: string;
  now?: Date;
}

/**
 * Admin records the §17 verification outcome. A `passed` outcome requires every
 * check true; a `correction_needed`/`rejected` outcome pauses the link and the
 * Creator and, for a rejection, opens enforcement and preserves evidence — and
 * moves no money and never touches the page launch.
 */
export async function verifyPost(
  db: Database,
  deps: PostVerificationDeps,
  input: VerifyInput,
): Promise<VerifyOutcome> {
  const now = input.now ?? new Date();
  const effect = OUTCOME_EFFECTS[input.outcome];

  // A pass must actually pass every check. A correction/rejection records which
  // checks failed but does not require the whole checklist to be complete.
  if (input.outcome === 'passed' && !checklistComplete(input.checklist)) {
    return { status: 'checklist_incomplete', failed: failedChecks(input.checklist) };
  }

  const result = await db.transaction(async (tx): Promise<VerifyOutcome> => {
    const [submission] = await tx
      .select()
      .from(creatorPostSubmissions)
      .where(eq(creatorPostSubmissions.id, input.submissionId))
      .for('update')
      .limit(1);
    if (!submission) return { status: 'not_found' };
    if (submission.status !== 'submitted') {
      // §33.4.6: a duplicate verification changes nothing.
      return { status: 'already_verified', submission };
    }

    const [updated] = await tx
      .update(creatorPostSubmissions)
      .set({
        status: input.outcome,
        verifiedAt: now,
        verifiedBy: input.actor,
        checklist: input.checklist,
        correctionDetail: input.correctionDetail ?? null,
        correctionDueAt: input.correctionDueAt ?? null,
        enforcementReason: effect.opensEnforcement ? (input.enforcementReason ?? 'serious breach') : null,
        evidence: effect.opensEnforcement ? (input.evidence ?? { note: 'evidence preserved for enforcement review' }) : (input.evidence ?? null),
        updatedAt: now,
      })
      .where(and(eq(creatorPostSubmissions.id, submission.id), eq(creatorPostSubmissions.status, 'submitted')))
      .returning();

    let linkPaused = false;
    let associationPaused = false;
    let associationResumed = false;

    if (effect.pausesLink) {
      // Pause the link (keep active/activated_at — the 0017 CHECK still holds).
      const paused = await tx
        .update(trackingLinks)
        .set({
          pausedAt: now,
          pausedReason:
            input.outcome === 'rejected'
              ? 'first-post rejected (serious breach) — §17'
              : 'first-post correction required — §17',
          pausedBy: input.actor,
        })
        .where(and(eq(trackingLinks.associationId, submission.associationId), isNull(trackingLinks.pausedAt)))
        .returning({ id: trackingLinks.id });
      linkPaused = paused.length === 1;

      // Pause the Creator (active → paused). If already paused, this is a no-op.
      associationPaused = await transitionAssociation(
        submission.associationId,
        'active',
        'paused',
        input.actor,
        tx,
      );
    } else {
      // Passed: if this Creator was paused by an earlier correction and has now
      // corrected it, resume the link and the association.
      const resumed = await tx
        .update(trackingLinks)
        .set({ pausedAt: null, pausedReason: null, pausedBy: null })
        .where(eq(trackingLinks.associationId, submission.associationId))
        .returning({ id: trackingLinks.id });
      if (resumed.length === 1) {
        associationResumed = await transitionAssociation(
          submission.associationId,
          'paused',
          'active',
          input.actor,
          tx,
        );
      }
    }

    await deps.audit({
      action: `creator_post.${input.outcome}`,
      targetType: 'campaign_affiliate_association',
      targetId: submission.associationId,
      internalReason:
        `§17 first-post verification: ${input.outcome}. ` +
        (input.outcome === 'passed'
          ? 'Post-activation traffic stays provisionally attributable; no money released (§33.4.7).'
          : `Creator and link paused${effect.opensEnforcement ? ', enforcement review opened, evidence preserved' : ''}; ` +
            'invalid earnings blocked; the public launch is not reversed (§33.4.8).'),
      newValue: {
        submissionId: submission.id,
        outcome: input.outcome,
        failedChecks: failedChecks(input.checklist),
        linkPaused,
        associationPaused,
        associationResumed,
      },
      actorId: input.actor.replace(/^admin:|^user:/, '') || null,
    });

    return {
      status: 'verified',
      outcome: input.outcome,
      submission: updated ?? submission,
      linkPaused,
      associationPaused,
      associationResumed,
    };
  });

  return result;
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

export async function findSubmission(
  db: Executor,
  submissionId: string,
): Promise<CreatorPostSubmission | null> {
  const [row] = await db
    .select()
    .from(creatorPostSubmissions)
    .where(eq(creatorPostSubmissions.id, submissionId))
    .limit(1);
  return row ?? null;
}

/** The Creator's most recent submission for one association. */
export async function findLatestSubmission(
  db: Executor,
  associationId: string,
): Promise<CreatorPostSubmission | null> {
  const [row] = await db
    .select()
    .from(creatorPostSubmissions)
    .where(eq(creatorPostSubmissions.associationId, associationId))
    .orderBy(desc(creatorPostSubmissions.submittedAt))
    .limit(1);
  return row ?? null;
}

/** Every submission on a campaign, for the Admin verification panel. */
export async function listCampaignSubmissions(
  db: Executor,
  campaignId: string,
): Promise<CreatorPostSubmission[]> {
  return db
    .select()
    .from(creatorPostSubmissions)
    .where(eq(creatorPostSubmissions.campaignId, campaignId))
    .orderBy(desc(creatorPostSubmissions.submittedAt));
}
