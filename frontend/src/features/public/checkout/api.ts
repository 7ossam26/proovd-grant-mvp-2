/**
 * The Backer pre-order API — Spec §19, Phase 15.
 *
 * Two calls: `quote` computes the exact amounts for a reward + billing address
 * (real Stripe Tax on the server), and `submit` runs the full §19 flow and, only
 * on SetupIntent success, creates the reservation. Card data never passes
 * through here — the browser tokenizes it with Stripe.js and this sends only a
 * PaymentMethod id (§28.3).
 */

export interface QuoteRequest {
  rewardSku: string;
  billing: { country: string; postalCode: string; state?: string; city?: string; line1?: string };
}

export interface Quote {
  campaignTitle: string;
  founderLegalName: string;
  rewardSku: string;
  rewardTitle: string;
  rewardSubtotal: string;
  salesTax: string;
  totalAuthorized: string;
  chargedToday: string;
  chargeRule: string;
  chargeTimeUtc: string;
  delivery: string;
  statementDescriptor: string;
  consentAppendix: 'A.3' | 'A.4';
  consentText: string;
  marketingLabel: string;
  sharingDisclosure: string;
  cancellationPath: string;
  capacity: { capCents: string; reservedSubtotalCents: string } | null;
}

export interface PreorderRequest {
  rewardSku: string;
  contact: { email: string; phone: string };
  billing: { country: string; postalCode: string; state?: string; city?: string; line1?: string };
  ageConfirmed: boolean;
  survey: { why: string; recommend: number };
  operationalSharingAck: boolean;
  founderMarketingConsent: boolean;
  newsletterConsent: boolean;
  paymentMethodId: string;
  requestId?: string;
}

export interface PreorderSuccess {
  reservationId: string;
  campaignTitle: string;
  founderLegalName: string;
  rewardTitle: string;
  rewardSubtotal: string;
  salesTax: string;
  totalAuthorized: string;
  chargedToday: string;
  chargeRule: string;
  chargeTimeUtc: string;
  delivery: string;
  statementDescriptor: string;
  magicLinkUrl: string;
  suspectedDuplicate: boolean;
}

export interface PreorderError {
  code: string;
  message: string;
  next?: string;
  field?: string;
  clientSecret?: string | null;
}

export type QuoteResult = { ok: true; quote: Quote } | { ok: false; error: PreorderError };
export type SubmitResult = { ok: true; success: PreorderSuccess } | { ok: false; error: PreorderError };

export async function fetchQuote(campaignId: string, input: QuoteRequest): Promise<QuoteResult> {
  const res = await fetch(`/api/campaign/${campaignId}/checkout/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (res.ok) return { ok: true, quote: (await res.json()) as Quote };
  return { ok: false, error: await readError(res) };
}

export async function submitPreorder(
  campaignId: string,
  input: PreorderRequest,
): Promise<SubmitResult> {
  const res = await fetch(`/api/campaign/${campaignId}/preorder`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (res.ok) return { ok: true, success: (await res.json()) as PreorderSuccess };
  return { ok: false, error: await readError(res) };
}

async function readError(res: Response): Promise<PreorderError> {
  try {
    const body = (await res.json()) as { error?: PreorderError };
    if (body.error) return body.error;
  } catch {
    // fall through to a generic error
  }
  return { code: 'error', message: 'Something went wrong. You were not charged.' };
}
