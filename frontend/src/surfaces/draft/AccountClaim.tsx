/**
 * The Founder account claim — Spec §10, §5.2, §28.4, §33.1.8, §33.1.9.
 *
 * The last surface before an account exists, and the first one that asks for
 * something. §10 lists what it contains; §28.4 fixes how the consents behave;
 * §5.2 fixes what the phone number is and is not.
 *
 * ── Every prefilled field is editable, and says where it came from ──────────
 * §10: "prefilled from invitation/discovery and every prefilled field is
 * editable", and every one "stores whether Proovd or Founder supplied the
 * current value". So each prefilled control carries a small provenance line
 * that flips as soon as the Founder changes it. Not decoration — it is the
 * visible half of a record §25.5 requires the Founder record to keep.
 *
 * ── The consents are three unchecked controls, never one ────────────────────
 * §28.4: "No dark pattern, preselection, or bundling of optional consent", and
 * "18+ confirmation is required and unchecked". Each agreement and each
 * representation is its own control, starts off, and is sent as its own field.
 * There is no "accept all".
 *
 * ── Phone (§33.1.8) ────────────────────────────────────────────────────────
 * Collected and labelled unverified, in those words. There is no "verify"
 * control, no code entry, and no path in this file that could add one.
 *
 * ── When the agreements are not published ───────────────────────────────────
 * The claim control is not rendered at all and the surface says why. §31.4
 * forbids a placeholder or a summary standing in for a policy document; asking
 * someone to accept text that is still with the lawyers records agreement to
 * nothing. This is the honest state, not a bug to route around.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import {
  Button,
  Card,
  Field,
  Input,
  Measure,
  Option,
  Section,
  StatePanel,
  Tag,
} from '../../components/index.js';
import { describeSaveState } from '../../lib/autosave.js';
import { supportMailto } from '../../features/public/states.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { useAutosave } from '../../lib/useAutosave.js';
import {
  fetchClaim,
  saveClaim,
  completeClaim,
  DraftRequestError,
  type ClaimPatch,
  type ClaimPolicy,
  type ClaimProfileState,
} from './api.js';

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

const REPRESENTATIONS = [
  {
    key: 'representationUsPerson' as const,
    label: 'I am a US person and my business, if I have one, is based in the US.',
  },
  { key: 'representationAge18Plus' as const, label: 'I am 18 or older.' },
  {
    key: 'representationSanctions' as const,
    label:
      'I am not on any sanctions list, and I am not acting for anyone who is.',
  },
];

export function AccountClaim() {
  const { token = '' } = useParams();

  const [profile, setProfile] = useState<ClaimProfileState | null>(null);
  const [policies, setPolicies] = useState<ClaimPolicy[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const [password, setPassword] = useState('');
  const [reps, setReps] = useState({ usPerson: false, age18Plus: false, sanctions: false });
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});

  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [error, setError] = useState<{
    title: string;
    what: string;
    next: string;
    missing?: string[];
  } | null>(null);

  const autosave = useAutosave<ClaimPatch>(
    useCallback((patch: ClaimPatch) => saveClaim(token, patch), [token]),
  );

  useEffect(() => {
    let cancelled = false;
    fetchClaim(token)
      .then((view) => {
        if (cancelled) return;
        setProfile(view.profile);
        setPolicies(view.policies);
        const f = view.profile.fields;
        setDraft({
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
        setReps({
          usPerson: view.profile.representations.usPerson,
          age18Plus: view.profile.representations.age18Plus,
          sanctions: view.profile.representations.sanctions,
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

  if (claimed) {
    return (
      <Section>
        <Measure>
          <h1>Your Proovd account is set up</h1>
          <StatePanel
            state="Account created"
            whatHappened="Your account exists and your campaign record is attached to it. Everything you wrote is kept. Your invitation link has been used and will not work again — that is deliberate."
            next="We are preparing the next step. When it is ready you will get an email telling you what it needs and how long it takes."
            owner="Proovd"
            nextUpdate="Within one business day"
            action="No action needed"
            reference={profile?.campaignId ?? 'Your campaign'}
            getHelp={{ href: supportMailto('Question about my new Proovd account') }}
          />
        </Measure>
      </Section>
    );
  }

  if (!draft || !profile) {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Opening your details"
            whatHappened="We're finding what we already know about you. No account exists yet and nothing has been charged."
            next="This appears in a moment."
            owner="Proovd"
            nextUpdate="Within a few seconds"
            action="No action needed"
            reference="Your invitation link"
          />
        </Measure>
      </Section>
    );
  }

  const unpublished = policies.filter((p) => p.status !== 'published');
  const statusLine = describeSaveState(autosave.state);

  function update(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
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
    setClaiming(true);
    try {
      await autosave.flush();
      await completeClaim(token, {
        password,
        acceptedPolicySlugs: policies.filter((p) => accepted[p.slug]).map((p) => p.slug),
      });
      setClaimed(true);
    } catch (err) {
      const detail =
        err instanceof DraftRequestError
          ? err.detail
          : { title: 'Proovd could not be reached', whatHappened: undefined, next: undefined };
      // `missing` is the server's list of what is still needed. It is named
      // rather than counted so the Founder is not left hunting (§27.1).
      const missing = (detail as unknown as { missing?: unknown }).missing;
      setError({
        title: detail.title,
        what:
          detail.whatHappened ??
          'The request did not complete, so no account was created and nothing you entered was lost.',
        next: detail.next ?? 'Everything is still here. Try again.',
        ...(Array.isArray(missing) ? { missing: missing.filter((m): m is string => typeof m === 'string') } : {}),
      });
    } finally {
      setClaiming(false);
    }
  }

  const allAccepted = policies.length > 0 && policies.every((p) => accepted[p.slug]);
  const allRepresented = reps.usPerson && reps.age18Plus && reps.sanctions;
  const canClaim =
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
    <Section>
      <Measure>
        <h1>Set up your Proovd account</h1>
        <p className="lede">
          We filled in what your invitation and our conversation told us. Change anything
          that is not right — all of it is yours to edit.
        </p>
        <span
          className="vetting__status"
          role="status"
          aria-live="polite"
          data-state={autosave.state.status}
        >
          {statusLine}
        </span>

        <section aria-labelledby="claim-you">
          <h2 id="claim-you">You</h2>

          <Field label="Legal name" id="claim-legal-name">
            <Input
              type="text"
              autoComplete="name"
              value={draft.legalName}
              onChange={(e) => update({ legalName: e.target.value })}
            />
          </Field>
          <Provenance field={profile.fields.legalName} />

          <Field
            label="Preferred name"
            hint="What we call you in email and on your campaign."
            id="claim-preferred-name"
          >
            <Input
              type="text"
              value={draft.preferredName}
              onChange={(e) => update({ preferredName: e.target.value })}
            />
          </Field>
          <Provenance field={profile.fields.preferredName} />

          <Field
            label="Email"
            hint="This is where everything about your campaign goes."
            id="claim-email"
          >
            <Input
              type="email"
              autoComplete="email"
              value={draft.email}
              onChange={(e) => update({ email: e.target.value })}
            />
          </Field>
          {/* §5.2: the invitation establishes ownership of the address it went
              to, and of nothing else. Changing it is allowed and is recorded
              honestly as unverified rather than being quietly treated as owned. */}
          <p className="vetting__provenance">
            {profile.emailOwnership === 'invited_link' ? (
              <>
                <Tag variant="mint">From your invitation</Tag> We sent your link to this
                address, which is how we know it is yours.
              </>
            ) : (
              <>
                <Tag variant="moss">Not verified</Tag> You changed this. We have not
                checked that this address reaches you, and we will say so on your record.
              </>
            )}
          </p>

          <Field
            label="Phone"
            hint="So support can reach you if something urgent happens with money."
            id="claim-phone"
          >
            <Input
              type="tel"
              autoComplete="tel"
              value={draft.phone}
              onChange={(e) => update({ phone: e.target.value })}
            />
          </Field>
          {/* §5.2, §33.1.8: collected, never verified. There is no code to send
              and no control here that would send one. */}
          <p className="vetting__provenance">
            <Tag variant="default">Unverified</Tag> We never send codes to this number and
            we never use it to sign you in.
          </p>

          <Field
            label="Date of birth"
            hint="Format: YYYY-MM-DD. Stripe needs it when we set up payouts."
            id="claim-dob"
          >
            <Input
              type="text"
              inputMode="numeric"
              placeholder="1990-01-31"
              autoComplete="bday"
              value={draft.dateOfBirth}
              onChange={(e) => update({ dateOfBirth: e.target.value })}
            />
          </Field>

          <Field label="Country" id="claim-country">
            <Input
              type="text"
              autoComplete="country-name"
              value={draft.country}
              onChange={(e) => update({ country: e.target.value })}
            />
          </Field>

          <Field label="State" id="claim-state">
            <Input
              type="text"
              autoComplete="address-level1"
              value={draft.stateRegion}
              onChange={(e) => update({ stateRegion: e.target.value })}
            />
          </Field>
        </section>

        <section aria-labelledby="claim-business">
          <h2 id="claim-business">Your business</h2>
          <p className="field-hint">
            Whoever sells to your Backers is the seller of record. If that is just you,
            say so — it is a normal answer.
          </p>
          <div className="claim__choice">
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
              <Field label="Business name" id="claim-business-name">
                <Input
                  type="text"
                  value={draft.businessName}
                  onChange={(e) => update({ businessName: e.target.value })}
                />
              </Field>
              <Field
                label="Entity type"
                hint="LLC, corporation, partnership — whatever it says on the filing."
                id="claim-entity-type"
              >
                <Input
                  type="text"
                  value={draft.businessEntityType}
                  onChange={(e) => update({ businessEntityType: e.target.value })}
                />
              </Field>
            </>
          ) : null}
        </section>

        <section aria-labelledby="claim-password">
          <h2 id="claim-password">How you sign in</h2>
          <Field
            label="Choose a password"
            hint="At least 12 characters. Nothing else about it is prescribed — length is what matters."
            error={
              password !== '' && password.length < 12
                ? 'That is shorter than 12 characters.'
                : undefined
            }
            id="claim-password-input"
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {/* The password is the one value on this surface that is never
              autosaved. §28.2 keeps sensitive values out of anything at rest,
              and a half-filled account draft is at rest. */}
          <p className="field-hint">
            This is the only thing on this page we do not save as you type. It reaches us
            once, when you create the account.
          </p>
        </section>

        <section aria-labelledby="claim-agreements">
          <h2 id="claim-agreements">What you are agreeing to</h2>

          {unpublished.length > 0 ? (
            <StatePanel
              state="We cannot create your account yet"
              whatHappened={
                <>
                  The agreements you would be accepting are still with our lawyers. We
                  will not ask you to sign something that is not final, so this last step
                  stays closed.{' '}
                  <strong>
                    Everything you have entered is saved and no account has been created.
                  </strong>
                </>
              }
              next="We will email you the moment it opens. There is nothing for you to do."
              owner="Proovd"
              nextUpdate="When the documents are published"
              action="No action needed"
              reference={profile.campaignId}
              getHelp={{ href: supportMailto('Question about my Proovd account setup') }}
              ring
            />
          ) : (
            <div className="claim__consents">
              {/* §28.4: separate, unchecked, purpose-specific. No "accept all". */}
              {policies.map((policy) => (
                <div className="claim__consent" key={policy.slug}>
                  <Option
                    label={`I accept the ${policy.title}${policy.version ? ` (version ${policy.version})` : ''}.`}
                    checked={accepted[policy.slug] === true}
                    onCheckedChange={(on) =>
                      setAccepted((current) => ({ ...current, [policy.slug]: on }))
                    }
                  />
                  {policy.route ? (
                    <a href={policy.route} target="_blank" rel="noreferrer">
                      Read it
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="claim-representations">
          <h2 id="claim-representations">What you are confirming</h2>
          <div className="claim__consents">
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
            whatHappened={error.what}
            next={error.next}
            owner="You"
            nextUpdate="When you try again"
            action="No action needed"
            reference={profile.campaignId}
            ring
          />
        ) : null}

        {unpublished.length === 0 ? (
          <Card className="claim__actions">
            <Button tier="primary" disabled={!canClaim || claiming} onClick={() => void claim()}>
              {claiming ? 'Creating your account…' : 'Create my account'}
            </Button>
            <p className="field-hint">
              This creates your account and uses up your invitation link. Nothing is
              charged and no card is asked for.
            </p>
          </Card>
        ) : null}

        <p className="vetting__note">
          Proovd will never ask you for your bank details, tax details, password, or
          identity documents by email.
        </p>
      </Measure>
    </Section>
  );
}

/**
 * §10's provenance, made visible.
 *
 * "Every prefilled field stores whether Proovd or Founder supplied the current
 * value." Showing it is what turns a prefilled box from a presumption into an
 * offer the Founder can decline.
 */
function Provenance({ field }: { field: ClaimProfileState['fields'][keyof ClaimProfileState['fields']] }) {
  if (field.prefilled === null) return null;
  return (
    <p className="vetting__provenance">
      {field.supplier === 'proovd' ? (
        <>
          <Tag variant="mint">From your invitation</Tag> This is what we had. Change it if
          it is wrong.
        </>
      ) : (
        <>
          <Tag variant="moss">You changed this</Tag> We had &ldquo;{field.prefilled}&rdquo;.
        </>
      )}
    </p>
  );
}
