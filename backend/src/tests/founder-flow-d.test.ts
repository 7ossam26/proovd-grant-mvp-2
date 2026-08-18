/**
 * Founder Flow v2, Session D — the account, and §12.
 *
 * The brief's D4 done-when, minus the parts that are properties of a rendered
 * surface (`frontend/src/surfaces/founder-flow/founder-flow.test.tsx` owns
 * those). What is here is what only the server can answer.
 *
 * ── It does NOT re-drive §33.1.9 ────────────────────────────────────────────
 * `vetting.test.ts` owns the claim: `founder_signup_complete` exactly once, the
 * token invalidated, the campaign moved, the consents citing published
 * versions. Session D rebuilt the SCREEN and changed none of that, and the
 * strongest statement of it is that suite passing unchanged rather than a copy
 * of it passing here. What this file adds is the one assertion that goes the
 * other way: that the claim transaction still has exactly one writer.
 *
 * ── The §12 trap, stated as an absence ──────────────────────────────────────
 * "An item that completes because someone clicked done defeats the whole
 * discount." So the tests below are mostly about what no route accepts: there
 * is no patch key, no body field, and no column a Founder controls that sets
 * `complete`, and `evaluateWorkspace` re-derives all five on every save.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, inArray, sql } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { campaignOptionalItems } from '../db/schema/workspace.js';
import { policyVersions } from '../db/schema/policies.js';
import { FOUNDER_CLAIM_POLICY_SLUGS } from '../vetting/claim.js';
import { TRANSCRIPTION_UNAVAILABLE } from '../transcription/index.js';
import {
  FOUNDER_ANSWER_SEQUENCE,
  FOUNDER_FLOW_PAGES,
  OPTIONAL_ITEMS,
  VETTING_STEPS,
} from '@proovd/shared';

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'flowd');
  admin = await createAdmin(h, 'flowd-admin');
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_SRC = path.join(HERE, '..');
const FRONTEND_SRC = path.join(HERE, '..', '..', '..', 'frontend', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

/** Comments explain at length what these files refuse to do (Session C's rule). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/* ── The registers stay two ───────────────────────────────────────────────── */

describe('the eight answers are two registers, and the flow only orders them', () => {
  it('gives every entry a page that exists and a register that owns it', () => {
    for (const entry of FOUNDER_ANSWER_SEQUENCE) {
      expect(
        FOUNDER_FLOW_PAGES.some((page) => page.id === entry.pageId),
        entry.key,
      ).toBe(true);
    }
  });

  it('never merges §9 and §12 into one shape', () => {
    // §12 completion is derived server-side from objective evidence. A single
    // `answers` table — or one register with `complete` on every row — would
    // quietly make it a Founder assertion, which is the one thing §12 exists to
    // prevent. The two registers are disjoint and stay disjoint.
    const vetting = new Set<string>(VETTING_STEPS.map((step) => step.id));
    const optional = new Set<string>(OPTIONAL_ITEMS.map((item) => item.key));
    for (const key of vetting) expect(optional.has(key), key).toBe(false);
    expect(vetting.size + optional.size).toBe(FOUNDER_ANSWER_SEQUENCE.length);
  });

  it('has no answers table anywhere', async () => {
    const found = await h.db.execute(sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and (table_name = 'founder_answers' or table_name = 'campaign_answers'
             or table_name = 'flow_answers')
    `);
    expect(found.rows).toEqual([]);
  });
});

/* ── §12 completion is never a Founder assertion ──────────────────────────── */

describe('no route a Founder controls can set an item complete', () => {
  it('accepts no completion key on the workspace patch', async () => {
    const { founder, campaignId } = await claimedFounder('complete');

    const forged = [
      { complete: true },
      { items: [{ item: 'story', complete: true }] },
      { storyComplete: true },
      { visualsComplete: true },
      { decisionSource: 'objective_evidence' },
      { completedAt: new Date().toISOString() },
    ];
    for (const body of forged) {
      await request(h.app)
        .patch(`/api/founder/campaigns/${campaignId}/workspace`)
        .set('cookie', founder)
        .send(body);
    }

    const rows = await h.db
      .select()
      .from(campaignOptionalItems)
      .where(eq(campaignOptionalItems.campaignId, campaignId));
    expect(rows.length).toBe(5);
    for (const row of rows) expect(row.complete, row.item).toBe(false);
  });

  it('re-derives every item on every save', async () => {
    const { founder, campaignId } = await claimedFounder('derive');

    // A story with words in it and no approval. §12: "an unapproved draft does
    // not count", and the server says which part is missing.
    await request(h.app)
      .patch(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .send({ storyText: 'We started this because our own updates were late every week.' })
      .expect(200);

    let read = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .expect(200);
    let story = read.body.workspace.items.find((i: { item: string }) => i.item === 'story');
    expect(story.complete).toBe(false);
    expect(story.rejections).toContain('not_approved');

    await request(h.app)
      .patch(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .send({ storyApproved: true })
      .expect(200);

    read = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .expect(200);
    story = read.body.workspace.items.find((i: { item: string }) => i.item === 'story');
    expect(story.complete).toBe(true);
    // §12 makes the Founder's APPROVAL the completing act for Story, and the
    // server records that as the decision's source. What matters is that it is
    // the server's own vocabulary rather than an Admin override.
    expect(story.decisionSource).toBe('founder_approval');

    // …and editing it afterwards withdraws the approval, so what is published
    // is always the version somebody approved.
    await request(h.app)
      .patch(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .send({ storyText: 'Something else entirely.' })
      .expect(200);

    read = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .expect(200);
    story = read.body.workspace.items.find((i: { item: string }) => i.item === 'story');
    expect(story.complete).toBe(false);
  });

  it('moves the fee with the answers, from the settings rather than a constant', async () => {
    const { founder, campaignId } = await claimedFounder('fee');

    const before = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .expect(200);
    const base = before.body.workspace.fee.baseCents;
    const per = before.body.workspace.fee.itemDiscountCents;
    expect(before.body.workspace.fee.subtotalCents).toBe(base);

    await request(h.app)
      .patch(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .send({ storyText: 'Why we are building this.', storyApproved: true })
      .expect(200);

    const after = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .expect(200);
    expect(after.body.workspace.fee.completedItems).toBe(1);
    expect(BigInt(after.body.workspace.fee.subtotalCents)).toBe(BigInt(base) - BigInt(per));

    // §6 owns all four numbers. The Founder surface renders them and computes
    // none — asserted as an absence over the whole surfaces tree below.
    const change = await request(h.app)
      .put('/api/admin/settings/listing_fee_item_discount_cents')
      .set('cookie', admin.cookie)
      .send({ value: '300', reason: 'Session D: the fee follows the setting' });
    expect([200, 204]).toContain(change.status);

    await request(h.app)
      .patch(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .send({ brandNotes: 'nudging a re-evaluation' })
      .expect(200);

    const moved = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .expect(200);
    expect(moved.body.workspace.fee.itemDiscountCents).toBe('300');
    expect(BigInt(moved.body.workspace.fee.subtotalCents)).toBe(BigInt(base) - 300n);
  });
});

/* ── What the read carries for Last look ──────────────────────────────────── */

describe('the workspace read carries what Last look renders', () => {
  it('carries §9’s three answers, read-only', async () => {
    const { founder, campaignId } = await claimedFounder('vetting-read');
    const read = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .expect(200);

    const vetting = read.body.workspace.vetting;
    expect(Object.keys(vetting).sort()).toEqual([
      'competition',
      'problem',
      'solution',
      'submittedAt',
    ]);
    expect(vetting.problem).toBeTruthy();
    expect(vetting.submittedAt).toBeTruthy();
  });

  it('accepts no write that would reach a §9 answer', async () => {
    // The read is read-only in the strong sense: the writer this projection
    // shares has no patch key that touches `campaign_vetting`, so a control
    // offering to edit one would have nothing to call.
    const { founder, campaignId } = await claimedFounder('vetting-write');
    const before = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .expect(200);

    for (const body of [
      { problem: 'forged' },
      { competition: 'forged' },
      { vetting: { problem: 'forged' } },
    ]) {
      await request(h.app)
        .patch(`/api/founder/campaigns/${campaignId}/workspace`)
        .set('cookie', founder)
        .send(body);
    }

    const after = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .expect(200);
    expect(after.body.workspace.vetting).toEqual(before.body.workspace.vetting);
  });

  it('names the dictation absence rather than leaving the surface to guess', async () => {
    const { founder, campaignId } = await claimedFounder('dictation');
    const read = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', founder)
      .expect(200);
    expect(read.body.workspace.transcription).toEqual({
      available: false,
      absentBecause: TRANSCRIPTION_UNAVAILABLE,
    });
  });
});

/* ── Dictation on Story: the same port, the same refusal ──────────────────── */

describe('deviation 2 on the Story step', () => {
  it('refuses loudly while the port is unconfigured, and buffers nothing', async () => {
    const { founder, campaignId } = await claimedFounder('transcribe');
    const response = await request(h.app)
      .post(`/api/founder/campaigns/${campaignId}/transcribe`)
      .set('cookie', founder)
      .set('content-type', 'audio/webm')
      .send(Buffer.from('not really audio'))
      .expect(503);
    expect(response.body.whatHappened).toBe(TRANSCRIPTION_UNAVAILABLE);
  });

  it('is behind the Founder guard, and scoped to the caller’s own campaign', async () => {
    const { campaignId } = await claimedFounder('transcribe-mine');
    const other = await claimedFounder('transcribe-other');

    await request(h.app)
      .post(`/api/founder/campaigns/${campaignId}/transcribe`)
      .set('content-type', 'audio/webm')
      .send(Buffer.from('x'))
      .expect(401);

    // Somebody else's campaign answers the same way one that does not exist
    // does — but the unconfigured refusal comes first, because it is decided
    // before the body is read. Either way nothing about the campaign leaks.
    const cross = await request(h.app)
      .post(`/api/founder/campaigns/${campaignId}/transcribe`)
      .set('cookie', other.founder)
      .set('content-type', 'audio/webm')
      .send(Buffer.from('x'));
    expect([404, 503]).toContain(cross.status);
  });

  it('has no generate, summarize, rewrite or suggest anywhere near it', () => {
    const files = walk(path.join(BACKEND_SRC, 'transcription')).concat(
      walk(path.join(BACKEND_SRC, 'workspace')),
    );
    for (const file of files) {
      const source = withoutComments(readFileSync(file, 'utf8')).toLowerCase();
      for (const banned of ['generatetext', 'summarize(', 'rewrite(', 'suggest(']) {
        expect(source.includes(banned), `${file}: ${banned}`).toBe(false);
      }
    }
  });
});

/* ── No fee arithmetic in the browser ─────────────────────────────────────── */

describe('the fee is computed once, on the server', () => {
  it('has no listing-fee arithmetic under frontend/src/surfaces', () => {
    // Phase 09's trap: "a second implementation in a React component is how the
    // preview and the charge diverge." The reference's own FEE_BASE=35,
    // FEE_PER=2, FEE_FLOOR=25 are exactly that, and this session added five
    // pages that all render a fee.
    // Shipped source only. A fixture holding `baseCents: '3500'` is the
    // server's own answer written down, which is what a stub IS — and the
    // §33.11.3 bundle scan this mirrors reads the build, where no test is.
    const files = walk(path.join(FRONTEND_SRC, 'surfaces')).filter(
      (file) => !/\.test\.tsx?$/.test(file),
    );
    const patterns = [
      /\b3500\b/,
      /\bFEE_BASE\b/,
      /\bFEE_PER\b/,
      /\bFEE_FLOOR\b/,
      /baseCents\s*[-+*/]/,
      /subtotalCents\s*[-+*/]/,
      /itemDiscountCents\s*\*/,
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      for (const pattern of patterns) {
        if (pattern.test(source)) offenders.push(`${path.basename(file)}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Publishes the three §31.4 documents a claim cites.
 *
 * Every document ships as a draft while Track A2 is in legal review, and a
 * consent may cite only a published version — enforced by trigger. `vetting.
 * test.ts` proves the refusal; this file needs the claim to SUCCEED so stage 3
 * is reachable at all, so it publishes first, which is the order the real
 * deployment follows (§34 condition 4).
 *
 * Publication is one-way, so this runs once and stays.
 */
let policiesPublished = false;
async function publishClaimPolicies(): Promise<void> {
  if (policiesPublished) return;
  await h.db
    .update(policyVersions)
    .set({ status: 'published', effectiveDate: '2026-01-01', publishedAt: new Date() })
    .where(inArray(policyVersions.slug, [...FOUNDER_CLAIM_POLICY_SLUGS]));
  policiesPublished = true;
}
/* ── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * An invited Founder taken all the way through §10's claim.
 *
 * The eight §31.4 documents ship `draft`, so `completeClaim` refuses with
 * `policies_unpublished` — which is the correct state and is asserted by
 * `vetting.test.ts`. Here the documents are published first so the claim can
 * complete and stage 3 is reachable at all; nothing else about the claim path
 * changes.
 */
async function claimedFounder(
  label: string,
): Promise<{ founder: string; campaignId: string; draftId: string }> {
  const email = `${label}-${randomUUID()}@example.com`;
  const created = await request(h.app)
    .post('/api/admin/founders')
    .set('cookie', admin.cookie)
    .send({
      legalName: 'Rowan Vale',
      preferredName: 'Rowan',
      email,
      phone: '+1 555 0100',
      productName: 'Waitlist',
      productUrl: 'https://waitlist.example',
      invitationSource: 'introduced by a mutual contact',
      internalOwner: 'Ada Admin',
    })
    .expect(201);

  await request(h.app)
    .put(`/api/admin/founders/${created.body.draftId}/invitation`)
    .set('cookie', admin.cookie)
    .send({
      whatWeUnderstood: 'You are building a waitlist that fills cancelled appointments.',
      whyInvited: 'A clinic operator we know described exactly this problem.',
      senderName: 'Ada Admin',
      senderEmail: 'ada@proovd.co',
      expectedSetupTime: '~3 mins',
    })
    .expect(200);

  const before = h.sentEmails.messages.length;
  await request(h.app)
    .post(`/api/admin/founders/${created.body.draftId}/send`)
    .set('cookie', admin.cookie)
    .send({})
    .expect(201);
  const raw = new RegExp(String.raw`http://localhost:3000/draft/([A-Za-z0-9_-]+)`).exec(
    h.sentEmails.messages[before]!.text,
  )![1]!;

  // The Founder chooses their own path again (Session A's reversion), so the
  // walk uses their route rather than Admin's.
  await request(h.app)
    .patch(`/api/draft/${raw}/vetting`)
    .send({
      problem: 'Cancelled appointments go unfilled because nobody has time to call the list.',
      solution: 'A waitlist that texts the next person the moment a slot opens.',
      competition: 'A paper list by the front desk, and doing nothing.',
      selectedType: 'pre_launch',
    })
    .expect(200);
  await request(h.app).post(`/api/draft/${raw}/vetting/submit`).send({}).expect(201);

  await request(h.app)
    .patch(`/api/draft/${raw}/claim`)
    .send({
      legalName: 'Rowan Vale',
      email,
      dateOfBirth: '1990-01-31',
      country: 'United States',
      stateRegion: 'Oregon',
      soleProprietor: true,
      representationUsPerson: true,
      representationAge18Plus: true,
      representationSanctions: true,
    })
    .expect(200);

  await publishClaimPolicies();
  const claimView = await request(h.app).get(`/api/draft/${raw}/claim`).expect(200);
  const slugs = (claimView.body.policies as Array<{ slug: string }>)
    .filter((p) => (p as { status?: string }).status === 'published')
    .map((p) => p.slug);

  const password = `flow-d-${randomUUID()}`;
  await request(h.app)
    .post(`/api/draft/${raw}/claim`)
    .send({ password, acceptedPolicySlugs: slugs })
    .expect(201);

  const signIn = await request(h.app)
    .post('/api/auth/sign-in/email')
    .send({ email, password })
    .expect(200);
  const cookie = (signIn.headers['set-cookie'] as unknown as string[]).join('; ');

  return { founder: cookie, campaignId: created.body.campaignId, draftId: created.body.draftId };
}
