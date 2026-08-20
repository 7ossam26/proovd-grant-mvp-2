/**
 * Screen 7 — the agreement, and the claim — rebuilt 1:1 from
 * `docs/design-refrence/Proovd_Affiliate_Founder_Rebuild_v11_FIXED_SHAREABLE.html`
 * (2026-08-20).
 *
 * The reference's `moment-agree` is the authority for every value here: the
 * structure (`.obrow` → `.obhead` / `.obbody.agreement-panel` /
 * `.ob-inline-action`), the copy, the two-column dark guarantee panel with its
 * vertical hairline, the two legal paragraphs under a horizontal one, and the
 * relay that carries the heading in from the right. PHASE 52 in `proovd.css`
 * carries the declarations; `creatorMomentIn` carries the timeline.
 *
 * ── It renders `bare`, and owns its own header ──────────────────────────────
 * PHASE 49/50/51's precedent, five screens later. The shell's top bar is a
 * wordmark and a Help control; the reference's header on this step is one thing
 * — `← Back` on the left, with `showBrand` explicitly `!showBack` so the
 * wordmark is absent by design.
 *
 * ── One button, and what pressing it records ────────────────────────────────
 * The reference's legal line states four of §11's five representations — real
 * creator, only Proovd account, US-based, not sanctioned — and then says
 * "Tapping agree ... confirms everything above". So the press writes exactly
 * those four confirmations, accepts the two published policies, and claims.
 *
 * It does NOT write the fifth. §11's 18+ representation is not in that sentence
 * and recording an age statement nobody made is worse than asking for it, so it
 * is asked for beside the date of birth, unchecked (§28.4).
 *
 * ── The completion state, and why it is a state rather than a redesign ──────
 * `completeAffiliateSignup` gates on `dateOfBirth`, `country` and
 * `stateRegion`, and the reference collects none of them on any of its nine
 * screens. The screen therefore renders the reference EXACTLY and reveals those
 * three facts and the 18+ statement only when the record is short — which on a
 * completed walk is never, and on a link somebody opened straight at `/agree`
 * is once. §1.1 asks every surface for its states; this is one of them, and it
 * is checked locally first so nobody meets a server refusal for something the
 * browser could already see was missing.
 *
 * ── `completeAffiliateSignup` is not touched, split, or made partial ────────
 * One call, one transaction, the same gates in the same order. Every refusal it
 * can produce is rendered as the sentence the service wrote, because the
 * service is what decided (§1.1 — a control is not a capability).
 *
 * ── Two acceptances, and the third is named rather than taken ───────────────
 * The reference's sentence names Terms, the Acceptable Use Policy and an
 * IP & NDA Agreement, and marks all three as bold underlined text with no
 * `href`. §31.5's IP agreement is PER CAMPAIGN and is due before WORK — it is
 * collected at §14.2 acceptance, on the campaign it belongs to — so
 * `AFFILIATE_CLAIM_POLICY_SLUGS` still holds exactly two, the two that have
 * routes render as real links in the reference's own treatment, and the third
 * stays the `<b>` the reference draws with nothing behind it.
 *
 * ── The claim does not mint a session, so this signs in afterwards ──────────
 * `completeAffiliateSignup` creates the account and CLAIMS the invitation; it
 * issues no session, and §11 does not ask it to. The next screen is behind
 * `requireRole('affiliate')`, so the password held in `draft.ts` is posted to
 * Better Auth's own sign-in route — the real route, its real rate limit, its
 * real origin guard, and no new server code.
 *
 * If the sign-in fails, the ACCOUNT still exists — the claim was its own
 * transaction and it committed — and the surface says exactly that.
 *
 * ── The password is asked again when a reload lost it ───────────────────────
 * It is module state by design (`draft.ts`): a credential in `sessionStorage`
 * outlives the tab and is readable by anything in the page. A reload costs one
 * re-ask here, inside the same completion panel, rather than sending somebody
 * back through six screens they already completed.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  CREATOR_AGE_IS_YOUR_STATEMENT,
  CREATOR_AGREE_CONTROL_BODY,
  CREATOR_AGREE_CONTROL_TITLE,
  CREATOR_AGREE_CTA,
  CREATOR_AGREE_HEAD,
  CREATOR_AGREE_LEDE,
  CREATOR_AGREE_LEGAL_PRIMARY,
  CREATOR_AGREE_MONEY_BODY,
  CREATOR_AGREE_MONEY_TITLE,
  CREATOR_AGREE_MORE_BODY,
  CREATOR_AGREE_MORE_COUNTRY_HINT,
  CREATOR_AGREE_MORE_COUNTRY_LABEL,
  CREATOR_AGREE_MORE_DOB_LABEL,
  CREATOR_AGREE_MORE_STATE_LABEL,
  CREATOR_AGREE_MORE_TITLE,
  CREATOR_AGREE_TERMS_AUP,
  CREATOR_AGREE_TERMS_IP,
  CREATOR_AGREE_TERMS_LAST_SEP,
  CREATOR_AGREE_TERMS_LEAD,
  CREATOR_AGREE_TERMS_SEP,
  CREATOR_AGREE_TERMS_TAIL,
  CREATOR_AGREE_TERMS_TERMS,
  CREATOR_CONFIRMATIONS,
  CREATOR_PASSWORD_NEVER_PLAIN,
  CREATOR_SIGN_IN_AFTER_CLAIM_FAILED,
  creatorPasswordMeetsRequirements,
} from '@proovd/shared';
import { creatorMomentIn } from '../../components/anim.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { SurfaceLoading, supportMailto } from '../../features/public/states.js';
import { CreatorFlowPage, useCreatorFlowNav } from './CreatorFlowPage.js';
import { useInvitation, useInvitationSave } from './useInvitation.js';
import { clearDraft, draftPassword, setDraftPassword } from './draft.js';
import { completeSignup, creatorSignIn, CreatorRequestError } from '../creator/api.js';
import type { CreatorInvitationState, CreatorPatch } from '../creator/api.js';

/**
 * The four the reference's own legal line states.
 *
 * `confirmAge18Plus` is deliberately absent — that sentence does not make it.
 */
const PRESSED_CONFIRMATIONS = [
  'confirmActualOperator',
  'confirmNoDuplicateAccounts',
  'confirmUsBased',
  'confirmSanctionsEligible',
] as const;

const AGE_CONFIRMATION =
  CREATOR_CONFIRMATIONS.find((entry) => entry.key === 'confirmAge18Plus') ?? null;

export function AgreeStep() {
  const { token = '' } = useParams();
  const { state, unavailable } = useInvitation(token);

  if (unavailable) return <LinkUnavailable />;
  if (!state) {
    return <SurfaceLoading subject="the agreement" reference="Your invitation link" />;
  }

  return (
    <CreatorFlowPage pageId="agree" param={token} bare>
      <Body token={token} loaded={state} />
    </CreatorFlowPage>
  );
}

/** The reference's back chevron: 18px, stroke-width 2.4, round caps. */
function BackArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

/** The CTA arrow: 24px in a 24 viewBox, stroke-width 2.6. */
function ForwardArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/** The promise tick: 13px in a 24 viewBox, stroke #E9FFE1, stroke-width 3.4. */
function PromiseTick() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="#E9FFE1"
      strokeWidth="3.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function Promise({ title, body }: { title: string; body: string }) {
  return (
    <div className="crf-agree__promise">
      <span className="crf-agree__tick">
        <PromiseTick />
      </span>
      <div className="crf-agree__promise-text">
        <p className="crf-agree__promise-title">{title}</p>
        <p className="crf-agree__promise-body">{body}</p>
      </div>
    </div>
  );
}

function Body({ token, loaded }: { token: string; loaded: CreatorInvitationState }) {
  const { leave, leaveToPage } = useCreatorFlowNav();
  const autosave = useInvitationSave(token);
  const stageRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  const [dateOfBirth, setDateOfBirth] = useState(
    loaded.profile.fields['dateOfBirth']?.value ?? '',
  );
  const [country, setCountry] = useState(loaded.profile.fields['country']?.value ?? '');
  const [stateRegion, setStateRegion] = useState(
    loaded.profile.fields['stateRegion']?.value ?? '',
  );
  const [age18Plus, setAge18Plus] = useState(
    loaded.profile.confirmations.age18Plus === true,
  );
  const [password, setPassword] = useState(() => draftPassword() ?? '');

  const [showMore, setShowMore] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [signInFailed, setSignInFailed] = useState(false);

  // The relay: head, then lede, then the CTA. The reference's `obEnabled` is
  // `step>=6` here, so the button is never disabled and always rides it.
  useLayoutEffect(() => creatorMomentIn(stageRef.current, 1, 'agree'), []);

  const unpublished = loaded.policies.filter((policy) => policy.status !== 'published');
  const passwordKnown = password !== '';
  const passwordReady = creatorPasswordMeetsRequirements(password);

  const recordComplete =
    dateOfBirth.trim() !== '' &&
    country.trim() !== '' &&
    stateRegion.trim() !== '' &&
    age18Plus &&
    passwordReady;

  function setFact(key: 'dateOfBirth' | 'country' | 'stateRegion', next: string) {
    if (key === 'dateOfBirth') setDateOfBirth(next);
    if (key === 'country') setCountry(next);
    if (key === 'stateRegion') setStateRegion(next);
    autosave.queue({ [key]: next } as CreatorPatch);
  }

  function setAge(next: boolean) {
    setAge18Plus(next);
    autosave.queue({ confirmAge18Plus: next });
  }

  async function agree() {
    if (claiming) return;
    setFailure(null);
    setSignInFailed(false);

    // §31.4: the documents have to be published before a consent may cite one.
    // Nothing is attempted while they are not, and the reason renders below.
    if (unpublished.length > 0) return;

    // Checked in the browser first so nobody meets a server refusal for
    // something visible from here. The server re-decides regardless (§1.1).
    if (!recordComplete) {
      setShowMore(true);
      window.requestAnimationFrame(() => {
        moreRef.current?.scrollIntoView({ block: 'nearest' });
      });
      return;
    }

    setClaiming(true);

    // "Tapping agree ... confirms everything above" — the four representations
    // the reference's own legal line makes, each its own column (§28.4).
    const pressed: CreatorPatch = {};
    for (const key of PRESSED_CONFIRMATIONS) pressed[key] = true;
    autosave.queue(pressed);

    try {
      // Everything on this screen has to be stored before the claim reads it
      // back: the service re-reads the profile rather than trusting a body.
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
      setShowMore(true);
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

  const termsPolicy = loaded.policies.find((policy) => policy.slug === 'terms');
  const aupPolicy = loaded.policies.find((policy) => policy.slug === 'affiliate-aup');
  const moreOpen = showMore || failure !== null;

  return (
    <div className="crf-agree" ref={stageRef}>
      <header className="crf-agree__bar">
        {/* The visible word is the reference's — one syllable, `Back`, and it
            is what a person reads. §33.11.4 refuses a bare `Back` because an
            objectless CTA names nothing, and it reads the ACCESSIBLE name; so
            the destination rides in an `sr-only` span. The rendered pixels are
            the reference's and the announced control is "Back to Your
            numbers". */}
        <button
          type="button"
          className="crf-agree__back"
          onClick={() => leaveToPage('verify', -1)}
        >
          <BackArrow />
          Back
          <span className="sr-only"> to Your numbers</span>
        </button>
      </header>

      <div className="crf-agree__screen">
        <div className="crf-agree__row">
          <div className="crf-agree__head" data-agree="head">
            <h1 className="crf-agree__title">{CREATOR_AGREE_HEAD}</h1>
            <p className="crf-agree__lede" data-agree="lede">
              {CREATOR_AGREE_LEDE}
            </p>
          </div>

          <div className="crf-agree__panel">
            <Promise title={CREATOR_AGREE_CONTROL_TITLE} body={CREATOR_AGREE_CONTROL_BODY} />
            <Promise title={CREATOR_AGREE_MONEY_TITLE} body={CREATOR_AGREE_MONEY_BODY} />

            <p className="crf-agree__legal crf-agree__legal--primary">
              {CREATOR_AGREE_LEGAL_PRIMARY}
            </p>

            <p className="crf-agree__legal crf-agree__legal--terms">
              {CREATOR_AGREE_TERMS_LEAD}
              <PolicyName label={CREATOR_AGREE_TERMS_TERMS} route={termsPolicy?.route} />
              {CREATOR_AGREE_TERMS_SEP}
              <PolicyName label={CREATOR_AGREE_TERMS_AUP} route={aupPolicy?.route} />
              {CREATOR_AGREE_TERMS_LAST_SEP}
              {/* No route and no consent row: §31.5's IP agreement is per
                  campaign and is taken at §14.2 acceptance. The reference draws
                  all three the same way and none of them as a link. */}
              <b>{CREATOR_AGREE_TERMS_IP}</b>
              {CREATOR_AGREE_TERMS_TAIL}
            </p>
          </div>

          {/* The completion panel and the action share ONE grid area.
              `grid-template-areas` names three rows, so anything without an
              area auto-places into an implicit FOURTH one — which put the panel
              under the button. Found by the browser pass; jsdom has no grid. */}
          <div className="crf-agree__tail">
          {/* Only what the record is actually short of. On a completed walk
              this never opens; on a link opened straight at `/agree` it opens
              once. */}
          {moreOpen ? (
            <section className="crf-agree__more" ref={moreRef} aria-live="polite">
              <h2 className="crf-agree__more-title">{CREATOR_AGREE_MORE_TITLE}</h2>
              <p className="crf-agree__more-body">{CREATOR_AGREE_MORE_BODY}</p>

              <div className="crf-agree__fields">
                <div className="crf-agree__field">
                  <label className="crf-agree__label" htmlFor="crf-agree-dob">
                    {CREATOR_AGREE_MORE_DOB_LABEL}
                  </label>
                  <input
                    id="crf-agree-dob"
                    className="crf-agree__input"
                    type="date"
                    autoComplete="bday"
                    value={dateOfBirth}
                    onChange={(event) => setFact('dateOfBirth', event.target.value)}
                  />
                </div>

                <div className="crf-agree__field">
                  <label className="crf-agree__label" htmlFor="crf-agree-country">
                    {CREATOR_AGREE_MORE_COUNTRY_LABEL}
                  </label>
                  <input
                    id="crf-agree-country"
                    className="crf-agree__input"
                    autoComplete="country-name"
                    aria-describedby="crf-agree-country-hint"
                    value={country}
                    onChange={(event) => setFact('country', event.target.value)}
                  />
                  <p className="crf-agree__hint" id="crf-agree-country-hint">
                    {CREATOR_AGREE_MORE_COUNTRY_HINT}
                  </p>
                </div>

                <div className="crf-agree__field">
                  <label className="crf-agree__label" htmlFor="crf-agree-state">
                    {CREATOR_AGREE_MORE_STATE_LABEL}
                  </label>
                  <input
                    id="crf-agree-state"
                    className="crf-agree__input"
                    autoComplete="address-level1"
                    value={stateRegion}
                    onChange={(event) => setFact('stateRegion', event.target.value)}
                  />
                </div>
              </div>

              {/* §11 records what somebody states; nothing here derives an age
                  from the date above, and the box is not ticked for anybody. */}
              {AGE_CONFIRMATION ? (
                <div className="crf-agree__block">
                  <label className="crf-agree__check">
                    <input
                      type="checkbox"
                      checked={age18Plus}
                      onChange={(event) => setAge(event.target.checked)}
                    />
                    <span>{AGE_CONFIRMATION.label}</span>
                  </label>
                  <p className="crf-agree__hint">{CREATOR_AGE_IS_YOUR_STATEMENT}</p>
                </div>
              ) : null}

              {/* Only when a reload lost it. Somebody who walked straight here
                  never sees this field, and somebody who did not is told why. */}
              {passwordKnown ? null : (
                <div className="crf-agree__block">
                  <label className="crf-agree__label" htmlFor="crf-agree-password">
                    Your password, once more
                  </label>
                  <input
                    id="crf-agree-password"
                    className="crf-agree__input"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setDraftPassword(event.target.value);
                    }}
                  />
                  <p className="crf-agree__hint">
                    We never keep your password anywhere between pages, so a refresh loses
                    it. Everything else you entered is saved. {CREATOR_PASSWORD_NEVER_PLAIN}
                  </p>
                </div>
              )}

              {failure ? (
                <p className="crf-agree__trouble" role="alert">
                  {failure}
                </p>
              ) : null}
            </section>
          ) : null}

          {/* §31.4's refusal, rendered where the control would be. The account
              cannot be created while a document it would cite is a draft, and
              saying so is better than a button that answers with a server
              error. */}
          {unpublished.length > 0 ? (
            <p className="crf-agree__unpublished" role="status">
              We cannot create your account yet: the agreements you would be accepting are
              still with our lawyers, and we will not ask you to sign something that is not
              final. Nothing you have entered is lost — it is saved against your invitation,
              and we will email you the moment this opens.{' '}
              <a href={supportMailto(`Creator signup — ${loaded.landing.reference}`)}>
                Ask us about it
              </a>
              .
            </p>
          ) : (
            <div className="crf-agree__action">
              <button
                type="button"
                className="crf-agree__cta"
                data-agree="cta"
                disabled={claiming}
                onClick={() => void agree()}
              >
                {claiming ? 'Creating your account…' : CREATOR_AGREE_CTA}
                {claiming ? null : <ForwardArrow />}
              </button>
            </div>
          )}

          {signInFailed ? (
            <p className="crf-agree__trouble crf-agree__trouble--loose" role="alert">
              {CREATOR_SIGN_IN_AFTER_CLAIM_FAILED} <a href="/signin">Go to sign in</a>
            </p>
          ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One of the two named documents Proovd actually takes a consent for.
 *
 * The label is the reference's own — `Terms` and `Acceptable Use Policy`, not
 * the register's longer titles — because the sentence is the reference's. The
 * reference marks all three names up as a `<b>` with no `href`; the two with a
 * published route render in the same treatment as a real link, because §31.4
 * wants the document readable before it is accepted. Without a route it falls
 * back to the `<b>` rather than to a dead anchor.
 */
function PolicyName({ label, route }: { label: string; route?: string }) {
  if (!route) return <b>{label}</b>;
  return (
    <a className="crf-agree__doc" href={route} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}
