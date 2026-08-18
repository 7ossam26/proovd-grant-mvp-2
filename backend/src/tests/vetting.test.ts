/**
 * The vetting and account-claim suite — §33.1.4 through §33.1.9.
 *
 * ── The 2026-08-10 deviation was WITHDRAWN on 2026-08-18 ───────────────────
 * Four things reverted to §9 and §10 as written, and every test below that
 * moved was moved BACK rather than forward: the Founder chooses their own
 * campaign path again, Positioning is the third required answer, §10's result
 * has a Founder-facing route again, and the amount of views is retired from
 * collection.
 *
 * The one thing that did NOT revert with them is the §10 GATE. §10 orders the
 * result before account creation and says nothing about blocking one; the
 * 2026-08-10 change removed the gate and this reversion deliberately leaves it
 * removed. `§33.1.6 … is a record, not a gate` therefore still passes for the
 * reason it always did.
 *
 * What each §33.1 item means:
 *
 *   33.1.4  Path/Problem/Solution/Positioning order, progress, autosave,
 *           restore, and provenance work.
 *   33.1.5  Competition cannot be prefilled — and now that it is collected
 *           again, the guarantee is load-bearing rather than dormant. Every
 *           test in that block passed UNCHANGED across the reversion, which is
 *           the point: the guarantee was structural, not a property of the
 *           question being absent.
 *   33.1.6  The possible-creator result is an Admin-recorded assessment that
 *           renders no promise and blocks nothing.
 *   33.1.7  Type locks at submission; wrong type archives and restarts without
 *           migrating agreements/payments/consents.
 *   33.1.8  No SMS OTP exists.
 *   33.1.9  `founder_signup_complete` emits once.
 *
 * The parts that are surface behaviour are proved by
 * `frontend/src/surfaces/draft/vetting.test.tsx` against the real components.
 * What is proved here is everything the server owns: order, storage,
 * provenance, restore, and the failure directions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';

import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, type AdminSession } from './admin-session.js';
import { seedAdminReauthWindow } from '../settings/service.js';
import { auditEvents, idempotencyKeys } from '../db/schema/integrity.js';
import { secureTokens } from '../db/schema/tokens.js';
import { campaigns, campaignStatusHistory, campaignAffiliateAssociations } from '../db/schema/domain.js';
import { campaignDrafts, founderProspects } from '../db/schema/invitations.js';
import {
  campaignVetting,
  draftFieldEdits,
  founderClaimProfiles,
  policyConsents,
  possibleCreatorResults,
} from '../db/schema/vetting.js';
import { policyVersions } from '../db/schema/policies.js';
import { user as userTable } from '../db/schema/auth.js';
import { TOKEN_REJECTION_STATUS } from '../auth/token-rejection.js';
import {
  VETTING_ANSWER_STEPS,
  VETTING_STEPS as BACKEND_VETTING_STEPS,
  VIEWS_RANGES,
  CAMPAIGN_TYPES,
} from '../vetting/service.js';
import {
  FOUNDER_CLAIM_POLICY_SLUGS,
  founderSignupCompleteKey,
  FOUNDER_SIGNUP_COMPLETE,
} from '../vetting/claim.js';
import { sweepUnclaimedDrafts } from '../invitations/retention.js';
import {
  VETTING_STEP_IDS,
  VETTING_ANSWER_STEP_IDS,
  VIEWS_RANGE_IDS,
  CAMPAIGN_PATH_CHOICES,
} from '@proovd/shared';

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'vetting');
  admin = await createAdmin(h, 'vetting-admin');
  await seedAdminReauthWindow(h.db, 3600);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

const COMPOSE = {
  whatWeUnderstood: 'A scheduling tool that fills cancelled clinic slots from a waitlist.',
  whyInvited: 'Two clinics renewed without being asked.',
  senderName: 'Ada Admin',
  senderEmail: 'ada@proovd.co',
  expectedSetupTime: 'About two hours, spread over a week.',
};

interface Invited {
  draftId: string;
  campaignId: string;
  prospectId: string;
  email: string;
  raw: string;
}

async function invite(label: string): Promise<Invited> {
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
    .send(COMPOSE)
    .expect(200);

  const before = h.sentEmails.messages.length;
  await request(h.app)
    .post(`/api/admin/founders/${created.body.draftId}/send`)
    .set('cookie', admin.cookie)
    .send({})
    .expect(201);

  const message = h.sentEmails.messages[before]!;
  const raw = /http:\/\/localhost:3000\/draft\/([A-Za-z0-9_-]+)/.exec(message.text)![1]!;

  return { ...created.body, email, raw };
}

const ANSWERS = {
  problem:
    'Clinics lose two or three appointments a week to late cancellations and the slot just goes empty.',
  solution:
    'When a slot frees up we text the waitlist in order and the first person to answer takes it.',
  competition:
    'Mostly a receptionist calling down a paper list, plus two scheduling suites that charge per seat and do not text at all.',
};

/**
 * Admin's discovery answer for the campaign path.
 *
 * It STAYS beside the Founder's own choice (§9 step 1 reverted on 2026-08-18):
 * this is how a path is set from a discovery call, and the Founder's screen
 * arrives pre-selected from it.
 */
function setPath(draftId: string, type: 'pre_build' | 'pre_launch') {
  return request(h.app)
    .put(`/api/admin/founders/${draftId}/campaign-path`)
    .set('cookie', admin.cookie)
    .send({ campaignPath: type });
}

/**
 * The whole §9 sequence as a Founder walks it: the path and all three answers
 * through the DRAFT token, then submit.
 *
 * It deliberately does not call `setPath`. The Founder's own route is the one
 * every downstream test should be exercising, and a helper that quietly used
 * Admin's would leave the reverted path untested in fifty places.
 */
async function completeVetting(
  invited: Invited,
  type: 'pre_build' | 'pre_launch' = 'pre_launch',
): Promise<Record<string, unknown>> {
  const raw = invited.raw;
  await request(h.app).patch(`/api/draft/${raw}/vetting`).send({ selectedType: type }).expect(200);
  await request(h.app).patch(`/api/draft/${raw}/vetting`).send({ problem: ANSWERS.problem }).expect(200);
  await request(h.app).patch(`/api/draft/${raw}/vetting`).send({ solution: ANSWERS.solution }).expect(200);
  await request(h.app)
    .patch(`/api/draft/${raw}/vetting`)
    .send({ competition: ANSWERS.competition })
    .expect(200);

  const res = await request(h.app).post(`/api/draft/${raw}/vetting/submit`).send({}).expect(201);
  return res.body;
}

function recordSignal(campaignId: string, count: number, basis = 'six recruited channels in this niche') {
  return request(h.app)
    .post(`/api/admin/campaigns/${campaignId}/creator-signal`)
    .set('cookie', admin.cookie)
    .send({ count, basis });
}

const CLAIM_FIELDS = {
  legalName: 'Rowan Vale',
  preferredName: 'Rowan',
  dateOfBirth: '1990-04-11',
  country: 'United States',
  stateRegion: 'Oregon',
  soleProprietor: true,
  representationUsPerson: true,
  representationAge18Plus: true,
  representationSanctions: true,
};

const PASSWORD = 'a-perfectly-good-password';

/**
 * Publishes the three §31.4 documents a claim cites.
 *
 * Every document ships as a draft while Track A2 is in legal review, and a
 * consent may cite only a published version — enforced by trigger. So a test
 * that wants to reach the claim has to publish first, which is exactly the
 * order the real deployment will follow (§34 condition 4, Phase 24).
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

/* ── Source-tree scanning, for the rules that are about absence ───────────── */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

function sourceFiles(): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', 'dist', '.git', 'coverage', 'vendor']);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  for (const workspace of ['backend/src', 'frontend/src', 'shared/src']) {
    walk(path.join(ROOT, workspace));
  }
  return out;
}

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/* ══════════════════════════════════════════════════════════════════════════
   The shared register and the backend restatement agree
   ══════════════════════════════════════════════════════════════════════════ */

describe('the §9 sequence is stated once', () => {
  it('matches the shared register exactly, in order', () => {
    expect([...BACKEND_VETTING_STEPS]).toEqual([...VETTING_STEP_IDS]);
    expect([...VETTING_ANSWER_STEPS]).toEqual([...VETTING_ANSWER_STEP_IDS]);
  });

  // Retired from collection, still restated: stored answers are read on the
  // Admin workspace and the two registers must not drift apart while they are.
  it('restates the views ranges exactly, though nothing collects one any more', () => {
    expect([...VIEWS_RANGES]).toEqual([...VIEWS_RANGE_IDS]);
  });

  it('offers exactly the two campaign paths §4 defines, to the Founder and to Admin', () => {
    expect(CAMPAIGN_PATH_CHOICES.map((c) => c.type).sort()).toEqual([...CAMPAIGN_TYPES].sort());
  });

  it('never renders an internal type name to a person (§3)', () => {
    for (const choice of CAMPAIGN_PATH_CHOICES) {
      const rendered = [choice.prompt, choice.name, choice.summary, ...choice.commitments].join(' ');
      expect(rendered).not.toMatch(/pre[-_ ]build/i);
      expect(rendered).not.toMatch(/pre[-_ ]launch/i);
      expect(rendered).not.toMatch(/\breservation\b/i);
      expect(rendered).not.toMatch(/\btranche\b/i);
      expect(rendered).not.toMatch(/\bpledge\b/i);
      expect(rendered).not.toMatch(/all-or-nothing/i);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §33.1.4 — order, autosave, restore, provenance
   ══════════════════════════════════════════════════════════════════════════ */

describe('§33.1.4 the vetting sequence', () => {
  it('opens with every answer empty and nothing submitted', async () => {
    const { raw } = await invite('open');
    const res = await request(h.app).get(`/api/draft/${raw}/vetting`).expect(200);

    expect(res.body.selectedType).toBeNull();
    expect(res.body.problem).toBeNull();
    expect(res.body.solution).toBeNull();
    expect(res.body.competition).toBeNull();
    // Retired from collection, so it opens null and stays null — but it is
    // still READ, because a record from before the retirement carries one.
    expect(res.body.views).toBeNull();
    expect(res.body.submittedAt).toBeNull();
    expect(res.body.completeness).toEqual({
      problem: false,
      solution: false,
      competition: false,
    });
  });

  it('saves each answer as it is typed and reports when it was saved', async () => {
    const { raw } = await invite('autosave');

    const first = await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ problem: ANSWERS.problem })
      .expect(200);

    expect(first.body.problem).toBe(ANSWERS.problem);
    expect(first.body.lastSavedAt).toBeTruthy();
    expect(first.body.completeness.problem).toBe(true);
  });

  // DELIBERATELY INVERTED (2026-08-18). This tested the amount-of-views answer,
  // which §9 never asked for and which is retired from collection. What it
  // tests now is the answer that took its place in the sequence.
  it('saves the Positioning answer, always as the Founder’s own words', async () => {
    const { raw } = await invite('positioning');

    const saved = await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ competition: ANSWERS.competition })
      .expect(200);
    expect(saved.body.competition).toBe(ANSWERS.competition);
    expect(saved.body.completeness.competition).toBe(true);
    // §9, twice, and §33.1.5: never `proovd`, whatever wrote it.
    expect(saved.body.provenance.competition.supplier).toBe('founder');
    // There is no prefill snapshot to carry, and no column that could hold one.
    expect(saved.body.provenance.competition.prefilledText).toBeNull();
  });

  // DELIBERATELY INVERTED (2026-08-18). §9 step 1 is the Founder's again.
  it('saves the campaign path from the Founder’s own route, and refuses a third value', async () => {
    const { raw } = await invite('founder-path');

    const saved = await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ selectedType: 'pre_build' })
      .expect(200);
    expect(saved.body.selectedType).toBe('pre_build');
    // Nothing is locked yet — the lock is at submission (§9, §33.1.7), which
    // is what makes the flow's own Back button safe.
    expect(saved.body.lockedType).toBeNull();
    expect(saved.body.typeLockedAt).toBeNull();

    // Changing their mind is ordinary, and is what the Back button does.
    const changed = await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ selectedType: 'pre_launch' })
      .expect(200);
    expect(changed.body.selectedType).toBe('pre_launch');

    const refused = await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ selectedType: 'pre_something_else' })
      .expect(422);
    expect(refused.body.whatHappened).toMatch(/not one of the two campaign paths/i);

    const after = await request(h.app).get(`/api/draft/${raw}/vetting`).expect(200);
    expect(after.body.selectedType).toBe('pre_launch');
  });

  it('restores the latest saved draft on a later visit (§9, DNA §5.12)', async () => {
    const { raw } = await invite('restore');

    await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ problem: ANSWERS.problem, resumeStep: 'solution' })
      .expect(200);

    const reopened = await request(h.app).get(`/api/draft/${raw}/vetting`).expect(200);
    expect(reopened.body.problem).toBe(ANSWERS.problem);
    // Position survives: the link reopens where they left off.
    expect(reopened.body.resumeStep).toBe('solution');
    expect(reopened.body.lastSavedAt).toBeTruthy();
  });

  it('preserves later answers when an earlier one is changed', async () => {
    // "Returning to an earlier item preserves later valid answers." This is
    // the requirement a wizard that rebuilds forward state from the current
    // step silently breaks.
    const { raw } = await invite('preserve');

    await request(h.app).patch(`/api/draft/${raw}/vetting`).send({ problem: ANSWERS.problem }).expect(200);
    await request(h.app).patch(`/api/draft/${raw}/vetting`).send({ solution: ANSWERS.solution }).expect(200);
    await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ competition: ANSWERS.competition })
      .expect(200);

    // Back to step 1, and change it.
    const after = await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ problem: 'A different problem statement entirely.' })
      .expect(200);

    expect(after.body.problem).toBe('A different problem statement entirely.');
    expect(after.body.solution).toBe(ANSWERS.solution);
    expect(after.body.competition).toBe(ANSWERS.competition);
  });

  it('a save that carries one field does not clear the others', async () => {
    // §9: "A failed save never clears valid fields." The structural half of that
    // is that a partial patch is partial — a request that omits a key must not
    // be read as a request to empty it.
    const { raw } = await invite('partial');

    await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ problem: ANSWERS.problem, solution: ANSWERS.solution })
      .expect(200);

    const after = await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ resumeStep: 'competition' })
      .expect(200);

    expect(after.body.problem).toBe(ANSWERS.problem);
    expect(after.body.solution).toBe(ANSWERS.solution);
  });

  it('records provenance: Proovd prefilled it, then the Founder took it over', async () => {
    const { draftId, raw } = await invite('provenance');

    await request(h.app)
      .put(`/api/admin/founders/${draftId}/vetting-prefill`)
      .set('cookie', admin.cookie)
      .send({ problem: 'Our draft of the problem.', solution: 'Our draft of the solution.' })
      .expect(200);

    const prefilled = await request(h.app).get(`/api/draft/${raw}/vetting`).expect(200);
    expect(prefilled.body.problem).toBe('Our draft of the problem.');
    expect(prefilled.body.provenance.problem.supplier).toBe('proovd');
    expect(prefilled.body.provenance.problem.prefilledText).toBe('Our draft of the problem.');
    expect(prefilled.body.provenance.problem.firstEditedAt).toBeNull();

    const edited = await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ problem: ANSWERS.problem })
      .expect(200);

    expect(edited.body.provenance.problem.supplier).toBe('founder');
    // §9: "Store original text, current text, supplier… and edit timestamps."
    // The original survives the Founder replacing it.
    expect(edited.body.provenance.problem.prefilledText).toBe('Our draft of the problem.');
    expect(edited.body.provenance.problem.firstEditedAt).toBeTruthy();
    expect(edited.body.provenance.problem.lastEditedAt).toBeTruthy();
  });

  it('keeps the first edit timestamp fixed while the last one moves', async () => {
    const { raw } = await invite('timestamps');

    const one = await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ solution: 'First attempt.' })
      .expect(200);

    await new Promise((r) => setTimeout(r, 15));

    const two = await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ solution: 'Second attempt.' })
      .expect(200);

    expect(two.body.provenance.solution.firstEditedAt).toBe(
      one.body.provenance.solution.firstEditedAt,
    );
    expect(new Date(two.body.provenance.solution.lastEditedAt).getTime()).toBeGreaterThan(
      new Date(one.body.provenance.solution.lastEditedAt).getTime(),
    );
  });

  it('writes an append-only edit row for every change, with who supplied it', async () => {
    const { draftId, raw } = await invite('history');

    await request(h.app)
      .put(`/api/admin/founders/${draftId}/vetting-prefill`)
      .set('cookie', admin.cookie)
      .send({ problem: 'Our draft.' })
      .expect(200);
    await request(h.app).patch(`/api/draft/${raw}/vetting`).send({ problem: 'Their draft.' }).expect(200);
    await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ competition: ANSWERS.competition })
      .expect(200);
    // Admin's discovery answer, then the Founder's own. Both recorded.
    await setPath(draftId, 'pre_build').expect(200);
    await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ selectedType: 'pre_launch' })
      .expect(200);

    const rows = await h.db
      .select()
      .from(draftFieldEdits)
      .where(eq(draftFieldEdits.draftId, draftId));

    const problemEdits = rows.filter((r) => r.field === 'problem_text');
    expect(problemEdits.length).toBeGreaterThanOrEqual(2);
    expect(problemEdits.some((r) => r.supplier === 'proovd')).toBe(true);
    expect(problemEdits.some((r) => r.supplier === 'founder' && r.newValue === 'Their draft.')).toBe(
      true,
    );

    // Positioning earns a history row like every other answer, and its supplier
    // is `founder` because the trigger hard-codes it rather than reading a
    // column somebody could set (§9, §33.1.5).
    const positioning = rows.filter((r) => r.field === 'competition_text');
    expect(
      positioning.some((r) => r.supplier === 'founder' && r.newValue === ANSWERS.competition),
    ).toBe(true);

    // The campaign path has two suppliers again (0052). A history row claiming
    // Proovd chose what the Founder chose would be a provenance record that is
    // simply untrue, so the supplier is derived from the ACTOR — and the actor
    // for anything a draft-token holder does is `draft:<id>`.
    const pathEdits = rows.filter((r) => r.field === 'selected_type');
    expect(pathEdits.some((r) => r.supplier === 'proovd' && r.newValue === 'pre_build')).toBe(true);
    expect(pathEdits.some((r) => r.supplier === 'founder' && r.newValue === 'pre_launch')).toBe(
      true,
    );
  });

  it('refuses to submit while an answer is missing, and names which', async () => {
    const invited = await invite('incomplete');
    await request(h.app)
      .patch(`/api/draft/${invited.raw}/vetting`)
      .send({ selectedType: 'pre_build' })
      .expect(200);

    const res = await request(h.app)
      .post(`/api/draft/${invited.raw}/vetting/submit`)
      .send({})
      .expect(422);
    expect(res.body.missing).toEqual(['problem', 'solution', 'competition']);
    // Nothing was locked on the way to refusing.
    const state = await request(h.app).get(`/api/draft/${invited.raw}/vetting`).expect(200);
    expect(state.body.lockedType).toBeNull();
  });

  // DELIBERATELY INVERTED (2026-08-18). It used to assert that the refusal
  // owned the wait — correct while the path was Admin's alone. It is the
  // Founder's step again, so the refusal names the screen they have not
  // answered rather than telling them to wait for us. §27.1 works both ways:
  // an owner is named either way, and naming the wrong one is the failure.
  it('refuses to submit with no campaign path, and names it as the Founder step', async () => {
    const { raw } = await invite('no-path');
    await request(h.app).patch(`/api/draft/${raw}/vetting`).send({ problem: ANSWERS.problem }).expect(200);
    await request(h.app).patch(`/api/draft/${raw}/vetting`).send({ solution: ANSWERS.solution }).expect(200);
    await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ competition: ANSWERS.competition })
      .expect(200);

    const res = await request(h.app).post(`/api/draft/${raw}/vetting/submit`).send({}).expect(422);
    expect(res.body.whatHappened).toMatch(/not chosen a campaign path/i);
    expect(res.body.missing).toEqual(['campaign_path']);

    const state = await request(h.app).get(`/api/draft/${raw}/vetting`).expect(200);
    expect(state.body.submittedAt).toBeNull();
    expect(state.body.lockedType).toBeNull();
  });

  // DELIBERATELY INVERTED (2026-08-18). It IS writable again — §9 step 1.
  it('the campaign path is writable by the Founder, and Admin supplies a pre-selection', async () => {
    const invited = await invite('path-founder');

    // Admin's discovery answer arrives first; the Founder's screen is
    // pre-selected from it.
    await setPath(invited.draftId, 'pre_build').expect(200);
    const preselected = await request(h.app)
      .get(`/api/draft/${invited.raw}/vetting`)
      .expect(200);
    expect(preselected.body.selectedType).toBe('pre_build');

    // And the Founder's own answer supersedes it.
    await request(h.app)
      .patch(`/api/draft/${invited.raw}/vetting`)
      .send({ selectedType: 'pre_launch' })
      .expect(200);

    const state = await request(h.app).get(`/api/draft/${invited.raw}/vetting`).expect(200);
    expect(state.body.selectedType).toBe('pre_launch');
  });

  it('grants no access to anything but this draft', async () => {
    // §33.1.1's guarantee has to survive these routes. A draft token is still
    // not a session and still reaches exactly one record.
    const { raw } = await invite('scoped');
    const other = await invite('scoped-other');

    const mine = await request(h.app).get(`/api/draft/${raw}/vetting`).expect(200);
    expect(mine.body.draftId).not.toBe(other.draftId);

    // No session is created by any of it.
    await request(h.app).get('/api/admin/founders').expect(401);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The Admin campaign path (simplified flow)
   ══════════════════════════════════════════════════════════════════════════ */

describe('Admin’s campaign path stays, and stays changeable until submission', () => {
  it('is set on the draft and rendered read-only to the Founder', async () => {
    const invited = await invite('path-set');
    await setPath(invited.draftId, 'pre_build').expect(200);

    const state = await request(h.app).get(`/api/draft/${invited.raw}/vetting`).expect(200);
    expect(state.body.selectedType).toBe('pre_build');
    expect(state.body.lockedType).toBeNull();
  });

  it('can be changed before submission, and the change is audited', async () => {
    const invited = await invite('path-change');
    await setPath(invited.draftId, 'pre_build').expect(200);
    await setPath(invited.draftId, 'pre_launch').expect(200);

    const state = await request(h.app).get(`/api/draft/${invited.raw}/vetting`).expect(200);
    expect(state.body.selectedType).toBe('pre_launch');

    const events = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, invited.draftId),
          eq(auditEvents.action, 'vetting.campaign_path_set'),
        ),
      );
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a value that is not one of the two paths', async () => {
    const invited = await invite('path-invalid');
    const res = await request(h.app)
      .put(`/api/admin/founders/${invited.draftId}/campaign-path`)
      .set('cookie', admin.cookie)
      .send({ campaignPath: 'crowdfunding' })
      .expect(422);
    expect(res.body.whatHappened).toMatch(/not one of the two campaign paths/i);
  });

  it('refuses after submission — the lock is §9’s, unchanged', async () => {
    const invited = await invite('path-locked');
    await completeVetting(invited, 'pre_build');

    const res = await setPath(invited.draftId, 'pre_launch').expect(422);
    expect(res.body.whatHappened).toMatch(/locked/i);

    const [row] = await h.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, invited.campaignId));
    expect(row!.type).toBe('pre_build');
  });

  it('requires an Admin session', async () => {
    const invited = await invite('path-auth');
    await request(h.app)
      .put(`/api/admin/founders/${invited.draftId}/campaign-path`)
      .send({ campaignPath: 'pre_build' })
      .expect(401);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §33.1.5 — Competition cannot be prefilled
   ══════════════════════════════════════════════════════════════════════════ */

describe('§33.1.5 Competition cannot be prefilled (the guarantees outlive the question)', () => {
  it('has no column to be prefilled into', async () => {
    const columns = await h.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'campaign_vetting' AND column_name LIKE 'competition%'`,
    );
    const names = columns.rows.map((r) => r.column_name).sort();
    // Supplier and the two edit timestamps survive for existing records. No
    // `competition_prefilled_*` of any kind.
    expect(names).toEqual([
      'competition_first_edited_at',
      'competition_last_edited_at',
      'competition_supplier',
      'competition_text',
    ]);
  });

  it('ignores a competition prefill sent to the Admin route', async () => {
    const { draftId, raw } = await invite('no-prefill');

    await request(h.app)
      .put(`/api/admin/founders/${draftId}/vetting-prefill`)
      .set('cookie', admin.cookie)
      .send({
        problem: 'Our draft of the problem.',
        competition: 'Our draft of the competition.',
        competitionText: 'Or this way.',
        competitionPrefilledText: 'Or this way.',
      })
      .expect(200);

    await request(h.app).get(`/api/draft/${raw}/vetting`).expect(200);
    const [row] = await h.db
      .select()
      .from(campaignVetting)
      .where(eq(campaignVetting.draftId, draftId));
    expect(row!.competitionText).toBeNull();
    expect(row!.competitionSupplier).toBeNull();
  });

  // DELIBERATELY INVERTED (2026-08-18). It IS collected again — §9 step 4 —
  // and the point of §33.1.5 is that the never-prefill guarantee holds while
  // the question is being asked, which is when it matters.
  it('the Founder route accepts a competition answer, always as the Founder’s', async () => {
    const { draftId, raw } = await invite('founder-competition');
    await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ competition: 'Two scheduling suites that charge per seat and do not text.' })
      .expect(200);

    const [row] = await h.db
      .select()
      .from(campaignVetting)
      .where(eq(campaignVetting.draftId, draftId));
    expect(row!.competitionText).toBe(
      'Two scheduling suites that charge per seat and do not text.',
    );
    // Never derived from a comparison against a prefill, because there is no
    // prefill to compare against and no column that could hold one.
    expect(row!.competitionSupplier).toBe('founder');
  });

  it('the database refuses to record it as Proovd’s, even by direct statement', async () => {
    const { draftId, raw } = await invite('competition-check');
    await request(h.app).get(`/api/draft/${raw}/vetting`).expect(200);

    await expect(
      h.pool.query(
        `UPDATE campaign_vetting SET competition_supplier = 'proovd' WHERE draft_id = $1`,
        [draftId],
      ),
    ).rejects.toThrow();
  });

  it('no source file offers a competition prefill', () => {
    // Comments are stripped first, for the same reason the §33.1.8 scan strips
    // them: the files that most need to say "there is deliberately no
    // competition prefill here" would otherwise be the ones this fails on,
    // which would push the codebase towards documenting the ban less.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (/\.test\.tsx?$/.test(file)) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      if (/competition[_A-Za-z]*[Pp]refill/i.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §33.1.6 — the possible-creator result renders again, and still gates nothing
   ══════════════════════════════════════════════════════════════════════════ */

describe('§33.1.6 the possible-creator result is a record, not a gate', () => {
  // DELIBERATELY INVERTED (2026-08-18). §10's screen is back, so its read is
  // back with it. What did NOT come back is the GATE — see
  // `the claim opens without any recorded result`, which is unchanged.
  it('the founder-facing result route renders a recorded, positive result', async () => {
    const invited = await invite('signal-route');
    await completeVetting(invited);
    await recordSignal(invited.campaignId, 7).expect(201);

    const res = await request(h.app)
      .get(`/api/draft/${invited.raw}/creator-signal`)
      .expect(200);
    expect(res.body.status).toBe('available');
    expect(res.body.count).toBe(7);
    // §10, §11: the basis is Admin's own justification for the number and never
    // reaches a Founder, and nothing here names a Creator.
    expect(res.body.basis).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/recruited channels/i);
  });

  // §10: "the result must not be zero; a zero result routes to Admin before the
  // Founder proceeds." Zero and unrecorded are therefore the SAME answer, and
  // the comparison is of the whole serialized body — a field that differed
  // between them would tell a Founder a number §10 says they must not see.
  it('renders a zero result and an unrecorded one identically, byte for byte', async () => {
    const zero = await invite('signal-zero');
    await completeVetting(zero);
    await recordSignal(zero.campaignId, 0, 'nothing recruited in this niche yet').expect(201);

    const unrecorded = await invite('signal-none');
    await completeVetting(unrecorded);

    const withZero = await request(h.app)
      .get(`/api/draft/${zero.raw}/creator-signal`)
      .expect(200);
    const withNothing = await request(h.app)
      .get(`/api/draft/${unrecorded.raw}/creator-signal`)
      .expect(200);

    expect(JSON.stringify(withZero.body)).toBe(JSON.stringify(withNothing.body));
    expect(withZero.body.status).toBe('with_admin');
    expect(withZero.body.count).toBeNull();
  });

  it('is not open before the answers are submitted', async () => {
    const invited = await invite('signal-early');
    const res = await request(h.app)
      .get(`/api/draft/${invited.raw}/creator-signal`)
      .expect(409);
    expect(res.body.error).toBe('vetting_not_submitted');
  });

  it('Admin can still record the assessment, and a zero is recordable', async () => {
    const invited = await invite('signal-record');
    await completeVetting(invited);
    await recordSignal(invited.campaignId, 0, 'no channel in this niche has been recruited yet').expect(201);

    const [recorded] = await h.db
      .select()
      .from(possibleCreatorResults)
      .where(eq(possibleCreatorResults.campaignId, invited.campaignId));
    expect(recorded!.count).toBe(0);
  });

  it('refuses a count with no stated basis', async () => {
    const invited = await invite('signal-basis');
    await completeVetting(invited);
    const res = await recordSignal(invited.campaignId, 5, '   ');
    expect(res.status).toBe(422);
    expect(res.body.whatHappened).toMatch(/basis/i);
  });

  it('the claim opens without any recorded result (simplified flow)', async () => {
    await publishClaimPolicies();
    const invited = await invite('signal-no-gate');
    await completeVetting(invited);
    await request(h.app).patch(`/api/draft/${invited.raw}/claim`).send(CLAIM_FIELDS).expect(200);

    // No creator-signal was recorded, and the claim succeeds anyway.
    await request(h.app)
      .post(`/api/draft/${invited.raw}/claim`)
      .send({ password: PASSWORD, acceptedPolicySlugs: [...FOUNDER_CLAIM_POLICY_SLUGS] })
      .expect(201);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §33.1.7 — the type lock, and the wrong-type path
   ══════════════════════════════════════════════════════════════════════════ */

describe('§33.1.7 the campaign type locks at vetting', () => {
  it('locks the type and moves the campaign to vetting_submitted', async () => {
    const invited = await invite('lock');
    const state = await completeVetting(invited, 'pre_build');

    expect(state['lockedType']).toBe('pre_build');
    expect(state['typeLockedAt']).toBeTruthy();
    expect(state['campaignStatus']).toBe('vetting_submitted');

    const history = await h.db
      .select()
      .from(campaignStatusHistory)
      .where(eq(campaignStatusHistory.campaignId, invited.campaignId));
    expect(history.map((r) => r.toStatus)).toContain('vetting_submitted');
  });

  it('makes the answers and the type read-only afterwards', async () => {
    const invited = await invite('locked-readonly');
    await completeVetting(invited, 'pre_launch');

    const res = await request(h.app)
      .patch(`/api/draft/${invited.raw}/vetting`)
      .send({ problem: 'Changed my mind.' })
      .expect(422);
    expect(res.body.whatHappened).toMatch(/already submitted/i);
  });

  it('the database refuses to change a locked type (§9: no migration exists)', async () => {
    const invited = await invite('lock-db');
    await completeVetting(invited, 'pre_build');

    await expect(
      h.pool.query(`UPDATE campaigns SET type = 'pre_launch' WHERE id = $1`, [invited.campaignId]),
    ).rejects.toThrow(/cannot be changed/i);

    await expect(
      h.pool.query(`UPDATE campaigns SET type_locked_at = NULL WHERE id = $1`, [invited.campaignId]),
    ).rejects.toThrow();
  });

  it('submitting twice locks once', async () => {
    const invited = await invite('lock-twice');
    await completeVetting(invited, 'pre_build');
    await request(h.app).post(`/api/draft/${invited.raw}/vetting/submit`).send({}).expect(422);

    const history = await h.db
      .select()
      .from(campaignStatusHistory)
      .where(
        and(
          eq(campaignStatusHistory.campaignId, invited.campaignId),
          eq(campaignStatusHistory.toStatus, 'vetting_submitted'),
        ),
      );
    expect(history).toHaveLength(1);
  });

  it('a wrong type archives and restarts, carrying nothing across', async () => {
    const invited = await invite('wrong-type');
    const { raw, campaignId, draftId, prospectId } = invited;
    await completeVetting(invited, 'pre_build');

    // Something that must NOT be copied: a Creator association and a consent
    // record on the old campaign. §9 and §33.1.7 both name these.
    await h.db.insert(campaignAffiliateAssociations).values({
      campaignId,
      affiliateId: randomUUID(),
      status: 'invited',
      rosterMembership: 'initial_roster',
    });

    const res = await request(h.app)
      .post(`/api/admin/campaigns/${campaignId}/archive-and-restart`)
      .set('cookie', admin.cookie)
      .send({ reason: 'Founder chose Idea but has a live product; wrong path locked.' })
      .expect(201);

    const replacement = res.body.campaignId as string;
    expect(replacement).not.toBe(campaignId);
    expect(res.body.draftId).not.toBe(draftId);

    // The old record is archived, still holding its locked type, still pointing
    // at its history. Nothing was un-locked.
    const [old] = await h.db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(old!.archivedAt).toBeTruthy();
    expect(old!.archivedReason).toMatch(/wrong path/i);
    expect(old!.type).toBe('pre_build');
    expect(old!.replacedByCampaignId).toBe(replacement);

    // The replacement is empty: no type, no answers, no associations.
    const [fresh] = await h.db.select().from(campaigns).where(eq(campaigns.id, replacement));
    expect(fresh!.type).toBeNull();
    expect(fresh!.typeLockedAt).toBeNull();
    expect(fresh!.status).toBe('invited_draft');
    expect(fresh!.replacesCampaignId).toBe(campaignId);

    const [freshVetting] = await h.db
      .select()
      .from(campaignVetting)
      .where(eq(campaignVetting.campaignId, replacement));
    expect(freshVetting!.selectedType).toBeNull();
    expect(freshVetting!.problemText).toBeNull();
    expect(freshVetting!.competitionText).toBeNull();
    expect(freshVetting!.solutionText).toBeNull();
    expect(freshVetting!.viewsRange).toBeNull();

    const copiedAssociations = await h.db
      .select()
      .from(campaignAffiliateAssociations)
      .where(eq(campaignAffiliateAssociations.campaignId, replacement));
    expect(copiedAssociations).toHaveLength(0);

    const copiedSignals = await h.db
      .select()
      .from(possibleCreatorResults)
      .where(eq(possibleCreatorResults.campaignId, replacement));
    expect(copiedSignals).toHaveLength(0);

    // Same person, and the replacement is theirs.
    const [newDraft] = await h.db
      .select()
      .from(campaignDrafts)
      .where(eq(campaignDrafts.id, res.body.draftId));
    expect(newDraft!.prospectId).toBe(prospectId);
    // §28.1: no link in the response. The replacement needs an invitation sent.
    expect(JSON.stringify(res.body)).not.toContain(raw);
  });

  it('archiving is recorded with actor, reason, prior and new value (§25.6)', async () => {
    const invited = await invite('archive-audit');
    await completeVetting(invited, 'pre_launch');
    await request(h.app)
      .post(`/api/admin/campaigns/${invited.campaignId}/archive-and-restart`)
      .set('cookie', admin.cookie)
      .send({ reason: 'Wrong path locked.' })
      .expect(201);

    const [event] = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetId, invited.campaignId),
          eq(auditEvents.action, 'vetting.archived_and_restarted'),
        ),
      );
    expect(event!.actor).toBe(`user:${admin.id}`);
    expect(event!.internalReason).toMatch(/wrong path/i);
    expect((event!.priorValue as { type?: string }).type).toBe('pre_launch');
  });

  it('refuses to archive a campaign with no locked type', async () => {
    const { campaignId } = await invite('archive-unlocked');
    const res = await request(h.app)
      .post(`/api/admin/campaigns/${campaignId}/archive-and-restart`)
      .set('cookie', admin.cookie)
      .send({ reason: 'Trying it early.' })
      .expect(422);
    expect(res.body.whatHappened).toMatch(/no locked type/i);
  });

  it('refuses to archive after the listing fee is paid — the refund rules control', async () => {
    const invited = await invite('archive-paid');
    await completeVetting(invited, 'pre_build');
    await h.db
      .update(campaigns)
      .set({ listingPaidAt: new Date() })
      .where(eq(campaigns.id, invited.campaignId));

    const res = await request(h.app)
      .post(`/api/admin/campaigns/${invited.campaignId}/archive-and-restart`)
      .set('cookie', admin.cookie)
      .send({ reason: 'Wrong path.' })
      .expect(422);
    expect(res.body.whatHappened).toMatch(/cancellation and refund rules/i);
  });

  it('archiving requires a reason and a fresh session', async () => {
    const invited = await invite('archive-guard');
    await completeVetting(invited, 'pre_build');

    await request(h.app)
      .post(`/api/admin/campaigns/${invited.campaignId}/archive-and-restart`)
      .set('cookie', admin.cookie)
      .send({})
      .expect(400);

    await request(h.app)
      .post(`/api/admin/campaigns/${invited.campaignId}/archive-and-restart`)
      .send({ reason: 'no session' })
      .expect(401);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §33.1.8 — no SMS OTP exists
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The tree-wide scan for an SMS or phone-OTP provider lives in
 * `auth-tokens.test.ts` and already walks `backend/src`, `frontend/src`, and
 * `shared/src` — so every file this phase adds is inside it. A second scanner
 * here would be a second list of banned patterns, and the day they disagree the
 * weaker one is the one that passes.
 *
 * What is left for this phase to prove is its own surface: the claim collects a
 * phone number, records it as unverified, and offers nothing that would change
 * that.
 */
describe('§33.1.8 no SMS OTP path exists', () => {
  it('the claim collects a phone number and marks it unverified', async () => {
    await publishClaimPolicies();
    const { raw } = await invite('phone');
    const res = await request(h.app).get(`/api/draft/${raw}/claim`).expect(200);

    expect(res.body.profile.fields.phone.value).toBe('+1 555 0100');
    expect(res.body.profile.phoneVerified).toBe(false);
  });

  it('the claim profile has no column that could record a verified phone', async () => {
    const columns = await h.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'founder_claim_profiles' AND column_name LIKE '%verif%'`,
    );
    expect(columns.rows).toEqual([]);
  });

  it('the account a claim creates has an unverified phone the database pins false', async () => {
    await expect(
      h.pool.query(`UPDATE "user" SET phone_verified = true WHERE 1 = 1`),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §33.1.9 — founder_signup_complete emits exactly once
   ══════════════════════════════════════════════════════════════════════════ */

describe('§33.1.9 the account claim', () => {
  async function readyToClaim(label: string) {
    await publishClaimPolicies();
    const invited = await invite(label);
    await completeVetting(invited);
    // Deliberately no creator-signal recording: the simplified flow goes from
    // submission straight to the claim.
    await request(h.app).patch(`/api/draft/${invited.raw}/claim`).send(CLAIM_FIELDS).expect(200);
    return invited;
  }

  it('creates the account, invalidates the token, and moves the campaign', async () => {
    const { raw, campaignId, draftId, prospectId } = await readyToClaim('claim');

    const res = await request(h.app)
      .post(`/api/draft/${raw}/claim`)
      .send({ password: PASSWORD, acceptedPolicySlugs: [...FOUNDER_CLAIM_POLICY_SLUGS] })
      .expect(201);

    expect(res.body.campaignId).toBe(campaignId);

    const [campaign] = await h.db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(campaign!.status).toBe('account_claimed');

    // §10: "Invalidates the draft token." The same link now renders the
    // unusable-link page, like every other dead token.
    await request(h.app).get(`/api/draft/${raw}/vetting`).expect(TOKEN_REJECTION_STATUS);

    const tokens = await h.db
      .select()
      .from(secureTokens)
      .where(eq(secureTokens.campaignDraftId, draftId));
    expect(tokens.every((t) => t.claimedAt !== null || t.revokedAt !== null)).toBe(true);

    // §10: "Preserves the draft and provenance in the account/campaign record."
    const [vetting] = await h.db
      .select()
      .from(campaignVetting)
      .where(eq(campaignVetting.draftId, draftId));
    expect(vetting!.problemText).toBe(ANSWERS.problem);
    expect(vetting!.competitionText).toBe(ANSWERS.competition);

    // The prospect is now an account — which is also what takes it out of the
    // §25.8 sweep, twice over.
    const [prospect] = await h.db
      .select()
      .from(founderProspects)
      .where(eq(founderProspects.id, prospectId));
    expect(prospect!.claimedUserId).toBeTruthy();
    expect(prospect!.claimedAt).toBeTruthy();

    const [account] = await h.db
      .select()
      .from(userTable)
      .where(eq(userTable.id, prospect!.claimedUserId!));
    expect(account!.role).toBe('founder');
    expect(account!.phoneVerified).toBe(false);
  });

  it('writes a consent citing the published version of each required document', async () => {
    const { raw } = await readyToClaim('claim-consent');
    await request(h.app)
      .post(`/api/draft/${raw}/claim`)
      .send({ password: PASSWORD, acceptedPolicySlugs: [...FOUNDER_CLAIM_POLICY_SLUGS] })
      .expect(201);

    const state = await h.db.select().from(policyConsents);
    const slugs = new Set(state.map((c) => c.slug));
    for (const slug of FOUNDER_CLAIM_POLICY_SLUGS) expect(slugs.has(slug)).toBe(true);
  });

  it('emits founder_signup_complete exactly once, and a retry adds nothing', async () => {
    const { raw, campaignId } = await readyToClaim('claim-once');

    await request(h.app)
      .post(`/api/draft/${raw}/claim`)
      .send({ password: PASSWORD, acceptedPolicySlugs: [...FOUNDER_CLAIM_POLICY_SLUGS] })
      .expect(201);

    // The retry a person makes when the first response is slow.
    const retry = await request(h.app)
      .post(`/api/draft/${raw}/claim`)
      .send({ password: PASSWORD, acceptedPolicySlugs: [...FOUNDER_CLAIM_POLICY_SLUGS] })
      .expect(TOKEN_REJECTION_STATUS);
    expect(retry.status).toBe(TOKEN_REJECTION_STATUS);

    const keys = await h.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, founderSignupCompleteKey(campaignId)));
    expect(keys).toHaveLength(1);

    const events = await h.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.targetId, campaignId), eq(auditEvents.action, FOUNDER_SIGNUP_COMPLETE)),
      );
    expect(events).toHaveLength(1);

    const moves = await h.db
      .select()
      .from(campaignStatusHistory)
      .where(
        and(
          eq(campaignStatusHistory.campaignId, campaignId),
          eq(campaignStatusHistory.toStatus, 'account_claimed'),
        ),
      );
    expect(moves).toHaveLength(1);
  });

  it('two concurrent claims produce one account and one safe failure', async () => {
    const { raw, campaignId } = await readyToClaim('claim-race');

    const body = { password: PASSWORD, acceptedPolicySlugs: [...FOUNDER_CLAIM_POLICY_SLUGS] };
    const [a, b] = await Promise.all([
      request(h.app).post(`/api/draft/${raw}/claim`).send(body),
      request(h.app).post(`/api/draft/${raw}/claim`).send(body),
    ]);

    const created = [a, b].filter((r) => r.status === 201);
    expect(created).toHaveLength(1);

    const keys = await h.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, founderSignupCompleteKey(campaignId)));
    expect(keys).toHaveLength(1);

    const moves = await h.db
      .select()
      .from(campaignStatusHistory)
      .where(
        and(
          eq(campaignStatusHistory.campaignId, campaignId),
          eq(campaignStatusHistory.toStatus, 'account_claimed'),
        ),
      );
    expect(moves).toHaveLength(1);
  });

  it('refuses before vetting is submitted', async () => {
    await publishClaimPolicies();
    const { raw } = await invite('claim-early');
    await request(h.app).patch(`/api/draft/${raw}/claim`).send(CLAIM_FIELDS).expect(200);

    const res = await request(h.app)
      .post(`/api/draft/${raw}/claim`)
      .send({ password: PASSWORD, acceptedPolicySlugs: [...FOUNDER_CLAIM_POLICY_SLUGS] })
      .expect(422);
    expect(res.body.error).toBe('vetting_incomplete');
  });

  it('refuses without all three representations (§28.4)', async () => {
    const { raw } = await readyToClaim('claim-reps');
    await request(h.app)
      .patch(`/api/draft/${raw}/claim`)
      .send({ representationAge18Plus: false })
      .expect(200);

    const res = await request(h.app)
      .post(`/api/draft/${raw}/claim`)
      .send({ password: PASSWORD, acceptedPolicySlugs: [...FOUNDER_CLAIM_POLICY_SLUGS] })
      .expect(422);
    expect(res.body.error).toBe('representations_missing');
  });

  it('refuses when a required agreement was not accepted', async () => {
    const { raw } = await readyToClaim('claim-consents');
    const res = await request(h.app)
      .post(`/api/draft/${raw}/claim`)
      .send({ password: PASSWORD, acceptedPolicySlugs: ['terms'] })
      .expect(422);
    expect(res.body.error).toBe('consent_missing');
    expect(res.body.missing).toContain('privacy');
  });

  it('leaves everything the Founder typed in place when it refuses', async () => {
    const { raw } = await readyToClaim('claim-preserve');
    await request(h.app)
      .post(`/api/draft/${raw}/claim`)
      .send({ acceptedPolicySlugs: [...FOUNDER_CLAIM_POLICY_SLUGS] })
      .expect(422);

    const after = await request(h.app).get(`/api/draft/${raw}/claim`).expect(200);
    expect(after.body.profile.fields.legalName.value).toBe('Rowan Vale');
    expect(after.body.profile.fields.dateOfBirth.value).toBe('1990-04-11');
    expect(after.body.profile.claimedAt).toBeNull();
  });

  it('records provenance for every prefilled account field (§10)', async () => {
    await publishClaimPolicies();
    const { raw } = await invite('claim-provenance');
    const opened = await request(h.app).get(`/api/draft/${raw}/claim`).expect(200);

    expect(opened.body.profile.fields.email.supplier).toBe('proovd');
    expect(opened.body.profile.emailOwnership).toBe('invited_link');

    const changed = await request(h.app)
      .patch(`/api/draft/${raw}/claim`)
      .send({ email: 'different@example.com' })
      .expect(200);

    expect(changed.body.fields.email.supplier).toBe('founder');
    expect(changed.body.fields.email.prefilled).not.toBe('different@example.com');
    expect(changed.body.fields.email.editedAt).toBeTruthy();
    // §5.2: an address the Founder typed is not one the invitation established.
    expect(changed.body.emailOwnership).toBe('self_supplied_unverified');
  });

  it('a claimed draft is exempt from the §25.8 sweep', async () => {
    const { raw, draftId } = await readyToClaim('claim-retention');
    await request(h.app)
      .post(`/api/draft/${raw}/claim`)
      .send({ password: PASSWORD, acceptedPolicySlugs: [...FOUNDER_CLAIM_POLICY_SLUGS] })
      .expect(201);

    const wayLater = new Date(Date.now() + 365 * 86_400_000);
    const swept = await sweepUnclaimedDrafts(h.db, h.tokens, wayLater);
    expect(swept.draftIds).not.toContain(draftId);

    const [vetting] = await h.db
      .select()
      .from(campaignVetting)
      .where(eq(campaignVetting.draftId, draftId));
    expect(vetting!.problemText).toBe(ANSWERS.problem);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §25.8 — the sweep reaches everything the vetting stores
   ══════════════════════════════════════════════════════════════════════════ */

describe('the retention sweep covers the vetting record and the claim profile', () => {
  it('anonymises the answers, the profile, and the edit history together', async () => {
    const { raw, draftId } = await invite('sweep');
    await request(h.app)
      .patch(`/api/draft/${raw}/vetting`)
      .send({ problem: ANSWERS.problem, competition: ANSWERS.competition })
      .expect(200);
    await request(h.app).patch(`/api/draft/${raw}/claim`).send(CLAIM_FIELDS).expect(200);

    const wayLater = new Date(Date.now() + 60 * 86_400_000);
    const swept = await sweepUnclaimedDrafts(h.db, h.tokens, wayLater);
    expect(swept.draftIds).toContain(draftId);

    const [vetting] = await h.db
      .select()
      .from(campaignVetting)
      .where(eq(campaignVetting.draftId, draftId));
    expect(vetting!.problemText).toBeNull();
    expect(vetting!.viewsRange).toBeNull();
    expect(vetting!.anonymisedAt).toBeTruthy();

    const [profile] = await h.db
      .select()
      .from(founderClaimProfiles)
      .where(eq(founderClaimProfiles.draftId, draftId));
    expect(profile!.legalName).toBeNull();
    expect(profile!.dateOfBirth).toBeNull();
    expect(profile!.anonymisedAt).toBeTruthy();

    // The edit history keeps the fact of every edit and none of its text.
    const edits = await h.db
      .select()
      .from(draftFieldEdits)
      .where(eq(draftFieldEdits.draftId, draftId));
    expect(edits.length).toBeGreaterThan(0);
    for (const edit of edits) {
      expect(edit.priorValue).toBeNull();
      expect(edit.newValue).toBeNull();
      expect(edit.field).toBeTruthy();
      expect(edit.editedBy).toBeTruthy();
    }
  });

  it('refuses to write anonymised content back', async () => {
    const { raw, draftId } = await invite('sweep-final');
    await request(h.app).patch(`/api/draft/${raw}/vetting`).send({ problem: ANSWERS.problem }).expect(200);
    await sweepUnclaimedDrafts(h.db, h.tokens, new Date(Date.now() + 60 * 86_400_000));

    await expect(
      h.pool.query(`UPDATE campaign_vetting SET problem_text = $1 WHERE draft_id = $2`, [
        'restored',
        draftId,
      ]),
    ).rejects.toThrow(/anonymised/i);
  });
});
