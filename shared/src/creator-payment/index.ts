/**
 * The optional fixed Creator payment and the §16 readiness checklist — Spec
 * §16, §24.7 (Phase 13).
 *
 * The pure logic: the §16 readiness checklist as a function over a gathered
 * snapshot, and the permitted vocabulary the surfaces render. The backend
 * gathers each association's records and persists the derived association status
 * (`ready` / `readiness_blocked`); this decides, so §33.4.4 is assertable as a
 * fact rather than as a simulated network — the same arrangement as
 * `deriveRosterReadiness` (§15) and `decideItems` (§12).
 *
 * ── Never a holding-account word (§16, §2.1, §3.2) ──────────────────────────
 * The allocation is the *optional fixed Creator payment* / *secured Creator
 * payment*; funded it is *Creator payment funded* / *fixed Creator payment
 * pending completion*; paid it is *fixed Creator payment paid*. §3.2's
 * holding-account vocabulary and "money already paid to the Creator" are
 * forbidden — these constants are what the surfaces say instead.
 */

/* ── The permitted vocabulary (§16, §3.2) ──────────────────────────────────── */

/** §16's permitted labels for the states a surface renders. */
export const FIXED_PAYMENT_LABELS = {
  /** No fixed payment was accepted for this Creator. */
  none: 'No fixed Creator payment',
  /** Before funding: an accepted but not-yet-secured payment. */
  pending: 'Optional fixed Creator payment',
  /** Funded, before completion is decided (§16, §22.1). */
  funded: 'Fixed Creator payment pending completion',
  /** Paid after completion (§22.1, Phase 19). */
  paid: 'Fixed Creator payment paid',
  /** Funding attempt failed; the accepted amount is preserved and work blocked. */
  failed: 'Fixed Creator payment funding failed',
  /** Returned to the Founder (§22.1, §31.6, Phase 19). */
  returned: 'Fixed Creator payment returned',
} as const;

/** The verb §16 permits for securing the amount — never "pay the Creator". */
export const FUNDING_ACTION_LABEL = 'Fund the secured Creator payment';

/* ── §16: the Creator-readiness checklist ──────────────────────────────────── */

/**
 * One §16 checklist item. `owner` names who has to resolve it (§16 requires the
 * Founder view to show "the owner"). `applicableWhen` distinguishes an item that
 * is only relevant when a fixed payment exists — "fully funded fixed allocation,
 * IF APPLICABLE" — from the ones that always apply.
 */
export interface ReadinessItemDefinition {
  key: ReadinessItemKey;
  label: string;
  /** Who resolves it: the party a blocked item's `owner` names (§16). */
  owner: 'admin' | 'founder' | 'proovd' | 'creator';
  /** The §16 checklist line this implements. */
  specRef: string;
  /** True only when a fixed payment was accepted for this Creator. */
  fixedPaymentOnly: boolean;
}

export type ReadinessItemKey =
  | 'campaign_approved'
  | 'final_rewards_offers'
  | 'final_incentives_compensation'
  | 'product_brand_assets'
  | 'permitted_prohibited_claims'
  | 'tracking_link_record'
  | 'ftc_disclosure_template'
  | 'required_posts_deliverables'
  | 'campaign_dates'
  | 'ip_confidentiality_agreement'
  | 'campaign_terms_aup'
  | 'fixed_allocation_funded'
  | 'connected_account_capability';

/**
 * §16's thirteen items, in the order §16 lists them. A Creator may begin work
 * only when every APPLICABLE item is complete — readiness is all-or-nothing, so
 * twelve of thirteen still blocks (§16's trap, §33.4.4).
 */
export const READINESS_ITEMS: readonly ReadinessItemDefinition[] = [
  {
    key: 'campaign_approved',
    label: 'Campaign approved',
    owner: 'admin',
    specRef: '§16 · Campaign approved',
    fixedPaymentOnly: false,
  },
  {
    key: 'final_rewards_offers',
    label: 'Final rewards and offers',
    owner: 'founder',
    specRef: '§16 · Final rewards/offers',
    fixedPaymentOnly: false,
  },
  {
    key: 'final_incentives_compensation',
    label: 'Final incentives and compensation',
    owner: 'founder',
    specRef: '§16 · Final incentives and compensation',
    fixedPaymentOnly: false,
  },
  {
    key: 'product_brand_assets',
    label: 'Product and brand assets',
    owner: 'founder',
    specRef: '§16 · Product/brand assets',
    fixedPaymentOnly: false,
  },
  {
    key: 'permitted_prohibited_claims',
    label: 'Permitted and prohibited claims',
    owner: 'founder',
    specRef: '§16 · Permitted/prohibited claims',
    fixedPaymentOnly: false,
  },
  {
    key: 'tracking_link_record',
    label: 'Tracking-link record',
    owner: 'proovd',
    specRef: '§16 · Tracking-link record',
    fixedPaymentOnly: false,
  },
  {
    key: 'ftc_disclosure_template',
    label: 'FTC disclosure template',
    owner: 'proovd',
    specRef: '§16 · FTC disclosure template',
    fixedPaymentOnly: false,
  },
  {
    key: 'required_posts_deliverables',
    label: 'Required posts, deliverables, and availability periods',
    owner: 'admin',
    specRef: '§16 · Required posts/deliverables and availability periods',
    fixedPaymentOnly: false,
  },
  {
    key: 'campaign_dates',
    label: 'Campaign dates',
    owner: 'founder',
    specRef: '§16 · Campaign dates',
    fixedPaymentOnly: false,
  },
  {
    key: 'ip_confidentiality_agreement',
    label: 'Accepted Creator-only IP and confidentiality agreement',
    owner: 'creator',
    specRef: '§16 · Accepted Creator-only IP/confidentiality agreement',
    fixedPaymentOnly: false,
  },
  {
    key: 'campaign_terms_aup',
    label: 'Accepted campaign terms and AUP',
    owner: 'creator',
    specRef: '§16 · Accepted campaign terms/AUP',
    fixedPaymentOnly: false,
  },
  {
    key: 'fixed_allocation_funded',
    label: 'Fully funded fixed allocation',
    owner: 'founder',
    specRef: '§16 · Fully funded fixed allocation, if applicable',
    fixedPaymentOnly: true,
  },
  {
    key: 'connected_account_capability',
    label: 'Required connected-account and capability status',
    owner: 'creator',
    specRef: '§16 · Required connected-account/capability status',
    fixedPaymentOnly: false,
  },
] as const;

/**
 * The gathered facts the readiness decision reads. The backend fills this from
 * the campaign, its approved snapshot and build, and the association's
 * agreement, tracking link, acceptance confirmation, readiness record, fixed
 * allocation, and connected account. Each boolean is "this item is complete".
 */
export interface CreatorReadinessSnapshot {
  campaignApproved: boolean;
  rewardsFinal: boolean;
  compensationFinal: boolean;
  brandAssetsPresent: boolean;
  claimsRulesPresent: boolean;
  trackingLinkPresent: boolean;
  ftcAcknowledged: boolean;
  deliverablesConfirmed: boolean;
  campaignDatesSet: boolean;
  ipAgreementAccepted: boolean;
  termsAupAccepted: boolean;
  /** Whether a fixed payment was accepted for this Creator at all. */
  fixedPaymentApplicable: boolean;
  /** Whether that fixed allocation is fully funded (only read when applicable). */
  fixedAllocationFunded: boolean;
  connectedAccountReady: boolean;
}

export interface CreatorReadinessResult {
  /** True only when every APPLICABLE item is complete (§16). */
  canBeginWork: boolean;
  /** The applicable items still incomplete, in §16 order, for the surface. */
  incompleteItems: ReadinessItemKey[];
  /** Every applicable item with its completion, for the two-view surfaces. */
  items: Array<{ key: ReadinessItemKey; complete: boolean; applicable: boolean }>;
}

/** Maps a snapshot fact to each checklist item. */
function itemComplete(
  key: ReadinessItemKey,
  snapshot: CreatorReadinessSnapshot,
): boolean {
  switch (key) {
    case 'campaign_approved':
      return snapshot.campaignApproved;
    case 'final_rewards_offers':
      return snapshot.rewardsFinal;
    case 'final_incentives_compensation':
      return snapshot.compensationFinal;
    case 'product_brand_assets':
      return snapshot.brandAssetsPresent;
    case 'permitted_prohibited_claims':
      return snapshot.claimsRulesPresent;
    case 'tracking_link_record':
      return snapshot.trackingLinkPresent;
    case 'ftc_disclosure_template':
      return snapshot.ftcAcknowledged;
    case 'required_posts_deliverables':
      return snapshot.deliverablesConfirmed;
    case 'campaign_dates':
      return snapshot.campaignDatesSet;
    case 'ip_confidentiality_agreement':
      return snapshot.ipAgreementAccepted;
    case 'campaign_terms_aup':
      return snapshot.termsAupAccepted;
    case 'fixed_allocation_funded':
      return snapshot.fixedAllocationFunded;
    case 'connected_account_capability':
      return snapshot.connectedAccountReady;
  }
}

/**
 * §16's all-or-nothing readiness. A Creator may begin work only when every
 * applicable item is complete; the fixed-allocation item applies only when a
 * fixed payment was accepted for this Creator ("if applicable").
 *
 * §33.4.4 is assertable directly against this: complete every item and
 * `canBeginWork` is true; drop any one applicable item and it is false with that
 * item named.
 */
export function deriveCreatorReadiness(
  snapshot: CreatorReadinessSnapshot,
): CreatorReadinessResult {
  const items = READINESS_ITEMS.map((definition) => {
    const applicable =
      !definition.fixedPaymentOnly || snapshot.fixedPaymentApplicable;
    return {
      key: definition.key,
      applicable,
      complete: applicable ? itemComplete(definition.key, snapshot) : true,
    };
  });

  const incompleteItems = items
    .filter((item) => item.applicable && !item.complete)
    .map((item) => item.key);

  return {
    canBeginWork: incompleteItems.length === 0,
    incompleteItems,
    items,
  };
}

export function findReadinessItem(
  key: ReadinessItemKey,
): ReadinessItemDefinition | undefined {
  return READINESS_ITEMS.find((item) => item.key === key);
}
