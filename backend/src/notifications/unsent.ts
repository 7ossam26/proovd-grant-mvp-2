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
  owner: 'none' | 'phase-21b' | 'phase-22b' | 'phase-22c';
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

  /* ── Message missing, behaviour recorded — Phase 22b's remainder ───────── */
  /*
   * The seven 22b did not reach. Each has a written sender design and a named
   * dedup entity; what each still needs is either a call site threaded through
   * a service that has no notifier, or infrastructure that does not exist yet.
   * They are recorded rather than declared because `events.ts` carries one rule
   * — a key appears when something SENDS it — and a key with a template and no
   * caller is the §1.4 failure this register exists to make impossible.
   */

  founder_roster_update: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '22b widened `transitionAssociation` to return the `association_status_history` row id, which is the hard half — its dedup entity MUST be that row, because §27.7\'s digest excludes a roster item whose covering key already delivered and the exclusion binds on exactly (`founder_roster_update`, target, history row id). What remains is choosing WHICH of the fourteen transitions a Founder is owed a message about; announcing all fourteen would be the engagement stream §30 forbids, and that is a judgement rather than a wiring job.',
    record: 'association_status_history (id returned by `transitionAssociation`)',
  },
  internal_interview_changed: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6. `workspace/interview.ts` has no notifier and its four Founder-facing messages are sent a frame up by the routes; the internal one needs the same threading through `rescheduleBooking`/`cancelBooking`. Its entity is the `interview_booking_events` ROW, not `<booking>:<time>` — a cancel-then-rebook to the same slot collides under the latter.',
    record: 'founder_interview_bookings + interview_booking_events',
  },
  internal_proposal_awaiting_response: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6. `insertVersion` is private to `decisions.ts` and has two call sites inside transactions; the entity is the `proposal_versions` row, because a counter is a genuinely new answer owed and keying on the association would announce the first and swallow the rest.',
    record: 'proposal_versions (open)',
  },
  internal_post_verification_due: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6. `createCreatorRouter` takes positional args and carries no notifier — the only remaining sender that needs a router SIGNATURE change rather than an added dep. Entity: the `creator_post_submissions` row, so a corrected resubmission is a new decision.',
    record: 'creator_post_submissions',
  },
  internal_support_sla_breach: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.6/§27.8. `readSupportQueue` derives all three breaches already, but nothing runs it on a schedule: there is no support job in `scheduler.ts` and no `support` field on `SchedulerDeps`. The sweep is the work. Entity: (case, clock, the deadline instant that lapsed) — a case has three clocks and the promised-update one legitimately moves forward.',
    record: 'support_cases.response_due_at / next_promised_update_at / founder_followup_due_at',
  },
  backer_support_followup: {
    kind: 'message',
    owner: 'phase-22b',
    reason:
      '§27.8: "Even without resolution, send an update at the promised checkpoint." `next_promised_update_at` is written by `addCaseMessage` and read only by the queue; it needs the same sweep as the breach notice, and the entity is the promise INSTANT so a case that gets a second promise gets a second follow-up.',
    record: 'support_cases.next_promised_update_at',
  },
  backer_magic_link_reissue: {
    kind: 'capability',
    owner: 'phase-22b',
    reason:
      'Not a missing message — a missing ASK. Every magic-link route sits behind a working magic link, so a Backer whose link expired has no self-serve path and nothing to trigger a reissue. The message needs a public request route first, and that route has to answer identically whether or not an identity matched (§5.5) or it becomes an oracle for who pre-ordered what. That is a §19 surface decision, not a template.',
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

  /* ── Message missing, behaviour recorded — Phase 22b ───────────────────── */


} as const satisfies Record<string, UnsentEvent>;

export type UnsentNotificationKey = keyof typeof UNSENT_NOTIFICATION_EVENTS;

export const UNSENT_NOTIFICATION_KEYS = Object.keys(
  UNSENT_NOTIFICATION_EVENTS,
) as UnsentNotificationKey[];

/** The keys a named phase owes a message. Empty for `owner: 'none'`. */
export function unsentOwnedBy(owner: UnsentEvent['owner']): UnsentNotificationKey[] {
  return UNSENT_NOTIFICATION_KEYS.filter((key) => UNSENT_NOTIFICATION_EVENTS[key].owner === owner);
}
