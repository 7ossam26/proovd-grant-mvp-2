/**
 * Phase 09b — the embedded interview, its webhook, and §27.3's four
 * notifications. Spec §12, §27.2, §27.3, §28.3, tech-stack §12.
 *
 * §33.3.1–4 are 09a's and are proved in `campaign-workspace.test.ts` against the
 * booking record. This file proves the vendor layer that feeds that record, and
 * the four rules a vendor integration has to satisfy before it is allowed near a
 * commercial term:
 *
 *   · an unsigned or wrongly signed delivery changes nothing;
 *   · a delivery cannot be attached to a campaign the booker does not own;
 *   · a redelivery updates audit and produces no second state and no second
 *     email (§28.3, §33.7.7's rule applied to this provider);
 *   · `confirmed` is reachable without a webhook at all (Phase 09's trap).
 *
 * The scheduler is injected, as the object storage was in 09a: what has to be
 * proved is what the *ingest* does with bytes, and a suite that reached the real
 * cal.com would prove that cal.com was up.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { campaigns } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import {
  founderInterviewBookings,
  interviewBookingEvents,
  campaignOptionalItems,
} from '../db/schema/workspace.js';
import { providerEvents, notificationDeliveries, auditEvents } from '../db/schema/integrity.js';
import { ensureWorkspace } from '../workspace/service.js';
import { recordBooking } from '../workspace/interview.js';
import { sendDueReminders, sweepAbandonedBookings } from '../interviews/jobs.js';
import { interviewReference, verifyInterviewReference } from '../interviews/reference.js';
import {
  parseVendorEvent,
  createCalcomScheduler,
  unconfiguredScheduler,
  CALCOM_SIGNATURE_HEADER,
  HANDLED_TRIGGERS,
} from '../interviews/calcom.js';
import { CALCOM_WEBHOOK_PATH } from '../routes/calcom-webhook.js';
import { MEETING_PROVIDER_LABELS } from '../interviews/labels.js';
import {
  FOUNDER_INTERVIEW_CONFIRMED,
  FOUNDER_INTERVIEW_REMINDER,
  FOUNDER_INTERVIEW_RESCHEDULED,
  FOUNDER_INTERVIEW_CANCELED,
  BACKEND_NOTIFICATION_EVENTS,
} from '../notifications/events.js';
import { renderInterviewEmail } from '../notifications/templates/founder-interview.js';
import {
  NOTIFICATION_EVENTS,
  MEETING_PROVIDER_LABELS as SHARED_PROVIDER_LABELS,
} from '@proovd/shared';

const WEBHOOK_SECRET = 'a-webhook-secret-for-the-suite';
/** The suite's own copy of the app's auth secret — it keys the reference HMAC. */
const TEST_AUTH_SECRET = 'test-auth-secret-value-at-least-32-chars';

const scheduler = createCalcomScheduler({
  apiKey: 'cal_test_key',
  webhookSecret: WEBHOOK_SECRET,
  eventTypeLink: 'proovd/founder-interview',
});

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness(
    {
      authSecret: TEST_AUTH_SECRET,
      interviewScheduler: scheduler,
      authRouteLimit: 1_000_000,
      globalRateLimit: 1_000_000,
    },
    'interviews',
  );
  admin = await createAdmin(h, 'interview-admin');
  await seedAdminReauthWindow(h.db, 3600);
  await configureInterviews();
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

async function configureInterviews(): Promise<void> {
  const values: Record<string, string> = {
    interview_providers: 'Zoom\nGoogle Meet',
    interview_availability: 'Mon–Fri 09:00–17:00 America/New_York',
    interviewers: 'Alex Interviewer',
    interview_reminder_lead_hours: '24',
  };
  for (const [key, value] of Object.entries(values)) {
    await h.db.execute(`
      UPDATE app_settings
         SET value = '${value.replace(/'/g, "''")}',
             updated_by = 'test',
             update_reason = 'stated for the acceptance suite'
       WHERE key = '${key}'
    `);
  }
}

interface Fixture {
  campaignId: string;
  founderEmail: string;
  cookie: string;
  reference: string;
}

async function makeCampaign(label: string): Promise<Fixture> {
  const founder = await seedUser(h, 'founder', label);

  const [campaign] = await h.db
    .insert(campaigns)
    .values({ status: 'account_claimed', type: 'pre_build', typeLockedAt: new Date() })
    .returning({ id: campaigns.id });

  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      preferredName: `Founder ${label}`,
      email: founder.email,
      productName: `Product ${label}`,
      createdBy: `user:${admin.id}`,
      claimedUserId: founder.id,
      claimedAt: new Date(),
    })
    .returning({ id: founderProspects.id });

  const [draft] = await h.db
    .insert(campaignDrafts)
    .values({
      prospectId: prospect!.id,
      campaignId: campaign!.id,
      status: 'claimed',
      createdBy: `user:${admin.id}`,
      updatedBy: `user:${admin.id}`,
    })
    .returning({ id: campaignDrafts.id });

  await h.db.insert(founderClaimProfiles).values({
    draftId: draft!.id,
    prospectId: prospect!.id,
    campaignId: campaign!.id,
    email: founder.email,
    preferredName: `Founder ${label}`,
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  await ensureWorkspace(h.db, { campaignId: campaign!.id, actor: 'test' });

  return {
    campaignId: campaign!.id,
    founderEmail: founder.email,
    cookie: await signInPlain(h, founder.email),
    reference: interviewReference(campaign!.id, TEST_AUTH_SECRET),
  };
}

interface PayloadOptions {
  trigger?: string;
  uid?: string;
  reference?: string | null;
  attendeeEmail?: string;
  startTime?: string;
  status?: string;
  location?: string;
  meetingLink?: string;
  interviewer?: string;
  timeZone?: string;
  cancellationReason?: string;
}

function payloadFor(fixture: Fixture, options: PayloadOptions = {}) {
  return {
    triggerEvent: options.trigger ?? 'BOOKING_CREATED',
    payload: {
      uid: options.uid ?? `cal-${randomUUID()}`,
      startTime: options.startTime ?? '2026-10-01T15:00:00.000Z',
      status: options.status ?? 'ACCEPTED',
      location: options.location ?? 'integrations:zoom',
      metadata: {
        proovdReference:
          options.reference === undefined ? fixture.reference : options.reference,
        videoCallUrl: options.meetingLink ?? 'https://zoom.example/j/123456',
      },
      organizer: { name: options.interviewer ?? 'Alex Interviewer', timeZone: 'UTC' },
      attendees: [
        {
          email: options.attendeeEmail ?? fixture.founderEmail,
          timeZone: options.timeZone ?? 'America/New_York',
        },
      ],
      ...(options.cancellationReason ? { cancellationReason: options.cancellationReason } : {}),
    },
  };
}

function sign(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(body)).digest('hex');
}

/** Returns the supertest chain, not a promise of it, so `.expect()` works. */
function deliver(body: unknown, signature?: string) {
  const raw = JSON.stringify(body);
  return request(h.app)
    .post(CALCOM_WEBHOOK_PATH)
    .set('content-type', 'application/json')
    .set(CALCOM_SIGNATURE_HEADER, signature ?? sign(raw))
    .send(raw);
}

const bookingsFor = (campaignId: string) =>
  h.db
    .select()
    .from(founderInterviewBookings)
    .where(eq(founderInterviewBookings.campaignId, campaignId));

const emailsTo = (address: string) => h.sentEmails.messages.filter((m) => m.to === address);

/* ── Drift ────────────────────────────────────────────────────────────────── */

describe('the four §27.3 keys now have senders', () => {
  it('registers them, and they exist in the shared §27 register', () => {
    for (const key of [
      FOUNDER_INTERVIEW_CONFIRMED,
      FOUNDER_INTERVIEW_REMINDER,
      FOUNDER_INTERVIEW_RESCHEDULED,
      FOUNDER_INTERVIEW_CANCELED,
    ]) {
      expect(BACKEND_NOTIFICATION_EVENTS).toContain(key);
      expect(Object.keys(NOTIFICATION_EVENTS)).toContain(key);
    }
  });

  it('does not leak an internal provider name into a customer-facing label', () => {
    // §3: an internal name in a Founder's inbox is exactly the leak §3.1 calls
    // a real risk. The backend restates the labels because it cannot import
    // shared at runtime; this is the drift test that keeps the two in step.
    expect(MEETING_PROVIDER_LABELS).toEqual(SHARED_PROVIDER_LABELS);
    expect(Object.values(MEETING_PROVIDER_LABELS)).toEqual([
      'Google Meet',
      'Zoom',
      'Microsoft Teams',
    ]);
  });
});

/* ── The reference ────────────────────────────────────────────────────────── */

describe('the campaign reference the embed carries', () => {
  it('round-trips, and refuses anything it did not issue', () => {
    const campaignId = randomUUID();
    const reference = interviewReference(campaignId, TEST_AUTH_SECRET);

    expect(verifyInterviewReference(reference, TEST_AUTH_SECRET)).toBe(campaignId);

    // A campaign id on its own does not carry a tag with it — which is the
    // whole point, since that is what a Founder could type into the embed.
    expect(verifyInterviewReference(campaignId, TEST_AUTH_SECRET)).toBeNull();
    expect(verifyInterviewReference(`${campaignId}.0000`, TEST_AUTH_SECRET)).toBeNull();
    expect(verifyInterviewReference(reference, 'a-different-secret-at-least-32c')).toBeNull();
    expect(verifyInterviewReference(null, TEST_AUTH_SECRET)).toBeNull();
  });

  it('will not let one campaign’s tag be reused for another', () => {
    const mine = randomUUID();
    const theirs = randomUUID();
    const tag = interviewReference(mine, TEST_AUTH_SECRET).split('.')[1]!;

    expect(verifyInterviewReference(`${theirs}.${tag}`, TEST_AUTH_SECRET)).toBeNull();
  });
});

/* ── Signature and parsing ────────────────────────────────────────────────── */

describe('the webhook endpoint', () => {
  it('refuses an unsigned delivery and changes nothing', async () => {
    const fixture = await makeCampaign('unsigned');
    const body = JSON.stringify(payloadFor(fixture));

    await request(h.app)
      .post(CALCOM_WEBHOOK_PATH)
      .set('content-type', 'application/json')
      .send(body)
      .expect(401);

    expect(await bookingsFor(fixture.campaignId)).toHaveLength(0);
  });

  it('refuses a wrongly signed delivery', async () => {
    const fixture = await makeCampaign('badsig');
    await deliver(payloadFor(fixture), 'f'.repeat(64)).expect(401);
    expect(await bookingsFor(fixture.campaignId)).toHaveLength(0);
  });

  it('refuses a body whose bytes changed after signing', async () => {
    // The signature covers the exact bytes. This is why the route mounts a raw
    // parser: a re-serialised object is not the thing that was signed.
    const fixture = await makeCampaign('tampered');
    const original = JSON.stringify(payloadFor(fixture));
    const tampered = original.replace('ACCEPTED', 'PENDING!');

    await request(h.app)
      .post(CALCOM_WEBHOOK_PATH)
      .set('content-type', 'application/json')
      .set(CALCOM_SIGNATURE_HEADER, sign(original))
      .send(tampered)
      .expect(401);
  });

  it('refuses everything while the provider is unconfigured', () => {
    // "No secret configured" and "wrong signature" are the same answer. A
    // deployment with no provider must not be one that accepts anything.
    expect(unconfiguredScheduler.verifySignature(Buffer.from('{}'), 'anything')).toBe(false);
    expect(unconfiguredScheduler.configured).toBe(false);
  });

  it('answers 400 on a signed body that is not a booking event', async () => {
    await deliver({ triggerEvent: 'BOOKING_CREATED' }).expect(400);
    await deliver({ nonsense: true }).expect(400);
  });

  it('parses only the triggers whose contract we have read', () => {
    const fixture = { campaignId: 'c', founderEmail: 'a@b.c', cookie: '', reference: 'r' };
    for (const trigger of HANDLED_TRIGGERS) {
      const parsed = parseVendorEvent(
        Buffer.from(JSON.stringify(payloadFor(fixture as Fixture, { trigger }))),
      );
      expect(parsed?.handled).toBe(true);
    }

    const unknown = parseVendorEvent(
      Buffer.from(JSON.stringify(payloadFor(fixture as Fixture, { trigger: 'MEETING_ENDED' }))),
    );
    expect(unknown?.handled).toBe(false);
  });
});

/* ── Binding ──────────────────────────────────────────────────────────────── */

describe('a delivery binds only when two independent facts agree', () => {
  it('refuses a booking carrying no Proovd reference', async () => {
    const fixture = await makeCampaign('noref');
    await deliver(payloadFor(fixture, { reference: null })).expect(200);

    expect(await bookingsFor(fixture.campaignId)).toHaveLength(0);
    const audits = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'interview.webhook_unmatched'));
    expect(audits.length).toBeGreaterThan(0);
  });

  it('refuses a forged reference', async () => {
    const fixture = await makeCampaign('forged');
    await deliver(
      payloadFor(fixture, { reference: `${fixture.campaignId}.${'a'.repeat(32)}` }),
    ).expect(200);

    expect(await bookingsFor(fixture.campaignId)).toHaveLength(0);
  });

  it('refuses another campaign’s reference used by the wrong person', async () => {
    // The attack the second fact exists for: a real, valid reference — someone
    // else's — carried by a booking the attacker made.
    const mine = await makeCampaign('victim');
    const theirs = await makeCampaign('attacker');

    await deliver(
      payloadFor(theirs, { reference: mine.reference, attendeeEmail: theirs.founderEmail }),
    ).expect(200);

    expect(await bookingsFor(mine.campaignId)).toHaveLength(0);
    expect(await bookingsFor(theirs.campaignId)).toHaveLength(0);
  });

  it('refuses a conferencing provider §12 does not name', async () => {
    const fixture = await makeCampaign('badprovider');
    await deliver(payloadFor(fixture, { location: 'integrations:whereby' })).expect(200);
    expect(await bookingsFor(fixture.campaignId)).toHaveLength(0);
  });
});

/* ── The happy path, and what it earns ────────────────────────────────────── */

describe('a verified, bound delivery moves the booking record', () => {
  it('creates a confirmed booking, sends one email, and earns the US$2', async () => {
    const fixture = await makeCampaign('confirmed');
    await deliver(payloadFor(fixture)).expect(200);

    const [booking] = await bookingsFor(fixture.campaignId);
    expect(booking!.status).toBe('confirmed');
    expect(booking!.meetingProvider).toBe('zoom');
    expect(booking!.meetingLink).toBe('https://zoom.example/j/123456');
    expect(booking!.interviewer).toBe('Alex Interviewer');
    // §12 stores the zone separately from the instant.
    expect(booking!.founderTimezone).toBe('America/New_York');
    expect(booking!.externalSource).toBe('calcom');
    expect(booking!.proovdReference).toBe(fixture.reference);

    // §12: only a confirmed booking completes the item.
    const [item] = await h.db
      .select()
      .from(campaignOptionalItems)
      .where(
        and(
          eq(campaignOptionalItems.campaignId, fixture.campaignId),
          eq(campaignOptionalItems.item, 'interview'),
        ),
      );
    expect(item!.complete).toBe(true);

    const sent = emailsTo(fixture.founderEmail);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain('confirmed');
    // §27.1: local time with a UTC secondary. §3: never the internal name.
    expect(sent[0]!.text).toContain('UTC');
    expect(sent[0]!.text).not.toContain('microsoft_teams');
    expect(sent[0]!.text).toContain('Zoom');
  });

  it('leaves a requested-but-unaccepted booking earning nothing', async () => {
    const fixture = await makeCampaign('pending');
    await deliver(
      payloadFor(fixture, { trigger: 'BOOKING_REQUESTED', status: 'PENDING' }),
    ).expect(200);

    const [booking] = await bookingsFor(fixture.campaignId);
    expect(booking!.status).toBe('selected');

    const [item] = await h.db
      .select()
      .from(campaignOptionalItems)
      .where(
        and(
          eq(campaignOptionalItems.campaignId, fixture.campaignId),
          eq(campaignOptionalItems.item, 'interview'),
        ),
      );
    expect(item!.complete).toBe(false);
    expect(item!.rejections).toContain('booking_unconfirmed');
    // Nothing to confirm to the Founder yet — a confirmation email for an
    // unconfirmed booking is the §1.4 failure.
    expect(emailsTo(fixture.founderEmail)).toHaveLength(0);
  });

  it('records a reschedule as history and emails each move once', async () => {
    const fixture = await makeCampaign('reschedule');
    const uid = `cal-${randomUUID()}`;

    await deliver(payloadFor(fixture, { uid })).expect(200);
    await deliver(
      payloadFor(fixture, {
        uid,
        trigger: 'BOOKING_RESCHEDULED',
        startTime: '2026-10-02T15:00:00.000Z',
      }),
    ).expect(200);
    await deliver(
      payloadFor(fixture, {
        uid,
        trigger: 'BOOKING_RESCHEDULED',
        startTime: '2026-10-03T15:00:00.000Z',
      }),
    ).expect(200);

    const [booking] = await bookingsFor(fixture.campaignId);
    // §12: a rescheduled booking is still confirmed, at a different time.
    expect(booking!.status).toBe('confirmed');
    expect(booking!.scheduledAt?.toISOString()).toBe('2026-10-03T15:00:00.000Z');

    const history = await h.db
      .select()
      .from(interviewBookingEvents)
      .where(eq(interviewBookingEvents.campaignId, fixture.campaignId));
    expect(history.filter((e) => e.event === 'rescheduled')).toHaveLength(2);

    // Both moves sent. Keying the dedup on the booking alone would have
    // swallowed the second — §7's exact failure in a different phase.
    const sent = emailsTo(fixture.founderEmail);
    expect(sent.filter((m) => m.subject.includes('moved'))).toHaveLength(2);
  });

  it('cancels, recalculates, and says what happened to the fee', async () => {
    const fixture = await makeCampaign('cancel');
    const uid = `cal-${randomUUID()}`;

    await deliver(payloadFor(fixture, { uid })).expect(200);
    await deliver(
      payloadFor(fixture, {
        uid,
        trigger: 'BOOKING_CANCELLED',
        status: 'CANCELLED',
        cancellationReason: 'Something came up',
      }),
    ).expect(200);

    const [booking] = await bookingsFor(fixture.campaignId);
    expect(booking!.status).toBe('canceled');
    expect(booking!.cancellationReason).toBe('Something came up');

    const [item] = await h.db
      .select()
      .from(campaignOptionalItems)
      .where(
        and(
          eq(campaignOptionalItems.campaignId, fixture.campaignId),
          eq(campaignOptionalItems.item, 'interview'),
        ),
      );
    expect(item!.complete).toBe(false);

    const cancellation = emailsTo(fixture.founderEmail).find((m) =>
      m.subject.includes('canceled'),
    );
    expect(cancellation).toBeDefined();
    // §12: cancelling before payment recalculates, and the email says so
    // truthfully rather than hardcoding a claim about money.
    expect(cancellation!.text).toContain('no longer applies');
    expect(cancellation!.text).toContain('not been charged');
  });

  it('says the paid amount does not move when the campaign has already paid', async () => {
    const fixture = await makeCampaign('cancel-paid');
    const uid = `cal-${randomUUID()}`;

    await deliver(payloadFor(fixture, { uid })).expect(200);
    await h.db
      .update(campaigns)
      .set({ listingPaidAt: new Date() })
      .where(eq(campaigns.id, fixture.campaignId));

    await deliver(
      payloadFor(fixture, { uid, trigger: 'BOOKING_CANCELLED', status: 'CANCELLED' }),
    ).expect(200);

    const cancellation = emailsTo(fixture.founderEmail).find((m) =>
      m.subject.includes('canceled'),
    );
    expect(cancellation!.text).toContain('does not change the amount you paid');
    expect(cancellation!.text).not.toContain('no longer applies');
  });
});

/* ── §28.3 — duplicates ───────────────────────────────────────────────────── */

describe('§28.3 — a redelivery updates audit and nothing else', () => {
  it('produces one booking, one history row, and one email', async () => {
    const fixture = await makeCampaign('duplicate');
    const body = payloadFor(fixture);

    await deliver(body).expect(200);
    await deliver(body).expect(200);
    await deliver(body).expect(200);

    expect(await bookingsFor(fixture.campaignId)).toHaveLength(1);

    const history = await h.db
      .select()
      .from(interviewBookingEvents)
      .where(eq(interviewBookingEvents.campaignId, fixture.campaignId));
    expect(history.filter((e) => e.event === 'confirmed')).toHaveLength(1);

    expect(emailsTo(fixture.founderEmail)).toHaveLength(1);

    // The pivot counted the redeliveries rather than hiding them.
    const [seen] = await h.db
      .select()
      .from(providerEvents)
      .where(
        and(
          eq(providerEvents.provider, 'calcom'),
          eq(providerEvents.subjectId, body.payload.uid),
        ),
      );
    expect(seen!.seenCount).toBeGreaterThan(1);

    const audits = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'interview.webhook_duplicate'));
    expect(audits.length).toBeGreaterThan(0);
  });

  it('records the delivery against the provider, not against Stripe', async () => {
    // `provider_events` defaults `provider` to 'stripe'. A Cal.com delivery
    // landing under that default would collide with Phase 10's ids.
    const fixture = await makeCampaign('provider-column');
    const body = payloadFor(fixture);
    await deliver(body).expect(200);

    const [row] = await h.db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.subjectId, body.payload.uid));
    expect(row!.provider).toBe('calcom');
    expect(row!.eventType).toBe('BOOKING_CREATED');
  });
});

/* ── The trap: confirmed without a webhook ────────────────────────────────── */

describe('`confirmed` is reachable without a webhook', () => {
  it('confirms through the Admin reconciliation route and records the source', async () => {
    const fixture = await makeCampaign('reconcile');

    // A booking that exists because the create webhook arrived, and whose
    // confirmation never did.
    const booked = await recordBooking(h.db, {
      campaignId: fixture.campaignId,
      scheduledAt: new Date('2026-11-01T15:00:00.000Z'),
      founderTimezone: 'America/New_York',
      meetingProvider: 'zoom',
      externalSource: 'calcom',
      externalBookingId: `cal-${randomUUID()}`,
      actor: 'test',
      source: 'provider:calcom',
    });
    if (!booked.ok) throw new Error(booked.message);

    await request(h.app)
      .post(
        `/api/admin/campaigns/${fixture.campaignId}/workspace/interview/${booked.bookingId}/confirm`,
      )
      .set('cookie', admin.cookie)
      .send({ meetingLink: 'https://zoom.example/j/999', interviewer: 'Alex Interviewer' })
      .expect(200);

    const [booking] = await bookingsFor(fixture.campaignId);
    expect(booking!.status).toBe('confirmed');

    const history = await h.db
      .select()
      .from(interviewBookingEvents)
      .where(eq(interviewBookingEvents.campaignId, fixture.campaignId));
    // Which arrived how stays answerable — the question anyone debugging a
    // missed delivery actually asks.
    expect(history.find((e) => e.event === 'confirmed')!.source).toBe('admin_reconciliation');
    expect(history.find((e) => e.event === 'created')!.source).toBe('provider:calcom');
  });

  it('does not send a second confirmation when the webhook turns up late', async () => {
    const fixture = await makeCampaign('late-webhook');
    const uid = `cal-${randomUUID()}`;

    const booked = await recordBooking(h.db, {
      campaignId: fixture.campaignId,
      scheduledAt: new Date('2026-11-02T15:00:00.000Z'),
      founderTimezone: 'UTC',
      meetingProvider: 'zoom',
      externalSource: 'calcom',
      externalBookingId: uid,
      proovdReference: fixture.reference,
      actor: 'test',
      source: 'provider:calcom',
    });
    if (!booked.ok) throw new Error(booked.message);

    await request(h.app)
      .post(
        `/api/admin/campaigns/${fixture.campaignId}/workspace/interview/${booked.bookingId}/confirm`,
      )
      .set('cookie', admin.cookie)
      .send({ meetingLink: 'https://zoom.example/j/1', interviewer: 'Alex Interviewer' })
      .expect(200);

    const afterReconcile = emailsTo(fixture.founderEmail).length;

    // The delivery we had given up on.
    await deliver(payloadFor(fixture, { uid, startTime: '2026-11-02T15:00:00.000Z' })).expect(200);

    expect(emailsTo(fixture.founderEmail)).toHaveLength(afterReconcile);
    expect(await bookingsFor(fixture.campaignId)).toHaveLength(1);
  });
});

/* ── The jobs ─────────────────────────────────────────────────────────────── */

describe('§12’s reminder', () => {
  it('sends once per scheduled time, however often the job runs', async () => {
    const fixture = await makeCampaign('reminder');
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000);

    await deliver(payloadFor(fixture, { startTime: soon.toISOString() })).expect(200);

    const first = await sendDueReminders(h.db, h.notifier, {
      supportEmail: 'support@proovd.co',
      fromAddress: 'hello@proovd.co',
    });
    expect(first.leadHours).toBe(24);
    expect(first.sent).toBe(1);

    const second = await sendDueReminders(h.db, h.notifier, {
      supportEmail: 'support@proovd.co',
      fromAddress: 'hello@proovd.co',
    });
    expect(second.sent).toBe(0);
    expect(second.duplicates).toBe(1);

    const reminders = emailsTo(fixture.founderEmail).filter((m) =>
      m.subject.includes('coming up'),
    );
    expect(reminders).toHaveLength(1);

    const deliveries = await h.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.eventKey, FOUNDER_INTERVIEW_REMINDER));
    expect(deliveries.length).toBeGreaterThan(0);
  });

  it('sends nothing at all while §6’s lead time is unset', async () => {
    await h.db.execute(`
      UPDATE app_settings SET value = NULL, updated_by = 'test', update_reason = 'unset for the suite'
       WHERE key = 'interview_reminder_lead_hours'
    `);
    try {
      const result = await sendDueReminders(h.db, h.notifier, {
        supportEmail: 'support@proovd.co',
        fromAddress: 'hello@proovd.co',
      });
      // §6 names the setting and fixes no number. Unset means no reminders,
      // reported — not a default nobody chose (§1 rule 6).
      expect(result.leadHours).toBeNull();
      expect(result.sent).toBe(0);
    } finally {
      await configureInterviews();
    }
  });
});

describe('abandonment', () => {
  it('marks a never-confirmed slot that has passed, and stops it counting', async () => {
    const fixture = await makeCampaign('abandoned');

    const booked = await recordBooking(h.db, {
      campaignId: fixture.campaignId,
      scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
      founderTimezone: 'UTC',
      meetingProvider: 'zoom',
      actor: 'test',
      source: 'founder',
    });
    if (!booked.ok) throw new Error(booked.message);

    const result = await sweepAbandonedBookings(h.db);
    expect(result.abandoned).toContain(booked.bookingId);

    const [booking] = await bookingsFor(fixture.campaignId);
    expect(booking!.status).toBe('abandoned');

    // §12 counts `selected` toward high-effort and `abandoned` toward nothing,
    // so the classification has to move with the status.
    const [campaign] = await h.db
      .select({ highEffort: campaigns.highEffort })
      .from(campaigns)
      .where(eq(campaigns.id, fixture.campaignId));
    expect(campaign!.highEffort).toBe(true);

    // Safe to run twice.
    expect((await sweepAbandonedBookings(h.db)).abandoned).not.toContain(booked.bookingId);
  });
});

/* ── The templates ────────────────────────────────────────────────────────── */

describe('the four emails', () => {
  const variables = {
    founderName: 'Rowan Vale',
    productName: 'Waitlist',
    localTime: 'Thursday, October 1, 2026 at 11:00 AM',
    utcTime: 'Thursday, October 1, 2026 at 3:00 PM',
    timezone: 'America/New_York',
    meetingProvider: 'Zoom',
    meetingLink: 'https://zoom.example/j/123',
    interviewer: 'Alex Interviewer',
    nextUpdate: 'We will remind you before it starts.',
    reference: 'campaign-1',
    supportEmail: 'support@proovd.co',
  };

  it('carries one action on the three that have one, and none on the cancellation', async () => {
    for (const kind of ['confirmed', 'reminder', 'rescheduled'] as const) {
      const rendered = await renderInterviewEmail(kind, variables);
      // §27.2: at most one primary action.
      expect(rendered.html.match(/Join the interview/g)).toHaveLength(1);
    }

    const canceled = await renderInterviewEmail('canceled', {
      ...variables,
      cancellationReason: 'Something came up',
    });
    expect(canceled.html).not.toContain('Join the interview');
    // There is nothing to join and nothing to fix; a button to a page saying so
    // would be §1.4's failure with a link on it.
    expect(canceled.text).not.toContain('https://zoom.example');
  });

  it('renders both times, a plain-text part, the reference, and the §8 warning', async () => {
    const rendered = await renderInterviewEmail('confirmed', variables);

    expect(rendered.text).toContain('America/New_York');
    expect(rendered.text).toContain('UTC');
    expect(rendered.text).toContain('campaign-1');
    expect(rendered.text).toContain('support@proovd.co');
    // The sentence every Proovd email carries.
    expect(rendered.text).toContain('never ask you for your bank details');
  });

  it('names the product in every subject', async () => {
    for (const kind of ['confirmed', 'reminder', 'rescheduled', 'canceled'] as const) {
      const rendered = await renderInterviewEmail(kind, variables);
      expect(rendered.subject).toContain('Waitlist');
    }
  });

  it('never renders an internal name', async () => {
    const rendered = await renderInterviewEmail('confirmed', {
      ...variables,
      meetingProvider: MEETING_PROVIDER_LABELS.microsoft_teams,
    });
    expect(rendered.text).toContain('Microsoft Teams');
    for (const internal of ['microsoft_teams', 'google_meet', 'pre_build', 'pre_launch']) {
      expect(rendered.text).not.toContain(internal);
    }
  });
});

/* ── The embed ────────────────────────────────────────────────────────────── */

describe('the workspace hands the Founder an embed, bound to their campaign', () => {
  it('serves the event link and a reference that verifies for this campaign only', async () => {
    const fixture = await makeCampaign('embed');

    const view = await request(h.app)
      .get(`/api/founder/campaigns/${fixture.campaignId}/workspace`)
      .set('cookie', fixture.cookie)
      .expect(200);

    const embed = view.body.workspace.interview.embed;
    expect(embed.available).toBe(true);
    expect(embed.eventTypeLink).toBe('proovd/founder-interview');
    expect(verifyInterviewReference(embed.reference, TEST_AUTH_SECRET)).toBe(fixture.campaignId);
  });

  it('gives one Founder no usable reference for another’s campaign', async () => {
    const mine = await makeCampaign('embed-mine');
    const theirs = await makeCampaign('embed-theirs');

    await request(h.app)
      .get(`/api/founder/campaigns/${mine.campaignId}/workspace`)
      .set('cookie', theirs.cookie)
      .expect(404);
  });
});
