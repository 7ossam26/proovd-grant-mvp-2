/**
 * Continuity for the Founder Flow reference walkthrough.
 *
 * The listing-fee pitch bypass deliberately does not fake a Stripe payment or
 * advance the campaign lifecycle in the database. Without this marker, Brand
 * Voice reads the still-pre-payment status and correctly redirects to Campaign
 * Review, accidentally skipping the reference build pages in the demo.
 *
 * Development keeps the historical default-on behaviour. A production pitch
 * build must opt in explicitly with `VITE_PITCH_DEMO=true`; test builds always
 * keep the real guards so payment assertions cannot pass through the bypass.
 */
export function resolvePitchDemoMode({
  dev,
  mode,
  flag,
}: {
  dev: boolean;
  mode: string;
  flag?: string | undefined;
}): boolean {
  if (mode === 'test') return false;
  if (flag === 'true') return true;
  return dev && flag !== 'false';
}

export const PITCH_DEMO = resolvePitchDemoMode({
  dev: import.meta.env.DEV,
  mode: import.meta.env.MODE,
  flag: import.meta.env.VITE_PITCH_DEMO,
});

const key = (campaignId: string) => `proovd:founder-reference-walkthrough:${campaignId}`;

export function startReferenceWalkthrough(campaignId: string): void {
  if (!PITCH_DEMO) return;
  window.sessionStorage.setItem(key(campaignId), '1');
}

export function isReferenceWalkthrough(campaignId: string): boolean {
  return PITCH_DEMO && window.sessionStorage.getItem(key(campaignId)) === '1';
}
