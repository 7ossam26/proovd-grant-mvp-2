/**
 * Campaign–Affiliate association machine — Spec §23.4 (19 states).
 *
 * §23.4 names the states; the edges below come from the phase sections that
 * move an association: recruitment §8, signup §9–10, formal decision §14.2,
 * readiness/launch §15–16, live operation §17–18, close §21, completion
 * §22.1/§26, enforcement §29.5. Initial-roster vs mid-campaign membership is
 * a separate stored column (§23.4), not a state.
 *
 * Declined, expired, and removed are terminal for THIS association — §14.6: a
 * late response cannot silently reactivate; re-engagement is a new
 * association row with its own history.
 */

import { defineMachine } from './machine.js';

export const ASSOCIATION_STATUSES = [
  'prospect',
  'invited',
  'signup_started',
  'signed_up_waiting_for_founder',
  'preparing',
  'formal_decision_open',
  'reviewing',
  'proposal_pending',
  'accepted',
  'declined',
  'expired_no_acceptance',
  'readiness_blocked',
  'ready',
  'active',
  'paused',
  'ended',
  'removed',
  'successfully_completed',
  'completion_disqualified',
] as const;

export type AssociationStatus = (typeof ASSOCIATION_STATUSES)[number];

export const associationMachine = defineMachine<AssociationStatus>(
  'campaign_affiliate_association',
  ASSOCIATION_STATUSES,
  {
    // §8: Admin creates the prospect, then sends the campaign-specific invitation.
    prospect: ['invited', 'removed'],
    // §9: the Affiliate opens the invitation and starts signup.
    invited: ['signup_started', 'removed'],
    // §9–10: account + payout action complete → named waiting state (§33.2.3).
    signup_started: ['signed_up_waiting_for_founder', 'removed'],
    // §33.1.9: `founder_signup_complete` reveals the preparing campaign.
    signed_up_waiting_for_founder: ['preparing', 'removed'],
    // §33.2.5: listing payment activates the formal decision exactly once.
    preparing: ['formal_decision_open', 'removed'],
    // §14.2: accept / decline / propose are all reachable; §14.5 names a
    // distinct "reviewing" status; §14.6: deadline expires open decisions.
    formal_decision_open: [
      'reviewing',
      'accepted',
      'declined',
      'proposal_pending',
      'expired_no_acceptance',
      'removed',
    ],
    reviewing: ['accepted', 'declined', 'proposal_pending', 'expired_no_acceptance', 'removed'],
    // §14.2: versions cycle within proposal_pending; only exact bilateral
    // acceptance locks; unfinished proposals expire at the 72-hour deadline.
    proposal_pending: ['accepted', 'declined', 'expired_no_acceptance', 'removed'],
    // §14.2: accepted, not active — link stays inactive until approval and
    // readiness (§15–16). Readiness can block or complete.
    accepted: ['readiness_blocked', 'ready', 'removed'],
    // §16: blocking item resolved → ready.
    readiness_blocked: ['ready', 'removed'],
    // §16: launch activates; a pre-launch problem re-blocks.
    ready: ['active', 'readiness_blocked', 'removed'],
    // §33.4.8: correction/reject pauses the Creator and link; §21: close ends.
    active: ['paused', 'ended', 'removed'],
    paused: ['active', 'ended', 'removed'],
    // §22.1/§26: after verification, completion resolves one way or the other.
    ended: ['successfully_completed', 'completion_disqualified'],
    // Terminal (§14.6, §29.5).
    declined: [],
    expired_no_acceptance: [],
    removed: [],
    successfully_completed: [],
    completion_disqualified: [],
  },
);
