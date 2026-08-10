/**
 * The one sign-in address — Spec §5.1, §5.2, §5.3, §5.5, §28.2, DNA §5.1.
 *
 * Until now the product had no front door. Sign-in existed twice, each time
 * embedded as a fallback inside a surface you had to already know the URL of:
 * `/admin` renders one when `/api/admin/me` refuses, and `/creator/campaigns`
 * renders another when its own read 401s. A Founder had neither — which meant
 * a Founder who claimed their account and closed the tab was locked out of a
 * product that had issued them an account.
 *
 * ── One address for every role, and it never asks which one you are ─────────
 * The obvious design is two doors ("Founder sign-in" / "Creator sign-in") and
 * it is the wrong one twice over. It puts a question in front of a person that
 * the server is about to answer anyway, and — the part that matters — a door
 * that behaves differently per role is an account-role oracle: type an address
 * into the Founder door and the refusal tells you whether it is a Creator's.
 * §5.5's non-enumeration rule is written about tokens, and the reasoning is
 * the same one. So: one form, one refusal, and `/api/account/me` decides the
 * destination once a session actually exists.
 *
 * ── The refusal never varies by cause ──────────────────────────────────────
 * A wrong password and an address with no account produce the identical
 * sentence. That is `AdminSignIn`'s rule, and it is not Admin's alone — the
 * Founder and Creator rosters are exactly as enumerable and exactly as
 * private. The decision lives in `refusal.ts` and is imported by both doors,
 * because two copies of it is how one of them acquires a helpful branch.
 *
 * ── One step, since 2026-08-10 ─────────────────────────────────────────────
 * There was a second step: for an account with a registered factor, Better
 * Auth answered the password with `twoFactorRedirect` and this surface asked
 * for a code. The Admin second factor was removed by product direction (see
 * `backend/src/auth/auth.ts`), no role has one, and the branch went with it.
 * The role still decides the DESTINATION, and the server still decides the
 * role — signing in here makes nobody an Admin.
 *
 * ── Already signed in ──────────────────────────────────────────────────────
 * This surface is wrapped in `RedirectIfAuthenticated` (see `routes.tsx`), so
 * somebody who already has a session never reaches the form. Asking a person
 * to re-enter a password they have already proved is not a security control;
 * it is a question with no consequence, and it trains people to type
 * credentials at any form that asks.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 * No "create an account" link, anywhere. §5.1 seeds Admins, §5.2 admits
 * Founders by private invitation, and §5.3 is explicit that Creators have no
 * open public signup — `disableSignUp: true` closes the HTTP route, and a link
 * offering what the server refuses is §1.4's failure with a cursor in it.
 *
 * No "Continue with Google" either, although §5.2 grants Founders Google
 * sign-in. The button is safe only once social sign-up is provably closed the
 * way `disableSignUp` closes the email one; without that, one click by an
 * uninvited visitor mints a Founder account, which is precisely what §33.2.1
 * exists to prevent. It is a real gap, recorded rather than papered over.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
import {
  Button,
  Card,
  Field,
  Input,
  Link,
  Measure,
  Section,
  StatePanel,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import {
  AccountRequestError,
  fetchAccount,
  requestPasswordReset,
  resetPassword,
  roleHome,
  signInWithPassword,
} from './api.js';
import { CREDENTIAL_REFUSAL, refusalFor } from './refusal.js';
import { returnTo } from '../../lib/routeGuards.js';
import { invalidateSession } from '../../lib/session.js';

export { CREDENTIAL_REFUSAL };

type Step =
  | { kind: 'credentials' }
  /** A session exists; `/api/account/me` decides where it belongs. */
  | { kind: 'resolving' }
  /** Signed in, but the destination could not be read. Never a dead end. */
  | { kind: 'stranded'; title: string; whatHappened: string; next: string };

export function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * The server says where this person belongs. Deliberately after the session
   * exists rather than from anything typed into the form.
   */
  const land = useCallback(async () => {
    setStep({ kind: 'resolving' });
    try {
      // The cached identity predates this sign-in. Clearing it first is what
      // stops the destination rendering against a stale "anonymous".
      invalidateSession();
      const account = await fetchAccount();
      // §3.1: the role is read to choose a route and is never rendered.
      //
      // `next` wins when it is a same-site path — that is how a guard bounce
      // returns somebody to where they were going. It is NOT trusted to be
      // reachable: if it belongs to another role, that route's own guard
      // refuses, which is the correct place for the decision.
      navigate(returnTo(location.search, roleHome[account.role]), { replace: true });
    } catch (caught) {
      const detail = caught instanceof AccountRequestError ? caught.detail : null;
      setStep({
        kind: 'stranded',
        title: 'You are signed in, but Proovd could not open your account',
        whatHappened:
          detail?.whatHappened ??
          'Your sign-in was accepted. The request that decides which part of Proovd to open did not come back.',
        next:
          detail?.next ??
          'Reload this page. Your session is still valid, so you will not be asked for your password again.',
      });
    }
  }, [navigate, location.search]);

  async function submitCredentials(event: FormEvent) {
    event.preventDefault();
    // No duplicate submit while one is in flight. The button is disabled too;
    // this is the half that survives a keyboard repeat.
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email.trim(), password);
      // Drop the credential as soon as it has been sent rather than holding it
      // in component state through the next round trip.
      setPassword('');
      await land();
    } catch (caught) {
      setError(refusalFor(caught));
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === 'resolving') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Opening your account"
            whatHappened="You are signed in. Proovd is reading which part of the product your account belongs to."
            next="The right page opens as soon as that comes back."
            owner="Proovd"
            nextUpdate="Within a few seconds"
            action="No action needed"
            reference="Sign in"
          />
        </Measure>
      </Section>
    );
  }

  if (step.kind === 'stranded') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state={step.title}
            whatHappened={step.whatHappened}
            next={step.next}
            owner="Proovd"
            nextUpdate="When you reload"
            action={
              <Button tier="primary" onClick={() => void land()}>
                Open my account
              </Button>
            }
            reference="Sign in"
            getHelp={{ href: supportMailto('Signed in but cannot reach my account') }}
            ring
          />
        </Measure>
      </Section>
    );
  }

  return (
    <Section>
      <div className="auth">
        {
          <>
            <div className="auth__head">
              <h1>Sign in to Proovd</h1>
              <p className="auth__lede">
                For founders running a campaign and creators promoting one. Use the
                email address and password you set when you created your account.
              </p>
            </div>

            <Card>
              <form className="auth__form" onSubmit={submitCredentials} noValidate>
                <Field label="Email address">
                  <Input
                    type="email"
                    name="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label="Password" {...(error ? { error } : {})}>
                  <Input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>

                <Button type="submit" disabled={busy || !email || !password}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </Button>
              </form>
            </Card>

            <div className="auth__aside">
              <p>
                <RouterLink to="/reset-password">Reset your password</RouterLink>
              </p>
              {/* §5: there is no public signup for any role, so this says where
                  an account comes from instead of offering one. */}
              <p className="auth__note">
                Proovd accounts are issued by invitation — founders are invited to
                run a campaign, creators are invited to promote a specific one. If
                you were invited and cannot find your link,{' '}
                <Link href={supportMailto('I cannot find my Proovd invitation link')}>
                  email support
                </Link>{' '}
                and a person will reply within one business day.
              </p>
            </div>
          </>
        }
      </div>
    </Section>
  );
}

/* ── §5.5's reset, on the same shell ──────────────────────────────────────── */

/**
 * One frozen acknowledgement for every outcome — a real address, an unknown
 * one, a malformed one, and a provider that refused. §5.5's rule, and the same
 * sentence shape `MAGIC_LINK_REISSUE_ACK` uses for the magic-link reissue: a
 * reply that varies is an account-existence oracle, and the one thing a sign-in
 * page must never publish is who has an account.
 */
export const RESET_ACKNOWLEDGEMENT =
  'If that email address has a Proovd account, a reset link is on its way to it. The link expires, and requesting another one replaces it.';

export function ResetPassword() {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [asked, setAsked] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The token arrives in the URL of the emailed link. Read once, held in
  // memory, never written to storage and never put back into a URL we build
  // (§28.1).
  useEffect(() => {
    const found = new URLSearchParams(window.location.search).get('token');
    if (found) setToken(found);
  }, []);

  async function ask(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    // The outcome is never inspected: whether an account was found is exactly
    // the fact this route must not leak, and a branch on it here is how the
    // leak gets reintroduced. `requestPasswordReset` resolves either way.
    await requestPasswordReset(email.trim());
    setAsked(true);
    setBusy(false);
  }

  async function set(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      setError('The two passwords do not match. Type the same one in both boxes.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token ?? '', password);
      setDone(true);
    } catch {
      // §5.5: a rejected reset token is indistinguishable from an expired,
      // revoked, already-used, or never-existed one.
      setError(
        'That reset link cannot be used. Reset links expire and can only be used once — ask for a new one and use the newest email.',
      );
    } finally {
      setBusy(false);
      setPassword('');
      setConfirmation('');
    }
  }

  if (done) {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Your password is set"
            whatHappened="The reset link was accepted and your new password is saved."
            next="Sign in with your email address and the password you just chose."
            owner="You"
            nextUpdate="Now"
            action={
              <Button tier="primary" onClick={() => navigate('/signin')}>
                Sign in to Proovd
              </Button>
            }
            reference="Password reset"
          />
        </Measure>
      </Section>
    );
  }

  return (
    <Section>
      <div className="auth">
        {token === null ? (
          <>
            <div className="auth__head">
              <h1>Reset your password</h1>
              <p className="auth__lede">
                Enter the email address on your Proovd account and we will send a
                link to set a new password.
              </p>
            </div>

            {asked ? (
              <StatePanel
                state="Check your email"
                whatHappened={RESET_ACKNOWLEDGEMENT}
                next="Open the link in that email to choose a new password."
                owner="You"
                nextUpdate="Within a few minutes"
                action={
                  <Button tier="secondary" onClick={() => navigate('/signin')}>
                    Back to sign in
                  </Button>
                }
                reference="Password reset"
                getHelp={{ href: supportMailto('I did not receive my password reset email') }}
              />
            ) : (
              <Card>
                <form className="auth__form" onSubmit={ask} noValidate>
                  <Field label="Email address">
                    <Input
                      type="email"
                      name="email"
                      autoComplete="username"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" disabled={busy || !email}>
                    {busy ? 'Sending the link…' : 'Send me a reset link'}
                  </Button>
                </form>
              </Card>
            )}

            <div className="auth__aside">
              <p>
                <RouterLink to="/signin">Back to sign in</RouterLink>
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="auth__head">
              <h1>Choose a new password</h1>
              <p className="auth__lede">
                This link is for one password change. Once you set it, the link
                stops working.
              </p>
            </div>

            <Card>
              <form className="auth__form" onSubmit={set} noValidate>
                <Field label="New password">
                  <Input
                    type="password"
                    name="new-password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <Field label="New password again" {...(error ? { error } : {})}>
                  <Input
                    type="password"
                    name="confirm-password"
                    autoComplete="new-password"
                    required
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </Field>
                <Button type="submit" disabled={busy || !password || !confirmation}>
                  {busy ? 'Saving your password…' : 'Save my new password'}
                </Button>
              </form>
            </Card>

            <div className="auth__aside">
              <p>
                <RouterLink to="/signin">Back to sign in</RouterLink>
              </p>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
