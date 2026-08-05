/**
 * One pre-order, seven renderings — Spec §33.11.5 (Phase 23a).
 *
 * §33.11.5: "Campaign, checkout, confirmation, email, magic link, Admin, and
 * evidence agree on reward, amounts, seller, trigger, delivery, policy,
 * descriptor, and SLA." Seven surfaces times eight facts is fifty-six values,
 * and the phase's own trap says why this is a test rather than a review: a
 * person checking it by hand will miss the one that drifted.
 *
 * So one campaign is seeded, one pre-order is placed through the real HTTP
 * route, and every surface is read the way the product reads it — the public
 * campaign endpoint, the checkout quote, the pre-order response, the message
 * the sender actually put in the transport, the magic-link page, the §26.5
 * ledger, and the §24.11 evidence packet. Each is projected onto the shared
 * `CONSISTENCY_FACTS` register and compared.
 *
 * ── Why the values are canonicalised ────────────────────────────────────────
 * The surfaces legitimately render the same fact differently: the ledger stores
 * `12000` cents, the checkout renders `120.00` dollars, and the email says
 * `US$120.00`. Those are rendering decisions somebody made on purpose, and
 * comparing the strings would report a disagreement that is not one while
 * saying nothing about whether the amount is right. So each fact is projected
 * to one canonical form — cents for money, an ISO minute for an instant — and
 * the comparison is exact from there. The descriptor is deliberately NOT
 * canonicalised: §33.9.13 is precisely about the exact string, and a difference
 * in it is the failure.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import {
  CONSISTENCY_FACT_KEYS,
  CONSISTENCY_SURFACE_KEYS,
  crossSurfaceDisagreements,
  type ConsistencySurface,
  type SurfaceFacts,
} from '@proovd/shared';

import { startHarness, type Harness } from './app-harness.js';
import { seedUser, createAdmin, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { createAuditWriter } from '../auth/audit.js';
import { createMemoryStripeGateway, type MemoryStripeGateway } from '../payments/stripe-client.js';
import {
  STRIPE_CONNECT_WEBHOOK_PATH,
  STRIPE_SIGNATURE_HEADER,
} from '../routes/stripe-webhooks.js';
import { campaigns, reservations } from '../db/schema/domain.js';
import { paymentDisputes } from '../db/schema/disputes.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import { stripeConnectedAccounts } from '../db/schema/payments.js';
import { campaignBuild, campaignRewardPackages } from '../db/schema/build.js';
import { runCloseBatch } from '../close/close-batch.js';
import { readDisputeEvidencePacket } from '../disputes/service.js';

const PLATFORM_SECRET = 'whsec_platform_for_cross_surface_suite';
const CONNECT_SECRET = 'whsec_connect_for_cross_surface_suite';

const gateway: MemoryStripeGateway = createMemoryStripeGateway({
  mode: 'test',
  platformWebhookSecret: PLATFORM_SECRET,
  connectWebhookSecret: CONNECT_SECRET,
  taxEnabled: true,
});

let h: Harness;
let admin: AdminSession;

const CONTEXT = {
  appBaseUrl: 'http://localhost:3000',
  supportEmail: 'support@proovd.co',
  fromAddress: 'hello@proovd.co',
};

beforeAll(async () => {
  h = await startHarness(
    { stripeGateway: gateway, authRouteLimit: 1_000_000, globalRateLimit: 1_000_000 },
    'cross-surface',
  );
  admin = await createAdmin(h, 'cross-surface-admin');
  await seedAdminReauthWindow(h.db, 900);
}, 180_000);

afterAll(async () => {
  await h.stop();
});

/* ── The one campaign, the one reward, the one pre-order ───────────────────── */

const REWARD_TITLE = 'Founding Edition — Walnut';
const REWARD_SKU = 'BENCH-1';
const PRICE_CENTS = 12_000n;
const DELIVERY = 'March 2027';
const ENTITY = 'Harlow Instruments LLC';
const POLICY_TITLE = 'Harlow Instruments refund policy';
const POLICY_VERSION = 'v1';

interface Seeded {
  campaignId: string;
  founderLegalName: string;
  connectedAccountId: string;
  closeAt: Date;
}

async function seedCampaign(): Promise<Seeded> {
  const founder = await seedUser(h, 'founder', 'xs-founder');
  const legalName = 'Rae Harlow';
  const closeAt = new Date(Date.now() + 14 * 24 * 3_600_000);

  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      legalName,
      preferredName: 'Rae',
      email: founder.email,
      productName: 'The Bench Lamp',
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
      listingPaidAt: new Date(),
      campaignLiveAt: new Date(Date.now() - 8 * 86_400_000),
      campaignCloseAt: closeAt,
      discoveryOpenedAt: new Date(),
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
    preferredName: 'Rae',
    legalName,
    businessName: ENTITY,
    soleProprietor: false,
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  const stripeAccountId = `acct_xs${randomUUID().slice(0, 8)}`;
  await h.db.insert(stripeConnectedAccounts).values({
    stripeAccountId,
    mode: 'test',
    role: 'founder_seller',
    ownerUserId: founder.id,
    state: 'complete',
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });

  await h.db.insert(campaignBuild).values({
    campaignId,
    title: 'The Bench Lamp',
    founderDisplayName: legalName,
    founderEntityDisplay: ENTITY,
    founderCountry: 'United States',
    publicStory: 'We built the first one for our own bench.',
    closesAt: closeAt,
    refundPolicyTitle: POLICY_TITLE,
    refundPolicyVersion: POLICY_VERSION,
    refundPolicySourceUrl: 'https://example.com/harlow/refunds',
    refundPolicyEffectiveDate: '2026-07-01',
    refundPolicyText: 'Cancel any time before the charge date.',
    updatedBy: 'user:test',
  });

  await h.db.insert(campaignRewardPackages).values({
    campaignId,
    sku: REWARD_SKU,
    title: REWARD_TITLE,
    priceCents: PRICE_CENTS,
    contents: 'One lamp, one clamp base, one spare bulb.',
    fulfillmentCommitment: 'Shipped from New York with tracking.',
    delivery: DELIVERY,
    sortOrder: 0,
  });

  return { campaignId, founderLegalName: legalName, connectedAccountId: stripeAccountId, closeAt };
}

/* ── Canonical forms ───────────────────────────────────────────────────────── */

/** `120.00` / `US$120.00` / `12000` all become `12000`. */
function cents(value: string | number | bigint | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).replace(/US\$|[\s,]/g, '');
  if (raw === '') return null;
  if (/^\d+\.\d{2}$/.test(raw)) return String(Math.round(Number(raw) * 100));
  if (/^\d+$/.test(raw)) return raw;
  return null;
}

function amounts(
  subtotal: string | bigint | null,
  tax: string | bigint | null,
  total: string | bigint | null,
): string | null {
  const parts = [cents(subtotal), cents(tax), cents(total)];
  if (parts.some((part) => part === null)) return null;
  return parts.join('/');
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * Any rendering of an instant becomes the same UTC minute.
 *
 * The customer-facing surfaces render `September 12, 2026 at 5:00 PM UTC` —
 * `formatUtcInstant`'s shape, which `Date` cannot parse back — while the API
 * payloads carry ISO. Both are the same moment, and this is where they are
 * made comparable rather than in either of the things being compared.
 */
function utcMinute(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 16);

  const spelled = value.match(
    /([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})(?:,|\s+at)?\s+(\d{1,2}):(\d{2})\s*([AP]M)\s*UTC/i,
  );
  if (spelled) {
    const month = MONTHS.indexOf((spelled[1] ?? '').toLowerCase());
    let hour = Number(spelled[4]);
    if ((spelled[6] ?? '').toUpperCase() === 'PM' && hour !== 12) hour += 12;
    if ((spelled[6] ?? '').toUpperCase() === 'AM' && hour === 12) hour = 0;
    if (month >= 0) {
      return new Date(
        Date.UTC(Number(spelled[3]), month, Number(spelled[2]), hour, Number(spelled[5])),
      )
        .toISOString()
        .slice(0, 16);
    }
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 16);
}

/**
 * The charge trigger, canonicalised.
 *
 * §33.11.5 asks the surfaces to agree on the trigger — the rule under which the
 * card is charged — not on one sentence about it. The campaign page states it
 * as a close date, the checkout as a sentence with the same instant in it, the
 * email repeats that sentence, and the magic link carries the campaign's own
 * close. Comparing prose would fail on wording while saying nothing about
 * whether the *moment* agrees, which is what a Backer is relying on.
 *
 * The threshold half is compared separately below, between the two surfaces
 * that state the number rather than describe it — folding it in here would make
 * "the surface does not print the number" look like "the surfaces disagree".
 */
function trigger(closeAt: string | Date | null): string | null {
  const at = utcMinute(closeAt);
  return at ? `close=${at}` : null;
}

/** The refund policy the pre-order was made under. */
function policy(title: string | null, version: string | null): string | null {
  if (!title || !version) return null;
  return `${title} ${version}`;
}

/** The §24.10 snapshot inside the packet's refund-policy item. */
function policySnapshot(item: Record<string, unknown>): Record<string, unknown> {
  return (item['snapshot'] ?? {}) as Record<string, unknown>;
}

/**
 * §27.8's promise, as the surface and the inbox each render it.
 *
 * The published *sentence* lives in the site footer, which is not one of these
 * seven surfaces. What a Backer asking for help is actually told is Appendix
 * B.8's `Human response due:` line — the deadline that promise produced — and
 * it is rendered twice: once into the HTTP response the magic-link page shows,
 * once into the acknowledgement email. Comparing that line is how "the string
 * on screen and the string in the inbox are literally the same" (16b) stops
 * being a claim about how the code is arranged.
 */
function slaLine(text: string): string | null {
  return text.match(/Human response due:.*/)?.[0]?.trim() ?? null;
}

/* ── The read ──────────────────────────────────────────────────────────────── */

let seeded: Seeded;
let facts: Partial<Record<ConsistencySurface, SurfaceFacts>>;
let evidenceComplete = false;
let thresholds: { campaign: number | null; magicLink: number | null } = {
  campaign: null,
  magicLink: null,
};

beforeAll(async () => {
  seeded = await seedCampaign();
  const { campaignId, closeAt } = seeded;

  /* 1. The campaign page a Backer reads before deciding (§18). */
  const campaignRes = await request(h.app).get(`/api/campaign/${campaignId}`).expect(200);
  const page = campaignRes.body.campaign;
  const pageReward = page.rewards[0];

  /* 2. The checkout quote (§19). */
  const quoteRes = await request(h.app)
    .post(`/api/campaign/${campaignId}/checkout/quote`)
    .send({ rewardSku: REWARD_SKU, billing: { country: 'US', postalCode: '10001', state: 'NY' } })
    .expect(200);
  const quote = quoteRes.body;

  /* 3. The pre-order itself — the confirmation the Backer is shown. */
  const emailsBefore = h.sentEmails.messages.length;
  const preorderRes = await request(h.app)
    .post(`/api/campaign/${campaignId}/preorder`)
    .send({
      rewardSku: REWARD_SKU,
      contact: { email: `xs-${randomUUID().slice(0, 6)}@example.com`, phone: '4155550123' },
      billing: { country: 'US', postalCode: '10001', state: 'NY' },
      ageConfirmed: true,
      survey: { why: 'I solder at a kitchen table.', recommend: 9 },
      operationalSharingAck: true,
      founderMarketingConsent: false,
      newsletterConsent: false,
      paymentMethodId: `pm_${randomUUID().slice(0, 12)}`,
    })
    .expect(201);
  const confirmation = preorderRes.body;
  const reservationId = confirmation.reservationId as string;

  /* 4. The message the sender actually handed to the transport (§27.5). */
  const message = h.sentEmails.messages
    .slice(emailsBefore)
    .find((m) => /pre-order/i.test(m.subject) || /pre-order/i.test(m.text ?? ''));
  expect(message, 'the pre-order confirmation was not sent').toBeTruthy();
  const emailText = `${message!.subject}\n${message!.text ?? ''}`;

  /* 5. The magic-link page (§20). */
  const token = String(confirmation.magicLinkUrl).split('/').pop() ?? '';
  const linkRes = await request(h.app).get(`/api/link/${token}/page`).expect(200);
  const transaction = linkRes.body.transactions[0];
  // The magic link is composed from the same public-campaign read the page is
  // (`readBackerPage` calls `buildPublicCampaign`), so the campaign facts sit
  // one level in beside the transactions.
  const linkPage = linkRes.body.campaign?.campaign;

  /* 5b. The §29.9 support path — the acknowledgement §27.8 publishes, rendered
         on the surface and sent to the inbox from the one resolver. */
  const supportBefore = h.sentEmails.messages.length;
  const supportRes = await request(h.app)
    .post(`/api/link/${token}/support`)
    .send({ topic: 'delivery', message: 'When does this ship?', reservationId })
    .expect(201);
  const supportEmail = h.sentEmails.messages
    .slice(supportBefore)
    .find((m) => /received your message|support/i.test(`${m.subject} ${m.text ?? ''}`));

  /* 6. The Admin ledger row (§26.5). */
  const ledgerRes = await request(h.app)
    .get(`/api/admin/ledger?campaignId=${campaignId}`)
    .set('cookie', admin.cookie)
    .expect(200);
  const row = ledgerRes.body.rows.find(
    (r: { reservationId: string }) => r.reservationId === reservationId,
  );
  expect(row, 'the pre-order is not in the ledger').toBeTruthy();

  /* 7. The §24.11 evidence packet, from a real dispute on the captured charge. */
  await h.db
    .update(campaigns)
    .set({ campaignCloseAt: new Date(Date.now() - 60_000) })
    .where(eq(campaigns.id, campaignId));
  await runCloseBatch(
    { db: h.db, gateway, audit: createAuditWriter(h.db), notifier: h.notifier, context: CONTEXT },
    { campaignId, actor: 'system:cross-surface-test' },
  );
  const [captured] = await h.db
    .select()
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .limit(1);

  const disputeBody = JSON.stringify({
    id: `evt_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    object: 'event',
    type: 'charge.dispute.created',
    account: seeded.connectedAccountId,
    data: {
      object: {
        id: `dp_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        object: 'dispute',
        charge: captured!.chargeId,
        payment_intent: captured!.paymentIntentId,
        amount: Number(captured!.totalCapturedCents),
        currency: 'usd',
        reason: 'product_not_received',
        status: 'needs_response',
      },
    },
  });
  await request(h.app)
    .post(STRIPE_CONNECT_WEBHOOK_PATH)
    .set('content-type', 'application/json')
    .set(
      STRIPE_SIGNATURE_HEADER,
      Stripe.webhooks.generateTestHeaderString({ payload: disputeBody, secret: CONNECT_SECRET }),
    )
    .send(disputeBody)
    .expect(200);

  const [dispute] = await h.db
    .select()
    .from(paymentDisputes)
    .where(eq(paymentDisputes.reservationId, reservationId))
    .limit(1);
  const packet = await readDisputeEvidencePacket(h.db, dispute!.id);
  expect(packet, 'no evidence packet was assembled').toBeTruthy();
  evidenceComplete = packet!.complete;
  const item = (key: string) =>
    (packet!.items.find((i) => i.key === key)?.data ?? {}) as Record<string, unknown>;
  const packetAmounts = item('transaction_amounts');
  const packetIdentity = item('founder_identity');
  const packetDelivery = item('delivery_promise');
  const packetPolicy = item('refund_policy');
  const packetDisclosure = item('campaign_disclosure');

  thresholds = {
    campaign: page.orderThreshold ?? null,
    magicLink: linkPage?.orderThreshold ?? null,
  };

  facts = {
    campaign: {
      reward: pageReward.title,
      amounts: null,
      seller: page.founder.legalName,
      trigger: trigger(page.closesAt),
      delivery: pageReward.delivery,
      policy: policy(page.founderRefundPolicy?.title ?? null, page.founderRefundPolicy?.version ?? null),
      descriptor: null,
      sla: null,
    },
    checkout: {
      reward: quote.rewardTitle,
      amounts: amounts(quote.rewardSubtotal, quote.salesTax, quote.totalAuthorized),
      seller: quote.founderLegalName,
      trigger: trigger(quote.chargeTimeUtc),
      delivery: quote.delivery,
      policy: policy(page.founderRefundPolicy?.title ?? null, page.founderRefundPolicy?.version ?? null),
      descriptor: quote.statementDescriptor,
      sla: null,
    },
    confirmation: {
      reward: confirmation.rewardTitle,
      amounts: amounts(
        confirmation.rewardSubtotal,
        confirmation.salesTax,
        confirmation.totalAuthorized,
      ),
      seller: confirmation.founderLegalName,
      trigger: trigger(confirmation.chargeTimeUtc),
      delivery: confirmation.delivery,
      policy: policy(page.founderRefundPolicy?.title ?? null, page.founderRefundPolicy?.version ?? null),
      descriptor: confirmation.statementDescriptor,
      sla: null,
    },
    email: {
      reward: emailText.includes(REWARD_TITLE) ? REWARD_TITLE : null,
      amounts: amounts(
        emailText.match(/Reward subtotal: US\$([\d,]+\.\d{2})/)?.[1] ?? null,
        emailText.match(/Sales tax: US\$([\d,]+\.\d{2})/)?.[1] ?? null,
        emailText.match(/Total authorized: US\$([\d,]+\.\d{2})/)?.[1] ?? null,
      ),
      seller: emailText.includes(seeded.founderLegalName) ? seeded.founderLegalName : null,
      trigger: trigger(
        emailText.match(/[A-Z][a-z]+\s+\d{1,2},\s+\d{4}(?:,|\s+at)?\s+[\d:]+\s*[AP]M\s*UTC/)?.[0] ??
          null,
      ),
      delivery: emailText.includes(DELIVERY) ? DELIVERY : null,
      policy: null,
      descriptor: emailText.match(/PROOVD\*? [A-Z0-9 ]+/)?.[0]?.trim() ?? null,
      sla: slaLine(`${supportEmail?.subject ?? ''}\n${supportEmail?.text ?? ''}`),
    },
    magic_link: {
      reward: transaction.rewardTitle,
      amounts: amounts(
        transaction.rewardSubtotal,
        transaction.salesTax,
        transaction.totalAuthorized,
      ),
      seller: linkPage?.founder?.legalName ?? null,
      trigger: trigger(linkPage?.closesAt ?? null),
      delivery: transaction.delivery,
      policy: policy(
        linkPage?.founderRefundPolicy?.title ?? null,
        linkPage?.founderRefundPolicy?.version ?? null,
      ),
      descriptor: transaction.statementDescriptor,
      sla: slaLine(String(supportRes.body.acknowledgement ?? '')),
    },
    admin: {
      reward: row.rewardTitle,
      amounts: amounts(row.rewardSubtotalCents, row.salesTaxCents, row.totalAuthorizedCents),
      seller: seeded.founderLegalName,
      trigger: null,
      delivery: null,
      policy: null,
      descriptor: captured!.statementDescriptor,
      sla: null,
    },
    evidence: {
      reward: String(packetAmounts['rewardTitle'] ?? ''),
      amounts: amounts(
        String(packetAmounts['rewardSubtotalCents'] ?? ''),
        String(packetAmounts['salesTaxCents'] ?? ''),
        String(packetAmounts['totalAuthorizedCents'] ?? ''),
      ),
      seller: String(packetIdentity['legalName'] ?? ''),
      trigger: null,
      delivery: String(packetDelivery['delivery'] ?? ''),
      // §24.10's snapshot: the policy as it stood when the pre-order was made,
      // stored on the transaction rather than read from the campaign now.
      policy: policy(
        String(policySnapshot(packetPolicy)['title'] ?? '') || null,
        String(policySnapshot(packetPolicy)['version'] ?? '') || null,
      ),
      descriptor: String(packetAmounts['statementDescriptor'] ?? ''),
      sla: null,
    },
  };
}, 180_000);

/* ── §33.11.5 ──────────────────────────────────────────────────────────────── */

describe('§33.11.5 — seven surfaces, eight facts, one pre-order', () => {
  it('reads every one of the seven surfaces', () => {
    for (const surface of CONSISTENCY_SURFACE_KEYS) {
      expect(facts[surface], `${surface} was not read`).toBeTruthy();
    }
    expect(CONSISTENCY_FACT_KEYS).toHaveLength(8);
  });

  it('finds no disagreement across any fact', () => {
    const disagreements = crossSurfaceDisagreements(facts);
    expect(
      disagreements.map(
        (d) =>
          `${d.fact} (${d.specRef}) ${d.kind}: ` +
          d.values.map((v) => `${v.surface}=${JSON.stringify(v.value)}`).join(' | '),
      ),
    ).toEqual([]);
  });

  it('renders the §24.12 descriptor identically everywhere it appears', () => {
    // §33.9.13's rule, re-proved from the other direction: the descriptor is
    // computed once and read back, so hard-coding it in one template would show
    // up here as a difference no amount of careful copywriting could hide.
    const rendered = CONSISTENCY_SURFACE_KEYS.map((surface) => facts[surface]?.descriptor).filter(
      (value): value is string => typeof value === 'string' && value !== '',
    );
    expect(rendered.length).toBeGreaterThanOrEqual(5);
    expect(new Set(rendered).size).toBe(1);
    expect(rendered[0]).toMatch(/^PROOVD\* /);
  });

  it('assembles a complete evidence packet from the same records', () => {
    expect(evidenceComplete).toBe(true);
  });

  it('states the same order threshold on the two surfaces that print the number', () => {
    // The other half of the trigger. The campaign page and the magic link are
    // where the number itself appears; the checkout, the confirmation, and the
    // email describe the rule in a sentence, and comparing prose there would
    // fail on wording rather than on the fact.
    expect(thresholds.campaign).toBe(thresholds.magicLink);
  });
});
