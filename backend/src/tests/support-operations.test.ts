/**
 * Phase 16b — support operations, suspend/kill, and the composed timeline.
 *
 * Acceptance:
 *  **§33.9.10** — "Support case has stable reference, owner, due time, context,
 *  and 48-hour Founder follow-up."
 *  **§33.9.11** — "Internal fraud/provider codes never become raw customer copy."
 *
 * Also covered, because the phase's done-when list names them:
 *  - the daily queue shows **overdue**, not just due (the phase trap: an SLA
 *    nobody can see breached is an SLA that gets breached);
 *  - an owner change refuses without all four §26.8 handoff facts;
 *  - suspend/kill requires a reason category AND free text, and the pre-capture
 *    behaviour is complete (§33.9.8's first half);
 *  - one composed read-only timeline per campaign, reservation, and association,
 *    with **no** second event store;
 *  - relationship touches are one-offs with no scheduling affordance.
 *
 * Drift guards run first: `support/logic.ts` restates every register and
 * Appendix B.8 verbatim, and the backend cannot import `@proovd/shared` at
 * runtime — so if the two can disagree, one of them is lying to a customer.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { createMemoryStripeGateway, type MemoryStripeGateway } from '../payments/stripe-client.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { campaigns, reservations } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import {
  backerIdentities,
  founderOperationalShares,
  campaignReservationCapacity,
} from '../db/schema/reservations.js';
import {
  supportCases,
  supportCaseMessages,
  supportCaseHandoffs,
  campaignEnforcementActions,
  relationshipTouches,
} from '../db/schema/support.js';

import {
  SUPPORT_TOPICS,
  SUPPORT_OWNERS,
  SUPPORT_TOPIC_LABELS,
  SUPPORT_OWNER_LABELS,
  SUPPORT_CASE_STATUSES,
  SUPPORT_RESPONSE_BUSINESS_DAYS,
  FOUNDER_FOLLOWUP_HOURS,
  SUPPORT_ACKNOWLEDGEMENT_TEMPLATE,
  resolveSupportAcknowledgement,
  HANDOFF_NOTE_FIELDS,
  ENFORCEMENT_REASON_CATEGORIES,
  ENFORCEMENT_ACTIONS,
  ENFORCEMENT_PHASES,
  PRE_CAPTURE_EFFECTS,
  RELATIONSHIP_TOUCH_KINDS,
  TIMELINE_KINDS,
  enforcementPhaseFor,
} from '../support/logic.js';
import { readSupportQueue, openSupportCase, addCaseMessage } from '../support/cases.js';
import { readTimeline, recordRelationshipTouch } from '../support/timeline.js';
import { RESPONSE_TEMPLATES } from '../support/templates.js';

import {
  SUPPORT_TOPICS as SHARED_TOPICS,
  SUPPORT_TOPIC_LABELS as SHARED_TOPIC_LABELS,
  SUPPORT_OWNERS as SHARED_OWNERS,
  SUPPORT_OWNER_LABELS as SHARED_OWNER_LABELS,
  SUPPORT_CASE_STATUSES as SHARED_STATUSES,
  SUPPORT_RESPONSE_BUSINESS_DAYS as SHARED_RESPONSE_DAYS,
  FOUNDER_FOLLOWUP_HOURS as SHARED_FOLLOWUP_HOURS,
  SUPPORT_ACKNOWLEDGEMENT_TEMPLATE as SHARED_B8,
  resolveSupportAcknowledgement as sharedResolveB8,
  HANDOFF_NOTE_FIELDS as SHARED_HANDOFF_FIELDS,
  ENFORCEMENT_REASON_CATEGORIES as SHARED_REASONS,
  ENFORCEMENT_ACTIONS as SHARED_ACTIONS,
  ENFORCEMENT_PHASES as SHARED_PHASES,
  PRE_CAPTURE_EFFECTS as SHARED_EFFECTS,
  RELATIONSHIP_TOUCH_KINDS as SHARED_TOUCH_KINDS,
  TIMELINE_SOURCES as SHARED_TIMELINE_SOURCES,
} from '@proovd/shared';

const gateway: MemoryStripeGateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: 'whsec_platform_for_support_suite',
  connectWebhookSecret: 'whsec_connect_for_support_suite',
  taxEnabled: true,
});

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway, authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'support-ops',
  );
  await seedAdminReauthWindow(h.db, 900);
  admin = await createAdmin(h, 'supportops');
}, 180_000);

afterAll(async () => {
  await h.stop();
});

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

interface Fixture {
  campaignId: string;
  founderUserId: string;
  reservationId: string;
  backerIdentityId: string;
}

async function seedLiveCampaignWithReservation(
  label: string,
  opts: { status?: string; reservations?: number; sharedPaymentMethod?: boolean } = {},
): Promise<Fixture> {
  const founder = await seedUser(h, 'founder', `supportops-founder-${label}`);
  const legalName = `Founder ${label}`;
  const closeAt = new Date(Date.now() + 14 * 86_400_000);

  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      legalName,
      preferredName: `F-${label}`,
      email: founder.email,
      productName: `Product ${label}`,
      createdBy: 'admin:test',
      claimedUserId: founder.id,
      claimedAt: new Date(),
    })
    .returning({ id: founderProspects.id });

  const [campaign] = await h.db
    .insert(campaigns)
    .values({
      status: (opts.status ?? 'live') as never,
      type: 'pre_launch',
      typeLockedAt: new Date(),
      listingPaidAt: new Date(),
      campaignLiveAt: new Date(Date.now() - 86_400_000),
      campaignCloseAt: closeAt,
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
    legalName,
    businessName: `${label} Labs LLC`,
    soleProprietor: false,
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  await h.db.insert(campaignBuild).values({
    campaignId,
    title: `Campaign ${label}`,
    founderDisplayName: legalName,
    founderEntityDisplay: `${label} Labs LLC`,
    founderCountry: 'United States',
    publicStory: 'A story.',
    closesAt: closeAt,
    refundPolicyTitle: `${label} Refund Policy`,
    refundPolicyVersion: 'v1',
    refundPolicySourceUrl: 'https://app.proovd.co/policies/refund/v1',
    updatedBy: 'user:test',
  });

  const [reward] = await h.db
    .insert(campaignRewardPackages)
    .values({
      campaignId,
      sku: `${label}-sku`,
      title: `Reward ${label}`,
      priceCents: 5_000n,
      contents: 'One unit.',
      fulfillmentCommitment: 'Ships when ready.',
      delivery: 'March 2027',
    })
    .returning({ id: campaignRewardPackages.id });

  await h.db.insert(campaignReservationCapacity).values({
    campaignId,
    capCents: 5_000_000_00n,
    reservedSubtotalCents: 5_000n * BigInt(opts.reservations ?? 1),
  });

  const [identity] = await h.db
    .insert(backerIdentities)
    .values({
      campaignId,
      email: `backer-${label}@example.com`,
      phone: '+15550000000',
      emailNormalized: `backer-${label}@example.com`,
      phoneNormalized: '15550000000',
      dedupKey: randomUUID(),
    })
    .returning({ id: backerIdentities.id });

  const sharedPm = `pm_shared_${label}`;
  const ids: string[] = [];
  for (let i = 0; i < (opts.reservations ?? 1); i += 1) {
    const [r] = await h.db
      .insert(reservations)
      .values({
        campaignId,
        backerIdentityId: identity!.id,
        status: 'reserved_active',
        rewardSubtotalCents: 5_000n,
        salesTaxCents: 413n,
        totalAuthorizedCents: 5_413n,
        rewardPackageId: reward!.id,
        rewardSku: `${label}-sku`,
        rewardTitle: `Reward ${label}`,
        backerEmail: `backer-${label}@example.com`,
        backerPhone: '+15550000000',
        billingCountry: 'US',
        ageConfirmed: true,
        setupIntentId: `seti_${randomUUID().slice(0, 10)}`,
        paymentMethodId: opts.sharedPaymentMethod ? sharedPm : `pm_${label}_${i}`,
        capResult: 'within_cap',
        statementDescriptor: 'PROOVD TESTCO',
        reservedAt: new Date(),
      })
      .returning({ id: reservations.id });
    ids.push(r!.id);

    await h.db.insert(founderOperationalShares).values({
      reservationId: r!.id,
      campaignId,
      founderUserId: `founder:${founder.id}`,
      backerEmail: `backer-${label}@example.com`,
      rewardSku: `${label}-sku`,
      rewardTitle: `Reward ${label}`,
      purchaseDetail: { rewardSku: `${label}-sku` },
    });
  }

  return {
    campaignId,
    founderUserId: founder.id,
    reservationId: ids[0]!,
    backerIdentityId: identity!.id,
  };
}

/* ── Drift guards ─────────────────────────────────────────────────────────── */

describe('the Phase 16b registers do not drift from @proovd/shared', () => {
  it('mirrors §26.7s topics, owners, and statuses', () => {
    expect([...SUPPORT_TOPICS]).toEqual([...SHARED_TOPICS]);
    expect(SUPPORT_TOPIC_LABELS).toEqual(SHARED_TOPIC_LABELS);
    expect([...SUPPORT_OWNERS]).toEqual([...SHARED_OWNERS]);
    expect(SUPPORT_OWNER_LABELS).toEqual(SHARED_OWNER_LABELS);
    expect([...SUPPORT_CASE_STATUSES]).toEqual([...SHARED_STATUSES]);
  });

  it('mirrors §27.8s two published commitments', () => {
    expect(SUPPORT_RESPONSE_BUSINESS_DAYS).toBe(SHARED_RESPONSE_DAYS);
    expect(SUPPORT_RESPONSE_BUSINESS_DAYS).toBe(1);
    expect(FOUNDER_FOLLOWUP_HOURS).toBe(SHARED_FOLLOWUP_HOURS);
    expect(FOUNDER_FOLLOWUP_HOURS).toBe(48);
  });

  /**
   * The one that matters most: B.8 is customer copy, so a restatement that has
   * drifted is a promise the product did not agree to make.
   */
  it('restates Appendix B.8 character for character, and resolves it identically', () => {
    expect(SUPPORT_ACKNOWLEDGEMENT_TEMPLATE).toBe(SHARED_B8);

    const input = {
      caseReference: 'PVD-ABCDE-FGHJK',
      topic: 'refund' as const,
      owner: 'founder_coordinated' as const,
      humanResponseDue: '2026-08-05 14:00 UTC',
    };
    expect(resolveSupportAcknowledgement(input)).toBe(sharedResolveB8(input));
  });

  it('mirrors §26.8s handoff fields and timeline kinds, and §26.7s enforcement vocabulary', () => {
    expect([...HANDOFF_NOTE_FIELDS]).toEqual([...SHARED_HANDOFF_FIELDS]);
    expect(HANDOFF_NOTE_FIELDS).toHaveLength(4);
    expect([...TIMELINE_KINDS]).toEqual(SHARED_TIMELINE_SOURCES.map((s) => s.kind));
    expect([...ENFORCEMENT_REASON_CATEGORIES]).toEqual([...SHARED_REASONS]);
    expect(ENFORCEMENT_REASON_CATEGORIES).toHaveLength(8);
    expect([...ENFORCEMENT_ACTIONS]).toEqual([...SHARED_ACTIONS]);
    expect([...ENFORCEMENT_PHASES]).toEqual([...SHARED_PHASES]);
    expect([...PRE_CAPTURE_EFFECTS]).toEqual([...SHARED_EFFECTS]);
    expect([...RELATIONSHIP_TOUCH_KINDS]).toEqual([...SHARED_TOUCH_KINDS]);
    expect(RELATIONSHIP_TOUCH_KINDS).toHaveLength(5);
  });
});

/* ── §33.9.10 — the named acceptance ──────────────────────────────────────── */

describe('§33.9.10 a support case has stable reference, owner, due time, context, and the 48-hour rule', () => {
  it('returns all five on submission, and renders Appendix B.8 with them', async () => {
    const f = await seedLiveCampaignWithReservation('case-open');

    const res = await request(h.app)
      .post('/api/admin/support/cases')
      .set('cookie', admin.cookie)
      .send({
        topic: 'unknown_charge',
        owner: 'founder_coordinated',
        requesterKind: 'backer',
        backerIdentityId: f.backerIdentityId,
        requesterEmail: 'backer-case-open@example.com',
        campaignId: f.campaignId,
        reservationId: f.reservationId,
        message: 'I do not recognise this charge on my statement.',
      })
      .expect(201);

    // 1 — a stable, quotable reference. Not the UUID.
    expect(res.body.reference).toMatch(/^PVD-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}$/);
    expect(res.body.reference).not.toBe(res.body.caseId);

    // 2 — owner.
    expect(res.body.owner).toBe('founder_coordinated');

    // 3 — a human-response due time, on the committed calendar, with its version
    // stored beside it (§29.6 applied to a support promise).
    expect(new Date(res.body.humanResponseDueAt).getTime()).toBeGreaterThan(Date.now());
    expect(res.body.calendarVersion).toBeTruthy();

    // 4 — the 48-hour Founder follow-up, because the Founder owes this response.
    const followup = new Date(res.body.founderFollowupDueAt).getTime();
    expect(followup).toBeGreaterThan(Date.now() + 47 * 3_600_000);
    expect(followup).toBeLessThan(Date.now() + 49 * 3_600_000);

    // Appendix B.8, rendered with no bracket left in it.
    expect(res.body.acknowledgement).toContain(`case ${res.body.reference}`);
    expect(res.body.acknowledgement).toContain('Topic: A charge I do not recognise');
    expect(res.body.acknowledgement).toContain('Owner: FOUNDER, coordinated by Proovd');
    expect(res.body.acknowledgement).toContain(
      'If the founder needs to respond, we will follow up after 48 hours if you have not heard back.',
    );
    expect(res.body.acknowledgement).not.toMatch(/\[[A-Z]/);

    // 5 — context, so nobody is asked to repeat what the system already holds.
    const detail = await request(h.app)
      .get(`/api/admin/support/cases/${res.body.caseId}`)
      .set('cookie', admin.cookie)
      .expect(200);

    expect(detail.body.campaign.id).toBe(f.campaignId);
    expect(detail.body.campaign.title).toBe('Campaign case-open');
    expect(detail.body.reservation.id).toBe(f.reservationId);
    expect(detail.body.reservation.rewardTitle).toBe('Reward case-open');
    expect(detail.body.reservation.subtotalCents).toBe('5000');
    expect(detail.body.reservation.taxCents).toBe('413');
    expect(detail.body.reservation.totalAuthorizedCents).toBe('5413');
    expect(detail.body.reservation.statementDescriptor).toBe('PROOVD TESTCO');
    // The customer's own message is the first entry on the thread.
    expect(detail.body.messages).toHaveLength(1);
    expect(detail.body.messages[0].direction).toBe('inbound');
  });

  it('sets no Founder follow-up when Proovd owns the case', async () => {
    const f = await seedLiveCampaignWithReservation('case-proovd-owned');

    const res = await request(h.app)
      .post('/api/admin/support/cases')
      .set('cookie', admin.cookie)
      .send({
        topic: 'account_access',
        owner: 'proovd_support',
        requesterKind: 'backer',
        backerIdentityId: f.backerIdentityId,
        requesterEmail: 'x@example.com',
        campaignId: f.campaignId,
        message: 'I cannot open my pre-order link.',
      })
      .expect(201);

    // A case Proovd owns has no Founder to follow up with. Setting the timestamp
    // anyway would put a promise in the record nothing will honour (§1.4).
    expect(res.body.founderFollowupDueAt).toBeNull();
    expect(res.body.acknowledgement).toContain('Owner: PROOVD SUPPORT');
  });

  it('computes the due time on the committed business calendar, skipping a weekend', async () => {
    const f = await seedLiveCampaignWithReservation('case-calendar');

    // A Friday. One business day later is the following Monday, not Saturday.
    const friday = new Date('2026-08-07T15:00:00.000Z');
    const result = await openSupportCase(h.db, {
      topic: 'delivery',
      owner: 'proovd_support',
      requesterKind: 'backer',
      backerIdentityId: f.backerIdentityId,
      requesterEmail: 'x@example.com',
      campaignId: f.campaignId,
      message: 'When does this ship?',
      createdBy: 'user:test',
      now: friday,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.humanResponseDueAt.getUTCDay()).toBe(1); // Monday
    expect(result.result.calendarVersion).toBe('us-federal.v1');
  });

  it('fixes the reference and the deadline at submission — the database refuses to move them', async () => {
    const f = await seedLiveCampaignWithReservation('case-immutable');
    const res = await request(h.app)
      .post('/api/admin/support/cases')
      .set('cookie', admin.cookie)
      .send({
        topic: 'refund',
        owner: 'proovd_support',
        requesterKind: 'backer',
        backerIdentityId: f.backerIdentityId,
        requesterEmail: 'x@example.com',
        campaignId: f.campaignId,
        message: 'Where is my refund?',
      })
      .expect(201);

    // §29.6: a promise already made to a person is not moved by a later edit.
    await expect(
      h.db
        .update(supportCases)
        .set({ humanResponseDueAt: new Date(Date.now() + 30 * 86_400_000) })
        .where(eq(supportCases.id, res.body.caseId)),
    ).rejects.toThrow();

    await expect(
      h.db
        .update(supportCases)
        .set({ reference: 'PVD-AAAAA-AAAAA' })
        .where(eq(supportCases.id, res.body.caseId)),
    ).rejects.toThrow();
  });
});

/* ── §33.9.11 — the named acceptance ──────────────────────────────────────── */

describe('§33.9.11 internal fraud and provider codes never become raw customer copy', () => {
  async function openCase(label: string) {
    const f = await seedLiveCampaignWithReservation(label);
    const res = await request(h.app)
      .post('/api/admin/support/cases')
      .set('cookie', admin.cookie)
      .send({
        topic: 'payment_failed',
        owner: 'proovd_support',
        requesterKind: 'backer',
        backerIdentityId: f.backerIdentityId,
        requesterEmail: 'x@example.com',
        campaignId: f.campaignId,
        reservationId: f.reservationId,
        message: 'My payment did not go through.',
      })
      .expect(201);
    return { caseId: res.body.caseId as string, fixture: f };
  }

  it('refuses a customer-facing reply carrying a provider decline code', async () => {
    const { caseId } = await openCase('code-decline');

    const res = await request(h.app)
      .post(`/api/admin/support/cases/${caseId}/messages`)
      .set('cookie', admin.cookie)
      .send({
        direction: 'outbound',
        customerFacing: true,
        body: 'Your bank returned card_declined, so we could not take the payment.',
      })
      .expect(422);

    expect(res.body.error).toBe('raw_provider_code');

    const stored = await h.db
      .select()
      .from(supportCaseMessages)
      .where(
        and(eq(supportCaseMessages.caseId, caseId), eq(supportCaseMessages.direction, 'outbound')),
      );
    expect(stored).toHaveLength(0);
  });

  it('refuses a provider object reference and a Radar rule in customer copy', async () => {
    const { caseId } = await openCase('code-objects');

    for (const body of [
      'We looked at pi_3PabcdefghIJKLmn and it failed.',
      'This was stopped by radar_rule blocked_high_risk.',
      'The check returned risk_level = highest.',
      'rule: block_prepaid matched on your card.',
    ]) {
      const res = await request(h.app)
        .post(`/api/admin/support/cases/${caseId}/messages`)
        .set('cookie', admin.cookie)
        .send({ direction: 'outbound', customerFacing: true, body })
        .expect(422);
      expect(res.body.error).toBe('raw_provider_code');
    }
  });

  it('permits the same code on an internal note — §26.8 puts it in the Admin view', async () => {
    const { caseId } = await openCase('code-internal');

    // §26.8: raw codes "may appear as secondary support detail in the Admin view
    // only". Refusing them here would push an Admin to paraphrase the one fact
    // that actually identifies the transaction.
    await request(h.app)
      .post(`/api/admin/support/cases/${caseId}/messages`)
      .set('cookie', admin.cookie)
      .send({
        direction: 'outbound',
        customerFacing: false,
        body: 'Stripe returned card_declined on pi_3PabcdefghIJKLmn — issuer decline, not a Radar block.',
      })
      .expect(201);

    const stored = await h.db
      .select()
      .from(supportCaseMessages)
      .where(
        and(eq(supportCaseMessages.caseId, caseId), eq(supportCaseMessages.customerFacing, false)),
      );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.body).toContain('card_declined');
  });

  it('accepts a plain-words reply that says the same thing', async () => {
    const { caseId } = await openCase('code-plain');

    await request(h.app)
      .post(`/api/admin/support/cases/${caseId}/messages`)
      .set('cookie', admin.cookie)
      .send({
        direction: 'outbound',
        customerFacing: true,
        body: 'Your bank turned down the payment, so nothing was taken. You can update the card through your pre-order link.',
      })
      .expect(201);
  });

  it('ships no template containing a provider code, and the payment template says so', () => {
    // A template that shipped with a decline code in it would put an Admin one
    // keystroke from a §33.9.11 violation.
    for (const template of RESPONSE_TEMPLATES) {
      const rendered = template.render({
        reference: 'PVD-AAAAA-BBBBB',
        topic: 'payment_failed',
        owner: 'proovd_support',
        status: 'open',
        humanResponseDueAt: new Date().toISOString(),
        nextPromisedUpdateAt: null,
        founderFollowupDueAt: null,
        requesterEmail: 'x@example.com',
        campaign: { id: 'c', title: 'A Campaign', status: 'live' },
        reservation: {
          id: 'r',
          status: 'reserved_active',
          rewardTitle: 'A Reward',
          subtotalCents: '5000',
          taxCents: '413',
          totalAuthorizedCents: '5413',
          statementDescriptor: 'PROOVD TESTCO',
          reservedAt: '2026-08-01T00:00:00.000Z',
        },
        messages: [],
        handoffs: [],
      });
      expect(rendered).not.toMatch(/card_declined|pi_[A-Za-z0-9]{6,}|radar[_.]/i);
    }

    const payment = RESPONSE_TEMPLATES.find((t) => t.key === 'payment_did_not_go_through')!;
    expect(payment.specRef).toContain('§33.9.11');
  });

  it('refuses a raw provider code in the public ended-state explanation of a kill', async () => {
    const f = await seedLiveCampaignWithReservation('code-kill');

    const res = await request(h.app)
      .post(`/api/admin/campaigns/${f.campaignId}/enforcement`)
      .set('cookie', admin.cookie)
      .send({
        action: 'kill',
        reasonCategory: 'fraud',
        reasonDetail: 'Radar flagged a coordinated set of pre-orders.',
        customerExplanation: 'This campaign was stopped after radar_rule flagged the activity.',
      })
      .expect(422);

    expect(res.body.error).toBe('raw_provider_code');

    const [campaign] = await h.db
      .select({ status: sql<string>`${campaigns.status}::text` })
      .from(campaigns)
      .where(eq(campaigns.id, f.campaignId));
    expect(campaign!.status).toBe('live');
  });
});

/* ── §27.8: the daily queue shows overdue, not just due ───────────────────── */

describe('§27.8 the daily queue', () => {
  it('keeps an overdue case in the queue and sorts it first', async () => {
    const f = await seedLiveCampaignWithReservation('queue-overdue');

    // A case opened last week whose deadline has long passed. A window that only
    // looked forward would drop exactly the case that most needs attention.
    const past = new Date(Date.now() - 7 * 86_400_000);
    const opened = await openSupportCase(h.db, {
      topic: 'refund',
      owner: 'proovd_support',
      requesterKind: 'backer',
      backerIdentityId: f.backerIdentityId,
      requesterEmail: 'overdue@example.com',
      campaignId: f.campaignId,
      message: 'Still waiting.',
      createdBy: 'user:test',
      now: past,
    });
    expect(opened.ok).toBe(true);

    const queue = await readSupportQueue(h.db);
    const entry = queue.entries.find((e) => e.requesterEmail === 'overdue@example.com');

    expect(entry).toBeDefined();
    expect(entry!.responseOverdue).toBe(true);
    expect(queue.overdueCount).toBeGreaterThan(0);
    // Overdue sorts to the top — a queue ordered by creation date buries breach.
    expect(queue.entries[0]!.responseOverdue || queue.entries[0]!.promiseOverdue).toBe(true);
  });

  it('clears the response breach once a customer-facing reply is sent, but not on an internal note', async () => {
    const f = await seedLiveCampaignWithReservation('queue-reply');
    const past = new Date(Date.now() - 3 * 86_400_000);
    const opened = await openSupportCase(h.db, {
      topic: 'delivery',
      owner: 'proovd_support',
      requesterKind: 'backer',
      backerIdentityId: f.backerIdentityId,
      requesterEmail: 'reply@example.com',
      campaignId: f.campaignId,
      message: 'Any news?',
      createdBy: 'user:test',
      now: past,
    });
    if (!opened.ok) throw new Error('setup failed');

    // An internal note is not a response. A case that looked answered while the
    // person waiting had heard nothing would be the SLA failing silently.
    await addCaseMessage(h.db, {
      caseId: opened.result.caseId,
      direction: 'outbound',
      customerFacing: false,
      body: 'Chased the Founder internally.',
      author: 'user:test',
    });

    let queue = await readSupportQueue(h.db);
    expect(queue.entries.find((e) => e.requesterEmail === 'reply@example.com')!.responseOverdue).toBe(
      true,
    );

    await addCaseMessage(h.db, {
      caseId: opened.result.caseId,
      direction: 'outbound',
      customerFacing: true,
      body: 'Here is where this stands.',
      author: 'user:test',
    });

    queue = await readSupportQueue(h.db);
    expect(queue.entries.find((e) => e.requesterEmail === 'reply@example.com')!.responseOverdue).toBe(
      false,
    );
  });

  it('serves the queue with its overdue count through the Admin route', async () => {
    const res = await request(h.app)
      .get('/api/admin/support/queue')
      .set('cookie', admin.cookie)
      .expect(200);
    expect(res.body).toHaveProperty('overdueCount');
    expect(res.body).toHaveProperty('dueCount');
  });
});

/* ── §26.8: the handoff note gate ─────────────────────────────────────────── */

describe('§26.8 an owner change requires a complete handoff note', () => {
  async function openCase(label: string) {
    const f = await seedLiveCampaignWithReservation(label);
    const res = await request(h.app)
      .post('/api/admin/support/cases')
      .set('cookie', admin.cookie)
      .send({
        topic: 'campaign_question',
        owner: 'proovd_support',
        requesterKind: 'backer',
        backerIdentityId: f.backerIdentityId,
        requesterEmail: 'x@example.com',
        campaignId: f.campaignId,
        message: 'A question.',
      })
      .expect(201);
    return res.body.caseId as string;
  }

  it('refuses to move the case when any of the four facts is missing, and names it', async () => {
    const caseId = await openCase('handoff-missing');

    const complete = {
      toOwner: 'founder_coordinated',
      verifiedFacts: 'Card saved 1 Aug, nothing charged, total authorized US$54.13.',
      currentOwner: 'Handing from Proovd support to the Founder.',
      nextCustomerPromise: 'We told them they would hear by Thursday.',
      statementsToKeepConsistent: 'We already said no money has moved. Do not contradict that.',
    };

    for (const field of [
      'verifiedFacts',
      'currentOwner',
      'nextCustomerPromise',
      'statementsToKeepConsistent',
    ] as const) {
      const res = await request(h.app)
        .post(`/api/admin/support/cases/${caseId}/transfer`)
        .set('cookie', admin.cookie)
        .send({ ...complete, [field]: '   ' })
        .expect(422);

      expect(res.body.error).toBe('incomplete_note');
      // Naming the missing field is the difference between a gate an Admin can
      // pass and one they work around.
      expect(res.body.whatHappened).toMatch(/Still missing/);
    }

    // Nothing moved through any of those four attempts.
    const [row] = await h.db.select().from(supportCases).where(eq(supportCases.id, caseId));
    expect(row!.owner).toBe('proovd_support');
    const handoffs = await h.db
      .select()
      .from(supportCaseHandoffs)
      .where(eq(supportCaseHandoffs.caseId, caseId));
    expect(handoffs).toHaveLength(0);
  });

  it('records all four and moves the case in one transaction, starting the 48-hour clock', async () => {
    const caseId = await openCase('handoff-complete');

    await request(h.app)
      .post(`/api/admin/support/cases/${caseId}/transfer`)
      .set('cookie', admin.cookie)
      .send({
        toOwner: 'founder_coordinated',
        verifiedFacts: 'Card saved 1 Aug, nothing charged.',
        currentOwner: 'Proovd support → Founder.',
        nextCustomerPromise: 'They were told they would hear by Thursday.',
        statementsToKeepConsistent: 'We said no money has moved.',
      })
      .expect(201);

    const [row] = await h.db.select().from(supportCases).where(eq(supportCases.id, caseId));
    expect(row!.owner).toBe('founder_coordinated');
    expect(row!.status).toBe('awaiting_founder');

    // The 48-hour clock starts when the Founder acquires the case — a Founder
    // cannot be late for one handed to them five minutes ago.
    const followup = row!.founderFollowupDueAt!.getTime();
    expect(followup).toBeGreaterThan(Date.now() + 47 * 3_600_000);

    const handoffs = await h.db
      .select()
      .from(supportCaseHandoffs)
      .where(eq(supportCaseHandoffs.caseId, caseId));
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]!.statementsToKeepConsistent).toContain('no money has moved');
  });

  it('is insert-only: a recorded handoff cannot be rewritten', async () => {
    const caseId = await openCase('handoff-immutable');
    await request(h.app)
      .post(`/api/admin/support/cases/${caseId}/transfer`)
      .set('cookie', admin.cookie)
      .send({
        toOwner: 'founder_coordinated',
        verifiedFacts: 'a',
        currentOwner: 'b',
        nextCustomerPromise: 'c',
        statementsToKeepConsistent: 'd',
      })
      .expect(201);

    await expect(
      h.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE proovd_app`);
        await tx
          .update(supportCaseHandoffs)
          .set({ verifiedFacts: 'rewritten' })
          .where(eq(supportCaseHandoffs.caseId, caseId));
      }),
    ).rejects.toThrow();
  });
});

/* ── §26.7 / §33.9.8: suspend and kill ────────────────────────────────────── */

describe('§26.7 suspend and kill', () => {
  it('refuses a category with no free text, and free text with no category', async () => {
    const f = await seedLiveCampaignWithReservation('kill-reason');

    const noText = await request(h.app)
      .post(`/api/admin/campaigns/${f.campaignId}/enforcement`)
      .set('cookie', admin.cookie)
      .send({
        action: 'kill',
        reasonCategory: 'fraud',
        reasonDetail: '   ',
        customerExplanation: 'This campaign was stopped.',
      })
      .expect(422);
    expect(noText.body.error).toBe('invalid');

    const noCategory = await request(h.app)
      .post(`/api/admin/campaigns/${f.campaignId}/enforcement`)
      .set('cookie', admin.cookie)
      .send({
        action: 'kill',
        reasonCategory: 'because_i_said_so',
        reasonDetail: 'A real explanation.',
        customerExplanation: 'This campaign was stopped.',
      })
      .expect(422);
    expect(noCategory.body.error).toBe('invalid');

    const [campaign] = await h.db
      .select({ status: sql<string>`${campaigns.status}::text` })
      .from(campaigns)
      .where(eq(campaigns.id, f.campaignId));
    expect(campaign!.status).toBe('live');
  });

  it('refuses a kill with no customer explanation — §18 forbids one generic ended message', async () => {
    const f = await seedLiveCampaignWithReservation('kill-noexplain');
    await request(h.app)
      .post(`/api/admin/campaigns/${f.campaignId}/enforcement`)
      .set('cookie', admin.cookie)
      .send({
        action: 'kill',
        reasonCategory: 'aup_violation',
        reasonDetail: 'Prohibited product category.',
        customerExplanation: '',
      })
      .expect(422);
  });

  it('closes every active reservation without charge and preserves the SetupIntent', async () => {
    const f = await seedLiveCampaignWithReservation('kill-precapture', { reservations: 3 });

    const before = await h.db
      .select({ id: reservations.id, setupIntentId: reservations.setupIntentId })
      .from(reservations)
      .where(eq(reservations.campaignId, f.campaignId));
    expect(before).toHaveLength(3);

    const res = await request(h.app)
      .post(`/api/admin/campaigns/${f.campaignId}/enforcement`)
      .set('cookie', admin.cookie)
      .send({
        action: 'kill',
        reasonCategory: 'fraud',
        reasonDetail: 'Coordinated pre-orders from one operator.',
        customerExplanation:
          'We stopped this campaign after a review of how its pre-orders were placed. You were not charged.',
      })
      .expect(201);

    expect(res.body.phase).toBe('pre_capture');
    expect(res.body.reservationsClosed).toBe(3);
    expect(res.body.effectsApplied).toContain('close_active_reservations_without_charge');
    expect(res.body.effectsApplied).toContain('block_future_payment_intents');
    expect(res.body.effectsApplied).toContain('preserve_page_with_banner');

    const after = await h.db
      .select({
        id: reservations.id,
        status: sql<string>`${reservations.status}::text`,
        setupIntentId: reservations.setupIntentId,
        totalCaptured: reservations.totalCapturedCents,
      })
      .from(reservations)
      .where(eq(reservations.campaignId, f.campaignId));

    for (const row of after) {
      // §23.5's own state — distinct from the Backer's `reserved_canceled`.
      expect(row.status).toBe('killed_no_charge');
      // §29.7: "Successful SetupIntents remain historical, never rewritten."
      expect(row.setupIntentId).toBe(before.find((b) => b.id === row.id)!.setupIntentId);
      expect(row.setupIntentId).toMatch(/^seti_/);
      // Without charge.
      expect(row.totalCaptured).toBe(0n);
    }

    // §19: the Founder's operational record becomes `do not fulfill`.
    const shares = await h.db
      .select()
      .from(founderOperationalShares)
      .where(eq(founderOperationalShares.campaignId, f.campaignId));
    expect(shares).toHaveLength(3);
    for (const share of shares) expect(share.fulfillmentState).toBe('do_not_fulfill');

    // Out of the cap, so a threshold cannot count a killed pre-order.
    const [capacity] = await h.db
      .select()
      .from(campaignReservationCapacity)
      .where(eq(campaignReservationCapacity.campaignId, f.campaignId));
    expect(capacity!.reservedSubtotalCents).toBe(0n);

    const [campaign] = await h.db
      .select({ status: sql<string>`${campaigns.status}::text` })
      .from(campaigns)
      .where(eq(campaigns.id, f.campaignId));
    expect(campaign!.status).toBe('killed');
  });

  it('records the decision post-capture and a SUSPENSION moves no money — the §26.7 consequences are 20b’s', async () => {
    const f = await seedLiveCampaignWithReservation('kill-postcapture', {
      status: 'captured_pending_w9',
    });

    expect(enforcementPhaseFor('captured_pending_w9')).toBe('post_capture');

    const res = await request(h.app)
      .post(`/api/admin/campaigns/${f.campaignId}/enforcement`)
      .set('cookie', admin.cookie)
      .send({
        action: 'suspend',
        reasonCategory: 'provider_risk',
        reasonDetail: 'Provider raised a risk review after capture.',
        customerExplanation: 'We paused this campaign while we complete a review.',
      })
      .expect(201);

    expect(res.body.phase).toBe('post_capture');
    // Phase 20b applies the post-capture consequences rather than deferring
    // them: the funds hold, the §24.8 path, the role notices.
    expect(res.body.postCaptureConsequencesDeferred).toBe(false);
    expect(res.body.effectsApplied).toContain('invoke_refund_reversal_recovery_policy');
    expect(res.body.effectsApplied).toContain('restrict_unreleased_funds');
    // A post-capture SUSPENSION closes nothing: it is reinstateable (§23.1),
    // and a reservation may already have been charged — closing it would be
    // the one mistake here that moves real money the wrong way.
    expect(res.body.reservationsClosed).toBe(0);
    expect(res.body.effectsApplied).not.toContain('close_active_reservations_without_charge');

    const after = await h.db
      .select({ status: sql<string>`${reservations.status}::text` })
      .from(reservations)
      .where(eq(reservations.campaignId, f.campaignId));
    expect(after[0]!.status).toBe('reserved_active');
  });

  it('is idempotent: a repeat returns the first decision and closes nothing twice', async () => {
    const f = await seedLiveCampaignWithReservation('kill-idempotent', { reservations: 2 });

    const body = {
      action: 'kill',
      reasonCategory: 'manipulation',
      reasonDetail: 'Inflated click activity from one source.',
      customerExplanation: 'We stopped this campaign after reviewing how its traffic was generated.',
    };

    const first = await request(h.app)
      .post(`/api/admin/campaigns/${f.campaignId}/enforcement`)
      .set('cookie', admin.cookie)
      .send(body)
      .expect(201);
    expect(first.body.replayed).toBe(false);
    expect(first.body.reservationsClosed).toBe(2);

    const second = await request(h.app)
      .post(`/api/admin/campaigns/${f.campaignId}/enforcement`)
      .set('cookie', admin.cookie)
      .send(body);

    // Either the replay returns the first decision, or the campaign is refused
    // as already ended. What must never happen is a second enforcement row.
    const rows = await h.db
      .select()
      .from(campaignEnforcementActions)
      .where(eq(campaignEnforcementActions.campaignId, f.campaignId));
    expect(rows).toHaveLength(1);
    if (second.status === 201) expect(second.body.replayed).toBe(true);
  });

  it('never detaches a PaymentMethod still supporting another active transaction (§33.7.2)', async () => {
    // Two active reservations sharing one card. A kill closes both, and the card
    // must not be detached twice — nor while the other was still live.
    const f = await seedLiveCampaignWithReservation('kill-detach', {
      reservations: 2,
      sharedPaymentMethod: true,
    });

    const res = await request(h.app)
      .post(`/api/admin/campaigns/${f.campaignId}/enforcement`)
      .set('cookie', admin.cookie)
      .send({
        action: 'kill',
        reasonCategory: 'founder_request',
        reasonDetail: 'The Founder asked us to stop the campaign.',
        customerExplanation: 'The founder ended this campaign. You were not charged.',
      })
      .expect(201);

    expect(res.body.reservationsClosed).toBe(2);
    // Both reservations share one method, so neither was reference-safe to
    // detach at decision time and none was detached.
    expect(res.body.paymentMethodsDetached).toBe(0);
  });

  it('takes the freshness gate — §5.1 names kill/suspend by name', async () => {
    const f = await seedLiveCampaignWithReservation('kill-fresh');
    const client = await h.pool.connect();
    try {
      await client.query(
        `UPDATE "session" SET "created_at" = now() - interval '30 days' WHERE "user_id" = $1`,
        [admin.id],
      );
      const stale = await request(h.app)
        .post(`/api/admin/campaigns/${f.campaignId}/enforcement`)
        .set('cookie', admin.cookie)
        .send({
          action: 'kill',
          reasonCategory: 'fraud',
          reasonDetail: 'x',
          customerExplanation: 'y',
        });
      expect(stale.status).toBeGreaterThanOrEqual(400);
    } finally {
      await client.query(`UPDATE "session" SET "created_at" = now() WHERE "user_id" = $1`, [
        admin.id,
      ]);
      client.release();
    }
  });
});

/* ── §26.8: the composed timeline ─────────────────────────────────────────── */

describe('§26.8 the chronological timeline composes rather than duplicates', () => {
  it('has no timeline event store anywhere in the schema', async () => {
    // The phase trap: "A second event store that drifts from the first is worse
    // than no timeline." The enforcement is that the table does not exist.
    const result = await h.db.execute(
      sql`SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
            AND (table_name LIKE '%timeline%' OR table_name LIKE '%_events_log%')`,
    );
    expect(result.rows).toHaveLength(0);
  });

  it('builds a campaign timeline from the records that already own each fact', async () => {
    const f = await seedLiveCampaignWithReservation('timeline-campaign');

    await request(h.app)
      .post('/api/admin/support/cases')
      .set('cookie', admin.cookie)
      .send({
        topic: 'campaign_question',
        owner: 'proovd_support',
        requesterKind: 'backer',
        backerIdentityId: f.backerIdentityId,
        requesterEmail: 'x@example.com',
        campaignId: f.campaignId,
        message: 'A question.',
      })
      .expect(201);

    await request(h.app)
      .post(`/api/admin/campaigns/${f.campaignId}/relationship-touches`)
      .set('cookie', admin.cookie)
      .send({ kind: 'campaign_introduction', note: 'Called the founder to introduce ourselves.' })
      .expect(201);

    const res = await request(h.app)
      .get(`/api/admin/timeline/campaign/${f.campaignId}`)
      .set('cookie', admin.cookie)
      .expect(200);

    const kinds = res.body.entries.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain('support_case');
    expect(kinds).toContain('relationship_touch');

    // Every entry names the existing table it came from, so the "composes rather
    // than duplicates" claim is checkable from the response itself.
    for (const entry of res.body.entries) {
      expect(entry.composedFrom).toBeTruthy();
      expect(entry.composedFrom).not.toMatch(/timeline/);
    }

    // Chronological, oldest first — a timeline read backwards is a list.
    const times = res.body.entries.map((e: { occurredAt: string }) => e.occurredAt);
    expect([...times].sort()).toEqual(times);
  });

  it('builds a reservation timeline that includes its campaign-level events', async () => {
    const f = await seedLiveCampaignWithReservation('timeline-reservation');

    await request(h.app)
      .post(`/api/admin/campaigns/${f.campaignId}/enforcement`)
      .set('cookie', admin.cookie)
      .send({
        action: 'kill',
        reasonCategory: 'sanctions_regulatory',
        reasonDetail: 'Regulatory concern raised.',
        customerExplanation: 'We stopped this campaign. You were not charged.',
      })
      .expect(201);

    const res = await request(h.app)
      .get(`/api/admin/timeline/reservation/${f.reservationId}`)
      .set('cookie', admin.cookie)
      .expect(200);

    const kinds = res.body.entries.map((e: { kind: string }) => e.kind);
    // A Backer asking "what happened to my pre-order" needs the campaign's kill
    // on it, not just their own row's status change.
    expect(kinds).toContain('reservation_status');
    expect(kinds).toContain('enforcement');
    expect(kinds).toContain('campaign_status');
  });

  it('builds an association timeline', async () => {
    const timeline = await readTimeline(h.db, 'association', randomUUID());
    expect(timeline.subject).toBe('association');
    // An unknown subject is an empty timeline, not an error — the read composes
    // whatever exists, and nothing existing is a real answer.
    expect(timeline.entries).toEqual([]);
    expect(timeline.sourcesRead).toContain('association_status_history');
  });

  it('keeps an internal note body off the timeline (§33.9.11)', async () => {
    const f = await seedLiveCampaignWithReservation('timeline-note');
    const opened = await request(h.app)
      .post('/api/admin/support/cases')
      .set('cookie', admin.cookie)
      .send({
        topic: 'payment_failed',
        owner: 'proovd_support',
        requesterKind: 'backer',
        backerIdentityId: f.backerIdentityId,
        requesterEmail: 'x@example.com',
        campaignId: f.campaignId,
        message: 'Payment problem.',
      })
      .expect(201);

    await request(h.app)
      .post(`/api/admin/support/cases/${opened.body.caseId}/messages`)
      .set('cookie', admin.cookie)
      .send({
        direction: 'outbound',
        customerFacing: false,
        body: 'Internal: card_declined on pi_3PabcdefghIJKLmn.',
      })
      .expect(201);

    const res = await request(h.app)
      .get(`/api/admin/timeline/campaign/${f.campaignId}`)
      .set('cookie', admin.cookie)
      .expect(200);

    // A timeline is exactly the kind of view that gets pasted into a customer
    // message, so the note's body is not summarised into it.
    expect(JSON.stringify(res.body)).not.toContain('card_declined');
    expect(JSON.stringify(res.body)).not.toContain('pi_3Pabcdefgh');
  });
});

/* ── §26.8: relationship touches are one-offs ─────────────────────────────── */

describe('§26.8 human relationship touches are loggable one-offs, never a sequence', () => {
  it('logs each of the five kinds once and refuses a second of the same kind', async () => {
    const f = await seedLiveCampaignWithReservation('touch-once');

    for (const kind of RELATIONSHIP_TOUCH_KINDS) {
      await request(h.app)
        .post(`/api/admin/campaigns/${f.campaignId}/relationship-touches`)
        .set('cookie', admin.cookie)
        .send({ kind, note: `Did the ${kind}.` })
        .expect(201);
    }

    const second = await request(h.app)
      .post(`/api/admin/campaigns/${f.campaignId}/relationship-touches`)
      .set('cookie', admin.cookie)
      .send({ kind: 'mid_campaign_welcome', note: 'Again.' })
      .expect(422);

    expect(second.body.error).toBe('already_logged');
    // An Admin logging a second one has either made a mistake or started a
    // sequence, and both deserve to be told.
    expect(second.body.whatHappened).toMatch(/one-time|sequence/);

    const rows = await h.db
      .select()
      .from(relationshipTouches)
      .where(eq(relationshipTouches.campaignId, f.campaignId));
    expect(rows).toHaveLength(5);
  });

  it('refuses an unregistered kind and an empty note', async () => {
    const f = await seedLiveCampaignWithReservation('touch-invalid');

    expect(
      (await recordRelationshipTouch(h.db, {
        campaignId: f.campaignId,
        kind: 'weekly_check_in',
        note: 'x',
        recordedBy: 'user:test',
      })).ok,
    ).toBe(false);

    expect(
      (await recordRelationshipTouch(h.db, {
        campaignId: f.campaignId,
        kind: 'close_thank_you',
        note: '   ',
        recordedBy: 'user:test',
      })).ok,
    ).toBe(false);
  });

  it('has no scheduling affordance in the schema at all', async () => {
    // §30 forbids automated engagement and §26.8 says these must never become a
    // scheduled sequence. The absence of the columns is the enforcement.
    const result = await h.db.execute(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'relationship_touches'`,
    );
    const columns = result.rows.map((r) => (r as { column_name: string }).column_name);

    for (const forbidden of [
      'scheduled_for',
      'scheduled_at',
      'recurrence',
      'repeat_interval',
      'template_id',
      'cadence',
      'next_send_at',
    ]) {
      expect(columns).not.toContain(forbidden);
    }
    expect(columns).toEqual(
      expect.arrayContaining(['campaign_id', 'kind', 'note', 'recorded_by', 'occurred_at']),
    );
  });
});

/* ── §33.12.5: the guards ─────────────────────────────────────────────────── */

describe('§33.12.5 the Phase 16b routes fail closed', () => {
  it('refuses a read with no session and a Founder session', async () => {
    await request(h.app).get('/api/admin/support/queue').expect(401);

    const founder = await seedUser(h, 'founder', 'supportops-wrongrole');
    const cookie = await signInPlain(h, founder.email);
    await request(h.app).get('/api/admin/support/queue').set('cookie', cookie).expect(403);
  });
});
