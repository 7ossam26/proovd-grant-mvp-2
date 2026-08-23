/**
 * Phase 21b — completion, future work, satisfaction, and resolution.
 *
 * Acceptance:
 *  **§33.10.5** — `successfully_completed` requires all five criteria and Admin
 *                 evidence.
 *  **§33.10.6** — Zero sales does not block completion when the work was valid.
 *  **§33.10.7** — Only an eligible completed Creator can receive a post-end
 *                 work-again request.
 *  **§33.10.8** — Accept/decline creates no campaign and bypasses no cooldown
 *                 or readiness gate.
 *  **§33.10.9** — The Founder sees the exact cooldown date and the separate
 *                 readiness decision.
 *  **§33.10.10** — Satisfaction takes under 30 seconds and a negative result
 *                  creates one owned follow-up case.
 *
 * Plus the phase's own done-when: `closed_resolved` and `fulfilled` remain
 * independently trackable.
 *
 * Drift guards run first: `completion/logic.ts` restates every register and the
 * cooldown kernel, and the backend cannot import `@proovd/shared` at runtime.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser } from './admin-session.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import { createAuditWriter } from '../auth/audit.js';
import { campaigns, campaignAffiliateAssociations, reservations } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { campaignBuild } from '../db/schema/build.js';
import { associationReadiness } from '../db/schema/build.js';
import { affiliateProspects } from '../db/schema/affiliates.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { backerIdentities } from '../db/schema/reservations.js';
import { creatorPostSubmissions } from '../db/schema/launch.js';
import { creatorCompletionDecisions, creatorEarnings } from '../db/schema/earnings.js';
import { campaignFulfillment } from '../db/schema/fulfillment.js';
import { campaignReconciliations } from '../db/schema/close.js';
import {
  backerSatisfactionResponses,
  campaignResolutions,
  creatorCompletionStatuses,
  founderNextCampaignReadiness,
  workAgainRequests,
} from '../db/schema/completion.js';
import { supportCases } from '../db/schema/support.js';
import { affiliateEnforcementActions } from '../db/schema/enforcement.js';

import {
  COMPLETION_CRITERIA,
  COMPLETION_CRITERION_KEYS,
  completionEligible,
  unmetCriteria,
  NEXT_CAMPAIGN_GATES,
  nextCampaignEarliestAt,
  cooldownElapsed,
  satisfactionIsNegative,
  SATISFACTION_PROHIBITIONS,
  SATISFACTION_CLICKS_TO_ANSWER,
  RESOLUTION_AREAS,
  resolutionComplete,
  unresolvedAreas,
  WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING,
  WORK_AGAIN_NO_PENALTY,
  RESOLUTION_IS_NOT_FULFILLMENT,
} from '../completion/logic.js';
import {
  COMPLETION_CRITERIA as SHARED_CRITERIA,
  NEXT_CAMPAIGN_GATES as SHARED_GATES,
  nextCampaignEarliestAt as sharedEarliestAt,
  RESOLUTION_AREAS as SHARED_AREAS,
  SATISFACTION_PROHIBITIONS as SHARED_PROHIBITIONS,
  WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING as SHARED_GRANTS_NOTHING,
  WORK_AGAIN_NO_PENALTY as SHARED_NO_PENALTY,
  RESOLUTION_IS_NOT_FULFILLMENT as SHARED_NOT_FULFILLMENT,
} from '@proovd/shared';

import {
  assignCompletionStatus,
  correctCompletionStatus,
  gatherCompletionFindings,
} from '../completion/service.js';
import {
  requestWorkAgain,
  respondToWorkAgain,
  listWorkAgainForCreator,
} from '../completion/work-again.js';
import {
  readNextCampaignReadiness,
  recordNextCampaignReadiness,
} from '../completion/next-campaign.js';
import {
  recordSatisfaction,
  addSatisfactionReason,
  backerProgression,
  satisfactionState,
} from '../completion/satisfaction.js';
import { readResolution, resolveCampaign, markFulfilled } from '../completion/resolution.js';

const DAY = 86_400_000;

let h: Harness;
let audit: ReturnType<typeof createAuditWriter>;

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: createMemoryStripeGateway({}) },
    'completion',
  );
  audit = createAuditWriter(h.db);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/** Walks the `cause` chain — Drizzle wraps the driver error (21a's helper). */
async function expectDbRefusal(work: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown;
  try {
    await work();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'expected the database to refuse').toBeDefined();
  const messages: string[] = [];
  let current: unknown = caught;
  while (current instanceof Error) {
    messages.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  expect(messages.join(' | ')).toMatch(pattern);
}

interface Seeded {
  campaignId: string;
  founderUserId: string;
  associationId: string;
  backerIdentityId: string;
  backerEmail: string;
  reservationId: string;
}

/**
 * A campaign that has ENDED with a Creator who did everything right — and
 * deliberately sold nothing (§33.10.6). No captured attributed revenue is
 * written anywhere in this helper.
 */
async function seedCompleted(label: string, overrides: { skip?: string[] } = {}): Promise<Seeded> {
  const skip = new Set(overrides.skip ?? []);
  const founder = await seedUser(h, 'founder', `cm-founder-${label}`);
  const creator = await seedUser(h, 'affiliate', `cm-creator-${label}`);

  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      legalName: `Founder ${label}`,
      preferredName: `F-${label}`,
      email: founder.email,
      productName: `Product ${label}`,
      createdBy: 'admin:test',
      claimedUserId: founder.id,
      claimedAt: new Date(),
    })
    .returning({ id: founderProspects.id });

  const closeAt = new Date(Date.now() - 40 * DAY);
  const [campaign] = await h.db
    .insert(campaigns)
    .values({
      status: 'closed_reconciling',
      type: 'pre_build',
      typeLockedAt: new Date(),
      listingPaidAt: new Date(Date.now() - 90 * DAY),
      campaignLiveAt: new Date(Date.now() - 70 * DAY),
      campaignCloseAt: closeAt,
      orderThreshold: 10,
    })
    .returning({ id: campaigns.id });
  const campaignId = campaign!.id;

  const [draft] = await h.db
    .insert(campaignDrafts)
    .values({ campaignId, prospectId: prospect!.id, status: 'claimed', createdBy: 'admin:test' })
    .returning({ id: campaignDrafts.id });

  await h.db.insert(founderClaimProfiles).values({
    draftId: draft!.id,
    prospectId: prospect!.id,
    campaignId,
    email: founder.email,
    preferredName: `F-${label}`,
    legalName: `Founder ${label}`,
    businessName: `${label} Labs LLC`,
    soleProprietor: false,
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  await h.db.insert(campaignBuild).values({
    campaignId,
    title: `The ${label} Kettle`,
    updatedBy: `user:${founder.id}`,
  });

  const [affiliateProspect] = await h.db
    .insert(affiliateProspects)
    .values({
      legalName: `Creator ${label}`,
      publicHandle: `@creator-${label}`,
      email: creator.email,
      subtype: 'social_creator',
      audienceNiche: 'hardware',
      audienceSize: '120k',
      adminBio: 'Reviews hardware.',
      createdBy: 'admin:test',
    })
    .returning({ id: affiliateProspects.id });

  const [association] = await h.db
    .insert(campaignAffiliateAssociations)
    .values({
      campaignId,
      affiliateId: randomUUID(),
      prospectId: affiliateProspect!.id,
      status: 'active',
      rosterMembership: 'initial_roster',
    })
    .returning({ id: campaignAffiliateAssociations.id });
  const associationId = association!.id;

  await h.db.insert(affiliateSignupProfiles).values({
    associationId,
    prospectId: affiliateProspect!.id,
    email: creator.email,
    publicHandle: `@creator-${label}`,
    claimedUserId: creator.id,
    claimedAt: new Date(),
    updatedBy: 'test',
  });

  /* Criterion 1 — readiness cleared. */
  if (!skip.has('readiness_cleared')) {
    await h.db.insert(associationReadiness).values({
      associationId,
      campaignId,
      rosterDecision: 'included',
      launchRequired: true,
      readinessConfirmedAt: new Date(Date.now() - 65 * DAY),
    });
  }

  /* Criterion 2 — a first post, verified `passed`. */
  if (!skip.has('valid_post_verified')) {
    await h.db.insert(creatorPostSubmissions).values({
      associationId,
      campaignId,
      postUrl: 'https://example.com/post',
      status: 'passed',
      submittedAt: new Date(Date.now() - 68 * DAY),
      submittedBy: `user:${creator.id}`,
      verifiedAt: new Date(Date.now() - 67 * DAY),
      verifiedBy: 'admin:test',
    });
  }

  /* Criterion 3 — deliverables verified (§22.1). */
  let decisionId: string | null = null;
  if (!skip.has('deliverables_resolved')) {
    const [decision] = await h.db
      .insert(creatorCompletionDecisions)
      .values({
        associationId,
        campaignId,
        outcome: 'complete_verified',
        deliverablesNote: 'All three posts verified against the agreed schedule.',
        decidedBy: 'admin:test',
      })
      .returning({ id: creatorCompletionDecisions.id });
    decisionId = decision!.id;
  }

  /*
   * Criterion 5 — earnings finalized. AT ZERO: this Creator sold nothing.
   * §33.10.6 is exactly this row, and it is the whole point of the helper.
   */
  /*
   * 19a makes `completion_decision_id` NOT NULL: earnings cannot be finalized
   * without the §22.1 decision that authorised them. So skipping criterion 3
   * necessarily skips criterion 5 too, and that is the product's own ordering
   * rather than a shortcut — the per-criterion test asserts the named
   * criterion is among the unmet ones, not that it is the only one.
   */
  if (!skip.has('money_resolved') && decisionId !== null) {
    await h.db.insert(creatorEarnings).values({
      associationId,
      campaignId,
      completionDecisionId: decisionId,
      state: 'finalized',
      // Every money column at zero. The §24.4 identity
      // (earned + returned = provisional) holds trivially at 0 + 0 = 0, which
      // is exactly the shape §33.10.6 is about: a resolved fact, not a
      // missing one.
      validSubtotalCents: 0n,
      attributedUniqueBackers: 0,
      lockedTotalPercent: 20,
      earnedPercent: 20,
      commissionCents: 0n,
      bonusCents: 0n,
      eligibleFixedCents: 0n,
      provisionalTotalCents: 0n,
      earnedTotalCents: 0n,
      unearnedReturnedCents: 0n,
      finalizedBy: 'admin:test',
      finalizedAt: new Date(Date.now() - 20 * DAY),
    });
  }

  const backerEmail = `cm-backer-${label}@example.com`;
  const [identity] = await h.db
    .insert(backerIdentities)
    .values({
      campaignId,
      email: backerEmail,
      phone: '+15555550177',
      emailNormalized: backerEmail,
      phoneNormalized: '+15555550177',
      dedupKey: randomUUID(),
    })
    .returning({ id: backerIdentities.id });

  const [reservation] = await h.db
    .insert(reservations)
    .values({
      campaignId,
      backerIdentityId: identity!.id,
      status: 'captured',
      quantity: 1,
      unitPriceCents: 9900n,
      subtotalCents: 9900n,
      taxCents: 0n,
      totalAuthorizedCents: 9900n,
    })
    .returning({ id: reservations.id });

  return {
    campaignId,
    founderUserId: founder.id,
    associationId,
    backerIdentityId: identity!.id,
    backerEmail,
    reservationId: reservation!.id,
  };
}

/* ── Drift ────────────────────────────────────────────────────────────────── */

describe('the backend restatement matches the shared register', () => {
  it('agrees on the five §22.8 criteria, in order', () => {
    expect(COMPLETION_CRITERIA.map((c) => [c.key, c.spec])).toEqual(
      SHARED_CRITERIA.map((c) => [c.key, c.spec]),
    );
    expect(COMPLETION_CRITERIA).toHaveLength(5);
  });

  it('agrees on the two §22.10 gates, the five §22.11 areas, and the prohibitions', () => {
    expect(NEXT_CAMPAIGN_GATES.map((g) => g.key)).toEqual(SHARED_GATES.map((g) => g.key));
    expect(RESOLUTION_AREAS.map((a) => [a.key, [...a.reconciliationItems]])).toEqual(
      SHARED_AREAS.map((a) => [a.key, [...a.reconciliationItems]]),
    );
    expect(SATISFACTION_PROHIBITIONS.map((p) => p.key)).toEqual(
      SHARED_PROHIBITIONS.map((p) => p.key),
    );
  });

  it('agrees on the pinned sentences, verbatim', () => {
    expect(WORK_AGAIN_NO_PENALTY).toBe(SHARED_NO_PENALTY);
    expect([...WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING]).toEqual([...SHARED_GRANTS_NOTHING]);
    expect(RESOLUTION_IS_NOT_FULFILLMENT).toBe(SHARED_NOT_FULFILLMENT);
  });

  it('agrees on the cooldown kernel across month lengths', () => {
    for (const iso of [
      '2026-01-31T12:00:00.000Z',
      '2026-02-28T00:00:00.000Z',
      '2026-11-30T23:59:00.000Z',
      '2026-12-15T08:00:00.000Z',
    ]) {
      const closed = new Date(iso);
      expect(nextCampaignEarliestAt(closed, 3).toISOString()).toBe(
        sharedEarliestAt(closed, 3).toISOString(),
      );
    }
  });

  it('clamps to the end of a short month rather than rolling forward', () => {
    // 31 January + 3 months is 30 April, not 1 May. A cooldown that silently
    // gained a day would be a §29.6 deadline moving on its own.
    expect(nextCampaignEarliestAt(new Date('2026-01-31T00:00:00.000Z'), 3).toISOString()).toBe(
      '2026-04-30T00:00:00.000Z',
    );
  });
});

/* ── §33.10.5 / §33.10.6 completion ───────────────────────────────────────── */

describe('§33.10.5 — successfully_completed requires all five criteria', () => {
  it('completes a Creator who met every one, with the findings stored as evidence', async () => {
    const s = await seedCompleted('c1');

    const findings = await gatherCompletionFindings(h.db, s.associationId);
    expect(findings.map((f) => f.key)).toEqual(COMPLETION_CRITERION_KEYS);
    expect(completionEligible(findings)).toBe(true);

    const result = await assignCompletionStatus(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        status: 'successfully_completed',
        decidedBy: 'admin:test',
        evidenceNote: 'Three posts verified, disclosure present on each, no open cases.',
      },
    );
    expect(result.ok).toBe(true);

    const [row] = await h.db
      .select()
      .from(creatorCompletionStatuses)
      .where(eq(creatorCompletionStatuses.associationId, s.associationId));
    expect(row!.status).toBe('successfully_completed');
    expect(row!.decidedBy).toBe('admin:test');
    // §22.8: "Store status, completion date, Admin, evidence…" — the findings
    // as evaluated, so a later record change cannot rewrite the justification.
    expect(Array.isArray(row!.criteriaFindings)).toBe(true);
    expect((row!.criteriaFindings as Array<{ key: string }>).map((f) => f.key)).toEqual(
      COMPLETION_CRITERION_KEYS,
    );
    expect(row!.disqualifyingReason).toBeNull();

    // §23.4: the association moved to its own completion state.
    const [assoc] = await h.db
      .select({ status: campaignAffiliateAssociations.status })
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.id, s.associationId));
    expect(assoc!.status).toBe('successfully_completed');
  });

  it('refuses each missing criterion by name, one at a time', async () => {
    // Every criterion, alone, blocks. Walked rather than spot-checked, because
    // "all five" is the assertion and a dropped clause would pass a spot check.
    for (const criterion of COMPLETION_CRITERION_KEYS) {
      const s = await seedCompleted(`miss-${criterion}`, { skip: [criterion] });

      /*
       * §22.8.4 is an ABSENCE criterion — "no unresolved case exists" — so
       * omitting a seed cannot break it. It is broken by adding the thing it
       * forbids, which is also the shape the criterion actually has in
       * production: a Creator who was paused mid-campaign.
       */
      if (criterion === 'no_unresolved_case') {
        await h.db.insert(affiliateEnforcementActions).values({
          associationId: s.associationId,
          campaignId: s.campaignId,
          actionKind: 'pause',
          reasonCategory: 'deceptive_promotion',
          internalReason: 'Two posts carried the tracking link with no §29.1 disclosure.',
          evidenceAndBehavior: 'Screenshots captured 12 July, archived on the case.',
          ruleViolated: 'Every post carrying your tracking link must carry the disclosure.',
          immediateEffect: 'Your tracking link is paused while we review.',
          correctionPath: 'Add the disclosure to both posts and reply to this message.',
          humanRoute: 'Reply to this message and a person will answer within one business day.',
          appealDueAt: new Date(Date.now() + 5 * DAY),
          calendarVersion: 'us-federal.v1',
          priorAssociationStatus: 'active',
          newAssociationStatus: 'paused',
          actor: 'admin:test',
          mfaContext: 'password_session_admin_role_verified',
          reauthContext: 'fresh',
        });
      }

      const result = await assignCompletionStatus(
        { db: h.db, audit },
        {
          associationId: s.associationId,
          status: 'successfully_completed',
          decidedBy: 'admin:test',
          evidenceNote: 'Attempting completion.',
        },
      );
      expect(result.ok, `${criterion} should block completion`).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe('criteria_not_met');
      expect(result.unmet?.map((u) => u.key)).toContain(criterion);
      // §27.1: the refusal says what is missing, in words, not a table name.
      expect(result.unmet?.find((u) => u.key === criterion)?.detail).not.toBe('');
    }
  });

  it('records a disqualification WITH its reason, and refuses one without', async () => {
    const s = await seedCompleted('c2', { skip: ['valid_post_verified'] });

    const noReason = await assignCompletionStatus(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        status: 'completion_disqualified',
        decidedBy: 'admin:test',
        evidenceNote: 'No post was ever submitted.',
      },
    );
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.code).toBe('reason_required');

    const withReason = await assignCompletionStatus(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        status: 'completion_disqualified',
        decidedBy: 'admin:test',
        evidenceNote: 'Checked on 3 August; nothing submitted.',
        disqualifyingReason:
          'No promotional post was submitted for verification at any point during the campaign.',
      },
    );
    expect(withReason.ok).toBe(true);
  });

  it('refuses a completion carrying a disqualifying reason, at the database', async () => {
    const s = await seedCompleted('c3');
    await expectDbRefusal(
      () =>
        h.db.insert(creatorCompletionStatuses).values({
          associationId: s.associationId,
          campaignId: s.campaignId,
          status: 'successfully_completed',
          decidedBy: 'admin:test',
          criteriaFindings: [],
          evidenceNote: 'x',
          disqualifyingReason: 'a reason on a completion',
        }),
      /completion_reason_matches_status/i,
    );
  });

  it('refuses a completion decision that a support script tries to edit', async () => {
    const s = await seedCompleted('c4');
    await assignCompletionStatus(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        status: 'successfully_completed',
        decidedBy: 'admin:test',
        evidenceNote: 'Everything verified.',
      },
    );
    await expectDbRefusal(
      () =>
        h.db
          .update(creatorCompletionStatuses)
          .set({ status: 'completion_disqualified' })
          .where(eq(creatorCompletionStatuses.associationId, s.associationId)),
      /immutable|record a correction/i,
    );
  });

  it('§22.9 — a correction supersedes and keeps the history', async () => {
    const s = await seedCompleted('c5');
    const first = await assignCompletionStatus(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        status: 'successfully_completed',
        decidedBy: 'admin:test',
        evidenceNote: 'Everything verified.',
      },
    );
    expect(first.ok).toBe(true);

    const corrected = await correctCompletionStatus(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        status: 'completion_disqualified',
        decidedBy: 'admin:test',
        evidenceNote: 'A later review found the post had been deleted.',
        disqualifyingReason: 'The verified promotional post was removed before the campaign closed.',
      },
    );
    expect(corrected.ok).toBe(true);

    const rows = await h.db
      .select()
      .from(creatorCompletionStatuses)
      .where(eq(creatorCompletionStatuses.associationId, s.associationId));
    // Both survive. §22.9: "without deleting history."
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.supersededAt === null)).toHaveLength(1);
    expect(rows.filter((r) => r.supersededAt !== null)).toHaveLength(1);
  });
});

describe('§33.10.6 — zero sales does not block completion', () => {
  it('completes a Creator whose campaign produced no attributed revenue at all', async () => {
    const s = await seedCompleted('zero');

    // The premise, asserted rather than assumed: nothing was earned and there
    // is no captured attributed revenue behind this association.
    const [earnings] = await h.db
      .select({ earned: creatorEarnings.earnedTotalCents, provisional: creatorEarnings.provisionalTotalCents })
      .from(creatorEarnings)
      .where(eq(creatorEarnings.associationId, s.associationId));
    expect(earnings!.earned).toBe(0n);
    expect(earnings!.provisional).toBe(0n);

    const result = await assignCompletionStatus(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        status: 'successfully_completed',
        decidedBy: 'admin:test',
        evidenceNote: 'Every agreed deliverable was posted and verified. No sales resulted.',
      },
    );
    expect(result.ok).toBe(true);
  });

  it('has no sales term in the criteria register at all', () => {
    // The structural half. A criterion mentioning revenue would be one a later
    // phase could quietly start enforcing (the phase trap).
    const text = JSON.stringify(COMPLETION_CRITERIA).toLowerCase();
    for (const banned of ['sales', 'revenue', 'conversion', 'performance']) {
      expect(text).not.toContain(banned);
    }
  });
});

/* ── §33.10.7 / §33.10.8 work-again ───────────────────────────────────────── */

describe('§33.10.7 — only an eligible completed Creator can be asked', () => {
  async function completed(label: string): Promise<Seeded> {
    const s = await seedCompleted(label);
    await assignCompletionStatus(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        status: 'successfully_completed',
        decidedBy: 'admin:test',
        evidenceNote: 'Everything verified.',
      },
    );
    return s;
  }

  it('allows a request to a successfully completed Creator', async () => {
    const s = await completed('w1');
    const result = await requestWorkAgain(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        founderUserId: s.founderUserId,
        message: 'We are building a travel version and would love you on it.',
      },
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a Creator with no completion decision, and one who was disqualified', async () => {
    const undecided = await seedCompleted('w2');
    const first = await requestWorkAgain(
      { db: h.db, audit },
      {
        associationId: undecided.associationId,
        founderUserId: undecided.founderUserId,
        message: 'Work with us again?',
      },
    );
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.code).toBe('not_completed');

    const disqualified = await seedCompleted('w3', { skip: ['valid_post_verified'] });
    await assignCompletionStatus(
      { db: h.db, audit },
      {
        associationId: disqualified.associationId,
        status: 'completion_disqualified',
        decidedBy: 'admin:test',
        evidenceNote: 'Nothing submitted.',
        disqualifyingReason: 'No promotional post was ever submitted for verification.',
      },
    );
    const second = await requestWorkAgain(
      { db: h.db, audit },
      {
        associationId: disqualified.associationId,
        founderUserId: disqualified.founderUserId,
        message: 'Work with us again?',
      },
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('not_completed');
  });

  it('refuses a hand-written INSERT against a disqualified Creator, at the database', async () => {
    const s = await seedCompleted('w4', { skip: ['valid_post_verified'] });
    await assignCompletionStatus(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        status: 'completion_disqualified',
        decidedBy: 'admin:test',
        evidenceNote: 'Nothing submitted.',
        disqualifyingReason: 'No promotional post was ever submitted for verification.',
      },
    );
    const [status] = await h.db
      .select({ id: creatorCompletionStatuses.id })
      .from(creatorCompletionStatuses)
      .where(eq(creatorCompletionStatuses.associationId, s.associationId));

    await expectDbRefusal(
      () =>
        h.db.insert(workAgainRequests).values({
          originalCampaignId: s.campaignId,
          associationId: s.associationId,
          founderUserId: s.founderUserId,
          message: 'bypassing the service',
          completionStatusId: status!.id,
        }),
      /only a Creator marked successfully_completed/i,
    );
  });

  it('cannot cite a superseded completion status', async () => {
    const s = await completed('w5');
    const [original] = await h.db
      .select({ id: creatorCompletionStatuses.id })
      .from(creatorCompletionStatuses)
      .where(eq(creatorCompletionStatuses.associationId, s.associationId));

    await correctCompletionStatus(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        status: 'completion_disqualified',
        decidedBy: 'admin:test',
        evidenceNote: 'Later review.',
        disqualifyingReason: 'The verified post was removed before the campaign closed.',
      },
    );

    await expectDbRefusal(
      () =>
        h.db.insert(workAgainRequests).values({
          originalCampaignId: s.campaignId,
          associationId: s.associationId,
          founderUserId: s.founderUserId,
          message: 'citing the old status',
          completionStatusId: original!.id,
        }),
      /superseded/i,
    );
  });
});

describe('§33.10.8 — accept/decline creates nothing and bypasses nothing', () => {
  it('changes no campaign, no readiness record, and no cooldown', async () => {
    const s = await seedCompleted('a1');
    await assignCompletionStatus(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        status: 'successfully_completed',
        decidedBy: 'admin:test',
        evidenceNote: 'Everything verified.',
      },
    );
    const requested = await requestWorkAgain(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        founderUserId: s.founderUserId,
        message: 'Work with us again?',
      },
    );
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;

    const campaignsBefore = await h.db.select().from(campaigns);
    const [campaignBefore] = await h.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, s.campaignId));
    const beforeView = await readNextCampaignReadiness(h.db, s.campaignId);

    const accepted = await respondToWorkAgain(
      { db: h.db, audit },
      { requestId: requested.requestId, accept: true, actor: 'user:creator' },
    );
    expect(accepted.ok).toBe(true);

    // No campaign was created — the count is unchanged.
    const campaignsAfter = await h.db.select().from(campaigns);
    expect(campaignsAfter).toHaveLength(campaignsBefore.length);

    // The campaign itself is byte-identical.
    const [campaignAfter] = await h.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, s.campaignId));
    expect(campaignAfter).toEqual(campaignBefore);

    // No readiness decision appeared, and the cooldown did not move.
    const readinessRows = await h.db
      .select()
      .from(founderNextCampaignReadiness)
      .where(eq(founderNextCampaignReadiness.campaignId, s.campaignId));
    expect(readinessRows).toHaveLength(0);

    const afterView = await readNextCampaignReadiness(h.db, s.campaignId);
    expect(afterView.cooldown.earliestAt).toBe(beforeView.cooldown.earliestAt);
    expect(afterView.adminReadiness.decision).toBeNull();
    expect(afterView.readyForNextCampaign).toBe(false);
  });

  it('declines without penalty, and the completion status is untouched', async () => {
    const s = await seedCompleted('a2');
    await assignCompletionStatus(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        status: 'successfully_completed',
        decidedBy: 'admin:test',
        evidenceNote: 'Everything verified.',
      },
    );
    const [before] = await h.db
      .select()
      .from(creatorCompletionStatuses)
      .where(eq(creatorCompletionStatuses.associationId, s.associationId));

    const requested = await requestWorkAgain(
      { db: h.db, audit },
      { associationId: s.associationId, founderUserId: s.founderUserId, message: 'Again?' },
    );
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;

    await respondToWorkAgain(
      { db: h.db, audit },
      { requestId: requested.requestId, accept: false, actor: 'user:creator' },
    );

    const [after] = await h.db
      .select()
      .from(creatorCompletionStatuses)
      .where(eq(creatorCompletionStatuses.associationId, s.associationId));
    expect(after).toEqual(before);

    const requests = await listWorkAgainForCreator(h.db, s.associationId);
    expect(requests[0]!.status).toBe('declined');
  });

  it('cannot be answered twice, and the answer is final', async () => {
    const s = await seedCompleted('a3');
    await assignCompletionStatus(
      { db: h.db, audit },
      {
        associationId: s.associationId,
        status: 'successfully_completed',
        decidedBy: 'admin:test',
        evidenceNote: 'Everything verified.',
      },
    );
    const requested = await requestWorkAgain(
      { db: h.db, audit },
      { associationId: s.associationId, founderUserId: s.founderUserId, message: 'Again?' },
    );
    if (!requested.ok) throw new Error('unreachable');

    await respondToWorkAgain(
      { db: h.db, audit },
      { requestId: requested.requestId, accept: false, actor: 'user:creator' },
    );
    const second = await respondToWorkAgain(
      { db: h.db, audit },
      { requestId: requested.requestId, accept: true, actor: 'user:creator' },
    );
    expect(second.ok).toBe(false);

    await expectDbRefusal(
      () =>
        h.db
          .update(workAgainRequests)
          .set({ status: 'accepted' })
          .where(eq(workAgainRequests.id, requested.requestId)),
      /already answered/i,
    );
  });

  it('has no column a campaign could be built from', async () => {
    const { rows } = await h.pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'work_again_requests'`,
    );
    const columns = rows.map((r) => r.column_name);
    // §33.10.8's structural half: nothing here is terms, money, or a campaign
    // to create. The absence is what makes "creates no campaign" true.
    for (const forbidden of [
      'campaign_type',
      'bid_total_percent',
      'total_percent',
      'fixed_payment_cents',
      'amount_cents',
      'new_campaign_id',
      'cooldown_waived',
      'readiness_granted',
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });
});

/* ── §33.10.9 the two gates ───────────────────────────────────────────────── */

describe('§33.10.9 — the exact cooldown date AND a separate readiness decision', () => {
  it('shows both, and neither alone makes the Founder ready', async () => {
    const s = await seedCompleted('g1');

    const view = await readNextCampaignReadiness(h.db, s.campaignId);

    // The exact date, computed from `campaign_close_at` and the §6 setting.
    expect(view.cooldown.months).toBe(3);
    expect(view.cooldown.earliestAt).not.toBeNull();
    const [closed] = await h.db
      .select({ closeAt: campaigns.campaignCloseAt })
      .from(campaigns)
      .where(eq(campaigns.id, s.campaignId));
    expect(view.cooldown.earliestAt).toBe(
      nextCampaignEarliestAt(closed!.closeAt!, 3).toISOString(),
    );

    // Both gates are present as separate facts.
    expect(view.cooldown.key).toBe('cooldown');
    expect(view.adminReadiness.key).toBe('admin_readiness');

    // 40 days after close, the cooldown has NOT elapsed and there is no decision.
    expect(view.cooldown.elapsed).toBe(false);
    expect(view.adminReadiness.decision).toBeNull();
    expect(view.readyForNextCampaign).toBe(false);
  });

  it('an Admin approval alone does not make the Founder ready', async () => {
    const s = await seedCompleted('g2');
    const decided = await recordNextCampaignReadiness(
      { db: h.db, audit },
      {
        campaignId: s.campaignId,
        decision: 'ready',
        decidedBy: 'admin:test',
        criteriaNote: 'Delivered on time; Day 14 passed with evidence.',
        customerExplanation: 'You delivered on time and answered the Day 14 check with evidence.',
      },
    );
    expect(decided.ok).toBe(true);

    const view = await readNextCampaignReadiness(h.db, s.campaignId);
    expect(view.adminReadiness.decision).toBe('ready');
    // The trap: meeting one gate grants nothing.
    expect(view.cooldown.elapsed).toBe(false);
    expect(view.readyForNextCampaign).toBe(false);
  });

  it('an elapsed cooldown alone does not make the Founder ready', async () => {
    const s = await seedCompleted('g3');
    // Read at a time past the cooldown, rather than editing the anchor —
    // §29.6's rule, and 18b's: tests move time, not the stored instant.
    const [closed] = await h.db
      .select({ closeAt: campaigns.campaignCloseAt })
      .from(campaigns)
      .where(eq(campaigns.id, s.campaignId));
    const past = new Date(nextCampaignEarliestAt(closed!.closeAt!, 3).getTime() + DAY);

    const view = await readNextCampaignReadiness(h.db, s.campaignId, past);
    expect(view.cooldown.elapsed).toBe(true);
    expect(view.adminReadiness.decision).toBeNull();
    expect(view.readyForNextCampaign).toBe(false);
    expect(cooldownElapsed(closed!.closeAt!, 3, past)).toBe(true);
  });

  it('is ready only with BOTH', async () => {
    const s = await seedCompleted('g4');
    await recordNextCampaignReadiness(
      { db: h.db, audit },
      {
        campaignId: s.campaignId,
        decision: 'ready',
        decidedBy: 'admin:test',
        criteriaNote: 'Everything in order.',
        customerExplanation: 'You are approved for a next campaign.',
      },
    );
    const [closed] = await h.db
      .select({ closeAt: campaigns.campaignCloseAt })
      .from(campaigns)
      .where(eq(campaigns.id, s.campaignId));
    const past = new Date(nextCampaignEarliestAt(closed!.closeAt!, 3).getTime() + DAY);

    const view = await readNextCampaignReadiness(h.db, s.campaignId, past);
    expect(view.readyForNextCampaign).toBe(true);
    // And the promise about what this page is stays on it.
    expect(view.prepareNote).toContain('Nothing here opens a new campaign');
  });

  it('records no stored cooldown date anywhere (§29.6)', async () => {
    const { rows } = await h.pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'founder_next_campaign_readiness'`,
    );
    const columns = rows.map((r) => r.column_name);
    for (const forbidden of ['cooldown_ends_at', 'earliest_request_at', 'cooldown_months']) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('a later decision supersedes and the earlier one survives', async () => {
    const s = await seedCompleted('g5');
    await recordNextCampaignReadiness(
      { db: h.db, audit },
      {
        campaignId: s.campaignId,
        decision: 'not_ready',
        decidedBy: 'admin:test',
        criteriaNote: 'Two Backer questions still open.',
        customerExplanation: 'Two Backers are still waiting on answers about delivery.',
      },
    );
    await recordNextCampaignReadiness(
      { db: h.db, audit },
      {
        campaignId: s.campaignId,
        decision: 'ready',
        decidedBy: 'admin:test',
        criteriaNote: 'Both questions answered.',
        customerExplanation: 'Both open questions have been resolved.',
      },
    );
    const rows = await h.db
      .select()
      .from(founderNextCampaignReadiness)
      .where(eq(founderNextCampaignReadiness.campaignId, s.campaignId));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.supersededAt === null)).toHaveLength(1);
  });
});

/* ── §33.10.10 satisfaction ───────────────────────────────────────────────── */

describe('§33.10.10 — one click, and a negative result owns a follow-up', () => {
  async function delivered(label: string): Promise<Seeded> {
    const s = await seedCompleted(label);
    await h.db.insert(campaignFulfillment).values({
      campaignId: s.campaignId,
      mechanism: 'download_link',
      deliveryNotifiedAt: new Date(Date.now() - DAY),
      updatedBy: 'admin:test',
    });
    return s;
  }

  it('records a positive answer in one call, with nothing required first', async () => {
    const s = await delivered('s1');

    const before = await satisfactionState(h.db, s.reservationId);
    expect(before.askable).toBe(true);
    expect(before.answered).toBe(false);

    // SATISFACTION_CLICKS_TO_ANSWER is 1, and this is that one call. There is
    // no consent to give, no field to fill, and no prior step.
    expect(SATISFACTION_CLICKS_TO_ANSWER).toBe(1);
    const result = await recordSatisfaction(
      { db: h.db, audit },
      { reservationId: s.reservationId, scale: 'binary', satisfied: true, actor: 'backer:test' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.negative).toBe(false);
    expect(result.followupCaseId).toBeNull();

    // §31.8: the reason is optional and follows the answer.
    const [row] = await h.db
      .select()
      .from(backerSatisfactionResponses)
      .where(eq(backerSatisfactionResponses.reservationId, s.reservationId));
    expect(row!.reason).toBeNull();
    await addSatisfactionReason(
      { db: h.db, audit },
      { reservationId: s.reservationId, reason: 'Arrived early and worked first time.', actor: 'backer:test' },
    );
    const [withReason] = await h.db
      .select({ reason: backerSatisfactionResponses.reason })
      .from(backerSatisfactionResponses)
      .where(eq(backerSatisfactionResponses.reservationId, s.reservationId));
    expect(withReason!.reason).toContain('Arrived early');
  });

  it('a negative answer creates exactly ONE owned Admin case', async () => {
    const s = await delivered('s2');
    const result = await recordSatisfaction(
      { db: h.db, audit },
      { reservationId: s.reservationId, scale: 'binary', satisfied: false, actor: 'backer:test' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.negative).toBe(true);
    expect(result.followupCaseId).not.toBeNull();

    const cases = await h.db
      .select()
      .from(supportCases)
      .where(
        and(
          eq(supportCases.campaignId, s.campaignId),
          eq(supportCases.topic, 'dissatisfaction_followup'),
        ),
      );
    // ONE. §31.8 says "an owned Admin follow-up task", singular.
    expect(cases).toHaveLength(1);
    // Owned, with a stable reference and a due time — 16b's machinery, not a
    // second kind of task.
    expect(cases[0]!.owner).toBe('proovd_support');
    expect(cases[0]!.reference).toMatch(/^PVD-/);
    expect(cases[0]!.humanResponseDueAt).toBeInstanceOf(Date);
  });

  it('treats 1 and 2 as negative and 3 upward as not, on the 1–5 scale', async () => {
    expect(satisfactionIsNegative({ scale: 'rating_1_5', rating: 1 })).toBe(true);
    expect(satisfactionIsNegative({ scale: 'rating_1_5', rating: 2 })).toBe(true);
    // 3 is neutral. A follow-up on a shrug trains people to stop answering.
    expect(satisfactionIsNegative({ scale: 'rating_1_5', rating: 3 })).toBe(false);
    expect(satisfactionIsNegative({ scale: 'rating_1_5', rating: 5 })).toBe(false);

    const s = await delivered('s3');
    const neutral = await recordSatisfaction(
      { db: h.db, audit },
      { reservationId: s.reservationId, scale: 'rating_1_5', rating: 3, actor: 'backer:test' },
    );
    expect(neutral.ok).toBe(true);
    if (!neutral.ok) return;
    expect(neutral.followupCaseId).toBeNull();
  });

  it('never asks a second time (§30)', async () => {
    const s = await delivered('s4');
    await recordSatisfaction(
      { db: h.db, audit },
      { reservationId: s.reservationId, scale: 'binary', satisfied: true, actor: 'backer:test' },
    );
    const again = await recordSatisfaction(
      { db: h.db, audit },
      { reservationId: s.reservationId, scale: 'binary', satisfied: false, actor: 'backer:test' },
    );
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('already_answered');

    const state = await satisfactionState(h.db, s.reservationId);
    expect(state.askable).toBe(false);
    expect(state.answered).toBe(true);

    // And the database refuses a second row regardless of the service.
    await expectDbRefusal(
      () =>
        h.db.insert(backerSatisfactionResponses).values({
          reservationId: s.reservationId,
          campaignId: s.campaignId,
          backerIdentityId: s.backerIdentityId,
          scale: 'binary',
          satisfied: false,
          isNegative: false,
        }),
      /satisfaction_one_per_reservation_idx|duplicate key/i,
    );
  });

  it('refuses before anything has been delivered', async () => {
    const s = await seedCompleted('s5');
    const result = await recordSatisfaction(
      { db: h.db, audit },
      { reservationId: s.reservationId, scale: 'binary', satisfied: true, actor: 'backer:test' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_delivered');
  });

  it('has nowhere to record a newsletter consent (§31.8)', async () => {
    const { rows } = await h.pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'backer_satisfaction_responses'`,
    );
    const columns = rows.map((r) => r.column_name).join(' ');
    for (const banned of ['newsletter', 'marketing', 'consent', 'subscribe', 'opt_in']) {
      expect(columns).not.toContain(banned);
    }
  });

  it('the answer is immutable; only the reason may follow', async () => {
    const s = await delivered('s6');
    await recordSatisfaction(
      { db: h.db, audit },
      { reservationId: s.reservationId, scale: 'binary', satisfied: true, actor: 'backer:test' },
    );
    await expectDbRefusal(
      () =>
        h.db
          .update(backerSatisfactionResponses)
          .set({ satisfied: false })
          .where(eq(backerSatisfactionResponses.reservationId, s.reservationId)),
      /recorded once/i,
    );
  });
});

describe('§31.8 — the progression is derived and never predicts', () => {
  it('shows only steps a stored record supports', async () => {
    const s = await seedCompleted('p1');
    const captured = await backerProgression(h.db, s.reservationId);
    const keys = captured.map((step) => step.key);

    // Captured, with a delivery owed and not yet made.
    expect(keys).toContain('captured');
    expect(keys).toContain('delivery_due');
    // Not delivered — nothing says so.
    expect(keys).not.toContain('delivered');
    // And no outcome is shown ahead of time: §31.8's own rule.
    expect(keys).not.toContain('failed');
    expect(keys).not.toContain('refunded');
    expect(keys).not.toContain('no_charge');
    expect(captured.at(-1)!.state).toBe('current');
  });

  it('shows the outcome that happened, and only that one', async () => {
    const s = await seedCompleted('p2');
    await h.db
      .update(reservations)
      .set({ status: 'threshold_not_met_no_charge' })
      .where(eq(reservations.id, s.reservationId));

    const keys = (await backerProgression(h.db, s.reservationId)).map((step) => step.key);
    expect(keys).toContain('no_charge');
    expect(keys).not.toContain('failed');
    expect(keys).not.toContain('refunded');
    expect(keys).not.toContain('delivered');
  });
});

/* ── §22.11 resolution, and the state it is not ───────────────────────────── */

describe('§22.11 — closed_resolved and fulfilled are independent', () => {
  const REQUIRED = [
    'batch_completeness',
    'tax_charge_reconciliation',
    'attribution_post_verification',
    'creator_deliverables',
    'creator_bonus_triggers',
    'provisional_vs_earned',
    'unearned_return',
    'founder_share_w9',
    'refund_risk_dispute',
  ];

  async function verifyAll(campaignId: string, items = REQUIRED): Promise<void> {
    for (const itemKey of items) {
      await h.db.insert(campaignReconciliations).values({
        campaignId,
        itemKey,
        result: 'verified',
        note: `Checked ${itemKey}.`,
        actor: 'admin:test',
      });
    }
  }

  it('refuses resolution while any §22.11 area is outstanding, naming the areas', async () => {
    const s = await seedCompleted('r1');
    await verifyAll(s.campaignId, ['batch_completeness', 'tax_charge_reconciliation']);

    const view = await readResolution(h.db, s.campaignId);
    expect(view.complete).toBe(false);
    expect(view.areas.find((a) => a.key === 'charge_retry')!.complete).toBe(true);
    expect(view.areas.find((a) => a.key === 'founder_payment')!.complete).toBe(false);

    const result = await resolveCampaign(
      { db: h.db, audit },
      { campaignId: s.campaignId, resolvedBy: 'admin:test', note: 'Trying early.' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not_reconciled');
      expect(result.unresolved).toContain('founder_payment');
      expect(result.unresolved).not.toContain('charge_retry');
    }
  });

  it('resolves once every area reconciles, and records that fulfillment was still active', async () => {
    const s = await seedCompleted('r2');
    // A delivery is owed and not made: fulfillment is active.
    await h.db.insert(campaignFulfillment).values({
      campaignId: s.campaignId,
      mechanism: 'download_link',
      updatedBy: 'admin:test',
    });
    await verifyAll(s.campaignId);

    const result = await resolveCampaign(
      { db: h.db, audit },
      {
        campaignId: s.campaignId,
        resolvedBy: 'admin:test',
        note: 'Every §21 item verified; the money reconciles.',
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The whole point: money reconciled, product not shipped.
    expect(result.fulfillmentActive).toBe(true);

    const [row] = await h.db
      .select()
      .from(campaignResolutions)
      .where(eq(campaignResolutions.campaignId, s.campaignId));
    expect(row!.fulfillmentActive).toBe(true);

    const [campaign] = await h.db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, s.campaignId));
    expect(campaign!.status).toBe('closed_resolved');

    // And the read says so in the pinned words.
    const view = await readResolution(h.db, s.campaignId);
    expect(view.fulfillment.active).toBe(true);
    expect(view.fulfillment.note).toBe(RESOLUTION_IS_NOT_FULFILLMENT);
  });

  it('marks fulfilled without any regard for whether the money reconciled', async () => {
    const s = await seedCompleted('r3');
    await h.db.insert(campaignFulfillment).values({
      campaignId: s.campaignId,
      mechanism: 'download_link',
      // 0034's CHECKs: a delivery needs its mechanism AND access instructions
      // AND who delivered it, and a campaign cannot be fulfilled without one.
      // Access granted, then Backers notified, then fulfilled — §22.5's order.
      accessInstructions: 'Sign in at kettle.example and your download is on the account page.',
      deliveredAt: new Date(Date.now() - 3 * DAY),
      deliveredBy: 'admin:test',
      deliveryNotifiedAt: new Date(Date.now() - 2 * DAY),
      fulfilledAt: new Date(Date.now() - DAY),
      updatedBy: 'admin:test',
    });

    // Nothing reconciled at all.
    const view = await readResolution(h.db, s.campaignId);
    expect(view.complete).toBe(false);

    const result = await markFulfilled(
      { db: h.db, audit },
      { campaignId: s.campaignId, actor: 'admin:test' },
    );
    expect(result.ok).toBe(true);
    expect(result.moved).toBe(true);

    const [campaign] = await h.db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, s.campaignId));
    // A shipped product is shipped, whatever the money is doing.
    expect(campaign!.status).toBe('fulfilled');
  });

  it('the resolution kernel is a conjunction over §21s register', () => {
    expect(resolutionComplete(REQUIRED)).toBe(true);
    expect(resolutionComplete(REQUIRED.filter((i) => i !== 'founder_share_w9'))).toBe(false);
    expect(unresolvedAreas(REQUIRED)).toEqual([]);
    expect(unresolvedAreas([])).toEqual(RESOLUTION_AREAS.map((a) => a.key));
  });

  it('resolves exactly once', async () => {
    const s = await seedCompleted('r4');
    await verifyAll(s.campaignId);
    await resolveCampaign(
      { db: h.db, audit },
      { campaignId: s.campaignId, resolvedBy: 'admin:test', note: 'Done.' },
    );
    const second = await resolveCampaign(
      { db: h.db, audit },
      { campaignId: s.campaignId, resolvedBy: 'admin:test', note: 'Again.' },
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('already_resolved');
  });

  it('the resolution record is insert-only for the app role (§25.6)', async () => {
    /*
     * Asserted as a GRANT rather than by attempting an UPDATE: the suite
     * connects as the migrating role, which owns the table and is not subject
     * to its own REVOKE. What production runs as is `proovd_app`, so what is
     * worth asserting is what `proovd_app` may do — the same reasoning the
     * audit-table guarantees rest on.
     */
    const { rows } = await h.pool.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where grantee = 'proovd_app' and table_name = 'campaign_resolutions'`,
    );
    const granted = rows.map((r) => r.privilege_type);
    expect(granted).toContain('SELECT');
    expect(granted).toContain('INSERT');
    expect(granted).not.toContain('UPDATE');
    expect(granted).not.toContain('DELETE');
  });
});

/* ── The register is now empty of everything but §1 rule 6 decisions ──────── */

describe('§27 coverage after Phase 21b', () => {
  it('leaves only the three keys the Spec itself rules out', async () => {
    const { UNSENT_NOTIFICATION_EVENTS } = await import('../notifications/unsent.js');
    const entries = Object.values(UNSENT_NOTIFICATION_EVENTS);
    expect(entries).toHaveLength(3);
    // No `message` and no `capability`: every phase-owned gap was closed by the
    // phase that owned it, which is why the owner field existed at all.
    expect(entries.every((e) => e.kind === 'never')).toBe(true);
    expect(entries.every((e) => e.owner === 'none')).toBe(true);
  });
});

/* ── Sanity: the criteria kernel is total ─────────────────────────────────── */

describe('the §22.8 kernel', () => {
  it('refuses a short finding set that would otherwise pass', () => {
    const partial = COMPLETION_CRITERION_KEYS.slice(0, 4).map((key) => ({
      key,
      met: true,
      detail: '',
    }));
    // Four met criteria is not five. A `.every()` over a short array is true,
    // which is exactly the bug the length and key checks exist to catch.
    expect(completionEligible(partial)).toBe(false);
  });

  it('reports unmet criteria in register order', () => {
    const findings = COMPLETION_CRITERION_KEYS.map((key, i) => ({
      key,
      met: i % 2 === 0,
      detail: i % 2 === 0 ? '' : 'missing',
    }));
    const unmet = unmetCriteria(findings).map((u) => u.key);
    expect(unmet).toEqual(COMPLETION_CRITERION_KEYS.filter((_, i) => i % 2 !== 0));
  });

  it('has a spec citation and a named record for every criterion', () => {
    for (const criterion of COMPLETION_CRITERIA) {
      expect(criterion.spec).toMatch(/^§22\.8\.\d:/);
      expect(criterion.record.length).toBeGreaterThan(10);
    }
  });
});

void sql;
