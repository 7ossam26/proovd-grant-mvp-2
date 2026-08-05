/**
 * The §27 events with no sender, and why — Spec §1.4, §1 rule 6, §27.3–27.6.
 *
 * `events.ts` has always carried one rule: a key appears there when something
 * starts sending it, never before, because a key with no sender claims a
 * message the product does not send (§1.4). That rule kept the sent list
 * honest and left the unsent ones invisible — 44 of them by Phase 22, spread
 * across eleven phases' worth of comments explaining individual absences.
 *
 * This is the other half. Every registry key is either sent or recorded here
 * with the reason and the owner, and `notification-coverage.test.ts` asserts
 * the two lists partition the register exactly: no key in both, no key in
 * neither. That is what makes "nothing sends that shouldn't" a fact rather
 * than a claim, and it is why adding a key to the shared register without
 * either building its sender or recording its absence fails the suite.
 *
 * ── The three kinds of absence, and why they are not one ────────────────────
 *  - `never`      the Spec itself rules the message out, or naming its trigger
 *                 would be inventing one (§1 rule 6). These do not become
 *                 someone's backlog; they are decisions.
 *  - `capability` the message has no *behaviour* behind it yet. The phase that
 *                 builds the behaviour owns the message — Phase 22's own brief
 *                 says so: "If this phase finds a missing capability rather
 *                 than a missing message, that belongs to the phase that owns
 *                 it."
 *  - `message`    the behaviour exists and is recorded; only the message is
 *                 missing. `record` names the table that already holds the
 *                 fact, so the claim is checkable rather than aspirational.
 */

export type AbsenceKind = 'never' | 'capability' | 'message';

export interface UnsentEvent {
  kind: AbsenceKind;
  /** The phase that owns it, or `none` where the answer is that it never sends. */
  owner: 'none' | 'phase-21b';
  reason: string;
  /** For `message`: the record that already holds the fact the message would carry. */
  record?: string;
}

export const UNSENT_NOTIFICATION_EVENTS = {
  /* ── Decisions, not backlog (§1 rule 6, §1.4) ──────────────────────────── */

  founder_email_verification: {
    kind: 'never',
    owner: 'none',
    reason:
      '§27.3 names it "if later enabled". §5 admits Founders by invitation only and `disableSignUp: true` closes the HTTP route, so there is no public-route signup whose address would need verifying. Enabling one is a §5 change, and the message follows it rather than preceding it.',
  },
  internal_failed_payment_spike: {
    kind: 'never',
    owner: 'none',
    reason:
      '"Spike" needs a threshold and §6 fixes none. Inventing one is §1 rule 6, and the §33.7.12 close-operations queue already shows every failed capture with no threshold in front of it.',
  },
  internal_risk_flag: {
    kind: 'never',
    owner: 'none',
    reason:
      '22b looked for the trigger and there is none. §31.7\'s ten signals are computed live on every read of the risk panel — `readRiskPanel` runs ten SELECTs and derives `blockingKeys` at read time — and §31.7 forbids both a score and a threshold, so nothing is stored that a message could key on. Sending would require a sweep on an invented cadence (§33.6.11\'s exact failure) and `tax_not_collecting` would re-fire on every tick, since an unrecorded seller readiness is an instance in its own right and has no event to resolve against. The panel is where the work is visible, and it is honest there. A later phase that gives a signal a durable observation record gives this key its trigger with it.',
  },

  /* ── Capability not built — Phase 21b (§22.8–§22.11, §31.8) ────────────── */

  founder_ready_next_campaign: {
    kind: 'capability',
    owner: 'phase-21b',
    reason:
      '§22.10 Founder next-campaign readiness. 21a wrote no readiness record and §33.10.5–10 are 21b\'s.',
  },
  founder_work_again_response: {
    kind: 'capability',
    owner: 'phase-21b',
    reason: '§22.9 the work-again request. No work-again record exists to respond to.',
  },
  affiliate_work_again_request: {
    kind: 'capability',
    owner: 'phase-21b',
    reason: '§22.9. The Creator side of the same absent record.',
  },
  internal_work_again_request: {
    kind: 'capability',
    owner: 'phase-21b',
    reason: '§22.9. The Admin side of the same absent record.',
  },
  backer_satisfaction_survey: {
    kind: 'capability',
    owner: 'phase-21b',
    reason:
      '§31.8\'s satisfaction step and its one-click control are 21b\'s. 21a deliberately kept it out of `backer_delivery`: §27.5 names "Delivery and satisfaction survey" as two events, and linking to a control that does not exist would be the §1.4 failure.',
  },

  /*
   * There is no `message` category left. Phase 22b closed all 44: every §27
   * key whose behaviour exists now has a sender, and what remains is three
   * decisions the Spec itself makes and five messages waiting on Phase 21b's
   * behaviour. That is the register doing what it was built for — the list
   * shrank to the genuinely deferred rather than to the conveniently ignored.
   */
} as const satisfies Record<string, UnsentEvent>;

export type UnsentNotificationKey = keyof typeof UNSENT_NOTIFICATION_EVENTS;

export const UNSENT_NOTIFICATION_KEYS = Object.keys(
  UNSENT_NOTIFICATION_EVENTS,
) as UnsentNotificationKey[];

/** The keys a named phase owes a message. Empty for `owner: 'none'`. */
export function unsentOwnedBy(owner: UnsentEvent['owner']): UnsentNotificationKey[] {
  return UNSENT_NOTIFICATION_KEYS.filter((key) => UNSENT_NOTIFICATION_EVENTS[key].owner === owner);
}
