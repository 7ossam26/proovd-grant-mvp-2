/**
 * Chapter 1, Choose — Founder Dashboard Session C.
 *
 * `docs/phases/founder-dashboard.md`. What the Founder does between paying the
 * listing fee and the campaign going live: read the roster Proovd recruited,
 * answer the proposals those Creators make, offer a bonus once terms lock, and
 * ask to meet somebody before deciding.
 *
 * ── This chapter is a RESPONSE surface, not a selection one ─────────────────
 * The single most important thing about it, and the easiest to get wrong. §14.5
 * is explicit — "Proovd owns recruitment follow-up. The Founder cannot browse
 * or contact a general pool" — §8 repeats it, §30 defers "Founder
 * browsing/outreach to unmatched Affiliates", and `rosterMembership` has two
 * writers and both are Admin.
 *
 * So there is no select control, no ordering control, no "send to my final
 * roster" action, and no way to remove somebody. What a Founder does here is
 * §14.2's three responses to a version a Creator authored, and §14.3's bonus.
 *
 * ── Nothing here decides a percentage ───────────────────────────────────────
 * `resolveCompensation` owns the six §14.3 cells and reads two §6 settings;
 * `validateProposalAgainstCell` owns what a version may say. This file computes
 * the RANGE a revision control offers, from the base and ceiling the server
 * sent, so the control cannot present a number the server would refuse. It is a
 * courtesy over the server's answer (§1.1), never a second rule.
 */

/* ── The revision control's own bounds ───────────────────────────────────── */

export interface RevisionRange {
  /** The lowest value the server will accept: strictly above base. */
  readonly min: number;
  /** §6's ceiling. */
  readonly max: number;
  /** False when the campaign is not high-effort — there is no revision to make. */
  readonly available: boolean;
}

/**
 * §14.2 gives a Founder revision one shape and `validateProposalAgainstCell`
 * enforces it in four refusals: a whole number, strictly above the applicable
 * base, at or under the ceiling, and only on a high-effort campaign.
 *
 * A free slider produces refusals a Founder cannot act on — they lower the
 * number to be reasonable and are told the standard terms already give more.
 * So the control's range starts at `base + 1` and ends at the ceiling, and the
 * only downward exit is decline, which is what §14.2 actually offers.
 */
export function revisionRange(basePercent: number, ceilingPercent: number, bidAllowed: boolean): RevisionRange {
  return {
    min: basePercent + 1,
    max: ceilingPercent,
    // A range whose floor is above its ceiling is not a narrow range, it is an
    // impossible one — and it means the ceiling has been lowered to the base.
    available: bidAllowed && basePercent + 1 <= ceilingPercent,
  };
}

/** The opening value a revision control shows: the Creator's own ask, pulled into range. */
export function revisionOpeningValue(range: RevisionRange, creatorAsk: number | null): number {
  if (!range.available) return range.min;
  // Opening one below their ask is the counter a person would type. Clamped,
  // because their ask may already sit at the floor or beyond the ceiling.
  const wanted = creatorAsk === null ? range.min : creatorAsk - 1;
  return Math.min(range.max, Math.max(range.min, wanted));
}

export const REVISION_IS_NOT_ACCEPTANCE =
  'A revision is a new version for them to answer. It is not an acceptance, and nothing locks until you both accept the same one.';

export const REVISION_ONLY_UPWARDS =
  'A revision can only go above the standard terms. There is no lower number to offer — if the terms do not work, decline.';

/* ── §14.3's bonus ───────────────────────────────────────────────────────── */

/**
 * The reference's bonus modal reads "Reward performance without changing the
 * agreed base cut", which says the bonus sits outside the ceiling. §14.3 stores
 * a "maximum combined percentage" and `offerCreatorBonus` refuses a bonus that
 * breaches it, naming the largest one still available. Only a FIXED amount sits
 * outside the ceiling (§14.3's last sentence), and this control offers none.
 */
export const BONUS_COUNTS_TOWARD_THE_CEILING =
  'A bonus is part of the same percentage. Their locked terms plus the bonus can never pass the ceiling, and Proovd refuses a bonus that would.';

/**
 * §14.3 names exactly two trigger units and no time window. The reference's
 * "When should it count? — 3 days / 1 week / By campaign end" is a third rule
 * with no record behind it: `creator_bonuses` stores trigger unit, threshold,
 * additional percentage, maximum combined percentage, proposal version and
 * earned result, and nothing that could hold a period.
 */
export const BONUS_TRIGGER_UNITS = [
  {
    id: 'unique_attributed_backers',
    label: 'Pre-orders they bring in',
    unit: 'pre-orders',
    help: "Counts only pre-orders this Creator's own link brought in and that were successfully charged.",
  },
  {
    id: 'attributed_subtotal_cents',
    label: 'Sales they bring in',
    unit: 'US$',
    help: "Counts only the pre-tax reward subtotal this Creator's own link brought in and that was successfully charged.",
  },
] as const satisfies readonly {
  readonly id: 'unique_attributed_backers' | 'attributed_subtotal_cents';
  readonly label: string;
  readonly unit: string;
  readonly help: string;
}[];

export type BonusTriggerUnitId = (typeof BONUS_TRIGGER_UNITS)[number]['id'];

/**
 * §14.3: "Whole-campaign, organic, house, or another Creator's result cannot
 * trigger it." Rendered beside the trigger choice, because a Founder reading
 * "pre-orders" naturally hears "the campaign's pre-orders".
 */
export const BONUS_IS_THIS_CREATOR_ONLY =
  "A bonus only ever counts this Creator's own results. Pre-orders that came from search, from Proovd, or from another Creator never trigger it.";

/**
 * The bonus is offered AFTER terms lock, and that ordering is load-bearing.
 * `offerCreatorBonus` measures the ceiling against the locked agreement where
 * one exists and against the campaign's standard base where none does — so a
 * bonus offered first is checked against the wrong baseline, and a Founder who
 * accepts 35% and then finds their already-offered 20% bonus breaches the
 * ceiling has been told two different things.
 */
export const BONUS_AFTER_ACCEPTANCE =
  'You can offer a bonus once their terms are locked. The ceiling is measured against what you both agreed, so the number has to exist first.';

/* ── Deviation 1: the meeting request ────────────────────────────────────── */

export const MEETING_REQUEST_STATUSES = ['requested', 'accepted', 'declined', 'withdrawn'] as const;
export type MeetingRequestStatus = (typeof MEETING_REQUEST_STATUSES)[number];

/**
 * §30 defers "Founder–Creator meeting scheduler; **the human Founder interview
 * scheduler is required**", and tech-stack §12 makes the Cal.com booking record
 * the source of truth for the one scheduler this product has.
 *
 * So this is a REQUEST, on §22.9's shape: one message written once, one answer,
 * and nothing that books time. The reference's three slot chips ("Tue 10:00 /
 * Wed 14:00 / Fri 16:00") are the scheduler §30 refuses, and the record has no
 * column any of them could be written to.
 */
export const MEETING_REQUEST_IS_NOT_A_SCHEDULER =
  'This asks them if they want to talk. It does not book anything — if they say yes, Proovd arranges the time.';

/**
 * §22.9's shape, stated where the Founder is writing. The single message is the
 * whole of what §30 permits here: a reply box would be the direct Founder–
 * Creator messaging §30 defers, wearing a smaller control.
 */
export const MEETING_REQUEST_ONE_MESSAGE =
  'You get one message, and it is sent as written. There is no thread here and no way to send a second one.';

/** §14.2's own promise, restated for a request that is not a proposal. */
export const MEETING_REQUEST_NO_PENALTY =
  'They can say no. It does not affect their standing, their terms, or anything about this campaign.';

/**
 * The request decides nothing. §14.2's three responses are the only things that
 * move terms, and a meeting is not one of them — so a Creator who accepts has
 * agreed to talk and to nothing else.
 */
export const MEETING_REQUEST_CHANGES_NOTHING =
  'Asking to meet changes nothing about their offer or your campaign. Their proposal stays exactly where it is.';

/* ── What the reference draws that this chapter does not ─────────────────── */

export interface ChooseAbsence {
  /** A stable id, so a test can walk the register against the rendered chapter. */
  readonly id: string;
  /** What the reference puts here. */
  readonly reference: string;
  /** The sentence the chapter renders where the control would have been. */
  readonly sentence: string;
  readonly specRef: string;
}

/**
 * The `OPERATIONS_ABSENCES` arrangement (Admin Founders rebuild, 2026-08-17)
 * applied to a Founder chapter: every control the reference draws that the Spec
 * forbids, carrying the sentence the surface renders in its place. Re-adding
 * one means deleting the sentence that refuses it, which is a visible edit.
 */
export const CHOOSE_ABSENCES: readonly ChooseAbsence[] = [
  {
    id: 'send_to_roster',
    reference: '“Send to affiliates” — the Founder releasing the campaign to a roster they assembled.',
    sentence:
      'Proovd recruits for your campaign and sends the opportunity. You answer what comes back — there is no list to assemble and no send button, because the sending is not yours.',
    specRef: '§14.5, §8, §30',
  },
  {
    id: 'browse_creators',
    reference: 'Browsing or searching a wider pool of Creators to add.',
    sentence:
      'There is no Creator directory here. Proovd finds and approaches people for your campaign, and owns every follow-up.',
    specRef: '§14.5, §8, §30',
  },
  {
    id: 'remove_creator',
    reference: '“Reject match” — removing somebody from the roster.',
    sentence:
      'Declining answers their offer, not their place on the roster. They can still accept the standard terms or come back with a different number.',
    specRef: '§14.2, §23.4',
  },
  {
    id: 'meeting_slots',
    reference: 'Three time slots and “Send meeting invite” — a second scheduler.',
    sentence: MEETING_REQUEST_IS_NOT_A_SCHEDULER,
    specRef: '§30, tech-stack §12',
  },
  {
    id: 'bonus_period',
    reference: '“When should it count? — 3 days / 1 week / By campaign end”.',
    sentence:
      'A bonus is measured by what this Creator brings in, not by when. There is no clock on it: it pays out if the number is reached by the time the campaign closes.',
    specRef: '§14.3',
  },
  {
    id: 'creator_contact',
    reference: 'An external link to the Creator’s own channel, and a way to reach them.',
    sentence:
      'Proovd holds their contact details and their channel is theirs. Anything you need to ask goes through us.',
    specRef: '§11, §30',
  },
  {
    id: 'creator_posts',
    reference: '“Last three pieces — what they actually make”: samples of the Creator’s work.',
    sentence:
      'Proovd reviewed their work before recruiting them, and the short note above is what that review found. Their posts for your campaign appear once it is live.',
    specRef: '§11, §17',
  },
];

export function chooseAbsence(id: string): ChooseAbsence {
  const found = CHOOSE_ABSENCES.find((a) => a.id === id);
  if (!found) throw new Error(`no Choose absence '${id}'`);
  return found;
}

/* ── The two onboarding steps that survive ───────────────────────────────── */

/**
 * The reference runs `password → effort → refunds → community` on first arrival.
 * Password is dropped (§10's claim owns it, and the flow already ships it
 * there); the $5 hosted community is refused (§30, §1 rule 6, §24's three
 * streams). What is left is one explainer and two fields on `campaign_build`.
 *
 * They are PANELS in this chapter rather than a once-only sequence, for three
 * reasons worth writing down: a sequence of explainer screens shown once is the
 * closest thing in this product to the general product tour §30 defers; both
 * fields are already owned by the build surface, so putting them in the chapter
 * keeps them reachable rather than gone after the first visit; and a sequence
 * needs a "seen this" flag, which is a new stored fact about what somebody
 * looked at, for no behaviour.
 */
export const BASE_CUT_IS_NOT_YOURS_TO_SET =
  'This is the standard share for your campaign type. You do not set it — a Creator can ask for more, and you answer.';

/**
 * The reference's effort screen says "Affiliates can bid higher or lower".
 * §14.2 permits a bid ABOVE the applicable base and only on a high-effort
 * campaign; `validateProposalAgainstCell` refuses anything at or below it by
 * name. There is no downward bid anywhere in the product.
 */
export const NO_DOWNWARD_BID =
  'Nobody can offer to work for less than the standard share. The only numbers you will see are above it.';

export const REFUND_POLICY_IS_READ_BEFORE_PAYING =
  'Backers open this from your campaign page before they pay, so point it somewhere that stays up.';

/**
 * §30 defers "Hosted Founder community", §1 rule 6 forbids inventing a fee, and
 * §24's three money streams never commingle — a fourth has no merchant-of-record
 * determination, no tax position, no refund policy, and no place in the §26.5
 * ledger. The reference's second branch charges US$5 for Proovd to stand one up.
 */
export const COMMUNITY_IS_YOURS_TO_RUN =
  'Proovd does not host or run a community for you. If you already have one, put the link here and it appears on your campaign page.';
