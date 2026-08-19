/**
 * The §25.6 audit action names the Creator workspace writes and reads back.
 *
 * Named constants rather than string literals at each call site for one
 * reason: `history.ts` reads `audit_events` through an ALLOWLIST — an action it
 * does not recognise is skipped rather than rendered raw — so a writer and a
 * reader that disagree about a name produce an event nobody ever sees. One
 * constant makes that impossible.
 *
 * `founders/audit-actions.ts` is the same file for the other person, and the
 * two deliberately do not share a namespace: an Affiliate suspension and a
 * Founder suspension are different acts against different records, and a
 * shared `access.recorded` would make the two indistinguishable in a query.
 */

export const CREATOR_ACCESS_RECORDED = 'creator.access_recorded' as const;
export const CREATOR_ASSIGNED_TO_CAMPAIGN = 'creator.assigned_to_campaign' as const;
export const CREATOR_DELETION_REQUESTED = 'creator.deletion_requested' as const;
export const CREATOR_DELETION_REVIEWED = 'creator.deletion_reviewed' as const;
export const CREATOR_LINK_PAUSED = 'creator.link_paused' as const;
export const CREATOR_LINK_REACTIVATED = 'creator.link_reactivated' as const;

/* The Session B acts (2026-08-17): the evidence files, the per-metric trail,
 * the account correction, the §11 ask, the Admin-initiated reset, and the
 * Stripe re-read. */
export const CREATOR_EVIDENCE_UPLOADED = 'creator.evidence_uploaded' as const;
export const CREATOR_EVIDENCE_REMOVED = 'creator.evidence_removed' as const;
export const CREATOR_METRIC_DECIDED = 'creator.metric_decision_recorded' as const;
export const CREATOR_ACCOUNT_CORRECTED = 'creator.account_corrected' as const;
export const CREATOR_CORRECTION_REQUESTED = 'creator.correction_requested' as const;
export const CREATOR_RECOVERY_SENT = 'creator.password_recovery_sent' as const;
export const CREATOR_STRIPE_REFRESHED = 'creator.stripe_status_refreshed' as const;

/* The Session C acts (2026-08-17): the 0048 relationship records, the payout
 * reminder ask, and the §26.7 case intake. */
export const CREATOR_DELIVERABLE_RECORDED = 'creator.deliverable_recorded' as const;
export const CREATOR_DELIVERABLE_EVIDENCE = 'creator.deliverable_evidence_recorded' as const;
export const CREATOR_DELIVERABLE_DECIDED = 'creator.deliverable_decision_recorded' as const;
export const CREATOR_AVAILABILITY_VERIFIED = 'creator.availability_verified' as const;
export const CREATOR_MEDIATION_NOTED = 'creator.mediation_note_recorded' as const;
export const CREATOR_TERMINATION_REQUESTED = 'creator.termination_request_recorded' as const;
export const CREATOR_TERMINATION_DECIDED = 'creator.termination_request_decided' as const;
export const CREATOR_PAYOUT_REMINDED = 'creator.payout_reminder_sent' as const;
export const CREATOR_CASE_OPENED = 'creator.support_case_opened' as const;

/**
 * Every action `history.ts` will render, with the plain sentence it renders as.
 *
 * The `title` is what an Admin reads; the record's own columns supply the
 * detail. An action absent from this map is not a bug — it is an act that
 * belongs to another surface's history and is deliberately not repeated here.
 */
export const CREATOR_AUDIT_TITLES: Record<string, string> = {
  [CREATOR_ACCESS_RECORDED]: 'Account access decision recorded',
  [CREATOR_ASSIGNED_TO_CAMPAIGN]: 'Assigned to another campaign',
  [CREATOR_DELETION_REQUESTED]: 'Account deletion request recorded',
  [CREATOR_DELETION_REVIEWED]: 'Deletion request reviewed',
  [CREATOR_LINK_PAUSED]: 'Affiliate link paused by Proovd',
  [CREATOR_LINK_REACTIVATED]: 'Affiliate link reactivated',
  [CREATOR_EVIDENCE_UPLOADED]: 'Evidence picture added',
  [CREATOR_EVIDENCE_REMOVED]: 'Evidence picture removed',
  [CREATOR_METRIC_DECIDED]: 'Metric evidence decision recorded',
  [CREATOR_ACCOUNT_CORRECTED]: 'Account information corrected',
  [CREATOR_CORRECTION_REQUESTED]: 'Correction requested from the Affiliate',
  [CREATOR_RECOVERY_SENT]: 'Password recovery link sent',
  [CREATOR_STRIPE_REFRESHED]: 'Stripe status re-read from the provider',
  [CREATOR_DELIVERABLE_RECORDED]: 'Agreed deliverable recorded',
  [CREATOR_DELIVERABLE_EVIDENCE]: 'Deliverable evidence receipt recorded',
  [CREATOR_DELIVERABLE_DECIDED]: 'Deliverable decision recorded',
  [CREATOR_AVAILABILITY_VERIFIED]: 'Content availability checked',
  [CREATOR_MEDIATION_NOTED]: 'Proposal mediation note recorded',
  [CREATOR_TERMINATION_REQUESTED]: 'Termination request recorded',
  [CREATOR_TERMINATION_DECIDED]: 'Termination request decided',
  [CREATOR_PAYOUT_REMINDED]: 'Payout reminder sent',
  [CREATOR_CASE_OPENED]: 'Support case opened',
  // The names the Phase 08–11 affiliate services actually write. A send is not
  // here because it is its own record (`affiliate_invitation_sends`), which the
  // composer reads directly — an audit row beside it would render the same
  // event twice.
  'affiliate.prospect_created': 'Prospect recorded',
  // Session D (Creator Flow v2, deviation 3). The referral has no §27 key —
  // inventing one would be inventing a message — so the history IS how it
  // reaches an Admin, which is why it must be on this list to be visible.
  'affiliate.referral_recorded': 'Referred somebody for recruitment',
  'affiliate.prospect_updated': 'Research record updated',
  'affiliate.verification_recorded': 'Verification decision recorded',
  'affiliate.invitation_composed': 'Invitation composed',
  'affiliate.invitation_revoked': 'Campaign invitation revoked',
  'affiliate.invitation_send_failed': 'Campaign invitation could not be delivered',
  'affiliate.kit_access_revoked': 'Campaign kit access revoked',
  'affiliate.preparing_notification_failed': 'Preparing-campaign notice could not be delivered',
};

export function creatorAuditTitle(action: string): string | null {
  return CREATOR_AUDIT_TITLES[action] ?? null;
}
