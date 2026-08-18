/**
 * Screen 16 — Your details, and the account — Founder Flow v2, Session D.
 *
 * The last surface before an account exists, the first one that asks for
 * something, and the boundary the whole flow turns on: everything before it is
 * the draft token and everything after it is a Founder session.
 *
 * ── `completeClaim` is not split, reordered, or made partial ────────────────
 * One transaction: the `founder_signup_complete` idempotency key claimed first,
 * `claimDraft` inside it, the conditional `vetting_submitted → account_claimed`
 * UPDATE, the policy consents, the audit row. Better Auth account creation
 * stays outside and BEFORE it, for the reason `claim.ts` states — a leftover
 * account is recoverable by clicking the link again, and a claimed draft with
 * no account strands somebody behind a dead link. This session rebuilt the
 * screen and changed none of that.
 *
 * ── Every prefilled field is editable and says where it came from ───────────
 * §10: "prefilled from invitation/discovery and every prefilled field is
 * editable", and every one "stores whether Proovd or Founder supplied the
 * current value". The provenance line under each control is the visible half of
 * that record — it turns a prefilled box from a presumption into an offer.
 *
 * ── The consents are separate, unchecked controls, never one ────────────────
 * §28.4: "No dark pattern, preselection, or bundling of optional consent", and
 * "18+ confirmation is required and unchecked". Each agreement and each
 * representation is its own control, starts off, and is sent as its own field.
 * There is no "accept all" here and no path that sets more than one from a
 * single flag.
 *
 * ── The agreements are drafts, so this refuses in the open ──────────────────
 * All eight §31.4 documents are `draft`, a `policy_consents` row may cite only
 * a PUBLISHED version (a trigger, not a service rule), and so `completeClaim`
 * returns `policies_unpublished`. The claim control is not rendered at all and
 * the screen says why. That is the correct state, not a bug to route around: do
 * not write policy prose, do not stub a consent, do not accept a draft.
 *
 * ── Signing in afterwards is the browser doing what a person would ──────────
 * §10's successful claim creates the account and invalidates the token; it does
 * not mention a session, and `completeClaim` issues none. The flow continues
 * into `requireRole('founder')` territory, so somebody has to sign in. Rather
 * than add a second session-minting path to the most carefully guarded
 * transaction in the product, this posts the password the Founder just chose to
 * `/api/auth/sign-in/email` — the real route, with its real rate limit, its
 * real origin guard, and no new server code at all. It buys no access the
 * password itself would not: whoever set it can sign in with it. If it fails,
 * the ACCOUNT still exists and the screen says exactly that rather than
 * implying the claim was lost.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import {
  FLOW_CLAIM_USES_THE_LINK,
  founderFlowPath,
} from '@proovd/shared';
import {
  Button,
  Card,
  Field,
  Input,
  Option,
  StatePanel,
  Tag,
  NO_ACTION,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { describeSaveState } from '../../lib/autosave.js';
import { invalidateSession } from '../../lib/session.js';
import { signInWithPassword } from '../auth/api.js';
import { useAutosave } from '../../lib/useAutosave.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import {
  completeClaim,
  fetchClaim,
  saveClaim,
  DraftRequestError,
  type ClaimPatch,
  type ClaimPolicy,
  type ClaimProfileState,
} from '../draft/api.js';
import { DateOfBirthField } from './DateOfBirthField.js';
import { FlowPage, useFlowNav } from './FlowPage.js';

interface Draft {
  legalName: string;
  preferredName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  country: string;
  stateRegion: string;
  soleProprietor: boolean | null;
  businessName: string;
  businessEntityType: string;
}

/** §10's three representations. Three controls, three fields, three records. */
const REPRESENTATIONS = [
  {
    key: 'representationUsPerson' as const,
    label: 'I am a US person and my business, if I have one, is based in the US.',
  },
  { key: 'representationAge18Plus' as const, label: 'I am 18 or older.' },
  {
    key: 'representationSanctions' as const,
    label: 'I am not on any sanctions list, and I am not acting for anyone who is.',
  },
];

export function ClaimStep() {
  const { token = '' } = useParams();
  const [profile, setProfile] = useState<ClaimProfileState | null>(null);
  const [policies, setPolicies] = useState<ClaimPolicy[]>([]);
  const [initial, setInitial] = useState<Draft | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchClaim(token)
      .then((view) => {
        if (cancelled) return;
        const f = view.profile.fields;
        setProfile(view.profile);
        setPolicies(view.policies);
        setInitial({
          legalName: f.legalName.value ?? '',
          preferredName: f.preferredName.value ?? '',
          email: f.email.value ?? '',
          phone: f.phone.value ?? '',
          dateOfBirth: f.dateOfBirth.value ?? '',
          country: f.country.value ?? '',
          stateRegion: f.stateRegion.value ?? '',
          soleProprietor: view.profile.soleProprietor,
          businessName: f.businessName.value ?? '',
          businessEntityType: f.businessEntityType.value ?? '',
        });
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (unavailable) return <LinkUnavailable />;
  if (!initial || !profile) {
    return <SurfaceLoading subject="your details" reference="Your invitation link" />;
  }

  return (
    <FlowPage pageId="claim" param={token} badge>
      <Body token={token} profile={profile} policies={policies} initial={initial} />
    </FlowPage>
  );
}

/** Split from the loader so `useFlowNav` — only available under `FlowPage` — is. */
function Body({
  token,
  profile,
  policies,
  initial,
}: {
  token: string;
  profile: ClaimProfileState;
  policies: ClaimPolicy[];
  initial: Draft;
}) {
  const { leave } = useFlowNav();

  const [draft, setDraft] = useState<Draft>(initial);
  const [password, setPassword] = useState('');
  const [reps, setReps] = useState({
    usPerson: profile.representations.usPerson,
    age18Plus: profile.representations.age18Plus,
    sanctions: profile.representations.sanctions,
  });
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState<string | null>(null);
  const [error, setError] = useState<{
    title: string;
    what: string;
    next: string;
    missing?: string[];
  } | null>(null);

  const autosave = useAutosave<ClaimPatch>(
    useCallback((patch: ClaimPatch) => saveClaim(token, patch), [token]),
  );

  const unpublished = policies.filter((policy) => policy.status !== 'published');

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    autosave.queue(patch as ClaimPatch);
  }

  function updateRep(key: (typeof REPRESENTATIONS)[number]['key'], value: boolean) {
    const map = {
      representationUsPerson: 'usPerson',
      representationAge18Plus: 'age18Plus',
      representationSanctions: 'sanctions',
    } as const;
    setReps((current) => ({ ...current, [map[key]]: value }));
    autosave.queue({ [key]: value } as ClaimPatch);
  }

  async function claim() {
    setError(null);
    setBusy(true);
    try {
      await autosave.flush();
      const result = await completeClaim(token, {
        password,
        acceptedPolicySlugs: policies.filter((policy) => accepted[policy.slug]).map((p) => p.slug),
      });

      // The account exists and the invitation link is now dead. From here every
      // outcome is about the SESSION, and none of them undoes the claim.
      try {
        await signInWithPassword(draft.email, password);
        invalidateSession();
        leave(founderFlowPath('visuals', result.campaignId), 1);
      } catch {
        setSignedOut(result.campaignId);
      }
    } catch (err) {
      const detail =
        err instanceof DraftRequestError
          ? err.detail
          : { title: 'Proovd could not be reached', whatHappened: undefined, next: undefined };
      const missing = (detail as unknown as { missing?: unknown }).missing;
      setError({
        title: detail.title,
        what:
          detail.whatHappened ??
          'The request did not complete, so no account was created and nothing you entered was lost.',
        next: detail.next ?? 'Everything is still here. Try again.',
        ...(Array.isArray(missing)
          ? { missing: missing.filter((m): m is string => typeof m === 'string') }
          : {}),
      });
      setBusy(false);
    }
  }

  if (signedOut) {
    return (
      <div className="ff-claim">
        <StatePanel
          state="Your account is set up"
          whatHappened="Your Proovd account exists and your campaign is attached to it. We could not sign you in automatically just now, which changes nothing about the account itself. Your invitation link has been used and will not work again — that is deliberate."
          next="Sign in with the email and password you just chose, and you will land back where you were."
          owner="You"
          nextUpdate="As soon as you sign in"
          action="Sign in"
          reference={signedOut}
          getHelp={{ href: supportMailto('Question about my new Proovd account') }}
          ring
        />
        <div className="ff-nav">
          <Button tier="primary" href="/signin">
            Go to sign in
          </Button>
        </div>
      </div>
    );
  }

  const allAccepted = policies.length > 0 && policies.every((policy) => accepted[policy.slug]);
  const allRepresented = reps.usPerson && reps.age18Plus && reps.sanctions;
  const ready =
    unpublished.length === 0 &&
    allAccepted &&
    allRepresented &&
    password.length >= 12 &&
    draft.legalName.trim() !== '' &&
    draft.email.trim() !== '' &&
    draft.dateOfBirth.trim() !== '' &&
    draft.country.trim() !== '' &&
    draft.stateRegion.trim() !== '' &&
    draft.soleProprietor !== null &&
    (draft.soleProprietor || draft.businessName.trim() !== '');

  return (
    <div className="ff-claim">
      <h1 className="ff-claim__head" data-anim="head">
        Good to have you.
      </h1>
      <p className="ff-claim__lede" data-anim="sub">
        The last of what we need before your account exists. We filled in what your invitation and
        our conversation told us — change anything that is not right.
      </p>
      <span
        className="ff-confirm__status"
        role="status"
        aria-live="polite"
        data-state={autosave.state.status}
      >
        {describeSaveState(autosave.state)}
      </span>

      <section className="ff-claim__block" aria-labelledby="ff-claim-you" data-anim="field">
        <h2 id="ff-claim-you">You</h2>

        <Field label="Legal name" id="ff-claim-name">
          <Input
            type="text"
            autoComplete="name"
            value={draft.legalName}
            onChange={(event) => update({ legalName: event.target.value })}
          />
        </Field>
        <Provenance field={profile.fields.legalName} />

        <Field
          label="Preferred name"
          hint="What we call you in email and on your campaign."
          id="ff-claim-preferred"
        >
          <Input
            type="text"
            value={draft.preferredName}
            onChange={(event) => update({ preferredName: event.target.value })}
          />
        </Field>
        <Provenance field={profile.fields.preferredName} />

        <Field
          label="Email"
          hint="This is where everything about your campaign goes."
          id="ff-claim-email"
        >
          <Input
            type="email"
            autoComplete="email"
            value={draft.email}
            onChange={(event) => update({ email: event.target.value })}
          />
        </Field>
        {/* §5.2. The invitation establishes ownership of the address it went to
            and of nothing else; the six-digit code (Session C) is the one thing
            that can establish it for an address the Founder typed. */}
        <p className="ff-claim__provenance">
          {profile.emailOwnership === 'code_verified' ? (
            <>
              <Tag variant="mint">Confirmed</Tag> You entered the code we sent to this address.
            </>
          ) : profile.emailOwnership === 'invited_link' ? (
            <>
              <Tag variant="mint">From your invitation</Tag> We sent your link to this address,
              which is how we know it is yours.
            </>
          ) : (
            <>
              <Tag variant="moss">Not confirmed</Tag> You changed this. We have not checked that
              this address reaches you, and we will say so on your record.
            </>
          )}
        </p>

        <Field
          label="Phone"
          hint="So support can reach you if something urgent happens with money."
          id="ff-claim-phone"
        >
          <Input
            type="tel"
            autoComplete="tel"
            value={draft.phone}
            onChange={(event) => update({ phone: event.target.value })}
          />
        </Field>
        {/* §5.2, §33.1.8: collected, never verified. There is no code to send to
            it and no control here that could add one. */}
        <p className="ff-claim__provenance">
          <Tag variant="default">Unverified</Tag> We never send codes to this number and we never
          use it to sign you in.
        </p>

        <DateOfBirthField
          value={draft.dateOfBirth}
          onChange={(next) => update({ dateOfBirth: next })}
        />

        <Field label="Country" id="ff-claim-country">
          <Input
            type="text"
            autoComplete="country-name"
            value={draft.country}
            onChange={(event) => update({ country: event.target.value })}
          />
        </Field>

        <Field label="State" id="ff-claim-state">
          <Input
            type="text"
            autoComplete="address-level1"
            value={draft.stateRegion}
            onChange={(event) => update({ stateRegion: event.target.value })}
          />
        </Field>
      </section>

      <section className="ff-claim__block" aria-labelledby="ff-claim-business" data-anim="field">
        <h2 id="ff-claim-business">Your business</h2>
        <p className="ff-claim__hint">
          Whoever sells to your Backers is the seller of record. If that is just you, say so — it
          is a normal answer.
        </p>
        <div className="ff-claim__choice">
          <Option
            label="I am a sole proprietor — there is no separate company."
            checked={draft.soleProprietor === true}
            onCheckedChange={(on) => update({ soleProprietor: on ? true : null })}
          />
          <Option
            label="I have a company or other entity."
            checked={draft.soleProprietor === false}
            onCheckedChange={(on) => update({ soleProprietor: on ? false : null })}
          />
        </div>

        {draft.soleProprietor === false ? (
          <>
            <Field label="Business name" id="ff-claim-business-name">
              <Input
                type="text"
                value={draft.businessName}
                onChange={(event) => update({ businessName: event.target.value })}
              />
            </Field>
            <Field
              label="Entity type"
              hint="LLC, corporation, partnership — whatever it says on the filing."
              id="ff-claim-entity"
            >
              <Input
                type="text"
                value={draft.businessEntityType}
                onChange={(event) => update({ businessEntityType: event.target.value })}
              />
            </Field>
          </>
        ) : null}
      </section>

      <section className="ff-claim__block" aria-labelledby="ff-claim-password" data-anim="field">
        <h2 id="ff-claim-password">How you sign in</h2>
        <Field
          label="Choose a password"
          hint="At least 12 characters. Nothing else about it is prescribed — length is what matters."
          error={
            password !== '' && password.length < 12
              ? 'That is shorter than 12 characters.'
              : undefined
          }
          id="ff-claim-password-input"
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {/* The one value on this page that is never autosaved. §28.2 keeps
            sensitive values out of anything at rest, and a half-filled account
            draft is at rest. */}
        <p className="ff-claim__hint">
          This is the only thing on this page we do not save as you type. It reaches us once, when
          you create the account.
        </p>
      </section>

      <section className="ff-claim__block" aria-labelledby="ff-claim-agreements" data-anim="field">
        <h2 id="ff-claim-agreements">What you are agreeing to</h2>

        {unpublished.length > 0 ? (
          <StatePanel
            state="We cannot create your account yet"
            whatHappened={
              <>
                The agreements you would be accepting are still with our lawyers. We will not ask
                you to sign something that is not final, so this last step stays closed.{' '}
                <strong>
                  Everything you have entered is saved and no account has been created.
                </strong>
              </>
            }
            next="We will email you the moment it opens. There is nothing for you to do."
            owner="Proovd"
            nextUpdate="When the documents are published"
            action={NO_ACTION}
            reference={profile.campaignId}
            getHelp={{ href: supportMailto('Question about my Proovd account setup') }}
            ring
          />
        ) : (
          <div className="ff-claim__consents">
            {policies.map((policy) => (
              <div className="ff-claim__consent" key={policy.slug}>
                <Option
                  label={`I accept the ${policy.title}${policy.version ? ` (version ${policy.version})` : ''}.`}
                  checked={accepted[policy.slug] === true}
                  onCheckedChange={(on) =>
                    setAccepted((current) => ({ ...current, [policy.slug]: on }))
                  }
                />
                {policy.route ? (
                  <a href={policy.route} target="_blank" rel="noreferrer">
                    Read the {policy.title}
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="ff-claim__block" aria-labelledby="ff-claim-reps" data-anim="field">
        <h2 id="ff-claim-reps">What you are confirming</h2>
        <div className="ff-claim__consents">
          {REPRESENTATIONS.map((rep) => {
            const map = {
              representationUsPerson: reps.usPerson,
              representationAge18Plus: reps.age18Plus,
              representationSanctions: reps.sanctions,
            } as const;
            return (
              <Option
                key={rep.key}
                label={rep.label}
                checked={map[rep.key]}
                onCheckedChange={(on) => updateRep(rep.key, on)}
              />
            );
          })}
        </div>
      </section>

      {error ? (
        <StatePanel
          state={error.title}
          whatHappened={
            error.missing && error.missing.length > 0
              ? `${error.what} Still needed: ${error.missing.join(', ')}.`
              : error.what
          }
          next={error.next}
          owner="You"
          nextUpdate="When you try again"
          action={NO_ACTION}
          reference={profile.campaignId}
          ring
        />
      ) : null}

      {unpublished.length === 0 ? (
        <Card className="ff-claim__actions" data-anim="cta">
          <Button tier="primary" disabled={!ready || busy} onClick={() => void claim()}>
            {busy ? 'Creating your account…' : 'Create my account'}
          </Button>
          <p className="ff-claim__hint">{FLOW_CLAIM_USES_THE_LINK}</p>
        </Card>
      ) : null}

      <p className="ff-claim__fine">
        Proovd will never ask you for your bank details, tax details, password, or identity
        documents by email.
      </p>
    </div>
  );
}

/**
 * §10's provenance, made visible.
 *
 * "Every prefilled field stores whether Proovd or Founder supplied the current
 * value." Showing it is what turns a prefilled box from a presumption into an
 * offer the Founder can decline.
 */
function Provenance({
  field,
}: {
  field: ClaimProfileState['fields'][keyof ClaimProfileState['fields']];
}) {
  if (field.prefilled === null) return null;
  return (
    <p className="ff-claim__provenance">
      {field.supplier === 'proovd' ? (
        <>
          <Tag variant="mint">From your invitation</Tag> This is what we had. Change it if it is
          wrong.
        </>
      ) : (
        <>
          <Tag variant="moss">You changed this</Tag> We had &ldquo;{field.prefilled}&rdquo;.
        </>
      )}
    </p>
  );
}
