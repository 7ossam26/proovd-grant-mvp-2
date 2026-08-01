/**
 * The active-partnership slot — Spec §2.2, §8.
 *
 * §2.2: "One Affiliate may occupy no more than three active-partnership slots.
 * A slot runs from tracking-link activation until campaign close or recorded
 * removal."
 *
 * §8 states the negative half: "Preparing/invited/declined associations do not
 * occupy an active-partnership slot."
 *
 * ── Why occupancy is derived and never stored ───────────────────────────────
 * The rule is a sentence about two events — activation, and close-or-removal —
 * and the association state already records both. A stored `occupies_slot`
 * boolean would be a third copy of the same fact, and the failure mode is a
 * Creator who cannot take a fourth campaign because a flag was never cleared
 * when a campaign closed. §23's rule that history is append-only is what makes
 * deriving safe: the state is the truth, so the count is too.
 *
 * ── Where the cap is enforced ───────────────────────────────────────────────
 * At tracking-link activation, which is Phase 14. This file is the definition
 * the enforcement point reads; nothing in Phase 08 can push an association past
 * `preparing`, so nothing in Phase 08 can consume a slot. The Admin recruitment
 * surface renders the count so a recruiting Admin can see, before inviting,
 * that a Creator is already at three — recruiting them anyway is legitimate
 * (§8 recruitment does not start any clock), but doing it unknowingly is not.
 */

import type { AssociationStatus } from '../states/association.js';

/** §2.2. Not a setting: §6 does not name it, and §2.2 fixes the number. */
export const ACTIVE_PARTNERSHIP_SLOT_LIMIT = 3;

/**
 * The states in which a slot is occupied.
 *
 * `active` is tracking-link activation — §2.2's start event, and §17's
 * active-partnership surface.
 *
 * `paused` is deliberately included. §33.4.8 pauses a Creator and their link
 * after a failed first-post verification; the campaign has not closed and there
 * has been no recorded removal, so §2.2's slot is still running. Excluding it
 * would let one Creator hold four campaigns by having one of them go wrong,
 * which inverts the rule.
 *
 * Every other state is excluded because the link has not been activated yet
 * (`prospect` … `ready`) or because the campaign closed or the association was
 * removed (`ended`, `removed`, `successfully_completed`,
 * `completion_disqualified`, `declined`, `expired_no_acceptance`).
 */
export const SLOT_OCCUPYING_STATUSES = ['active', 'paused'] as const satisfies readonly AssociationStatus[];

export type SlotOccupyingStatus = (typeof SLOT_OCCUPYING_STATUSES)[number];

const OCCUPYING = new Set<string>(SLOT_OCCUPYING_STATUSES);

export function occupiesActiveSlot(status: AssociationStatus): boolean {
  return OCCUPYING.has(status);
}

export interface SlotUsage {
  used: number;
  limit: number;
  remaining: number;
  /** True when a further activation would exceed §2.2's cap. */
  atLimit: boolean;
}

export function slotUsage(statuses: readonly AssociationStatus[]): SlotUsage {
  const used = statuses.filter(occupiesActiveSlot).length;
  return {
    used,
    limit: ACTIVE_PARTNERSHIP_SLOT_LIMIT,
    remaining: Math.max(0, ACTIVE_PARTNERSHIP_SLOT_LIMIT - used),
    atLimit: used >= ACTIVE_PARTNERSHIP_SLOT_LIMIT,
  };
}
