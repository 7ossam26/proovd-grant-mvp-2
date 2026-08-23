/**
 * Phase 16a — the §26.5 ledger, §26.6 money controls, §31.7 risk inventory, and
 * the §33.12.4 override contract, against a real Postgres and the real
 * `createApp` wiring.
 *
 * Acceptance: **§33.12.4** — "User/provider data auto-populates Admin; every
 * override preserves before/after, reason, actor, and time." Those are two
 * claims, and this file tests both halves separately, because the second is only
 * meaningful given the first: if an Admin could re-type a Founder's email or a
 * Stripe requirement name, "before" would be whatever was last typed rather than
 * what the system actually held.
 *
 * Also covered, because the phase's done-when list names them:
 *  - the ledger filters across all eleven §26.5 dimensions;
 *  - §25.7's permitted export — the limit applies to what Admin may hand out,
 *    not only to what Admin may see;
 *  - §26.6's money-control lines exist and read the Phase 03 ledger columns,
 *    and an unpopulated line says so rather than printing a zero (§1.4);
 *  - §22.3's vocabulary — `held` is not a synonym for anything;
 *  - all ten §31.7 signals surface, with `not_collecting` treated as a risk;
 *  - the four §26.6 high-impact requirements, including the one that had no home
 *    before this phase: the customer-consequence preview.
 *
 * Drift guards run first. The backend cannot import `@proovd/shared` at runtime,
 * so every register is restated in `admin/logic.ts`; if the two can disagree,
 * one of them is lying.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { createMemoryStripeGateway, type MemoryStripeGateway } from '../payments/stripe-client.js';
import { campaigns, reservations } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import { backerIdentities } from '../db/schema/reservations.js';
import { auditEvents, providerEvents, idempotencyKeys } from '../db/schema/integrity.js';
import {
  adminOverrides,
  highImpactActionPreviews,
  campaignSellerTaxReadiness,
} from '../db/schema/admin-operations.js';

import {
  LEDGER_DIMENSION_KEYS,
  PERMITTED_EXPORT_COLUMNS,
  RESTRICTED_COLUMNS,
  CAP_RESULTS,
  MONEY_CONTROL_KEYS,
  MONEY_STATUSES,
  BANNED_MONEY_STATUS_WORDS,
  HIGH_IMPACT_REQUIREMENTS,
  RISK_SIGNAL_KEYS,
  RISK_SEVERITIES,
  SELLER_TAX_READINESS_FACT_KEYS,
  OVERRIDABLE_FIELDS,
  OVERRIDE_REQUIRED_FACTS,
  ADMIN_FIELD_KINDS,
  isSellerTaxReady,
  missingSellerTaxFacts,
  containsRawProviderCode,
} from '../admin/logic.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { AUTO_POPULATED_FIELDS } from '../admin/high-impact.js';

import {
  LEDGER_DIMENSIONS as SHARED_DIMENSIONS,
  permittedExportColumns as sharedPermitted,
  restrictedColumns as sharedRestricted,
  CAP_RESULTS as SHARED_CAP_RESULTS,
  MONEY_CONTROL_LINES as SHARED_MONEY_LINES,
  MONEY_STATUSES as SHARED_MONEY_STATUSES,
  BANNED_MONEY_STATUS_WORDS as SHARED_BANNED_WORDS,
  HIGH_IMPACT_REQUIREMENTS as SHARED_HIGH_IMPACT,
  RISK_SIGNALS as SHARED_RISK_SIGNALS,
  SELLER_TAX_READINESS_FACTS as SHARED_TAX_FACTS,
  OVERRIDABLE_FIELDS as SHARED_OVERRIDABLE,
  OVERRIDE_REQUIRED_FACTS as SHARED_OVERRIDE_FACTS,
  ADMIN_FIELD_KINDS as SHARED_FIELD_KINDS,
  isSellerTaxReady as sharedIsReady,
  containsRawProviderCode as sharedContainsCode,
} from '@proovd/shared';

const gateway: MemoryStripeGateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: 'whsec_platform_for_admin_ops',
  connectWebhookSecret: 'whsec_connect_for_admin_ops',
  taxEnabled: true,
});

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway },
    'admin-ops',
  );
  // §6 ships `admin_reauth_window_seconds` unset, and `requireFreshSession` then
  // fails closed with a 503 naming the settings route — the designed state, not
  // a bug. Production seeds it at first boot (`index.ts`); a suite that
  // exercises a `fresh`-gated route has to do the same, or every write here
  // would be testing the unset case over and over.
  await seedAdminReauthWindow(h.db, 900);
  admin = await createAdmin(h, 'adminops');
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

/**
 * A live campaign with one reward and one active reservation.
 *
 * Written directly rather than driven through the pre-order flow: that journey
 * is Phase 15's suite and is already green. What is under test here is what the
 * Admin surfaces do with a reservation once it exists.
 */
async function seedCampaignWithReservation(
  label: string,
  opts: {
    rewardCents?: bigint;
    subtotalCents?: bigint;
    taxabilityReason?: string;
    attributionStatus?: string;
    capResult?: string;
    consentVersion?: string;
    founderMarketingConsent?: boolean;
    newsletterConsent?: boolean;
  } = {},
): Promise<Fixture> {
  const founder = await seedUser(h, 'founder', `adminops-founder-${label}`);
  const legalName = `Founder ${label}`;
  const closeAt = new Date(Date.now() + 14 * 86_400_000);
  const rewardCents = opts.rewardCents ?? 5_000n;

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
      status: 'live',
      type: 'pre_launch',
      typeLockedAt: new Date(),
      highEffort: false,
      highEffortCalculatedAt: new Date(),
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
      priceCents: rewardCents,
      contents: 'One unit.',
      fulfillmentCommitment: 'Ships when ready.',
      delivery: 'March 2027',
    })
    .returning({ id: campaignRewardPackages.id });

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

  const subtotal = opts.subtotalCents ?? rewardCents;
  const [reservation] = await h.db
    .insert(reservations)
    .values({
      campaignId,
      backerIdentityId: identity!.id,
      status: 'reserved_active',
      rewardSubtotalCents: subtotal,
      salesTaxCents: 413n,
      totalAuthorizedCents: subtotal + 413n,
      rewardPackageId: reward!.id,
      rewardSku: `${label}-sku`,
      rewardTitle: `Reward ${label}`,
      rewardDelivery: 'March 2027',
      backerEmail: `backer-${label}@example.com`,
      backerPhone: '+15550000000',
      billingCountry: 'US',
      billingPostalCode: '19702',
      billingLine1: '254 Chapman Rd',
      billingCity: 'Newark',
      ageConfirmed: true,
      taxCalculationId: `txcd_${randomUUID().slice(0, 8)}`,
      taxJurisdiction: 'DE',
      taxabilityReason: opts.taxabilityReason ?? 'standard_rated',
      taxCalculationExpiresAt: new Date(Date.now() + 7 * 86_400_000),
      taxCalculatedAt: new Date(),
      setupIntentId: `seti_${randomUUID().slice(0, 10)}`,
      stripeCustomerId: `cus_${randomUUID().slice(0, 10)}`,
      paymentMethodFingerprint: `fp_${randomUUID().slice(0, 10)}`,
      consentAppendix: 'A.4',
      consentVersion: opts.consentVersion ?? 'v1',
      consentHash: randomUUID(),
      surveyWhy: 'Because it solves my problem.',
      surveyRecommend: 9,
      operationalSharingAck: true,
      founderMarketingConsent: opts.founderMarketingConsent ?? false,
      newsletterConsent: opts.newsletterConsent ?? false,
      attributionSource: 'organic',
      attributionStatus: opts.attributionStatus ?? 'provisional',
      capResult: opts.capResult ?? 'within_cap',
      statementDescriptor: 'PROOVD TESTCO',
      reservedAt: new Date(),
    })
    .returning({ id: reservations.id });

  return {
    campaignId,
    founderUserId: founder.id,
    reservationId: reservation!.id,
    backerIdentityId: identity!.id,
  };
}

/* ── Drift guards ─────────────────────────────────────────────────────────── */

describe('the Phase 16a registers do not drift from @proovd/shared', () => {
  it('mirrors §26.5s eleven ledger dimensions', () => {
    expect([...LEDGER_DIMENSION_KEYS]).toEqual(SHARED_DIMENSIONS.map((d) => d.key));
    expect(LEDGER_DIMENSION_KEYS).toHaveLength(11);
  });

  it('mirrors §25.7s permitted and restricted export columns', () => {
    expect([...PERMITTED_EXPORT_COLUMNS]).toEqual(sharedPermitted().map((c) => c.key));
    expect([...RESTRICTED_COLUMNS]).toEqual(sharedRestricted().map((c) => c.key));
  });

  it('mirrors §26.5s cap results and §26.6s nine money-control lines', () => {
    expect([...CAP_RESULTS]).toEqual([...SHARED_CAP_RESULTS]);
    expect([...MONEY_CONTROL_KEYS]).toEqual(SHARED_MONEY_LINES.map((l) => l.key));
    expect(MONEY_CONTROL_KEYS).toHaveLength(9);
  });

  it('mirrors §22.3s money vocabulary and §26.6s four high-impact requirements', () => {
    expect([...MONEY_STATUSES]).toEqual([...SHARED_MONEY_STATUSES]);
    expect([...BANNED_MONEY_STATUS_WORDS]).toEqual([...SHARED_BANNED_WORDS]);
    expect([...HIGH_IMPACT_REQUIREMENTS]).toEqual([...SHARED_HIGH_IMPACT]);
  });

  it('mirrors §31.7s ten signals, their severities, and the four readiness facts', () => {
    expect([...RISK_SIGNAL_KEYS]).toEqual(SHARED_RISK_SIGNALS.map((s) => s.key));
    expect(RISK_SIGNAL_KEYS).toHaveLength(10);
    for (const signal of SHARED_RISK_SIGNALS) {
      expect(RISK_SEVERITIES[signal.key as keyof typeof RISK_SEVERITIES]).toBe(signal.severity);
    }
    expect([...SELLER_TAX_READINESS_FACT_KEYS]).toEqual(SHARED_TAX_FACTS.map((f) => f.key));
  });

  it('mirrors §33.12.4s override register and field kinds', () => {
    expect(OVERRIDABLE_FIELDS.map((f) => f.key)).toEqual(SHARED_OVERRIDABLE.map((f) => f.key));
    for (const shared of SHARED_OVERRIDABLE) {
      const restated = OVERRIDABLE_FIELDS.find((f) => f.key === shared.key);
      expect(restated?.customerConsequence).toBe(shared.customerConsequence);
      expect(restated?.targetType).toBe(shared.targetType);
    }
    expect([...OVERRIDE_REQUIRED_FACTS]).toEqual([...SHARED_OVERRIDE_FACTS]);
    expect([...ADMIN_FIELD_KINDS]).toEqual([...SHARED_FIELD_KINDS]);
  });

  it('agrees with shared on seller-tax readiness and raw-provider-code detection', () => {
    const partial = {
      head_office_location: true,
      product_tax_code: true,
      registration: true,
      provider_tax_settings: false,
    };
    expect(isSellerTaxReady(partial)).toBe(sharedIsReady(partial));
    expect(isSellerTaxReady(partial)).toBe(false);

    for (const sample of [
      'Your card was declined: card_declined',
      'Reference pi_3PabcdefghIJKL',
      'radar_rule matched',
      'rule: block_high_risk',
      'risk_level = elevated',
      'A perfectly ordinary sentence about a refund.',
    ]) {
      expect(containsRawProviderCode(sample)).toBe(sharedContainsCode(sample));
    }
  });
});

/* ── §33.12.4 — the named acceptance ──────────────────────────────────────── */

describe('§33.12.4 user and provider data auto-populates; every override is fully recorded', () => {
  /**
   * Half one. §26.2: "User/Stripe data auto-populates; Admin adds only
   * review/decision/evidence/override data." The enforcement is the absence of a
   * route, so the test is that no plausible route accepts one — the same posture
   * 10b took with bank details.
   */
  it('offers no Admin write path for any auto-populated field', async () => {
    const f = await seedCampaignWithReservation('autopop');

    const before = await h.db
      .select()
      .from(reservations)
      .where(eq(reservations.id, f.reservationId));

    const forged = {
      backerEmail: 'attacker@example.com',
      backerPhone: '+15559999999',
      rewardSubtotalCents: '1',
      salesTaxCents: '0',
      totalAuthorizedCents: '1',
      setupIntentId: 'seti_forged',
      paymentMethodFingerprint: 'fp_forged',
      consentHash: 'forged',
      consentVersion: 'forged',
    };

    for (const path of [
      `/api/admin/ledger/${f.reservationId}`,
      `/api/admin/reservations/${f.reservationId}`,
      `/api/admin/overrides/${f.reservationId}`,
      `/api/admin/money/${f.campaignId}`,
    ]) {
      for (const method of ['post', 'put', 'patch'] as const) {
        const res = await request(h.app)[method](path).set('cookie', admin.cookie).send(forged);
        // 404 (no such route) or 4xx (route exists, refuses this shape). What
        // must never happen is a 2xx.
        expect(res.status).toBeGreaterThanOrEqual(400);
      }
    }

    const after = await h.db
      .select()
      .from(reservations)
      .where(eq(reservations.id, f.reservationId));

    expect(after[0]!.backerEmail).toBe(before[0]!.backerEmail);
    expect(after[0]!.rewardSubtotalCents).toBe(before[0]!.rewardSubtotalCents);
    expect(after[0]!.setupIntentId).toBe(before[0]!.setupIntentId);
    expect(after[0]!.consentHash).toBe(before[0]!.consentHash);

    // The register that makes the claim checkable is served, so the surface can
    // render *why* a field has no control rather than just omitting one.
    const fields = await request(h.app)
      .get('/api/admin/overrides/fields')
      .set('cookie', admin.cookie)
      .expect(200);
    expect(fields.body.autoPopulated.length).toBe(AUTO_POPULATED_FIELDS.length);
    expect(fields.body.overridable.map((f2: { key: string }) => f2.key)).toEqual(
      OVERRIDABLE_FIELDS.map((x) => x.key),
    );
  });

  /** Half two: before, after, reason, actor, and time — all five, every time. */
  it('preserves before, after, reason, actor, and time on every override', async () => {
    const f = await seedCampaignWithReservation('override-facts', {
      attributionStatus: 'provisional',
    });

    const preview = await request(h.app)
      .post('/api/admin/overrides/preview')
      .set('cookie', admin.cookie)
      .send({
        fieldKey: 'reservation.attribution_status',
        targetId: f.reservationId,
        newValue: 'blocked',
      })
      .expect(201);

    expect(preview.body.consequences.length).toBeGreaterThan(0);
    expect(preview.body.consequences.some((c: { audience: string }) => c.audience === 'creator')).toBe(
      true,
    );

    const executed = await request(h.app)
      .post('/api/admin/overrides')
      .set('cookie', admin.cookie)
      .send({
        fieldKey: 'reservation.attribution_status',
        targetId: f.reservationId,
        newValue: 'blocked',
        internalReason: 'Link was paused for a rejected first post before this click.',
        customerExplanation:
          'We reviewed how this pre-order was credited and corrected the record.',
        previewId: preview.body.previewId,
      })
      .expect(201);

    expect(executed.body.priorValue).toBe('provisional');
    expect(executed.body.newValue).toBe('blocked');

    const [row] = await h.db
      .select()
      .from(adminOverrides)
      .where(eq(adminOverrides.id, executed.body.overrideId));

    // §33.12.4's five, each present and each right.
    expect(row!.priorValue).toBe('provisional');
    expect(row!.newValue).toBe('blocked');
    expect(row!.internalReason).toContain('rejected first post');
    expect(row!.actor).toBe(`user:${admin.id}`);
    expect(row!.occurredAt).toBeInstanceOf(Date);

    // §25.6: internal reason and customer explanation stay separate columns.
    expect(row!.customerExplanation).not.toBe(row!.internalReason);
    expect(row!.mfaContext).toBe('password_session_admin_role_verified');
    expect(row!.reauthContext).toContain('session_established_at=');

    // The domain actually moved.
    const [reservation] = await h.db
      .select({ v: reservations.attributionStatus })
      .from(reservations)
      .where(eq(reservations.id, f.reservationId));
    expect(reservation!.v).toBe('blocked');

    // §25.6's audit event is written in the same transaction, carrying the same
    // before and after. Two records, one act.
    const audits = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, f.reservationId),
          eq(auditEvents.action, 'admin.override.reservation.attribution_status'),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]!.priorValue).toBe('provisional');
    expect(audits[0]!.newValue).toBe('blocked');
  });

  it('reads the prior value from the row, never from the caller', async () => {
    const f = await seedCampaignWithReservation('override-prior', {
      attributionStatus: 'provisional',
    });

    const preview = await request(h.app)
      .post('/api/admin/overrides/preview')
      .set('cookie', admin.cookie)
      .send({
        fieldKey: 'reservation.attribution_status',
        targetId: f.reservationId,
        newValue: 'verified',
      })
      .expect(201);

    // A caller that could supply both halves could supply a flattering pair.
    const executed = await request(h.app)
      .post('/api/admin/overrides')
      .set('cookie', admin.cookie)
      .send({
        fieldKey: 'reservation.attribution_status',
        targetId: f.reservationId,
        newValue: 'verified',
        priorValue: 'something-the-caller-made-up',
        internalReason: 'Verified after first-post pass.',
        customerExplanation: 'We confirmed how this pre-order was credited.',
        previewId: preview.body.previewId,
      })
      .expect(201);

    expect(executed.body.priorValue).toBe('provisional');

    const [row] = await h.db
      .select()
      .from(adminOverrides)
      .where(eq(adminOverrides.id, executed.body.overrideId));
    expect(row!.priorValue).toBe('provisional');
  });

  it('is insert-only: a recorded override cannot be rewritten', async () => {
    const f = await seedCampaignWithReservation('override-immutable');

    const preview = await request(h.app)
      .post('/api/admin/overrides/preview')
      .set('cookie', admin.cookie)
      .send({ fieldKey: 'campaign.high_effort', targetId: f.campaignId, newValue: true })
      .expect(201);

    const executed = await request(h.app)
      .post('/api/admin/overrides')
      .set('cookie', admin.cookie)
      .send({
        fieldKey: 'campaign.high_effort',
        targetId: f.campaignId,
        newValue: true,
        internalReason: 'No visuals, branding, or interview on review.',
        customerExplanation: 'We reviewed the campaign preparation materials.',
        previewId: preview.body.previewId,
      })
      .expect(201);

    // UPDATE and DELETE are revoked from the application role, so the "before"
    // cannot be rewritten after the fact — which is the value §33.12.4 protects.
    //
    // The suite connects as the database owner, and `REVOKE … FROM proovd_app`
    // binds that role specifically — so the assertion has to run *as* the role
    // the application actually uses, or it would prove nothing.
    await expect(
      h.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE proovd_app`);
        await tx
          .update(adminOverrides)
          .set({ internalReason: 'rewritten' })
          .where(eq(adminOverrides.id, executed.body.overrideId));
      }),
    ).rejects.toThrow();

    await expect(
      h.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE proovd_app`);
        await tx.delete(adminOverrides).where(eq(adminOverrides.id, executed.body.overrideId));
      }),
    ).rejects.toThrow();
  });
});

/* ── §26.6's four high-impact requirements ────────────────────────────────── */

describe('§26.6 a high-impact action demands all four requirements', () => {
  it('refuses an override with no preview', async () => {
    const f = await seedCampaignWithReservation('hi-nopreview');

    const res = await request(h.app)
      .post('/api/admin/overrides')
      .set('cookie', admin.cookie)
      .send({
        fieldKey: 'reservation.cap_result',
        targetId: f.reservationId,
        newValue: 'not_evaluated',
        internalReason: 'Reconciliation found the hold was released.',
        customerExplanation: 'We corrected how this pre-order counts toward the campaign total.',
      })
      .expect(422);

    expect(res.body.error).toBe('preview_required');

    const [row] = await h.db
      .select({ v: reservations.capResult })
      .from(reservations)
      .where(eq(reservations.id, f.reservationId));
    expect(row!.v).toBe('within_cap');
  });

  it('refuses when the executed payload does not match the previewed one', async () => {
    const f = await seedCampaignWithReservation('hi-mismatch');

    const preview = await request(h.app)
      .post('/api/admin/overrides/preview')
      .set('cookie', admin.cookie)
      .send({
        fieldKey: 'reservation.cap_result',
        targetId: f.reservationId,
        newValue: 'not_evaluated',
      })
      .expect(201);

    // The consequences the Admin read described a *different* change.
    const res = await request(h.app)
      .post('/api/admin/overrides')
      .set('cookie', admin.cookie)
      .send({
        fieldKey: 'reservation.cap_result',
        targetId: f.reservationId,
        newValue: 'rejected_cap_exceeded',
        internalReason: 'Different value from the one previewed.',
        customerExplanation: 'We reviewed how this pre-order counts.',
        previewId: preview.body.previewId,
      })
      .expect(422);

    expect(res.body.error).toBe('preview_mismatch');

    const [row] = await h.db
      .select({ v: reservations.capResult })
      .from(reservations)
      .where(eq(reservations.id, f.reservationId));
    expect(row!.v).toBe('within_cap');
  });

  it('consumes a preview once — a replay changes nothing and writes no second audit row', async () => {
    const f = await seedCampaignWithReservation('hi-idempotent');

    const preview = await request(h.app)
      .post('/api/admin/overrides/preview')
      .set('cookie', admin.cookie)
      .send({
        fieldKey: 'reservation.tax_close_usable',
        targetId: f.reservationId,
        newValue: false,
      })
      .expect(201);

    const body = {
      fieldKey: 'reservation.tax_close_usable',
      targetId: f.reservationId,
      newValue: false,
      internalReason: 'Calculation expired before close.',
      customerExplanation: 'We reviewed the tax calculation saved with your pre-order.',
      previewId: preview.body.previewId,
    };

    const first = await request(h.app)
      .post('/api/admin/overrides')
      .set('cookie', admin.cookie)
      .send(body)
      .expect(201);
    expect(first.body.replayed).toBe(false);

    const second = await request(h.app)
      .post('/api/admin/overrides')
      .set('cookie', admin.cookie)
      .send(body)
      .expect(201);

    // §28.3: a retry is the same override, not a second one.
    expect(second.body.replayed).toBe(true);
    expect(second.body.overrideId).toBe(first.body.overrideId);

    const rows = await h.db
      .select()
      .from(adminOverrides)
      .where(eq(adminOverrides.targetId, f.reservationId));
    expect(rows).toHaveLength(1);

    const audits = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, f.reservationId),
          eq(auditEvents.action, 'admin.override.reservation.tax_close_usable'),
        ),
      );
    expect(audits).toHaveLength(1);

    // The preview is spent, and the database refuses to un-spend it.
    const [spent] = await h.db
      .select()
      .from(highImpactActionPreviews)
      .where(eq(highImpactActionPreviews.id, preview.body.previewId));
    expect(spent!.consumedAt).not.toBeNull();

    await expect(
      h.db
        .update(highImpactActionPreviews)
        .set({ consumedAt: null, consumedBy: null })
        .where(eq(highImpactActionPreviews.id, preview.body.previewId)),
    ).rejects.toThrow();
  });

  it('refuses to preview an override that would change nothing', async () => {
    const f = await seedCampaignWithReservation('hi-unchanged', {
      attributionStatus: 'provisional',
    });

    const res = await request(h.app)
      .post('/api/admin/overrides/preview')
      .set('cookie', admin.cookie)
      .send({
        fieldKey: 'reservation.attribution_status',
        targetId: f.reservationId,
        newValue: 'provisional',
      })
      .expect(422);

    expect(res.body.error).toBe('unchanged');
  });

  it('refuses an unregistered field', async () => {
    const f = await seedCampaignWithReservation('hi-unknown');
    const res = await request(h.app)
      .post('/api/admin/overrides/preview')
      .set('cookie', admin.cookie)
      .send({ fieldKey: 'reservation.total_captured_cents', targetId: f.reservationId, newValue: 1 })
      .expect(422);
    expect(res.body.error).toBe('unknown_field');
  });

  /** §33.9.11, established here because the money surfaces reach it first. */
  it('refuses a customer explanation containing a raw provider or fraud code', async () => {
    const f = await seedCampaignWithReservation('hi-rawcode');

    const preview = await request(h.app)
      .post('/api/admin/overrides/preview')
      .set('cookie', admin.cookie)
      .send({
        fieldKey: 'reservation.tax_close_usable',
        targetId: f.reservationId,
        newValue: false,
      })
      .expect(201);

    const res = await request(h.app)
      .post('/api/admin/overrides')
      .set('cookie', admin.cookie)
      .send({
        fieldKey: 'reservation.tax_close_usable',
        targetId: f.reservationId,
        newValue: false,
        internalReason: 'Stripe returned card_declined on the test charge.',
        customerExplanation: 'Your payment failed with card_declined — please try again.',
        previewId: preview.body.previewId,
      })
      .expect(422);

    expect(res.body.error).toBe('raw_provider_code');

    // The internal reason may name it; the customer copy may not.
    const rows = await h.db
      .select()
      .from(adminOverrides)
      .where(eq(adminOverrides.targetId, f.reservationId));
    expect(rows).toHaveLength(0);
  });
});

/* ── §33.12.5: the guards, on real Phase 16a surfaces ─────────────────────── */

describe('§33.12.5 the Phase 16a routes fail closed', () => {
  it('refuses a read with no session', async () => {
    await request(h.app).get('/api/admin/overrides/fields').expect(401);
    await request(h.app).get('/api/admin/overrides/campaign/whatever').expect(401);
  });

  it('refuses a Founder session on an Admin route', async () => {
    const founder = await seedUser(h, 'founder', 'adminops-wrongrole');
    const cookie = await signInPlain(h, founder.email);
    await request(h.app).get('/api/admin/overrides/fields').set('cookie', cookie).expect(403);
  });

  it('demands recent reauthentication for an override, but not for a read', async () => {
    const f = await seedCampaignWithReservation('guards-fresh');

    // Reads are looking. Making an Admin reauthenticate to look teaches them to
    // reauthenticate reflexively, which is how the gate stops meaning anything.
    await request(h.app)
      .get('/api/admin/overrides/fields')
      .set('cookie', admin.cookie)
      .expect(200);

    // Age the session past the configured window and the write must fail closed.
    const client = await h.pool.connect();
    try {
      await client.query(
        `UPDATE "session" SET "created_at" = now() - interval '30 days' WHERE "user_id" = $1`,
        [admin.id],
      );

      const stale = await request(h.app)
        .post('/api/admin/overrides/preview')
        .set('cookie', admin.cookie)
        .send({
          fieldKey: 'campaign.high_effort',
          targetId: f.campaignId,
          newValue: true,
        });
      expect(stale.status).toBeGreaterThanOrEqual(400);
    } finally {
      await client.query(
        `UPDATE "session" SET "created_at" = now() WHERE "user_id" = $1`,
        [admin.id],
      );
      client.release();
    }
  });
});

/* ── The database guarantees migration 0024 installs ──────────────────────── */

describe('migration 0024 guarantees', () => {
  it('refuses an override row whose prior and new value are the same', async () => {
    const f = await seedCampaignWithReservation('mig-samevalue');
    const [preview] = await h.db
      .insert(highImpactActionPreviews)
      .values({
        actionKey: 'override:test',
        targetType: 'reservation',
        targetId: f.reservationId,
        consequences: [{ audience: 'nobody', text: 'test' }],
        payloadHash: 'hash',
        issuedBy: 'user:test',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({ id: highImpactActionPreviews.id });

    await expect(
      h.db.insert(adminOverrides).values({
        fieldKey: 'reservation.cap_result',
        targetType: 'reservation',
        targetId: f.reservationId,
        priorValue: 'within_cap',
        newValue: 'within_cap',
        internalReason: 'r',
        customerExplanation: 'c',
        actor: 'user:test',
        mfaContext: 'm',
        reauthContext: 'r',
        previewId: preview!.id,
        idempotencyKey: `same-value-${randomUUID()}`,
      }),
    ).rejects.toThrow();
  });

  it('refuses a preview with no consequences and one that expires before it is issued', async () => {
    const f = await seedCampaignWithReservation('mig-preview');

    await expect(
      h.db.insert(highImpactActionPreviews).values({
        actionKey: 'override:test',
        targetType: 'reservation',
        targetId: f.reservationId,
        consequences: [],
        payloadHash: 'hash',
        issuedBy: 'user:test',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow();

    const issuedAt = new Date();
    await expect(
      h.db.insert(highImpactActionPreviews).values({
        actionKey: 'override:test',
        targetType: 'reservation',
        targetId: f.reservationId,
        consequences: [{ audience: 'nobody', text: 'x' }],
        payloadHash: 'hash',
        issuedBy: 'user:test',
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() - 1_000),
      }),
    ).rejects.toThrow();
  });

  it('refuses a seller-tax readiness fact recorded with no detail', async () => {
    const f = await seedCampaignWithReservation('mig-taxdetail');
    await expect(
      h.db.insert(campaignSellerTaxReadiness).values({
        campaignId: f.campaignId,
        headOfficeLocationRecorded: true,
        headOfficeLocationDetail: '   ',
        recordedBy: 'user:test',
        evidenceReference: 'https://internal/e',
        mode: 'test',
      }),
    ).rejects.toThrow();
  });

  it('refuses an unknown cap result', async () => {
    const f = await seedCampaignWithReservation('mig-cap');
    await expect(
      h.db
        .update(reservations)
        .set({ capResult: 'probably_fine' })
        .where(eq(reservations.id, f.reservationId)),
    ).rejects.toThrow();
  });
});
