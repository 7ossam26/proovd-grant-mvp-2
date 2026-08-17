/**
 * The Founder workspace registers, drift-tested across the package boundary.
 *
 * `shared/src/admin/founder-workspace.ts` is the source of truth for the
 * workspace's vocabulary. The backend cannot import it — it compiles under
 * `rootDir: src` and ships only `backend/dist`, so a cross-package import does
 * not resolve at runtime — so `backend/src/founders/logic.ts` restates it.
 *
 * A restatement nobody compares is a second source of truth with a comment on
 * top. This file is the comparison, and it is the same arrangement the state
 * enums (Phase 01), the §6 settings register (06a), and the §27 notification
 * keys already use. Test files sit outside the build's rootDir, so they are the
 * one place both packages can be imported at once.
 */

import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABELS as SHARED_STATUS_LABELS,
  CAMPAIGN_TYPE_LABELS as SHARED_TYPE_LABELS,
  FOUNDER_ACCOUNT_STATES as SHARED_ACCOUNT_STATES,
  FOUNDER_ACCESS_ACTIONS as SHARED_ACCESS_ACTIONS,
  FOUNDER_SETUP_STAGES as SHARED_SETUP_STAGES,
  INVITATION_STATES as SHARED_INVITATION_STATES,
  PROFILE_OVERRIDE_KEYS as SHARED_OVERRIDE_KEYS,
  FOUNDER_EDITABLE_FIELDS as SHARED_EDITABLE_FIELDS,
  FOUNDER_HISTORY_CATEGORIES as SHARED_HISTORY_CATEGORIES,
  ATTENTION_ACTIONS as SHARED_ATTENTION_ACTIONS,
  FOUNDER_DIRECTORY_FILTERS as SHARED_DIRECTORY_FILTERS,
  FOUNDER_TYPE_FILTERS as SHARED_TYPE_FILTERS,
  FOUNDER_NEXT_STEP_LABELS as SHARED_NEXT_STEP_LABELS,
  MEETING_NOTE_FIELDS as SHARED_MEETING_NOTE_FIELDS,
  RESEARCH_ENTRY_FIELDS as SHARED_RESEARCH_FIELDS,
  PROPOSED_TYPE_LABEL as SHARED_PROPOSED_LABEL,
  WAITING_ON_PROOVD_LABEL as SHARED_WAITING_LABEL,
  NO_ACCESS_YET_LABEL as SHARED_NO_ACCESS_LABEL,
  GHOST_BAN_TRIGGER_SUMMARY as SHARED_GHOST_BAN_SUMMARY,
  CREATOR_MATCH_CAVEAT as SHARED_MATCH_CAVEAT,
  CAMPAIGN_TYPE_LOCK_NOTE as SHARED_TYPE_LOCK_NOTE,
  DELETION_RETENTION_NOTE as SHARED_RETENTION_NOTE,
  IDENTITY_CHECK_HELPER as SHARED_IDENTITY_HELPER,
  SUMMARY_IS_NOT_ADMIN_WRITABLE as SHARED_SUMMARY_RULE,
  REQUIRED_EMAILS_HELPER as SHARED_REQUIRED_EMAILS_HELPER,
  invitationMeaning as sharedInvitationMeaning,
  invitationLinkIsLive as sharedLinkIsLive,
  overrideHelper as sharedOverrideHelper,
  editReasonRequired as sharedEditReasonRequired,
  FOUNDER_RECORD_SECTIONS,
  ONBOARDING_TAB_COPY,
  ELIGIBILITY_READ_ONLY_NOTE,
  CREATE_FOUNDER_CHECKLIST,
  CREATE_FOUNDER_ABSENCES,
} from '@proovd/shared';

import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_TYPE_LABELS,
  FOUNDER_ACCOUNT_STATES,
  FOUNDER_ACCESS_ACTIONS,
  FOUNDER_SETUP_STAGES,
  INVITATION_STATES,
  PROFILE_OVERRIDE_KEYS,
  FOUNDER_EDITABLE_FIELDS,
  FOUNDER_HISTORY_CATEGORIES,
  ATTENTION_ACTIONS,
  FOUNDER_DIRECTORY_FILTERS,
  FOUNDER_TYPE_FILTERS,
  FOUNDER_NEXT_STEP_LABELS,
  MEETING_NOTE_FIELDS,
  RESEARCH_ENTRY_FIELDS,
  PROPOSED_TYPE_LABEL,
  WAITING_ON_PROOVD_LABEL,
  NO_ACCESS_YET_LABEL,
  GHOST_BAN_TRIGGER_SUMMARY,
  CREATOR_MATCH_CAVEAT,
  CAMPAIGN_TYPE_LOCK_NOTE,
  DELETION_RETENTION_NOTE,
  IDENTITY_CHECK_HELPER,
  SUMMARY_IS_NOT_ADMIN_WRITABLE,
  REQUIRED_EMAILS_HELPER,
  invitationMeaning,
  invitationLinkIsLive,
  overrideHelper,
  editReasonRequired,
  deriveAccountState,
  deriveSetupStage,
  deriveInvitationState,
  campaignStatusLabel,
  stickerFor,
} from '../founders/logic.js';

describe('the Founder workspace registers do not drift', () => {
  it('labels every one of §23.1’s lifecycle states, in both packages', () => {
    // Totality is the point: a 28th lifecycle state with no human label would
    // render `banned_founder` to somebody on a support call (§3.1).
    for (const status of CAMPAIGN_STATUSES) {
      expect(SHARED_STATUS_LABELS[status], `shared label for ${status}`).toBeTruthy();
      expect(
        (CAMPAIGN_STATUS_LABELS as Record<string, string | undefined>)[status],
        `backend label for ${status}`,
      ).toBe(SHARED_STATUS_LABELS[status]);
    }
    expect(Object.keys(CAMPAIGN_STATUS_LABELS).sort()).toEqual(
      [...CAMPAIGN_STATUSES].sort(),
    );
  });

  it('renders no internal lifecycle or type name to a person (§3.1)', () => {
    const banned = [
      'pre_build',
      'pre_launch',
      'affiliate',
      'reservation',
      'pledge',
      'donate',
      'escrow',
      'custody',
      'all-or-nothing',
    ];
    for (const [status, label] of Object.entries(CAMPAIGN_STATUS_LABELS)) {
      for (const word of banned) {
        expect(label.toLowerCase(), `${status} label leaks "${word}"`).not.toContain(word);
      }
      // The label must be prose, not the enum with the underscores taken out.
      expect(label).not.toBe(status);
    }
  });

  it('agrees on the §3.1 campaign-type substitutions', () => {
    expect(CAMPAIGN_TYPE_LABELS['pre_build']).toBe(SHARED_TYPE_LABELS.pre_build);
    expect(CAMPAIGN_TYPE_LABELS['pre_launch']).toBe(SHARED_TYPE_LABELS.pre_launch);
    expect(SHARED_TYPE_LABELS.pre_build).toBe('Idea Campaign');
    expect(SHARED_TYPE_LABELS.pre_launch).toBe('Product Campaign');
  });

  it('agrees on every state vocabulary', () => {
    expect([...FOUNDER_ACCOUNT_STATES]).toEqual([...SHARED_ACCOUNT_STATES]);
    expect([...FOUNDER_ACCESS_ACTIONS]).toEqual([...SHARED_ACCESS_ACTIONS]);
    expect([...FOUNDER_SETUP_STAGES]).toEqual([...SHARED_SETUP_STAGES]);
    expect([...INVITATION_STATES]).toEqual([...SHARED_INVITATION_STATES]);
    expect([...PROFILE_OVERRIDE_KEYS]).toEqual([...SHARED_OVERRIDE_KEYS]);
    expect([...ATTENTION_ACTIONS]).toEqual([...SHARED_ATTENTION_ACTIONS]);
  });

  it('agrees on the 2026-08-16 directory registers, entry for entry', () => {
    expect(FOUNDER_DIRECTORY_FILTERS.map((f) => ({ ...f }))).toEqual(
      SHARED_DIRECTORY_FILTERS.map((f) => ({ ...f })),
    );
    expect(FOUNDER_TYPE_FILTERS.map((f) => ({ ...f }))).toEqual(
      SHARED_TYPE_FILTERS.map((f) => ({ ...f })),
    );
    expect(PROPOSED_TYPE_LABEL).toBe(SHARED_PROPOSED_LABEL);
    expect(WAITING_ON_PROOVD_LABEL).toBe(SHARED_WAITING_LABEL);
    expect(NO_ACCESS_YET_LABEL).toBe(SHARED_NO_ACCESS_LABEL);
    expect({ ...FOUNDER_NEXT_STEP_LABELS }).toEqual({ ...SHARED_NEXT_STEP_LABELS });
  });

  it('keeps Proposed out of every type register — it is the absence of a lock (§9)', () => {
    // The filter vocabulary carries it; the type registers must not, because
    // a third member of CAMPAIGN_TYPE_LABELS would mint the third type §9
    // forbids.
    expect(Object.keys(CAMPAIGN_TYPE_LABELS)).toEqual(['pre_build', 'pre_launch']);
    expect(Object.values(CAMPAIGN_TYPE_LABELS)).not.toContain(PROPOSED_TYPE_LABEL);
  });

  it('agrees on the meeting-note and research dialogs, field for field', () => {
    expect(MEETING_NOTE_FIELDS.map((f) => ({ ...f }))).toEqual(
      SHARED_MEETING_NOTE_FIELDS.map((f) => ({ ...f })),
    );
    expect(RESEARCH_ENTRY_FIELDS.map((f) => ({ ...f }))).toEqual(
      SHARED_RESEARCH_FIELDS.map((f) => ({ ...f })),
    );
  });

  it('agrees on the editable-field registry, key for key', () => {
    expect(FOUNDER_EDITABLE_FIELDS.map((f) => f.key)).toEqual(
      SHARED_EDITABLE_FIELDS.map((f) => f.key),
    );
    for (const shared of SHARED_EDITABLE_FIELDS) {
      const local = FOUNDER_EDITABLE_FIELDS.find((f) => f.key === shared.key);
      expect(local, `backend is missing ${shared.key}`).toBeDefined();
      expect(local?.label).toBe(shared.label);
      expect(local?.group).toBe(shared.group);
      expect(local?.helper ?? null).toBe(
        (shared as { helper?: string }).helper ?? null,
      );
    }
  });

  it('has no editable key for the three §9 setup answers', () => {
    // §9 makes Problem, Solution, and Competition the Founder's own words, and
    // Competition may never even be prefilled. The guarantee here is an
    // ABSENCE: with no key, `updateFounderField` has nothing to dispatch on,
    // so no Admin route can write them however it is called.
    const keys = FOUNDER_EDITABLE_FIELDS.map((f) => f.key.toLowerCase());
    for (const forbidden of ['problem', 'solution', 'competition']) {
      expect(keys, `an Admin must not be able to edit ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it('has no editable key for the digest preference (§27.7, §30)', () => {
    // §27.7's frequency exists only because a person chose it. An Admin-writable
    // key here would be a code path that answers for them.
    const keys = FOUNDER_EDITABLE_FIELDS.map((f) => f.key);
    expect(keys).not.toContain('summary');
    expect(SUMMARY_IS_NOT_ADMIN_WRITABLE).toBe(SHARED_SUMMARY_RULE);
  });

  it('agrees on the history categories', () => {
    expect([...FOUNDER_HISTORY_CATEGORIES]).toEqual(
      SHARED_HISTORY_CATEGORIES.filter((c) => c.key !== 'all').map((c) => c.key),
    );
  });

  it('agrees on every pinned sentence', () => {
    expect(GHOST_BAN_TRIGGER_SUMMARY).toBe(SHARED_GHOST_BAN_SUMMARY);
    expect(CREATOR_MATCH_CAVEAT).toBe(SHARED_MATCH_CAVEAT);
    expect(CAMPAIGN_TYPE_LOCK_NOTE).toBe(SHARED_TYPE_LOCK_NOTE);
    expect(DELETION_RETENTION_NOTE).toBe(SHARED_RETENTION_NOTE);
    expect(IDENTITY_CHECK_HELPER).toBe(SHARED_IDENTITY_HELPER);
    expect(REQUIRED_EMAILS_HELPER).toBe(SHARED_REQUIRED_EMAILS_HELPER);
  });

  it('agrees on every derived sentence, for every input', () => {
    for (const state of SHARED_INVITATION_STATES) {
      expect(invitationMeaning(state, 'Ahmed')).toBe(
        sharedInvitationMeaning(state, 'Ahmed'),
      );
      expect(invitationLinkIsLive(state)).toBe(sharedLinkIsLive(state));
    }
    for (const key of SHARED_OVERRIDE_KEYS) {
      for (const overridden of [true, false]) {
        expect(overrideHelper(key, 'Ahmed', overridden, 'Teeb')).toBe(
          sharedOverrideHelper(key, 'Ahmed', overridden, 'Teeb'),
        );
      }
    }
    for (const group of ['profile', 'invitation'] as const) {
      for (const claimed of [true, false]) {
        expect(editReasonRequired(group, claimed)).toBe(
          sharedEditReasonRequired(group, claimed),
        );
      }
    }
  });
});

describe('the derivations the workspace reads instead of storing', () => {
  it('ranks a ban above a suspension above an unclaimed account', () => {
    // §22.7 is permanent and a suspension is a review that ends, so a banned
    // person is never shown as merely suspended. And a person can be banned or
    // suspended before claiming — the invitation is live and worth stopping.
    expect(
      deriveAccountState({ accountClaimed: true, banned: true, latestAccessAction: 'suspend' }),
    ).toBe('Permanently banned');
    expect(
      deriveAccountState({ accountClaimed: false, banned: true, latestAccessAction: null }),
    ).toBe('Permanently banned');
    expect(
      deriveAccountState({ accountClaimed: true, banned: false, latestAccessAction: 'suspend' }),
    ).toBe('Access suspended');
    expect(
      deriveAccountState({ accountClaimed: true, banned: false, latestAccessAction: 'restore' }),
    ).toBe('Active');
    expect(
      deriveAccountState({ accountClaimed: false, banned: false, latestAccessAction: null }),
    ).toBe('Not created yet');
  });

  it('shows a fraction only while the Founder is mid-setup', () => {
    expect(
      deriveSetupStage({ invitationSent: false, answered: 0, total: 4, signupComplete: false }),
    ).toEqual({ stage: 'Not invited', detail: null });
    expect(
      deriveSetupStage({ invitationSent: true, answered: 0, total: 4, signupComplete: false }),
    ).toEqual({ stage: 'Invite sent', detail: null });
    expect(
      deriveSetupStage({ invitationSent: true, answered: 2, total: 4, signupComplete: false }),
    ).toEqual({ stage: 'Getting started', detail: '2 of 4 setup questions completed' });
    // A completed setup says so rather than reporting 4 of 4, which reads as
    // "still counting".
    expect(
      deriveSetupStage({ invitationSent: true, answered: 4, total: 4, signupComplete: true }),
    ).toEqual({ stage: 'Setup complete', detail: null });
  });

  it('distinguishes a resend from a first send, because the copy differs', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const base = { draftStatus: 'sent', openedAt: null, tokenExpiresAt: null, claimedAt: null, now };

    expect(deriveInvitationState({ ...base, sendCount: 1 })).toBe('Invite sent');
    // The second send has to tell the Admin the OLD link stopped working —
    // the single most common support question a resend produces.
    expect(deriveInvitationState({ ...base, sendCount: 2 })).toBe('New invite sent');
    expect(
      deriveInvitationState({ ...base, sendCount: 1, openedAt: new Date('2026-08-09T00:00:00Z') }),
    ).toBe('Invite opened');
    expect(deriveInvitationState({ ...base, sendCount: 0 })).toBe('Not sent');
    expect(
      deriveInvitationState({ ...base, sendCount: 1, claimedAt: new Date('2026-08-09T00:00:00Z') }),
    ).toBe('Invite accepted');
    expect(deriveInvitationState({ ...base, draftStatus: 'revoked', sendCount: 1 })).toBe(
      'Invite canceled',
    );
    expect(
      deriveInvitationState({
        ...base,
        sendCount: 1,
        tokenExpiresAt: new Date('2026-08-01T00:00:00Z'),
      }),
    ).toBe('Invite expired');
  });

  it('lets a claim outrank a revoked draft', () => {
    // Revoking after somebody already claimed does not un-claim them, and
    // showing "Invite canceled" for an active Founder would be a lie the Admin
    // would act on.
    const now = new Date('2026-08-10T12:00:00Z');
    expect(
      deriveInvitationState({
        draftStatus: 'revoked',
        sendCount: 2,
        openedAt: now,
        claimedAt: now,
        tokenExpiresAt: null,
        now,
      }),
    ).toBe('Invite accepted');
  });

  it('gives a person the same sticker every time', () => {
    // A decorative value that moved on each read would make two Admins
    // describing "the one with the green sticker" disagree.
    const id = '2f1c0c8e-9a1d-4f7a-9a1e-2b3c4d5e6f70';
    expect(stickerFor(id)).toBe(stickerFor(id));
    expect(stickerFor(id)).toBeGreaterThanOrEqual(1);
    expect(stickerFor(id)).toBeLessThanOrEqual(14);
  });

  it('falls back to the raw value rather than throwing on an unknown status', () => {
    // A workspace that crashed on an unrecognised lifecycle value would take
    // the whole Founder record down over a label.
    expect(campaignStatusLabel('live')).toBe('Live');
    expect(campaignStatusLabel('something_new')).toBe('something_new');
  });
});

/* ══ Session B (2026-08-17): the Onboarding copy and the compose registers ══ */

describe('the Onboarding tab copy covers exactly the section register’s tabs', () => {
  it('has one question per Onboarding sub-tab, no more and no fewer', () => {
    // Two registers describe the same four tabs — the section shape and the
    // pinned copy — and this is the drift test between them.
    const section = FOUNDER_RECORD_SECTIONS.find((s) => s.key === 'onboarding')!;
    expect(Object.keys(ONBOARDING_TAB_COPY).sort()).toEqual(
      section.tabs.map((t) => t.key).sort(),
    );
    for (const entry of Object.values(ONBOARDING_TAB_COPY)) {
      expect(entry.question.length).toBeGreaterThan(10);
      expect(entry.subtitle.length).toBeGreaterThan(10);
    }
  });

  it('names no dollar amount in the optional-items subtitle', () => {
    // The per-item discount is a §6 setting; a number in pinned copy would be
    // a hardcoded commercial value the settings surface could then contradict.
    expect(ONBOARDING_TAB_COPY.optional.subtitle).not.toMatch(/\$\d/);
  });

  it('pins the Eligibility read-only rule with all five protected facts', () => {
    for (const word of ['age', 'country', 'acceptance state', 'timestamp', 'version']) {
      expect(ELIGIBILITY_READ_ONLY_NOTE).toContain(word);
    }
  });
});

describe('the Create Founder compose registers (Session B)', () => {
  it('carries the reference’s five checklist lines', () => {
    expect(CREATE_FOUNDER_CHECKLIST).toHaveLength(5);
    expect(CREATE_FOUNDER_CHECKLIST[4]).toBe('Exact invitation is ready');
  });

  it('records every refused reference box with a real reason', () => {
    // The register is the contract: a box named here has a recorded §1.8
    // refusal, and re-adding one is a visible edit to this list rather than a
    // quiet reintroduction.
    const boxes = CREATE_FOUNDER_ABSENCES.map((entry) => entry.box);
    expect(new Set(boxes).size).toBe(boxes.length);
    for (const refused of [
      'Founder story',
      'Audience',
      'Business explanation',
      'Social links',
      'Meeting notes',
      'Visual asset uploads',
      'Interview scheduling',
    ]) {
      expect(boxes).toContain(refused);
    }
    for (const entry of CREATE_FOUNDER_ABSENCES) {
      expect(entry.reason.length).toBeGreaterThan(60);
    }
  });
});
