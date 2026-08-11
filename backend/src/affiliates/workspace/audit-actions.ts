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
  // The names the Phase 08–11 affiliate services actually write. A send is not
  // here because it is its own record (`affiliate_invitation_sends`), which the
  // composer reads directly — an audit row beside it would render the same
  // event twice.
  'affiliate.prospect_created': 'Prospect recorded',
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
