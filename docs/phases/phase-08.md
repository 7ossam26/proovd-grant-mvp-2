# Phase 08 — Affiliate recruitment, signup, and the Campaign kit

**Model:** Opus 4.8 — The preparing-state pre-view is a deliberate, logged, revocable confidentiality exception. Getting its boundaries wrong exposes a Founder's unprotected product information to someone who hasn't signed anything.

**Goal:** Admin recruits campaign-specific Creators, they claim private accounts through a compact flow, and on `founder_signup_complete` the campaign appears to them in `preparing` with a readable Campaign kit — and no ability to accept, decline, propose, or begin work.

The third actor arrives. Note what they *cannot* do yet: that's most of this phase.

---

## Read first

- Spec §8 — Phase 2, Admin recruits campaign-specific Affiliates
- Spec §11 — Phase 5, compact signup and payout onboarding
- Spec §10, "Affiliate handoff at `founder_signup_complete`" — the preparing reveal and the pilot exception
- Spec §5.3 — Affiliate subtypes and required verification evidence
- Spec §23.4 — association states
- Spec §31.5 — Creator-only IP and confidentiality terms, including the pre-view exception
- Spec §25.4 — the Affiliate record and per-campaign association
- Spec §2.2 — the three-slot active-partnership cap

---

## Prerequisites

Phase 07 green — `founder_signup_complete` fires, and this phase is its first consumer.

---

## Scope

### 1. Admin recruitment

A campaign-specific Affiliate prospect carrying all nineteen fields in §8: full legal name and public handle, email and phone, channel subtype, primary URL or channel reference, audience niche and campaign fit, audience size, engagement evidence, demographics where available, permission/ownership basis, prior sponsored content and compliance evidence, Admin-written bio, internal quality tier, verification status and evidence, recruitment source and recruiting Admin, associated Founder and campaign, initial-roster or mid-campaign intent, conflict notes, sanctions and red-flag notes, internal comments.

**Internal quality tier is assessment data only — never a commission floor** (§8).

Verification evidence is subtype-appropriate per §5.3's table: social creator, newsletter/blog operator, podcast host, community owner, course instructor, student affiliate, niche marketer. Each has its own required inputs.

Admin can send, resend, or revoke **one** private campaign-specific signup invitation. There is no generic Affiliate credential email and **no public signup route** anywhere in the product.

### 2. The invitation

Names the Founder and product, why this Affiliate and channel were recruited, which public presence Proovd reviewed, that signup is for this specific campaign, that the opportunity may still be preparing, and that declining later does not harm standing. One secure account-claim action and a support route.

**It must not request bank, tax, password, or identity information by email.**

### 3. Compact signup (§11)

**One** compact account-and-profile flow with a single primary action: `Confirm and create account`. Contains the password/claim field, prefilled legal and public identity, email and unverified phone, primary channel type and handle, niche, audience metric, Admin-written bio, a source label for prefilled public information with the ability to correct it, date of birth, country, state, Terms and Affiliate AUP acceptance, and explicit confirmations that they are 18+, US-based, the actual operator behind the public presence, not running duplicate accounts, and sanctions/OFAC eligible.

After account creation the only additional primary action is **`Finish payout setup`**, which opens Stripe-controlled onboarding.

**Stripe lands in Phase 10.** Build the surface and the status states here; wire the actual hosted onboarding next phase but one. §32.1 deliberately orders signup before connected-account work.

**No welcome tour, no multi-page education sequence, no separate banking page, no public signup.** §33.2.2 tests for their absence.

### 4. The conditional states

| Condition | Surface |
|---|---|
| Founder not yet claimed | Confirms signup, names the campaign, says the Founder is finishing setup, identifies Proovd as owner, gives a next-update expectation, and says **`No action needed`** |
| Founder claimed, listing unpaid | Preparing campaign + Campaign kit with `Review campaign`. Compensation decisions and work **disabled** |
| Listing paid | Formal decision state — **Phase 12** |
| Stripe onboarding incomplete | Review continues; tracking-link activation and payment receipt blocked. Shows the exact missing requirement, whether Affiliate action is needed, and a Stripe-managed resume action |
| Stripe valid from a prior campaign | Reuse it. **Never ask an Affiliate to re-enter valid provider data** |

Every one of these uses the Phase 02 StatePanel.

### 5. The preparing reveal

On `founder_signup_complete`, for every eligible authenticated Affiliate already associated with the campaign:

- the named campaign appears automatically in `preparing` **exactly once**;
- a transactional notification carries **one** action: `Review campaign`;
- they may read the complete currently-available Founder, Problem, Solution, and Competition information plus the single Campaign kit.

**This is a recorded pilot-only trusted-cohort exception.** Private, authenticated, logged, campaign-scoped, and revocable — not a public disclosure (§10, §31.5). Every access is logged. Revocation removes it immediately.

They **cannot** accept, decline, propose compensation, activate a link, or begin work until listing-fee payment makes the opportunity formally actionable. The per-campaign IP and confidentiality agreement is still required before any work.

### 6. The Campaign kit — preparing edition

All material lives in **one** Campaign kit. §30 explicitly defers a reusable resource library or education journey; the single kit is the required shape.

At preparing stage it shows available materials and, once Phase 09 computes it, the high-effort result and its objective basis. It **must not present a mutable compensation decision before formal activation** (§12). The complete formal kit (§14.1) is Phase 12's job.

### 7. Founder view

After account claim the Founder sees each recruited Creator's public card and current status. The Founder **cannot browse a general pool, cannot contact a Creator directly, and cannot inspect sensitive onboarding data.** §30 defers direct Founder–Affiliate messaging; don't build a workaround.

### 8. Association states

`prospect` → `invited` → `signup_started` → `signed_up_waiting_for_founder` → `preparing`, using the Phase 03 state machine. Initial-roster vs mid-campaign designation is stored separately.

**Preparing, invited, and declined associations do not occupy an active-partnership slot** (§8). A slot runs from tracking-link activation until campaign close or recorded removal, and one Affiliate may hold no more than three (§2.2).

---

## Out of scope

Formal opportunity, accept/decline/propose, the compensation matrix — Phase 12. Stripe onboarding — Phase 10. Tracking links and activation — Phase 14. Mid-campaign addition — Phase 17.

---

## Traps

- **No public signup route.** Not disabled, not hidden behind a flag — absent. §33.2.1.
- **The preparing pre-view is confidentiality-sensitive.** It exists only because §31.5 carves out a logged, revocable, pilot-only exception, and it grants **no work permission**. Every read is logged and Admin can revoke instantly.
- **Preparing must not expose a compensation decision.** Showing the base percentage as information is fine; showing an actionable control is not (§12).
- **`Finish payout setup` must not be a custom form.** §11: Proovd must not reproduce provider-controlled banking or identity fields. It's a handoff, not a UI.
- **Exactly once.** Retries must not produce a second preparing-visibility event or a second email (§10, §33.2.5).
- **Internal tier never sets a floor.** It's assessment data. If it reaches a compensation calculation, that's a §1 rule 6 violation.
- **Affiliates never receive Backer PII** — enforce it at the query layer now, before there's any Backer data to leak.

---

## Done when

- [ ] No public Affiliate signup route exists; an invitation claims only that Affiliate's account and association — **§33.2.1**
- [ ] The compact flow has exactly two primary actions — Proovd account, then Stripe payout — with no custom bank form and no tour — **§33.2.2**
- [ ] The waiting state is named, explains ownership and the next update, and says `No action needed` — **§33.2.3**
- [ ] The Campaign kit is complete, private, authenticated, logged, campaign-scoped, and revocable — **§33.2.4**
- [ ] `founder_signup_complete` reveals the preparing campaign to eligible campaign-specific Affiliates **exactly once**, with no duplicate email after retries — completes **§33.1.9**
- [ ] Accept, decline, propose, and link activation are unreachable in preparing state
- [ ] Prefilled public information carries a source label and is correctable
- [ ] Preparing, invited, and declined associations consume no active-partnership slot
- [ ] The Founder sees status cards only — no contact route, no pool browsing, no onboarding data
- [ ] Admin sees eligibility data, policy versions, corrections, waiting/preparing status, and full invitation history without re-keying anything

**Acceptance:** §33.2.1, §33.2.2, §33.2.3, §33.2.4, and the second half of §33.1.9.
