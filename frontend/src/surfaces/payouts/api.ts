/**
 * The payout-onboarding client — Spec §13, §11, §32.2.
 *
 * Two bases, one shape. §13 and §11 describe the same handoff for two roles and
 * the server already knows which rules apply to which; the browser only has to
 * know which base to call.
 *
 * Nothing here sends a bank account, a tax id, or a document. There is no such
 * field in any request below, and no route on the other end that would take
 * one — §11 forbids reproducing provider-controlled fields and §5.3 says Proovd
 * stores statuses and IDs and never full bank details.
 */

import { AdminRequestError, type AdminError } from '../../features/admin/api.js';
import type { PayoutState, PayoutRole } from './PayoutOnboarding.js';

export type { PayoutState, PayoutRole };
export { AdminRequestError as PayoutRequestError };

function opaque(status: number): AdminError {
  return {
    error: 'unreachable',
    status,
    title: 'Proovd could not be reached',
    whatHappened:
      status === 0
        ? 'The request did not complete, so nothing was changed.'
        : `The server answered ${status} with no explanation.`,
    next: 'Try again in a moment. Nothing about your account has changed.',
  };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': 'application/json' } : {},
      ...init,
    });
  } catch {
    throw new AdminRequestError(opaque(0));
  }

  if (!response.ok) {
    let body: Partial<AdminError> | null = null;
    try {
      body = (await response.json()) as Partial<AdminError>;
    } catch {
      body = null;
    }
    throw new AdminRequestError(
      body?.title ? { ...(body as AdminError), status: response.status } : opaque(response.status),
    );
  }

  return (await response.json()) as T;
}

const base = (role: PayoutRole) =>
  role === 'founder' ? '/api/founder/payouts' : '/api/creator/payouts';

export const fetchPayouts = (role: PayoutRole): Promise<{ payouts: PayoutState }> =>
  call(base(role));

export const requestOnboardingLink = (
  role: PayoutRole,
): Promise<{ url: string; expiresAt: string; reused: boolean }> =>
  call(`${base(role)}/link`, { method: 'POST', body: JSON.stringify({}) });

/**
 * Stripe's landing points (§32.2). The SPA route calls this, and the server
 * re-reads the account rather than trusting the last webhook — a person who
 * finishes and lands back within the second would otherwise see the state from
 * before they started (§13).
 */
export const recordReturn = (
  role: PayoutRole,
  event: 'returned' | 'refreshed',
): Promise<{ payouts: PayoutState }> =>
  call(`${base(role)}/return`, { method: 'POST', body: JSON.stringify({ event }) });
