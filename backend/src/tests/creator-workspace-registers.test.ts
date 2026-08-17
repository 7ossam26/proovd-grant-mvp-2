/**
 * The Creator-workspace vocabulary, across the package boundary.
 *
 * The backend cannot import `@proovd/shared` at runtime — it compiles under
 * `rootDir: src` and ships only `backend/dist` — so
 * `affiliates/workspace/labels.ts` restates the registers and this file proves
 * the two copies agree. Exactly the arrangement the state enums, the §6
 * settings, and the §27 notification keys already use.
 *
 * A test suite CAN import both, which is the whole point: a drift test is the
 * only place the boundary is crossed, and it is crossed to prove nothing else
 * needs to.
 *
 * The pure derivations are exercised here too, in isolation from a database —
 * a derivation that is right in isolation can still be reached by a route that
 * never calls it, which is what `creator-workspace.test.ts` proves separately.
 */

import { describe, it, expect } from 'vitest';
import {
  ADMIN_ASSOCIATION_STATUS_LABELS as SHARED_ASSOCIATION_LABELS,
  ADD_AFFILIATE_STEPS,
  CREATOR_ACCESS_ACTIONS as SHARED_ACCESS_ACTIONS,
  CREATOR_ACCOUNT_STATES as SHARED_ACCOUNT_STATES,
  CREATOR_ATTENTION_KINDS as SHARED_ATTENTION,
  CREATOR_DIRECTORY_FILTER_KEYS as SHARED_FILTERS,
  CREATOR_HISTORY_CATEGORY_KEYS as SHARED_HISTORY,
  CREATOR_PARKED_MESSAGES,
  PAYOUT_STATE_LABELS as SHARED_PAYOUT_LABELS,
  PROVENANCE_BADGES,
  SUBTYPE_METRIC_LABELS as SHARED_METRIC_LABELS,
  VERIFICATION_STATE_LABELS as SHARED_VERIFICATION_LABELS,
  ASSOCIATION_STATUSES,
  AFFILIATE_SUBTYPES,
  ACTIVE_PARTNERSHIP_SLOT_LIMIT as SHARED_SLOT_LIMIT,
  SLOT_OCCUPYING_STATUSES as SHARED_SLOT_STATUSES,
  VERIFICATION_STATUSES as SHARED_VERIFICATION_STATUSES,
} from '@proovd/shared';

import {
  ACTIVE_PARTNERSHIP_SLOT_LIMIT,
  ADMIN_ASSOCIATION_STATUS_LABELS,
  ADMIN_WORK_ATTENTION_KEYS,
  CREATOR_ACCESS_ACTIONS,
  CREATOR_ACCOUNT_STATES,
  CREATOR_ATTENTION_KINDS,
  CREATOR_DIRECTORY_FILTER_KEYS,
  CREATOR_HISTORY_CATEGORY_KEYS,
  PAYOUT_STATE_LABELS,
  PROVENANCE_KEYS,
  SLOT_OCCUPYING_STATUSES,
  SUBTYPE_METRIC_LABELS,
  VERIFICATION_STATE_LABELS,
  campaignNameOf,
  channelUrlOf,
  deriveCreatorAccountState,
  initialsOf,
  payoutStateLabel,
  platformOf,
  subtypeMetricLabel,
} from '../affiliates/workspace/labels.js';
import { CREATOR_AUDIT_TITLES } from '../affiliates/workspace/audit-actions.js';

/* ── Drift ────────────────────────────────────────────────────────────────── */

describe('the backend restatement matches the shared register', () => {
  it('labels every one of §23.4’s nineteen association states, identically', () => {
    expect(ADMIN_ASSOCIATION_STATUS_LABELS).toEqual({ ...SHARED_ASSOCIATION_LABELS });
    // Total by construction on the shared side; asserted here so a twentieth
    // state cannot arrive with a label on one side and not the other.
    for (const status of ASSOCIATION_STATUSES) {
      expect(ADMIN_ASSOCIATION_STATUS_LABELS[status]).toBeTruthy();
    }
    expect(Object.keys(ADMIN_ASSOCIATION_STATUS_LABELS)).toHaveLength(
      ASSOCIATION_STATUSES.length,
    );
  });

  it('is NOT the Founder-facing roster projection, and must never be', async () => {
    const { FOUNDER_ROSTER_STATUS_LABELS } = await import('@proovd/shared');
    // §14.5's register is lossy on purpose — `readiness_blocked` and `ready`
    // are both "Accepted" there, because §14.5 declines to show a Founder the
    // difference. An Admin who cannot see it cannot do the work.
    expect(FOUNDER_ROSTER_STATUS_LABELS['readiness_blocked']).toBe(
      FOUNDER_ROSTER_STATUS_LABELS['ready'],
    );
    expect(ADMIN_ASSOCIATION_STATUS_LABELS['readiness_blocked']).not.toBe(
      ADMIN_ASSOCIATION_STATUS_LABELS['ready'],
    );
  });

  it('matches on the four verification labels, and covers §8’s four states', () => {
    expect(VERIFICATION_STATE_LABELS).toEqual({ ...SHARED_VERIFICATION_LABELS });
    for (const status of SHARED_VERIFICATION_STATUSES) {
      expect(VERIFICATION_STATE_LABELS[status]).toBeTruthy();
    }
  });

  it('matches on the five §13 payout labels', () => {
    expect(PAYOUT_STATE_LABELS).toEqual({ ...SHARED_PAYOUT_LABELS });
  });

  it('matches on the directory filters, history categories, and account states', () => {
    expect([...CREATOR_DIRECTORY_FILTER_KEYS]).toEqual([...SHARED_FILTERS]);
    expect([...CREATOR_HISTORY_CATEGORY_KEYS]).toEqual([...SHARED_HISTORY]);
    expect([...CREATOR_ACCOUNT_STATES]).toEqual([...SHARED_ACCOUNT_STATES]);
    expect([...CREATOR_ACCESS_ACTIONS]).toEqual([...SHARED_ACCESS_ACTIONS]);
  });

  it('matches on the attention register, key for key and owner for owner', () => {
    expect(CREATOR_ATTENTION_KINDS.map((a) => a.key)).toEqual(
      SHARED_ATTENTION.map((a) => a.key),
    );
    for (const shared of SHARED_ATTENTION) {
      const restated = CREATOR_ATTENTION_KINDS.find((a) => a.key === shared.key)!;
      expect(restated.owner).toBe(shared.owner);
      expect(restated.label).toBe(shared.label);
      // Every entry names the RECORD it is derived from. An attention line with
      // no record behind it is a nudge, and §30 forbids those.
      expect(restated.from).toBe(shared.from);
      expect(restated.from).toMatch(/^[a-z_]+$/);
    }
  });

  it('derives the Admin-work pill from the register rather than listing it twice', () => {
    expect([...ADMIN_WORK_ATTENTION_KEYS]).toEqual(
      CREATOR_ATTENTION_KINDS.filter((a) => a.owner === 'Admin').map((a) => a.key),
    );
  });

  it('matches on the provenance keys and the §5.3 metric labels', () => {
    expect([...PROVENANCE_KEYS]).toEqual(PROVENANCE_BADGES.map((b) => b.key));
    expect(SUBTYPE_METRIC_LABELS).toEqual({ ...SHARED_METRIC_LABELS });
    // One label per §5.3 subtype, so a new subtype cannot fall through to
    // "Engagement rate" — the wrong question for a podcast and a course.
    for (const subtype of AFFILIATE_SUBTYPES) {
      expect(SUBTYPE_METRIC_LABELS[subtype]).toBeTruthy();
    }
  });

  it('matches on §2.2’s cap and the states that occupy a slot', () => {
    expect(ACTIVE_PARTNERSHIP_SLOT_LIMIT).toBe(SHARED_SLOT_LIMIT);
    expect([...SLOT_OCCUPYING_STATUSES]).toEqual([...SHARED_SLOT_STATUSES]);
  });
});

/* ── The registers say what they must ─────────────────────────────────────── */

describe('the register carries what the Spec requires of it', () => {
  it('has no permanent Creator sanction anywhere in the access vocabulary', () => {
    // §22.7's one-strike ban is a FOUNDER record. There is no Creator
    // equivalent in the Spec, so there is no value here that could express one.
    expect([...CREATOR_ACCESS_ACTIONS]).toEqual(['suspend', 'restore']);
    for (const state of CREATOR_ACCOUNT_STATES) {
      expect(state.toLowerCase()).not.toContain('ban');
    }
  });

  it('has no ranked quality tier to import, and never will', async () => {
    const shared = await import('@proovd/shared');
    // §8: the tier is assessment data, never a commission floor. There is
    // nothing exported to sort by, and the column is TEXT with a CHECK.
    expect('QUALITY_TIERS' in shared).toBe(false);
    expect('CREATOR_TIER_LEVELS' in shared).toBe(false);
  });

  it('gives every parked control a sentence that names what is coming, and when', () => {
    // The contract changed with the 2026-08-17 rebuild, on purpose. The brief
    // (docs/phases/admin-affiliate-rebuild.md, decision 1) decided all nine
    // capabilities ARE built, each through the service that already owns its
    // rule — so an entry no longer names a permanent gap, it names the record
    // that exists, the mechanism that will serve it, and the SESSION that
    // ships the surface. §1.4 still governs: a control says what the
    // destination IS, and "coming in Session C" is a checkable claim where
    // "parked" was an open-ended one.
    //
    // Session B closed four (stripeRefresh, evidenceUpload, passwordRecovery,
    // requestCorrection): their controls work, so their entries LEFT the
    // register — the §1.4 failure in reverse is a parked message on a working
    // control. Exactly the five Session C capabilities remain.
    expect(Object.keys(CREATOR_PARKED_MESSAGES).sort()).toEqual([
      'availability',
      'caseIntake',
      'deliverableEvidence',
      'kitVisuals',
      'payoutReminder',
    ]);
    for (const [key, message] of Object.entries(CREATOR_PARKED_MESSAGES)) {
      expect(message.length, key).toBeGreaterThan(40);
      expect(/Session C\b/.test(message), key).toBe(true);
    }
  });

  it('renders eight tabs and twenty-five sections, the reference’s own registers', async () => {
    // The 2026-08-17 rebuild's structural register (Session A). The counts are
    // the walked reference's `Vj`/`Gj` exactly, and the three tabs the
    // Selected-relationship switcher scopes are the three the reference
    // renders it on.
    const { AFFILIATE_RECORD_TABS } = await import('@proovd/shared');
    expect(AFFILIATE_RECORD_TABS).toHaveLength(8);
    const sectionCount = AFFILIATE_RECORD_TABS.reduce(
      (n, tab) => n + tab.sections.length,
      0,
    );
    expect(sectionCount).toBe(25);
    expect(AFFILIATE_RECORD_TABS[0].key).toBe('overview');
    expect(AFFILIATE_RECORD_TABS[0].sections).toHaveLength(0);
    expect(
      AFFILIATE_RECORD_TABS.filter((t) => t.relationshipScoped).map((t) => t.key),
    ).toEqual(['campaigns', 'content', 'performance']);
    // Keys are addresses (DNA §5.12), so they must be unique where they meet.
    const tabKeys = AFFILIATE_RECORD_TABS.map((t) => t.key);
    expect(new Set(tabKeys).size).toBe(tabKeys.length);
    for (const tab of AFFILIATE_RECORD_TABS) {
      const keys = tab.sections.map((s: { key: string }) => s.key);
      expect(new Set(keys).size, tab.key).toBe(keys.length);
    }
  });

  it('records the Opened step as a refusal with its reason, not a gap', async () => {
    // §1.8: the reference draws an invitation `Opened` step; §27 ships no
    // tracking pixel and Phase 23b refused an email-open metric outright. The
    // register carries the refusal so a later session adding a pixel is a
    // visible edit rather than a quiet one.
    const { INVITATION_LIFECYCLE_STEPS } = await import('@proovd/shared');
    expect(INVITATION_LIFECYCLE_STEPS).toHaveLength(9);
    const opened = INVITATION_LIFECYCLE_STEPS.find((s) => s.key === 'opened')!;
    expect(opened.absentBecause).toBeTruthy();
    expect(opened.absentBecause).toContain('tracking pixel');
    for (const step of INVITATION_LIFECYCLE_STEPS) {
      if (step.key !== 'opened') expect(step.absentBecause, step.key).toBeNull();
    }
  });

  it('derives proposal access from §29 and offers tiers only as suggestions', async () => {
    const shared = await import('@proovd/shared');
    // §1.8 item 4: no stored eligibility flag — the badge reads §29's
    // restrict_bidding/demote records, both of which the enforcement register
    // already carries.
    expect(Object.keys(shared.PROPOSAL_ACCESS_LABELS)).toEqual(['standard', 'restricted']);
    expect(shared.PROPOSAL_ACCESS_IS_DERIVED).toContain('§29');
    expect([...shared.AFFILIATE_ENFORCEMENT_ACTIONS]).toContain('restrict_bidding');
    expect([...shared.AFFILIATE_ENFORCEMENT_ACTIONS]).toContain('demote');
    // §1.8 item 3: three suggestions over the free-text column, never an enum.
    expect([...shared.QUALITY_TIER_SUGGESTIONS]).toEqual(['Tier A', 'Tier B', 'Tier C']);
    expect('QUALITY_TIERS' in shared).toBe(false);
  });

  it('accepts what the server can inspect, and no HEIC', async () => {
    // §1.8 item 5: the copy names what `ALLOWED_IMAGE_TYPES` accepts. HEIC is
    // a file browsers cannot render; SVG stays excluded since 09a.
    const { EVIDENCE_PICTURES_ACCEPTED, AFFILIATE_EVIDENCE_CATEGORIES } = await import(
      '@proovd/shared'
    );
    expect(EVIDENCE_PICTURES_ACCEPTED).not.toContain('HEIC');
    expect(EVIDENCE_PICTURES_ACCEPTED).toContain('PNG');
    // The four file categories are the 0048 CHECK, one for one.
    expect(AFFILIATE_EVIDENCE_CATEGORIES.map((c) => c.key)).toEqual([
      'channel_permission',
      'sponsored_history',
      'promotion_plan',
      'similar_campaign_performance',
    ]);
  });

  it('names four steps in the Add Affiliate flow, each a question', () => {
    expect(ADD_AFFILIATE_STEPS).toHaveLength(4);
    for (const step of ADD_AFFILIATE_STEPS) {
      expect(step.title.endsWith('?')).toBe(true);
    }
  });

  it('restates the Session B registers where the backend needs them at runtime', async () => {
    // The categories are the 0048 file CHECK, the metrics the 0048
    // verification CHECK, and the correction fields the columns the
    // account-correction route may write — restated in labels.ts (the rootDir
    // constraint) and drift-tested here like every other vocabulary.
    const shared = await import('@proovd/shared');
    const labels = await import('../affiliates/workspace/labels.js');
    expect(labels.AFFILIATE_EVIDENCE_CATEGORIES).toEqual(
      shared.AFFILIATE_EVIDENCE_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
    );
    expect(labels.AFFILIATE_EVIDENCE_METRICS).toEqual(
      shared.AFFILIATE_EVIDENCE_METRICS.map((m) => ({ key: m.key, label: m.label })),
    );
    expect(labels.AFFILIATE_ACCOUNT_CORRECTION_FIELDS).toEqual(
      shared.AFFILIATE_ACCOUNT_CORRECTION_FIELDS.map((f) => ({ key: f.key, label: f.label })),
    );
  });

  it('pins the Session B sentences the surfaces render', async () => {
    // Promises about how Proovd behaves are not a renderer's to reword (§7's
    // NO_GUARANTEE_TEXT reasoning). The reacceptance sentence records the
    // §1.8 resolution: §29.8 is audience-wide, and a control on one person's
    // record must say so or be read as narrower.
    const shared = await import('@proovd/shared');
    expect(shared.CORRECTION_APPENDS_NEW_VALUE).toContain('prior value');
    expect(shared.CORRECTION_REQUEST_LEAVES_VALUE).toContain('current value remains');
    expect(shared.PASSWORD_RECOVERY_CONSEQUENCE).toContain('non-enumerating');
    expect(shared.REACCEPTANCE_IS_AUDIENCE_WIDE).toContain('every Affiliate');
  });

  it('maps every audit action the workspace writes to a plain sentence', () => {
    for (const [action, title] of Object.entries(CREATOR_AUDIT_TITLES)) {
      // §3.1: what an Admin reads is never the internal identifier.
      expect(title, action).not.toContain('_');
      expect(title, action).not.toContain('.');
    }
  });
});

/* ── The derivations ──────────────────────────────────────────────────────── */

describe('the pure derivations answer correctly, without a database', () => {
  it('derives account standing in priority order, and stores nothing', () => {
    expect(
      deriveCreatorAccountState({
        claimed: true,
        latestAccessAction: 'suspend',
        policyReacceptanceOpen: true,
      }),
    ).toBe('Access suspended');
    // A suspension outranks everything: it is the fact that decides whether
    // this person may act at all.
    expect(
      deriveCreatorAccountState({
        claimed: false,
        latestAccessAction: 'suspend',
        policyReacceptanceOpen: false,
      }),
    ).toBe('Access suspended');
    // An unclaimed prospect has no policy state to be blocked on.
    expect(
      deriveCreatorAccountState({
        claimed: false,
        latestAccessAction: null,
        policyReacceptanceOpen: true,
      }),
    ).toBe('Not claimed yet');
    expect(
      deriveCreatorAccountState({
        claimed: true,
        latestAccessAction: 'restore',
        policyReacceptanceOpen: false,
      }),
    ).toBe('Eligible');
  });

  it('never renders a blank monogram', () => {
    expect(initialsOf('Maya Johnson', null)).toBe('MJ');
    expect(initialsOf(null, '@rowan.builds')).toBe('RB');
    expect(initialsOf('Prince', null)).toBe('PR');
    // A blank square reads as a broken image, so absence has its own mark.
    expect(initialsOf(null, null)).toBe('··');
    expect(initialsOf('   ', '  ')).toBe('··');
  });

  it('shows the channel reference it was given rather than guessing a brand', () => {
    expect(platformOf('https://www.instagram.com/rowan')).toBe('instagram.com');
    // §8 permits a handle, a newsletter name, or a community reference here, so
    // a non-URL is shown as it was recorded.
    expect(platformOf('The Clinic Letter')).toBe('The Clinic Letter');
    expect(platformOf(null)).toBeNull();
  });

  it('offers a link only when there is genuinely one to open', () => {
    expect(channelUrlOf('https://instagram.com/rowan')).toBe('https://instagram.com/rowan');
    expect(channelUrlOf('The Clinic Letter')).toBeNull();
    // A `javascript:` reference is not a channel, and an Admin surface is the
    // last place to hand one to an anchor.
    expect(channelUrlOf('javascript:alert(1)')).toBeNull();
    expect(channelUrlOf('instagram.com/rowan')).toBeNull();
  });

  it('composes a campaign name the same way the Founder workspace does', () => {
    // `campaigns` has no `name` column: the public title lives on
    // `campaign_build` and only exists once the Founder has written one, so
    // before the build the honest name is the product the invitation was
    // about. The two Admin surfaces must agree, or one campaign has two names.
    expect(campaignNameOf('Waitlist Launch', 'Waitlist')).toBe('Waitlist Launch');
    expect(campaignNameOf(null, 'Waitlist')).toBe('Waitlist');
    expect(campaignNameOf(null, null)).toBe('Untitled campaign');
  });

  it('says an unclaimed account has no payout state, rather than a bad one', () => {
    // §16a: not yet populated is not zero, and it is not a problem either.
    expect(payoutStateLabel(null)).toBe('No payout account yet');
    expect(payoutStateLabel('complete')).toBe('Payout ready');
    expect(payoutStateLabel('requirements_due')).toBe('Stripe needs information');
  });

  it('falls back honestly when a subtype has no recorded metric', () => {
    expect(subtypeMetricLabel('podcast_host')).toBe('Listen / completion rate');
    expect(subtypeMetricLabel(null)).toBe('Audience evidence');
  });
});
