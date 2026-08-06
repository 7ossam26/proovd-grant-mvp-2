/**
 * The live-mode readiness gate — Spec §34, §6, §2.1, §2.2, Appendix C
 * (Phase 24).
 *
 * §34 names no §33 test, and that is not an omission: §33's 131 tests are
 * condition 9's subject, and §34 is the gate they feed. The acceptance for
 * this phase is "every §34 condition", which is a claim about eleven facts
 * rather than about behaviour — so what a suite can prove here is narrow and
 * worth being precise about.
 *
 * It proves the GATE, not the conditions:
 *
 *   * that the gate is closed on a fresh system and names why;
 *   * that no code path opens it by inference, and that the two automatic
 *     conditions cannot be signed off at all;
 *   * that with the gate closed no live money operation reaches the provider,
 *     enforced at the one chokepoint every service shares;
 *   * that a gateway method with no recorded disposition stops the process
 *     from starting;
 *   * that an enablement cannot exist without a campaign, two named people,
 *     and a complete rollback plan, and that a second one cannot exist at all;
 *   * that the rollback is one statement and takes effect on the next call.
 *
 * What it cannot prove is whether Stripe approved the architecture, whether
 * the policies are signed, or whether two people know they are on the hook.
 * Those are recorded, and the record is what this suite checks the shape of.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  APPENDIX_C_STATEMENTS,
  APPENDIX_C_STEP_KEYS,
  AUTOMATIC_CONDITION_KEYS,
  BLOCKED_GATEWAY_METHODS,
  GATEWAY_OPERATIONS,
  LIVE_MODE_BLOCKED_MESSAGE,
  LIVE_MODE_CONDITIONS,
  MONEY_ENTRY_POINTS,
  NOT_THE_PILOT_MESSAGE,
  PILOT_PREFLIGHT_CHECKS,
  RECORDABLE_CONDITION_KEYS,
  ROLLBACK_PLAN_FIELDS,
  approvalCopyState,
} from '@proovd/shared';
import { startHarness, type Harness } from './app-harness.js';
import { createMemoryStripeGateway } from '../payments/stripe-client.js';
import {
  fileLiveModeCondition,
  readLiveModeGate,
  type LiveModeEnvironment,
} from '../live-mode/gate.js';
import {
  LiveModeBlockedError,
  assertPartitionCoversGateway,
  checkLiveMoneyPermitted,
  configureLiveMode,
  guardLiveMoneyGateway,
  resetLiveModeConfiguration,
} from '../live-mode/guard.js';
import {
  enablePilotCampaign,
  readAppendixCCoverage,
  readLivePilot,
  recordAppendixCWalkthrough,
  recordPilotPreflight,
  rollBackPilot,
} from '../live-mode/pilot.js';
import * as backendLogic from '../live-mode/logic.js';
import { policyVersions } from '../db/schema/policies.js';
import { campaigns } from '../db/schema/domain.js';

let h: Harness;

/** A live environment with everything §34 condition 5 asks for. */
const LIVE_ENV: LiveModeEnvironment = {
  stripeMode: 'live',
  stripeKeysMatchMode: true,
  platformWebhookSecretPresent: true,
  connectWebhookSecretPresent: true,
  webhookSecretsDiffer: true,
};

const PLAN = {
  triggers: 'Any capture failure rate above the agreed threshold, or any dispute in the first 72 hours.',
  decisionMaker: 'Dana Okonkwo, reachable on the recorded number.',
  mechanism: 'POST /api/admin/live-mode/rollback. One statement; the next money call reads it.',
  inFlightReservations:
    'Saved cards stay saved and uncharged. The close batch is blocked, so nothing captures; §20 cancellation and the §24.8 refund path both stay open.',
  partyCommunication:
    'Backers by the §27.5 campaign notice from Proovd; the Founder by their named Admin; every Creator on the roster by the §27.3 roster update.',
};

const OWNERS = [
  {
    role: 'monitoring' as const,
    name: 'Rae Lindqvist',
    contact: '+1 555 0100',
    acknowledgedBy: 'admin@proovd.co',
  },
  {
    role: 'rollback' as const,
    name: 'Dana Okonkwo',
    contact: '+1 555 0101',
    acknowledgedBy: 'admin@proovd.co',
  },
];

async function seedCampaign(): Promise<string> {
  const [row] = await h.db
    .insert(campaigns)
    .values({ status: 'invited_draft' })
    .returning({ id: campaigns.id });
  return row!.id;
}

/** Files all nine, so the only thing left blocking is what the test is about. */
async function fileEveryRecordableCondition(): Promise<void> {
  for (const key of RECORDABLE_CONDITION_KEYS) {
    const result = await fileLiveModeCondition(h.db, {
      conditionKey: key,
      status: 'satisfied',
      verifiedBy: 'Rae Lindqvist',
      findings: `Checked ${key} against its evidence, line by line.`,
      evidenceReference: `https://evidence.internal/${key}`,
    });
    expect(result).toEqual({ ok: true });
  }
}

async function publishEveryPolicy(): Promise<void> {
  // The 0003 CHECK: a published version has BOTH an effective date and a
  // published_at, and a draft has neither. Half-published is the state the
  // gate exists to catch, so there is no way to fake it here either.
  await h.db
    .update(policyVersions)
    .set({ status: 'published', effectiveDate: '2026-01-01', publishedAt: new Date() });
}

beforeAll(async () => {
  h = await startHarness({}, 'live-mode');
});

afterAll(async () => {
  resetLiveModeConfiguration();
  await h?.stop();
});

/* ── The registers, restated ───────────────────────────────────────────────── */

describe('§34 — the register and its runtime restatement', () => {
  it('names exactly §34\'s eleven, in §34\'s order', () => {
    expect(LIVE_MODE_CONDITIONS).toHaveLength(11);
    expect(LIVE_MODE_CONDITIONS.map((c) => c.ordinal)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it('does not drift from the backend restatement', () => {
    // The `rootDir` constraint: the backend cannot import @proovd/shared at
    // runtime, so the facts live twice and this is what keeps them one truth.
    const shared = Object.fromEntries(
      LIVE_MODE_CONDITIONS.map((c) => [c.key, c.verification]),
    );
    expect(backendLogic.CONDITION_VERIFICATION).toEqual(shared);

    expect(backendLogic.GATEWAY_DISPOSITION).toEqual(
      Object.fromEntries(GATEWAY_OPERATIONS.map((o) => [o.method, o.disposition])),
    );
    expect([...backendLogic.PILOT_PREFLIGHT_KEYS].sort()).toEqual(
      PILOT_PREFLIGHT_CHECKS.map((c) => c.key).sort(),
    );
    expect([...backendLogic.APPENDIX_C_ACTORS].sort()).toEqual(
      APPENDIX_C_STATEMENTS.map((s) => s.actor).sort(),
    );
    expect(backendLogic.LIVE_MODE_BLOCKED_MESSAGE).toBe(LIVE_MODE_BLOCKED_MESSAGE);
    expect(backendLogic.NOT_THE_PILOT_MESSAGE).toBe(NOT_THE_PILOT_MESSAGE);
  });

  it('records why every non-automatic condition needs a filed answer', () => {
    // The first trap — a condition satisfied by inference — starts with
    // somebody deciding a heuristic is close enough. Writing the reason down
    // is what makes that a visible edit rather than a quiet one.
    for (const condition of LIVE_MODE_CONDITIONS) {
      if (condition.verification === 'automatic') {
        expect(condition.cannotBeAutomatedBecause).toBeUndefined();
      } else {
        expect(condition.cannotBeAutomatedBecause?.trim()).toBeTruthy();
      }
      if (condition.verification === 'suite') {
        expect(condition.provedBy?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('names the Track A item behind every condition the code cannot close', () => {
    // Eight of the eleven wait on work that is not a coding task. That is why
    // the gate being shut is an honest state rather than a bug list.
    const waiting = LIVE_MODE_CONDITIONS.filter((c) => c.trackAItem !== null);
    expect(waiting.length).toBeGreaterThanOrEqual(6);
    for (const c of waiting) expect(c.trackAItem).toMatch(/^A[1-6]$/);
  });
});

/* ── The gateway partition ─────────────────────────────────────────────────── */

describe('§34 — every gateway operation has a decided disposition', () => {
  it('covers every callable member of the real gateway shape', () => {
    const gateway = createMemoryStripeGateway({ mode: 'test' });
    expect(() => assertPartitionCoversGateway(gateway)).not.toThrow();
  });

  it('refuses to construct when a gateway carries an undecided operation', () => {
    // The property that makes this un-forgettable. A phase adding a money
    // method and not deciding its §34 disposition cannot boot the app.
    const gateway = createMemoryStripeGateway({ mode: 'live' });
    (gateway as unknown as Record<string, unknown>).createSomethingExpensive = () =>
      Promise.resolve('done');

    expect(() =>
      guardLiveMoneyGateway(gateway, { db: h.db, environment: LIVE_ENV }),
    ).toThrow(/createSomethingExpensive/);
  });

  it('blocks what §34 blocks and permits what §34 permits — both directions', () => {
    // Asserted both ways so the register cannot rot in either direction.
    const blocked = GATEWAY_OPERATIONS.filter(
      (o) => o.disposition === 'blocked_while_closed',
    ).map((o) => o.method);
    expect(blocked.sort()).toEqual(
      [
        'confirmSetupIntent',
        'createCustomer',
        'createFundingCheckoutSession',
        'createListingCheckoutSession',
        'createOffSessionPaymentIntent',
        'createTransfer',
      ].sort(),
    );

    // A refund and a detach UNWIND exposure; §34's blocked list names neither,
    // and blocking them would strand exactly the people the rollback plan is
    // written for.
    const permitted = GATEWAY_OPERATIONS.filter(
      (o) => o.disposition === 'permitted_while_closed',
    ).map((o) => o.method);
    expect(permitted).toContain('createRefund');
    expect(permitted).toContain('detachPaymentMethod');

    for (const operation of GATEWAY_OPERATIONS) {
      expect(operation.because.trim()).toBeTruthy();
    }
  });
});

/* ── Fail closed ───────────────────────────────────────────────────────────── */

describe('§34 — the gate is closed and says why', () => {
  it('blocks on every condition nobody has answered', async () => {
    const gate = await readLiveModeGate(h.db, LIVE_ENV);
    expect(gate.open).toBe(false);

    // Ten of the eleven. `key_separation` is the one condition a correctly
    // configured process genuinely satisfies on its own, and this environment
    // is one — which is the point of it being `automatic`: it is answered from
    // the environment rather than from anybody's signature.
    expect(gate.blockingKeys).toHaveLength(10);
    expect(gate.blockingKeys).not.toContain('key_separation');

    // §27.1: a blocked state that does not say what is blocking it is a state
    // nobody can act on.
    for (const condition of gate.conditions) {
      expect(condition.detail.trim()).toBeTruthy();
    }
  });

  it('reads condition 4 from the policy records rather than from a signature', async () => {
    const gate = await readLiveModeGate(h.db, LIVE_ENV);
    const policies = gate.conditions.find((c) => c.key === 'policies_published')!;
    expect(policies.satisfied).toBe(false);
    // Every document is a draft today; Track A2 is what closes this.
    expect(policies.detail.toLowerCase()).toContain('draft');
  });

  it('names the specific separation failure rather than a generic one', async () => {
    const shared = await readLiveModeGate(h.db, {
      ...LIVE_ENV,
      stripeKeysMatchMode: false,
      webhookSecretsDiffer: false,
    });
    const separation = shared.conditions.find((c) => c.key === 'key_separation')!;
    expect(separation.satisfied).toBe(false);
    expect(separation.detail).toContain('same signing secret');
    // Naming one problem twice reads as two problems.
    expect(separation.detail).not.toContain('matching prefix');
  });

  it('closes when it cannot read itself', async () => {
    // A gate that cannot read its own conditions does not know whether they
    // hold, and not knowing is a `no`. Nothing here returns the last known
    // state or logs and continues.
    const broken = {
      select: () => {
        throw new Error('connection reset');
      },
    } as never;
    const gate = await readLiveModeGate(broken, LIVE_ENV);
    expect(gate.open).toBe(false);
    expect(gate.blockingKeys).toHaveLength(11);
    expect(gate.conditions[0]!.detail).toContain('connection reset');
  });
});

/* ── Nothing satisfied by inference ────────────────────────────────────────── */

describe('§34 — no condition can be satisfied by inference', () => {
  it('refuses to file an answer for a condition the app re-decides', async () => {
    for (const key of AUTOMATIC_CONDITION_KEYS) {
      const result = await fileLiveModeCondition(h.db, {
        conditionKey: key,
        status: 'satisfied',
        verifiedBy: 'Rae Lindqvist',
        findings: 'Looks fine.',
        evidenceReference: 'https://evidence.internal/x',
      });
      expect(result).toEqual({
        ok: false,
        message: expect.stringContaining('re-decided on every read'),
      });
    }
  });

  it('has no row shape for one either', async () => {
    // The service refuses first; the CHECK refuses regardless, so a
    // hand-written INSERT from a support script gets the same answer.
    await expect(
      h.db.execute(sql`
        insert into live_mode_condition_verifications
          (condition_key, status, verified_by, findings, evidence_reference)
        values ('policies_published', 'satisfied', 'someone', 'fine', 'ref')
      `),
    ).rejects.toThrow();
  });

  it('refuses a satisfied answer with no evidence, and a blank finding', async () => {
    const noEvidence = await fileLiveModeCondition(h.db, {
      conditionKey: 'tax_configuration',
      status: 'satisfied',
      verifiedBy: 'Rae Lindqvist',
      findings: 'Registrations confirmed.',
    });
    expect(noEvidence).toEqual({
      ok: false,
      message: expect.stringContaining('recorded evidence'),
    });

    const noFindings = await fileLiveModeCondition(h.db, {
      conditionKey: 'tax_configuration',
      status: 'satisfied',
      verifiedBy: 'Rae Lindqvist',
      findings: '   ',
      evidenceReference: 'https://evidence.internal/tax',
    });
    expect(noFindings).toEqual({
      ok: false,
      message: expect.stringContaining('not a finding'),
    });
  });

  it('records a not_satisfied answer without demanding evidence', async () => {
    // Recording that something is NOT done is not a claim, so it needs none.
    const result = await fileLiveModeCondition(h.db, {
      conditionKey: 'payment_architecture',
      status: 'not_satisfied',
      verifiedBy: 'Rae Lindqvist',
      findings: 'Stripe underwriting is still open — Track A1.',
    });
    expect(result).toEqual({ ok: true });
  });
});

/* ── Layer one: no live money through a closed gate ────────────────────────── */

describe('§34 — layer one: the gateway refuses while the gate is closed', () => {
  it('leaves the test-mode gateway untouched', () => {
    // §34's own first list permits test-mode engineering, and it has to:
    // every condition is verified by a product that runs.
    const gateway = createMemoryStripeGateway({ mode: 'test' });
    const guarded = guardLiveMoneyGateway(gateway, { db: h.db, environment: LIVE_ENV });
    expect(guarded).toBe(gateway);
  });

  it('throws on every blocked operation in live mode', async () => {
    const gateway = createMemoryStripeGateway({ mode: 'live' });
    const guarded = guardLiveMoneyGateway(gateway, { db: h.db, environment: LIVE_ENV });

    for (const method of BLOCKED_GATEWAY_METHODS) {
      const call = (guarded as unknown as Record<string, (a: unknown) => Promise<unknown>>)[
        method
      ]!;
      await expect(call.call(guarded, {})).rejects.toBeInstanceOf(LiveModeBlockedError);
    }
  });

  it('throws rather than returning a normalized failure', async () => {
    // The one place this codebase reaches for an exception, deliberately. A
    // returned failure would look to the close batch like a DECLINE — which
    // enters the retry window, tells a Backer their card failed, and starts a
    // 48-hour clock over a charge nobody ever attempted.
    const gateway = createMemoryStripeGateway({ mode: 'live' });
    const guarded = guardLiveMoneyGateway(gateway, { db: h.db, environment: LIVE_ENV });

    await expect(
      guarded.createOffSessionPaymentIntent({} as never),
    ).rejects.toThrow(LiveModeBlockedError);
  });

  it('withholds the raw SDK, which is the only way around the decorator', () => {
    const gateway = createMemoryStripeGateway({ mode: 'live' });
    const guarded = guardLiveMoneyGateway(gateway, { db: h.db, environment: LIVE_ENV });
    expect(guarded.client).toBeNull();
  });

  it('and nothing in the tree reads it anyway', () => {
    // Belt to the brace above: a service reaching through `gateway.client`
    // would bypass every refusal in this file.
    const root = path.join(process.cwd(), 'backend', 'src');
    const offenders = walkTs(root).filter((file) => {
      if (file.includes(`${path.sep}tests${path.sep}`)) return false;
      if (file.endsWith('stripe-client.ts')) return false;
      return /\bgateway\.client\b/.test(readFileSync(file, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('lets the unwinding operations through, so a rollback strands nobody', async () => {
    const gateway = createMemoryStripeGateway({ mode: 'live' });
    const guarded = guardLiveMoneyGateway(gateway, { db: h.db, environment: LIVE_ENV });
    // A detach with an unknown method is a no-op at the provider, which is all
    // this needs to show: the call was not refused by the gate.
    await expect(
      guarded.detachPaymentMethod({ paymentMethodId: 'pm_x', connectedAccountId: 'acct_x' }),
    ).resolves.toBeUndefined();
  });
});

/* ── Layer two: one named pilot campaign ───────────────────────────────────── */

describe('§34, §6 — layer two: the pilot scope', () => {
  it('permits everything in test mode', async () => {
    const campaignId = await seedCampaign();
    await expect(checkLiveMoneyPermitted(h.db, 'test', campaignId)).resolves.toEqual({
      permitted: true,
    });
  });

  it('gives three distinct answers, because they are three different facts', async () => {
    configureLiveMode(LIVE_ENV);
    const pilotCampaign = await seedCampaign();
    const otherCampaign = await seedCampaign();

    // 1. The gate is closed.
    const closed = await checkLiveMoneyPermitted(h.db, 'live', pilotCampaign);
    expect(closed).toMatchObject({ permitted: false, code: 'gate_closed' });

    // Open it, honestly: publish the documents and file all nine answers.
    await publishEveryPolicy();
    await fileEveryRecordableCondition();
    const gate = await readLiveModeGate(h.db, LIVE_ENV);
    expect(gate.open).toBe(true);

    // 2. Open, and nothing enabled. Still no money — §6's limit is a positive
    //    act, not the absence of a refusal.
    const noPilot = await checkLiveMoneyPermitted(h.db, 'live', pilotCampaign);
    expect(noPilot).toMatchObject({ permitted: false, code: 'no_pilot_enabled' });

    const enabled = await enablePilotCampaign(h.db, gate, {
      campaignId: pilotCampaign,
      enabledBy: 'Rae Lindqvist',
      owners: OWNERS,
      rollbackPlan: PLAN,
    });
    expect(enabled).toMatchObject({ ok: true });

    // 3. Enabled, for somebody else.
    const notThePilot = await checkLiveMoneyPermitted(h.db, 'live', otherCampaign);
    expect(notThePilot).toMatchObject({ permitted: false, code: 'not_the_pilot' });

    // And the pilot itself.
    await expect(checkLiveMoneyPermitted(h.db, 'live', pilotCampaign)).resolves.toEqual({
      permitted: true,
    });
  });

  it('refuses a second enablement at the database, not in a service', async () => {
    const second = await seedCampaign();
    await expect(
      h.db.execute(sql`
        insert into pilot_campaign_enablements
          (campaign_id, enabled_by, gate_snapshot, rollback_triggers,
           rollback_decision_maker, rollback_mechanism,
           rollback_in_flight_reservations, rollback_party_communication)
        values (${second}, 'someone', 'snapshot', 'a', 'b', 'c', 'd', 'e')
      `),
    ).rejects.toThrow();
  });

  it('rolls back in one statement, and the next call sees it', async () => {
    const pilot = await readLivePilot(h.db);
    expect(pilot).not.toBeNull();

    await expect(
      rollBackPilot(h.db, { rolledBackBy: 'Dana Okonkwo', reason: '   ' }),
    ).resolves.toMatchObject({ ok: false });

    await expect(
      rollBackPilot(h.db, {
        rolledBackBy: 'Dana Okonkwo',
        reason: 'Capture failure rate above the agreed threshold.',
      }),
    ).resolves.toEqual({ ok: true });

    // No deployment, no restart, no cache: the very next money question
    // answers differently.
    const after = await checkLiveMoneyPermitted(h.db, 'live', pilot!.campaignId);
    expect(after).toMatchObject({ permitted: false, code: 'no_pilot_enabled' });
    await expect(readLivePilot(h.db)).resolves.toBeNull();

    // And the slot is free again — re-enabling is a NEW record with its own
    // gate snapshot, never an un-rollback.
    const gate = await readLiveModeGate(h.db, LIVE_ENV);
    const again = await enablePilotCampaign(h.db, gate, {
      campaignId: pilot!.campaignId,
      enabledBy: 'Rae Lindqvist',
      owners: OWNERS,
      rollbackPlan: PLAN,
    });
    expect(again).toMatchObject({ ok: true });
  });

  it('keeps the enablement immutable, so its justification cannot be rewritten', async () => {
    const pilot = await readLivePilot(h.db);
    await expect(
      h.db.execute(sql`
        update pilot_campaign_enablements
        set gate_snapshot = 'everything was fine'
        where id = ${pilot!.enablementId}
      `),
    ).rejects.toThrow();
  });

  it('records the three pre-first-reservation confirmations, and knows it is short', async () => {
    const before = await readLivePilot(h.db);
    expect(before!.preflightComplete).toBe(false);

    for (const check of PILOT_PREFLIGHT_CHECKS) {
      await expect(
        recordPilotPreflight(h.db, {
          checkKey: check.key,
          confirmedBy: 'Rae Lindqvist',
          findings: `Observed: ${check.key}.`,
        }),
      ).resolves.toEqual({ ok: true });
    }

    const after = await readLivePilot(h.db);
    expect(after!.preflightComplete).toBe(true);
  });
});

/* ── Enabling refuses by name ──────────────────────────────────────────────── */

describe('§34 condition 11 — the enablement refuses by name', () => {
  it('refuses a closed gate, a team alias, and an incomplete plan', async () => {
    const campaignId = await seedCampaign();
    const closedGate = {
      open: false,
      blockingKeys: ['payment_architecture'],
      conditions: [],
    };

    const result = await enablePilotCampaign(h.db, closedGate as never, {
      campaignId,
      enabledBy: '',
      owners: [
        { role: 'monitoring', name: 'the payments team', contact: '', acknowledgedBy: '' },
        {
          role: 'rollback',
          name: 'whoever is on call',
          contact: '+1 555 0102',
          acknowledgedBy: 'admin@proovd.co',
        },
      ],
      rollbackPlan: { ...PLAN, inFlightReservations: '' },
    });

    expect(result.ok).toBe(false);
    const violations = (result as { ok: false; violations: string[] }).violations;
    const joined = violations.join('\n');

    expect(joined).toContain('gate is closed');
    // §34's trap, twice: a team alias and "whoever's on call" are both refused.
    expect(joined).toContain('reads as a team or a rota');
    expect(joined).toMatch(/whoever is on call/);
    expect(joined).toContain('reachable');
    expect(joined).toContain('knows they hold it');
    expect(joined).toContain('what happens to reservations already saved');
    expect(joined).toContain('No named person is enabling this');
  });

  it('asks for all five rollback-plan facts and every one carries a requirement', () => {
    expect(ROLLBACK_PLAN_FIELDS).toHaveLength(5);
    for (const field of ROLLBACK_PLAN_FIELDS) {
      expect(field.requirement.trim()).toBeTruthy();
    }
    // The one that is usually missing. A plan that leaves in-flight
    // reservations undefined is not a plan.
    expect(ROLLBACK_PLAN_FIELDS.map((f) => f.key)).toContain('inFlightReservations');
  });
});

/* ── Appendix C ────────────────────────────────────────────────────────────── */

describe('Appendix C — the recorded walks', () => {
  it('covers all four actors with their constraint stated', () => {
    expect(APPENDIX_C_STATEMENTS.map((s) => s.actor)).toEqual([
      'admin',
      'founder',
      'creator',
      'backer',
    ]);
    for (const statement of APPENDIX_C_STATEMENTS) {
      expect(statement.constraint.trim()).toBeTruthy();
      expect(statement.steps.length).toBeGreaterThan(0);
      for (const step of statement.steps) expect(step.surface.trim()).toBeTruthy();
    }
  });

  it('refuses a pass that needed undocumented knowledge', async () => {
    // Appendix C's condition is "without undocumented operator knowledge", so
    // a walk that only succeeded because the walker knew a trick is a failed
    // walk with a passing feeling. Refused in the service…
    const service = await recordAppendixCWalkthrough(h.db, {
      actor: 'founder',
      stepKey: 'build',
      result: 'passed',
      walkedBy: 'Rae Lindqvist',
      findings: 'Got through the build.',
      undocumentedKnowledgeRequired: 'You have to know the roster must be saved first.',
    });
    expect(service).toMatchObject({ ok: false });

    // …and unrepresentable in the database.
    await expect(
      h.db.execute(sql`
        insert into appendix_c_walkthroughs
          (actor, step_key, result, walked_by, findings, undocumented_knowledge_required)
        values ('founder', 'build', 'passed', 'someone', 'fine', 'a trick')
      `),
    ).rejects.toThrow();
  });

  it('separates never-walked from walked-and-failed', async () => {
    // §16a's rule: not yet populated is not zero. "Nobody has tried this" and
    // "somebody tried this and it did not work" are different facts.
    await recordAppendixCWalkthrough(h.db, {
      actor: 'backer',
      stepKey: 'cancel',
      result: 'passed',
      walkedBy: 'Rae Lindqvist',
      findings: 'Cancelled from the magic link; the card detached and the notice arrived.',
    });

    const coverage = await readAppendixCCoverage(h.db, APPENDIX_C_STEP_KEYS);
    expect(coverage.passed).toContain('backer:cancel');
    expect(coverage.unwalked.length).toBeGreaterThan(0);
    expect(
      coverage.passed.length + coverage.failed.length + coverage.unwalked.length,
    ).toBe(APPENDIX_C_STEP_KEYS.length);
  });
});

/* ── The money entry-point register ────────────────────────────────────────── */

describe('§34 — every gated money entry point actually calls the guard', () => {
  it('and every ungated one records why', () => {
    // The register is otherwise a claim nobody can test. Both directions:
    // a `gated` entry whose guard is removed fails, and an `unwind` entry that
    // quietly gains one fails too.
    const root = path.join(process.cwd(), 'backend', 'src');

    for (const entry of MONEY_ENTRY_POINTS) {
      const source = readFileSync(path.join(root, entry.module), 'utf8');
      const stripped = stripComments(source);
      const calls = stripped.includes('checkLiveMoneyPermitted(');

      if (entry.scope === 'gated') {
        expect(calls, `${entry.key} (${entry.module}) is registered as gated`).toBe(true);
        expect(stripped).toContain(`function ${entry.service}`);
      } else {
        expect(entry.ungatedBecause?.trim(), `${entry.key} must record why`).toBeTruthy();
      }
    }
  });

  it('gates every entry point that creates exposure', () => {
    const gated = MONEY_ENTRY_POINTS.filter((e) => e.scope === 'gated').map((e) => e.key);
    expect(gated).toEqual(
      expect.arrayContaining([
        'preorder_create',
        'listing_checkout',
        'creator_payment_funding',
        'close_batch',
        'capture_retry',
        'affiliate_transfer',
        // No gateway leg at all, and gated anyway: §34's blocked list ends
        // with "any payout promise", and creating the payment IS that promise.
        'founder_payment_create',
        'founder_payment_release',
      ]),
    );
  });
});

/* ── §2.1, both directions ─────────────────────────────────────────────────── */

describe('§2.1 — the approval copy, in both directions', () => {
  it('keeps the conditional wording correct while approval does not exist', () => {
    expect(approvalCopyState(false)).toBe('conditional_copy_is_correct');
    expect(approvalCopyState(true)).toBe('conditional_copy_is_now_stale');
  });

  it('still ships the conditional architecture sentence', () => {
    // §2.1 forbids claiming approval before it exists, and Track A1 is open.
    // Replacing this today would be the first violation; leaving it in place
    // once A1 closes is the second, which is why the state is derived from
    // condition 1 rather than remembered.
    const strip = readFileSync(
      path.join(process.cwd(), 'frontend', 'src', 'features', 'public', 'trust-strip.ts'),
      'utf8',
    );
    expect(strip).toMatch(/approved|configuration/i);
  });
});

/* ── helpers ───────────────────────────────────────────────────────────────── */

function walkTs(dir: string): string[] {
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * 22a's rule, reused: these files explain at length what they refuse to do, and
 * a scan that could not tell an explanation from a call would force the
 * explanations out. The reasoning is the more valuable of the two.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
