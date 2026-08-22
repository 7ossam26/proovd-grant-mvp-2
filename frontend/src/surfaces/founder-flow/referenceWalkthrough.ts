/**
 * Local-only continuity for the Founder Flow reference walkthrough.
 *
 * The listing-fee pitch bypass deliberately does not fake a Stripe payment or
 * advance the campaign lifecycle in the database. Without this marker, Brand
 * Voice reads the still-pre-payment status and correctly redirects to Campaign
 * Review, accidentally skipping the reference build pages in the demo.
 */
export const PITCH_DEMO =
  import.meta.env.DEV &&
  import.meta.env.MODE !== 'test' &&
  import.meta.env.VITE_PITCH_DEMO !== 'false';

const key = (campaignId: string) => `proovd:founder-reference-walkthrough:${campaignId}`;

export function startReferenceWalkthrough(campaignId: string): void {
  if (!PITCH_DEMO) return;
  window.sessionStorage.setItem(key(campaignId), '1');
}

export function isReferenceWalkthrough(campaignId: string): boolean {
  return PITCH_DEMO && window.sessionStorage.getItem(key(campaignId)) === '1';
}
