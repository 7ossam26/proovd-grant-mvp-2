/**
 * How a sign-in failure is turned into a sentence — §5.5, §1.4, §30.
 *
 * One module, because there are two sign-in addresses (`/signin` and
 * `/admin/signin`) and this is the decision it would be most dangerous to have
 * two versions of. A refusal that varies by cause is an account-existence
 * oracle; two copies of "which failures are a credential decision" is how one
 * of them acquires a helpful branch and starts publishing the roster.
 */

import { AccountRequestError } from './api.js';

/**
 * One refusal for every credential failure. Never varies by cause, and is not
 * assembled from parts — a template with a slot is a template somebody later
 * fills with the reason.
 */
export const CREDENTIAL_REFUSAL =
  'That email address and password combination was not accepted. Nothing about the account is confirmed or denied by this message.';

/**
 * Which failures are a credential decision and which are a transport problem.
 *
 * The distinction is the STATUS, deliberately, and not the error body. Better
 * Auth answers a bad credential with 401 and a body of its own shape — no
 * `title`, no `whatHappened` — so a client that decides by inspecting the body
 * classifies every real wrong password as "the server answered 401 with no
 * explanation". That is not a leak, but it is untrue (§1.4): the server
 * explained perfectly well, and the person is left thinking Proovd is broken
 * rather than that they mistyped.
 *
 * 401 and 403 are the only two answers this endpoint gives to a credential it
 * refuses; everything else — a dead connection, a 5xx, an HTML error page — is
 * a request that did not get a decision, and saying so is what stops somebody
 * retyping a correct password against a server that is down.
 *
 * The 5xx branch is real rather than theoretical: `backend/src/app.ts` answers
 * an unhandled route error with a JSON body carrying `whatHappened`, so what a
 * person reads here is the server's own account of what is and is not known.
 */
export function refusalFor(caught: unknown): string {
  if (!(caught instanceof AccountRequestError)) return CREDENTIAL_REFUSAL;
  const { status } = caught.detail;
  if (status === 401 || status === 403) return CREDENTIAL_REFUSAL;
  return caught.detail.whatHappened ?? caught.detail.title;
}
