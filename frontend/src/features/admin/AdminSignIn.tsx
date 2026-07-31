/**
 * Admin sign-in — Spec §5.1, §28.2.
 *
 * Two steps, because §5.1 makes them two facts: "Email/password authentication
 * and MFA are mandatory." The password alone never produces a session for an
 * enrolled Admin — Better Auth answers the first request with
 * `twoFactorRedirect` — so this surface asks for the code as a separate moment
 * rather than pretending one form does both (DNA §5.1: one question per
 * moment).
 *
 * ── The failure message says nothing about the account ──────────────────────
 * A wrong password and an address with no account produce the same refusal.
 * That is §5.5's non-enumeration rule applied at the surface: a sign-in page
 * that distinguishes them is an account-existence oracle, and no amount of
 * helpfulness is worth publishing the Admin roster.
 *
 * This is *not* the token surface's silence, though. Once past the password,
 * an Admin has proved who they are, so a wrong TOTP code says so plainly —
 * hiding it would just make them retype a correct code until they locked
 * themselves out.
 */

import { useState, type FormEvent } from 'react';
import { Button, Field, Input } from '../../components/index.js';
import { signInWithPassword, verifyTotp, AdminRequestError } from './api.js';

/** One refusal for every credential failure. Never varies by cause. */
const CREDENTIAL_REFUSAL =
  'That email address and password combination was not accepted. Nothing about the account is confirmed or denied by this message.';

type Step = 'credentials' | 'second_factor';

interface AdminSignInProps {
  /** Called once a full session exists. The shell re-checks with the server. */
  onSignedIn: () => void;
}

export function AdminSignIn({ onSignedIn }: AdminSignInProps) {
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitCredentials(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithPassword(email.trim(), password);
      if (result.twoFactorRedirect) {
        setStep('second_factor');
        setPassword('');
        return;
      }
      // A session without a second factor belongs to an account that has not
      // enrolled one. The shell's next `/api/admin/me` is what refuses it —
      // this surface does not decide access.
      onSignedIn();
    } catch (caught) {
      setError(
        caught instanceof AdminRequestError && caught.detail.error === 'unreachable'
          ? (caught.detail.whatHappened ?? caught.detail.title)
          : CREDENTIAL_REFUSAL,
      );
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
      onSignedIn();
    } catch {
      setError(
        'That code was not accepted. Codes expire quickly — wait for your authenticator app to show the next one and enter that.',
      );
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-signin" aria-labelledby="admin-signin-heading">
      <h1 id="admin-signin-heading">Sign in to Proovd Admin</h1>

      {step === 'credentials' ? (
        <form className="admin-form" onSubmit={submitCredentials} noValidate>
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
          <Field label="Password">
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}

          <p className="admin-form__note">
            Admin accounts require an authenticator app. After your password, Proovd asks
            for a code.
          </p>

          <Button type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Continue'}
          </Button>
        </form>
      ) : (
        <form className="admin-form" onSubmit={submitCode} noValidate>
          <Field
            label="Authenticator code"
            hint="Six digits from the authenticator app registered to this account."
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

          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Sign in'}
          </Button>
          <Button
            tier="tertiary"
            type="button"
            onClick={() => {
              setStep('credentials');
              setCode('');
              setError(null);
            }}
          >
            Start again
          </Button>
        </form>
      )}
    </section>
  );
}
