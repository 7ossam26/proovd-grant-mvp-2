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
 * private.
 *
 * The second factor is the documented exception, for `AdminSignIn`'s reason:
 * past the password a person has proved who they are, so a wrong code says so
 * plainly rather than making them retype a correct one until they lock
 * themselves out.
 *
 * ── Two steps, never two questions at once (DNA §5.1) ──────────────────────
 * §5.1 makes MFA mandatory for Admin, so Better Auth answers the password with
 * `twoFactorRedirect` rather than a session. This surface does not decide who
 * needs a factor — it renders the step the server asked for. §5.2 and §5.3
 * give the other two roles no second factor, so in practice they never see it;
 * that is a fact about their accounts, not a branch in this file.
 *
 * ── The signup link, and what it does not offer ────────────────────────────
 * There is now a public FOUNDER signup, by operator decision, and this page
 * links to it. It is deliberately described as a founder account rather than
 * as "create an account": §5.1 still seeds Admins with a mandatory TOTP factor
 * and §5.3 still admits Creators only through a private campaign-scoped
 * invitation, so a generic link would offer two of the three roles something
 * the server refuses — §1.4's failure with a cursor in it.
 *
 * No "Continue with Google" still, although §5.2 grants Founders Google
 * sign-in. Better Auth's `disableSignUp` closes the EMAIL route; the social
 * route is a separate switch, and until social sign-up is provably confined to
 * the founder role the way `auth/public-signup.ts` confines this one, one click
 * by a visitor could mint an account whose role nothing in this repo decided.
 * It is a real gap, recorded rather than papered over.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
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
  verifyTotp,
} from './api.js';

/**
 * One refusal for every credential failure. Never varies by cause, and is not
 * assembled from parts — a template with a slot is a template somebody later
 * fills with the reason.
 */
const CREDENTIAL_REFUSAL =
  'That email address and password combination was not accepted. Nothing about the account is confirmed or denied by this message.';

const CODE_REFUSAL =
  'That code was not accepted. Codes expire quickly — wait for your authenticator app to show the next one and enter that.';

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
 */
function refusalFor(caught: unknown): string {
  if (!(caught instanceof AccountRequestError)) return CREDENTIAL_REFUSAL;
  const { status } = caught.detail;
  if (status === 401 || status === 403) return CREDENTIAL_REFUSAL;
  return caught.detail.whatHappened ?? caught.detail.title;
}

type Step =
  | { kind: 'credentials' }
  | { kind: 'second_factor' }
  /** A session exists; `/api/account/me` decides where it belongs. */
  | { kind: 'resolving' }
  /** Signed in, but the destination could not be read. Never a dead end. */
  | { kind: 'stranded'; title: string; whatHappened: string; next: string };

export function SignIn() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * The server says where this person belongs. Deliberately after the session
   * exists rather than from anything typed into the form.
   */
  const land = useCallback(async () => {
    setStep({ kind: 'resolving' });
    try {
      const account = await fetchAccount();
      // §3.1: the role is read to choose a route and is never rendered.
      navigate(roleHome[account.role], { replace: true });
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
  }, [navigate]);

  async function submitCredentials(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithPassword(email.trim(), password);
      // The password is right and the session is not issued yet. Drop it here
      // rather than holding a correct credential in state through a second
      // network round trip.
      setPassword('');
      if (result.twoFactorRedirect) {
        setStep({ kind: 'second_factor' });
        return;
      }
      await land();
    } catch (caught) {
      setError(refusalFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(code.trim());
      setCode('');
      await land();
    } catch {
      setError(CODE_REFUSAL);
      setCode('');
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
        {step.kind === 'credentials' ? (
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
              <p>
                Want to run a campaign?{' '}
                <RouterLink to="/signup">Create a founder account</RouterLink>
              </p>
              {/* §5.3 keeps Creator accounts invitation-only, so this names the
                  one role the signup link actually opens and says where the
                  other comes from — rather than implying both are available. */}
              <p className="auth__note">
                Creators are invited to promote one specific campaign and receive a
                private link. If you were invited and cannot find yours,{' '}
                <Link href={supportMailto('I cannot find my Proovd invitation link')}>
                  email support
                </Link>{' '}
                and a person will reply within one business day.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="auth__head">
              <h1>Enter your authenticator code</h1>
              <p className="auth__lede">
                This account has an authenticator app registered to it. Your password
                was accepted; the code finishes signing you in.
              </p>
            </div>

            <Card>
              <form className="auth__form" onSubmit={submitCode} noValidate>
                <Field
                  label="Authenticator code"
                  hint="Six digits from the authenticator app registered to this account."
                  {...(error ? { error } : {})}
                >
                  <Input
                    type="text"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </Field>

                <Button type="submit" disabled={busy || !code}>
                  {busy ? 'Checking the code…' : 'Finish signing in'}
                </Button>
              </form>
            </Card>

            <div className="auth__aside">
              <Button
                tier="tertiary"
                onClick={() => {
                  setStep({ kind: 'credentials' });
                  setCode('');
                  setError(null);
                }}
              >
                Start again with your email address
              </Button>
            </div>
          </>
        )}
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
