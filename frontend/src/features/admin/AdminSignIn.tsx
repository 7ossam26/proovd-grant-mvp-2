/**
 * Admin sign-in — Spec §5.1, §28.2, §5.5.
 *
 * ── Its own address, and its own shell ──────────────────────────────────────
 * This used to render INSIDE `AdminFrame`, as the signed-out branch of
 * `AdminLayout`. That put the Admin wordmark, the four section tabs, the
 * Explore control, and the environment chip on the screen of anybody who typed
 * `/admin` — signed in or not. No data leaked (every request behind it 401s),
 * but an operations chrome shown to a stranger is still telling them what
 * exists, and it made the URL lie about what was being looked at.
 *
 * So it lives at `/admin/signin` now, outside the protected layout, and renders
 * the authentication experience and nothing else. `AdminLayout` no longer has a
 * signed-out branch at all — the absence is what keeps the shell from coming
 * back.
 *
 * ── One step, since 2026-08-10 ──────────────────────────────────────────────
 * There was a second step here: password, then a TOTP code. The second factor
 * was removed by product direction (see `backend/src/auth/auth.ts`), so this is
 * one form. Nothing about the authorization changed — `requireAdmin` still
 * decides on the server whether this session may reach anything under
 * `/api/admin`, and signing in here does not make anybody an Admin.
 *
 * ── The failure message says nothing about the account ──────────────────────
 * A wrong password and an address with no account produce the same refusal.
 * That is §5.5's non-enumeration rule applied at the surface: a sign-in page
 * that distinguishes them is an account-existence oracle, and this one would
 * publish the Admin roster.
 *
 * The refusal logic is imported from the account door rather than restated —
 * two copies of "which failures are a credential decision" is how one of them
 * comes to leak.
 */

import { useState, type FormEvent } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
import { Button, Card, Field, Input } from '../../components/index.js';
import { CREDENTIAL_REFUSAL, refusalFor } from '../../surfaces/auth/refusal.js';
import { returnTo } from '../../lib/routeGuards.js';
import { invalidateSession } from '../../lib/session.js';
import { fetchAccount, signInWithPassword } from '../../surfaces/auth/api.js';

export function AdminSignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return; // No duplicate submit while one is in flight.
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email.trim(), password);
      setPassword('');

      // The cached identity is from before this sign-in. Clearing it first is
      // what stops the destination rendering against a stale "anonymous".
      invalidateSession();
      const account = await fetchAccount();

      if (account.role !== 'admin') {
        // A real session for somebody who is not an Admin. Refused here as a
        // rendering decision only — the server has been refusing them all
        // along — and refused without naming what is behind this door.
        setError(
          'That account cannot open the Proovd Admin panel. If you have a Proovd account, sign in at the main sign-in page instead.',
        );
        return;
      }

      navigate(returnTo(location.search, '/admin/founders'), { replace: true });
    } catch (caught) {
      setError(refusalFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-auth" id="admin-main">
      <section className="admin-signin" aria-labelledby="admin-signin-heading">
        {/* The wordmark, and deliberately nothing else. No section tabs, no
            Explore control, no environment chip — those belong to the
            authenticated shell and are what this page used to leak. */}
        <span className="wordmark">
          proovd<span className="adm">Admin</span>
        </span>

        <h1 id="admin-signin-heading">Sign in to Proovd Admin</h1>

        <Card>
          <form className="admin-form" onSubmit={submit} noValidate>
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

            <Button type="submit" disabled={busy || !email || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>

        <p className="admin-form__note">
          <RouterLink to="/reset-password">Reset your password</RouterLink>
        </p>
      </section>
    </main>
  );
}

export { CREDENTIAL_REFUSAL };
