/**
 * §29.8 policy-update reacceptance — Phase 20b.
 *
 * "Material Terms/AUP updates require Founder/Affiliate reacceptance.
 * Continued use is suspended until accepted. Store policy version and
 * acceptance time."
 *
 * Three parts, none of them new machinery:
 *
 *   1. The REQUIREMENT is an Admin's recorded materiality judgement (§15's
 *      rule — materiality is never guessed) citing a PUBLISHED version
 *      (trigger-enforced; a draft nobody can read cannot suspend anyone).
 *
 *   2. SATISFACTION is an ordinary `policy_consents` row — the same store
 *      every claim writes, so "store version and acceptance time" was already
 *      built and this adds no second consent table.
 *
 *   3. SUSPENSION is the `policyReacceptanceGate` middleware on the Founder
 *      and Creator API prefixes: an outstanding requirement answers 403
 *      `policy_reacceptance_required` naming the document, and the acceptance
 *      route itself lives outside the gated prefixes — a suspension you
 *      cannot end is a ban wearing a different word.
 */

import type { RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Auth } from '../auth/auth.js';
import type { Database } from '../db/client.js';
import { policyVersions } from '../db/schema/policies.js';
import { policyConsents } from '../db/schema/vetting.js';
import { policyReacceptanceRequirements } from '../db/schema/enforcement.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import type { AuditWriter } from '../auth/audit.js';
import type { Notifier } from '../notifications/send.js';
import type { LaunchNotificationContext } from '../launch/notifications.js';
import { AFFILIATE_POLICY_REACCEPTANCE } from '../notifications/events.js';
import { REACCEPTANCE_AUDIENCES, type ReacceptanceAudienceValue } from './logic.js';

export interface ReacceptanceDeps {
  db: Database;
  audit: AuditWriter;
  /** Absent (some tests) → the requirement still records; nothing sends. */
  notifier?: Notifier | undefined;
  context?: LaunchNotificationContext | undefined;
}

export type RequireReacceptanceOutcome =
  | { ok: true; requirementId: string }
  | {
      ok: false;
      code: 'not_found' | 'not_published' | 'invalid' | 'already_required';
      message: string;
    };

export async function requirePolicyReacceptance(
  deps: ReacceptanceDeps,
  input: {
    slug: string;
    version: string;
    audience: ReacceptanceAudienceValue;
    reason: string;
    actor: string;
    now?: Date;
  },
): Promise<RequireReacceptanceOutcome> {
  if (!REACCEPTANCE_AUDIENCES.includes(input.audience)) {
    return { ok: false, code: 'invalid', message: '§29.8 names Founder and Affiliate audiences.' };
  }
  if (!input.reason.trim()) {
    return {
      ok: false,
      code: 'invalid',
      message: 'Materiality is a recorded judgement — say why this update is material (§15, §29.8).',
    };
  }
  const [version] = await deps.db
    .select()
    .from(policyVersions)
    .where(and(eq(policyVersions.slug, input.slug), eq(policyVersions.version, input.version)))
    .limit(1);
  if (!version) return { ok: false, code: 'not_found', message: 'No such policy version.' };
  if (version.status !== 'published') {
    return {
      ok: false,
      code: 'not_published',
      message:
        'A reacceptance requirement may cite only a published version — suspending everyone on a text nobody can read is not a reacceptance flow (§29.8, §31.4).',
    };
  }

  const inserted = await deps.db
    .insert(policyReacceptanceRequirements)
    .values({
      policyVersionId: version.id,
      policySlug: input.slug,
      requiredVersion: input.version,
      audience: input.audience,
      reason: input.reason,
      createdBy: input.actor,
      createdAt: input.now ?? new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: policyReacceptanceRequirements.id });
  if (inserted.length === 0) {
    return { ok: false, code: 'already_required', message: 'That requirement already exists.' };
  }

  await deps.audit({
    action: 'policy.reacceptance_required',
    actorId: input.actor,
    targetType: 'policy_version',
    targetId: version.id,
    internalReason: `§29.8 material update: ${input.reason}`,
    newValue: { slug: input.slug, version: input.version, audience: input.audience },
  });

  // §27.4 "policy reacceptance": every affected Creator hears that continued
  // use now needs their acceptance — deduped per (requirement, profile), so a
  // replayed requirement sends nothing and each person hears once. §27.3
  // names no Founder counterpart, so a Founder learns at their next request
  // (the gate's 403 names the document); no invented key (§1.4).
  if (input.audience === 'affiliate' && deps.notifier && deps.context) {
    const profiles = await deps.db
      .select({
        associationId: affiliateSignupProfiles.associationId,
        email: affiliateSignupProfiles.email,
      })
      .from(affiliateSignupProfiles)
      .where(isNotNull(affiliateSignupProfiles.claimedUserId));
    for (const profile of profiles) {
      if (!profile.email) continue;
      const text =
        `Proovd's ${version.title ?? input.slug} has a material update (version ${input.version}). ` +
        'Continued use of your Creator account is paused until you review and accept it — ' +
        `sign in, open the updated document, and accept. Questions: ${deps.context.supportEmail}.`;
      await deps.notifier.send({
        eventKey: AFFILIATE_POLICY_REACCEPTANCE,
        entityType: 'policy_reacceptance',
        entityId: `${inserted[0]!.id}:${profile.associationId}`,
        to: profile.email,
        from: deps.context.fromAddress,
        replyTo: deps.context.supportEmail,
        subject: `Action needed — an updated policy needs your acceptance`,
        html: `<p>${text}</p>`,
        text,
      });
    }
  }

  return { ok: true, requirementId: inserted[0]!.id };
}

export interface OutstandingRequirement {
  requirementId: string;
  slug: string;
  version: string;
  route: string;
}

/** Requirements for this audience the user has not yet accepted. */
export async function readOutstandingReacceptance(
  db: Database,
  input: { userId: string; audience: ReacceptanceAudienceValue },
): Promise<OutstandingRequirement[]> {
  const requirements = await db
    .select({
      id: policyReacceptanceRequirements.id,
      slug: policyReacceptanceRequirements.policySlug,
      version: policyReacceptanceRequirements.requiredVersion,
      policyVersionId: policyReacceptanceRequirements.policyVersionId,
    })
    .from(policyReacceptanceRequirements)
    .where(eq(policyReacceptanceRequirements.audience, input.audience));
  if (requirements.length === 0) return [];

  const outstanding: OutstandingRequirement[] = [];
  for (const requirement of requirements) {
    const [consent] = await db
      .select({ id: policyConsents.id })
      .from(policyConsents)
      .where(
        and(
          eq(policyConsents.subjectType, 'user'),
          eq(policyConsents.subjectId, input.userId),
          eq(policyConsents.policyVersionId, requirement.policyVersionId),
        ),
      )
      .limit(1);
    if (!consent) {
      outstanding.push({
        requirementId: requirement.id,
        slug: requirement.slug,
        version: requirement.version,
        route: `/${requirement.slug}`,
      });
    }
  }
  return outstanding;
}

export type AcceptOutcome =
  | { ok: true; accepted: { slug: string; version: string } }
  | { ok: false; code: 'nothing_outstanding' | 'not_found'; message: string };

export async function acceptPolicyReacceptance(
  deps: ReacceptanceDeps,
  input: {
    userId: string;
    audience: ReacceptanceAudienceValue;
    slug: string;
    actor: string;
    now?: Date;
  },
): Promise<AcceptOutcome> {
  const outstanding = await readOutstandingReacceptance(deps.db, {
    userId: input.userId,
    audience: input.audience,
  });
  const match = outstanding.find((o) => o.slug === input.slug);
  if (!match) {
    return {
      ok: false,
      code: 'nothing_outstanding',
      message: 'Nothing outstanding for this document.',
    };
  }
  const [version] = await deps.db
    .select()
    .from(policyVersions)
    .where(and(eq(policyVersions.slug, match.slug), eq(policyVersions.version, match.version)))
    .limit(1);
  if (!version) return { ok: false, code: 'not_found', message: 'No such policy version.' };

  await deps.db
    .insert(policyConsents)
    .values({
      subjectType: 'user',
      subjectId: input.userId,
      policyVersionId: version.id,
      slug: version.slug,
      version: version.version,
      acceptedVia: `${input.audience}_policy_reacceptance`,
      acceptedAt: input.now ?? new Date(),
    })
    .onConflictDoNothing();

  await deps.audit({
    action: 'policy.reaccepted',
    actorId: input.actor,
    targetType: 'policy_version',
    targetId: version.id,
    internalReason: `§29.8 reacceptance recorded for ${input.audience}`,
  });
  return { ok: true, accepted: { slug: version.slug, version: version.version } };
}

/**
 * §29.8's "continued use is suspended until accepted", as a prefix gate on
 * `/api/founder` and `/api/creator`. It resolves the session itself (it runs
 * before the routers' own guards), and deliberately passes an unauthenticated
 * or wrong-role request through UNANSWERED — the inner guards fail closed on
 * authentication exactly as before; this gate suspends the authenticated use
 * §29.8 names, nothing else. The 403 names the document and where to accept it
 * — a bare "forbidden" would be the generic error §30 bans.
 */
export function policyReacceptanceGate(
  db: Database,
  auth: Auth,
  audience: ReacceptanceAudienceValue,
): RequestHandler {
  const expectedRole = audience === 'founder' ? 'founder' : 'affiliate';
  return async (req, res, next) => {
    let session;
    try {
      session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    } catch {
      next();
      return;
    }
    const userId = session?.user?.id;
    const role = (session?.user as unknown as Record<string, unknown> | undefined)?.['role'];
    if (!userId || role !== expectedRole) {
      next();
      return;
    }
    try {
      const outstanding = await readOutstandingReacceptance(db, { userId, audience });
      if (outstanding.length > 0) {
        res.status(403).json({
          error: 'policy_reacceptance_required',
          title: 'An updated policy needs your acceptance',
          whatHappened:
            'A material policy update requires reacceptance before continued use (§29.8).',
          next: 'Review and accept the updated document, then retry.',
          requirements: outstanding,
          acceptAt: '/api/account/policy-reacceptance',
        });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
