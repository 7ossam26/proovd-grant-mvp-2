/**
 * Screen 7 — the agreement, and the claim — Creator Flow v2, Session C,
 * 2026-08-19.
 *
 * §11's one primary action, `Confirm and create account`. It is the only one in
 * the whole nine-screen walk, and the only route in it that creates anything.
 *
 * ── `completeAffiliateSignup` is not touched, split, or made partial ────────
 * One call, one transaction, the same gates in the same order. This screen
 * gathers what that transaction already required and presses the button; every
 * refusal it can produce is rendered as the sentence the service wrote, because
 * the service is what decided (§1.1 — a control is not a capability, and a
 * disabled button is not authorization).
 *
 * ── Three §11 fields the reference never draws ──────────────────────────────
 * `dateOfBirth`, `country` and `stateRegion` are gates on the claim and appear
 * on no screen of the prototype, which bundles four representations into one
 * sentence instead. They are collected HERE rather than on screen 2 because
 * they are the factual half of two of the five confirmations — the birth date
 * beside "I am at least 18", the state beside "I am based in the United
 * States". §10's Founder claim puts the same pair on the same screen for the
 * same reason.
 *
 * Nothing computes an age from the date. §11 records what somebody states, and
 * the confirmation is the statement.
 *
 * ── Five controls, five columns (§28.4) ─────────────────────────────────────
 * `CREATOR_CONFIRMATIONS` is the register; each entry names its own PATCH key
 * and its own column, so a test can count the controls and compare that number
 * to the schema rather than to a second list. There is no "accept all", and
 * nothing on this page sets more than one from a single toggle.
 *
 * ── Two acceptances, and the third is refused ───────────────────────────────
 * The reference's single button accepts "the Terms, Acceptable Use Policy, and
 * IP & NDA Agreement". §31.5's IP agreement is PER CAMPAIGN and is due before
 * WORK — it is collected at §14.2 acceptance, on the campaign it belongs to —
 * so taking it here would collect it for a campaign this Creator has not been
 * offered. `AFFILIATE_CLAIM_POLICY_SLUGS` has held exactly two since Phase 08b.
 *
 * ── The claim does not mint a session, so this signs in afterwards ──────────
 * `completeAffiliateSignup` creates the account and CLAIMS the invitation; it
 * issues no session, and §11 does not ask it to. The next screen is behind
 * `requireRole('affiliate')`, so the password held in `draft.ts` is posted to
 * Better Auth's own sign-in route — the real route, its real rate limit, its
 * real origin guard, and no new server code. Founder Flow Session D made the
 * same call for the same reason.
 *
 * If the sign-in fails, the ACCOUNT still exists — the claim was its own
 * transaction and it committed — and the surface says exactly that rather than
 * letting somebody believe they must start over with a link that no longer
 * works.
 *
 * ── The password is asked again when a reload lost it ───────────────────────
 * It is module state by design (`draft.ts`): a credential in `sessionStorage`
 * outlives the tab and is readable by anything in the page. A reload costs one
 * re-ask HERE, which is cheaper than sending somebody back through six screens
 * they already completed.
 */

import { useState } from 'react';
import { useParams } from 'react-router';
import {
  CREATOR_AGE_IS_YOUR_STATEMENT,
  CREATOR_AGREE_CONFIRMATIONS_HELP,
  CREATOR_AGREE_CONFIRMATIONS_LABEL,
  CREATOR_AGREE_CONTROL_BODY,
  CREATOR_AGREE_CONTROL_TITLE,
  CREATOR_AGREE_HEAD,
  CREATOR_AGREE_IP_LATER,
  CREATOR_AGREE_LEDE,
  CREATOR_AGREE_MONEY_BODY,
  CREATOR_AGREE_MONEY_TITLE,
  CREATOR_CONFIRMATIONS,
  CREATOR_PASSWORD_NEVER_PLAIN,
  CREATOR_SIGN_IN_AFTER_CLAIM_FAILED,
  creatorPasswordMeetsRequirements,
} from '@proovd/shared';
import { Button, Field, Option } from '../../components/index.js';
import { DateOfBirthField } from '../founder-flow/DateOfBirthField.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { SurfaceLoading, supportMailto } from '../../features/public/states.js';
import { CreatorFlowPage, useCreatorFlowNav } from './CreatorFlowPage.js';
import { useInvitation, useInvitationSave } from './useInvitation.js';
import { clearDraft, draftPassword, setDraftPassword } from './draft.js';
import { completeSignup, creatorSignIn, CreatorRequestError } from '../creator/api.js';
import type { CreatorInvitationState, CreatorPatch } from '../creator/api.js';

/** The register's key → the state field `readSignupProfile` returns. */
function confirmationField(key: string): string {
  return key.replace(/^confirm/, '').replace(/^./, (c) => c.toLowerCase());
}

export function AgreeStep() {
  const { token = '' } = useParams();
  const { state, unavailable } = useInvitation(token);

  if (unavailable) return <LinkUnavailable />;
  if (!state) {
    return <SurfaceLoading subject="the agreement" reference="Your invitation link" />;
  }

  return (
    <CreatorFlowPage pageId="agree" param={token}>
      <Body token={token} loaded={state} />
    </CreatorFlowPage>
  );
}

function Body({ token, loaded }: { token: string; loaded: CreatorInvitationState }) {
  const { leave, leaveToPage } = useCreatorFlowNav();
  const autosave = useInvitationSave(token);

  const [confirmations, setConfirmations] = useState<Record<string, boolean>>(
    () => ({ ...(loaded.profile.confirmations as unknown as Record<string, boolean>) }),
  );
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [dateOfBirth, setDateOfBirth] = useState(
    loaded.profile.fields['dateOfBirth']?.value ?? '',
  );
  const [country, setCountry] = useState(loaded.profile.fields['country']?.value ?? '');
  const [stateRegion, setStateRegion] = useState(
    loaded.profile.fields['stateRegion']?.value ?? '',
  );
  const [password, setPassword] = useState(() => draftPassword() ?? '');
  const [claiming, setClaiming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [signInFailed, setSignInFailed] = useState(false);

  const unpublished = loaded.policies.filter((policy) => policy.status !== 'published');
  const passwordKnown = draftPassword() !== null;

  const allConfirmed = CREATOR_CONFIRMATIONS.every(
    (entry) => confirmations[confirmationField(entry.key)] === true,
  );
  const allAccepted = loaded.policies.every((policy) => accepted[policy.slug] === true);
  const placeComplete =
    dateOfBirth.trim() !== '' && country.trim() !== '' && stateRegion.trim() !== '';
  const passwordReady = creatorPasswordMeetsRequirements(password);

  const ready =
    unpublished.length === 0 && allConfirmed && allAccepted && placeComplete && passwordReady;

  function setConfirmation(entry: (typeof CREATOR_CONFIRMATIONS)[number], next: boolean) {
    setConfirmations((current) => ({ ...current, [confirmationField(entry.key)]: next }));
    autosave.queue({ [entry.key]: next } as CreatorPatch);
  }

  function setPlaceField(key: 'country' | 'stateRegion' | 'dateOfBirth', next: string) {
    if (key === 'country') setCountry(next);
    if (key === 'stateRegion') setStateRegion(next);
    if (key === 'dateOfBirth') setDateOfBirth(next);
    autosave.queue({ [key]: next } as CreatorPatch);
  }

  async function claim() {
    if (!ready || claiming) return;
    setClaiming(true);
    setFailure(null);
    setSignInFailed(false);
    try {
      // Everything typed on this screen has to be stored before the claim reads
      // it back: the service re-reads the profile rather than trusting a body.
      await autosave.flush();
      await completeSignup(token, {
        password,
        acceptedPolicySlugs: loaded.policies.map((policy) => policy.slug),
      });
    } catch (caught) {
      setFailure(
        caught instanceof CreatorRequestError
          ? [caught.detail.whatHappened, caught.detail.next].filter(Boolean).join(' ')
          : 'Your account was not created, and nothing you entered was lost.',
      );
      setClaiming(false);
      return;
    }

    // The account exists from here on. A failure below is a failure to SIGN IN,
    // which is a different fact and gets a different sentence.
    const email = loaded.profile.fields['email']?.value ?? '';
    try {
      await creatorSignIn(email, password);
    } catch {
      setSignInFailed(true);
      setClaiming(false);
      clearDraft();
      return;
    }

    clearDraft();
    leave('/creator/welcome', 1);
  }

  return (
    <div className="crf-agree">
      <h1 className="crf-agree__head" data-anim="head">
        {CREATOR_AGREE_HEAD}
      </h1>
      <p className="crf-agree__lede" data-anim="sub">
        {CREATOR_AGREE_LEDE}
      </p>

      <div className="crf-agree__promises" data-anim="panel">
        <div className="crf-agree__promise">
          <h2>{CREATOR_AGREE_CONTROL_TITLE}</h2>
          <p>{CREATOR_AGREE_CONTROL_BODY}</p>
        </div>
        <div className="crf-agree__promise">
          <h2>{CREATOR_AGREE_MONEY_TITLE}</h2>
          <p>{CREATOR_AGREE_MONEY_BODY}</p>
        </div>
      </div>

      <section className="crf-agree__block" data-anim="field">
        <h2 className="crf-agree__block-head">Where you are</h2>
        {/* The factual half of two of the confirmations below. Nothing here
            derives an age, a country, or an eligibility — §11 records what
            somebody states, and the statement is the control. */}
        {/* Not wrapped in a `Field`: the component renders its own label,
            its own hint, and its own calendar disclosure, so a wrapper printed
            "Date of birth" twice. Found by the browser pass — jsdom is happy
            with two labels and axe reads the nearer one. */}
        <DateOfBirthField
          value={dateOfBirth}
          onChange={(next) => setPlaceField('dateOfBirth', next)}
          // Nothing on this screen computes an age. The Founder flow's own note
          // says its field checks 18+ as a courtesy, which is true there and
          // would be a claim about behaviour here.
          note={CREATOR_AGE_IS_YOUR_STATEMENT}
        />
        <Field label="Country" hint="Proovd works with US-based Creators only at launch.">
          <input
            className="input"
            value={country}
            autoComplete="country-name"
            onChange={(event) => setPlaceField('country', event.target.value)}
          />
        </Field>
        <Field label="State">
          <input
            className="input"
            value={stateRegion}
            autoComplete="address-level1"
            onChange={(event) => setPlaceField('stateRegion', event.target.value)}
          />
        </Field>
      </section>

      <section className="crf-agree__block" data-anim="field">
        <h2 className="crf-agree__block-head">{CREATOR_AGREE_CONFIRMATIONS_LABEL}</h2>
        <p className="crf-agree__block-help">{CREATOR_AGREE_CONFIRMATIONS_HELP}</p>
        {CREATOR_CONFIRMATIONS.map((entry) => (
          <Option
            key={entry.key}
            label={entry.label}
            checked={confirmations[confirmationField(entry.key)] ?? false}
            onCheckedChange={(next) => setConfirmation(entry, next)}
          />
        ))}
      </section>

      <section className="crf-agree__block" data-anim="field">
        <h2 className="crf-agree__block-head">What you are accepting</h2>
        {unpublished.length > 0 ? (
          <p className="crf-agree__unpublished" role="status">
            The agreements are still with our lawyers, so we cannot ask you to accept them
            yet — and we will not show you a summary and call it the document. Nothing you
            have entered is lost; it is saved against your invitation, and we will email you
            the moment this opens. There is nothing for you to do.{' '}
            <a href={supportMailto(`Creator signup — ${loaded.landing.reference}`)}>
              Ask us about it
            </a>
            .
          </p>
        ) : (
          loaded.policies.map((policy) => (
            <div key={policy.slug} className="crf-agree__policy">
              {/* The link sits OUTSIDE the control. `Option` is a
                  `role="checkbox"` button, and an anchor inside it is
                  interactive content nested in an interactive control —
                  keyboard users could not reach the link without toggling the
                  consent (§28.5). */}
              <Option
                label={`I accept the ${policy.title} (version ${policy.version}).`}
                checked={accepted[policy.slug] ?? false}
                onCheckedChange={(next) =>
                  setAccepted((current) => ({ ...current, [policy.slug]: next }))
                }
              />
              <p className="crf-agree__policy-link">
                <a href={policy.route} target="_blank" rel="noreferrer">
                  Read the {policy.title}
                </a>
              </p>
            </div>
          ))
        )}
        <p className="crf-agree__ip">{CREATOR_AGREE_IP_LATER}</p>
      </section>

      {/* Only when a reload lost it. Somebody who walked straight here never
          sees this field, and somebody who did not is told why it is back. */}
      {passwordKnown ? null : (
        <section className="crf-agree__block" data-anim="grow">
          <h2 className="crf-agree__block-head">Your password, once more</h2>
          <p className="crf-agree__block-help">
            We never keep your password anywhere between pages, so a refresh loses it.
            Everything else you entered is saved. {CREATOR_PASSWORD_NEVER_PLAIN}
          </p>
          <Field
            label="Your password"
            error={
              password !== '' && !passwordReady
                ? 'That is shorter than the twelve characters an account needs.'
                : undefined
            }
          >
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setDraftPassword(event.target.value);
              }}
            />
          </Field>
        </section>
      )}

      {failure ? (
        <p className="crf-agree__problems" role="alert">
          {failure}
        </p>
      ) : null}

      {signInFailed ? (
        <p className="crf-agree__problems" role="alert">
          {CREATOR_SIGN_IN_AFTER_CLAIM_FAILED}{' '}
          <a href="/signin">Go to sign in</a>
        </p>
      ) : null}

      <div className="crf-nav" data-anim="cta">
        <Button tier="tertiary" onClick={() => leaveToPage('verify', -1)}>
          Back to Your numbers
        </Button>
        {/* §11's ONE primary action. It is absent rather than disabled while
            the agreements are draft: a control that cannot work is one people
            look for a way around, and the reason above says what is happening
            (the `/admin/live-mode` posture, on a customer surface). */}
        {unpublished.length === 0 ? (
          <Button tier="primary" disabled={!ready || claiming} onClick={() => void claim()}>
            {claiming ? 'Creating your account…' : 'Confirm and create account'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
