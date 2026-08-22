/**
 * The Admin Founder panel's registers, drift-tested across the package
 * boundary and against migration 0059's CHECK constraints.
 *
 * `shared/src/admin/founder-workflow.ts` is the source of truth for the
 * eleven-stage vocabulary. The backend cannot import it — it compiles under
 * `rootDir: src` and the image ships only `backend/dist`, so a cross-package
 * import does not resolve at runtime — so `founders/panel/workflow.ts` restates
 * it. A restatement nobody compares is a second source of truth with a comment
 * on top; this file is the comparison, and it is the same arrangement the state
 * enums (Phase 01), the §6 settings register (06a), the §27 notification keys
 * and `founder-workspace-registers.test.ts` already use. Test files sit outside
 * the build's rootDir, so they are the one place both packages can be imported
 * at once.
 *
 * The second half reads migration 0059 itself. A register the database does not
 * agree with is one that fails at INSERT rather than at review — the values in
 * a CHECK and the values in a register are two copies of one list, and this is
 * what keeps them honest.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  FOUNDER_WORKFLOW_STAGE_IDS as SHARED_STAGE_IDS,
  FOUNDER_WORKFLOW_LABELS as SHARED_LABELS,
  FOUNDER_WORKFLOW_STATUSES as SHARED_STATUSES,
  FOUNDER_WORKFLOW_EXIT_STATUSES as SHARED_EXIT_STATUSES,
  PREFILL_AFFILIATE_TYPES as SHARED_PREFILL_TYPES,
  APPLICATION_REVIEW_OUTCOMES as SHARED_OUTCOMES,
  AFFILIATE_SUBTYPES,
  CAMPAIGN_STATUSES,
  stageForStatus as sharedStageForStatus,
  workflowStageAvailable as sharedStageAvailable,
} from '@proovd/shared';

import {
  FOUNDER_WORKFLOW_STAGE_IDS,
  FOUNDER_WORKFLOW_LABELS,
  FOUNDER_WORKFLOW_STATUSES,
  FOUNDER_WORKFLOW_EXIT_STATUSES,
  PREFILL_AFFILIATE_TYPES,
  PREFILL_AFFILIATE_TYPE_IDS,
  APPLICATION_REVIEW_OUTCOMES,
  APPLICATION_REVIEW_OUTCOME_IDS,
  stageForStatus,
  workflowStageAvailable,
} from '../founders/panel/workflow.js';

import {
  SETUP_FIELDS,
  SETUP_FIELD_GROUP_LABELS,
  resolveSetupField,
  coerceSetupValue,
  setupFieldByKey,
} from '../founders/panel/setup-fields.js';
import { APPLICATION_FIELDS } from '../founders/panel/application-fields.js';
import { EDITABLE_FIELDS } from '../campaign/editing-logic.js';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '..', 'db', 'migrations', '0059_admin_founder_panel.sql'),
  'utf8',
);

/* ── The cross-package comparison ──────────────────────────────────────────── */

describe('the workflow register does not drift across the package boundary', () => {
  it('restates the eleven stage ids in the same order', () => {
    expect([...FOUNDER_WORKFLOW_STAGE_IDS]).toEqual([...SHARED_STAGE_IDS]);
  });

  it('restates every stage label exactly', () => {
    expect(FOUNDER_WORKFLOW_LABELS).toEqual(SHARED_LABELS);
  });

  it('restates the status mapping for every stage', () => {
    for (const id of SHARED_STAGE_IDS) {
      expect([...FOUNDER_WORKFLOW_STATUSES[id]]).toEqual([...SHARED_STATUSES[id]]);
    }
  });

  it('restates the four exit statuses', () => {
    expect([...FOUNDER_WORKFLOW_EXIT_STATUSES]).toEqual([...SHARED_EXIT_STATUSES]);
  });

  it('restates the nine prefill affiliate types', () => {
    expect(PREFILL_AFFILIATE_TYPES.map((t) => [t.id, t.label])).toEqual(
      SHARED_PREFILL_TYPES.map((t) => [t.id, t.label]),
    );
  });

  it('restates the seven application-review outcomes', () => {
    expect(APPLICATION_REVIEW_OUTCOMES.map((o) => [o.id, o.label])).toEqual(
      SHARED_OUTCOMES.map((o) => [o.id, o.label]),
    );
  });

  it('answers `stageForStatus` identically for every lifecycle status', () => {
    for (const status of CAMPAIGN_STATUSES) {
      expect(stageForStatus(status)).toBe(sharedStageForStatus(status));
    }
    expect(stageForStatus(null)).toBeNull();
    expect(stageForStatus('not_a_status')).toBeNull();
  });

  it('answers `workflowStageAvailable` identically for every pair', () => {
    for (const reached of SHARED_STAGE_IDS) {
      for (const id of SHARED_STAGE_IDS) {
        expect(workflowStageAvailable(id, reached)).toBe(sharedStageAvailable(id, reached));
      }
    }
  });
});

/* ── The two taxonomies are DELIBERATELY different ─────────────────────────── */

describe('the prefill taxonomy is not the §5.3 subtype enum', () => {
  /**
   * The reference splits `newsletter_blog_operator` into Newsletter and Blog
   * and `student_affiliate` into Student affiliate and Network distributor.
   * Reusing the seven-value enum would silently rename two of its options, so
   * the assertion here is that they DIFFER — an accidental convergence would be
   * somebody having "fixed" one of them.
   */
  it('has nine values where §5.3 has seven', () => {
    expect(PREFILL_AFFILIATE_TYPE_IDS).toHaveLength(9);
    expect(AFFILIATE_SUBTYPES).toHaveLength(7);
    expect([...PREFILL_AFFILIATE_TYPE_IDS]).not.toEqual([...AFFILIATE_SUBTYPES]);
  });

  it('splits the two §5.3 values the reference splits', () => {
    expect(PREFILL_AFFILIATE_TYPE_IDS).toContain('newsletter_operator');
    expect(PREFILL_AFFILIATE_TYPE_IDS).toContain('blog_operator');
    expect(PREFILL_AFFILIATE_TYPE_IDS).toContain('student_affiliate');
    expect(PREFILL_AFFILIATE_TYPE_IDS).toContain('network_distributor');
    expect(AFFILIATE_SUBTYPES).toContain('newsletter_blog_operator');
    expect(AFFILIATE_SUBTYPES).not.toContain('network_distributor');
  });
});

/* ── The database agrees with the registers ────────────────────────────────── */

describe('migration 0059 pins exactly what the registers hold', () => {
  it('CHECKs the eleven workflow stages', () => {
    for (const id of FOUNDER_WORKFLOW_STAGE_IDS) {
      expect(migration).toContain(`'${id}'`);
    }
  });

  it('CHECKs the nine prefill affiliate types', () => {
    const block = migration.slice(
      migration.indexOf('campaign_drafts_prefill_affiliate_type_known'),
    );
    for (const id of PREFILL_AFFILIATE_TYPE_IDS) {
      expect(block.slice(0, 600)).toContain(`'${id}'`);
    }
  });

  it('CHECKs the seven application-review outcomes', () => {
    const block = migration.slice(
      migration.indexOf('campaign_application_reviews_outcome_known'),
    );
    for (const id of APPLICATION_REVIEW_OUTCOME_IDS) {
      expect(block.slice(0, 600)).toContain(`'${id}'`);
    }
  });

  it('CHECKs the two materiality values the setup register uses', () => {
    const used = new Set(SETUP_FIELDS.map((f) => f.materiality));
    for (const value of used) {
      expect(migration).toContain(`'${value}'`);
    }
    expect([...used].sort()).toEqual(['material_to_creator_terms', 'non_material']);
  });

  it('keeps the offer in basis points, and the range the register enforces', () => {
    expect(migration).toContain('"offer_basis_points" integer NOT NULL');
    expect(migration).toContain('BETWEEN 10 AND 5000');
  });
});

/* ── The setup register itself ─────────────────────────────────────────────── */

describe('SETUP_FIELDS', () => {
  it('has no duplicate keys', () => {
    const keys = SETUP_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every entry a group with a label', () => {
    for (const field of SETUP_FIELDS) {
      expect(SETUP_FIELD_GROUP_LABELS[field.group]).toBeTruthy();
    }
  });

  it('pairs table and column: both present, or both absent with a reason', () => {
    for (const field of SETUP_FIELDS) {
      if (field.refusal) {
        expect(field.table, field.key).toBeNull();
        expect(field.column, field.key).toBeNull();
        expect(field.refusal.length, field.key).toBeGreaterThan(60);
      } else {
        expect(field.table, field.key).not.toBeNull();
        expect(field.column, field.key).not.toBeNull();
      }
    }
  });

  /**
   * §3.1's banned token, scanned across the built bundle by §33.11.3 and caught
   * three times before. The reference names two rows "Founder order goal" and
   * "Separate from goal"; this register names the thing they hold.
   */
  it('never spells the banned threshold word, in a key or a label', () => {
    const banned = /\bgoal\b/i;
    for (const field of SETUP_FIELDS) {
      expect(banned.test(field.key), field.key).toBe(false);
      expect(banned.test(field.label), field.key).toBe(false);
      expect(banned.test(field.refusal ?? ''), field.key).toBe(false);
    }
    for (const label of Object.values(SETUP_FIELD_GROUP_LABELS)) {
      expect(banned.test(label), label).toBe(false);
    }
  });

  /**
   * §33.8.13 and §26.2. A control that wrote one of these would be a second
   * answer waiting to disagree with the resolver, or a claim about a provider
   * that the provider never made.
   */
  it('refuses every derived aggregate and every auto-populated Stripe field', () => {
    for (const key of [
      'live.backers',
      'live.reserved_cents',
      'live.clicks',
      'live.posts',
      'campaign.stripe_account',
      'campaign.stripe_status',
      'listing_fee.subtotal_cents',
      'listing_fee.tax_cents',
      'campaign.type',
      'campaign.campaign_live_at',
      'campaign.campaign_close_at',
      'build.order_threshold',
      'association.base_percent',
      'association.fixed_payment_cents',
    ]) {
      const field = setupFieldByKey(key);
      expect(field, key).not.toBeNull();
      expect(field!.refusal, key).toBeTruthy();
      expect(field!.table, key).toBeNull();
    }
  });

  /** Every §20 reference in the register points at a real §20 entry. */
  it('names only live-editing fields that exist in the §20 register', () => {
    const known = new Set(EDITABLE_FIELDS.map((f) => `${f.surface}:${f.field}`));
    for (const field of SETUP_FIELDS) {
      if (!field.liveSurface || !field.liveField) continue;
      expect(known.has(`${field.liveSurface}:${field.liveField}`), field.key).toBe(true);
    }
  });

  it('resolves a row-scoped key by its middle segment, and refuses a bare one', () => {
    const rowId = '11111111-2222-3333-4444-555555555555';
    const resolved = resolveSetupField(`faq.${rowId}.answer`);
    expect(resolved?.definition.key).toBe('faq.answer');
    expect(resolved?.rowId).toBe(rowId);

    // A row-scoped field with no row id has nowhere to write.
    expect(resolveSetupField('faq.answer')).toBeNull();
    // A row id on a field that is not row-scoped is a caller guessing.
    expect(resolveSetupField(`build.${rowId}.public_story`)).toBeNull();
    expect(resolveSetupField('build.not_a_field')).toBeNull();
    expect(resolveSetupField('faq.not-a-uuid.answer')).toBeNull();
  });

  it('reads cents as whole cents and refuses a decimal', () => {
    const price = setupFieldByKey('reward.price_cents')!;
    expect(coerceSetupValue(price, '2500')).toEqual({
      ok: true,
      stored: 2500n,
      rendered: '2500',
    });
    expect(coerceSetupValue(price, '25.00').ok).toBe(false);
    expect(coerceSetupValue(price, '0').ok).toBe(false);
    expect(coerceSetupValue(price, '-5').ok).toBe(false);
  });

  it('treats an emptied box as absence, not as a stored blank', () => {
    const story = setupFieldByKey('build.public_story')!;
    expect(coerceSetupValue(story, '')).toEqual({ ok: true, stored: null, rendered: null });
    expect(coerceSetupValue(story, null)).toEqual({ ok: true, stored: null, rendered: null });
  });
});

/* ── The application-field register ────────────────────────────────────────── */

describe('APPLICATION_FIELDS', () => {
  it('has no duplicate keys', () => {
    const keys = APPLICATION_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('carries the reference’s three sections at their stated sizes', () => {
    const count = (group: string) =>
      APPLICATION_FIELDS.filter((f) => f.group === group).length;
    expect(count('founder_and_account')).toBe(9);
    expect(count('campaign_answers')).toBe(6);
    expect(count('optional_items')).toBe(6);
  });

  /**
   * §12 defines FIVE optional items; the reference splits `branding` into two
   * display rows. Both rows must read the ONE `campaign_optional_items` row, or
   * the −$2 listing-fee effect is claimed twice.
   */
  it('points both branding rows at the one §12 item', () => {
    const logos = APPLICATION_FIELDS.find((f) => f.key === 'optional.branding_logos');
    const colors = APPLICATION_FIELDS.find((f) => f.key === 'optional.branding_colors');
    expect(logos?.optionalItemKey).toBe('branding');
    expect(colors?.optionalItemKey).toBe('branding');

    const itemKeys = APPLICATION_FIELDS.filter((f) => f.optionalItemKey).map(
      (f) => f.optionalItemKey,
    );
    expect(new Set(itemKeys).size).toBe(5);
  });
});
