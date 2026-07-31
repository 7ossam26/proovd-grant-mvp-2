# Proovd MVP Engineering Implementation Specification

**Version:** 1.0

**Status:** Standalone source of truth for engineering and implementation

**Companion:** Proovd DNA UX document controls visual, interaction, and content-design execution. This specification controls product behavior, roles, data, pages/surfaces, state transitions, payments, operations, edge cases, and acceptance.

**Scope:** The complete production MVP. Stripe application, Sales outreach, underwriting correspondence, and application-document preparation are intentionally excluded. Stripe product integration, payment behavior, tax treatment, connected-account behavior, test-mode requirements, and live-processing gates remain in scope because the app cannot function safely without them.

---

## 1. How to use this document

This is the product's ingredient list and behavioral contract, not a wireframe, form specification, or visual-design document. An engineer or coding agent must be able to receive this file plus the Proovd DNA UX document and implement one section, one phase, or the whole MVP without needing oral product context.

Rules for implementation:

1. `Must`, `required`, and declarative statements are mandatory MVP behavior.
2. A page or surface may be composed differently under the DNA UX system, but it must expose every item, action, state, disclosure, and recovery path specified here.
3. Manual work is valid MVP behavior only when the app records it. Every manual review, decision, override, money action, and exception stores actor, time, reason, prior value, new value, amount where relevant, provider object IDs, notes, and evidence.
4. The system must never imply automation that does not exist. Manual steps are presented truthfully as guided review, safety control, or human support.
5. Customer-facing names and internal names are not interchangeable. The naming contract in Section 3 is mandatory.
6. No implementation may invent a new commercial rule, deadline, fee, eligibility condition, payout rule, campaign state, or consent. If a case is not expressly automated, send it to Admin review and preserve a complete audit record.
7. The chronological lifecycle in Sections 6–22 is the controlling build spine. Cross-cutting contracts later in the document define details that apply at every relevant phase.
8. If the DNA UX document conflicts with this specification on business behavior, state, money, consent, eligibility, data access, or timing, this specification controls. If this specification does not define visual treatment, the DNA UX document controls.

### 1.1 Definition of a complete implementation

A section is complete only when all of the following exist where applicable:

- User-visible page or surface content and actions.
- Loading, empty, waiting, success, failure, expired, revoked, suspended, and retry states.
- Server-side authorization and eligibility checks.
- Persistent records and version history.
- State transition and idempotency protection.
- Transactional notification and durable product-history record.
- Admin visibility, ownership, due time, and recovery action.
- Audit event.
- Mobile, keyboard, focus, label, contrast, and screen-reader behavior.
- Named acceptance tests, including negative and duplicate-event cases.

---

## 2. Product definition and non-negotiable operating model

Proovd is a founder-led crowdfunding software platform powered by trusted distribution. Crowdfunding is the mechanism; the product is a way for a founder to prove demand with money on the line.

The platform serves four actors:

- **Founder:** the seller and merchant of record for the campaign's digital rewards.
- **Affiliate/distribution partner:** a trusted promoter recruited for a specific campaign. The founder-facing name is `Creator`.
- **Backer:** a US adult who saves a card, places a pre-order, and may later be charged under the disclosed campaign rule.
- **Admin:** Proovd's internal operator performing invitation, review, recruitment, verification, risk, payment, support, and enforcement work.

The MVP is manual behind a polished surface. Founder review, campaign review, affiliate recruitment, affiliate verification, first-post verification, deliverable completion, bonus decisions, tax and payout readiness, failed-payment monitoring, refunds, disputes, milestones, and exception handling are Admin-operated.

### 2.1 Legal and payment identity

- Proovd LLC is a Delaware software platform.
- The Founder is seller and merchant of record for every campaign transaction.
- The Founder owns and is responsible for the offered product/reward, delivery, product support, taxes, law compliance, refunds, disputes, chargebacks, reversals, negative balances, and recovery obligations.
- Proovd is merchant of record only for the separate Founder listing fee.
- Proovd is not a reseller, owner of campaign goods/services, escrow provider, trust, custodian, donation platform, investment platform, equity crowdfunding platform, charity platform, political fundraiser, or sweepstakes platform.
- Campaign payments use Stripe Connect only under the production configuration confirmed for the account. No UI may claim approval before it exists.
- Never describe money as escrowed, held in trust, held in custody, or held in a Proovd bank account.

### 2.2 Launch limits

- One controlled pilot campaign is enabled first.
- Founders, Affiliates, and Backers are US-only and 18+.
- Backer billing country must be `US`.
- Currency is USD.
- Rewards are digital-only.
- Physical goods and mixed digital/physical rewards are rejected.
- Regulated medical, financial, legal, investment, brokerage, crypto, gambling, weapons, quasi-cash, and other prohibited or restricted categories are rejected.
- Enterprise procurement where a company is the buyer is rejected; prosumer and creator tools bought personally may qualify.
- The aggregate **pre-tax** value of active pre-orders is capped atomically at US$50,000 per campaign. A transaction that would exceed capacity is rejected or waitlisted, never partly accepted.
- One Founder may have only one active campaign.
- After a campaign ends, the Founder waits at least three months and still needs an Admin `ready for next campaign` decision.
- One Affiliate may occupy no more than three active-partnership slots. A slot runs from tracking-link activation until campaign close or recorded removal.

### 2.3 Product categories allowed at launch

Allowed after review:

- Consumer software and SaaS.
- Mobile apps.
- Prosumer tools.
- Creator tools.
- Online courses.
- Downloadable files.
- API access.
- Beta enrollment.
- Login-, invite-, access-key-, redemption-code-, or subscription-based digital access.
- Digital books, educational products, and other reviewed digital services.

Every product, claim, category, tax code, and delivery promise remains subject to Admin review. MCC 5734 may be requested for applicable software activity, but no category is universally hard-coded to it and MCC 6051 is never used.

---

## 3. Canonical language contract

### 3.1 Customer-facing and internal names

| Meaning | Customer-facing | Internal |
| --- | --- | --- |
| Idea validation campaign | Idea Campaign | Pre-build |
| Live/near-launch product campaign | Product Campaign | Pre-launch |
| Saved-card commitment | Pre-order / active pre-order | Reservation |
| Founder-facing distribution partner | Creator | Affiliate / distribution partner |
| Idea Founder payout | Single Founder payment | `single_payment` |
| Product Founder payouts | First payment / remaining payment | `first_payment` / `remaining_payment` |

`Pre-build`, `Pre-launch`, `reservation`, and `tranche` must never render to Founders or Backers. Technical sample URLs may retain `sample-pre-build` and `sample-pre-launch`, but all rendered content uses customer-facing names.

### 3.2 Required replacements

| Do not say | Say |
| --- | --- |
| pledge / pledged | reserve a pre-order / reserved / authorize a future charge |
| donate / donation / tip | pre-order / founding-member contribution |
| all-or-nothing | conditional charge contingent on the order threshold |
| campaign goal for an Idea Campaign | order threshold |
| funding threshold for a Product Campaign | close date; internal momentum target if needed internally |
| we route money / we pay founders | charges are processed through Stripe Connect in the approved account context; payout availability follows the disclosed controls |
| equity / investment / ROI / returns | reward package / founding-member benefit |
| anyone can launch | vetted founders apply through Proovd onboarding |
| escrow / trust / custody / Proovd bank hold | Stripe Connect payout controls or the actual approved configuration |
| US$0 charge | card saved; not charged today |
| upfront fee / upfront payout | optional fixed Creator payment / secured Creator payment / Creator payment funded |
| first half / final half | fixed Creator payment pending completion / fixed Creator payment paid |

`Crowdfunding` is acceptable where needed for clear product, policy, safety, or payment explanation. It is not a donation or investment term.

Internal schema/log naming uses `reservation`, `captured_charge`, `listing_fee`, `platform_fee`, `founder_share`, `single_payment`, `first_payment`, `remaining_payment`, and `affiliate_compensation`. Do not name tables, fields, jobs, or logs in a way that implies escrow, custody, trust, or a Proovd bank hold; internal names can leak into Admin/errors/support.

### 3.3 Money-language rule

Every money-related confirmation states:

- Amount.
- Reward subtotal, sales tax, and total separately where relevant.
- Whether money moved.
- Trigger/date or completed date.
- Seller and merchant of record.
- Expected statement descriptor.
- Cancellation, refund, or recovery path.
- Current owner and next update when incomplete.

---

## 4. Campaign models

### 4.1 Idea Campaign

An Idea Campaign validates a concept, prototype, mockup, early demo, repository, landing page, or materially unfinished digital product.

- Publicly discloses an integer order threshold.
- Threshold is the number of practical unique Backers with active pre-orders at `campaign_close_at`, not a dollar amount.
- Each Backer may have only one active Idea-Campaign pre-order and may change the selected reward before close.
- A canceled pre-order does not count.
- `threshold reached` and `threshold lost` may happen multiple times before close and are separate idempotent events.
- The final threshold decision is made from active unique Backers exactly at close.
- If below threshold, no PaymentIntent is created, no card is charged, all reservations close as no-charge, and future-charge eligibility is removed.
- If at or above threshold, the outcome remains successful even when later cards fail. The Founder proceeds with actual collected money after the 48-hour retry window.
- Backers may cancel free before close.
- Promotional material communicates that the product is early, may be delayed, and may in rare cases not exist.
- After a valid captured charge there is no voluntary/change-of-mind refund; defined error, misrepresentation, non-delivery, serious-violation, law, Stripe, and issuer exceptions remain.
- The Founder receives one Founder payment: 100% of the eligible share at Day 3 after retry completion, W-9, risk/payment checks, and recorded Admin approval. No second payment exists. Day 14 is enforcement/fulfillment review only.

#### Practical unique-Backer decision

`Unique Backer` is a fraud-control decision, not verified civil identity. The system derives a private deduplication key from normalized email and phone, supplements it with Stripe payment-method fingerprint when available, and stores device/IP risk signals. Suspected duplicates enter an Admin queue before close.

- Shared IP alone never merges two Backers.
- Admin may merge or separate only with recorded reason, evidence, prior value, new value, actor, and timestamp.
- Threshold updates are idempotent after the decision.
- Customer copy promises reasonable deduplication and review, never perfect identity prevention.
- Identity-document collection is deferred unless a recorded risk case requires it.

### 4.2 Product Campaign

A Product Campaign is a founding-member pre-sale for a live or near-launch digital product or feature.

- Has no charge threshold.
- Every active transaction charges at the disclosed close date.
- Keep-what-you-raise: missing an internal target does not trigger refunds.
- Every reward has a delivery month/year.
- Public momentum emphasizes unique Backers, units, and launch momentum, not a public dollar goal that suggests a refund gate.
- One Backer may create multiple transactions; each transaction contains one reward, consent, tax calculation, SetupIntent, and cancellation state.
- Unique Backer count remains a person metric; units, value, cap, and captured revenue count all transactions.
- Backers may cancel free before close; the Founder is notified.
- Post-charge voluntary refunds follow the immutable Founder refund-policy version disclosed at campaign and checkout, subject to law, Stripe, card-network, card-issuer, and Proovd policy.
- Founder payments are 40% of eligible share at Day 3 and 60% at Day 14 by default. The remaining payment may release after Day 3, never before, only after Admin verifies actual delivery/live access, required Backer communication, tax readiness, and no immediate red flags.

---

## 5. Actor, account, and access contract

### 5.1 Admin

- Internal accounts are seeded directly; there is no signup or public invitation.
- Email/password authentication and MFA are mandatory.
- Money movement, refund, connected-account, campaign kill/suspend, and other high-impact actions require recent reauthentication.
- All Admins may have full functional access in MVP; a full hierarchy is deferred.
- Every sensitive action creates an immutable audit record.

### 5.2 Founder

- US-based and 18+.
- Private personalized invitation for the pilot cohort.
- Email/password or Google OAuth.
- A private invitation or Google sign-in may establish invited-email ownership. A future public onboarding route requires email verification.
- Phone is collected and explicitly unverified; no SMS OTP exists.
- Stripe-hosted connected-account onboarding is the identity/KYC source of truth. Proovd stores status and account ID, not Stripe-collected government ID documents.
- Founder settings: name, email, phone, profile photo, password, business/entity data, connected-account status, read-only KYC status, notification preferences, post-close W-9 status, and delete-account request.

### 5.3 Affiliate/distribution partner

- US-based and 18+.
- No open public signup.
- Enters only through a private, campaign-specific invitation.
- Personally creates or claims the invited account and accepts Terms/AUP; an agency or manager cannot accept for the actual operator.
- Phone is collected and unverified.
- Stripe-controlled onboarding collects the identity, tax, bank, and payout information required for the approved recipient configuration. Proovd stores only connected-account/capability/requirement/payout statuses and IDs, never full bank details.
- Affiliate settings: name, email, phone, password, channel type/handles, audience metrics, niche, bio, connected-account/transfer/tax/payout status, notification preferences, and delete-account request.

Supported subtypes and verification inputs:

| Subtype | Required profile/verification evidence |
| --- | --- |
| Social creator | Platform, followers, engagement, demographics, analytics, audit where appropriate |
| Newsletter/blog operator | Subscribers, click-through, engagement, prior sponsored content |
| Podcast host | Followers/subscribers, downloads/listens, prior sponsorships |
| Community owner | Members, active-user/engagement indicators, rules and permission |
| Course instructor | Enrolled students, ratings, platform constraints |
| Student affiliate/network distributor | KYC, handles, written promotion plan, institution-disclaimer need |
| Niche marketer/distribution partner | Channel access, identity-disclosed presence, compliant traffic plan, campaign-fit evidence |

### 5.4 Backer

- Guest-only; no password account.
- Uses long-lived, campaign-scoped magic-link access.
- Must confirm 18+ with an unchecked control.
- Must have US billing location.
- Provides email, unverified phone, billing country/postal code, and full billing address only where tax/payment configuration requires it.
- Provides a payment method only through Stripe-controlled fields.
- Magic link grants access only to that Backer's view of that campaign and transactions.

### 5.5 Password and link recovery

- Founder, Affiliate, and Admin have email-link password reset.
- Backer has no password reset. Admin can resend/reissue a magic link.
- Invalid, expired, revoked, or malformed links never render a blank/generic error. They explain that the link cannot be used, expose no account existence or PII, and provide a context-preserving support route. A secure, rate-limited, non-enumerating self-resend may be added if cheap.

---

# PART II — CHRONOLOGICAL IMPLEMENTATION LIFECYCLE

Every phase uses the same lenses. A role marked `No direct surface` still may receive notification or create a system record.

| Phase | Controlling outcome |
| ---: | --- |
| 0 | Global settings and live/test gates exist |
| 1 | Admin sends a secure, personalized Founder draft |
| 2 | Admin recruits and privately invites campaign-specific Affiliates |
| 3 | Founder completes type-locked pre-account vetting |
| 4 | Founder sees possible-Creator result, claims account, and reveals preparing campaign to pre-associated Affiliates |
| 5 | Affiliate claims account and completes/reuses provider payout onboarding |
| 6 | Founder optional evidence, interview, high-effort, and listing price resolve |
| 7 | Founder connected onboarding and listing payment activate the formal clock |
| 8 | Affiliate decisions/proposals and Founder campaign building run in parallel |
| 9 | Initial roster and build become review-ready; Admin reviews and versions changes |
| 10 | Fixed allocation and every Creator-readiness input complete |
| 11 | Campaign page/link/post launch occurs in strict order; Admin verifies posts |
| 12 | Public campaign/discovery/attribution rules govern visitors |
| 13 | Backer saves card, consents, receives magic-link access, and is not charged today |
| 14 | Founder, Creator, Backer, and Admin operate the live campaign |
| 15 | Close fixes the outcome, charges eligible pre-orders, retries failures, and prepares results |
| 16 | Creator/Founder money, fulfillment, enforcement, completion, and future collaboration resolve |

## 6. Phase 0 — Global configuration and production prerequisites

### Admin

Before an invitation can be sent, Admin has a settings surface containing:

- Listing-fee base: US$35.
- US$2 discounts for completed Visuals, Branding, confirmed Founder interview, Story, and Socials.
- Maximum discount: US$10; minimum listing fee: US$25.
- Platform fee: 5% of captured pre-tax reward subtotal.
- Base Affiliate percentages: 30%; 20% when an accepted Product-Campaign fixed Creator payment exists.
- Percentage compensation ceiling: 50% per attributed captured charge.
- High-effort inputs: no Visuals, no Branding, and no confirmed/scheduled Founder interview.
- Campaign cap: US$50,000 aggregate pre-tax active-pre-order value.
- Product Campaign default duration: 14 days; approved min/max duration.
- Failed-payment retry window: fixed 48 hours.
- Pre-charge reminder: approximately 24 hours before trigger.
- Affiliate formal-response window: fixed 72 hours from `listing_paid_at`.
- Founder free-cancellation window: 48 hours from `listing_paid_at`, only while not live.
- Creator replacement window: three US business days from `creator_failure_recorded_at`.
- US business-day calendar, timezone, holiday version, and exact deadline calculation.
- Founder repeat-campaign cooldown: at least three months.
- Founder payment schedules: Idea 100% Day 3; Product 40% Day 3 / 60% Day 14.
- Product early-remaining-payment control, disabled by default and evidence-gated.
- Interview providers, interview availability, interviewers, and reminder lead times.
- Default required promotional post count: three.
- Support SLA: one business day, Monday–Friday excluding US federal holidays.
- Admin MFA and reauthentication window.

Admin can also verify that required public routes, policies, support details, sample campaigns, transactional email configuration, Stripe test/live separation, webhook endpoints, tax configuration gates, and pilot feature flags are present. Incomplete prerequisites fail closed.

### Founder

No direct surface.

### Affiliate

No direct surface.

### Backer

No direct surface.

### System and records

- Environment refuses a live/test key mismatch, live connected account in test mode, test account in live mode, or webhook secret/mode mismatch.
- No live card collection, SetupIntent, PaymentIntent, Affiliate Transfer, payout promise, or fixed-payment funding is enabled until the applicable payment, tax, legal, capability, policy, security, and test gates are recorded as complete.
- The first live enablement is limited to one named pilot with monitoring and rollback owners.

---

## 7. Phase 1 — Admin creates the Founder invitation and campaign draft

### Admin actions

Admin creates a Founder prospect and the initial campaign container after off-platform discovery. Admin may record the product, launch frame, US/18+ fit, delivery feasibility, early compensation expectations, and affiliate-sourcing hypothesis, but must not promise acceptance, results, reward pricing, or participation by a specific Creator.

The invitation-creation surface contains:

- Recipient legal/preferred name.
- Recipient email and phone if known.
- Founder/product reference.
- Product/startup name and URL if available.
- What Proovd understood about the product.
- Why the Founder was invited.
- Named Proovd sender and reply route.
- Invitation source and internal campaign owner.
- Expected setup time stated honestly.
- Process summary and no-guarantee language.
- Secure temporary-draft status.
- Admin notes and discovery evidence.

Admin can create, preview, send, resend, and revoke. Preview must show final variables and no unresolved placeholder. Send stores recipient, sender, invitation source, sent time, notification ID, draft ID, token version, expiration, and status.

### Founder experience

The invitation email is specific, recognizable, and transactional. It contains:

- The Founder/product reference.
- What Proovd understood.
- Why the Founder was selected.
- Who sent it.
- What the process includes.
- Honest time expectation.
- No guarantee of Creator acceptance or campaign result.
- Reply/support path.
- One secure temporary-draft action.

The temporary-draft landing state names the Founder/product and explains what will happen before an account or payment is required.

### Affiliate

Campaign-specific recruitment may already begin in parallel. See Phase 2.

### Backer

No direct surface.

### State and security

- Campaign: `invited_draft`.
- Draft token has at least 128 bits of entropy; only its hash, version, issued time, expiration, last-used time, revoked time/reason, and lineage are stored.
- Raw token exists only in the delivered URL and is never logged.
- Token is scoped to one invited draft and grants no account, Admin, payment, or other-Founder access.
- Resend rotates the token, invalidates all older versions immediately, and restarts the 30-day unclaimed-draft retention period.
- Revocation removes access immediately.
- Claim, expiration, or revocation prevents replay.
- Two concurrent claims yield one account and one failed safe response.
- Unclaimed draft content is deleted or irreversibly anonymized 30 calendar days after the most recent send; minimum audit evidence remains.

---

## 8. Phase 2 — Admin recruits campaign-specific Affiliates

This phase can start before, during, or after Founder onboarding. It does not start the paid 72-hour response clock.

### Admin actions

Admin creates a campaign-specific Affiliate prospect with:

- Full legal name and public-facing name/handle.
- Email and phone.
- Channel subtype.
- Primary URL, handle, newsletter, podcast, community, course, network, or owned-distribution reference.
- Audience niche and why the campaign fits.
- Audience size/access metric.
- Engagement, click, active-user, download, enrollment, rating, or other appropriate evidence.
- Audience demographics where available.
- Permission/ownership basis for the channel.
- Prior sponsored content and compliance evidence where relevant.
- Admin-written bio.
- Internal quality tier, used only as assessment data—not as a commission floor.
- Verification status and evidence.
- Recruitment source and recruiting Admin.
- Associated Founder and campaign.
- Intended initial-roster or possible mid-campaign designation.
- Conflict notes, sanctions/red-flag notes, and internal comments.

Admin can send, resend, or revoke one private campaign-specific signup invitation. No generic Affiliate credential email and no public signup exist.

### Affiliate invitation

The email names:

- Founder and product/campaign.
- Why this Affiliate/channel was recruited.
- Which public presence Proovd reviewed.
- That signup is for this specific campaign.
- That the opportunity may still be preparing.
- That declining later does not harm standing.
- One secure account-claim action and support route.

It must not request sensitive bank, tax, password, or identity information by email.

### Founder

The Founder does not browse or contact a general Affiliate pool. The Founder may later see only the recruited campaign roster and its statuses.

### Backer

No direct surface.

### State and records

Association states may include `prospect`, `invited`, `signup_started`, `signed_up_waiting_for_founder`, and later states defined in subsequent phases. Preparing/invited/declined associations do not occupy an active-partnership slot.

---

## 9. Phase 3 — Founder completes pre-account vetting

### Founder temporary-draft sequence

The draft collects one decision at a time. Visual arrangement follows the DNA UX document, but the sequence and information are fixed:

1. Campaign path.
2. Problem.
3. Solution.
4. Competition/positioning.
5. Possible-creator result.

The page/surface always provides current progress, Back/Continue behavior, autosave status, and restored-draft information. Returning to an earlier item preserves later valid answers.

#### Step 1 — campaign path

- `I have an idea` creates an Idea Campaign.
- `I have a product` creates a Product Campaign.
- The campaign type locks permanently when vetting is submitted.
- Campaign setup later displays it read-only.
- A wrong locked type is archived and a new vetting record begins. Before listing-fee payment, Admin may create the replacement without another fee. After payment, cancellation/refund rules control.
- No campaign-type migration exists. No Creator acceptance, reward, payment, or consent record is copied automatically.

#### Step 2 — Problem

- Human-prefilled by Proovd from discovery.
- Founder can review and edit.
- Store original text, current text, supplier (`Proovd` or `Founder`), and edit timestamps.

#### Step 3 — Solution

- Human-prefilled by Proovd.
- Founder can review and edit.
- Store the same provenance and version information.

#### Step 4 — Competition/positioning

- Always blank.
- Written by the Founder.
- Must never be prefilled or represented as AI-generated.

Each high-friction field may explain why it is needed: the decision it supports, evidence expected, and what happens next. It must not become legal overcopy.

### Admin

Admin can see the live saved draft, provenance, completeness, last-save time, and errors but does not re-enter Founder data. Admin can revoke the draft or assist through support.

### Affiliate

If already invited and signed up, the Affiliate remains in the named waiting state until `founder_signup_complete`. They cannot see the campaign kit, accept, decline, propose, or begin work yet.

### Backer

No direct surface.

### Autosave and failure behavior

- Status is `Saving…`, `Saved [local time]`, or `Could not save — retrying`.
- A failed save never clears valid fields.
- Returning restores the latest saved draft and says when it was saved.
- Leaving with newer unsaved data causes a browser warning.
- Network, validation, server, and provider errors preserve all valid values and give a safe next action.

### State

Submitting all vetting answers locks the type and sets `vetting_submitted`.

---

## 10. Phase 4 — Possible-creator result and Founder account claim

### Founder possible-creator result

Immediately after valid vetting and before account creation, payment, or Stripe onboarding, show the number of `creators who may be relevant`.

The surface states:

- The count is a relevance signal based on the submitted information.
- It names no Creator.
- It is not the recruited/accepted roster.
- It guarantees neither participation nor results.
- Campaign-specific recruitment may already be underway.
- The listing-fee refund protection later remains available if there are zero eligible recruits or no mutual locked acceptance within the formal 72-hour window.
- For the pre-screened invited cohort, the result must not be zero; a zero result routes to Admin before the Founder proceeds.

### Founder account-claim surface

The account is prefilled from invitation/discovery and every prefilled field is editable. It contains:

- Legal/preferred name.
- Email and ownership status.
- Phone, marked unverified.
- Date of birth.
- Country and state.
- Business name/entity or sole-proprietor status.
- Password creation or Google sign-in.
- Terms, Founder AUP, privacy, and applicable policy acceptance.
- US/18+ and sanctions representations.

Every prefilled field stores whether Proovd or Founder supplied the current value and the edit timestamps.

Successful claim:

- Creates the Founder account.
- Invalidates the draft token.
- Preserves the draft and provenance in the account/campaign record.
- Emits `founder_signup_complete` exactly once.
- Changes campaign to `account_claimed`.

### Affiliate handoff at `founder_signup_complete`

For every eligible authenticated Affiliate already recruited and associated with the campaign:

- The named campaign appears automatically in `preparing` state exactly once.
- A transactional notification has one action: `Review campaign`.
- The Affiliate may read the complete currently available Founder/problem/solution/competition information and the single Campaign kit.
- This is a recorded pilot-only trusted-cohort exception: private, authenticated, logged, campaign-scoped, revocable, and not a public disclosure.
- The Affiliate cannot accept, decline, propose compensation, activate a link, or begin work until listing-fee payment makes the formal opportunity actionable.
- The per-campaign IP/confidentiality agreement is still required before work.

If the Affiliate has not finished Stripe onboarding, they may review the preparing campaign but cannot later activate a tracking link or receive money until the required status/capability is complete.

### Admin

Admin sees account-claim time, provenance, the set of Affiliates who received preparing visibility, delivery status of notifications, and any revoked association. No duplicate visibility event or email may occur after retries.

### Backer

No direct surface.


---

## 11. Phase 5 — Affiliate compact signup and payout onboarding

This may occur before or after the Founder account claim. The Affiliate remains tied to the one campaign that caused the invitation.

### Affiliate account-claim surface

The Proovd portion is one compact account-and-profile flow with one primary action: `Confirm and create account`. It contains:

- Password/account-claim field.
- Prefilled legal and public identity.
- Email and unverified phone.
- Primary channel type, handle/URL, niche, audience metric, and Admin-written bio.
- Source label for prefilled public information and ability to correct it.
- Date of birth, country, and state.
- Terms and Affiliate AUP acceptance.
- Explicit confirmations that the Affiliate is at least 18, US-based, the actual operator behind the public presence, not operating duplicate accounts, and sanctions/OFAC eligible.

After Proovd account creation, the only additional primary onboarding action is `Finish payout setup`. It opens the Stripe-controlled connected-account onboarding required for identity, tax, bank, transfer capability, and payout. Proovd must not reproduce provider-controlled banking or identity fields in a custom form.

There is no welcome tour, multi-page education sequence, separate banking page, or public Affiliate signup.

### Conditional states

- **Founder not claimed:** the same surface confirms signup, names the campaign, says the Founder is finishing setup, identifies Proovd as owner, gives the next-update expectation, and says `No action needed`.
- **Founder claimed, listing unpaid:** show the preparing campaign and Campaign kit with `Review campaign`; compensation decisions and work are disabled.
- **Listing paid:** show the formal decision state described in Phase 8.
- **Stripe onboarding incomplete:** campaign review may continue, but tracking-link activation and payment receipt are blocked. Show the exact missing requirement, whether Affiliate action is needed, and a Stripe-managed resume/update action.
- **Stripe onboarding valid from a prior campaign:** reuse it; never ask the Affiliate to re-enter valid provider data.

### Admin

Admin sees Affiliate-created account time, eligibility data, policy versions, connected-account ID, requirements/transfer-capability/payout status, corrections to prefilled fields, waiting/preparing status, and invitation/association history. Admin never re-enters data already supplied by the Affiliate or Stripe.

### Founder

After account claim, the Founder may see the recruited Affiliate's public card and current status. The Founder cannot contact the Affiliate directly or inspect sensitive onboarding data.

### Backer

No direct surface.

### Tax-accountability gate

Connected-account records do not alone decide who must issue US tax forms. Before any live Affiliate payment, the approved tax/accounting configuration must record payer, 1099 filing responsibility, required tax data/form, thresholds, corrections, and reconciliation responsibilities without duplicating sensitive provider-held data.

---

## 12. Phase 6 — Founder optional materials, interview, high-effort result, and listing-fee calculation

### Founder campaign workspace

The Founder can complete five optional items. They improve the campaign and each objective completion earns a US$2 listing-fee discount:

1. Visuals.
2. Branding.
3. Confirmed Founder interview booking.
4. Story.
5. Socials.

The workspace presents one coherent decision at a time with progress, Back/Continue, autosave, save recovery, and a complete preview/summary in the secondary surface. It is not a widget dashboard or endless form.

#### Objective completion rules

- **Visuals:** at least one non-placeholder campaign visual or video is uploaded, accessible, and Founder-approved for campaign use.
- **Branding:** a usable logo/wordmark and saved direction containing at least colors and typography/style guidance are provided and Founder-approved.
- **Interview:** the embedded booking has `confirmed` status. A selected-but-unconfirmed, canceled, or abandoned slot does not count.
- **Story:** a Founder-approved public campaign story is saved. A prompt response, transcript, generated summary, or unapproved draft does not count.
- **Socials:** at least one valid, accessible, public Founder/product social profile controlled by the Founder is supplied.

Empty files, placeholders, duplicate uploads, inaccessible URLs, unapproved drafts, and unconfirmed appointments do not qualify. Each item stores evidence, completion timestamp, and decision source. Admin may invalidate an item before payment with a reason; the Founder can correct it. After payment, the calculation and evidence snapshot lock.

### Founder helper resources

The workspace contains static, copy-ready guidance—not an embedded AI product—for:

- **Competition:** direct competitors, indirect competitors, status quo, responsible AI-assisted research, source citation, and prohibition on fabricated facts.
- **Branding:** how to use AI for a specific, non-generic brand direction, with a reusable prompt.
- **Visuals:** how to produce brand-consistent visuals that do not look generic or misleading, with a reusable prompt.
- **Story:** how to use ChatGPT Voice Mode as a guided conversation, summarize it, and require Founder approval before public use.

### Embedded Founder interview

The Founder can book a human Proovd interview without leaving the product.

The booking surface and record include:

- Available times in the Founder's timezone.
- Google Meet, Zoom, or Microsoft Teams.
- Scheduled time and canonical UTC value.
- Timezone.
- Meeting provider and link.
- Interviewer.
- Status.
- Reschedule history.
- Cancellation.

Send confirmation, reminder, reschedule, and cancellation notifications. Canceling before listing-fee payment recalculates both high-effort status and the fee. Canceling after successful payment does not change the amount already paid.

### High-effort classification

A campaign is `high_effort = true` only when all three are absent at calculation time:

- No completed Visuals.
- No completed Branding.
- No scheduled/confirmed interview.

Store the three inputs, result, calculation time, and actor/system. Present the criteria neutrally, not as a quality judgment. High-effort status controls only whether an Affiliate can bid a percentage above the base; it does not control fixed-payment availability.

### Listing-fee calculation

```text
base = US$35
discount = US$2 × completed optional items
discount cap = US$10
minimum subtotal = US$25
listing fee subtotal = max(US$25, US$35 - discount)
sales tax = Stripe Tax calculation on Proovd's direct listing service
Checkout total = subtotal + tax - any separately approved promotional discount treatment
```

The 5% campaign fee is separate and unchanged.

### Admin

Admin sees every item, evidence, status, discount line, high-effort inputs, fee preview, interview state, invalidation history, and override. A manual override requires prior value, new value, reason, actor, time, and evidence.

### Affiliate

The preparing Campaign kit may show available materials and high-effort result/basis. It must not present a mutable compensation decision before formal activation.

### Backer

No direct surface.

---

## 13. Phase 7 — Founder connected-account onboarding and listing-fee payment

### Founder connected-account onboarding

Before listing-fee payment, the Founder completes Stripe-hosted onboarding for the connected account used as the campaign seller/payment account.

Proovd stores:

- Connected account ID.
- Onboarding/requirements status.
- Required capabilities/statuses.
- Return and refresh events.
- Policy/agreement acceptance references.

Proovd does not store Stripe-collected government ID documents. Returning from Stripe always lands on a human-readable status:

- Complete.
- More information required, with exact missing requirement and resume action.
- Under review, with owner and next expected update.
- Restricted/failed, with safe support path and no misleading ability to pay the listing fee.

### Listing-fee checkout

The listing fee uses Stripe Checkout on Proovd's main account, not a campaign Connect charge. Proovd is seller/MoR for this fee. Stripe Tax is enabled. Descriptor: `PROOVD LISTING`.

Before payment, show:

- US$35 base line.
- Each earned US$2 saving as its own labeled line.
- Promotional discount if applicable.
- Tax.
- Total due now.
- Descriptor.
- Separate explanation that Proovd later retains 5% of captured campaign reward subtotal.
- Full listing-fee refund promise.
- Exact consent in Appendix A.

The full-refund promise covers the entire Checkout charge actually paid, including listing-fee subtotal and associated sales-tax reversal/correction, when:

- There are zero eligible recruited Affiliates; or
- No Creator and Founder mutually accept the same locked compensation-proposal version by 72 hours after successful payment; or
- A required launch Creator fails before launch and no replacement becomes fully ready within three US business days after the recorded failure.

A pending proposal is not acceptance and does not pause or extend the deadline.

### Successful payment

Successful payment atomically:

- Stores Checkout/session/payment object, subtotal, discounts, tax, total, descriptor, receipt, and `listing_paid_at`.
- Locks optional-item completion, evidence snapshot, high-effort result, discount calculation, and amount.
- Changes campaign to `affiliate_response_and_build`.
- Makes the formal opportunity actionable for every eligible pre-associated Affiliate.
- Starts one 72-hour deadline at `listing_paid_at`.
- Starts campaign building in parallel.
- Sends Founder confirmation/receipt and Affiliate formal-opportunity notifications exactly once.

Founder confirmation states amount, itemized savings/tax, receipt access, refund condition, deadline, what happens next, owner, and next update date.

### Failed or abandoned payment

- Campaign remains `listing_fee_pending`.
- No 72-hour clock starts.
- Affiliate preparing states remain informational.
- Valid Founder inputs and calculated fee remain.
- Checkout expiration/failure is recorded and retryable without duplicating a charge or campaign association.

### Admin

Admin can reconcile the listing fee separately from all campaign money, see the exact clock and refund eligibility, and issue a direct refund to the original payment method when required. Refunds are idempotent and normally communicate the typical 5–10-business-day bank timing without promising an exact settlement date.

### Backer

No direct surface.

---

## 14. Phase 8 — Formal Affiliate decisions and Founder campaign building in parallel

### 14.1 Affiliate formal opportunity

The opportunity surface starts with:

- `Why this fits your audience`: two Admin-written sentences.
- A 60-second brief: audience, product promise, campaign type, required promotion, compensation, key date, and main delivery/claim risk.

The complete opportunity/Campaign kit includes:

- Founder name, entity/sole-proprietor status, profile, prior Proovd history, and connected-account readiness indicator.
- Product category, Problem, Solution, Competition/positioning.
- Campaign type and charge rule.
- Available visuals, branding, story, socials, and interview material.
- High-effort status and its objective basis.
- Reward packages, prices, contents, delivery dates, fulfillment promises, and quantities.
- Idea threshold or Product internal target, correctly labeled.
- Campaign open/close dates and duration.
- Brand voice/perception notes.
- Permitted claims, prohibited claims, and unconfirmed-claim warnings.
- Founder refund policy for a Product Campaign.
- Required posts/deliverables and availability periods.
- Base percentage, performance bonus, bid eligibility, and fixed-payment availability.
- Product demo/sample/Zoom request route if manually supported.
- Campaign state: preparing, formal decision open, live, or ended.
- For a live-campaign invite: exact remaining time, adjusted deliverables, and eventual activation rule.
- FTC rules, promotion channels, spam/minor/self-pre-order/fraud rules.
- First-post and deliverable-proof instructions.
- Plain-language IP/confidentiality summary.
- Compensation finalization, adjustment, Transfer/payout, and support explanation.

Tracking links and disclosure text have one-click copy confirmation. A safe link-test action must not contaminate production attribution or conversion metrics.

All material lives in one Campaign kit. No separate resource-library or education journey is required.

### 14.2 Affiliate decision actions

The formal state exposes all three outcomes without pressure:

- **Accept standard terms.** Accept the applicable base percentage and terms.
- **Decline.** Optional reason chips/free text; declining does not reduce standing.
- **Propose terms.** Percentage bid only when high-effort; fixed Creator payment request only for a Product Campaign.

Presentation may use one primary and one secondary decision control under the DNA UX, but none of the outcomes may be hidden.

#### Standard acceptance

Acceptance requires:

- Compensation terms.
- Per-campaign Creator-only IP/confidentiality agreement.
- FTC disclosure acknowledgment.
- Campaign terms and AUP state.

It creates a unique tracking-link record, but the link stays inactive until approval and Creator readiness. The association becomes `accepted`, not `active`. Compensation locks for the campaign. The durable confirmation includes an example on a captured pre-tax charge, what is fixed/conditional, first action, dates, disclosure, support, and the fact that first-post verification releases no fixed-payment money.

#### Decline

Store decision time and optional reason. Founder/Admin see the status, not private sensitive data. Confirmation says the decline was recorded and does not harm standing.

#### Proposal and counter-offer

- High-effort campaign: Affiliate may bid above applicable base, while total base + bid + bonus never exceeds 50%.
- Product Campaign: Affiliate may request a fixed Creator payment whether or not high-effort.
- Founder may accept, decline, or propose a revision.
- A Founder revision creates a new immutable version with `awaiting_creator`; it is not acceptance.
- Affiliate may accept, decline, or counter with another version.
- Only the exact version explicitly accepted by both sides locks.
- Admin may mediate or reject policy-violating terms but cannot substitute for both parties' acceptance.
- Store values, proposing party, created time, both decisions/times, superseded version, and final version.
- Stale/simultaneous responses cannot lock two versions.
- No funding, commission record, roster readiness, or refund prevention may use a version that was not mutually accepted.
- At the 72-hour deadline, unfinished proposals become `expired_no_acceptance` and close.

### 14.3 Compensation matrix

| Campaign | Fixed Creator payment | Base | Bid above base |
| --- | --- | ---: | --- |
| Idea, standard | Prohibited | 30% | No |
| Idea, high effort | Prohibited | 30% | Yes, total capped at 50% |
| Product, standard | None | 30% | No |
| Product, standard | Accepted | 20% | No |
| Product, high effort | None | 30% | Yes, total capped at 50% |
| Product, high effort | Accepted | 20% | Yes, total capped at 50% |

Founder-offered performance bonuses are Creator-specific. Each uses only that Creator's successfully captured, validly attributed, pre-tax reward subtotal or unique captured attributed-Backer count. Store trigger unit, threshold, additional percentage, maximum combined percentage, proposal version, and earned result. Whole-campaign, organic, house, or another Creator's result cannot trigger it. A fixed amount sits outside the percentage ceiling.

### 14.4 Founder campaign building

In parallel, the Founder completes one decision at a time. Campaign type is read-only.

Required shared ingredients:

- Campaign title.
- Founder legal/entity/sole-proprietor display and country.
- Founder profile link.
- Open and close date/time in UTC.
- Idea order threshold or Product internal target.
- Reward packages.
- FAQs.
- Brand perception/voice, required wording, and prohibited claims.
- Optional Founder community URL.
- Hero preference.
- Public story/launch narrative.
- Product visuals and brand assets.
- Optional Creator-specific performance bonuses.
- Product Campaign refund policy: exact operative text or immutable snapshot, title, source URL, version, and effective date.

Every reward package contains:

- Title.
- USD pre-tax price.
- Exact contents/deliverables.
- Fulfillment commitment.
- Delivery month/year or window.
- Optional limited quantity.
- SKU/tier identifier.

Idea-specific:

- Integer order threshold.
- Delivery window.
- Early-product disclaimer.
- Risks/challenges.

Product-specific:

- Internal momentum target no greater than US$50,000.
- No public funding gate.
- Delivery month/year on every tier.
- Specific Founder refund policy preserved immutably for existing transactions.
- Default 14-day duration unless approved configuration differs.

### 14.5 Founder roster view during the 72-hour clock

The Founder sees recruited campaign-specific Creator cards only:

- Name/handle.
- Channel type.
- Audience metric and engagement/comparable proof.
- Niche and short bio.
- Status: recruited, invited, signed up, waiting for Founder, preparing, reviewing, accepted, declined, proposal pending, fixed payment requested, active, ended.
- Exact deadline, remaining time, and the full-refund outcome.
- Explicit note that a pending proposal is interest, not acceptance.

Proovd owns recruitment follow-up. The Founder cannot browse or contact a general pool.

### 14.6 No-acceptance deadline

At exactly 72 hours after `listing_paid_at`:

- If at least one Creator and Founder have mutually accepted one locked version, the campaign can continue.
- If there are zero eligible recruits or no locked mutual acceptance, set `affiliate_roster_status = failed`, close pending proposals, prevent review readiness, refund the entire listing Checkout total once including tax reversal/correction, notify Founder/Admin/Affiliates as relevant, and return the campaign to allowed draft/archive handling.
- A late response cannot silently reactivate the failed/refunded campaign.

### Admin

Admin sees both parallel tracks, the exact deadline, every proposal version, recruitment status, campaign completeness, high-effort rules, compensation ceiling, and any overdue customer update. Admin can continue recruiting during the window.

### Backer

No direct surface.

---

## 15. Phase 9 — Initial roster readiness, campaign preview, review, and material changes

### Initial roster readiness

`affiliate_roster_status = launch_ready` only when:

1. At least one Creator accepted.
2. Admin marked the final initial launch roster.
3. Every Creator on that roster accepted the final compensation version.
4. Every bid, fixed-payment request, and revision for a rostered Creator is mutually accepted or closed.
5. No pending Creator is required for planned launch.
6. Agreement, disclosure, tracking, and readiness records exist for every rostered Creator.

Declined/removed/non-required Creators do not block readiness after Admin records the decision. Later mid-campaign additions do not reopen this initial-roster decision.

### Founder preview

The Founder can view the complete public campaign exactly as a Backer will, including:

- Campaign type badge and charge rule.
- Founder/MoR disclosure.
- Reward packages and delivery disclosures.
- Story, FAQ, updates/comments placeholders as applicable.
- Creator-attribution placeholder.
- Checkout drawer preview with correct campaign-specific consent, subtotal/tax/total examples, cancellation, data-sharing, and age/marketing/newsletter controls.

Preview collects no real Backer payment information.

### Review readiness

Store `affiliate_roster_status` and `campaign_build_status` separately. `review_ready` is derived only when the initial roster is `launch_ready` and campaign build is `complete`. Founder can submit only then.

### Admin review

Campaign enters `pending_review`. Admin reviews:

- Founder identity/profile and connected-account readiness.
- AUP, sanctions, and category eligibility.
- Product proof and claims.
- Reward contents, digital-only status, quantities, delivery dates, and fulfillment feasibility.
- Product Campaign refund policy or Idea threshold/risk disclosure.
- Brand notes, community link, visuals, and story.
- Misleading claims, fake renderings, undisclosed risks, and inflated capability claims.
- Final initial roster, compensation, proposals, bonuses, fixed payments, disclosure templates, tracking records, agreements, and readiness.
- Tax/product-code/configuration prerequisites for the seller account.

Decision outcomes:

- **Approved:** preserve immutable approved campaign/Creator terms version and proceed to readiness/funding.
- **Changes required:** set `changes_required`, preserve all valid work, group feedback into `Required before resubmission` and `Optional improvements`, deep-link to affected content, identify owner/due expectation, and state whether enforcement is involved.

### Materiality and Creator reacceptance

Every required change is classified and audited:

- **Non-material:** spelling, formatting, accessibility text, or wording that does not change meaning, economics, workload, timing, risk, claims, delivery, refunds, or channel rules. It preserves Creator readiness.
- **Material to Creator terms:** compensation, required work, dates, rewards/prices, approved claims, delivery promises, refund terms, channel rules, or fixed-payment conditions. It creates a new version, invalidates affected Creator readiness, and requires explicit acceptance of that exact version before approval/live.

Admin records classification, reason, affected fields, before/after, prior/new version, affected Creators, and reacceptance state. A Founder cannot publish a material change directly.

### Founder

Founder sees the review owner, submission time, next-update date, required/optional changes, materiality where relevant, and preserved draft. Approval produces a durable launch receipt containing final URL, dates, roster, locked commercial fields, responsibilities, support, and next action.

### Affiliate

Affected Creators receive the precise changed fields/terms and accept or decline the new version. Unaffected/non-material corrections do not manufacture a reacceptance task.

### Backer

No public campaign exists until approval and scheduled launch.

---

## 16. Phase 10 — Fixed Creator payment funding and Creator readiness

### Fixed-payment rule

Optional fixed Creator payment exists only for a Product Campaign, is requested by the Creator, accepted by both parties through one proposal version, and is not the default model.

Funding sequence:

1. Create one campaign-and-Creator allocation for the exact accepted amount.
2. Founder funds it in full before the Creator begins work. Partial funding is rejected.
3. Funding statuses: `not_requested`, `payment_pending`, `funded`, `payment_failed`, `returned`, `paid`.
4. Funding failure preserves the accepted amount, blocks work, and can retry idempotently without duplicate allocation/charge.
5. Missing the Admin-configured funding deadline may cancel the association and allow replacement recruitment; the 20% base stops applying after cancellation.
6. Funding, return, finalization, and Transfer each use stable idempotency keys.

The allocation is separate from Backer charges, sales tax, Proovd's 5%, and percentage compensation. No percentage applies to it. It must never be called escrow or money already paid to the Creator.

### Creator-readiness checklist

A Creator may begin work only when all applicable items are complete:

- Campaign approved.
- Final rewards/offers.
- Final incentives and compensation.
- Product/brand assets.
- Permitted/prohibited claims.
- Tracking-link record.
- FTC disclosure template.
- Required posts/deliverables and availability periods.
- Campaign dates.
- Accepted Creator-only IP/confidentiality agreement.
- Accepted campaign terms/AUP.
- Fully funded fixed allocation, if applicable.
- Required connected-account/capability status.

The Creator receives one completed Campaign kit and prepares the agreed work. Admin may review drafts/planned posts where available.

### Founder

Founder sees each Creator's readiness status, fixed-payment funding status, exact blockers, owner, and next date. Founder cannot ask the Creator to begin while any required item is incomplete.

### Admin

Admin verifies every checklist item, funding object, amount, accepted proposal version, and draft/launch plan. Admin schedules one exact `campaign_live_at` only after campaign and scheduled Creators are ready.

### Backer

No direct surface.

---

## 17. Phase 11 — Coordinated launch and post verification

### Controlling launch order

At `campaign_live_at`, execute idempotently in this order:

1. Activate the approved public campaign page.
2. Activate scheduled Creator tracking links with `activated_at = campaign_live_at`; they must already resolve to the live page.
3. Creators publish their scheduled posts containing the working links.
4. Each Creator submits the public post URL.
5. Admin verifies the live post.

Post verification never launches or unlaunches the campaign page and never releases fixed-payment money.

### Affiliate active-partnership surface

After readiness/activation, show:

- Founder and product.
- Campaign type and public link.
- Unique tracking link with copy confirmation.
- Disclosure templates with copy confirmation.
- Brand notes, allowed/prohibited claims, rewards/prices, delivery dates, campaign end.
- Joined-at and `activated_at`.
- Remaining-time deliverables for mid-campaign joiners.
- Locked compensation, fixed-payment funding/completion state, first-post state, and readiness.
- Clicks, attributed active pre-orders, conversion.
- Captured attributed amount after close.
- Estimated/finalized earnings and bonus progress.
- Transfer/payout state.
- `Updated [local time]` and explanation that metrics are refresh-based, not real time.

### Admin first-post verification

For each submitted URL record submission time and verify:

- Approved channel/account identity.
- Public accessibility.
- FTC disclosure names Founder/product.
- Brand-note compliance.
- No prohibited or unsupported claim.
- Work matches agreed terms.
- Campaign type/risk disclosure where material.

Outcomes:

- **Passed:** valid traffic/captured charges after `activated_at` remain provisionally attributable and may later finalize.
- **Correction needed:** pause that Creator's link as configured, identify exact correction and due time, and prevent invalid earnings from finalizing.
- **Rejected/serious breach:** pause the link, block invalid earnings, create enforcement review, and preserve evidence.

Traffic and captures after activation are provisional until verification. Earlier traffic, pre-orders, and charges never receive retroactive attribution. A rejected post does not reverse the public campaign launch.

### Founder live entry

Founder receives launch confirmation and the final launch receipt. Founder is responsible for required campaign updates, support answers, and truthful live content. See Phase 14 for the live campaign home.

### Backer

Public visitors can now access the campaign through Creator, Founder, Proovd-house, or direct links subject to discovery timing in Phase 12.

---

## 18. Phase 12 — Public campaign discovery and page contract

### Discovery and attribution timing

- Campaign Days 1–7: public route is accessible through known Creator, Founder, Proovd-house, or direct links but excluded from Proovd browse/discovery and indexing surfaces.
- Beginning Day 8: campaign may enter Proovd browse/indexable discovery. The Founder receives one factual notice explaining what changed and how organic, house, and Creator attribution differ.
- Organic/direct transactions have no Creator commission.
- Proovd-house traffic is separate from third-party Creator performance.

### Attribution contract

- The last valid Creator link clicked before a pre-order wins on the same browser/device.
- Its first-party cookie expires at `campaign_close_at`.
- A later valid Creator click replaces an earlier one.
- Direct return without another Creator link preserves the current Creator cookie.
- No cross-device or cross-browser attribution promise exists.
- Links before `activated_at`, while paused, or after close cannot create payable attribution.
- Attribution is attached to the reservation and later becomes payable only on successful capture and verification.
- Creator-link arrival shows `You came through [handle]` and explains that the Creator may earn if the later charge succeeds.

### Public route inventory

Required public routes:

- `/`
- `/about`
- `/how-payments-work`
- `/safety`
- `/terms`
- `/privacy`
- `/cookies`
- `/refunds`
- `/fulfillment`
- `/aup`
- `/affiliate-aup`
- `/ip-agreement`
- `/campaign/sample-pre-build`
- `/campaign/sample-pre-launch`
- Each approved live campaign route.

Every policy route contains the complete canonical approved policy, not placeholder, `coming soon`, or summary-only content. Policy versions must match this product behavior before launch.

### Homepage and public trust content

The homepage communicates:

- Vetted-Founder crowdfunding software.
- Idea and Product Campaign models.
- Manual Founder, campaign, and Creator review.
- Digital-only launch scope.
- Cards saved now and charged only under the disclosed trigger.
- Founder as seller/MoR.
- Stripe Connect under the actual approved configuration.
- Founder and Affiliate role-based calls to action.
- Support and policy links.

### Campaign page content order

Every campaign page exposes all of the following; the DNA UX document controls presentation:

1. Campaign title.
2. Founder identity: legal name, entity/sole proprietor, country, profile.
3. Reward packages: title/SKU, pre-tax USD price, exact contents, delivery, fulfillment.
4. Campaign-type badge paired with its plain charge rule.
5. Open and close in viewer local time, with UTC available.
6. Idea threshold row only for Idea Campaigns.
7. Refund and fulfillment links.
8. Always-visible Founder/MoR disclosure and expandable explanation.
9. Pre-order action.
10. Story/launch narrative.
11. FAQ.
12. Updates.
13. Comments where enabled.
14. Legal/support footer.

Reward prices are pre-tax unless an approved configuration explicitly says otherwise. Page copy must not imply tax-inclusive pricing when checkout will add tax.

Near the primary action, a compact summary states: card saved today → charge at the campaign-specific trigger → delivery month/year. Once a reward is selected, use its actual subtotal/tax/authorized total where the tax calculation is available; never replace the full consent.

### Founder/MoR disclosure

Above the pre-order action:

```text
Sold by [FOUNDER LEGAL NAME] of [FOUNDER ENTITY or "sole proprietor"],
[FOUNDER COUNTRY]. Proovd is the platform, not the seller.
[How this works ↓]
```

Expanded explanation preserves:

- Founder is seller/MoR and responsible for reward, law, support, and refunds.
- Stripe processes payments through Stripe Connect under the actual approved account context.
- Proovd is software, not seller.
- A Backer receives a magic link.
- Product/delivery/refund questions route to the Founder through Proovd support.
- Proovd sends immediate acknowledgement, provides a human response within one business day, and follows up when the Founder has not responded within 48 hours.
- Platform questions go to `support@proovd.co`.

### Campaign-type page differences

| Element | Idea Campaign | Product Campaign |
| --- | --- | --- |
| Threshold | Visible | Hidden |
| Charge rule | Only if threshold is met at close | Every active transaction at close |
| Public progress | Threshold progress allowed | Prefer Backers/units/days; no misleading public dollar gate |
| Delivery | Delivery window | Specific month/year per tier |
| Refund summary | Threshold miss means no charge; defined exceptions after capture | Preserved Founder policy plus platform/law/Stripe/issuer rules |
| Pre-order action | Authorize future charge if threshold is met | Authorize pre-order charge on close date |

For a Product Campaign, the hero may show Founder/product name, logo/visual, unique Backer count, units reserved, days remaining, a truthfully computed popular reward, and the pre-order action. Established brands may lead with product/startup identity rather than a Founder portrait.

### Sample campaigns

- `sample-pre-build` renders a realistic safe Idea Campaign.
- `sample-pre-launch` renders a realistic safe Product Campaign.
- Both show complete campaign, rewards, delivery, MoR disclosure, and correct consent preview.
- Both permanently display `Sample campaign — for platform demonstration. No payment information is collected.`
- Neither accepts real card data.

### Updates and comments

Updates:

- Product: general/public or Backer-only.
- Idea: general/public, Backer-only, or milestone/progress.
- Only after the campaign is live; may continue after close.
- Text, image, and embedded video.
- Display local publication time and audience label.
- Material delivery changes show prior and revised commitments together.

Comments:

- One general thread and one thread per update.
- Only a magic-link-authenticated Backer may post.
- Display `Backer ###` or a chosen display name, never email local-part by default.
- Flagging routes to Admin.
- New comments are disabled after close, suspension, or kill.

### Ended-state contract

The page remains accessible after natural close, threshold miss, suspension, or kill. It disables new pre-orders/comments and renders outcome-specific copy stating:

- Why it ended.
- Whether this viewer was charged.
- What happens next.
- Where existing Backers get help.

One generic `Campaign ended` message is prohibited.

---

## 19. Phase 13 — Backer pre-order, card save, confirmation, and magic-link access

### Backer pre-order flow

Each transaction follows this sequence:

1. Select exactly one reward.
2. Answer the fixed demand survey:
   - `Why do you want this product?` free text.
   - `How likely are you to recommend this to someone?` 1–10.
3. Enter email, phone, US billing country, postal code, and full billing address only when required.
4. Confirm 18+ with an unchecked control.
5. Calculate and display reward subtotal, sales tax, and exact total authorized.
6. Read the campaign-specific consent and mandatory Founder fulfillment/support data-sharing acknowledgment.
7. Optionally, through a separate unchecked control, allow Founder marketing, research, survey contact, and identifiable survey access.
8. Optionally join Proovd's newsletter through its own unchecked control.
9. Enter card through Stripe-controlled fields.
10. Confirm a SetupIntent for the exact disclosed future charge rule/amount.
11. Create an active reservation only after SetupIntent success.
12. Send confirmation with magic link.

Survey helper text says answers help the Founder understand demand, honestly labels optionality, and applies a reasonable visible character limit to free text. Valid survey/reward/contact values survive any tax, Stripe, network, validation, or server error. Selected reward, subtotal, tax, total, delivery, availability, and refund link remain visible or directly available throughout checkout and cannot change silently.

Before the card field, show a transaction-specific timeline:

1. **Today:** card saved; charged today = US$0.
2. **At the trigger:** exact authorized total, separated into subtotal and tax, local charge date/time with UTC, and the selected campaign rule.
3. **Delivery:** reward name and month/year/window.

### Eligibility and cardinality checks

- Reject non-US billing country before SetupIntent creation.
- Reject unchecked age confirmation.
- Check sanctions/risk inputs available through the approved providers.
- Atomically check the US$50,000 pre-tax active-reservation cap before SetupIntent. Reject or waitlist a transaction that would exceed it.
- Idea: one active pre-order per practical unique Backer. A reward change creates a new tax calculation and consent; the old selection remains active unless replacement SetupIntent/consent succeeds.
- Product: multiple transactions allowed; each has one reward and separate consent, tax, SetupIntent, status, and cancellation.
- Sold-out rewards remain visible but unavailable.

### Reservation-time tax rule

- Calculate sales tax at reservation time using Founder seller/account, product tax code, and Backer location.
- Store calculation ID, jurisdiction/rate, taxability reason, `expires_at`, subtotal, tax, total, and timestamp.
- The later charge may occur only for exactly that total and only if the same calculation remains usable under the approved configuration.
- The MVP does not recalculate at close or ask for a higher-total reconsent.
- If unusable at capture, make no charge and use `capture_failed_dropped` with reason `tax_calculation_unusable`.

### Immediate Founder operational sharing

After a successfully saved pre-order, immediately share the Backer's email and purchase details necessary for fulfillment preparation and support with the Founder, even though no charge occurred. Store delivery/audit status.

- This sharing is mandatory and disclosed before consent.
- It is not marketing consent.
- Cancellation later changes the Founder record to `canceled/no charge — do not fulfill`.
- Previously shared information cannot be retracted but remains restricted to operational use.
- Identifiable survey answers and any marketing/research contact require the separate optional consent.
- Affiliates never receive Backer PII.

### Success state and email

Lead with `Pre-order saved — you were not charged` and repeat:

- Campaign and Founder/seller.
- Selected reward.
- Subtotal, tax, exact total authorized.
- US$0 charged today.
- Campaign-specific charge trigger and local date/time with UTC.
- Delivery.
- Expected statement descriptor.
- Cancellation deadline/path.
- Magic-link destination.
- Refund/support summary and one-business-day SLA.
- `Add close date to calendar` action.
- Today → Trigger → Delivery summary.

Celebration must never imply a completed purchase/charge.

### Backer magic-link page

The long-lived campaign-scoped page contains:

- Full campaign page.
- Each of this Backer's transaction/pre-order details.
- Selected reward, subtotal, tax, total, date, and payment status.
- Whether charge occurred.
- Campaign-specific status progression.
- Cancel before close.
- Change Idea reward before close.
- Update card during retry.
- Public and Backer-only updates.
- Comment ability while allowed.
- Founder support form routed through Proovd.
- Founder community link.
- Post-charge refund/support request.
- Post-delivery satisfaction survey.

Magic links remain valid through fulfillment or final resolution plus 180 days unless revoked/reissued for security. Founder or Affiliate payment never expires Backer access.

### Admin

Admin sees the reservation ledger, cap result, tax calculation, SetupIntent status, consent/policy versions, operational sharing state, optional consents, attribution, risk/deduplication case, confirmation/reminder status, and magic-link audit. Admin can resend/reissue a compromised link without changing the reservation identity.

### Founder

Founder aggregate view receives active-pre-order and amount changes. Operational Backer details are available only for fulfillment/support; optional identifiable fields appear only under the recorded optional consent.

### Affiliate

Affiliate sees only aggregate clicks, attributed pre-orders, reward summary, and timestamps. During the campaign, amounts/earnings are estimated and not collected/final until successful capture/reconciliation.

---

## 20. Phase 14 — Live campaign operations

### Founder campaign home: Glance, Act, Explore

This is a chronological campaign workspace, never a widget grid.

#### Glance

- One large number: active pre-order count.
- Last-visit delta: `+N since [date]` or truthful `No change since [date]`.
- Store/update `last_seen_count` and `last_seen_at` only after the rendered state is successfully delivered.
- Idea: `[N] to go · ends [local date/time]`.
- Product: `Campaign ends [local date/time]`.
- Permanent clarification that these people selected an offer and agreed to charge rules but have not yet been charged.
- Current Creator liveness only when true.
- Data freshness such as `Updated 3:40 PM`; never say real time.

#### Act

Show one real primary action, ranked:

1. Safety/compliance blocker.
2. Required delivery/refund/date change review.
3. Unanswered Backer support question.
4. Required campaign update due.
5. Optional milestone update, once per actual milestone.

A documented safety override may change ranking. When no real action exists, show no manufactured CTA and close with `You're all caught up. Results land [local close].`

Store every later correction/dismissal/reclassification of the ranked action with prior rank, reason, actor, and time.

#### Explore

Complete supporting data remains available without competing with Glance/Act:

- Clicks.
- Active/new/canceled pre-orders and net change.
- Pre-tax reserved subtotal, estimated tax, exact authorized totals.
- Conversion and days remaining.
- Creator results and activation/verification.
- Survey/customer answers according to consent.
- Funnel/drop-off.
- Direct, organic, Proovd-house, and Creator attribution.
- Comments and updates.
- Permitted exports.
- Data definitions and freshness.

### Founder live editing

Directly allowed with version history:

- Typos.
- Non-material clarification.
- Brand notes that do not alter approved claims.
- Community link.
- Non-material FAQ clarification.

Require Admin review and any affected Creator reacceptance:

- Claims.
- Rewards/prices.
- Campaign dates/duration.
- Delivery promises.
- Refund terms.
- Creator work/compensation/channel rules.

Campaign type, Idea threshold, Product internal target, locked reward transaction terms, and accepted compensation cannot be changed directly. An FAQ cannot silently change a promise locked elsewhere.

### Affiliate during live campaign

- Uses active-partnership Campaign kit and links.
- Sees refresh-based performance with definitions and timestamps.
- Earnings states are distinct: `estimated`, `finalized`, `approved for transfer`, `transferred`, `paid out`, `payout failed`, `adjusted`.
- Each unpaid/adjusted state names reason, owner, and next date/action.
- Must keep content available for the agreed campaign/availability period. Story-format content may follow an expressly pre-agreed natural lifespan.
- Must not spam, use unsolicited DMs, identity-hidden accounts, purchased lists, unrelated mass platforms, minors, prohibited claims, or link sharing/sale/transfer.
- Promotion is allowed only through owned/administered/permitted/guest channels and must follow host rules.
- Newsletter/email must follow applicable consent and CAN-SPAM/platform rules.
- Newsletter/email must also follow GDPR or other privacy rules where they apply to an otherwise permitted audience/channel; this does not expand the US-only participant pilot.
- Student Affiliates act personally and cannot imply school/club endorsement.
- Forums/community/course platforms allow direct links only when host rules permit.

Every promotional post clearly discloses a paid/material relationship with the specific Founder/product. Use native paid-promotion tools where suitable, prominent `#ad`/`#sponsored`, story-integrated text, or verbal pre-roll. Disclosure must be hard to miss and appear at the start or otherwise prominently.

### Backer before close

- Can revisit through magic link.
- Can cancel at no cost through one clear action with no retention obstacle.
- Idea: may change reward through a replacement that must complete before old selection is replaced.
- Can read updates and comment while enabled.
- Can contact Founder through Proovd support.

### Cancellation behavior

For either campaign type:

- Atomically set reservation `reserved_canceled` and remove it from close selection/cap/threshold.
- Prevent any PaymentIntent for that reservation.
- Remove future-charge authority and detach PaymentMethod only where reference-safe.
- If the same PaymentMethod/Customer supports another active Product transaction, do not detach globally.
- Preserve successful SetupIntent as history; never label it canceled.
- Show and email `Canceled — you were not charged`, with campaign, reward, US$0, local/UTC cancellation time, and re-pre-order route if still open.
- Product cancellation also notifies Founder.
- Update Founder operational record to `do not fulfill`.
- Handle duplicate submission idempotently.

### Threshold and campaign events

- Store new pre-orders, cancellations, and net change separately.
- Crossing an Idea threshold emits `threshold reached`; falling below emits `threshold lost`. Each crossing is its own event and notification, deduplicated by state transition.
- First pre-order, halfway, threshold met, and campaign ended may appear once as a milestone then move to history.
- No generic Day 3/7/10 `check your campaign` emails.
- Notify only for real actions or consequences.

### Mid-campaign Affiliate addition

Admin may recruit a new Affiliate after launch and before close:

- Same private campaign-specific invitation and compact account flow.
- Because Founder is complete, campaign appears immediately.
- Show exact remaining time, current Campaign kit, and adjusted reasonable deliverables.
- Use the same compensation matrix and the campaign's locked high-effort result.
- Do not change public terms or existing Creators' locked terms.
- Require agreements, compensation acceptance, connected-account readiness, and all relevant Creator-readiness items.
- Set a new `activated_at`; no retroactive attribution.
- The active-partnership cap applies.
- Ended campaigns reject addition.
- A failed/refunded no-acceptance campaign cannot be revived by a late Affiliate.
- Do not reopen campaign review unless addition requires a material public-campaign change.

### Admin live operations

Admin monitors reservations, cap, suspected duplicates, tax calculation expiry risk, charge readiness, Creator links/posts, claims, comments, support, risk, connected-account requirements, and upcoming close. Admin can request post correction, pause one Creator link, review material edits, add Creators, and prepare the close batch.

### Pre-charge reminder

Approximately 24 hours before the trigger, send one reminder for each still-active scheduled transaction. If created less than 24 hours before trigger, send promptly and suppress the later duplicate.

Include:

- Campaign and Founder/seller.
- Reward, subtotal, tax, exact total.
- Local charge/decision time and UTC.
- Idea threshold or Product close rule without guaranteeing card success.
- Expected descriptor.
- Direct magic-link review/cancel action.
- Support and SLA.

Canceled, killed, dropped, already captured, or otherwise ineligible reservations receive none.

---

## 21. Phase 15 — Campaign close, charge batch, failed-payment recovery, and results

### Time anchors

- `listing_paid_at`: 72-hour response/refund clock and 48-hour Founder cancellation clock.
- `campaign_live_at`: Day 1, discovery timing, active Creator slots, live obligations.
- `campaign_close_at`: ends cancellation/Affiliate joining, fixes Idea threshold, starts capture and retry, and anchors Day 3/Day 14.

Never infer these from generic create/update timestamps.

### Close batch

At exactly `campaign_close_at`:

1. Lock active reservations.
2. Exclude canceled/ineligible reservations.
3. Stop new Affiliate associations and Backer cancellation.
4. For Idea, resolve pending duplicate cases and calculate unique active Backers.
5. If Idea threshold missed:
   - Create no PaymentIntent.
   - Set reservations `threshold_not_met_no_charge`.
   - Remove future-charge eligibility and reference-safely detach payment methods.
   - Send US$0/no-charge closure.
   - Set campaign `ended_no_charge`.
6. If Idea threshold met or Product campaign:
   - Set eligible reservations `pending_capture`.
   - For each, validate stored tax calculation, Founder/reward/location association, expiry/usability, and exact amount.
   - If unusable, create no PaymentIntent, set `capture_failed_dropped` / `tax_calculation_unusable`, and notify Backer/Founder/Admin.
   - Otherwise create one off-session PaymentIntent for the exact authorized total under a stable reservation/attempt idempotency key.
   - Store PaymentIntent/charge and result.
7. Send receipts on success and recovery messages on failure.
8. Open one fixed 48-hour retry window from the first close-batch failure.

Running the batch twice, duplicate webhooks, or a worker crash/restart cannot create duplicate charges, fees, earnings, state transitions, or messages.

### Successful capture

- Reservation becomes `captured`.
- Reward subtotal, tax, total captured, Proovd fee, provisional Creator percentage liability, Founder gross share, Stripe fee, attribution, and charge context are separate ledger fields.
- Backer receives campaign-aware confirmation in addition to any provider receipt: Founder, campaign, reward, total, descriptor, delivery, magic link, and support.
- Captured money, not saved reservations, drives final revenue/commission.

### Failed-payment recovery

Statuses: `capture_failed_retrying`, then either `captured` or `capture_failed_dropped`.

Backer email/magic-link state:

- Plain-language outcome.
- Whether any money moved.
- Campaign/reward/subtotal/tax/total.
- Retry deadline in local time with UTC.
- One `Update card` action.
- Neutral, non-shaming copy; raw decline code only as secondary support detail.

Updating card and retrying must preserve reservation/reward/survey/consent context and be idempotent. `requires_action` routes to customer-action recovery rather than silent success.

At retry-window end:

- Successful recoveries count as captured.
- Remaining failures become dropped and do not count as collected revenue, Creator commission, or Founder share.
- Idea campaign remains successful if threshold was met at close.
- Reconciliation begins only after the window closes.

### Results preparation

`Campaign ended` fires at close. `Results ready` fires only after charge/retry and reconciliation results are prepared. They are separate notifications/events.

Founder results contain:

- Pre-orders placed and captured.
- Unique Backers and Product transaction/unit counts.
- Reward subtotal, tax, and total captured separately.
- Failed/recovered/dropped payments.
- Conversion/drop-off.
- Survey answers according to consent.
- Per-Creator performance.
- Organic/house/Creator-attributed revenue.
- Creator-specific bonus results.
- Finalized Creator percentage and fixed-payment status.
- A plain-language strongest signal, weakest signal, leading survey reason, and what the result does/does not prove, reviewed by Admin to avoid false causality.

Affiliate close surface/notification shows content verified, attributed pre-orders/capture, estimated/final earnings, next review date, and a factual thank-you without public ranking.

Backer close state is outcome-specific: threshold miss/no charge, captured, failed/dropped, or natural Product close.

### Admin reconciliation

Admin verifies:

- Batch completeness and all reservation terminal/retry states.
- Tax calculation/charge reconciliation.
- Attribution validity and post verification.
- Every Creator deliverable/waiver/availability period.
- Creator-specific bonus trigger.
- Provisional versus earned Creator amount.
- Return of unearned provisional amount to Founder through the approved adjustment path.
- Founder share and W-9 block.
- Refund/risk/dispute flags.

Campaign moves through `closed_pending_capture`, `capture_retry_window`, and `closed_reconciling` as applicable. Payment flags remain separate from campaign lifecycle.

---

## 22. Phase 16 — Creator earnings, Founder payments, fulfillment, enforcement, and future collaboration

### 22.1 Creator completion and earnings finalization

After the retry window, Admin verifies every agreed deliverable and records any waiver agreed by Founder and Admin.

Fixed-payment outcomes:

- **No valid compliant post:** return 100% of the fixed allocation; no commission.
- **At least one valid compliant attributed post, later deliverables incomplete:** return 100% of the fixed allocation; genuine commission from compliant captured attributed sales may remain.
- **All deliverables complete and verified:** full fixed amount is eligible even if sales were poor.
- **Fraud, fake traffic, self-dealing, false claims, invalid proof, or material breach:** cancel unpaid invalid amounts. If already transferred, create a negative balance and contractual recovery record.
- **No fixed arrangement:** commission only.

Creator percentage earnings use successfully captured, validly attributed, pre-tax reward subtotal. Bonus uses only that Creator's captured results. Total percentage never exceeds 50%.

Earnings surface states:

- `estimated`
- `finalized`
- `approved for transfer`
- `transferred`
- `paid out`
- `payout failed`
- `adjusted`

Every non-paid state shows amount, reason, owner, next date/action, and whether Affiliate action is required.

Admin creates one campaign-specific Affiliate Transfer on or after Day 3 for finalized commission + earned bonus + eligible fixed amount. It is idempotent. The Affiliate never requests a Proovd withdrawal and never receives Backer funds before Transfer creation. Provider payout failures and requirements route to the Stripe-managed update path.

### 22.2 Discretionary good-effort thank-you payment

Proovd may choose a thank-you payment when a campaign produced little commission and the Affiliate completed the agreed minimum work, default three posts, met the campaign click threshold, and complied with brand/AUP rules.

- Never guaranteed, estimated, or calculated by the product.
- Funded only from Proovd's retained listing-fee revenue after all refund rights resolve.
- Never deducted from Backer charges, Founder share, Creator commission, or fixed allocation.
- Initiated manually only through an approved recipient path after tax/accounting approval.
- Record amount, reason, funding source, recipient, approval, provider object/status, tax treatment, and timestamp.
- If approval/path is absent, Admin may record recognition but cannot promise/send money.

### 22.3 Founder W-9 and payment schedule

Immediately after close, request W-9. Missing/unverified W-9 blocks every Founder payment.

Founder payment status shows:

- Exact amount affected.
- Requirement/blocker.
- Secure action.
- Submitted/verified state.
- Next review date.
- `No action needed` while under review.
- Never uses `held` where `eligible`, `blocked`, or `released` is accurate.

#### Idea Campaign

- 100% of eligible Founder share becomes payable at Day 3 after retry, W-9, payment/risk checks, and Admin approval.
- One `single_payment` object only.
- Day 14 creates no second payment and is fulfillment/enforcement review.

#### Product Campaign

- First payment: 40% at Day 3 after retry and W-9.
- Remaining payment: 60% at Day 14 by default.
- Early remaining payment: after Day 3 only, and only with recorded proof that promised reward/access is actually available to affected Backers, required communication was sent, tax/payment requirements are complete, and no immediate risk flag exists. Internal readiness alone is insufficient.
- Early release does not skip Day 14 status review or ongoing delivery/refund/support duties.

Eligible Founder share is captured pre-tax reward subtotal minus Proovd 5%, Creator percentage compensation, applicable cause-based adjustments, and Stripe fees allocated to Founder under the approved configuration. Tax is separate.

### 22.4 Day 14 Progress Check

Admin performs it for every campaign.

Pass requires adequate progress/delivery evidence and required communication. Product evidence may show actual feature/reward access. Idea review is enforcement-only.

The Founder receives a campaign-specific evidence checklist with examples, and submission creates a durable receipt listing every supplied item and the decision due time. Admin and Founder see the same checklist and evidence list.

Failure includes:

- No adequate progress evidence.
- No substantive update in the prior seven days.
- Unreachable for Admin clarification within five business days.
- Material delivery bait-and-switch.
- Ghosting.

Failure consequences:

- Product: block unreleased remaining payment and start refund/reversal/recovery as applicable; attempt best-effort reversal against released first payment when warranted.
- Idea: no unreleased payment exists; use refunds, reversals, dispute handling, or contractual recovery best-effort.
- Apply one-strike ghost ban when the defined trigger is met.

### 22.5 Fulfillment

Digital fulfillment occurs through the promised mechanism:

- Login credentials.
- Download link.
- Redemption code.
- Beta enrollment.
- API key.
- Invite/access code.
- Course/book/file delivery.

Founder must:

- Send campaign-close confirmation within 48 hours.
- Post at least one update every 30 days from charge to delivery.
- Send delivery notification when access is granted.
- Preserve original and revised delivery dates when a change occurs.

Backer delivery email repeats reward, access instructions, original commitment, Founder support, Proovd escalation, and a short satisfaction response.

### 22.6 Delivery-date changes

For Product Campaigns before remaining payment:

- Founder requests Admin approval before notifying Backers.
- Admin reviews within five business days for bait-and-switch risk and payment impact.

After remaining payment:

- Founder must notify Backers before the original month passes.
- Admin preapproval is not required, but Founder remains subject to refund, support, and ghost-ban rules.

Material updates show previous date, revised date, reason, unchanged obligations, next update date, and support/refund route.

### 22.7 One-strike Founder ghost ban

Permanent ban triggers:

- Failed Day 14 Progress Check.
- Silent for 30+ consecutive days post-payment.
- Product: more than 30 days past disclosed delivery month without updated timeline and required notice/approval.
- Idea: failure to deliver by end of window plus failure to communicate an updated timeline within 30 days.

Admin records trigger, evidence, notice, payment/recovery status, and enforcement decision.

### 22.8 Creator `successfully_completed` status

Only Admin can assign it after campaign end when:

1. Creator cleared readiness before work.
2. At least one valid post was submitted and verified.
3. Every deliverable was verified or specifically waived by Founder and Admin with reason.
4. No unresolved fraud, invalid-proof, material-breach, or compliance case exists.
5. Fixed-payment return/payment, commission adjustment, and Transfer are resolved or recorded.

Sales performance is not required. Store status, completion date, Admin, evidence, waivers, and disqualifying reason.

### 22.9 Work-again request

After campaign end, a Founder may request another collaboration only with a Creator marked `successfully_completed` for that campaign.

- Routes through Proovd; no direct messaging.
- Creator can accept/decline without penalty.
- Store original campaign, Founder, Creator, request time, status, response, and notifications.
- Acceptance creates no campaign and bypasses no active-campaign limit, three-month cooldown, or Admin readiness approval.
- A later correction to completion status changes eligibility without deleting history.

### 22.10 Founder next-campaign readiness

Founder home shows:

- Exact earliest request date after the three-month cooldown.
- Separate Admin-readiness criteria.
- Ability to prepare updates/evidence without opening a new campaign.
- `ready for next campaign` only after Admin decision.

### 22.11 Campaign resolution

`closed_resolved` means charge/retry, Creator Transfer, Founder payment, refund/adjustment, and required close records reconcile. Fulfillment may remain active separately until `fulfilled`.

---

# PART III — CROSS-CUTTING ENGINEERING CONTRACTS

## 23. Canonical campaign, association, reservation, and payment states

### 23.1 Campaign lifecycle

The main campaign status is lifecycle only; do not overload it with payment flags.

| State | Entry rule | Exit rule |
| --- | --- | --- |
| `invited_draft` | Secure Founder draft created | Vetting submitted or invitation revoked/expired |
| `vetting_submitted` | Complete vetting; type locked | Account claimed or archived/replaced |
| `account_claimed` | `founder_signup_complete` emitted | Stripe onboarding/listing preparation begins |
| `stripe_onboarding_pending` | Founder needs connected-account completion | Requirements complete |
| `listing_fee_pending` | Fee calculated; Checkout not successful | Successful payment or archive |
| `affiliate_response_and_build` | `listing_paid_at` set | Failed/refunded; or both tracks produce review readiness |
| `pending_review` | Initial roster launch-ready + build complete + Founder submits | Approved or changes required |
| `changes_required` | Admin returns required corrections | Founder resubmits; affected Creator reacceptance complete where material |
| `approved` | Admin approves immutable version | Creator prep starts |
| `creator_prep` | Funding/readiness/launch scheduling | Live, replacement, cancellation, or suspension |
| `creator_replacement` | Required launch Creator failure recorded | Replacement ready or deadline missed |
| `refunded_no_creator` | Replacement deadline missed and full fee refund made | Terminal unless explicit new submission path |
| `live` | Idempotent scheduled activation | Close, suspend, or kill |
| `closed_pending_capture` | Close starts | Retry window/no-charge outcome |
| `capture_retry_window` | At least one retryable failure | 48-hour deadline/reconciliation |
| `closed_reconciling` | Charge/retry complete; money/work decisions incomplete | Close records reconciled |
| `captured_pending_w9` | Founder charge result ready, W-9 missing | W-9 verified/decision |
| `single_payment_released` | Idea single payment released | Fulfillment/enforcement continues |
| `first_payment_released` | Product first payment released | Remaining-payment decision |
| `day_14_review` | Review due/in progress | Pass/fail and next action |
| `remaining_payment_released` | Product remaining payment released | Fulfillment/resolution |
| `fulfilled` | Delivery obligations completed | Final resolution if money already reconciled |
| `closed_resolved` | Required charge, retry, Creator, Founder, refund/adjustment records reconcile | Terminal; fulfillment may be tracked separately if not done |
| `ended_no_charge` | Idea threshold miss or pre-charge termination | Terminal/support only |
| `suspended` | Temporary risk/enforcement action | Reinstate, kill, or resolve |
| `killed` | Permanent stop | Terminal/recovery/support |
| `banned_founder` | Enforcement also bans Founder | Terminal |

### 23.2 Parallel build/readiness fields

- `affiliate_roster_status`: `forming`, `launch_ready`, `failed`.
- `campaign_build_status`: `not_started`, `in_progress`, `complete`.
- `review_ready`: derived boolean; true only for `launch_ready + complete`.
- Mid-campaign additions never reset a completed initial roster.

### 23.3 Separate payment/reconciliation flags

Store independently with timestamp, amount, actor, evidence, and provider IDs:

- `retrying`
- `founder_payment_eligible`
- `founder_payment_paid`
- `affiliate_earnings_adjusted`
- `affiliate_transfer_eligible`
- `affiliate_transfer_paid`
- `results_ready`
- `fulfillment_active`

### 23.4 Campaign-Affiliate association states

At minimum:

- `prospect`
- `invited`
- `signup_started`
- `signed_up_waiting_for_founder`
- `preparing`
- `formal_decision_open`
- `reviewing`
- `proposal_pending`
- `accepted`
- `declined`
- `expired_no_acceptance`
- `readiness_blocked`
- `ready`
- `active`
- `paused`
- `ended`
- `removed`
- `successfully_completed`
- `completion_disqualified`

Store initial-roster versus mid-campaign designation separately.

### 23.5 Reservation states

- `reserved_active`
- `reserved_canceled`
- `threshold_not_met_no_charge`
- `pending_capture`
- `capture_failed_retrying`
- `capture_failed_dropped`
- `captured`
- `refunded`
- `reversed`
- `disputed`
- `killed_no_charge`

Every transition is append-only in history and protected from illegal reversal. A successful SetupIntent remains historical even when the internal reservation is later canceled/no-charge.

---

## 24. Payment, tax, fee, and ledger contract

### 24.1 Account roles and approved-configuration boundary

- One Proovd Connect platform.
- Founder connected account is seller/payment account for Backer campaign charges.
- Affiliate connected account is a recipient only for Admin-approved Transfers/payouts; it never processes the Backer charge and is never MoR.
- Listing fee is a direct Proovd Checkout transaction.
- The production charge, payout-control, fee, Affiliate Transfer, tax, refund/dispute, descriptor, and fixed-payment funding behavior must match the configuration actually approved/enabled for the account.
- Preferred intended model is direct charges on the Founder account with the separately ledgered Proovd fee and provisional Affiliate amount in the platform-side fee where supported.
- If the approved production model instead uses separate charges and transfers with `on_behalf_of`, implement that model and keep the same customer/MoR, milestone, ledger, and disclosure rules.
- Never run both paths for one transaction or claim an unapproved path is live.

### 24.2 SetupIntent to off-session PaymentIntent

Reservation sequence:

1. Validate reward, campaign, capacity, Backer eligibility, and attribution.
2. Calculate reservation-time tax and exact total.
3. Present and version exact consent.
4. Create/confirm SetupIntent in the correct account/customer context.
5. Store the payment-method token/reference; Proovd never receives raw card data.
6. Create `reserved_active` only after success.
7. At trigger, validate the still-usable tax calculation and exact amount.
8. Create one off-session PaymentIntent under a stable idempotency key.

Do not rely on a fixed 12-month mandate validity promise. Campaign length + retry must fit the provider/tax validity approved and tested.

### 24.3 Money waterfall

For each captured transaction:

```text
reward_subtotal = pre-tax reward price
sales_tax = tax added on top and paid by Backer
total_authorized/captured = reward_subtotal + sales_tax
proovd_fee = 5% × captured reward_subtotal
affiliate_percentage_compensation = locked earned percentage × captured validly attributed reward_subtotal
founder_gross_share = reward_subtotal - proovd_fee - affiliate_percentage_compensation
founder_net = founder_gross_share - allocated Stripe fees - cause-based adjustments
```

Sales tax is excluded from:

- Proovd 5%.
- Affiliate base/bid/bonus.
- Idea threshold.
- Campaign cap.
- Founder/Affiliate revenue.

### 24.4 Provisional Affiliate amount

For an attributed charge under the preferred model:

- Provision the maximum locked percentage that could be owed for that Creator, including conditional Creator-specific bonus.
- Keep Proovd 5% and provisional Affiliate liability as separate ledger accounts; the latter is never Proovd revenue.
- After retry and verification, calculate earned percentage.
- Transfer earned amount once.
- Return every unearned/untransferred difference to Founder once through the approved application-fee adjustment/refund path.
- Never retain an unearned Creator amount as platform revenue.

### 24.5 Stripe processing fees

- Preferred direct-charge model: Founder connected account bears processing fees, separately visible in reconciliation.
- Backup model: allocate fees only as supported by the approved configuration, contract, disclosure, and ledger.
- Never hide processing fees inside tax or Creator percentages.

### 24.6 Listing fee as a separate stream

Store separately:

- Founder/Proovd direct transaction.
- Base, each optional discount, promotion, tax, total.
- Descriptor `PROOVD LISTING`.
- Receipt.
- Formal invoice available through the context-preserving support route.
- Refund object and tax reversal/correction.
- Dispute responsibility: Proovd.

### 24.7 Optional fixed Creator payment as a separate stream

Store:

- Campaign/Creator allocation ID.
- Mutually accepted proposal version.
- Founder-funding charge/object, descriptor, fees, and tax/accounting treatment.
- Amount/currency.
- Funding attempts/status/idempotency.
- Return eligibility, amount, reason, object, and idempotency.
- Completion eligibility/evidence.
- Transfer/payout record.

It never changes Backer totals, 5%, Creator percentage base, sales tax, threshold, or cap.

### 24.8 Refund, reversal, dispute, and cause allocation

Before charge: cancellation/threshold miss/pre-charge kill requires no refund object; it prevents PaymentIntent and removes future-charge eligibility.

After charge:

- **Founder/product-caused refund:** Founder bears refund. Finalized/transferred valid Affiliate earnings remain; unfinalized earnings on the refunded transaction may cancel. Proovd keeps 5% unless it elects, Stripe requires, or law requires a return.
- **Affiliate-caused fraud/breach:** cancel unpaid invalid earnings; already transferred amount creates negative balance/contractual recovery.
- **Proovd/system error:** Proovd corrects it and returns its fee where appropriate; unrelated Affiliate is not debited.
- **Backer dispute unrelated to Affiliate:** follows Founder/MoR charge context; finalized Affiliate earnings remain unless evidence shows Affiliate causation.
- **Law/Stripe/card issuer:** follow mandatory outcome and record allocation.

Every case stores cause classification, Proovd fee treatment, Affiliate treatment, Founder liability, recovery, evidence, Admin, and timestamps.

Consent and evidence do not waive law, network, Stripe, or issuer rights.

### 24.9 Idea refund exceptions

After valid capture, no voluntary/change-of-mind refund. Route and review:

- Duplicate charge.
- Wrong amount.
- Charge after valid cancellation.
- Unauthorized transaction.
- Material campaign misrepresentation.
- Applicable non-delivery.
- Campaign killed for serious violation.
- Refund required by law, Stripe, network, or issuer.

Because the single Founder payment may have released on Day 3, recovery beyond available balance is best-effort reversal, dispute, or contract recovery; never promise all released funds are recoverable.

### 24.10 Product refund policy

- Preserve exact text or immutable snapshot, source URL, title/version, and effective date.
- Show/link at campaign and checkout.
- Store its version with each consent.
- Later website edits cannot alter existing transactions.
- Founder as MoR issues/bears the refund; Proovd can intervene when Founder does not honor recorded policy.

### 24.11 Dispute evidence

On dispute, create an Admin task due within 24 hours. Packet includes:

- Consent text/version and timestamp.
- Campaign disclosure/version at reservation.
- Founder identity/MoR disclosure.
- Reward, subtotal, tax, total, location evidence, and descriptor.
- Delivery date/promise.
- SetupIntent and PaymentIntent/charge.
- Survey responses where relevant and permitted.
- Immutable refund-policy version.
- Fulfillment evidence.
- Updates and support/communication history.

### 24.12 Statement descriptors

- Platform static descriptor: `PROOVD CAMPAIGNS` where applicable.
- Prefix: `PROOVD`.
- Listing fee: `PROOVD LISTING`.
- Campaign descriptor is the actual validated value sent in the Founder/account context.
- Campaign, checkout, reminder, receipt, magic-link, support, and evidence views display the same computed value.
- Never hard-code `PROOVD*[FOUNDERHANDLE]` if the provider sends another value.

---

## 25. Core records and data access

### 25.1 Campaign record

Store:

- IDs, type, type-lock time, and archived replacement linkage.
- Invitation/draft/account-claim events and provenance.
- Founder/account IDs and connected-account status.
- Problem/Solution/Competition and version/provenance.
- Optional-item evidence, high-effort inputs/result, listing-fee calculation/payment/refund.
- Interview record.
- Campaign fields, rewards/SKUs, quantities, dates, story, FAQ, assets, brand notes, claims.
- Immutable Product refund-policy record.
- Idea threshold or Product target.
- Initial roster and mid-campaign associations.
- Proposal/compensation/bonus/fixed-allocation records.
- Review versions, materiality, reacceptance.
- Readiness and launch timestamps.
- Creator-failure/replacement deadline and outcome.
- Reservation/charge/retry/refund/dispute relations.
- Founder last-seen counts/deltas.
- Founder/Creator payment/reconciliation fields.
- Updates/comments/support/risk.
- Fulfillment, Day 14, enforcement, completion, and work-again records.

### 25.2 Reservation record

Store:

- Reservation ID, campaign ID/type, Founder account ID.
- Backer email/phone.
- US billing country/postal code and full address only where required.
- Age confirmation/version/time.
- Reward/SKU and quantity implied by one transaction.
- Pre-tax subtotal.
- Tax amount, jurisdiction/rate, calculation ID, expiry, taxability reason, timestamp, close-usability result.
- Exact total/currency.
- Attribution source, Creator/link, activation time, clicked-at, replacement history, same-device limitation.
- SetupIntent, Customer and payment-method token references.
- Consent, campaign disclosure, and policy versions/hashes.
- Survey answers.
- Mandatory Founder operational-sharing acknowledgment/version/time/status.
- Optional Founder marketing/research/survey consent.
- Proovd newsletter consent.
- Reservation/cancellation/reminder/batch/charge/retry/refund/reversal/dispute statuses and times.
- PaymentIntent/charge IDs.
- Cap-check result and atomic before/after values.
- Magic-link identity relation.

### 25.3 Practical deduplication record

Least-privilege storage:

- Private normalized email/phone hashes.
- Stripe fingerprint reference when available.
- Device/IP risk references.
- Suspected-duplicate case.
- Admin merge/separate decision, evidence, prior/new values, actor, time.

Never expose this as a public identity profile.

### 25.4 Affiliate record and campaign association

Affiliate account:

- Credentials, legal/public identity, DOB/country/state/eligibility, unverified phone.
- Channel metadata, niche, audience evidence, Admin bio/tier/verification.
- Connected-account, requirements, transfer capability, tax-info status, payout status.
- Policy/compliance/suspension history.

Per campaign:

- Recruitment source/Admin/timing and invitation events.
- Preparing-kit access/revocation/pilot exception.
- Formal activation, response, joined-at, `activated_at`.
- Initial/mid-campaign designation and adjusted deliverables.
- Base, bid, bonus, fixed request/decision and every proposal version.
- Agreements/disclosures/tracking.
- Readiness and proof links.
- Deliverables, availability, waivers, completion decision.
- Provisional/earned/unearned amounts and Founder adjustment.
- Fixed allocation/funding/return/payment.
- Transfer/payout/reversal/negative balance.
- Separate discretionary thank-you record.
- Successfully-completed and work-again history.

### 25.5 Founder record

- Credentials/OAuth, invitation/draft IDs, field provenance.
- Legal identity, DOB, business/entity, country/state, unverified phone.
- Connected-account ID/status; no provider identity documents.
- Campaign history and active/cooldown/readiness state.
- Listing-fee records.
- W-9 status/required tax record.
- Communications/support and policy acceptance.
- Live-page last-seen fields.
- Work-again requests.

### 25.6 Admin audit event

Every manual/high-impact event includes:

- Actor and MFA/reauth context where applicable.
- Target type/ID.
- Action.
- Time.
- Reason and internal/customer-facing explanations separately.
- Prior/new state/value.
- Amount/currency.
- Provider object IDs.
- Evidence links.
- Related notification IDs.

### 25.7 Data access

Founder default:

- Aggregate counts, value, conversion, and anonymized/aggregate survey data.
- Immediate Backer email/purchase details only for fulfillment/support.
- Identifiable survey/marketing fields only with the specific optional consent.

Affiliate:

- Aggregate/timestamped clicks, pre-orders, captured amount, conversion, reward summary, and earnings.
- Never Backer name, email, phone, billing address, or identifiable survey response.

Admin:

- Least-privilege operational access needed for review, support, risk, money, and audit.
- Provider-held complete bank/identity data is not copied into Proovd.

### 25.8 Retention

- Backer reservation/survey records: 7 years.
- Founder account/tax data: account life + 7 years.
- Affiliate account/tax/status data: account life + 7 years.
- Marketing consent: until unsubscribe + 2 years.
- Magic-link token hashes/audit: through fulfillment/final resolution + 180 days.
- Raw tokens: never retained.
- Unclaimed draft content: delete/anonymize 30 calendar days after most recent invitation send; retain minimum audit event.

---

## 26. Admin operations product

The Admin panel is the only dashboard-style product in MVP because it monitors many users, cases, deadlines, money states, and risks.

### 26.1 Users

Founder row/detail:

- Name/email, invitation sender/source/sent/claim/draft-link status.
- Signup, country/state, 18+/identity and connected-account status.
- W-9 status.
- Campaign history, active limit, cooldown, ready-next flag.
- Ban status.
- Invitation create/send/resend/revoke controls.

Affiliate row/detail:

- Name/email, channel, niche, audience evidence, verification, internal tier.
- Eligibility and policy status.
- Active partnership count.
- Connected-account/requirements/transfer/payout/tax-info status.
- Campaign invitations/associations and joined/activation times.
- Suspension/enforcement.

Backer/reservation access is through least-privilege campaign/reservation records and support/risk context. Admin accounts are visible only as operationally required.

### 26.2 Campaign detail

Must expose every Campaign record listed in Section 25.1, including separate parallel-track and payment flags. User/Stripe data auto-populates; Admin adds only review/decision/evidence/override data.

### 26.3 Affiliate recruitment and proposal management

Admin can:

- Create/send/resend/revoke a campaign-specific prospect/invitation.
- Verify subtype-appropriate evidence.
- Mark initial-roster or mid-campaign intent.
- View every bid/fixed request/revision/decision and exact deadline.
- Reject matrix/ceiling violations.
- Prevent stale proposal acceptance.
- Observe/mediate without substituting for bilateral acceptance.
- Confirm full fixed-payment funding before work.
- Mark final launch roster.

### 26.4 Creator proof and completion

Admin can:

- Receive public URLs and submission times.
- Pass, request correction, reject, or escalate first posts.
- Pause/re-enable link under recorded reason.
- Verify all deliverables and availability.
- Record Founder/Admin waiver.
- Decide fixed-payment eligibility/return.
- Decide `successfully_completed`.

First-post verification never releases money. Completion/finalization occurs after close/retry.

### 26.5 Reservation/charge ledger

Filter/export by:

- Campaign, Founder, Creator/source/organic/house.
- Date.
- Reservation/SetupIntent/PaymentIntent/retry status.
- Refund/dispute.
- Consent/policy version and optional-consent state.
- Unique Backer vs Product transaction count.
- Duplicate-review case/outcome.
- Subtotal/tax/total, tax expiry/usability.
- Attribution/link activation.
- Cap result.

### 26.6 Money controls

Admin sees and reconciles:

- Captured subtotal, tax, total.
- Proovd 5%.
- Founder share and Stripe fee.
- Creator provisional maximum, earned percentage/bonus, unearned return.
- Fixed allocation funding/return/payment.
- Transfer/payout/reversal/failure.
- W-9 and Founder single/first/remaining-payment status.
- Product early-release evidence.
- Separate thank-you expense.

High-impact actions require recent reauthentication, preview of customer-visible consequences, idempotency, and immutable audit.

### 26.7 Support/dispute/kill operations

Admin can:

- Own/reroute support cases with due time and next promised update.
- Assemble dispute evidence.
- Issue/reconcile refunds/reversals.
- Suspend/kill for AUP, fraud, Founder request, provider risk, deceptive marketing, manipulation, sanctions/regulatory concern, or other reviewed reason.

Kill/suspend requires reason category + free text.

- **Pre-capture:** close active reservations without charge, block future PaymentIntents, reference-safely detach methods, notify roles, preserve page with correct banner.
- **Post-capture:** invoke refund/reversal/recovery policy, restrict unreleased funds where possible, notify roles, preserve evidence.

### 26.8 Chronological customer timeline

One read-only timeline per campaign/reservation/association composes existing events:

- Invitations, drafts, claims, onboarding.
- Interview and review.
- Affiliate recruitment, kit access, response, proposals, readiness, activation, proof, completion, earnings, Transfer/payout.
- Pre-order, tax, consent, Founder data sharing, cancellation, SetupIntent, reminder, capture/retry/refund/dispute.
- Threshold reached/lost.
- Emails, delivery state, deduplication/suppression.
- Support case, owner, SLA, last response, next promise.
- Updates, delivery evidence, payment decisions, Admin actions.
- Work-again request.

Support responses start from editable templates and preserve all context so users are never asked to repeat already-known campaign/reservation/charge facts. Raw provider/fraud codes are never pasted into customer messages.

When a case changes Admin owner, require a handoff note containing verified facts, current owner, next customer promise, and statements that must remain consistent. For the first cohort, Admin may log one-time human relationship touches such as campaign introduction, launch-eve check, mid-campaign welcome, close thank-you, and post-campaign debrief; these are personal service events, not automated engagement spam.

---

## 27. Notification and service contract

### 27.1 System-wide state pattern

Every waiting, review, payment, recovery, or exception state answers:

1. What happened?
2. What happens next?
3. Who owns it?
4. When is the next update?
5. What can the user do now?
6. How do they get help without losing context?

Every consequential action has immediate on-screen confirmation and a durable email or product-history record.

Dates are local time primary with canonical UTC secondary; deadline emails spell out timezone.

### 27.2 Transactional email rules

- Not opt-out-able.
- Specific subject and campaign/product name.
- At most one primary action.
- Plain-text support route and stable campaign/reservation/case reference.
- Money emails include amount, seller/MoR, descriptor, pending/completed status.
- High-impact messages can be previewed with final variables before manual send.
- Duplicate webhook/job delivery cannot create duplicate email.

### 27.3 Founder transactional events

- Personalized invitation.
- Public-route email verification if later enabled.
- Password reset.
- Interview confirmation/reminder/reschedule/cancel.
- Connected-account requirement/status.
- Listing-fee receipt/refund.
- Formal response window start and roster updates.
- Creator proposal/revision/decision.
- Mid-campaign Creator proposed/accepted/activated.
- Submission receipt with owner/next date.
- Changes required/approval.
- Fixed-payment funding request/confirmation/failure.
- Campaign live.
- Idea threshold reached/lost.
- Campaign ended and separately Results ready.
- W-9 prompt/block.
- Idea single payment; Product first/remaining payment release/block.
- Day 14 and Product early-fulfillment request/pass/fail.
- Suspension/kill.
- Ready-next-campaign.
- Work-again response.

### 27.4 Affiliate transactional events

- Campaign-specific invitation.
- Signup confirmed/waiting.
- Founder signup completed/preparing campaign available.
- Formal opportunity available.
- Proposal/revision/Founder decision/deadline expiry.
- Accept/decline confirmation.
- Disclosure/tracking available.
- Fixed funding complete; readiness remains explicit.
- First-post pass/correction/reject.
- Completion/fixed-payment decision.
- Campaign live/closed.
- Mid-campaign invitation/readiness/activation.
- Commission finalized.
- Transfer created/failure/reversal/update.
- Payout paid/failed when available.
- Connected-account info required.
- Warning/suspension/policy reacceptance.
- Work-again request.

### 27.5 Backer transactional events

- Pre-order confirmation.
- Pre-charge reminder.
- Cancellation confirmation.
- Threshold miss/no charge.
- Charge receipt.
- Failed charge/update card.
- Retry success or dropped.
- Refund started/completed/failed.
- Support received/Founder response/follow-up.
- Campaign update digest if selected.
- Delivery and satisfaction survey.
- Suspension/kill.
- Magic-link reissue.

### 27.6 Internal events

- Invitation claimed/new account.
- Interview changes.
- Listing paid/deadline started.
- Campaign submitted.
- Proposal awaiting response.
- Fixed funding received/failed.
- Post verification and deliverable verification due.
- Threshold reached/lost.
- Charge batch result and failed-payment spike.
- Retry/reconciliation complete; money decisions due.
- Missing W-9.
- Day 14 due.
- Dispute/risk/support SLA breach.
- Work-again request.
- Mid-campaign Affiliate invite/accept/readiness/activation.

### 27.7 Digests and in-app history

- Optional daily/weekly digest for eligible activity such as updates/comments/roster changes.
- Backer selects preference at first magic-link visit; Founder/Affiliate in settings.
- Authenticated Founder/Affiliate/Admin surfaces have notification history.
- Notification history does not turn Founder home into a widget dashboard or override the one ranked Act item.
- No real-time push required.

### 27.8 Service SLA

Public footer and support state:

```text
Contact Proovd
Email: support@proovd.co
We respond within one (1) business day, Monday–Friday, excluding U.S. federal holidays.
Postal: Proovd LLC, 254 Chapman Rd, Ste 208 #27541, Newark, DE 19702, USA.
```

Support submission returns case ID, topic, owner, human-response due time, and the 48-hour Founder follow-up rule. Even without resolution, send an update at the promised checkpoint. Admin sees due/overdue badges and a daily queue of responses/promises due.

---

## 28. Authentication, token, privacy, and security contract

### 28.1 Tokens

Magic-link and temporary-draft tokens:

- Cryptographically secure, at least 128 bits entropy.
- Raw value only in delivered URL; never at rest or logs.
- Store one-way hash, version, issued/last-used/revoked times, reason, and lineage.
- Constant-time comparison where supported.
- Rate-limit attempts and resend.
- Non-enumerating error responses.
- Rotation/resend revokes superseded versions immediately.
- Scope to exactly one draft or one Backer/campaign identity.
- Special short-lived provider session may be used for update-card, but must preserve underlying identity/scope.

### 28.2 Admin security

- MFA required.
- Recent reauthentication for money, refund, connected-account, kill/suspend, and equivalent actions.
- Immutable audit.
- No sensitive value in logs, client bundles, screenshots, email, or documentation.

### 28.3 Payment security

- Raw card data never touches Proovd servers.
- Keys/secrets only in environment/secrets manager, never repository/frontend/chat/email.
- Explicit test/live separation and fail-closed validation.
- Webhook signature verification.
- Store provider event ID and process idempotently.
- Duplicate event can update audit but cannot duplicate domain state, money, or notification.

### 28.4 Privacy and consent

- Mandatory fulfillment/support sharing is disclosed and limited to email/purchase details actually needed.
- Founder marketing/research/survey consent is separate, optional, unchecked, purpose-specific.
- Proovd newsletter consent is separate and unchecked.
- 18+ confirmation is required and unchecked.
- No dark pattern, preselection, or bundling of optional consent.
- Affiliate receives no Backer PII.
- Comments use privacy-safe identity.

### 28.5 Accessibility and responsive baseline

- Mobile-first responsive behavior, including 320px width.
- Adequate tap targets, labels, focus order/visibility, contrast, error summary, programmatic error association, and screen-reader names.
- No clipped amount, date, or action.
- Complete keyboard path for Founder forms, Affiliate decisions, campaign/checkout, magic-link cancellation/card recovery, and support.
- Images/video have useful accessible names/captions where supported.

---

## 29. Enforcement and exceptional operations

### 29.1 Affiliate self-pre-order and fraud

Affiliate may back a promoted campaign only after disclosing intent and certifying genuine self-funded purchase with identity-disclosed information. It earns no commission, bonus, or thank-you.

Prohibited:

- Funding/coordinating others to inflate metrics.
- Multiple accounts/IP/device identities to back the same Idea campaign.
- Reciprocal pre-order schemes.
- Engagement/click boosting.
- Artificial Backer, amount, or conversion inflation.

### 29.2 Affiliate conflicts

Disclose material business, family, financial, investor, advisor, contractor, employee, Backer, Founder, other-Affiliate, or competitor relationship. Undisclosed conflict may suspend the partnership.

### 29.3 Affiliate one-month competitor restriction

For one month after the active campaign ends, Affiliate cannot promote a directly competing product with substantially the same core function. Adjacent products remain allowed.

### 29.4 Affiliate suspension/appeal

Admin may warn, pause, terminate, demote, restrict bidding, remove, or refer a case for AUP breach, fraud, metric manipulation, deceptive promotion, host-rule violation, regulatory/provider risk, or repeated invalid termination.

Customer-facing enforcement states exact evidence/behavior, rule, immediate effect, correction, appeal deadline, and human route. Internal reason remains separate. Appeal window is five business days where policy allows; Admin appeal decision is final.

### 29.5 Affiliate ghosting and termination

Launch Creator ghosting: zero posts during first seven campaign days. Mid-campaign Creator: zero posts in the agreed period from activation, not later than close.

Recovery:

- Attempt replacement.
- Continue when other Creators remain.
- If only one and replaced, Admin may extend for lost days.
- If no replacement and campaign cannot perform, suspend/kill.
- Fixed-payment and commission follow completion/cause rules.

Valid active termination reasons: Founder material breach, Proovd suspension, documented emergency/capacity, or other Admin-accepted reason. Invalid termination may affect discretionary thank-you, internal tier, future access, or removal, but cannot claw back valid finalized commission absent Affiliate-caused invalidity.

### 29.6 Required launch Creator failure

Before `campaign_live_at`:

- Admin records `creator_failure_recorded_at` once.
- Set `creator_replacement`.
- Calculate exact due timestamp using configured US business calendar/version; retries/edits cannot reset it.
- Replacement must become fully ready by due time.
- Failure sets `refunded_no_creator`, returns funded allocation, refunds full listing Checkout total including tax treatment, and notifies parties.

### 29.7 Campaign suspension/kill

Pre-charge behavior and post-charge behavior follow Section 26.7 and payment cause rules. Preserve page/evidence/support access. Successful SetupIntents remain historical, never rewritten as canceled.

### 29.8 Policy updates

Material Terms/AUP updates require Founder/Affiliate reacceptance. Continued use is suspended until accepted. Store policy version and acceptance time.

### 29.9 Unknown charge support

Before a dispute, support identifies Founder/campaign, sends receipt/context, routes refund/product support as appropriate, and stores the interaction for evidence.

### 29.10 Not-as-described or defective Product reward

- Backer contacts Founder first through magic-link support.
- If no response within 14 days or no resolution, Backer may escalate to Proovd.
- Proovd mediates.
- Backer retains issuer dispute rights.
- Proovd packages evidence within 24 hours of dispute notice.

---

## 30. Explicitly deferred and prohibited scope expansion

Deferred unless trivial or required by a launch blocker:

- AI pitch rewriting/refinement.
- Automated Founder scoring.
- Algorithmic general-pool Affiliate matching.
- Founder browsing/outreach to unmatched Affiliates.
- Full teaser mode.
- Reusable Affiliate course/resource library; the single Campaign kit is required.
- Founder–Creator meeting scheduler; the human Founder interview scheduler is required.
- Direct Founder–Affiliate messaging.
- Real-time sockets/dashboards.
- Backer password accounts/profiles.
- Full in-product dispute center.
- Fully automated milestone/payout decisions.
- Custom tax-filing product beyond required provider/reporting records.
- Hosted Founder community.
- Non-US roles.
- W-8BEN/W-8BEN-E and other non-US tax workflows; policy/data models may reserve future compatibility but no non-US onboarding is live.
- Physical/mixed rewards.
- Enterprise procurement.
- Native mobile app unless separately planned.
- Automatic Affiliate percentile pruning.
- Public Founder ratings.
- Advanced stock-style analytics or animations.
- Push-notification matrix.
- General product tours/splash education.
- Full recurring Creator-management product beyond work-again request.
- Click-exit surveys/public like signals unless trivial and privacy-safe.

Do not add apparent delight that weakens trust:

- Confetti/streaks/countdown pressure that confuses saved card with charge.
- Fake scarcity, fabricated popularity/live viewers, or false urgency.
- AI support presented as a human.
- Public leaderboards/shaming.
- Prechecked optional consent.
- Live chat without staffing.
- Real-time claims for refresh data.
- Automatic review/payment presented as human safety.
- Generic errors without money/data status and recovery.
- Multiple competing actions in payment/cancel/refund/card-recovery states.

---

## 31. Campaign operating brief, policy, agreement, and product-content contracts

### 31.1 First-cohort operating configuration

- First Founder cohort: 50 manually invited Founders, one first campaign each. `First 50 Founders`, `first 50 campaigns`, and `first 50 invitees` refer to this same group.
- It has no special pricing; the standard US$35-base/US$25-minimum calculation and 5% campaign fee apply.
- Initial Affiliate cohort: approximately 50 separately hand-picked distribution partners. This is not the Founder cohort.
- Recruitment is campaign-specific and human-led until enough conversion history exists for any future recommendation model.
- Record category fit, audience, channel, engagement, access, demographics where available, and similar-campaign performance for human decisions; do not present an algorithm as live.

### 31.2 Campaign-specific operating brief

Every campaign has one Admin-maintained operating brief. It configures the generic product and prevents undocumented Founder-specific decisions.

Identity:

- Campaign title/type/type-lock.
- Founder legal/entity/sole-proprietor identity, country/state, connected account.
- Product/startup name, URL, category, digital reward category.
- Open/close UTC and delivery date per reward.
- Internal Proovd owner.

Product/launch scope:

- What exists now and what is being validated/launched.
- Idea problem/viability threshold or Product launch frame (feature, hard launch, founding offer, relaunch, beta cohort).
- Realistic delivery.
- Supported claims/evidence and prohibited/unconfirmed claims.
- Screenshots/demos/videos/testimonials/assets.

Target Backer:

- Primary audience, geography/age exclusion.
- Pain point and purchased outcome.
- Why now.
- Objections and risk-reducing proof.
- Reachable Creator/newsletter/podcast/community/education/student/network/marketing channels.

Founder discovery record:

1. Product/feature.
2. Clearest Backer outcome.
3. Current credibility.
4. Deliverable timing.
5. Realistic rewards.
6. Entry-tier hook.
7. Community/accountability/access value.
8. Top-tier economic/high-value hook without unsupported promises.
9. Product refund policy.
10. Claims to avoid.
11. Creator-usable materials.
12. Best audience channels.
13. Product-Campaign willingness to consider Creator-requested fixed amounts; never for Idea.
14. Creator-specific bonuses, if any.

Sourcing plan:

- Channel categories and named prospects.
- Audience fit/size/quality.
- Permission basis.
- Disclosure and claim constraints.
- Compensation hypothesis.
- Primary, secondary, replacement, and mid-campaign roles.

Reward design considers a strong low-friction entry, a community/access middle, and a genuine high-value top offer. These are structural considerations, not fixed names/prices.

Pre-close and post-close plan:

- Close/retry timing and monitoring owner.
- Founder/Backer/Creator communications.
- Bonus/fixed/commission verification.
- W-9/Founder-payment review.
- Day 14 evidence.
- Fulfillment cadence/support.
- Organic/house/Creator reporting and case-study measurements.

### 31.3 Founder product-copy persona

Founder education and campaign-building copy speaks to an aspiring Gen-Z founder of an AI-powered consumer SaaS product without assuming every Founder/product uses AI. The product emphasizes:

- Real signal over compliments.
- Demand validation before overbuilding.
- Prototype versus proof.
- A few users versus repeatable distribution.
- Distribution-partner interest as an early signal.
- Testing the consumer outcome, not merely the AI mechanism.

Approved positioning ideas include `Before you build the AI-powered app, prove people want the outcome`, `AI is the engine. Demand is the test`, `A prototype is not proof`, `A couple of users is not a market`, `Your group chat is not validation`, and `If it flops, good—you saved months`. They guide tone and education; they are not required literal text on every page.

### 31.4 Canonical policy-route contract

The separate legal files remain authoritative legal text, but implementation must publish complete, consistent versions covering:

- **Terms:** Proovd platform role, Founder MoR, both campaign types, listing fee/refunds, 5%, Affiliates, SetupIntent/off-session charge, support/dispute allocation, Delaware law, liability, contact.
- **Privacy:** role data, mandatory limited Founder operational sharing, separate optional Founder marketing/research/survey consent, no Affiliate PII, Stripe/tax sharing, rights, retention, transfers.
- **Cookies:** attribution/session/security/provider cookies and choices consistent with actual behavior.
- **Refunds:** pre-close cancellation; Idea threshold miss/no charge and post-capture exceptions; Product immutable Founder policy; delays/not-as-described; listing-fee no-acceptance/replacement/Founder-cancellation refunds; descriptors and timing.
- **Fulfillment:** digital-only delivery mechanisms, dates/windows, communications, changes, late delivery, support.
- **Founder AUP:** current prohibited/restricted categories, digital-only, sanctions, truthful claims, delivery/refund/communication, date-change process, reversal/recovery authorization, W-9, conflicts, suspension, one-strike ghost ban, entity-Founder guaranty where counsel requires it, and periodic updates.
- **Affiliate AUP:** independent marketer status, sanctions/identity/audience evidence, FTC/channel rules, compensation/Transfer/tax, self-pre-order, active cap, competitor rule, conflicts, data handling, termination/appeal/indemnification/reverification, and cause-based remedies.
- **IP/confidentiality agreement:** terms in Section 31.5.

The AUP/restricted-category mapping is reviewed at least quarterly. Material policy updates require reacceptance. No route may contain placeholder or summary-only text at launch.

Every public footer contains legal entity, email, one-business-day SLA, postal address, and links to Terms, Privacy, Cookies, Refunds, Fulfillment, AUP, Stripe Connected Account Agreement, How payments work, and Safety. Tawk.to live chat may appear where actually staffed/implemented during stated US business hours; never promise unstaffed chat.

### 31.5 Creator-only IP and confidentiality terms

One agreement instance per campaign-Affiliate association:

- Click acceptance binds the Creator only; Founder obligations live in versioned Founder Terms.
- Proovd may be a beneficiary where counsel approves.
- Confidentiality: two years after campaign end/termination.
- Non-replication of substantially similar product: two years.
- Founder retains concept and promotional materials.
- Affiliate retains pre-existing IP and their creative contribution.
- Affiliate receives limited, non-transferable, revocable license to use campaign materials only for active promotion.
- Lawfully published campaign content may remain live after campaign end and may be referenced in portfolio/case study.
- Affiliate may not disclose confidential information, build/copy the concept, help others build/copy it, or use it for another purpose.
- Pilot pre-view exception allows the private authenticated preparing kit before agreement, but creates no work permission; access is logged/revocable and the agreement remains mandatory before work.

### 31.6 Founder cancellation

- Within 48 hours of `listing_paid_at` and before live: Founder may cancel and receives the entire listing Checkout charge including tax reversal/correction.
- After 48 hours or after live: requires Admin approval; no automatic listing-fee refund.
- A campaign killed for an AUP/enforcement reason has no automatic listing-fee refund; Admin discretion and mandatory law/provider rules control.
- A successfully launched campaign or natural close does not refund the listing fee merely because results were weak.
- Before Backer capture: close active reservations/no charge, block PaymentIntent, remove future-charge authority, notify all roles.
- Funded fixed allocation returns to Founder unless every agreed deliverable was already completed and Admin determines it was earned under locked terms. Before-close cancellation normally creates no Creator commission because no Backer charges exist.
- After Backer charges: Admin applies refund/reversal and cause-based Creator rules. Cancellation does not create a fixed payment or automatically claw back valid finalized earnings.

### 31.7 Risk-control inventory

Before close and throughout live operations, Admin/system surface:

- Stripe Radar result on every PaymentIntent.
- Practical Idea duplicate queue.
- Any reservation amount above the highest valid reward price.
- Click velocity/fraud and suspicious conversion spike.
- Affiliate self-pre-order and duplicate Affiliate accounts.
- Founder/Affiliate disclosed or suspected relationship.
- Sanctions/OFAC or provider restriction.
- Tax `not_collecting` or missing-registration result; zero tax caused by missing collection configuration is not treated as proof that no tax is due.
- Connected-account requirement/capability change.
- Batch/webhook/job/ledger exception.

Founder seller tax readiness requires head-office location, applicable product tax code, registration, and active provider tax settings before live tax collection.

### 31.8 Backer status and satisfaction

Magic-link status progression is derived from real state and never predicts an unconfirmed outcome:

`Reserved → Charge due / No charge → Captured / Failed → Delivery due → Delivered / Refunded`.

After delivery, satisfaction starts with one-click satisfied/not satisfied or 1–5, then optional reason. It takes under 30 seconds, does not coerce newsletter consent, and a negative response creates an owned Admin follow-up task.

### 31.9 First-cohort measurement

Use existing events; do not build a general analytics warehouse.

Four-number Founder scoreboard, baseline `not measured` until the first 10 invited Founders:

- **Time to first magic:** median invitation-open to possible-creator rendering.
- **Founder completion:** opened invitations reaching successful listing payment with connected onboarding complete.
- **Return after closure:** Founders opening Results ready within seven days and completing a real post-campaign action.
- **Next-action correction rate:** Founder sessions where the ranked Act item is dismissed/reclassified/overridden because state/priority was wrong.

Also track autosave failures, listing-fee support contacts, time to first formal Creator response/roster update, proposal outcomes, compensation questions, reservation failure step, reminder delivery/open/cancel, support-free cancellation, payment recovery, unknown-charge contacts/disputes, support SLA misses, delivery satisfaction/follow-up, and duplicate messages suppressed/sent.

Do not improve metrics by hiding cancellation/support, prechecking consent, or redefining failures.

## 32. Implementation order and Stripe test contract

### 32.1 Recommended build sequence

1. Public site, canonical policies, and non-payment samples.
2. Admin invitation records and secure Founder drafts.
3. Pre-account vetting, type lock, possible-creator result, account claim/provenance.
4. Affiliate prospects, private signup, waiting/preparing handoff, Campaign kit.
5. Founder interview, optional-item evidence, high-effort and listing fee.
6. Founder/Affiliate connected-account status and test-mode onboarding.
7. Listing Checkout and one-time activation of formal response/build tracks.
8. Proposals/roster readiness/campaign building/review/material reacceptance.
9. Fixed-payment funding records and Creator readiness.
10. Campaign rendering, MoR/consent, coordinated activation/tracking.
11. Reservation tax/SetupIntent/card-save/magic-link/cancel/reminder.
12. Admin reservation/charge/duplicate/risk operations.
13. Close batch, tax-usability validation, off-session capture, retry.
14. Creator completion/earnings/Transfer and Founder payment controls.
15. Refund/reversal/dispute/evidence and enforcement.
16. Fulfillment, Day 14, completion, work-again, cooldown/readiness.
17. Full P0 CX/accessibility/idempotency/live-readiness pass.

### 32.2 Required mode-safe environment inputs

Use explicit project naming as needed, but cover:

- Stripe mode.
- Locked API version.
- Platform account ID, secret and publishable keys.
- Platform and Connect webhook secrets.
- Connect return/refresh URLs and OAuth client ID if used.
- Test Founder connected account.
- Test Affiliate recipient connected account.
- Backup-mode feature flag.
- Stripe Tax feature flag.
- App base URL.
- Protected close-job/cron secret.

Fail closed on any mode/context mismatch. No test cards or test controls appear in production UI.

Reference environment contract:

```text
STRIPE_MODE=test
STRIPE_API_VERSION=[LOCKED VERSION]
STRIPE_PLATFORM_ACCOUNT_ID=acct_...
STRIPE_PLATFORM_SECRET_KEY=sk_test_...
STRIPE_PLATFORM_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET_PLATFORM=whsec_...
STRIPE_WEBHOOK_SECRET_CONNECT=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...                 # only if OAuth is used
STRIPE_CONNECT_RETURN_URL=https://[app]/stripe/return
STRIPE_CONNECT_REFRESH_URL=https://[app]/stripe/refresh
STRIPE_TEST_FOUNDER_CONNECTED_ACCOUNT_ID=acct_...
STRIPE_TEST_AFFILIATE_CONNECTED_ACCOUNT_ID=acct_...
STRIPE_TEST_BACKUP_MODE_ENABLED=false
STRIPE_TAX_ENABLED=true
APP_BASE_URL=https://[environment-app]
CRON_SECRET=[PROTECTED CLOSE-JOB SECRET]
```

The Founder test account represents the intended Standard seller account unless the approved implementation uses a different account type. The Affiliate test account represents the approved recipient/transfer capability.

Local development supports authenticated Stripe CLI or equivalent webhook forwarding and stores the matching CLI signing secret only in local environment configuration.

### 32.3 Webhook processing

Handle and store idempotently where applicable:

Platform/listing:

- `checkout.session.completed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`

Connected-account/campaign:

- `account.updated`
- `account.application.authorized` / `deauthorized` if OAuth is used
- `setup_intent.succeeded`
- `setup_intent.setup_failed`
- `setup_intent.canceled` only for an intent canceled before success
- `setup_intent.requires_action`
- `payment_method.detached`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.requires_action`
- `payment_intent.canceled`
- `charge.refunded`
- `charge.dispute.created` / `updated` / `closed`
- `transfer.created` / `updated` / `reversed`
- `payout.paid` / `payout.failed` when required

A Transfer API creation failure is a synchronous API error and retry-job case; do not wait for a nonexistent `transfer.failed` webhook.

### 32.4 Provider-object storage

Store every object affecting state with mode, account context, related domain IDs, amount components, status, idempotency key, failure details, and timestamps. At minimum this covers Checkout/session/payment, connected accounts, Customers, SetupIntents, PaymentMethods, Tax calculations, PaymentIntents, Charges, application fees/adjustments, Refunds, Disputes, Transfers, reversals, and Payouts.

### 32.5 Required test-card outcomes

- Successful setup and later charge.
- Generic decline.
- Insufficient funds.
- Off-session authentication/3DS required.
- Expired card.
- Incorrect CVC/setup failure.
- Processing/API error.
- Full and partial refund.
- Dispute.

Use current official provider test values during implementation; do not hard-code obsolete documentation into the customer product.

### 32.6 Test evidence log

Retain test environment, connected-account IDs, campaign/reservation/PaymentIntent IDs, webhook endpoint, scenario, pass/fail, defect/fix/retest, and unresolved approved blocker. Deleted provider test data must be deleted internally or marked invalid test artifact.

### 32.7 Direct and backup architecture tests

Preferred/direct test proves:

- SetupIntent and PaymentIntent are created in the correct Founder account context.
- Founder remains MoR in domain records/disclosures.
- Exact subtotal + tax charge and separate 5%/provisional Creator amounts reconcile.
- Failure enters retry; success updates every role/admin surface.
- Post-close verified Affiliate Transfer occurs once.

Backup separate-charge/transfer test proves when that path is approved/enabled:

- The same Backer reservation/consent experience.
- Correct platform charge context and `on_behalf_of` where supported.
- Metadata/transfer group tie campaign, reservation, Founder, and attribution.
- Tax stays separate; 5%/provisional Creator/founder share use pre-tax subtotal.
- Founder share cannot become available before its schedule.
- Transfer/reversal/refund/dispute states are visible even when an MVP money action is manual.
- Customer copy still names Founder as seller and never uses escrow/trust/custody.

---

## 33. Mandatory acceptance suite

These tests are requirements, not examples. Each must pass at server, domain-state, customer surface, notification, Admin, and audit levels where applicable.

### 33.1 Invitation, draft, vetting, and account

1. Personalized draft opens without account and grants no other access.
2. Token alteration, cross-Founder access, replay, expiration, revoke, resend, and simultaneous claim fail safely.
3. 30-day deletion/anonymization runs from most recent send.
4. Path/Problem/Solution/Competition order, progress, Back/Continue, autosave, restore, unsaved warning, and provenance work.
5. Competition cannot be prefilled.
6. Possible-creator result precedes account and cannot promise acceptance.
7. Type locks at vetting; wrong type archives and restarts without migrating agreements/payments/consents.
8. No SMS OTP exists.
9. `founder_signup_complete` emits once and reveals the preparing campaign to only eligible campaign-specific Affiliates once.

### 33.2 Affiliate signup, response, and proposals

1. No public signup; invitation claims only the Affiliate's account/association.
2. Compact flow has Proovd account action and Stripe payout action, no custom bank form/tour.
3. Waiting state is named and no-action-needed.
4. Campaign kit is complete, private, logged, scoped, revocable.
5. Listing payment activates formal decision/deadline exactly once.
6. Accept, decline, and propose are reachable; decline has no penalty.
7. Six compensation-matrix cells produce correct base/bid/fixed rules.
8. Idea rejects fixed request; standard campaign rejects bid above base.
9. Proposal/revision versioning prevents stale/double acceptance.
10. Only exact bilateral acceptance locks.
11. Pending proposal expires at deadline and does not prevent refund.
12. Percentage ceiling includes base/bid/bonus and never exceeds 50%.
13. Creator-specific bonus ignores organic/house/other-Creator results.

### 33.3 Optional items, listing fee, and roster

1. Objective evidence rules reject placeholders, inaccessible links, unapproved Story, and unconfirmed interview.
2. Every item combination produces US$35 minus US$2/item to US$25 minimum.
3. Canceled interview before payment recalculates; after payment does not.
4. High-effort is correct for all eight combinations and locks at payment.
5. Checkout/receipt list base, each discount, tax, total, descriptor, refund, separate 5%.
6. Listing fee remains separate from Connect campaign money.
7. 72-hour clock starts at successful payment, not invitation/signup.
8. Zero recruits/no bilateral locked acceptance refunds full Checkout subtotal + tax once.
9. Roster readiness follows all six rules; non-required pending Creator does not block after Admin closure.
10. `review_ready` is false until both tracks complete.
11. Founder cancellation within 48 hours and before live refunds the full Checkout total; later/live cancellation requires Admin and follows the pre/post-capture rules.

### 33.4 Review, funding, readiness, launch

1. Required/optional feedback preserves draft and deep-links.
2. Non-material change preserves readiness; every material class versions/requires affected reacceptance.
3. Fixed funding requires exact full amount and accepted version; failed/partial/duplicate funding cannot mark funded.
4. No Creator begins work before all readiness items.
5. At launch, page first, links second, posts third, verification fourth.
6. Duplicate activation/verification produces one state/message and no money.
7. First-post verification releases US$0.
8. Correction/reject pauses the Creator/link and invalid earnings but does not reverse page launch.
9. Required Creator failure creates one non-resettable three-business-day deadline; missed deadline returns allocation and full listing Checkout total.

### 33.5 Backer/card/tax/cap

1. Non-US billing and unchecked age fail before SetupIntent.
2. Checkout shows subtotal + tax = exact total, US$0 today, trigger, delivery, seller, descriptor, cancel, sharing.
3. Optional Founder and Proovd consent are separate/unchecked.
4. Successful SetupIntent creates one reservation; setup failure creates none.
5. Mandatory operational details reach Founder immediately and cancellation adds `do not fulfill`.
6. Affiliate receives no PII.
7. Idea one-active-pre-order/deduplication rules work; shared IP alone never merges.
8. Idea reward replacement keeps old selection on failed replacement.
9. Product permits multiple one-reward transactions and unique Backer count remains one.
10. Concurrent requests near US$50,000 cannot exceed the pre-tax cap.
11. Stored tax calculation/expiry/total reconcile; unusable calculation creates no PaymentIntent and no substituted amount.
12. Success/magic-link/email all say not charged and match ledger.
13. Magic-link duration, revoke/reissue, non-enumeration, and invalid recovery work.

### 33.6 Attribution and live campaign

1. Last valid same-browser/device Creator link wins and direct return preserves it.
2. Later Creator link replaces; cookie ends at close.
3. Pre-activation/paused/post-close traffic and mid-campaign prior traffic earn nothing.
4. Post-activation results remain provisional until verification.
5. Days 1–7 direct-known-link only; Day 8 discovery switch does not rewrite attribution.
6. Founder Glance delta is exact; failed render does not advance last-seen.
7. Act shows one correctly ranked real action or caught-up ending.
8. Explore contains complete data/freshness without widget grid.
9. New/canceled/net counts reconcile.
10. Threshold reached/lost notifications fire once per crossing.
11. No scheduled generic Day 3/7/10 check email exists.
12. Non-material live edit versions; material edit cannot publish directly.
13. Mid-campaign addition gets remaining-time terms/readiness and no retroactive credit.

### 33.7 Cancellation, close, retry, and idempotency

1. Cancellation prevents PaymentIntent, preserves successful SetupIntent, and reference-safely detaches.
2. Canceling one Product transaction does not invalidate another sharing the method.
3. Screen/email show US$0 and duplicate cancel is harmless.
4. Threshold miss/pre-charge kill creates no PaymentIntent/refund object.
5. Idea threshold is fixed at close and payment failures do not reverse success.
6. Product charges every active transaction regardless of internal target.
7. Close batch run twice, duplicate webhooks, and crash/restart cause no double charge/earnings/email.
8. Decline/insufficient funds/requires action enter correct 48-hour recovery.
9. Update-card preserves data and success removes stale failure.
10. Dropped failures count in no revenue/commission.
11. `Campaign ended` and `Results ready` are separate.
12. An incomplete batch is visibly recoverable in Admin, reservations remain locked, and retry does not double-charge or duplicate receipts.

### 33.8 Creator and Founder money

1. Proovd 5% and Creator percentage exclude tax.
2. Provisional maximum and earned/unearned reconciliation happen once; provisional amount is never Proovd revenue.
3. Transfer combines finalized commission, earned bonus, and eligible fixed amount once.
4. Transfer synchronous failure records/retries idempotently.
5. No valid post returns fixed amount and commission = zero.
6. Valid post + incomplete later work returns fixed amount but preserves genuine valid commission.
7. Full completion earns fixed amount despite weak sales.
8. Returned/paid allocation cannot repeat.
9. W-9 blocks every Founder payment.
10. Idea creates only 100% Day 3 single payment; no second object.
11. Product creates 40%/60%; early remaining payment cannot occur before Day 3 or without actual delivery/communication/tax/no-risk evidence.
12. Early release does not skip Day 14.
13. Money surfaces use identical amounts/status/reasons.
14. Thank-you is never estimated/promised, cannot use campaign balances, and cannot duplicate.

### 33.9 Refund, dispute, suspension, and support

1. Product consent preserves immutable Founder policy version.
2. Every refund has lifecycle requested/submitted/succeeded/failed and cause classification.
3. Founder-caused refund does not claw back finalized valid Affiliate earnings.
4. Affiliate-caused refund cancels/recovers only invalid earnings.
5. Proovd error does not debit unrelated Affiliate and returns fee where appropriate.
6. Unrelated dispute does not automatically claw back Affiliate.
7. Evidence packet includes all required consent/tax/policy/delivery/support data.
8. Pre-charge kill closes without charge; post-charge kill invokes recovery.
9. Outcome-specific ended pages distinguish threshold miss, natural close, pre-charge kill, post-charge suspension.
10. Support case has stable reference, owner, due time, context, and 48-hour Founder follow-up.
11. Internal fraud/provider codes never become raw customer copy.
12. Duplicate event creates one customer message and timeline suppression record.
13. The computed campaign descriptor passes provider validation and matches campaign, checkout, reminder, receipt, magic link, support, and evidence.

### 33.10 Fulfillment, completion, and future work

1. Delivery notification contains access and original promise/support.
2. Revised date preserves original and proper approval/notice path.
3. Day 14 pass/fail evidence and consequences match campaign type.
4. Ghost-ban triggers only under defined conditions and is audited.
5. `successfully_completed` requires all five criteria and Admin evidence.
6. Zero sales does not block completion when work was valid.
7. Only eligible completed Creator can receive a post-end work-again request.
8. Request accept/decline creates no campaign and bypasses no cooldown/readiness.
9. Founder sees exact cooldown date and separate readiness decision.
10. Satisfaction takes under 30 seconds and a negative result creates one owned follow-up case.

### 33.11 Accessibility and content QA

1. Full principal flows pass at 320px, desktop, keyboard, and screen reader.
2. Labels/errors/focus and amounts/dates/actions are intact.
3. US English and role names are consistent; no `MBP`, `reservation`, `tranche`, or undefined acronym leaks to Founder/Backer.
4. Every CTA names the actual action.
5. Campaign, checkout, confirmation, email, magic link, Admin, and evidence agree on reward, amounts, seller, trigger, delivery, policy, descriptor, and SLA.
6. No unresolved variables, broken links, old campaign names, or placeholder policies.
7. Loading/empty/waiting/success/failure states all use the six-question pattern.

### 33.12 Admin state, time, security, and measurement

1. `listing_paid_at`, `campaign_live_at`, and `campaign_close_at` independently anchor every deadline.
2. Replacement deadline is exact, calendar-versioned, and cannot silently reset.
3. Campaign lifecycle and payment flags remain separate and independently auditable.
4. User/provider data auto-populates Admin; every override preserves before/after, reason, actor, and time.
5. MFA is enforced and sensitive action without recent reauthentication fails safely.
6. First 10 invited Founders establish the explicitly labeled baseline for the four Founder scoreboard metrics; no invented baseline exists.
7. Case-study and cohort metrics come from defined events without hiding cancellations, support requests, or failed payments.

---

## 34. Live-mode readiness gate

The first campaign cannot collect live card details until:

- Production payment architecture/account roles/capabilities are recorded and match implementation.
- Affiliate recipient Transfer/payout and fixed-payment path are approved/enabled or those features remain disabled.
- Tax registrations, product codes, seller responsibility, calculation validity/reuse, filing, refund treatment, and exact consent are reviewed/configured.
- All canonical policy files are complete and consistent.
- Test/live key separation and webhook signatures pass.
- Required test-card and idempotency cases pass.
- Sample campaigns prove no-charge-today consent and collect no cards.
- Admin MFA/reauthentication/audit and token security pass.
- P0 CX/accessibility/support/notification-deduplication tests pass.
- Human Admin reconciles provider test results to internal ledgers.
- One pilot campaign has named monitoring and rollback owners.

While blocked, public demos, interest collection, Founder/Affiliate onboarding, campaign drafting, manual review, recruitment, and test-mode engineering may proceed. Real card data, live SetupIntent/PaymentIntent, live application fee, live fixed funding, Affiliate Transfer, or payout promise may not.

---

# Appendix A — Exact customer copy requirements

Variables must come from the same versioned domain records used by the ledger. Legal review may require a newer canonical version before launch; if so, update this specification and every rendered surface together.

## A.1 Homepage trust strip

```text
How Proovd works behind the scenes.

Proovd is a software platform for vetted-founder crowdfunding,
operated by Proovd LLC (Delaware, USA). Every founder is vetted
before launch. Proovd recruits content creators / affiliates / marketers for each specific campaign, and every campaign is manually reviewed by our team.
Every reward package on every campaign discloses a delivery month and
year.

Backers' cards are not charged until an Idea Campaign meets its
order threshold or a Product Campaign reaches its disclosed close
date. Successful campaign charges are processed through Stripe
Connect using the production configuration approved for Proovd.
The founder remains the merchant of record on every transaction.

Our Acceptable Use Policy mirrors Stripe's Prohibited and Restricted
Businesses list.

Read more about how payments work → proovd.co/how-payments-work
Read our full safety controls → proovd.co/safety
```

Before production approval, replace the architecture sentence with truthful conditional wording and do not imply approval.

## A.2 Expanded campaign MoR block

```text
[FOUNDER LEGAL NAME] is the merchant of record for every transaction
on this campaign and is solely responsible for delivering the rewards
described above and complying with all applicable laws in their
jurisdiction.

Payments are processed by Stripe through Stripe Connect using the
production configuration approved for this campaign. Proovd LLC acts
only as the software platform that hosts this campaign; Proovd LLC is
not the merchant of record and does not take title to any digital
reward sold on this campaign.

How customer service works on Proovd:
Once you've reserved a pre-order, you'll get a magic link to your
backer page. From there you can message [FOUNDER LEGAL NAME] about
the product, delivery, or refunds through a built-in support form.
We send an immediate automated acknowledgement, provide a human
response within one business day, pass product/delivery/refund
questions to the founder, and follow up if you haven't heard back
within 48 hours.

For questions about the Proovd platform itself — not about this
campaign's product — email support@proovd.co.
```

## A.3 Idea Campaign consent

```text
You are reserving a pre-order on the campaign "[CAMPAIGN TITLE]"
operated by [FOUNDER LEGAL NAME] (the merchant of record).

Reward: [REWARD PACKAGE NAME]
Reward subtotal: US$[REWARD SUBTOTAL]
Sales tax: US$[SALES TAX]
Total authorized: US$[TOTAL AUTHORIZED]

By clicking Authorize, you agree that:

- Your card will NOT be charged today.
- You are authorizing [FOUNDER LEGAL NAME] and Proovd LLC (acting as
  the Stripe Connect platform on behalf of [FOUNDER LEGAL NAME]) to
  charge your saved card a single off-session payment of exactly
  US$[TOTAL AUTHORIZED] on or shortly after [CLOSE DATE — UTC], if and
  only if the campaign reaches its order threshold of [ORDER THRESHOLD]
  unique Backers with active pre-orders at [CLOSE DATE — UTC]. The
  threshold measures valid purchase commitments at close; it does not
  guarantee that every saved card will later succeed.
- The total above includes the sales tax calculated when you authorize.
  The later charge will occur only if that same tax calculation remains
  usable for the exact total shown above. If it is not usable, you will
  not be charged; Proovd will not substitute a different total.
- If the campaign does not reach the threshold by [CLOSE DATE — UTC],
  no charge will occur, your saved card will lose future-charge
  eligibility for this campaign, and you will not be billed.
- You may cancel this pre-order at any time before [CLOSE DATE — UTC]
  at no cost by clicking "Cancel pre-order" on your backer page using
  the magic link in your confirmation email.
- I understand this product is still in development, may face delays,
  and — in rare cases where the founder is unable to complete the
  project — may not be delivered. I accept that risk as part of
  supporting an early-stage product. After a valid charge there is no
  voluntary/change-of-mind refund. Proovd's Refund Policy at
  proovd.co/refunds explains the exceptions for duplicate, wrong,
  canceled, unauthorized, materially misrepresented, applicable
  non-delivery, serious-violation, legal, Stripe, and card-issuer cases.
- Your card statement is expected to show "[EXPECTED STATEMENT
  DESCRIPTOR]". Contact support@proovd.co with any questions.
- Your email and purchase details will be shared with [FOUNDER LEGAL
  NAME] immediately after you reserve, even though you are not charged
  today, only so they can prepare fulfillment and provide purchase
  support. If you cancel, the Founder will be told not to fulfill your
  order; cancellation cannot retract information already shared.

By reserving this pre-order, you also agree to Proovd's Terms of Service,
Acceptable Use Policy, Refund Policy, Fulfillment Policy, and Privacy Policy.

[ ] (required; unchecked by default) I confirm that I am at least 18 years old
and that my billing location is in the United States.
[ ] (optional; unchecked by default) I allow [FOUNDER LEGAL NAME] to
contact me for marketing, research, surveys, and other messages not required
to fulfill or support this purchase, and to see my identifiable survey answers.
[ ] (optional; unchecked by default) Send me Proovd's monthly newsletter about
new campaigns.

[Authorize pre-order]
```

## A.4 Product Campaign consent

```text
You are placing a founding-member pre-order on the campaign "[CAMPAIGN
TITLE]" operated by [FOUNDER LEGAL NAME] (the merchant of record).

Reward: [REWARD PACKAGE NAME]
Reward subtotal: US$[REWARD SUBTOTAL]
Sales tax: US$[SALES TAX]
Total authorized: US$[TOTAL AUTHORIZED]

By clicking Authorize, you agree that:

- Your card will NOT be charged today.
- You are authorizing [FOUNDER LEGAL NAME] and Proovd LLC (acting as
  the Stripe Connect platform on behalf of [FOUNDER LEGAL NAME]) to
  charge your saved card a single off-session payment of exactly
  US$[TOTAL AUTHORIZED] on [CLOSE DATE — UTC] for the reward package
  "[REWARD PACKAGE NAME]" described on the campaign page above.
- The total above includes the sales tax calculated when you authorize.
  The later charge will occur only if that same tax calculation remains
  usable for the exact total shown above. If it is not usable, you will
  not be charged; Proovd will not substitute a different total.
- Expected delivery of "[REWARD PACKAGE NAME]" is [DELIVERY MONTH/YEAR].
  If this expected delivery window changes, [FOUNDER LEGAL NAME] will
  notify you by email.
- You may cancel this pre-order at any time before [CLOSE DATE — UTC]
  at no cost by clicking "Cancel pre-order" on your backer page using
  the magic link in your confirmation email. After [CLOSE DATE — UTC],
  refund eligibility is governed by the campaign-specific Founder refund
  policy [POLICY TITLE / VERSION / EFFECTIVE DATE] at [PRESERVED POLICY URL]
  and Proovd's Refund Policy at proovd.co/refunds, subject to applicable law,
  Stripe, and card-issuer rules.
- I understand this is a pre-order for an early-stage product or feature
  launch. Delivery is on the disclosed timeline above; in the uncommon
  event of material delay or the rare event of non-delivery, the refund
  mechanisms defined in the preserved policy version above apply.
- Your card statement is expected to show "[EXPECTED STATEMENT
  DESCRIPTOR]". Contact support@proovd.co with any questions.
- Your email and purchase details will be shared with [FOUNDER LEGAL
  NAME] immediately after you reserve, even though you are not charged
  today, only so they can prepare fulfillment and provide purchase
  support. If you cancel, the Founder will be told not to fulfill your
  order; cancellation cannot retract information already shared.

By reserving this pre-order, you also agree to Proovd's Terms of Service,
Acceptable Use Policy, Refund Policy, Fulfillment Policy, and Privacy Policy.

[ ] (required; unchecked by default) I confirm that I am at least 18 years old
and that my billing location is in the United States.
[ ] (optional; unchecked by default) I allow [FOUNDER LEGAL NAME] to
contact me for marketing, research, surveys, and other messages not required
to fulfill or support this purchase, and to see my identifiable survey answers.
[ ] (optional; unchecked by default) Send me Proovd's monthly newsletter about
new campaigns.

[Authorize pre-order]
```

If another field is ever shared for a non-fulfillment purpose, its separate unchecked consent must name the exact field and purpose. Mandatory operational sharing remains limited to data actually needed for digital fulfillment/support.

## A.5 Listing-fee consent

```text
By clicking Agree and Pay, you agree to pay Proovd LLC a one-time
listing fee of US$[SUBTOTAL] plus applicable sales tax, for a total of
US$[TOTAL], and you agree to our Terms of Service, Acceptable Use
Policy, Refund Policy, Fulfillment Policy, and Privacy Policy. Your
statement will show "PROOVD LISTING." Questions: support@proovd.co.

Proovd will refund the entire amount charged at this Checkout — the
listing-fee subtotal plus the associated sales-tax reversal or
correction — if no eligible campaign-specific Creator is recruited,
or if no Creator and Founder mutually accept locked campaign terms
within 72 hours after this payment succeeds. A pending proposal does
not pause or extend that deadline. The same full refund applies if a
required launch Creator later fails and Proovd does not make a fully
ready replacement available within three U.S. business days after the
failure is recorded.

[ ] (optional; unchecked by default) Send me Proovd's monthly newsletter about
new campaigns.

[Agree and Pay US$[TOTAL]]
```

## A.6 Sample banner

```text
Sample campaign — for platform demonstration. No payment information is collected.
```

---

# Appendix B — Reusable state microcopy

These are structural patterns, subordinate to the exact consent above.

## B.1 Waiting/review

```text
[STATE IN PLAIN LANGUAGE]

What happened: [ONE SENTENCE]
Next: [ONE SENTENCE]
Owner: [PROOVD / FOUNDER / AFFILIATE / STRIPE / YOU]
Next update by: [LOCAL DATE/TIME] ([UTC])
Your action: [ONE ACTION or "No action needed"]
Reference: [CAMPAIGN / ASSOCIATION / CASE]
Need help? [CONTEXT-PRESERVING SUPPORT ACTION]
```

## B.2 Pre-order success

```text
Pre-order saved — you were not charged.

US$0 charged today
Reserved: [REWARD]
Reward subtotal: US$[REWARD SUBTOTAL]
Sales tax: US$[SALES TAX]
Total authorized: US$[TOTAL AUTHORIZED]
Seller: [FOUNDER LEGAL NAME]
Charge rule: [THRESHOLD or CLOSE-DATE CONDITION]
Charge time: [LOCAL DATE/TIME] ([UTC])
Expected statement: [DESCRIPTOR]
Delivery: [MONTH/YEAR or WINDOW]

[Review or cancel pre-order]
```

## B.3 Pre-charge reminder

```text
Your Proovd pre-order is scheduled for its charge decision tomorrow.

Campaign: [CAMPAIGN]
Seller: [FOUNDER]
Reward subtotal: US$[REWARD SUBTOTAL]
Sales tax: US$[SALES TAX]
Total authorized: US$[TOTAL AUTHORIZED]
When: [LOCAL DATE/TIME] ([UTC])
Condition: [IDEA THRESHOLD or PRODUCT CLOSE RULE]
Expected statement: [DESCRIPTOR]

You can review or cancel before the deadline using your secure backer link.
[Review or cancel]
```

For Idea, never imply the threshold is final before close.

## B.4 Cancellation

```text
Canceled — you were not charged.

Campaign: [CAMPAIGN]
Reward: [REWARD]
Canceled: [LOCAL DATE/TIME] ([UTC])
Amount charged: US$0

[Return to campaign]
```

## B.5 Failed payment

```text
We could not complete this pre-order charge.

[ACTUAL MONEY-MOVED STATE]
Campaign: [CAMPAIGN]
Reward: [REWARD]
Reward subtotal: US$[SUBTOTAL]
Sales tax: US$[SALES TAX]
Total attempted: US$[TOTAL]
Update by: [LOCAL DATE/TIME] ([UTC])

[Update card]

If you do nothing, this pre-order will be canceled after the retry window.
```

## B.6 Refund

```text
Refund started — US$[AMOUNT]

Sent to: [PAYMENT METHOD / LAST FOUR, if safely available]
Started: [DATE]
Typical bank timing: [VERIFIED RANGE]
Status: [SUBMITTED / SUCCEEDED / FAILED]
Reference: [CASE/REFUND]

[View pre-order or get help]
```

## B.7 Affiliate money status

```text
US$[AMOUNT] recorded

Status: [ESTIMATED / FINALIZED / APPROVED FOR TRANSFER / TRANSFERRED /
PAID OUT / PAYOUT FAILED / ADJUSTED]
Why it is not paid yet: [REASON]
Expected next update: [DATE]
Your action: [ACTION or "No action needed"]
```

## B.8 Support acknowledgement

```text
We received your message — case [CASE ID].

Topic: [CATEGORY]
Owner: [PROOVD SUPPORT / FOUNDER, coordinated by Proovd]
Human response due: [LOCAL DATE/TIME]
If the founder needs to respond, we will follow up after 48 hours if you have not heard back.

Reply to this message to keep everything in one case.
```

---

# Appendix C — Final implementation definition

The MVP is complete only when the app can run the entire lifecycle without undocumented operator knowledge:

Admin can configure the system; invite a Founder; recruit and invite campaign-specific Affiliates; observe and support independent account claims; activate the formal response window through one listing-fee payment; manage proposal versions and roster readiness; review/version the campaign; require reacceptance for material changes; record fixed funding and Creator readiness; coordinate the page/link/post launch order; monitor attribution, reservations, tax, support, risks, and threshold changes; execute a safe idempotent close/retry; reconcile Founder, Affiliate, Proovd, tax, refund, and provider amounts; manage fulfillment, disputes, enforcement, completion, and future-work requests.

The Founder can move from invitation to vetting, possible-Creator result, account claim, optional materials/interview, connected-account onboarding, transparent listing payment, campaign build, roster/term decisions, review, launch, calm live monitoring, results, payment, fulfillment, and future readiness without a widget dashboard or hidden rule.

The Affiliate can move from private campaign invitation to compact account/payout setup, waiting/preparing review, complete Campaign kit, clear accept/decline/proposal, locked compensation, readiness, link activation, compliant promotion, proof correction, transparent earnings, post-close completion/Transfer, and an optional future collaboration without receiving Backer PII or being forced into direct Founder contact.

The Backer can understand seller, reward, charge rule, tax-inclusive authorized total, delivery, cancellation, data sharing, refund, and support before saving a card; receive proof that no charge occurred; cancel or recover safely; recognize any later charge; receive the reward or obtain documented support/refund/dispute help; and retain campaign-scoped access through final resolution.

No implementation decision remains implicit when this specification and the Proovd DNA UX document are supplied together.
