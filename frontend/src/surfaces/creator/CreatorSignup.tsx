/**
 * The Creator's compact signup — Spec §11, §5.3, §28.4, §33.2.2, §33.2.3.
 *
 * §11: "one compact account-and-profile flow with one primary action: `Confirm
 * and create account`." One page. Not a wizard, not a sequence, not a tour.
 *
 * ── Exactly two primary actions, ever (§33.2.2) ─────────────────────────────
 * `Confirm and create account`, and then `Finish payout setup`. §11 names both
 * and forbids the alternatives in the same breath: "There is no welcome tour,
 * multi-page education sequence, separate banking page, or public Affiliate
 * signup." There is no step counter in this file, no `next`/`back`, and no
 * second page. The payout step is a handoff to Stripe — §11: "Proovd must not
 * reproduce provider-controlled banking or identity fields in a custom form" —
 * so this file contains no input for an account number, a routing number, a tax
 * id, or an identity document, and there is no route it could post one to.
 *
 * ── Prefilled, labelled, and correctable (§11) ──────────────────────────────
 * Every field Proovd filled in from the recruitment record carries a line
 * saying so, and that line flips the moment the Creator changes it. §11 calls
 * it a "source label for prefilled public information and ability to correct
 * it"; it is the visible half of a record §11 requires Admin to see.
 *
 * ── Five confirmations, five controls (§28.4) ───────────────────────────────
 * §28.4: "No dark pattern, preselection, or bundling of optional consent."
 * Each of §11's five confirmations is its own unchecked control and its own
 * field. There is no "accept all", and nothing here can set more than one.
 *
 * ── Phone (§33.1.8) ────────────────────────────────────────────────────────
 * Collected and labelled unverified, in those words. No verify control, no code
 * entry, and no path in this file that could add one.
 *
 * ── When the agreements are not published ───────────────────────────────────
 * The claim control is not rendered and the surface says why. §31.4 forbids a
 * placeholder or a summary standing in for a policy document, and asking
 * someone to accept text still with the lawyers records agreement to nothing.
 * The honest state, not a bug to route around.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import {
  Button,
  Card,
  Field,
  Input,
  Measure,
  Option,
  Section,
  NO_ACTION,
  StatePanel,
  Tag,
  Textarea,
} from '../../components/index.js';
import { describeSaveState } from '../../lib/autosave.js';
import { supportMailto } from '../../features/public/states.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { useAutosave } from '../draft/useAutosave.js';
import {
  fetchInvitation,
  saveInvitation,
  completeSignup,
  CreatorRequestError,
  type CreatorInvitationState,
  type CreatorPatch,
  type CreatorPolicy,
  type CreatorProfile,
} from './api.js';

/**
 * §11: the waiting state "identifies Proovd as owner". The same sentence the
 * confirmation email carries — one wait, one owner, said the same way in both
 * places a Creator might read it.
 */
export const PROOVD_OWNS_THE_WAIT =
  'Proovd owns this step. We are working with the Founder to finish their setup, and we will ' +
  'email you as soon as there is something for you to look at.';

type Screen = 'loading' | 'unavailable' | 'signup' | 'waiting';

export function CreatorSignup() {
  const { token = '' } = useParams();
  const [screen, setScreen] = useState<Screen>('loading');
  const [state, setState] = useState<CreatorInvitationState | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchInvitation(token);
      setState(next);
      setScreen(next.profile.claimedAt ? 'waiting' : 'signup');
    } catch {
      // Every rejection is the same rejection (§5.5). The surface cannot tell
      // invalid from expired from revoked, and neither can the person holding
      // the link — which is the point.
      setScreen('unavailable');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (screen === 'loading') {
    return (
      <Measure>
        <StatePanel
          state="Opening your invitation"
          whatHappened="Proovd is checking this link."
          next="The page appears as soon as that comes back."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference="Creator invitation"
        />
      </Measure>
    );
  }

  if (screen === 'unavailable' || !state) return <LinkUnavailable />;

  if (screen === 'waiting') {
    return <WaitingState state={state} />;
  }

  return <SignupForm token={token} initial={state} onClaimed={load} />;
}

/* ── §33.2.3 — the named waiting state ────────────────────────────────────── */

/**
 * §11: "the same surface confirms signup, names the campaign, says the Founder
 * is finishing setup, identifies Proovd as owner, gives the next-update
 * expectation, and says `No action needed`."
 *
 * Those are §27.1's six questions, so this is a `StatePanel` — the component
 * that cannot be rendered without answering all six.
 *
 * The `preparing` branch is deliberately NOT a reviewable campaign in this
 * phase. §10's handoff — the campaign appearing once with a `Review campaign`
 * action and the Campaign kit behind it — is Phase 08c's. Offering the action
 * before the kit exists would claim a capability the product does not have
 * (§1.4), so this says truthfully that the campaign is being prepared and that
 * we will write when there is something to read.
 */
function WaitingState({ state }: { state: CreatorInvitationState }) {
  const product = state.conditional.productName ?? state.landing.productName;
  const preparing = state.conditional.state === 'preparing';

  return (
    <Measure>
      <Section>
        <Tag variant="mint">Signed up</Tag>
        <h1>Your Proovd account is set up.</h1>
        <p>
          You are joined to {product ?? 'this campaign'}. That is the one campaign this
          account is for.
        </p>
      </Section>

      <StatePanel
        state={preparing ? 'The campaign is being prepared' : 'Waiting for the Founder'}
        whatHappened={
          preparing
            ? `The Founder has finished setting up ${product ?? 'the campaign'}. It is being prepared for review now.`
            : `The Founder is still finishing their setup, so there is no campaign for you to review yet.`
        }
        next={PROOVD_OWNS_THE_WAIT}
        owner="Proovd"
        nextUpdate="We will email you as soon as the campaign is ready to review."
        action={NO_ACTION}
        reference={state.landing.reference}
        getHelp={{ href: supportMailto(`Creator signup — ${state.landing.reference}`) }}
      />

      <PayoutPanel status={state.profile.payout.status} />
    </Measure>
  );
}

/* ── §11's second primary action ──────────────────────────────────────────── */

/**
 * `Finish payout setup` — a handoff, not a form.
 *
 * §11: it "opens the Stripe-controlled connected-account onboarding required
 * for identity, tax, bank, transfer capability, and payout." Stripe lands in
 * Phase 10 (§32.1 orders signup first, deliberately), so today this panel
 * reports the true status — not started, because it cannot be started yet — and
 * renders no control. §1.4: a button that does nothing is worse than no button,
 * and a form that collected the fields here would be the §11 violation the
 * whole panel exists to avoid.
 */
function PayoutPanel({ status }: { status: string }) {
  return (
    <StatePanel
      state="Payout setup is not open yet"
      whatHappened={
        status === 'not_started'
          ? 'Getting paid needs a Stripe account in your name, for identity, tax, and bank details. That step is not open yet.'
          : `Your payout setup is ${status.replace(/_/g, ' ')}.`
      }
      next="When it opens you will set it up with Stripe directly. Proovd never asks for your bank or tax details, and never stores them."
      owner="Proovd"
      nextUpdate="We will email you when payout setup opens."
      action={NO_ACTION}
      reference="Payout setup"
    />
  );
}

/* ── §11's compact flow ───────────────────────────────────────────────────── */

const TEXT_FIELDS = [
  { key: 'legalName', label: 'Full legal name', hint: 'The name on your government ID. Only Proovd sees it.' },
  { key: 'publicHandle', label: 'Public name or handle', hint: 'What your audience knows you as. This is the only name the Founder sees.' },
  { key: 'email', label: 'Email', hint: 'Where Proovd writes to you.' },
  { key: 'phone', label: 'Phone', hint: 'For support only. We never verify it and never send codes to it.' },
  { key: 'channelReference', label: 'Primary URL or handle', hint: 'The channel you would promote from.' },
  { key: 'audienceNiche', label: 'Audience niche', hint: 'Who your audience is.' },
  { key: 'audienceSize', label: 'Audience size', hint: 'In whatever unit your channel measures — followers, subscribers, members.' },
] as const;

const CONFIRMATIONS = [
  { key: 'confirmAge18Plus', label: 'I am at least 18 years old.' },
  { key: 'confirmUsBased', label: 'I am based in the United States.' },
  {
    key: 'confirmActualOperator',
    label: 'I am the person who actually runs this channel — not an agency or manager acting for someone else.',
  },
  { key: 'confirmNoDuplicateAccounts', label: 'I am not running duplicate Proovd accounts.' },
  {
    key: 'confirmSanctionsEligible',
    label: 'I am not on a sanctions list and am eligible to be paid under US sanctions rules.',
  },
] as const;

function SignupForm({
  token,
  initial,
  onClaimed,
}: {
  token: string;
  initial: CreatorInvitationState;
  onClaimed: () => void;
}) {
  const [profile, setProfile] = useState<CreatorProfile>(initial.profile);
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [claiming, setClaiming] = useState(false);
  const [failure, setFailure] = useState<CreatorRequestError | null>(null);

  // The typed value never comes back from the server: `useAutosave` takes a
  // patch and reports an outcome, and cannot overwrite what is in the box.
  const autosave = useAutosave<CreatorPatch>(
    useCallback((patch) => saveInvitation(token, patch), [token]),
  );

  const unpublished = useMemo(
    () => initial.policies.filter((p) => p.status !== 'published'),
    [initial.policies],
  );

  const setField = (key: string, value: string) => {
    setProfile((current) => ({
      ...current,
      fields: {
        ...current.fields,
        [key]: {
          ...current.fields[key]!,
          value,
          // The source label flips locally the moment they type, and the server
          // decides the stored truth on the next save.
          supplier: value === current.fields[key]?.prefilled ? 'proovd' : 'affiliate',
        },
      },
    }));
    autosave.queue({ [key]: value } as CreatorPatch);
  };

  const setConfirmation = (key: string, value: boolean) => {
    setProfile((current) => ({
      ...current,
      confirmations: { ...current.confirmations, [key.replace(/^confirm/, '').replace(/^./, (c) => c.toLowerCase())]: value },
    }));
    autosave.queue({ [key]: value } as CreatorPatch);
  };

  const confirmationValue = (key: string): boolean => {
    const short = key.replace(/^confirm/, '').replace(/^./, (c) => c.toLowerCase());
    return (profile.confirmations as unknown as Record<string, boolean>)[short] ?? false;
  };

  const allConfirmed = CONFIRMATIONS.every((c) => confirmationValue(c.key));
  const allAccepted = initial.policies.every((p) => accepted[p.slug]);
  const required = ['legalName', 'publicHandle', 'email', 'dateOfBirth', 'country', 'stateRegion'];
  const complete = required.every((key) => (profile.fields[key]?.value ?? '').trim() !== '');
  const canClaim =
    unpublished.length === 0 && complete && allConfirmed && allAccepted && password.length >= 12;

  const claim = async () => {
    setClaiming(true);
    setFailure(null);
    try {
      await completeSignup(token, {
        password,
        acceptedPolicySlugs: initial.policies.filter((p) => accepted[p.slug]).map((p) => p.slug),
      });
      setPassword('');
      onClaimed();
    } catch (caught) {
      if (caught instanceof CreatorRequestError) setFailure(caught);
    } finally {
      setClaiming(false);
    }
  };

  const saveLabel = describeSaveState(autosave.state);

  return (
    <Measure>
      <Section>
        <Tag variant="mint">Invitation</Tag>
        <h1>{initial.landing.recipientName}, create your Proovd account.</h1>
        <p>
          This joins you to {initial.landing.productName ?? 'one campaign'}
          {initial.landing.founderName ? ` by ${initial.landing.founderName}` : ''}. It is the
          only campaign this account is for, and creating it does not commit you to promoting
          anything.
        </p>
        <p className="field-hint" aria-live="polite">
          {saveLabel}
        </p>
      </Section>

      <Card>
        <h2>About you</h2>
        <p className="field-hint">
          We filled in what we found publicly. Anything we got wrong, correct it here — what
          you change is what we keep.
        </p>

        {TEXT_FIELDS.map((f) => {
          const field = profile.fields[f.key];
          return (
            <Field
              key={f.key}
              label={f.label}
              hint={
                field?.prefilled
                  ? `${f.hint} ${field.supplier === 'proovd' ? 'Proovd filled this in from your public channel.' : 'You corrected this.'}`
                  : f.hint
              }
            >
              <Input
                value={field?.value ?? ''}
                type={f.key === 'email' ? 'email' : 'text'}
                onChange={(event) => setField(f.key, event.target.value)}
              />
            </Field>
          );
        })}

        <Field
          label="How Proovd describes you"
          hint={
            profile.fields['bio']?.supplier === 'proovd'
              ? 'Written by Proovd from your public channel. Change it to how you would put it.'
              : 'You wrote this.'
          }
        >
          <Textarea
            rows={3}
            value={profile.fields['bio']?.value ?? ''}
            onChange={(event) => setField('bio', event.target.value)}
          />
        </Field>

        {/* §5.3's classification. Shown, not editable — changing it would
            invalidate the verification recorded against it, which is an Admin
            decision rather than a self-service one. */}
        {profile.channelSubtype ? (
          <p className="field-hint">
            We have you recorded as a {profile.channelSubtype.replace(/_/g, ' ')}. If that is
            wrong, reply to your invitation email and we will fix it.
          </p>
        ) : null}
      </Card>

      <Card>
        <h2>Where you are</h2>
        <Field label="Date of birth" hint="Use the format YYYY-MM-DD.">
          <Input
            value={profile.fields['dateOfBirth']?.value ?? ''}
            placeholder="YYYY-MM-DD"
            onChange={(event) => setField('dateOfBirth', event.target.value)}
          />
        </Field>
        <Field label="Country" hint="Proovd works with US-based Creators only at launch.">
          <Input
            value={profile.fields['country']?.value ?? ''}
            onChange={(event) => setField('country', event.target.value)}
          />
        </Field>
        <Field label="State">
          <Input
            value={profile.fields['stateRegion']?.value ?? ''}
            onChange={(event) => setField('stateRegion', event.target.value)}
          />
        </Field>
      </Card>

      <Card>
        <h2>Your password</h2>
        {/* Never autosaved. §28.2 keeps sensitive values out of anything at
            rest, and a half-filled signup is at rest. */}
        <Field label="Choose a password" hint="At least 12 characters.">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <p className="field-hint">
          This is the only thing on this page we do not save as you type. It reaches us once,
          when you create the account.
        </p>
      </Card>

      <Card>
        <h2>Confirmations</h2>
        <p className="field-hint">
          Each of these is a separate statement. None of them is ticked for you.
        </p>
        {CONFIRMATIONS.map((c) => (
          <Option
            key={c.key}
            label={c.label}
            checked={confirmationValue(c.key)}
            onCheckedChange={(next) => setConfirmation(c.key, next)}
          />
        ))}
      </Card>

      <Card>
        <h2>Agreements</h2>
        {unpublished.length > 0 ? (
          <StatePanel
            state="These agreements are not final yet"
            whatHappened="The Terms and the Creator acceptable-use policy are still with our lawyers. We will not ask you to accept something that is not final."
            next="Nothing you have entered is lost — it is saved. We will email you the moment this opens."
            owner="Proovd"
            nextUpdate="As soon as the agreements are published"
            action={NO_ACTION}
            reference={initial.landing.reference}
            getHelp={{ href: supportMailto(`Creator signup — ${initial.landing.reference}`) }}
            ring
          />
        ) : (
          initial.policies.map((policy: CreatorPolicy) => (
            <div key={policy.slug}>
              {/* The link sits OUTSIDE the control on purpose. `Option` is a
                  `role="checkbox"` button, and an anchor inside it would be
                  interactive content nested in an interactive control — which
                  axe flags and which leaves keyboard users unable to reach the
                  link without toggling the consent. §28.5 makes that a defect,
                  not a detail. */}
              <Option
                label={`I accept the ${policy.title} (version ${policy.version}).`}
                checked={accepted[policy.slug] ?? false}
                onCheckedChange={(next) =>
                  setAccepted((current) => ({ ...current, [policy.slug]: next }))
                }
              />
              <p className="field-hint">
                <a href={policy.route} target="_blank" rel="noreferrer">
                  Read the {policy.title}
                </a>
              </p>
            </div>
          ))
        )}
      </Card>

      {failure ? (
        <StatePanel
          state={failure.detail.title}
          whatHappened={failure.detail.whatHappened ?? 'Your account was not created.'}
          next={failure.detail.next ?? 'Nothing you entered was lost.'}
          owner="Proovd"
          nextUpdate="When you try again"
          action={NO_ACTION}
          reference={initial.landing.reference}
          getHelp={{ href: supportMailto(`Creator signup — ${initial.landing.reference}`) }}
          ring
        />
      ) : null}

      {/* §11's ONE primary action. There is no second button on this page. */}
      {unpublished.length === 0 ? (
        <div className="claim__actions">
          <Button tier="primary" disabled={!canClaim || claiming} onClick={() => void claim()}>
            {claiming ? 'Creating your account…' : 'Confirm and create account'}
          </Button>
        </div>
      ) : null}
    </Measure>
  );
}
