/**
 * The §16 Creator-readiness checklist, restated for the backend runtime.
 *
 * `shared/src/creator-payment/index.ts` is the reference: the frontend imports
 * it through Vite, and the Phase 13 suite drift-tests this against it. The
 * backend cannot import `@proovd/shared` at runtime (rootDir; the production
 * image ships only `backend/dist`), so the §16 checklist and its all-or-nothing
 * decision are restated here — the same arrangement `campaign/logic.ts`,
 * `db/schema/domain.ts`, and `affiliates/roster-labels.ts` document.
 */

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

export interface ReadinessItemDefinition {
  key: ReadinessItemKey;
  label: string;
  owner: 'admin' | 'founder' | 'proovd' | 'creator';
  specRef: string;
  fixedPaymentOnly: boolean;
}

/** §16's thirteen items, in order. Mirrors shared `READINESS_ITEMS`. */
export const READINESS_ITEMS: readonly ReadinessItemDefinition[] = [
  { key: 'campaign_approved', label: 'Campaign approved', owner: 'admin', specRef: '§16 · Campaign approved', fixedPaymentOnly: false },
  { key: 'final_rewards_offers', label: 'Final rewards and offers', owner: 'founder', specRef: '§16 · Final rewards/offers', fixedPaymentOnly: false },
  { key: 'final_incentives_compensation', label: 'Final incentives and compensation', owner: 'founder', specRef: '§16 · Final incentives and compensation', fixedPaymentOnly: false },
  { key: 'product_brand_assets', label: 'Product and brand assets', owner: 'founder', specRef: '§16 · Product/brand assets', fixedPaymentOnly: false },
  { key: 'permitted_prohibited_claims', label: 'Permitted and prohibited claims', owner: 'founder', specRef: '§16 · Permitted/prohibited claims', fixedPaymentOnly: false },
  { key: 'tracking_link_record', label: 'Tracking-link record', owner: 'proovd', specRef: '§16 · Tracking-link record', fixedPaymentOnly: false },
  { key: 'ftc_disclosure_template', label: 'FTC disclosure template', owner: 'proovd', specRef: '§16 · FTC disclosure template', fixedPaymentOnly: false },
  { key: 'required_posts_deliverables', label: 'Required posts, deliverables, and availability periods', owner: 'admin', specRef: '§16 · Required posts/deliverables and availability periods', fixedPaymentOnly: false },
  { key: 'campaign_dates', label: 'Campaign dates', owner: 'founder', specRef: '§16 · Campaign dates', fixedPaymentOnly: false },
  { key: 'ip_confidentiality_agreement', label: 'Accepted Creator-only IP and confidentiality agreement', owner: 'creator', specRef: '§16 · Accepted Creator-only IP/confidentiality agreement', fixedPaymentOnly: false },
  { key: 'campaign_terms_aup', label: 'Accepted campaign terms and AUP', owner: 'creator', specRef: '§16 · Accepted campaign terms/AUP', fixedPaymentOnly: false },
  { key: 'fixed_allocation_funded', label: 'Fully funded fixed allocation', owner: 'founder', specRef: '§16 · Fully funded fixed allocation, if applicable', fixedPaymentOnly: true },
  { key: 'connected_account_capability', label: 'Required connected-account and capability status', owner: 'creator', specRef: '§16 · Required connected-account/capability status', fixedPaymentOnly: false },
] as const;

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
  fixedPaymentApplicable: boolean;
  fixedAllocationFunded: boolean;
  connectedAccountReady: boolean;
}

export interface CreatorReadinessResult {
  canBeginWork: boolean;
  incompleteItems: ReadinessItemKey[];
  items: Array<{ key: ReadinessItemKey; complete: boolean; applicable: boolean }>;
}

function itemComplete(key: ReadinessItemKey, s: CreatorReadinessSnapshot): boolean {
  switch (key) {
    case 'campaign_approved':
      return s.campaignApproved;
    case 'final_rewards_offers':
      return s.rewardsFinal;
    case 'final_incentives_compensation':
      return s.compensationFinal;
    case 'product_brand_assets':
      return s.brandAssetsPresent;
    case 'permitted_prohibited_claims':
      return s.claimsRulesPresent;
    case 'tracking_link_record':
      return s.trackingLinkPresent;
    case 'ftc_disclosure_template':
      return s.ftcAcknowledged;
    case 'required_posts_deliverables':
      return s.deliverablesConfirmed;
    case 'campaign_dates':
      return s.campaignDatesSet;
    case 'ip_confidentiality_agreement':
      return s.ipAgreementAccepted;
    case 'campaign_terms_aup':
      return s.termsAupAccepted;
    case 'fixed_allocation_funded':
      return s.fixedAllocationFunded;
    case 'connected_account_capability':
      return s.connectedAccountReady;
  }
}

/** §16's all-or-nothing readiness. Mirrors shared `deriveCreatorReadiness`. */
export function deriveCreatorReadiness(snapshot: CreatorReadinessSnapshot): CreatorReadinessResult {
  const items = READINESS_ITEMS.map((definition) => {
    const applicable = !definition.fixedPaymentOnly || snapshot.fixedPaymentApplicable;
    return {
      key: definition.key,
      applicable,
      complete: applicable ? itemComplete(definition.key, snapshot) : true,
    };
  });
  const incompleteItems = items
    .filter((item) => item.applicable && !item.complete)
    .map((item) => item.key);
  return { canBeginWork: incompleteItems.length === 0, incompleteItems, items };
}
