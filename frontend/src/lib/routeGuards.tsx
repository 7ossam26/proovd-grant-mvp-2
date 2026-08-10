/**
 * Render-time route guards — §1.1, §5, §27.1.
 *
 * Two components, one rule each, and neither of them is the security boundary
 * (see the header of `session.ts`). They exist so that what a person SEES is
 * deterministic instead of accidental:
 *
 *   `RequireRole`   nothing protected renders until the server has said who
 *                   this is and the role is one this area admits.
 *   `RedirectIfAuthenticated`
 *                   a sign-in page never shows a credential form to somebody
 *                   who already has a session.
 *
 * ── Why "signed in but not allowed" is not "signed out" ─────────────────────
 * A Founder who opens an Admin address gets a refusal that says so, not a
 * sign-in form. Showing a form would ask them to prove an identity they have
 * already proved and cannot change by proving again — §27.1's "what can I do
 * now" answered with a control that does nothing. It is also the difference
 * between "you cannot see this" and "we do not know who you are", and only one
 * of those is true.
 */

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Button, Measure, Section, StatePanel } from '../components/index.js';
import { supportMailto } from '../features/public/states.js';
import { useSession, roleHome, type AccountRole } from './session.js';

/**
 * The address to come back to after signing in, as a query parameter.
 *
 * Path + search only, never a full URL and never anything from the current
 * query string: a `next` that accepted an absolute address is an open redirect,
 * and one that echoed an attacker-supplied parameter is the same hole with an
 * extra step. `returnTo` below re-reads it with the same restriction.
 */
export function signInHref(base: string, pathname: string, search: string): string {
  return `${base}?next=${encodeURIComponent(`${pathname}${search}`)}`;
}

/** The `next` parameter, if it is a same-site path. Otherwise null. */
export function returnTo(search: string, fallback: string): string {
  const raw = new URLSearchParams(search).get('next');
  // Must start with a single `/`. `//host` and `/\host` are protocol-relative
  // and would leave the site; anything with a scheme obviously would too.
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return fallback;
  }
  return raw;
}

interface RequireRoleProps {
  allow: readonly AccountRole[];
  /** Where an unauthenticated visitor is sent to sign in. */
  signInPath: string;
  children: ReactNode;
}

export function RequireRole({ allow, signInPath, children }: RequireRoleProps) {
  const { session } = useSession();
  const location = useLocation();

  if (session.status === 'loading') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Checking your session"
            whatHappened="Proovd is confirming who you are before showing anything."
            next="The page appears as soon as that comes back."
            owner="Proovd"
            nextUpdate="Within a few seconds"
            action="No action needed"
            reference="Sign in"
          />
        </Measure>
      </Section>
    );
  }

  if (session.status === 'unavailable') {
    // Not a sign-in prompt. The session could not be READ, which is not the
    // same as there not being one, and asking for a password here would ask
    // somebody to retype a credential that cannot fix a server being down.
    return (
      <Section>
        <Measure>
          <StatePanel
            state={session.title}
            whatHappened={session.whatHappened}
            next={session.next}
            owner="Proovd"
            nextUpdate="When you reload"
            action={
              <Button tier="primary" onClick={() => window.location.reload()}>
                Try again
              </Button>
            }
            reference="Sign in"
            getHelp={{ href: supportMailto('I cannot tell whether I am signed in') }}
            ring
          />
        </Measure>
      </Section>
    );
  }

  if (session.status === 'anonymous') {
    return (
      <Navigate
        to={signInHref(signInPath, location.pathname, location.search)}
        replace
      />
    );
  }

  if (!allow.includes(session.account.role)) {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="This area is not available to your account"
            whatHappened="You are signed in, and this part of Proovd belongs to a different kind of account."
            // §3.1: the internal role name is never rendered, and the refusal
            // names no other area — a message that said which one would tell a
            // stranger what else exists.
            next="If you think it should be available to you, contact support and a person will check."
            owner="Proovd"
            nextUpdate="Within one business day"
            action={
              <Button
                tier="primary"
                onClick={() => {
                  window.location.assign(roleHome[session.account.role]);
                }}
              >
                Go to my account
              </Button>
            }
            reference="Access"
            getHelp={{ href: supportMailto('I cannot reach a part of Proovd I expected to') }}
            ring
          />
        </Measure>
      </Section>
    );
  }

  return <>{children}</>;
}

interface RedirectIfAuthenticatedProps {
  /** Rendered only for a visitor with no session. */
  children: ReactNode;
  /**
   * Where an already-signed-in person goes instead.
   *
   * `next` is the validated same-site return path, or null when there was none
   * — validated by `returnTo` before it reaches here, so a caller cannot be
   * tricked into honouring an off-site address.
   *
   * Each sign-in page decides whether to honour it, because the right answer
   * differs: the Admin door must send a Founder to the Founder home even when
   * `next` points into `/admin`, or an authenticated non-Admin bounces to a
   * page that will only refuse them. Defaults to the role's own home.
   */
  destinationFor?: (role: AccountRole, next: string | null) => string;
}

export function RedirectIfAuthenticated({
  children,
  destinationFor,
}: RedirectIfAuthenticatedProps) {
  const { session } = useSession();
  const location = useLocation();

  if (session.status === 'loading') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Checking your session"
            whatHappened="Proovd is checking whether you are already signed in."
            next="The sign-in form appears if you are not."
            owner="Proovd"
            nextUpdate="Within a few seconds"
            action="No action needed"
            reference="Sign in"
          />
        </Measure>
      </Section>
    );
  }

  // A session that cannot be READ is treated as no session, deliberately and
  // only here: the cost is showing the sign-in form to somebody who is already
  // signed in, which wastes a moment. The opposite default would lock a person
  // out of the sign-in page during an outage, which is the one page they need
  // when things are going wrong.
  if (session.status === 'authenticated') {
    const role = session.account.role;
    const home = roleHome[role];
    // `returnTo` returns the fallback when `next` is absent or off-site, so
    // comparing against it is how "was there a usable next?" is decided
    // without a second copy of the validation.
    const validated = returnTo(location.search, home);
    const next = validated === home ? null : validated;
    return (
      <Navigate to={destinationFor ? destinationFor(role, next) : (next ?? home)} replace />
    );
  }

  return <>{children}</>;
}
