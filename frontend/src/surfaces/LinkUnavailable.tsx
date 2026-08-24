/**
 * The one surface every token failure renders (§5.5, §28.1).
 *
 * Invalid, expired, revoked, claimed, malformed, rate-limited, and
 * never-existed all arrive here and all look identical. That is the point: a
 * page that said "this link expired" for one and "no such link" for another
 * would let anyone with a list of guesses learn which addresses and drafts are
 * real. §5.5 forbids exposing account existence, so the page tells the holder
 * what to do and tells them nothing about what went wrong.
 *
 * The screen exposes only the recovery information a link holder can use. The
 * standard brand and Help controls stay available, and the same support target
 * powers the one prominent resend action.
 */

import { StateScreen } from '../components/index.js';

export interface LinkUnavailableProps {
  /**
   * Where "Get help" goes. Defaults to the support route the API names in its
   * rejection body, so the page and the server agree without the page having to
   * read anything per-request — nothing here varies by failure mode.
   *
   * It is `/support` and not `/support/link`, which was the default until
   * 2026-08-21 and had never been a route: the only public `support` path is
   * the exact one at `routes.tsx`, and the other is inside the `admin` group.
   * Both controls below read this one value, so the dead default meant every
   * dead-link screen offered two links and both landed on the 404 surface —
   * "We don't have a page at this address" — which is the opposite of §27.1's
   * sixth question. `routes.tsx` records the same bug being fixed once before
   * for `/support` itself; this was the variant that fix did not reach.
   */
  supportHref?: string;
}

export function LinkUnavailable({ supportHref = '/support' }: LinkUnavailableProps) {
  return (
    <StateScreen
      title={<>We&rsquo;re sorry the link seems to have broken</>}
      description={
        <>We&rsquo;re still an early day startup. We&rsquo;d love to try again with you.</>
      }
      action={{ href: supportHref, label: 'Send me another link' }}
      helpHref={supportHref}
    >
      <p className="sr-only">
        Nothing is wrong with your details and nothing has been charged. No
        account details are shown on this page.
      </p>
    </StateScreen>
  );
}

export default LinkUnavailable;
