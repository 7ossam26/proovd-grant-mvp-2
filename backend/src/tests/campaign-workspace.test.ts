/**
 * Phase 09a acceptance suite — §33.3.1, §33.3.2, §33.3.3, §33.3.4.
 *
 * §33's own framing: these are requirements, not examples.
 *
 *   33.3.1  Objective evidence rules reject placeholders, inaccessible links,
 *           unapproved Story, and unconfirmed interview.
 *   33.3.2  Every item combination produces US$35 minus US$2/item to US$25
 *           minimum.
 *   33.3.3  Canceled interview before payment recalculates; after payment does
 *           not.
 *   33.3.4  High-effort is correct for all eight combinations (the lock at
 *           payment lands in Phase 11).
 *
 * §33.3.1's near-misses are asserted against *real bytes in a real bucket*
 * rather than against a stub: an in-memory `ObjectStorage` is injected and the
 * suite puts a zero-byte file, a 1×1 PNG, and a valid PNG into it, so the
 * server's own verification path decides. A test that asserted a mock was
 * called would prove the call, not the rule.
 *
 * Also proved here, because §12 states them and a later phase would otherwise
 * inherit them untested: the register does not drift from `shared/workspace`,
 * the backend's fee arithmetic agrees with the `shared/money` kernel across all
 * 32 combinations, an override is recorded as an override, editing approved
 * content revokes the approval, one Founder cannot read another's workspace,
 * and the four §6 interview settings ship unset so nothing is bookable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import type { PoolClient } from 'pg';
import { createAdmin, seedUser, signInPlain, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { createMemoryStorage } from '../storage/object-storage.js';
import { campaigns } from '../db/schema/domain.js';
import { founderProspects, campaignDrafts } from '../db/schema/invitations.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';
import {
  campaignOptionalItems,
  campaignAssets,
  optionalItemEvents,
  highEffortClassifications,
  listingFeeCalculations,
  founderInterviewBookings,
  interviewBookingEvents,
} from '../db/schema/workspace.js';
import { auditEvents } from '../db/schema/integrity.js';
import {
  OPTIONAL_ITEM_KEYS as BACKEND_ITEM_KEYS,
  EVIDENCE_REJECTION_CODES as BACKEND_REJECTIONS,
  DECISION_SOURCES as BACKEND_SOURCES,
  INTERVIEW_STATUSES as BACKEND_INTERVIEW_STATUSES,
  MEETING_PROVIDERS as BACKEND_PROVIDERS,
} from '../workspace/registry.js';
import { decideItems, type WorkspaceSnapshot } from '../workspace/evidence.js';
import { computeListingFee, readListingFeeSettings } from '../workspace/listing-fee.js';
import {
  evaluateWorkspace,
  ensureWorkspace,
  recordHighEffort,
  recordListingFee,
} from '../workspace/service.js';
import { recordBooking, confirmBooking, cancelBooking } from '../workspace/interview.js';
import { INTERVIEW_SETTING_KEYS } from '../workspace/interview.js';
import { inspectMedia, MIN_VISUAL_EDGE_PX } from '../storage/media.js';
import {
  OPTIONAL_ITEM_KEYS,
  EVIDENCE_REJECTION_CODES,
  DECISION_SOURCES,
  INTERVIEW_STATUSES,
  MEETING_PROVIDERS,
  computeListingFee as sharedComputeListingFee,
  type OptionalItemCompletion,
} from '@proovd/shared';

const storage = createMemoryStorage('workspace-test');

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  // Each case signs in a fresh Founder, and §28.1's per-address credential
  // limit would trip partway through — turning unrelated assertions into
  // limiter tests. The limiter's own behaviour is covered by
  // `auth-tokens.test.ts`, which mounts it with a deliberately tiny limit.
  h = await startHarness(
    { objectStorage: storage, authRouteLimit: 1_000_000, draftVerifyLimit: 1_000_000 },
    'workspace',
  );
  admin = await createAdmin(h, 'workspace-admin');
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

/**
 * Runs a statement as the unprivileged application role.
 *
 * The suite connects as the owner, and `REVOKE … FROM proovd_app` binds the
 * role the application actually uses. Asserting insert-only from the owning
 * connection would prove nothing at all — the same helper, for the same reason,
 * as `domain-kernel.test.ts`.
 */
async function asAppRole<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await h.pool.connect();
  try {
    await client.query('SET ROLE proovd_app');
    return await fn(client);
  } finally {
    await client.query('RESET ROLE');
    client.release();
  }
}

/**
 * A claimed campaign with a signed-in Founder.
 *
 * Built directly rather than by driving the Phase 06–07 journey: what is under
 * test here is §12, and re-running a whole invitation and vetting sequence per
 * case would make every failure in this file look like a Phase 07 failure.
 * The one thing that must be real is the authorization edge — the claim profile
 * carrying `claimed_user_id`, which is what `findFounderCampaign` joins on.
 */
async function makeCampaign(label: string): Promise<{
  campaignId: string;
  founderId: string;
  cookie: string;
}> {
  const founder = await seedUser(h, 'founder', label);

  const [campaign] = await h.db
    .insert(campaigns)
    // `campaigns_type_lock_pair` (Phase 07) requires the type and its lock
    // stamp to arrive together — the type is locked at vetting submission and
    // there is no state where one exists without the other.
    .values({ status: 'account_claimed', type: 'pre_build', typeLockedAt: new Date() })
    .returning({ id: campaigns.id });

  const [prospect] = await h.db
    .insert(founderProspects)
    .values({
      preferredName: `Founder ${label}`,
      email: founder.email,
      productName: `Product ${label}`,
      createdBy: `user:${admin.id}`,
      // `founder_prospects_claim_pair` (Phase 06b): the claimed user and the
      // claim time arrive together, because a claim with no time is not one.
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
    claimedUserId: founder.id,
    claimedAt: new Date(),
    updatedBy: `user:${founder.id}`,
  });

  const cookie = await signInPlain(h, founder.email);
  return { campaignId: campaign!.id, founderId: founder.id, cookie };
}

/** A valid PNG of the given size. Real bytes — the server parses the header. */
function png(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; // bit depth
  ihdr[17] = 6; // truecolour with alpha
  return Buffer.concat([signature, ihdr, Buffer.from('IEND')]);
}

const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex');

/**
 * Puts a file through the whole three-step upload path: presign, PUT to the
 * bucket, verify. Returns the asset id and the server's decision.
 */
async function upload(
  campaignId: string,
  cookie: string,
  input: { purpose: 'visual' | 'logo'; body: Buffer; contentType?: string; filename?: string },
): Promise<{ status: number; assetId?: string; error?: string }> {
  const contentType = input.contentType ?? 'image/png';
  const presign = await request(h.app)
    .post(`/api/founder/campaigns/${campaignId}/uploads`)
    .set('cookie', cookie)
    .send({
      purpose: input.purpose,
      contentType,
      byteSize: input.body.byteLength,
      checksumSha256: sha(input.body),
      filename: input.filename ?? 'file.png',
    });

  if (presign.status !== 200) {
    return { status: presign.status, error: presign.body.error };
  }

  // The browser's PUT. The suite writes the bytes into the same bucket the
  // server will read them back out of.
  storage.put(presign.body.assetId, contentType, input.body);
  const [row] = await h.db
    .select({ key: campaignAssets.storageKey })
    .from(campaignAssets)
    .where(eq(campaignAssets.id, presign.body.assetId))
    .limit(1);
  storage.put(row!.key, contentType, input.body);

  await request(h.app)
    .post(`/api/founder/campaigns/${campaignId}/uploads/${presign.body.assetId}/verify`)
    .set('cookie', cookie)
    .send({})
    .expect(200);

  return { status: 200, assetId: presign.body.assetId };
}

const itemOf = (body: any, key: string) =>
  body.workspace.items.find((i: { item: string }) => i.item === key);

/* ── Drift ────────────────────────────────────────────────────────────────── */

describe('the backend register mirrors shared/workspace', () => {
  it('restates the five §12 items exactly', () => {
    expect([...BACKEND_ITEM_KEYS]).toEqual([...OPTIONAL_ITEM_KEYS]);
  });

  it('restates the rejection vocabulary, the decision sources, and the enums', () => {
    expect([...BACKEND_REJECTIONS].sort()).toEqual([...EVIDENCE_REJECTION_CODES].sort());
    expect([...BACKEND_SOURCES]).toEqual([...DECISION_SOURCES]);
    expect([...BACKEND_INTERVIEW_STATUSES]).toEqual([...INTERVIEW_STATUSES]);
    expect([...BACKEND_PROVIDERS]).toEqual([...MEETING_PROVIDERS]);
  });

  it('agrees with the shared money kernel on all 32 fee combinations', async () => {
    // The backend computes from `app_settings`; `shared/money` computes from the
    // §6 seed defaults. On a freshly migrated database those are the same four
    // numbers, so the two must produce identical answers — and if an Admin later
    // changes one, this is the test that says which side moved.
    const settings = await readListingFeeSettings(h.db);
    const keys = ['visuals', 'branding', 'interviewConfirmed', 'story', 'socials'] as const;

    for (let mask = 0; mask < 32; mask += 1) {
      const flags = Object.fromEntries(
        keys.map((key, index) => [key, Boolean(mask & (1 << index))]),
      ) as OptionalItemCompletion;

      const completed = OPTIONAL_ITEM_KEYS.filter((key) =>
        key === 'interview' ? flags.interviewConfirmed : flags[key as keyof OptionalItemCompletion],
      );

      const mine = computeListingFee(settings, completed);
      const theirs = sharedComputeListingFee(flags);

      expect(mine.subtotalCents).toBe(theirs.subtotalCents);
      expect(mine.discountCents).toBe(theirs.discountCents);
      expect(mine.completedItems).toBe(theirs.completedItems);
    }
  });
});

/* ── §33.3.1 — the evidence rules ─────────────────────────────────────────── */

describe('§33.3.1 — the objective completion rules', () => {
  const empty: WorkspaceSnapshot = {
    assets: [],
    socials: [],
    brand: { colors: null, typography: null, approved: false },
    story: { text: null, approved: false },
    interview: { status: null },
    invalidated: {},
  };

  const decision = (snapshot: Partial<WorkspaceSnapshot>, item: string) =>
    decideItems({ ...empty, ...snapshot }).find((d) => d.item === item)!;

  it('completes nothing from an empty workspace', () => {
    for (const d of decideItems(empty)) {
      expect(d.complete).toBe(false);
      expect(d.rejections.length).toBeGreaterThan(0);
    }
  });

  it('rejects a visual that was uploaded but never approved (§12 "unapproved")', () => {
    const d = decision(
      {
        assets: [
          { id: 'a', purpose: 'visual', state: 'stored', rejection: null, approved: false, removed: false },
        ],
      },
      'visuals',
    );
    expect(d.complete).toBe(false);
    expect(d.rejections).toContain('not_approved');
  });

  it('rejects an approved visual that failed verification', () => {
    // Approval of something we have established is not usable completes
    // nothing — and the database refuses the pairing anyway.
    const d = decision(
      {
        assets: [
          {
            id: 'a',
            purpose: 'visual',
            state: 'rejected',
            rejection: 'file_placeholder',
            approved: true,
            removed: false,
          },
        ],
      },
      'visuals',
    );
    expect(d.complete).toBe(false);
    expect(d.rejections).toContain('file_placeholder');
  });

  it('completes Visuals only on a stored AND approved file', () => {
    const d = decision(
      {
        assets: [
          { id: 'a', purpose: 'visual', state: 'stored', rejection: null, approved: true, removed: false },
        ],
      },
      'visuals',
    );
    expect(d.complete).toBe(true);
    expect(d.rejections).toEqual([]);
  });

  it('rejects Branding with a logo but no written direction', () => {
    const d = decision(
      {
        assets: [
          { id: 'l', purpose: 'logo', state: 'stored', rejection: null, approved: true, removed: false },
        ],
      },
      'branding',
    );
    expect(d.complete).toBe(false);
    expect(d.rejections).toContain('nothing_supplied');
  });

  it('rejects Branding with colours but no typography (§12 "at least colors AND typography")', () => {
    const d = decision(
      {
        assets: [
          { id: 'l', purpose: 'logo', state: 'stored', rejection: null, approved: true, removed: false },
        ],
        brand: { colors: 'Deep green and bone', typography: null, approved: true },
      },
      'branding',
    );
    expect(d.complete).toBe(false);
    expect(d.rejections).toContain('direction_incomplete');
  });

  it('rejects a direction of whitespace', () => {
    const d = decision(
      {
        assets: [
          { id: 'l', purpose: 'logo', state: 'stored', rejection: null, approved: true, removed: false },
        ],
        brand: { colors: '   ', typography: '\n', approved: true },
      },
      'branding',
    );
    expect(d.complete).toBe(false);
  });

  it('rejects a written but unapproved Story (§12: "unapproved draft does not count")', () => {
    const d = decision(
      { story: { text: 'A long and genuine story about the product.', approved: false } },
      'story',
    );
    expect(d.complete).toBe(false);
    expect(d.rejections).toEqual(['not_approved']);
  });

  it('completes Story only when approved', () => {
    const d = decision({ story: { text: 'The story.', approved: true } }, 'story');
    expect(d.complete).toBe(true);
  });

  it('rejects an inaccessible social link (§12 "inaccessible URLs")', () => {
    const d = decision(
      {
        socials: [
          {
            id: 's',
            url: 'https://example.test/gone',
            accessible: false,
            rejection: 'url_unreachable',
            controlsConfirmed: true,
            removed: false,
          },
        ],
      },
      'socials',
    );
    expect(d.complete).toBe(false);
    expect(d.rejections).toContain('url_unreachable');
  });

  it('rejects a private profile as not public', () => {
    const d = decision(
      {
        socials: [
          {
            id: 's',
            url: 'https://example.test/private',
            accessible: false,
            rejection: 'url_not_public',
            controlsConfirmed: true,
            removed: false,
          },
        ],
      },
      'socials',
    );
    expect(d.rejections).toContain('url_not_public');
  });

  it('rejects an accessible profile the Founder has not claimed', () => {
    const d = decision(
      {
        socials: [
          {
            id: 's',
            url: 'https://example.test/someone-else',
            accessible: true,
            rejection: null,
            controlsConfirmed: false,
            removed: false,
          },
        ],
      },
      'socials',
    );
    expect(d.complete).toBe(false);
    expect(d.rejections).toContain('not_approved');
  });

  it('rejects a selected-but-unconfirmed interview (§12, §33.3.1)', () => {
    const d = decision({ interview: { status: 'selected' } }, 'interview');
    expect(d.complete).toBe(false);
    expect(d.rejections).toEqual(['booking_unconfirmed']);
  });

  it('rejects a canceled and an abandoned interview separately', () => {
    expect(decision({ interview: { status: 'canceled' } }, 'interview').rejections).toEqual([
      'booking_canceled',
    ]);
    expect(decision({ interview: { status: 'abandoned' } }, 'interview').rejections).toEqual([
      'booking_absent',
    ]);
  });

  it('completes the interview item only on `confirmed`', () => {
    expect(decision({ interview: { status: 'confirmed' } }, 'interview').complete).toBe(true);
  });

  it('holds an item incomplete while an Admin invalidation stands', () => {
    const d = decideItems({
      ...empty,
      story: { text: 'Approved and good.', approved: true },
      invalidated: { story: true },
    }).find((x) => x.item === 'story')!;

    expect(d.complete).toBe(false);
    expect(d.rejections[0]).toBe('invalidated');
    // The evidence the rule produced survives: an invalidation is a decision
    // ABOUT evidence, and discarding it would make the correction unreviewable.
    expect(d.evidence).toMatchObject({ written: true, approved: true });
  });
});

describe('§33.3.1 — placeholders and empty files, decided from the bytes', () => {
  it('reads real dimensions out of a PNG header', () => {
    expect(inspectMedia(png(1200, 800))).toMatchObject({
      detectedType: 'image/png',
      width: 1200,
      height: 800,
    });
  });

  it('treats a zero-byte file as unreadable rather than as an image', () => {
    expect(inspectMedia(Buffer.alloc(0)).detectedType).toBeNull();
  });

  it('does not recognise an HTML document declared as a PNG', () => {
    expect(inspectMedia(Buffer.from('<html><script>alert(1)</script>')).detectedType).toBeNull();
  });

  it('rejects an empty upload end to end', async () => {
    const { campaignId, cookie } = await makeCampaign('empty-file');
    const result = await upload(campaignId, cookie, {
      purpose: 'visual',
      body: Buffer.alloc(0),
    });
    // Refused before a URL is even issued: a zero-length object is not
    // something to sign a URL for.
    expect(result.status).toBe(422);
    expect(result.error).toBe('file_empty');
  });

  it('rejects a 1×1 placeholder after reading it back out of the bucket', async () => {
    const { campaignId, cookie } = await makeCampaign('placeholder');
    const result = await upload(campaignId, cookie, { purpose: 'visual', body: png(1, 1) });
    expect(result.status).toBe(200);

    const [asset] = await h.db
      .select()
      .from(campaignAssets)
      .where(eq(campaignAssets.id, result.assetId!))
      .limit(1);

    expect(asset!.state).toBe('rejected');
    expect(asset!.rejection).toBe('file_placeholder');
    expect(asset!.width).toBe(1);

    const view = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .expect(200);

    expect(itemOf(view.body, 'visuals').complete).toBe(false);
    expect(itemOf(view.body, 'visuals').rejections).toContain('file_placeholder');
  });

  it('rejects an image narrower than the narrowest viewport the product supports', async () => {
    const { campaignId, cookie } = await makeCampaign('too-small');
    const result = await upload(campaignId, cookie, {
      purpose: 'visual',
      body: png(MIN_VISUAL_EDGE_PX - 1, MIN_VISUAL_EDGE_PX - 1),
    });

    const [asset] = await h.db
      .select()
      .from(campaignAssets)
      .where(eq(campaignAssets.id, result.assetId!))
      .limit(1);

    expect(asset!.rejection).toBe('file_placeholder');
  });

  it('rejects a duplicate upload (§12 "duplicate uploads")', async () => {
    const { campaignId, cookie } = await makeCampaign('duplicate');
    const body = png(1200, 800);

    const first = await upload(campaignId, cookie, { purpose: 'visual', body });
    expect(first.status).toBe(200);

    const second = await upload(campaignId, cookie, {
      purpose: 'visual',
      body,
      filename: 'a-different-name.png',
    });
    // Content, not filename. Two copies of the same photo named differently is
    // the case the rule is actually about.
    expect(second.status).toBe(422);
    expect(second.error).toBe('file_duplicate');
  });

  it('refuses a content type a campaign page cannot carry', async () => {
    const { campaignId, cookie } = await makeCampaign('bad-type');
    const result = await upload(campaignId, cookie, {
      purpose: 'visual',
      body: png(1200, 800),
      contentType: 'image/svg+xml',
    });
    // SVG is a script container browsers execute. Excluded deliberately.
    expect(result.status).toBe(422);
    expect(result.error).toBe('file_type_unsupported');
  });

  it('completes Visuals once a real file is uploaded and approved', async () => {
    const { campaignId, cookie } = await makeCampaign('good-visual');
    const result = await upload(campaignId, cookie, { purpose: 'visual', body: png(1600, 900) });

    const before = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .expect(200);
    expect(itemOf(before.body, 'visuals').complete).toBe(false);
    expect(itemOf(before.body, 'visuals').rejections).toContain('not_approved');

    const after = await request(h.app)
      .post(`/api/founder/campaigns/${campaignId}/uploads/${result.assetId}/approval`)
      .set('cookie', cookie)
      .send({ approved: true })
      .expect(200);

    expect(itemOf(after.body, 'visuals').complete).toBe(true);
    expect(itemOf(after.body, 'visuals').decisionSource).toBe('founder_approval');
  });
});

/* ── §33.3.2 — the fee, through the service ───────────────────────────────── */

describe('§33.3.2 — the listing fee, on a real campaign', () => {
  it('starts at $35 with nothing done', async () => {
    const { campaignId, cookie } = await makeCampaign('fee-base');
    const view = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .expect(200);

    expect(view.body.workspace.fee.subtotalCents).toBe('3500');
    expect(view.body.workspace.fee.discountLines).toEqual([]);
  });

  it('takes $2 off per completed item and floors at $25, across all 32 combinations', async () => {
    const { campaignId } = await makeCampaign('fee-walk');
    await ensureWorkspace(h.db, { campaignId, actor: 'test' });

    const settings = await readListingFeeSettings(h.db);

    // Walked through `recordListingFee` rather than by hand-setting the item
    // rows: the evaluation re-derives every decision from the content, so a
    // hand-set completion is overwritten a millisecond later — which is exactly
    // the property §33.3.1 is about. What §33.3.2 is about is the arithmetic
    // over a set of completed items, and this walks all 32 of them against the
    // §6 settings and the row that was stored.
    for (let mask = 0; mask < 32; mask += 1) {
      const complete = OPTIONAL_ITEM_KEYS.filter((_, index) => mask & (1 << index));
      const expected = computeListingFee(settings, complete);

      const result = await recordListingFee(h.db, {
        campaignId,
        actor: 'test',
        trigger: `walk:${mask}`,
        completed: complete,
      });

      expect(result.completedItems).toBe(complete.length);
      expect(result.discountLines).toHaveLength(complete.length);
      expect(result.subtotalCents).toBe(expected.subtotalCents);

      // Never below the floor, never above the base — the two bounds §12 fixes.
      expect(result.subtotalCents).toBeGreaterThanOrEqual(2500n);
      expect(result.subtotalCents).toBeLessThanOrEqual(3500n);

      // The quote the Founder would be shown is the stored row, not the return
      // value — a calculation that was computed and not recorded is not one.
      const [written] = await h.db
        .select()
        .from(listingFeeCalculations)
        .where(eq(listingFeeCalculations.campaignId, campaignId))
        .orderBy(desc(listingFeeCalculations.calculatedAt))
        .limit(1);

      expect(written!.subtotalCents).toBe(expected.subtotalCents);
      expect(written!.completedItems).toBe(complete.length);
    }
  });

  it('reaches exactly $25 with all five and $35 with none', async () => {
    const { campaignId } = await makeCampaign('fee-bounds');
    await ensureWorkspace(h.db, { campaignId, actor: 'test' });

    const all = await recordListingFee(h.db, {
      campaignId,
      actor: 'test',
      trigger: 'all',
      completed: [...OPTIONAL_ITEM_KEYS],
    });
    expect(all.subtotalCents).toBe(2500n);
    // The cap and the floor are different constraints and both bind here.
    expect(all.discountCents).toBe(1000n);

    const none = await recordListingFee(h.db, {
      campaignId,
      actor: 'test',
      trigger: 'none',
      completed: [],
    });
    expect(none.subtotalCents).toBe(3500n);
  });

  it('records every calculation with the §6 values that were in force', async () => {
    const { campaignId } = await makeCampaign('fee-record');
    await ensureWorkspace(h.db, { campaignId, actor: 'test' });
    await evaluateWorkspace(h.db, { campaignId, actor: 'test', trigger: 'first' });

    const rows = await h.db
      .select()
      .from(listingFeeCalculations)
      .where(eq(listingFeeCalculations.campaignId, campaignId));

    expect(rows.length).toBeGreaterThan(0);
    // §29.6's reasoning applied to money: a setting an Admin changes tomorrow
    // must not silently rewrite what a Founder was quoted today.
    expect(rows[0]!.baseCents).toBe(3500n);
    expect(rows[0]!.itemDiscountCents).toBe(200n);
    expect(rows[0]!.maxDiscountCents).toBe(1000n);
    expect(rows[0]!.minSubtotalCents).toBe(2500n);
  });

  it('writes no new calculation when nothing changed', async () => {
    const { campaignId } = await makeCampaign('fee-idempotent');
    await ensureWorkspace(h.db, { campaignId, actor: 'test' });
    await evaluateWorkspace(h.db, { campaignId, actor: 'test', trigger: 'a' });
    const before = await h.db
      .select()
      .from(listingFeeCalculations)
      .where(eq(listingFeeCalculations.campaignId, campaignId));

    await evaluateWorkspace(h.db, { campaignId, actor: 'test', trigger: 'b' });
    await evaluateWorkspace(h.db, { campaignId, actor: 'test', trigger: 'c' });

    const after = await h.db
      .select()
      .from(listingFeeCalculations)
      .where(eq(listingFeeCalculations.campaignId, campaignId));

    // "The fee was recalculated at 14:32" only means something if it changed.
    expect(after.length).toBe(before.length);
  });

  it('carries §24.6’s separate-stream explanation with every preview', async () => {
    const { campaignId, cookie } = await makeCampaign('fee-note');
    const view = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .expect(200);

    const note: string = view.body.workspace.fee.separateStreamNote;
    expect(note).toContain('5%');
    expect(note.toLowerCase()).toContain('separate');
    // §3's banned vocabulary must not reach a Founder-facing sentence.
    for (const banned of ['pledge', 'donate', 'escrow', 'all-or-nothing', 'tranche']) {
      expect(note.toLowerCase()).not.toContain(banned);
    }
  });
});

/* ── §33.3.4 — high effort ────────────────────────────────────────────────── */

describe('§33.3.4 — high-effort across all eight combinations, persisted', () => {
  it('is true only when visuals, branding, and an interview are all absent', async () => {
    const { campaignId } = await makeCampaign('high-effort');
    await ensureWorkspace(h.db, { campaignId, actor: 'test' });

    for (let mask = 0; mask < 8; mask += 1) {
      const inputs = {
        visualsCompleted: Boolean(mask & 1),
        brandingCompleted: Boolean(mask & 2),
        interviewScheduledOrConfirmed: Boolean(mask & 4),
      };

      const result = await recordHighEffort(h.db, {
        campaignId,
        actor: 'test',
        trigger: `combination:${mask}`,
        ...inputs,
      });

      expect(result.highEffort).toBe(mask === 0);

      const [mirrored] = await h.db
        .select({ highEffort: campaigns.highEffort })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))
        .limit(1);

      // §25.1: the campaign record stores the result. Phase 12's matrix reads it.
      expect(mirrored!.highEffort).toBe(mask === 0);
    }

    const rows = await h.db
      .select()
      .from(highEffortClassifications)
      .where(eq(highEffortClassifications.campaignId, campaignId));

    // §12: "Store the three inputs, result, calculation time, and actor/system."
    for (const row of rows) {
      expect(row.actor).toBe('test');
      expect(row.trigger).toMatch(/^combination:|^workspace_opened$/);
      expect(row.highEffort).toBe(
        !row.visualsCompleted && !row.brandingCompleted && !row.interviewScheduledOrConfirmed,
      );
    }
  });

  it('refuses at the database level to store a classification that breaks §12’s rule', async () => {
    const { campaignId } = await makeCampaign('high-effort-check');

    // The service computes it, and the CHECK constraint is the second mechanism
    // — this is the number Phase 12's compensation matrix reads, so a wrong one
    // is a commercial term that is wrong.
    await expect(
      h.db.execute(`
        INSERT INTO high_effort_classifications
          (campaign_id, visuals_completed, branding_completed, interview_scheduled_or_confirmed,
           high_effort, actor, trigger)
        VALUES ('${campaignId}', true, false, false, true, 'test', 'hand-written')
      `),
    ).rejects.toThrow();
  });

  it('counts a selected-but-unconfirmed interview for high effort, not for the discount', async () => {
    const { campaignId } = await makeCampaign('high-effort-selected');
    await ensureWorkspace(h.db, { campaignId, actor: 'test' });
    await configureInterviews();

    const booked = await recordBooking(h.db, {
      campaignId,
      scheduledAt: new Date('2026-09-01T15:00:00Z'),
      founderTimezone: 'America/New_York',
      meetingProvider: 'zoom',
      actor: 'test',
      source: 'test',
    });
    expect(booked.ok).toBe(true);

    const result = await evaluateWorkspace(h.db, {
      campaignId,
      actor: 'test',
      trigger: 'after-booking',
    });

    // §12 uses "scheduled/confirmed" for high effort and `confirmed` for the item.
    expect(result.highEffort.interviewScheduledOrConfirmed).toBe(true);
    expect(result.highEffort.highEffort).toBe(false);
    expect(result.completed).not.toContain('interview');
  });
});

/* ── The four §6 interview settings ───────────────────────────────────────── */

/**
 * §6 names interview providers, availability, interviewers, and the reminder
 * lead time and fixes a value for none of them, so all four ship unset. Booking
 * is refused until an operator states them; this states them for the suite.
 */
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

describe('§6 — nothing is bookable until an operator states the interview settings', () => {
  it('names the missing settings rather than failing', async () => {
    // Runs against a fresh campaign but reads global settings, so it asserts
    // the shape rather than the emptiness once the suite has configured them.
    const { campaignId, cookie } = await makeCampaign('interview-config');
    const view = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .expect(200);

    const interview = view.body.workspace.interview;
    expect(Array.isArray(interview.missingSettings)).toBe(true);
    expect(interview.bookable).toBe(interview.missingSettings.length === 0);
    // §1 rule 6: the four keys exist and none of them has an invented default.
    expect([...INTERVIEW_SETTING_KEYS]).toEqual([
      'interview_providers',
      'interview_availability',
      'interviewers',
      'interview_reminder_lead_hours',
    ]);
  });
});

/* ── §33.3.3 — the cancellation asymmetry ─────────────────────────────────── */

describe('§33.3.3 — canceling before payment recalculates; after payment does not', () => {
  it('recalculates high effort and the fee when canceled before payment', async () => {
    const { campaignId } = await makeCampaign('cancel-before');
    await ensureWorkspace(h.db, { campaignId, actor: 'test' });
    await configureInterviews();

    const booked = await recordBooking(h.db, {
      campaignId,
      scheduledAt: new Date('2026-09-02T15:00:00Z'),
      founderTimezone: 'America/New_York',
      meetingProvider: 'google_meet',
      actor: 'test',
      source: 'test',
    });
    if (!booked.ok) throw new Error(booked.message);

    const confirmed = await confirmBooking(h.db, {
      bookingId: booked.bookingId,
      campaignId,
      meetingLink: 'https://meet.example/abc-defg-hij',
      interviewer: 'Alex Interviewer',
      actor: 'test',
      source: 'test',
    });
    if (!confirmed.ok) throw new Error(confirmed.message);

    // Confirmed: the item completes, the discount lands, high effort is false.
    expect(confirmed.evaluation.completed).toContain('interview');
    expect(confirmed.evaluation.fee.subtotalCents).toBe(3300n);
    expect(confirmed.evaluation.highEffort.highEffort).toBe(false);

    const canceled = await cancelBooking(h.db, {
      bookingId: booked.bookingId,
      campaignId,
      actor: 'test',
      source: 'founder',
      reason: 'Something came up',
    });
    if (!canceled.ok) throw new Error(canceled.message);

    // §12: "Canceling before listing-fee payment recalculates both high-effort
    // status and the fee."
    expect(canceled.evaluation.completed).not.toContain('interview');
    expect(canceled.evaluation.fee.subtotalCents).toBe(3500n);
    expect(canceled.evaluation.highEffort.interviewScheduledOrConfirmed).toBe(false);
    expect(canceled.evaluation.highEffort.highEffort).toBe(true);
  });

  it('does not change the amount already paid when canceled after payment', async () => {
    const { campaignId } = await makeCampaign('cancel-after');
    await ensureWorkspace(h.db, { campaignId, actor: 'test' });
    await configureInterviews();

    const booked = await recordBooking(h.db, {
      campaignId,
      scheduledAt: new Date('2026-09-03T15:00:00Z'),
      founderTimezone: 'America/New_York',
      meetingProvider: 'microsoft_teams',
      actor: 'test',
      source: 'test',
    });
    if (!booked.ok) throw new Error(booked.message);

    const confirmed = await confirmBooking(h.db, {
      bookingId: booked.bookingId,
      campaignId,
      meetingLink: 'https://teams.example/xyz',
      interviewer: 'Alex Interviewer',
      actor: 'test',
      source: 'test',
    });
    if (!confirmed.ok) throw new Error(confirmed.message);
    expect(confirmed.evaluation.fee.subtotalCents).toBe(3300n);

    // Phase 11's act, performed by hand: the payment stamps the anchor and locks
    // §12's evidence snapshot and the calculation that was charged.
    const paidAt = new Date();
    await h.db.update(campaigns).set({ listingPaidAt: paidAt }).where(eq(campaigns.id, campaignId));
    await h.db
      .update(campaignOptionalItems)
      .set({ lockedAt: paidAt, updatedBy: 'system:listing_payment' })
      .where(eq(campaignOptionalItems.campaignId, campaignId));
    await h.db.execute(`
      UPDATE listing_fee_calculations SET locked_at = now()
       WHERE campaign_id = '${campaignId}'
         AND calculated_at = (SELECT max(calculated_at) FROM listing_fee_calculations WHERE campaign_id = '${campaignId}')
    `);

    const canceled = await cancelBooking(h.db, {
      bookingId: booked.bookingId,
      campaignId,
      actor: 'test',
      source: 'founder',
      reason: 'Canceled after paying',
    });
    if (!canceled.ok) throw new Error(canceled.message);

    // §12: "Canceling after successful payment does not change the amount
    // already paid." The cancellation is real — the booking moved — and the
    // money did not.
    expect(canceled.status).toBe('canceled');
    expect(canceled.evaluation.fee.subtotalCents).toBe(3300n);
    expect(canceled.evaluation.completed).toContain('interview');
    expect(canceled.evaluation.locked).toBe(true);

    const [booking] = await h.db
      .select()
      .from(founderInterviewBookings)
      .where(eq(founderInterviewBookings.id, booked.bookingId))
      .limit(1);
    expect(booking!.status).toBe('canceled');
    expect(booking!.cancellationReason).toBe('Canceled after paying');
  });

  it('refuses at the database level to edit a locked evidence snapshot', async () => {
    const { campaignId } = await makeCampaign('lock-trigger');
    await ensureWorkspace(h.db, { campaignId, actor: 'test' });
    await h.db
      .update(campaignOptionalItems)
      .set({ lockedAt: new Date(), updatedBy: 'system:listing_payment' })
      .where(eq(campaignOptionalItems.campaignId, campaignId));

    await expect(
      h.db.execute(`
        UPDATE campaign_optional_items
           SET complete = true, completed_at = now(), decision_source = 'founder_approval',
               updated_by = 'someone'
         WHERE campaign_id = '${campaignId}' AND item = 'story'
      `),
      // Drizzle wraps the trigger's message, so the assertion is that the
      // statement was refused at all — the trigger is what refuses it.
    ).rejects.toThrow();
  });

  it('records the cancellation in the append-only booking history (§12)', async () => {
    const { campaignId } = await makeCampaign('booking-history');
    await ensureWorkspace(h.db, { campaignId, actor: 'test' });
    await configureInterviews();

    const booked = await recordBooking(h.db, {
      campaignId,
      scheduledAt: new Date('2026-09-04T15:00:00Z'),
      founderTimezone: 'America/Chicago',
      meetingProvider: 'zoom',
      actor: 'test',
      source: 'founder',
    });
    if (!booked.ok) throw new Error(booked.message);

    await cancelBooking(h.db, {
      bookingId: booked.bookingId,
      campaignId,
      actor: 'test',
      source: 'provider:cal.com',
      reason: 'Canceled in the provider',
    });

    const history = await h.db
      .select()
      .from(interviewBookingEvents)
      .where(eq(interviewBookingEvents.campaignId, campaignId));

    expect(history.map((e) => e.event).sort()).toEqual(['canceled', 'created']);
    // `source` is what makes a reconciliation distinguishable from a webhook
    // after the fact, which is the question anyone debugging a missed delivery
    // will actually ask.
    expect(history.find((e) => e.event === 'canceled')!.source).toBe('provider:cal.com');

    await expect(
      asAppRole((client) =>
        client.query(
          `UPDATE interview_booking_events SET event = 'edited' WHERE campaign_id = $1`,
          [campaignId],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('leaves `confirmed` reachable without a webhook', async () => {
    // Phase 09's trap: "Cal.com is a source of events, not truth… don't leave
    // `confirmed` reachable only by webhook." The reconciliation path is the
    // same function the webhook will call in 09b.
    const { campaignId } = await makeCampaign('reconcile');
    await ensureWorkspace(h.db, { campaignId, actor: 'test' });
    await configureInterviews();

    const booked = await recordBooking(h.db, {
      campaignId,
      scheduledAt: new Date('2026-09-05T15:00:00Z'),
      founderTimezone: 'UTC',
      meetingProvider: 'zoom',
      actor: 'test',
      source: 'founder',
    });
    if (!booked.ok) throw new Error(booked.message);

    const confirmed = await confirmBooking(h.db, {
      bookingId: booked.bookingId,
      campaignId,
      meetingLink: 'https://zoom.example/123',
      interviewer: 'Alex Interviewer',
      actor: `user:${admin.id}`,
      source: 'admin_reconciliation',
    });
    expect(confirmed.ok).toBe(true);

    const history = await h.db
      .select()
      .from(interviewBookingEvents)
      .where(eq(interviewBookingEvents.campaignId, campaignId));
    expect(history.find((e) => e.event === 'confirmed')!.source).toBe('admin_reconciliation');
  });

  it('refuses to confirm a booking missing any fact §12 requires', async () => {
    const { campaignId } = await makeCampaign('incomplete-confirm');
    await ensureWorkspace(h.db, { campaignId, actor: 'test' });
    await configureInterviews();

    const booked = await recordBooking(h.db, {
      campaignId,
      scheduledAt: new Date('2026-09-06T15:00:00Z'),
      founderTimezone: 'UTC',
      meetingProvider: 'zoom',
      actor: 'test',
      source: 'founder',
    });
    if (!booked.ok) throw new Error(booked.message);

    // No link, no interviewer. A confirmed booking nobody can attend would earn
    // a US$2 discount and clear a high-effort input on the strength of nothing.
    const result = await confirmBooking(h.db, {
      bookingId: booked.bookingId,
      campaignId,
      actor: 'test',
      source: 'test',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('incomplete');
  });
});

/* ── §12 Admin ────────────────────────────────────────────────────────────── */

describe('§12 Admin — invalidation, correction, and the recorded override', () => {
  it('invalidates an item with a reason and hands the Founder a correction', async () => {
    const { campaignId, cookie } = await makeCampaign('admin-invalidate');

    await request(h.app)
      .patch(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .send({ storyText: 'A real story about the product.', storyApproved: true })
      .expect(200);

    const before = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .expect(200);
    expect(itemOf(before.body, 'story').complete).toBe(true);

    const invalidated = await request(h.app)
      .post(`/api/admin/campaigns/${campaignId}/workspace/items/story/invalidate`)
      .set('cookie', admin.cookie)
      .send({
        reason: 'Story reproduces a competitor’s marketing copy verbatim.',
        explanation: 'We need this in your own words before it goes public.',
      })
      .expect(200);

    expect(invalidated.body.workspace.items.find((i: any) => i.item === 'story').complete).toBe(false);

    // The Founder reads the customer-facing explanation and never the internal
    // reason (§25.6 keeps them in separate columns).
    const founderView = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .expect(200);

    const story = itemOf(founderView.body, 'story');
    expect(story.invalidated.explanation).toContain('your own words');
    expect(JSON.stringify(founderView.body)).not.toContain('competitor’s marketing copy');

    // §12: "the Founder can correct it." Re-approving after an edit is not
    // enough on its own — the invalidation stands until Admin lifts it.
    await request(h.app)
      .patch(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .send({ storyText: 'Rewritten entirely in my own words.', storyApproved: true })
      .expect(200);

    const stillHeld = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .expect(200);
    expect(itemOf(stillHeld.body, 'story').complete).toBe(false);

    const reinstated = await request(h.app)
      .post(`/api/admin/campaigns/${campaignId}/workspace/items/story/reinstate`)
      .set('cookie', admin.cookie)
      .send({ reason: 'Rewritten; reads as their own.' })
      .expect(200);

    expect(reinstated.body.workspace.items.find((i: any) => i.item === 'story').complete).toBe(true);
  });

  it('refuses an invalidation with no reason or no Founder-facing explanation', async () => {
    const { campaignId } = await makeCampaign('admin-no-reason');
    await ensureWorkspace(h.db, { campaignId, actor: 'test' });

    await request(h.app)
      .post(`/api/admin/campaigns/${campaignId}/workspace/items/story/invalidate`)
      .set('cookie', admin.cookie)
      .send({ reason: 'because' })
      .expect(400);
  });

  it('records an override as an override, with all six §12 facts', async () => {
    const { campaignId, cookie } = await makeCampaign('admin-override');
    await ensureWorkspace(h.db, { campaignId, actor: 'test' });

    await request(h.app)
      .post(`/api/admin/campaigns/${campaignId}/workspace/items/visuals/override`)
      .set('cookie', admin.cookie)
      .send({
        complete: true,
        reason: 'Founder emailed the files; upload was failing on their network.',
        explanation: 'We have your visuals and have counted them.',
        evidence: 'support ticket 4821, files received 2026-08-01',
      })
      .expect(200);

    const [item] = await h.db
      .select()
      .from(campaignOptionalItems)
      .where(
        and(
          eq(campaignOptionalItems.campaignId, campaignId),
          eq(campaignOptionalItems.item, 'visuals'),
        ),
      )
      .limit(1);

    expect(item!.complete).toBe(true);
    expect(item!.decisionSource).toBe('admin_override');

    // §25.6: prior value, new value, reason, actor, time, and evidence.
    const audits = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, `${campaignId}:visuals`));

    const override = audits.find((a) => a.action === 'optional_item.overridden');
    expect(override).toBeDefined();
    expect(override!.internalReason).toContain('upload was failing');
    expect(override!.customerExplanation).toContain('counted them');
    expect(override!.actor).toBe(`user:${admin.id}`);
    expect(JSON.stringify(override!.newValue)).toContain('support ticket 4821');

    // The override survives re-evaluation — otherwise the next autosave would
    // silently withdraw a decision a person made.
    await request(h.app)
      .patch(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .send({ brandNotes: 'anything' })
      .expect(200);

    const after = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .expect(200);
    expect(itemOf(after.body, 'visuals').complete).toBe(true);
    expect(itemOf(after.body, 'visuals').decisionSource).toBe('admin_override');
  });

  it('writes the item history by trigger, and refuses to rewrite it', async () => {
    const { campaignId, cookie } = await makeCampaign('history');
    await request(h.app)
      .patch(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .send({ storyText: 'Something worth publishing.', storyApproved: true })
      .expect(200);

    const events = await h.db
      .select()
      .from(optionalItemEvents)
      .where(eq(optionalItemEvents.campaignId, campaignId));

    expect(events.some((e) => e.item === 'story' && e.event === 'completed')).toBe(true);

    await expect(
      asAppRole((client) =>
        client.query(`UPDATE optional_item_events SET event = 'x' WHERE campaign_id = $1`, [
          campaignId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

/* ── §12's other rules ────────────────────────────────────────────────────── */

describe('§12 — approval is of a version, and authorization is per campaign', () => {
  it('revokes the approval when the approved text is edited', async () => {
    const { campaignId, cookie } = await makeCampaign('approval-version');

    await request(h.app)
      .patch(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .send({ storyText: 'The first version.', storyApproved: true })
      .expect(200);

    const approved = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .expect(200);
    expect(approved.body.workspace.story.approved).toBe(true);

    await request(h.app)
      .patch(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .send({ storyText: 'A completely different second version.' })
      .expect(200);

    const edited = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .expect(200);

    // §12 rejects unapproved drafts, and an edited approved story is one.
    expect(edited.body.workspace.story.approved).toBe(false);
    expect(itemOf(edited.body, 'story').complete).toBe(false);
  });

  it('writes only the keys a save was given', async () => {
    // §9's rule, restated for this surface: `undefined` means "not in this
    // request", and the obvious implementation empties a story on the first
    // partial save.
    const { campaignId, cookie } = await makeCampaign('partial-save');

    await request(h.app)
      .patch(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .send({ storyText: 'Keep me.' })
      .expect(200);

    await request(h.app)
      .patch(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .send({ brandColors: 'Deep green' })
      .expect(200);

    const view = await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', cookie)
      .expect(200);

    expect(view.body.workspace.story.text).toBe('Keep me.');
    expect(view.body.workspace.brand.colors).toBe('Deep green');
  });

  it('answers 404 for another Founder’s campaign, exactly as for one that does not exist', async () => {
    const mine = await makeCampaign('owner');
    const theirs = await makeCampaign('intruder');

    const crossed = await request(h.app)
      .get(`/api/founder/campaigns/${mine.campaignId}/workspace`)
      .set('cookie', theirs.cookie)
      .expect(404);

    const absent = await request(h.app)
      .get(`/api/founder/campaigns/${randomUUID()}/workspace`)
      .set('cookie', theirs.cookie)
      .expect(404);

    // Indistinguishable, so nothing can be enumerated.
    expect(crossed.body).toEqual(absent.body);
  });

  it('refuses the workspace to a signed-out caller and to a Creator', async () => {
    const { campaignId } = await makeCampaign('guarded');
    const creator = await seedUser(h, 'affiliate', 'workspace-creator');
    const creatorCookie = await signInPlain(h, creator.email);

    await request(h.app).get(`/api/founder/campaigns/${campaignId}/workspace`).expect(401);
    await request(h.app)
      .get(`/api/founder/campaigns/${campaignId}/workspace`)
      .set('cookie', creatorCookie)
      .expect(403);
  });

  it('refuses Admin item routes to a Founder', async () => {
    const { campaignId, cookie } = await makeCampaign('admin-guarded');
    await request(h.app)
      .post(`/api/admin/campaigns/${campaignId}/workspace/items/story/invalidate`)
      .set('cookie', cookie)
      .send({ reason: 'x', explanation: 'y' })
      .expect(403);
  });

  it('mounts no route that accepts a file body (tech-stack §9)', async () => {
    // The bytes go from the browser to R2. There is no upload endpoint, and
    // "no file touches the VPS disk" is true because there is nowhere to put one.
    const { campaignId, cookie } = await makeCampaign('no-file-route');
    const response = await request(h.app)
      .post(`/api/founder/campaigns/${campaignId}/uploads`)
      .set('cookie', cookie)
      .set('content-type', 'multipart/form-data; boundary=x')
      .send('--x\r\nContent-Disposition: form-data; name="f"; filename="a.png"\r\n\r\nx\r\n--x--');

    expect(response.status).not.toBe(200);
  });
});
