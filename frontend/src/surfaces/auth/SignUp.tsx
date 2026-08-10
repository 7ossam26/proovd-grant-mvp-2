/**
 * Public Founder signup — an operator decision, rendered honestly.
 *
 * ── What this door is, and what it is not ───────────────────────────────────
 * It creates a FOUNDER account and nothing else. §5.1 seeds Admins and makes a
 * TOTP factor mandatory, and §5.3 admits Creators only through a private
 * campaign-scoped invitation — so there is no role control on this page, no
 * "I am a creator" branch, and no query parameter that changes the outcome.
 * The role is decided by the server (`auth/public-signup.ts`), which is where
 * a role decision cannot be argued with by a request body.
 *
 * Naming it "Founder" in the copy rather than offering a choice is also the
 * §33.11.4 rule: a control names its actual destination.
 *
 * ── The closed state is a state, not a rejected form (§27.1, §1.1) ──────────
 * §10 requires Terms, the Founder AUP, and the privacy policy to be accepted,
 * and a consent may cite only a PUBLISHED version. While any of the three is a
 * draft the door genuinely cannot open — so this asks the server first and
 * renders a `StatePanel` answering all six §27.1 questions, rather than
 * collecting a name, an address, and a password and refusing at the end. A form
 * that cannot succeed is worse than no form (§1.4).
 *
 * ── Three separate controls, never one (§28.4) ─────────────────────────────
 * §28.4 forbids bundling consent. Each document is its own unchecked `Option`
 * with its own link to the text, and the submit stays disabled until all three
 * are ticked. There is no "accept all", and nothing in the submit path can set
 * more than one.
 *
 * ── Signing in is the ordinary path ─────────────────────────────────────────
 * The create call mints no session on purpose. On success this signs in through
 * exactly the same `/api/auth/sign-in/email` a returning Founder uses, so there
 * is one session-issuing path in the product rather than two that can drift.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { POLICY_DOCUMENTS } from '@proovd/shared';
import {
  Button,
  Card,
  Field,
  Input,
  Link,
  Measure,
  Option,
  Section,
  StatePanel,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import {
  AccountRequestError,
  SIGNUP_POLICY_SLUGS,
  createAccount,
  fetchSignupAvailability,
  roleHome,
  signInWithPassword,
  type SignupAvailability,
  type SignupPolicySlug,
} from './api.js';

/** §10's floor, restated so the surface can refuse before a round trip. */
const MIN_PASSWORD_LENGTH = 12;

/**
 * The title and route come from the shared register the footer and the policy
 * routes already read, so a person accepts a document whose link resolves to
 * the text of that same document. A second hardcoded list here is how a
 * consent comes to name a page that no longer exists.
 */
const SIGNUP_POLICIES = SIGNUP_POLICY_SLUGS.map((slug) => {
  const doc = POLICY_DOCUMENTS.find((d) => d.slug === slug);
  if (!doc) throw new Error(`signup names a policy the register does not have: ${slug}`);
  return { slug, title: doc.title, route: doc.route };
});

type Phase =
  | { kind: 'checking' }
  | { kind: 'closed'; reason: 'policies_unpublished' | 'unavailable' }
  | { kind: 'form' }
  | { kind: 'creating' }
  /** Created, and the automatic sign-in did not land. Never a dead end. */
  | { kind: 'created_not_signed_in' };

export function SignUp() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const availability: SignupAvailability = await fetchSignupAvailability();
        if (!live) return;
        setPhase(availability.open ? { kind: 'form' } : { kind: 'closed', reason: availability.reason });
      } catch {
        if (live) setPhase({ kind: 'closed', reason: 'unavailable' });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const allAccepted = SIGNUP_POLICIES.every((p) => accepted[p.slug]);
  const complete =
    name.trim().length >= 2 &&
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    allAccepted;

  const land = useCallback(
    async (address: string, secret: string) => {
      try {
        await signInWithPassword(address, secret);
        navigate(roleHome.founder, { replace: true });
      } catch {
        // The account exists — that is the fact worth preserving. Sending them
        // to sign in by hand is a working recovery; claiming the signup failed
        // would be untrue and would invite a second attempt that now collides
        // with their own address (§1.4).
        setPhase({ kind: 'created_not_signed_in' });
      }
    },
    [navigate],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPhase({ kind: 'creating' });

    const address = email.trim().toLowerCase();
    const secret = password;

    try {
      await createAccount({
        email: address,
        password: secret,
        name: name.trim(),
        acceptedPolicySlugs: SIGNUP_POLICIES.filter((p) => accepted[p.slug]).map((p) => p.slug),
      });
      setPassword('');
      await land(address, secret);
    } catch (caught) {
      const detail = caught instanceof AccountRequestError ? caught.detail : null;
      // The server's own sentence, when it gave one. It is written to say what
      // happened and what to do next, and rewriting it here would produce two
      // vocabularies for the same refusal.
      setError(
        (detail as { message?: string } | null)?.message ??
          detail?.whatHappened ??
          'Your account could not be created. Nothing was created and nothing you entered was lost.',
      );
      setPhase({ kind: 'form' });
    }
  }

  if (phase.kind === 'checking') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Opening the signup form"
            whatHappened="Proovd is checking whether new founder accounts are being accepted right now."
            next="The form appears as soon as that comes back."
            owner="Proovd"
            nextUpdate="Within a few seconds"
            action="No action needed"
            reference="Create an account"
          />
        </Measure>
      </Section>
    );
  }

  if (phase.kind === 'closed') {
    const unpublished = phase.reason === 'policies_unpublished';
    return (
      <Section>
        <Measure>
          <StatePanel
            state={
              unpublished
                ? 'New accounts are not open yet'
                : 'Signups cannot be opened right now'
            }
            whatHappened={
              unpublished
                ? 'Creating an account means accepting our Terms, the Founder Acceptable Use Policy, and the Privacy Policy. Those documents are still with our lawyers, and we will not ask you to agree to text that is not final.'
                : 'Proovd could not check whether new accounts are being accepted. Nothing was created.'
            }
            next={
              unpublished
                ? 'Nothing is needed from you. If you have already been invited to run a campaign, use the link in your invitation email — it still works.'
                : 'Reload this page in a few minutes.'
            }
            owner="Proovd"
            nextUpdate={unpublished ? 'When the agreements are published' : 'On reload'}
            action={
              <Button tier="secondary" onClick={() => navigate('/signin')}>
                Go to sign in
              </Button>
            }
            reference="Create an account"
            getHelp={{ href: supportMailto('I would like to run a campaign on Proovd') }}
            ring
          />
        </Measure>
      </Section>
    );
  }

  if (phase.kind === 'created_not_signed_in') {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Your account is created"
            whatHappened="The account exists and your agreements are recorded. Signing you in automatically did not complete."
            next="Sign in with the email address and password you just chose."
            owner="You"
            nextUpdate="Now"
            action={
              <Button tier="primary" onClick={() => navigate('/signin')}>
                Sign in to Proovd
              </Button>
            }
            reference="Create an account"
            getHelp={{ href: supportMailto('I created an account but cannot sign in') }}
          />
        </Measure>
      </Section>
    );
  }

  const busy = phase.kind === 'creating';

  return (
    <Section>
      <div className="auth">
        <div className="auth__head">
          <h1>Create a founder account</h1>
          <p className="auth__lede">
            For founders who want to run a campaign. Creators promoting a campaign are
            invited to it directly and do not sign up here.
          </p>
        </div>

        <Card>
          <form className="auth__form" onSubmit={submit} noValidate>
            <Field label="Your name">
              <Input
                type="text"
                name="name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

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

            <Field
              label="Password"
              hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
              {...(error ? { error } : {})}
            >
              <Input
                type="password"
                name="new-password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            {/* §28.4: one control per agreement, none of them prechecked, and
                no control that sets more than one. */}
            <fieldset className="auth__consents">
              <legend>Agreements</legend>
              {SIGNUP_POLICIES.map((policy) => (
                <div className="auth__consent" key={policy.slug}>
                  <Option
                    label={`I accept the ${policy.title}`}
                    checked={accepted[policy.slug] ?? false}
                    onCheckedChange={(on: boolean) =>
                      setAccepted((prev) => ({ ...prev, [policy.slug]: on }))
                    }
                  />
                  <RouterLink to={policy.route} target="_blank" rel="noreferrer">
                    Read the {policy.title}
                  </RouterLink>
                </div>
              ))}
            </fieldset>

            <Button type="submit" disabled={busy || !complete}>
              {busy ? 'Creating your account…' : 'Create my account'}
            </Button>
          </form>
        </Card>

        <div className="auth__aside">
          <p>
            Already have an account? <RouterLink to="/signin">Sign in</RouterLink>
          </p>
          <p className="auth__note">
            Creators are invited to one specific campaign and receive a private link. If
            you were invited and cannot find yours,{' '}
            <Link href={supportMailto('I cannot find my Proovd invitation link')}>
              email support
            </Link>{' '}
            and a person will reply within one business day.
          </p>
        </div>
      </div>
    </Section>
  );
}

export type { SignupPolicySlug };
