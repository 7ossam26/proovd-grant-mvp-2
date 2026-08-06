/**
 * The §33.12 and §32.5/§32.6 registers, as kernels — Phase 23b.
 *
 * These prove the registers themselves: the counts, the shapes, and the two
 * functions that decide a violation. What the product actually does under
 * replay, a clock, and a stale session is proved against a real database in
 * `backend/src/tests` — a register that agreed with itself and with nothing
 * else would be the failure this whole phase exists to catch.
 */

import { describe, it, expect } from 'vitest';
import {
  ANCHORED_DEADLINES,
  CAMPAIGN_ANCHORS,
  CAMPAIGN_ANCHOR_KEYS,
  FORBIDDEN_ANCHOR_COLUMNS,
  deadlinesAnchoredOn,
  REPLACEMENT_DEADLINE_CONTRACT,
  PAYMENT_FLAG_FACTS,
  PAYMENT_COLUMNS_FORBIDDEN_ON_CAMPAIGNS,
  lifecycleFlagOverlap,
  STATE_AUDIT_TRAILS,
  SENSITIVE_ACTION_PROPERTIES,
  UNSAFE_GUARD_FAILURES,
  IDEMPOTENT_PATHS,
  ADVERSARIAL_CASES,
  IDEMPOTENCY_INVARIANT,
  DIRECT_ARCHITECTURE_CLAIMS,
  BACKUP_MODE_ABSENCE,
} from './system.js';
import {
  REQUIRED_TEST_OUTCOMES,
  REQUIRED_TEST_OUTCOME_KEYS,
  TEST_EVIDENCE_FIELDS,
  PROVIDER_DATA_DISPOSITIONS,
  evidenceEntryViolations,
  evidenceLogViolations,
  type EvidenceEntry,
} from './test-cards.js';

describe('§33.12.1 — the three anchors', () => {
  it('names exactly the three §21 anchors', () => {
    expect(CAMPAIGN_ANCHOR_KEYS).toEqual([
      'listing_paid_at',
      'campaign_live_at',
      'campaign_close_at',
    ]);
    for (const anchor of Object.values(CAMPAIGN_ANCHORS)) {
      expect(anchor.column.startsWith('campaigns.')).toBe(true);
    }
  });

  it('drives at least one deadline from each anchor', () => {
    // The register would otherwise be satisfiable by listing all three anchors
    // and hanging every deadline off one of them, which is precisely the
    // arrangement §33.12.1's word "independently" rules out.
    for (const anchor of CAMPAIGN_ANCHOR_KEYS) {
      expect(deadlinesAnchoredOn(anchor).length, anchor).toBeGreaterThan(0);
    }
  });

  it('gives every deadline exactly one anchor, and never a campaign row timestamp', () => {
    // Scoped to `campaigns` because the invariant names three columns, not a
    // coding style: a support case's `created_at` is its opening instant and is
    // the correct anchor for §29.10's escalation window.
    for (const deadline of ANCHORED_DEADLINES) {
      expect(typeof deadline.anchor, deadline.key).toBe('string');
      for (const forbidden of FORBIDDEN_ANCHOR_COLUMNS) {
        expect(deadline.anchor, `${deadline.key} → ${deadline.anchor}`).not.toBe(forbidden);
      }
    }
  });

  it('names where every computed instant is stored, and where its offset comes from', () => {
    for (const deadline of ANCHORED_DEADLINES) {
      expect(deadline.storedOn.length, deadline.key).toBeGreaterThan(0);
      expect(deadline.offset.length, deadline.key).toBeGreaterThan(0);
      expect(deadline.specRef.startsWith('§'), deadline.key).toBe(true);
    }
  });

  it('has no duplicate keys', () => {
    const keys = ANCHORED_DEADLINES.map((deadline) => deadline.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('§33.12.2 — the replacement deadline', () => {
  it('is three separate claims, all recorded', () => {
    // Exact: a stored instant, not a window recomputed on read.
    expect(REPLACEMENT_DEADLINE_CONTRACT.storedOn).toBe('required_creator_failures.due_at');
    // Calendar-versioned: the version that produced it, stored beside it.
    expect(REPLACEMENT_DEADLINE_CONTRACT.versionStoredOn).toContain('due_calendar_version');
    // Non-resettable: a database guarantee, because a service can forget one.
    expect(REPLACEMENT_DEADLINE_CONTRACT.immutableByTrigger).toBe(true);
    expect(REPLACEMENT_DEADLINE_CONTRACT.onePerCampaign).toBe(true);
  });

  it('appears in the deadline register as an immutable, calendar-derived instant', () => {
    const entry = ANCHORED_DEADLINES.find(
      (deadline) => deadline.key === 'creator_replacement_deadline',
    );
    expect(entry).toBeDefined();
    expect(entry?.offsetSource).toBe('calendar');
    expect(entry?.immutable).toBe(true);
    expect(entry?.anchor).toBe(REPLACEMENT_DEADLINE_CONTRACT.anchor);
  });
});

describe('§33.12.3 — lifecycle and payment flags', () => {
  it('refuses a value that is both a lifecycle state and a payment flag', () => {
    const overlap = lifecycleFlagOverlap(['live', 'listing_fee_paid'], ['listing_fee_paid']);
    expect(overlap).toHaveLength(1);
    expect(overlap[0]).toContain('listing_fee_paid');
  });

  it('permits a lifecycle state that names a money milestone', () => {
    // The rule this register got wrong on its first pass. §23.1's own committed
    // states include `single_payment_released` and `captured_pending_w9`, and a
    // prohibition on "payment words" would have meant renaming five of the
    // Spec's own states to satisfy a register nobody asked for (§1 rule 6).
    // What must not collide is the VALUE, not the vocabulary.
    expect(
      lifecycleFlagOverlap(
        ['captured_pending_w9', 'single_payment_released', 'refunded_no_creator'],
        ['listing_fee_paid', 'results_ready', 'founder_payment_paid'],
      ),
    ).toEqual([]);
  });

  it('names the five facts a payment flag carries and nowhere else may', () => {
    expect(PAYMENT_FLAG_FACTS).toContain('amount_cents');
    expect(PAYMENT_FLAG_FACTS).toContain('actor');
    expect(PAYMENT_FLAG_FACTS).toContain('evidence');
    expect(PAYMENT_FLAG_FACTS).toContain('provider_object_ids');
    for (const fact of PAYMENT_FLAG_FACTS) {
      if (fact === 'set_at' || fact === 'actor') continue;
      expect(PAYMENT_COLUMNS_FORBIDDEN_ON_CAMPAIGNS as readonly string[], fact).toContain(fact);
    }
  });

  it('keeps two append-only trails, neither derived from the other', () => {
    expect(STATE_AUDIT_TRAILS.lifecycle.historyTable).toBe('campaign_status_history');
    expect(STATE_AUDIT_TRAILS.paymentFlags.historyTable).toBe('campaign_payment_flags');
    expect(STATE_AUDIT_TRAILS.lifecycle.appendOnly).toBe(true);
    expect(STATE_AUDIT_TRAILS.paymentFlags.appendOnly).toBe(true);
    expect(STATE_AUDIT_TRAILS.lifecycle.historyTable).not.toBe(
      STATE_AUDIT_TRAILS.paymentFlags.historyTable,
    );
  });
});

describe('§33.12.5 — what makes an action sensitive, and what unsafe looks like', () => {
  it('states sensitivity as properties rather than a route list', () => {
    expect(SENSITIVE_ACTION_PROPERTIES.length).toBeGreaterThanOrEqual(5);
    for (const property of SENSITIVE_ACTION_PROPERTIES) {
      expect(property.definition.length, property.key).toBeGreaterThan(20);
      expect(property.specRef.startsWith('§'), property.key).toBe(true);
    }
  });

  it('names the four ways a guard fails unsafely', () => {
    expect(UNSAFE_GUARD_FAILURES).toContain('warns_and_proceeds');
    expect(UNSAFE_GUARD_FAILURES).toContain('treats_database_error_as_permitted');
    expect(UNSAFE_GUARD_FAILURES).toContain('reveals_which_check_failed');
  });
});

describe('the idempotency register (scope 4)', () => {
  it('covers every path the brief names', () => {
    const keys = IDEMPOTENT_PATHS.map((path) => path.key);
    for (const required of [
      'close_batch',
      'capture_retry',
      'listing_checkout_completion',
      'fixed_payment_funding',
      'affiliate_transfer',
      'reservation_refund',
      'webhook_delivery',
      'notification_send',
      'draft_claim',
      'campaign_launch',
    ]) {
      expect(keys, required).toContain(required);
    }
  });

  it('gives every path at least one mechanism', () => {
    for (const path of IDEMPOTENT_PATHS) {
      expect(path.mechanisms.length, path.key).toBeGreaterThan(0);
    }
  });

  it('gives every money-moving path a provider-side or domain stable key', () => {
    // The mechanism that stops a double charge is a key the provider sees or a
    // row claimed before the call. A conditional update alone re-drives the
    // provider on a retry, which is the crash-midway failure.
    for (const path of IDEMPOTENT_PATHS.filter((entry) => entry.movesMoney)) {
      const mechanisms = path.mechanisms as readonly string[];
      const guarded =
        mechanisms.includes('provider_idempotency_key') ||
        mechanisms.includes('idempotency_keys') ||
        mechanisms.includes('provider_events') ||
        mechanisms.includes('unique_row');
      expect(guarded, path.key).toBe(true);
    }
  });

  it('names three adversarial cases and the one invariant they share', () => {
    expect(ADVERSARIAL_CASES).toEqual(['run_twice', 'deliver_twice', 'crash_midway']);
    expect(IDEMPOTENCY_INVARIANT).toEqual([
      'one domain change',
      'one money movement',
      'one message',
    ]);
  });
});

describe('§32.7 — the direct architecture claims', () => {
  it('carries all five of §32.7’s bullets', () => {
    expect(DIRECT_ARCHITECTURE_CLAIMS).toHaveLength(5);
    const keys = DIRECT_ARCHITECTURE_CLAIMS.map((claim) => claim.key);
    expect(keys).toEqual([
      'account_context',
      'founder_is_mor',
      'amounts_reconcile',
      'failure_enters_retry',
      'one_transfer',
    ]);
  });

  it('separates what is forbidden from what is merely not built', () => {
    // `on_behalf_of` would mean the second charge model exists; the platform
    // fee is permitted by §24.1 "where supported" and simply is not collected.
    // Collapsing the two would make a later phase enabling the fee look like a
    // violation, which is how a real prohibition gets deleted for being noisy.
    expect(BACKUP_MODE_ABSENCE.forbiddenSymbols).toContain('on_behalf_of');
    expect(BACKUP_MODE_ABSENCE.forbiddenSymbols).toContain('transfer_group');
    expect(BACKUP_MODE_ABSENCE.notBuiltButPermitted).toContain('application_fee_amount');
    for (const symbol of BACKUP_MODE_ABSENCE.notBuiltButPermitted) {
      expect(BACKUP_MODE_ABSENCE.forbiddenSymbols as readonly string[]).not.toContain(symbol);
    }
  });
});

describe('§32.5 — the required outcomes', () => {
  it('carries one entry per outcome §32.5 names, with the paired bullets split', () => {
    expect(REQUIRED_TEST_OUTCOMES).toHaveLength(11);
    expect(REQUIRED_TEST_OUTCOME_KEYS).toContain('full_refund');
    expect(REQUIRED_TEST_OUTCOME_KEYS).toContain('partial_refund');
    expect(REQUIRED_TEST_OUTCOME_KEYS).toContain('incorrect_cvc');
    expect(REQUIRED_TEST_OUTCOME_KEYS).toContain('setup_failure');
  });

  it('states a domain result for each, not merely an expected code', () => {
    for (const outcome of REQUIRED_TEST_OUTCOMES) {
      expect(outcome.expectedDomainResult.length, outcome.key).toBeGreaterThan(40);
    }
  });

  it('contains no card number', () => {
    // §32.2: no test cards in production UI, and `shared/` ships in the browser
    // bundle. The scenarios live here; the numbers live in the suite.
    const source = JSON.stringify(REQUIRED_TEST_OUTCOMES);
    expect(source).not.toMatch(/\b4\d{15}\b/);
    expect(source).not.toMatch(/\b\d{13,19}\b/);
  });
});

describe('§32.6 — the evidence log', () => {
  const passing: EvidenceEntry = {
    environment: 'ci',
    stripeMode: 'test',
    connectedAccountIds: ['acct_founder', 'acct_creator'],
    campaignId: 'camp-1',
    reservationId: 'res-1',
    paymentIntentId: 'pi_1',
    webhookEndpoint: 'connect',
    scenario: 'Generic decline',
    result: 'pass',
    providerDataDisposition: 'retained_at_provider',
  };

  it('accepts a complete passing entry', () => {
    expect(evidenceEntryViolations(passing)).toEqual([]);
  });

  it('names each missing §32.6 requirement in the requirement’s own words', () => {
    const violations = evidenceEntryViolations({ ...passing, campaignId: '', webhookEndpoint: '' });
    expect(violations).toContain('missing campaign ID (§32.6)');
    expect(violations).toContain('missing webhook endpoint (§32.6)');
  });

  it('permits a null PaymentIntent for a scenario that never reached a charge', () => {
    // The setup-failure entries are the ones most worth recording, and
    // demanding a PaymentIntent would make them unrecordable.
    expect(
      evidenceEntryViolations({ ...passing, reservationId: null, paymentIntentId: null }),
    ).toEqual([]);
  });

  it('distinguishes "there was none" from "nobody looked"', () => {
    const { paymentIntentId: _omitted, ...withoutTheField } = passing;
    expect(evidenceEntryViolations(withoutTheField)).toContain('missing PaymentIntent ID (§32.6)');
  });

  it('requires a defect, and either a fix and retest or a named blocker, on a failure', () => {
    const failing = { ...passing, result: 'fail' as const };
    const violations = evidenceEntryViolations(failing);
    expect(violations).toContain('a failed scenario records no defect (§32.6)');
    expect(violations.some((v) => v.includes('unresolved approved blocker'))).toBe(true);

    expect(
      evidenceEntryViolations({
        ...failing,
        defect: 'decline code reached the customer body',
        fix: 'read the code from the attempt row only',
        retest: 'rerun 2026-08-06, pass',
      }),
    ).toEqual([]);

    expect(
      evidenceEntryViolations({
        ...failing,
        defect: 'provider returned an unmapped code',
        unresolvedBlocker: 'approved: awaiting provider confirmation of the code',
      }),
    ).toEqual([]);
  });

  it('accepts only §32.6’s three answers about deleted provider data', () => {
    expect(PROVIDER_DATA_DISPOSITIONS).toEqual([
      'retained_at_provider',
      'deleted_internally',
      'marked_invalid_artifact',
    ]);
    const violations = evidenceEntryViolations({
      ...passing,
      providerDataDisposition: 'ignored' as never,
    });
    expect(violations.some((v) => v.includes('three answers'))).toBe(true);
  });

  it('reports an unexercised §32.5 outcome as a log-level failure', () => {
    const violations = evidenceLogViolations([passing]);
    expect(violations.some((v) => v.startsWith('§32.5 outcome not exercised: Dispute'))).toBe(true);
  });

  it('marks which evidence fields are conditional on a failure', () => {
    const conditional = TEST_EVIDENCE_FIELDS.filter((field) => !field.alwaysRequired).map(
      (field) => field.key,
    );
    expect(conditional).toEqual(['defect', 'fix', 'retest', 'unresolvedBlocker']);
  });
});
