# Proovd Unified MVP Brief — Product, Operations, CX & Stripe Connect (v5.6)

**Owner:** Mohab Bakr (Hoss)  
**Status:** Standalone source of truth for MVP product requirements, operations, customer experience, Stripe Connect implementation, and the Stripe application/Sales process  
**Source basis:** Proovd Brief V5, MVP Final v5, Stripe Connect briefing, Stripe Approval Playbook v5, the owner's confirmed decisions through 21 July 2026, the full CX touchpoint audit completed against v5.2 on 21 July 2026, the owner's core product and affiliate-alignment decisions confirmed 22 July 2026, the final payment, tax, refund, attribution, eligibility, state-model, and pilot decisions confirmed 23 July 2026, and the final v5.6 alignment decisions recorded after the complete v5.5 audit. The v5.6 decisions control launch order, attribution activation, Creator reacceptance after material changes, practical unique-Backer deduplication, reservation-time tax treatment, Creator-specific bonuses, manual thank-you payments, the no-dashboard Founder experience, Backer data timing, pilot confidentiality handling, response/refund clocks, US-only Backers, token security, and exact Stripe-review language. Separate canonical legal-policy files remain outside this document and are listed as required launch dependencies.
**Primary output:** Live MVP + at least one successful revenue-generating campaign + Delaware LLC operating posture + Stripe Connect approval path  
**Core principle:** Manual operations behind a polished, trustworthy surface.

> This document is deliberately standalone for deciding what to build, operate, test, publish, and submit to Stripe. It does not reproduce the complete Terms, Privacy Policy, Refund Policy, Fulfillment Policy, Founder AUP, Affiliate AUP, IP Agreement, or Cookie Policy because those are maintained as separate canonical files. It does define every required policy file, route, subject, consistency rule, and launch gate.

---

## How to read this unified brief

The document has five layers:

1. **Product and operating story:** who Proovd serves, what problem it solves, why affiliate distribution matters, and how the two campaign types work.
2. **MVP build contract:** roles, screens, workflows, data, Stripe objects, admin operations, edge cases, tests, and acceptance criteria.
3. **Decision record:** brief-only future-state items, Stripe additions, contradictions, and confirmed owner decisions.
4. **Stripe application and Sales runbook:** the redacted application data pack, website cross-check, email scripts, underwriting answers, approval sequence, testing, and contingencies.
5. **CX touchpoint audit:** the low-effort details, status patterns, confirmations, service standards, and acceptance tests that make the manual MVP feel considered rather than unfinished.

The word “MVP” here does not mean a clickable prototype. It means the smallest trustworthy production system capable of passing Stripe review, executing a real campaign, charging backers safely, attributing affiliate performance, controlling payout eligibility, and supporting disputes and fulfillment.

---

## Product story in one page

Proovd is a founder-led crowdfunding platform powered by trusted distribution. Crowdfunding is the mechanism, not the product. The product is a way to prove demand with money on the line.

For a founder with an idea, prototype, mockup, or materially unfinished product, Proovd provides paid validation. Instead of collecting compliments, wait-list signups, or “I’d buy that” comments, the founder runs an **Idea Campaign** (internal name: Pre-build) and measures whether strangers will reserve a defined pre-order. The card is saved but not charged unless the campaign reaches its disclosed order threshold.

For a founder with a live or near-launch digital product, Proovd provides launch distribution. The founder runs a **Product Campaign** (internal name: Pre-launch) for defined founding-member reward packages. Backers place pre-orders during the campaign, their cards are saved, and active pre-orders are charged on the disclosed close date. The internal goal is a momentum and planning target, not a refund gate.

Proovd’s second core user is the **affiliate distribution partner**: social creators, newsletter and blog operators, podcast hosts, community owners, course instructors, student affiliates, network distributors, and niche marketers with trusted access to a specific audience. These partners want relevant, vetted products; clear campaign terms; honest attribution; strong disclosure templates; fair compensation; and protection of audience trust.

Affiliates are the long-term retention engine. Founders structurally churn after success or failure, while strong distribution partners can participate in many campaigns. When founder convenience and affiliate trust genuinely conflict, the affiliate experience wins unless payment safety, law, or platform integrity requires otherwise.

At launch, Proovd is US-only for Founders, Affiliates, and Backers, 18+ for every participant, digital-only, and focused on consumer software, mobile apps, prosumer tools, creator tools, courses, and other marketable digital products. Physical goods, mixed packages, regulated financial/medical/legal categories, quasi-cash activity, enterprise procurement, and international Backers are out of scope for the controlled pilot.

The platform begins with manual founder review, campaign-specific affiliate recruitment, manual affiliate verification, manual first-post checks, manual milestone decisions, and manual payout/refund operations surfaced as white-glove review and safety controls. Affiliates are recruited for specific campaigns before or during founder onboarding rather than discovered through a heavy post-payment matching process. Automation follows only after enough real campaign data exists.

---

## 0. Executive baseline

This document is the source-of-truth MVP feature and business requirements spec for Proovd v5.6. It is designed to stand alone for product, engineering, operations, Stripe review preparation, and any approved MVP campaign configuration.

The v5 MVP is a Stripe Connect platform where:

1. **Proovd is a software platform**, not the merchant of record for campaign rewards, not a reseller, and not the owner of the goods or services sold by founders.
2. **Each founder is the merchant of record** for their own campaign transactions through a Stripe Standard connected account.
3. **Backers reserve pre-orders first; cards are saved, not charged immediately.** The card is saved through Stripe SetupIntent, then charged later through an off-session PaymentIntent.
4. **There are two campaign types.**
   - Idea Campaign (internal: Pre-build): product does not exist yet; charge is conditional on the order threshold.
   - Product Campaign (internal: Pre-launch): product is live or near launch; charge happens on the close date; keep-what-you-raise.
5. **The preferred campaign payment architecture is Stripe Connect direct charges on the founder’s Stripe Standard connected account with Stripe-approved platform-managed/manual payout controls.**
6. **The backup campaign payment architecture is separate charges and transfers with `on_behalf_of` set to the founder’s connected account**, used only if Stripe does not approve sufficient payout controls for direct charges or instructs Proovd to use platform-balance holding.
7. **Never describe either architecture as escrow, trust, custody, or a Proovd bank-account hold.**
8. **The legacy internal `MBP` concept is not a Pre-launch requirement and must not appear in customer-facing copy.** Pre-build uses order-threshold logic; Pre-launch uses close-date capture logic.
9. **Affiliate scope includes niche distribution partners.** MVP supports creators, newsletter/blog operators, podcast hosts, community owners, course instructors, student affiliates, network distributors, and niche marketers.
10. **The MVP must support approved campaign configurations generically.** No campaign-specific founder, product, vertical, or affiliate assumptions should be hard-coded into the core product.
11. **Campaign checkout is tax-exclusive.** The Backer pays calculated sales tax on top of the reward subtotal; every percentage fee and Affiliate earning is calculated from the pre-tax reward subtotal. For the controlled MVP, the reservation-time Stripe Tax calculation and exact total authorized are reused for the later charge only while that calculation remains valid under the approved Stripe configuration; the MVP does not implement a close-time tax-increase/reconsent flow.
12. **Affiliates use a Stripe-approved connected-account payout configuration.** Proovd records and approves affiliate earnings, and Stripe records the connected recipient, transfer, and payout. Affiliates do not process backer card charges.
13. **The first live campaign is a controlled US-only pilot.** Founders, Affiliates, and Backers must be US-based for the pilot. Live card collection, campaign charges, Affiliate Transfers, and tax collection remain blocked until the applicable Stripe, legal, and tax gates in this brief are complete.

---

## 1. Operating principle

The MVP runs manually behind a polished surface.

Campaign-specific affiliate recruitment and association, creator assessment, campaign review, first-post verification, risk checks, Stripe communication, payout eligibility, milestone review, failed-payment recovery, refunds, disputes, and case-study collection are admin-driven.

The user-facing experience must feel finished, intentional, and trustworthy. A founder, affiliate, backer, or Stripe reviewer should never feel like they are walking through an internal prototype. Manual steps should surface as white-glove review, safety controls, or guided human support.

If a feature can be cut without damaging trust, clarity, Stripe approval posture, or first-campaign execution, it remains deferred.

The MVP must not pretend automation exists where operations are manual. It should make manual review feel like a safety feature.

### 1.1 First-cohort operating model

The first affiliate cohort is hand-picked and manually verified, with an initial target of roughly 50 strong distribution partners across creator, newsletter, podcast, community, course, student, network, and niche-marketing channels. For the first roughly 50 campaigns, Proovd recruits and associates affiliates campaign by campaign because it does not yet have enough conversion history to justify algorithmic recommendations. The future recommendation model may use niche/category fit, audience demographics, engagement, channel type, audience access, and past conversion on similar campaigns, but the MVP records these inputs for human review rather than presenting an algorithm as live.

Founder acquisition can run in parallel through university/student ambassadors, founder communities, accelerators and startup courses, direct outreach to live or near-launch digital products, validation/launch-distribution content, and later paid acquisition after credible success stories exist. Affiliate growth can use partner referrals, training courses, creator communities, newsletter and podcast networks, course platforms, student groups, and niche marketing communities, but every candidate still passes Proovd verification.

The first launch cohort consists of **50 invited founders**, each running one first-cohort campaign. “First 50 founders,” “first 50 campaigns,” and “first 50 invitees” refer to this same cohort. The cohort remains manually invited, but it has no separate pricing formula: every founder pays the standard calculated listing fee — US$35 base, minus US$2 for each completed optional item (Visuals, Branding, confirmed founder interview booking, Story, Socials), capped at US$10 in savings, with a US$25 minimum (§5.8). The standard 5% campaign fee remains unchanged. Post-MVP listing pricing is undecided.

The platform is mobile-first for founder, affiliate, and backer experiences even though a native mobile app is not required.

### 1.2 Customer-experience operating standard

Every founder, affiliate, backer, support, and reviewer touchpoint must reduce uncertainty without disguising manual work. Whenever a user enters a waiting, review, payment, recovery, or exception state, the surface and its matching email must answer, in plain language:

1. **What just happened?**
2. **What happens next?**
3. **Who owns the next step?** Name Proovd, the founder, the affiliate, Stripe, or the backer; do not use a vague “we” when responsibility matters.
4. **When will the next update arrive?** Show a specific date/time or the applicable SLA, not “soon.”
5. **What can the user do now?** Provide the one relevant action, or explicitly say no action is required.
6. **How can they get help?** Preserve the same campaign/reservation/case context when support is opened.

System-wide CX rules:

- Every money-related confirmation states the amount, whether money was charged, the charge trigger/date, the seller/MoR, the expected statement descriptor, and the cancellation/refund path that applies.
- Every consequential action produces both an immediate on-screen confirmation and a durable email or product-history record.
- Dates display in the user's local time with the canonical UTC time available as secondary detail. Emails spell out the timezone.
- Forms preserve valid input after validation, Stripe, network, or server errors. Autosaving forms show `Saving…`, `Saved [time]`, and `Could not save — retrying` states.
- Errors translate provider/internal codes into plain language, preserve entered data, identify whether anything was charged or changed, and give a safe next action.
- Empty and waiting states explain why the state exists, what will make it change, and when Proovd will check again.
- Status names, amounts, dates, and responsibilities remain consistent across email, the role-specific product surface, magic-link page, support response, and admin view.
- Mobile tap targets, labels, focus order, contrast, error summaries, and screen-reader names are part of the MVP definition of done.
- No delight pattern may obscure risk, manufacture urgency, imply guaranteed results, pre-check optional consent, or celebrate a reservation so aggressively that the user could mistake it for a completed charge.
- Appendix H is the implementation and QA audit for this standard.

**No-dashboard Founder rule.** The Founder experience is a chronological campaign workspace, not a grid of widgets. Every Founder state has three altitudes: `Glance` answers what changed and shows the one controlling campaign number; `Act` contains only the highest-ranked real action, or an explicit done-moment when nothing is required; `Explore` preserves complete supporting information without competing with the current state. Founder vetting and campaign building present one decision at a time with visible progress and autosave rather than one endless scrolling form. The Admin panel remains an operational dashboard because its job is multi-case oversight.

---

## 2. Platform identity and language rules

### 2.1 What Proovd is

Proovd is a software platform for vetted-founder crowdfunding, operated by Proovd LLC, Delaware, USA.

Founders apply through Proovd onboarding and must be vetted before launch. Approved founders run campaigns for defined digital products. Campaign-specific affiliates and distribution partners who accept promote approved campaigns to relevant audiences. Proovd retains a 5% application/platform fee on captured campaign charges through Stripe Connect where supported by the approved architecture.

### 2.2 What Proovd is not

Proovd is not:

- A reseller.
- The merchant of record for campaign rewards.
- The seller of campaign rewards.
- The owner of goods or services sold by founders.
- An escrow provider.
- A trust or custodian.
- A Proovd bank-account holder of campaign funds.
- A donation platform.
- An equity crowdfunding platform.
- A charity, political fundraising, sweepstakes, or investment platform.

### 2.3 Founder-as-merchant-of-record rule

On every campaign, the founder is the merchant of record for the underlying purchase transaction. The founder is solely responsible for delivering the rewards described on the campaign page, honoring their disclosed refund policy, handling product support, paying taxes, complying with law, and bearing campaign-related refund, dispute, chargeback, reversal, negative-balance, and recovery obligations.

Proovd operates the platform, the campaign-specific affiliate recruitment and association layer, the review layer, the Stripe Connect integration, the support-routing layer, and the dispute-evidence packaging process.

### 2.4 Required language replacements

The product UI, marketing copy, emails, campaign pages, support copy, and admin-facing templates should avoid language that creates payment-risk ambiguity.

| Avoid | Use instead |
| --- | --- |
| pledge / pledged | reserve a pre-order / reserved / authorize a future charge |
| donate / donation / tip / tip jar | pre-order / founding-member contribution |
| all-or-nothing | conditional charge contingent on the order threshold |
| we route money / we pay founders | charges are processed through Stripe Connect on the founder’s connected account, with payout availability controlled according to disclosed milestones where Stripe approves |
| equity / investment / ROI / returns | reward package / founding-member benefit |
| anyone can launch a campaign | vetted founders apply through Proovd onboarding |
| campaign goal | order threshold for an Idea Campaign; close date or internal target for a Product Campaign |
| escrow / trust / custody / held in Proovd bank | Stripe Connect payout controls requested for launch / the configuration Stripe approves |
| $0 charge | card saved through SetupIntent; not charged today |
| upfront fee / upfront payout | optional fixed Creator payment / secured Creator payment / Creator payment funded |
| first half / final half | fixed Creator payment pending completion / fixed Creator payment paid |

“Crowdfunding” is acceptable in the homepage trust strip, About page, AUP, Stripe-facing materials, and policy pages. Avoid it in polished brand voice unless needed for compliance clarity.

### 2.5 Customer-facing campaign language

This rule supplements §2.4. It does not modify the §2.4 table, and it does not globally replace internal database/payment terminology.

Customer-facing naming:

- `I have an idea` → **Idea Campaign** → internal name `Pre-build`.
- `I have a product` → **Product Campaign** → internal name `Pre-launch`.
- Customer-facing copy says `pre-order` and `active pre-order`. `Reservation` is used only as an internal ledger/payment term (§10.3).
- The founder-facing creator count is described as `possible creators` or `creators who may be relevant`, never as an "eligibility signal." The refund rules retain `eligible creators` as the operative term (§11.9).
- Product Campaign founder payouts are the `first payment` and the `remaining payment`. An Idea Campaign has a `single Founder payment`. "Tranche 1" and "Tranche 2" must not appear in customer-facing copy.
- The founder-facing flow says `creator`; `affiliate/distribution partner` remains the broader internal role name (§4.2).
- Customer-facing copy never calls the optional Product-Campaign fixed amount an `upfront fee` or implies that a Creator is paid before completing the agreed work. It says `optional fixed Creator payment`, `secured Creator payment`, or `Creator payment funded`, as the context requires.

Scope and exceptions:

- This rule applies to every founder-facing and backer-facing surface, including the product story, campaign pages, checkout, notifications, emails, support copy, sample campaigns, and Appendix A exact-copy blocks.
- Founder-facing and backer-facing copy uses `Idea Campaign` and `Product Campaign` only. `Pre-build` and `Pre-launch` are internal terms and must never be rendered to founders or backers.
- `Pre-order` and `active pre-order` are customer-facing terms. `Reservation` remains an internal ledger and payment term and must not appear in rendered founder-facing or backer-facing copy.
- Sample-campaign route slugs may remain `/campaign/sample-pre-build` and `/campaign/sample-pre-launch` for technical compatibility, but their titles, headings, navigation labels, descriptions, and rendered content must use `Idea Campaign` and `Product Campaign`.
- Customer-facing copy must not announce that "there is no AI feature." It simply describes what exists — for example, a human interview that can be scheduled.

---

## 3. Campaign types

### 3.1 Idea Campaign (internal: Pre-build)

An Idea Campaign is idea validation for a product that does not exist yet or is materially unfinished.

Backers reserve a pre-order against a concept, prototype, mockup, early demo, or plan. The backer’s card is saved during the campaign but not charged when the pre-order is placed. Charges happen only if the campaign reaches its disclosed order threshold by the campaign close date.

For MVP, the order threshold is an integer count of unique Backers with an active Idea-Campaign pre-order, not a dollar target. Each Backer may hold only one active pre-order for that Idea Campaign and may change its selected reward before close. A canceled pre-order no longer counts. The final threshold decision uses the number of unique Backers with active pre-orders at `campaign_close_at`. `Threshold reached` and `threshold lost` events may occur before close as that count rises or falls, but charging eligibility is determined from the final active count at close. A campaign that meets the threshold remains successful even if one or more cards later fail; the Founder proceeds with the amount actually collected after the 48-hour retry window.

For the MVP, `unique Backer` is a practical fraud-control decision rather than a claim of verified civil identity. Proovd derives a private deduplication key from normalized email and normalized phone, supplements it with Stripe payment-method fingerprint where available and device/IP risk signals, and surfaces suspected duplicates for Admin review before `campaign_close_at`. A shared IP alone never collapses two Backers. Admin may merge or separate suspected duplicate records only with a recorded reason, prior value, evidence, actor, and timestamp. Customer-facing copy says Proovd uses reasonable deduplication and review; it does not promise that multiple identities can never evade detection. Stronger identity-document verification is deferred unless a recorded risk case requires it.

Required Idea Campaign rules:

- Campaign page must carry the Idea Campaign campaign-type badge.
- Campaign page must disclose the order threshold.
- Campaign page must state that charges occur only if at least the disclosed number of active pre-orders remains at the close date.
- Checkout must say the card is not charged today.
- Checkout must say the backer authorizes a single off-session payment only if the threshold is met.
- If the threshold is not met, no card is charged; each saved payment method loses future-charge eligibility for that campaign and is detached where reference-safe and appropriate.
- Backers can cancel before close at no cost.
- Promotional posts must communicate the substance of the Idea Campaign disclaimer: the product is in pre-order phase, may face delays, and may not ultimately exist in rare cases.
- After successful capture, the founder receives the single Founder payment — 100% of the eligible founder share — at Day 3 post-close once W-9, payment/risk checks, and recorded admin approval are complete, then builds and delivers under the post-close review and enforcement process (§11).
- Checkout and campaign copy must explain that the threshold measures valid purchase commitments at close, not guaranteed successful collections.

### 3.2 Product Campaign (internal: Pre-launch)

A Product Campaign is a founding-member pre-sale for a live or near-launch product.

Backers reserve real, defined reward packages for a product that already exists or is near launch. The card is saved when the pre-order is placed and charged at the disclosed close date. A Product Campaign is keep-what-you-raise: whatever is successfully collected at close belongs to the founder subject to the disclosed payment schedule and controls. Missing an internal goal does not trigger refunds.

Required Product Campaign rules:

- Campaign page must carry the Product Campaign campaign-type badge.
- Campaign page must disclose a close date/time in UTC.
- Every reward tier must disclose delivery month/year.
- There is no order threshold.
- The public page should emphasize backer count, units reserved/sold, and launch momentum, not a public dollar progress bar that makes a missed internal goal look like failure.
- Internal goal is a momentum target only and may not exceed the US$50,000 per-campaign pre-tax active-pre-order cap at launch.
- Backers can cancel before close at no cost; founder is notified.
- After close-date charge, refund eligibility is governed by Proovd’s Refund Policy and the founder’s disclosed campaign-specific Product Campaign refund policy.
- No public funding threshold, legacy `MBP` warning popup, or threshold-based backer decision window.
- A Backer may place multiple Product-Campaign transactions. Each transaction contains one reward package. Backer count remains a unique-person metric; pre-order value, revenue, quantity limits, and the campaign cap include every active transaction.

### 3.3 Shared campaign guardrails

Both campaign types share these launch constraints:

- US founders, Affiliates, and Backers only for the controlled MVP pilot. Backer billing country must be `US`.
- Backers must be 18+.
- Backers may reserve only with a US billing location and a card that can accept a USD transaction through Stripe, and only if sanctions/risk checks permit the transaction.
- The aggregate pre-tax value of active pre-orders is capped at US$50,000 per campaign at launch. The cap is enforced atomically when a pre-order is created or changed; a transaction that would exceed it is rejected or waitlisted rather than partially accepted. Internal goals may not exceed the same cap.
- Digital-only reward packages at launch.
- Physical goods and mixed digital/physical packages are rejected.
- Manual pre-launch review required for every campaign.
- AUP mirrors Stripe’s Prohibited and Restricted Businesses list and is refreshed quarterly.
- Founder and affiliate OFAC/sanctions representations required.
- Every reward package discloses a delivery month/year or delivery window.
- Affiliates must disclose paid partnership with the founder/product, not merely with Proovd.
- Proovd keeps all policies and campaign pages under a single domain: `proovd.co`.
- Proovd requests or suggests MCC 5734 / Computer Software Stores for applicable software activity, but Stripe makes the final classification for the platform and connected sellers. Courses, downloadable files, and digital services must use the Stripe-confirmed classification rather than a universal hard-coded MCC. MCC 6051 / quasi-cash is never used for this model.

---

## 4. Roles and accounts

## 4.1 Founder

### Eligibility

At launch, founders must be US-based and 18 or older. Founder date of birth, country, and state are collected during signup and verified through the connected-account onboarding process. Cross-border founders are future scope.

### Account creation

The MVP supports:

- Personalized private invitation with a secure temporary-draft link for the first founder cohort (§5.1); the founder claims a prefilled account after the possible-creator result (§5.5).
- Email/password registration.
- Google OAuth as an alternative provider.
- Email verification through an emailed confirmation link for the future public onboarding route; a private invitation or Google sign-in may satisfy invited-email ownership (§5.5).
- Phone number collection. Phone is not verified; there is no SMS OTP verification.

Public self-serve founder onboarding can exist visually, but the first live cohort is hand-picked. Public wording should say vetted founders apply through Proovd onboarding, not that anyone can launch.

### Identity and Stripe onboarding

Founder onboarding requires:

- Legal name.
- Business name, entity name, or sole proprietor status.
- Date of birth, must resolve to 18+.
- Country and state.
- Phone number.
- Email.
- Stripe-hosted onboarding for a Stripe Standard connected account, completed after account claim and optional materials and before listing-fee payment (§5.9).
- Connected account ID stored in Proovd.
- Stripe handles KYC and identity documents during Connect onboarding.

Stripe-hosted onboarding is the founder identity/KYC source of truth. Proovd should not store Stripe-collected government ID documents in its own database unless a separate business decision is made later. Admin may still review founder profile data and Stripe onboarding status.

### W-9

W-9 is not collected at initial signup. It is collected after campaign close and before any Day 3 founder payment release.

Hard block:

- If W-9 is not on file by Day 3 post-close, no founder payment is released: the Idea Campaign single Founder payment and the Product Campaign first payment are both blocked.
- For Product Campaigns, the remaining payment is also blocked while W-9 remains outstanding, even if the founder otherwise passes the Day 14 Progress Check.
- Once W-9 is submitted and verified, held/payout-restricted funds become releasable on the applicable campaign-specific payment schedule (§11.3).

Non-US founder tax forms are future scope, but the policy stack references W-8BEN / W-8BEN-E for future expansion.

### Active campaign limit

A founder can hold only one active campaign at a time. After a campaign ends, the founder must wait a minimum of three months before requesting another campaign. Once the three-month cooldown has elapsed, the founder still cannot create another campaign until admin reviews the prior campaign and flips a “ready for next campaign” flag. Passing the time requirement does not guarantee approval.

### Founder settings

Founder settings include:

- Name.
- Email.
- Phone.
- Profile photo.
- Password change.
- Business/entity info.
- Connected account status.
- KYC/identity info read-only after submission; edits require admin.
- Notification preferences.
- W-9 status after close.
- Delete account request.

Payout destination management lives primarily in Stripe connected-account onboarding, not a custom Proovd payout form.

---

## 4.2 Affiliate / distribution partner

### Eligibility

At launch, affiliates must be US-based and 18 or older. Signup collects date of birth, country, and state, plus an explicit confirmation that the affiliate is at least 18 and US-based. Stripe performs the identity, tax, sanctions, bank, and payout checks required for the approved connected-account configuration. Non-US affiliates are future scope.

### Campaign-specific invitation and account creation

There is no open public affiliate self-signup in MVP. Proovd recruits affiliates for a specific founder/campaign and sends each recruit a private campaign-specific invitation. The affiliate uses that invitation to create or claim their own account before the founder necessarily finishes signup. The invitation pre-associates the affiliate with that campaign; admin does not need to discover and manually match the affiliate after founder payment.

Admin may prefill:

- Full legal name.
- Email.
- Phone number.
- Primary channel type.
- Primary social handle / newsletter / podcast / community / course / network reference.
- Audience niche.
- Audience-size or access metric.
- Admin-written bio.
- Initial quality tier where applicable.
- Internal notes and verification status.

The secure invitation opens one compact prefilled signup flow. Its first primary action is `Confirm and create account`; it may have one secondary exit/help action. In that flow, the affiliate creates a password or claims the invited account, confirms or edits the prefilled information, provides date of birth/country/state, accepts Proovd Terms and the Affiliate AUP, and confirms that they are at least 18, US-based, the actual person behind the public-facing presence, not operating multiple accounts, and sanctions/OFAC eligible. These are fields and confirmations, not separate education pages. The only additional primary action is `Finish payout setup`, which opens the Stripe embedded or hosted connected-account onboarding required for identity, tax, bank, and transfer capability. Proovd does not collect those provider-controlled fields in a second custom form.

After signup, the same surface states that the founder is still finishing setup when applicable. No separate welcome tour or sequence of splash pages is required. When the founder completes the account-claim requirements in §5.5, the campaign automatically appears in the affiliate's account in a non-actionable preparing state, and Proovd notifies the affiliate to return. Successful listing-fee payment later activates the formal campaign decision and the 72-hour response window (§5.10–§5.11).

An affiliate may review a preparing campaign while Stripe onboarding is incomplete, but cannot activate a tracking link or receive money until the required connected-account status and transfer capability are complete. Stripe onboarding is reused across later campaigns; Proovd must not ask the affiliate to re-enter already valid information.

Stripe onboarding and Transfer records do not by themselves decide who must issue US tax forms. Before live Affiliate payments, tax counsel and the approved Stripe configuration must identify the payer, 1099 filing responsibility, required tax form/data, thresholds, corrections, and how Proovd reconciles those records without duplicating sensitive bank or identity storage.

If a public-facing identity is managed by an agency, manager, or representative, the actual creator/operator/community owner must personally accept the Terms and Affiliate AUP. Agencies may not accept on their behalf.

### Affiliate subtypes supported

The MVP supports broader distribution partners, not only social creators:

| Subtype | Verification / profile fields |
| --- | --- |
| Social media creator | Follower count, engagement rate, audience demographics, platform analytics, third-party audit where appropriate |
| Newsletter / blog operator | Subscriber count, click-through rates, engagement indicators, prior sponsored content |
| Podcast host | Subscribers/followers, listening/download metrics, prior sponsored content |
| Community owner | Member count, daily active users, engagement indicators, community rules |
| Course instructor | Enrolled student count, course rating, course-platform constraints |
| Student affiliate / network distributor | KYC, social handles, written promotion plan, institution-disclaimer requirement |
| Niche marketer / distribution partner | Channel access, identity-disclosed presence, compliant traffic method, campaign-fit evidence |

### Affiliate business identity

The UI should treat affiliates as trusted niche distribution partners, not disposable influencers. They protect audience trust and need:

- Vetted founders.
- Clear campaign type.
- Clear delivery dates.
- Fair compensation.
- Locked terms.
- Honest attribution.
- FTC-safe disclosure templates.
- Walk-away rights.
- No audience PII exposure.
- Fast payment and visible payout status.

### Active campaign cap

An affiliate may hold no more than three active partnerships at one time. Additional pitches may be visible but not actionable until an existing campaign ends.

### Affiliate settings

Affiliate settings include:

- Name.
- Email.
- Phone.
- Password change.
- Channel type and handles.
- Audience metrics.
- Niche.
- Bio.
- Payout destination status.
- W-9 status.
- Notification preferences.
- Delete account request.

Identity, tax, and payout details are collected through Stripe during initial affiliate onboarding. Settings show only the connected-account, transfer-capability, tax-information, and payout-destination statuses plus a Stripe-managed update link. Proovd does not expose or store full bank details.

---

## 4.3 Backer

Backers are guest-only in MVP. No password-based backer account is created.

At checkout/reservation, every backer must provide:

- Email.
- Phone number.
- US billing country and postal code for tax calculation; the full billing address is collected when the configured tax provider or payment method requires it. A non-US billing country is ineligible for the controlled MVP pilot.
- Payment method through Stripe.
- Reward package selection.
- Pre-checkout survey answers.
- Consent to off-session charge.
- An unchecked confirmation that the Backer is at least 18.
- Mandatory acknowledgment that email and purchase details will be shared with the Founder only for reward fulfillment and purchase support.
- A separate unchecked optional consent for Founder marketing, research, surveys, or other non-fulfillment contact.
- Optional newsletter opt-in for Proovd.

Phone is collected but not verified.

Immediately after a saved pre-order is created, the Founder receives the Backer's email and purchase details for fulfillment preparation and purchase support even though the Backer has not yet been charged. The checkout acknowledgment states this timing plainly. Cancellation does not retroactively retract information already shared, but it updates the Founder record to `canceled — do not fulfill` and does not create permission for marketing, research, surveys, or other non-fulfillment contact.

Backers return through long-lived magic links. Magic links grant access only to that backer’s view of that specific campaign/reservation.

Backers must be 18+ and US-based for the controlled MVP pilot. MVP uses the explicit unchecked age confirmation rather than identity-document collection unless a risk review requires additional verification. Card validity, US billing location, and available sanctions/risk signals are also checked through Stripe and the approved tax/payment configuration.

---

## 4.4 Admin

Admin accounts are internal-only and seeded directly into the database. Email/password authentication. No admin self-signup. No public invitation flow. No role hierarchy in MVP unless the engineering team adds it as a low-cost internal safeguard.

Every admin has full functional access in MVP, but every admin account requires MFA. Money movement, refund, connected-account, and campaign-kill actions require recent reauthentication and create an immutable audit entry. A full role hierarchy is deferred.

Admin is responsible for:

- Founder review.
- Campaign review.
- AUP review.
- Campaign-specific affiliate recruitment, invitation, and verification.
- Affiliate verification.
- Affiliate connected-account, transfer-capability, and payout-onboarding monitoring.
- Initial launch-roster oversight and mid-campaign affiliate additions.
- Compensation configuration.
- Counter-offer review.
- First-post verification.
- Full-deliverable completion verification for fixed Creator payment eligibility.
- Launch approval.
- Reservation/charge monitoring.
- Failed-payment recovery monitoring.
- Risk flags.
- Comment moderation.
- W-9 tracking.
- Milestone review.
- Payout eligibility.
- Refund/reversal workflows.
- Dispute evidence.
- Case-study collection.

---

## 4.5 Password reset

Standard email-link password reset is available for every password-based account type: founders, affiliates, and admins.

Backers do not reset passwords. Backer recovery is magic-link resend by admin.

---

## 5. Founder flow

This section is chronological. The product sequence is: campaign-specific affiliate recruitment may begin off-platform → personalized founder invitation and secure temporary draft → campaign path choice → vetting → possible-creator result → account claim → the campaign appears to its pre-associated affiliates in a preparing state → optional materials and interview scheduling → high-effort status and listing-fee calculation → Stripe onboarding → listing-fee payment → formal affiliate response window and campaign building in parallel → Proovd review → optional fixed Creator payment funding and creator readiness → approved campaign page goes live → tracking links activate → Creators publish and submit proof → Admin verifies posts → additional affiliates may join while live → close, charge/retry reconciliation, Creator and Founder payments, fulfillment, and working again. Two requirements — the founder persona in product copy and autosave — are cross-cutting rather than steps in the chronology and are collected in §5.19.

In this founder-facing flow, `creator` is the customer-facing name for the campaign-specific affiliate/distribution partner defined in §4.2 and §6.

### 5.1 Personalized invitation and secure temporary draft

For any MVP campaign, Proovd speaks to the founder before the founder touches the platform. Before inviting, the operator may pitch the launch idea, confirm the campaign path fit, confirm the product/new-feature scope, confirm the founder is US-based, confirm the delivery month/year, ask discovery questions, talk through compensation expectations, and recruit affiliates for that specific campaign in parallel — while avoiding promises of specific results, tier prices, acceptance, or final creator participation. Recruited affiliates may receive their private campaign-specific signup invitations before the founder finishes signup. This off-platform work is recorded in admin notes.

The invitation itself is a founder-facing product requirement, not an informal email. Every founder invitation must include:

- A founder/product reference specific to the recipient.
- What Proovd understood about the product.
- Why this founder was invited.
- A named sender.
- What the process involves.
- An honest time expectation.
- No guarantee of creator acceptance or campaign results.
- A reply/support route.
- A secure temporary-draft link.

The secure temporary-draft link opens a draft workspace that exists before any account is created. Admin can create, send, resend, and revoke invitations, and the invitation record — recipient, sender, sent time, invitation source, and draft-link status — is visible in the admin panel (§12.1). The invitation is a transactional email (§13.1).

Temporary-draft links are secure credentials: scoped to one invited founder's draft, revocable by admin, and subject to the token rules in §18.4.

### 5.2 Campaign path choice

Inside the temporary draft, the founder first chooses a campaign path:

- `I have an idea` → Idea Campaign (internal: Pre-build).
- `I have a product` → Product Campaign (internal: Pre-launch).

The campaign type locks permanently when vetting is submitted (§5.3). Every downstream screen displays the locked type; campaign setup does not offer an editable campaign-type field. If the founder selected the wrong type, the locked campaign is archived and a new vetting record begins. Before listing-fee payment, admin may create the replacement without charging again; after payment, the applicable cancellation/refund rules control. No campaign-type migration is supported in MVP, and no affiliate acceptance, payment, reward, or consent record is copied automatically into the replacement.

### 5.3 Vetting: Problem, Solution, Competition

The vetting form is campaign-type-aware but uses a shared core, completed in this order:

1. Campaign path choice (§5.2): `I have an idea` or `I have a product`.
2. **Problem** — prefilled by a human on the Proovd team from pre-invitation discovery; the founder reviews and edits it.
3. **Solution** — prefilled by a human on the Proovd team; the founder reviews and edits it.
4. **Competition / positioning** — always blank and written by the founder. Competition must never be prefilled.

The Founder sees one item at a time, not one endlessly scrolling form. Each item has one primary action, visible `Step [X] of 4` progress, Back/Continue navigation, and the §5.19.2 autosave state. Returning to an earlier item preserves later valid answers. The possible-creator result appears only after all four items are complete.

Provenance rules:

- Problem and Solution prefills are written by humans on the Proovd team. They are not AI-generated.
- The system stores, per field, whether the current text was supplied by Proovd or by the founder, with edit timestamps (§14.2).

For Idea Campaign founders, the product may be a rough idea, Figma mockup, landing page, prototype, repo, early demo, or tiny early-user base. The form must help test whether strangers care enough to place a pre-order, pay, or take action.

For Product Campaign founders, the form should frame the campaign around the launch moment, live product proof, new feature, real reward packages, and delivery date.

Submitting vetting locks the campaign type (§5.2).

### 5.4 Possible-creator result

Immediately after the three core vetting answers — and before account creation, Stripe onboarding, or any payment — the founder sees the number of creators who may be relevant to their campaign based on the submitted information.

Rules for this result:

- The count means creators who may be relevant. It names no specific creator and promises no specific partner. It is a relevance signal only; it is not the campaign's recruited or accepted roster.
- It is not a guarantee that any creator will accept.
- It does not mean an affiliate has accepted. Proovd may already be recruiting and pre-associating campaign-specific affiliates, but the possible-creator count does not reveal names or create a formal campaign opportunity.
- Because MVP founders are pre-screened before being invited, an invited founder should not reach a zero-possible-creator result.
- Pre-screening and early affiliate recruitment do not remove the later refund protection: zero eligible recruited Affiliates or no Creator and Founder mutually accepting the same locked terms within the disclosed 72-hour formal response window after successful listing-fee payment still produces a refund of the entire listing-fee Checkout charge, including associated sales-tax reversal or correction (§11.9).

### 5.5 Account claim

After seeing the possible-creator result, the founder claims a prefilled but editable account.

Rules:

- Account fields are prefilled from the invitation and discovery records; the founder reviews and can edit every prefilled field.
- The system stores whether the founder or Proovd supplied each prefilled field (§14.2).
- A private invitation or Google sign-in may satisfy invited-email ownership; invited founders whose email ownership is established this way do not require a separate email-verification step.
- A future public onboarding route still requires normal email verification.
- Phone number is collected but not verified. There is no SMS OTP verification.
- Stripe onboarding does not happen at this step; it happens later, before listing-fee payment (§5.9).

Completing the account claim is the MVP event `founder_signup_complete`. At that event, the campaign automatically appears to every Affiliate already recruited and pre-associated with it. For the private, manually known MVP cohort, the confirmed Affiliate account receives the full available Founder/problem/solution/competition information and single Campaign kit in the preparing state (§6.2). This is a recorded pilot-only trusted-cohort exception: access is private, authenticated, logged, campaign-scoped, and revocable, but does not wait for a separate pre-view confidentiality click. The Affiliate still cannot accept compensation terms or begin work until successful listing-fee payment activates the formal opportunity, and the per-campaign IP/confidentiality agreement remains required before work (§6.5). Proovd notifies the Affiliate that the Founder has finished signup and that the formal campaign decision will become available after listing-fee payment.

Founder account and identity data requirements otherwise remain as defined in §4.1.

### 5.6 Optional materials and helper resources

After claiming the account, the founder may complete optional items that strengthen the campaign and reduce the listing fee (§5.8):

- Visuals.
- Branding.
- Story.
- Socials.
- A confirmed founder interview booking (§5.7).

The required founder helper resources are static resources with copy-paste-ready prompts. They are not an embedded AI-interview product. The four required resources are:

1. **Competition.** How to identify direct competitors, indirect competitors, and the status quo; how to research competition using AI; a copy-paste-ready research prompt; a requirement to cite sources; and a prohibition on fabricated competitor facts.
2. **Branding.** How to use AI to develop logos and brand design without generic "AI slop," with a copy-paste-ready prompt.
3. **Visuals.** How to generate brand visuals that do not look generic or obviously AI-generated, with a copy-paste-ready prompt.
4. **Story.** How to tell a compelling founder/product story; a prompt for using ChatGPT Voice Mode as a guided storytelling conversation; instructions for summarizing the conversation; and the rule that the founder must review and approve the resulting story before it becomes campaign material.

### 5.7 Founder interview scheduling

Proovd offers a founder interview conducted by a human on the Proovd team, booked through embedded scheduling inside Proovd. This is required MVP product, not deferred tooling.

Requirements:

- Embedded scheduling inside Proovd; the founder does not leave the product to book.
- Available slots are displayed in the founder's timezone.
- Meeting provider selection: Google Meet, Zoom, or Microsoft Teams.
- Stored per booking: scheduled time, timezone, meeting provider, meeting link, interviewer, status, reschedule history, and cancellation (§14.2).
- Confirmation, reminder, reschedule, and cancellation notifications are sent (§13.1).
- The US$2 interview discount applies only after a booking is confirmed (§5.8).
- A scheduled/confirmed interview counts when calculating high-effort status (§5.8).

Customer-facing copy simply describes what exists: a human interview that can be scheduled.

### 5.8 High-effort status and listing-fee calculation

**High-effort status.** A campaign is high-effort only when all three of the following are absent at calculation time:

- No Visuals.
- No Branding.
- No scheduled/confirmed founder interview.

The system stores the three qualifying inputs, the calculated result, the calculation time, and the actor or system that recorded it (§12.3, §14.2). High-effort status is visible to creators in the pitch. Only high-effort campaigns expose creator-side percentage bidding above the applicable base percentage (§5.12, §6.9).

**Optional-item completion rules.** The listing-fee discounts use objective completion requirements rather than a subjective quality score:

- **Visuals completed:** At least one non-placeholder campaign visual or video asset has been uploaded, is accessible, and is approved by the founder for campaign use.
- **Branding completed:** A usable logo or wordmark and a saved brand direction containing at least colors and typography/style guidance have been provided and approved by the founder.
- **Story completed:** A founder-approved public campaign story has been saved. A draft, prompt response, interview transcript, or unapproved generated summary does not count.
- **Socials completed:** At least one valid public founder or product social-profile URL controlled by the founder has been supplied and verified as accessible.
- **Interview completed for discount purposes:** The embedded booking has status `confirmed`. A selected but unconfirmed slot, canceled booking, or abandoned scheduling session does not count.

Empty files, inaccessible links, placeholders, duplicate uploads, and unapproved drafts do not qualify. The system records the completion evidence and timestamp for each item. Admin may invalidate an item before listing-fee payment only with a recorded reason. The founder may correct it before checkout. After successful payment, the calculated fee and recorded completion states are locked for that payment.

**Listing-fee calculation.** The listing fee is calculated from the completed optional items:

- Base listing fee: US$35.
- Visuals completed: save US$2.
- Branding completed: save US$2.
- Confirmed founder interview booking: save US$2.
- Story completed: save US$2.
- Socials completed: save US$2.
- Maximum savings: US$10.
- Minimum listing fee: US$25.
- Post-MVP pricing is undecided.
- The 5% campaign fee (§10.4) is separate and unchanged.

**Lock rule.** High-effort status and the listing fee are calculated from the state of the optional items at listing-fee checkout and lock at successful payment. Items added or removed after payment do not retroactively change the fee paid or percentage-bidding eligibility; admin may record a manual override with a reason where genuinely warranted (§18.5). If a confirmed interview booking is canceled before payment, the discount and the high-effort inputs recalculate; cancellation after payment does not change the fee already paid.

### 5.9 Stripe Standard connected-account onboarding

Before paying the listing fee, the founder completes Stripe-hosted onboarding for a Stripe Standard connected account:

- Stripe-hosted onboarding is the founder identity/KYC source of truth.
- The connected account ID is stored in Proovd.
- Stripe handles KYC and identity documents during Connect onboarding; Proovd does not store Stripe-collected government ID documents in its own database unless a separate business decision is made later (§4.1).
- The founder accepts Proovd Terms, Founder AUP, Refund/Fulfillment policy obligations, and the Stripe Connected Account Agreement through the applicable flows.
- Returning from Stripe lands on a status page that says complete, still required, or under review, and links back to the exact missing requirement.

### 5.10 Listing-fee payment

The founder pays the calculated one-time listing fee through Stripe Checkout on Proovd's main Stripe account. This is not a Connect transaction. Proovd LLC is merchant of record for the listing fee. Stripe Tax is enabled.

Listing-fee mechanics:

- The price displayed at checkout is the price charged, per the §5.8 calculation.
- Promotional discounts/codes may apply where approved.
- Statement descriptor: `PROOVD LISTING`.
- Stripe emails a receipt.
- A formal invoice can be requested through support.
- The listing fee is separate from the 5% platform/application fee retained on successful campaign charges through Stripe Connect.

Before payment, the checkout summary must show the base listing-fee line item, each earned US$2 saving as its own labeled line item, any promotional discount, tax, total due now, the statement descriptor, and the full zero-eligible-Creators/no-mutually-accepted-locked-terms refund promise. `Full refund` means the entire listing-fee Checkout charge actually paid, including the listing-fee subtotal and its associated sales-tax reversal/correction under Stripe Tax; it does not mean subtotal only. After payment, the confirmation screen and email state the total amount paid, the itemized savings and tax, receipt access, the refund condition, and the next steps with an expected next-update date.

**Successful listing-fee payment activates the formal campaign opportunity for every eligible pre-associated affiliate and starts campaign building.** Campaign-specific recruitment, affiliate signup, and the preparing-state campaign association may already exist before payment. The disclosed 72-hour no-acceptance window (§11.9) begins at successful payment, when the formal opportunity becomes actionable. Proovd may continue recruiting additional campaign-specific affiliates during that window and may add affiliates after launch (§5.17, §6.18).

### 5.11 Affiliate recruitment and launch-roster track

Proovd recruits affiliates for this specific campaign before or during founder onboarding and may continue recruiting after payment. After successful payment, the formal campaign opportunity becomes actionable for every eligible pre-associated affiliate. Proovd then resolves acceptances, compensation, percentage bids, and optional fixed Creator payment requests while the founder builds the campaign in parallel (§5.13). This is campaign-specific recruitment and roster activation, not a heavy post-payment search across a general affiliate pool.

The founder sees the campaign-specific recruited roster, including which Affiliates have signed up, are waiting for formal activation, are reviewing, have mutually accepted locked terms, declined, proposed terms, or become active. While the 72-hour formal response window is running, the founder sees the remaining time and the full-refund outcome if there are zero eligible recruited Affiliates or no Creator and Founder mutually accept the same locked proposal version. Proovd owns recruitment follow-up; the founder does not browse or contact the general Affiliate pool.

For the 72-hour outcome, `acceptance` means that the Founder and Creator have explicitly accepted the same compensation-proposal version and the terms are locked. A pending percentage bid, fixed-payment request, Founder revision, or other unfinished negotiation is interest—not acceptance—and does not pause or extend the deadline. If no Creator has mutually accepted locked terms at the exact deadline, the §11.9 refund applies and pending proposals close for that failed/refunded campaign.

The founder can see creator cards showing:

- Name/handle.
- Channel type.
- Follower/subscriber/member/enrollment metric.
- Engagement or comparable proof.
- Niche.
- Short bio.
- Status: recruited / invited / signed up / waiting for founder / preparing / reviewing / accepted / declined / proposal pending / fixed payment requested / active / ended.

Interested creators respond in one of three ways (§6.4):

- Accept the standard terms at the applicable base percentage.
- Submit a percentage bid above the base — allowed only on high-effort campaigns and capped by the 50% total-percentage ceiling.
- Request an optional fixed Creator payment — allowed only on Product Campaigns and independent of high-effort status (§6.10). The founder accepts, declines, or proposes a revision; a revision locks only after the creator explicitly accepts that same proposal version.

### 5.12 Creator compensation matrix

There is no founder-selected creator payment model. Compensation follows this matrix:

| Campaign | Optional fixed Creator payment | Base commission | Creator may bid above base? |
| --- | --- | ---: | --- |
| Idea, standard | Never allowed | 30% | No |
| Idea, high effort | Never allowed | 30% | Yes, up to the 50% total cap |
| Product, standard | None | 30% | No |
| Product, standard | Accepted | 20% | No |
| Product, high effort | None | 30% | Yes, up to 50% |
| Product, high effort | Accepted | 20% | Yes, up to 50% |

Rules:

- An Idea Campaign always starts at 30%. Idea Campaigns never support an optional fixed Creator payment.
- A Product Campaign creator may request an optional fixed Creator payment regardless of high-effort status. High-effort status controls percentage bidding, not fixed-payment eligibility.
- Founder-offered performance bonuses are Creator-specific. Each trigger uses only that Creator's successfully captured, validly attributed, pre-tax reward subtotal or unique captured attributed Backer count, as the locked campaign terms specify. Whole-campaign performance does not trigger another Creator's bonus. All percentage compensation combined must stay at or below 50% of any single captured Backer charge.
- A fixed Creator payment remains outside the 50% percentage ceiling.
- Quality tier remains an internal creator-assessment input only; it no longer sets a commission floor.
- Once both sides accept, compensation terms lock per creator for the duration of the campaign (§6.9).
- The default/core model remains commission only: 30% base, no fixed funding, no payment at first post, and payment after campaign close and reconciliation.

### 5.13 Campaign-building track

In parallel with formal Affiliate responses and launch-roster finalization, the Founder configures the campaign. The campaign type is read-only here because it locked at vetting submission (§5.2). Campaign building uses the same one-decision-at-a-time pattern as vetting: one coherent question or decision per step, visible progress, Back/Continue navigation, and autosave. Preview and Explore may summarize the whole campaign; editable setup never becomes one endless scrolling form.

Shared fields:

- Campaign type: displayed read-only as Idea Campaign or Product Campaign.
- Campaign title.
- Founder legal name/entity/sole proprietor display.
- Founder country.
- Founder profile link.
- Campaign window: open date, close date/time UTC.
- Internal goal or order threshold depending on the locked type.
- Reward packages.
- FAQs.
- Brand perception notes: tone, wording, prohibited claims, brand voice.
- Founder community link, optional external URL.
- Hero preference.
- Founder refund policy for Product Campaigns: exact operative text or immutable snapshot, source URL, version, and effective date.
- Creator performance bonuses, optional.
- Public story / launch narrative.
- Product visuals and brand assets.

Idea-Campaign-specific setup:

- Order threshold.
- Delivery window.
- Idea Campaign (Pre-build) disclaimer.
- Risk/challenges content.

Product-Campaign-specific setup:

- Internal momentum target, not exceeding the US$50,000 aggregate pre-tax active-pre-order cap.
- No public dollar-progress goal required.
- No legacy `MBP` concept or threshold-based backer decision flow.
- Delivery month/year required on every tier.
- Founder's refund policy required and must be specific.
- The approved policy version is preserved with campaign and checkout consent and cannot be changed retroactively for existing transactions.
- Default MVP Product Campaign length: 14 days, unless admin config sets a different approved duration.

Reward package requirements:

- Title.
- Price in USD.
- Exact contents.
- Deliverables.
- Fulfillment commitment.
- Delivery month/year or delivery window.
- Optional limited quantity.
- SKU/tier identifier.

Digital-only launch categories:

- Software.
- Mobile apps.
- Online courses.
- Creator tools.
- Downloadable files.
- API access.
- Beta enrollment.
- Digital services such as books/courses.
- Login, redemption code, access key, or invite-based digital fulfillment.

Rejected at launch:

- Physical goods.
- Mixed digital + physical rewards.
- Hardware.
- Apparel.
- Printed goods.
- Food/beverage.
- Regulated medical/financial/legal categories.
- Enterprise/B2B company-procured tools where the buyer is a company rather than an individual; prosumer and creator tools where individuals pay out-of-pocket remain in scope.

### 5.14 Campaign preview

The founder can preview the public campaign page exactly as a backer would see it before submitting for Proovd review.

Preview includes:

- Full campaign page rendering.
- Reward packages.
- Delivery disclosures.
- Campaign type badge for the locked type.
- Merchant-of-record disclosure.
- Refund/fulfillment links.
- Placeholder creator attribution line.
- Checkout drawer preview with the correct consent language for the locked campaign type.

### 5.15 Launch-roster readiness and Proovd review

The initial affiliate launch roster and campaign building must both be ready before Proovd review begins. Proovd review starts only when all of the following are true:

- The initial affiliate launch roster has reached the explicit readiness rule below.
- Campaign building is complete.
- Campaign preview is complete.
- Offers and incentives are final.
- Brand assets and approved claims are ready.
- Tracking links and disclosure templates can be generated.
- Agreements and compensation terms are recorded.

**Initial launch-roster readiness rule.**

`affiliate_roster_status = launch_ready` only when:

1. At least one creator has accepted the campaign.
2. Admin has marked the final launch roster for this campaign.
3. Every creator on that roster has accepted the final compensation terms.
4. Every percentage bid, fixed Creator payment request, and revised proposal for a rostered creator is either mutually accepted or closed as declined/withdrawn.
5. No creator still marked pending is required for the planned launch.
6. The applicable agreement, disclosure, and tracking records exist for every rostered creator.

Creators who declined, were removed from consideration, or are not required for launch do not block readiness once admin records that decision.

Zero eligible recruited creators or zero creator acceptances within the formal response window produces `affiliate_roster_status = failed`, triggers the §11.9 listing-fee refund, and cannot produce `review_ready`.

`review_ready` becomes true only when `affiliate_roster_status = launch_ready` and `campaign_build_status = complete`.

The campaign model tracks `affiliate_roster_status` and `campaign_build_status` separately; `review_ready` is derived only when the initial roster is launch-ready and the campaign build is complete (§12.3).

The initial launch roster is not a permanent cap. After launch, Proovd may recruit and activate additional affiliates without reopening the completed campaign review, provided the campaign's locked public terms do not change and each new affiliate independently accepts current terms, receives the current campaign kit, clears readiness, and receives a newly activated tracking link (§5.17, §6.18).

The founder clicks Submit for Review. The campaign enters `pending_review`. Admin reviews the complete campaign, offers, creator terms, assets, claims, disclosures, and tracking setup:

- Founder identity/profile.
- Stripe connected account status.
- AUP compliance.
- Product category.
- Product claims.
- Reward contents.
- Delivery commitments.
- Delivery month/year.
- Founder refund policy for Product Campaigns.
- Order threshold for Idea Campaigns.
- Brand perception notes.
- Community link.
- Visuals/branding.
- Misleading claims.
- Fake renderings.
- Undisclosed risks.
- Inflated capability claims.
- Digital-only compliance.
- Sanctions/red-flag issues.
- Resolved creator offers, accepted compensation terms, optional fixed Creator payment arrangements, disclosure templates, and tracking setup.

Admin either approves or returns required changes. A required-change decision enters `changes_required`, preserves the existing build, and returns to `pending_review` only after the Founder resubmits.

Every required change is classified as `non_material` or `material_to_creator_terms`. Non-material corrections include spelling, formatting, accessibility text, and wording that does not alter meaning, workload, timing, economics, or risk; they do not require Creator reacceptance. A change to compensation, required work, campaign dates, rewards or prices, approved claims, delivery promises, refund terms, channel rules, or fixed-payment conditions is material. A material change creates a new campaign/Creator terms version, invalidates the affected Creator's readiness, and requires that Creator to explicitly accept the new version before approval or launch. Admin records the classification, reason, affected fields, prior/new version, and every required reacceptance.

Feedback must be grouped into `Required before resubmission` and `Optional improvements`, link each required item to the relevant form section, preserve the existing draft, and state that rejection at this stage is a review outcome rather than an account penalty unless an enforcement issue is explicitly identified.

Proovd review is the final campaign-readiness gate. There is no separate founder "launch preparation" stage after it.

### 5.16 Fixed Creator payment funding, creator readiness, and coordinated launch

For an accepted Product-Campaign optional fixed Creator payment, the founder funds the full accepted amount before that creator begins work (§6.10). The funded amount is a campaign-specific secured allocation; it is not paid to the Creator at funding or at first post, and the product must not describe it as escrow.

A creator cannot begin work until all applicable items are ready:

- Approved campaign page.
- Final rewards/offers.
- Final creator incentives and compensation.
- Product/brand assets.
- Permitted and prohibited claims.
- Tracking link.
- FTC disclosure template.
- Required post/deliverable list.
- Campaign dates.
- Accepted IP/confidentiality agreement.
- Accepted campaign terms.
- Full accepted Product-Campaign fixed Creator payment funded, where applicable.

Approved Creators receive the completed materials and prepare their work. Admin reviews campaign and Creator readiness, including the planned post or draft where available, then schedules one exact coordinated launch time.

The coordinated launch order is controlling:

1. At `campaign_live_at`, the approved public campaign page activates first.
2. The scheduled Creator tracking links activate with `activated_at = campaign_live_at` and already resolve to the live page.
3. Creators publish the scheduled posts containing those working links.
4. Each Creator submits the public post link.
5. Admin verifies the live post for identity, disclosure, claims, accessibility, and compliance (§12.6).

`activated_at` is the only technical start of payable attribution. Traffic and captured charges after activation are recorded provisionally while the public post awaits verification. Verification preserves valid provisional earnings; correction-needed or rejected content pauses that Creator's link and prevents invalid earnings from finalizing, but it does not undo the campaign-page launch or take down an otherwise compliant campaign. First-post verification releases no fixed Creator money. An Affiliate joining after launch independently clears the same readiness gate and receives adjusted remaining-time deliverables before its link is activated (§6.18).

### 5.17 During campaign — Founder campaign home, not a dashboard

Customer-facing language uses `active pre-orders`. A saved pre-order is purchase intent tied to a payment method and a future charge rule; it is not collected money. Active pre-orders can increase or decrease because cancellation is allowed before close.

The live campaign is the anticipation-rich state. The Founder's verb is `Check`: arrive, see what changed since the previous visit, clear one real item if needed, and leave finished knowing when results arrive. The product does not manufacture daily tasks or hide the campaign behind a grid of widgets.

**Glance.** The one large campaign number is the active pre-order count, for example `34 active pre-orders`. Directly beneath it, show the last-visit delta: `+6 since Tuesday` or `No change since Tuesday`. The system stores a per-Founder/campaign last-seen count and timestamp only after the rendered state is successfully delivered. For an Idea Campaign, show `[N] to go · ends [local date/time]`; for a Product Campaign, show `Campaign ends [local date/time]`. Beneath the number, retain the fixed clarification: `These people selected an offer and agreed to the campaign's charging rules. They have not been charged yet.` Show present-tense Creator liveness only when true, plus a refresh stamp such as `7 creators are promoting your campaign · Updated 3:40 PM`. Refresh-based information is never described as real time.

**Act.** Rank one primary action from real items only, in this order unless a safety/compliance severity requires a documented override:

1. Fix a campaign claim or other safety/compliance blocker.
2. Review a required delivery/refund/date change.
3. Answer an unanswered Backer support question.
4. Post a required update that is due.
5. Post an optional milestone update, offered once per actual milestone.

When no real action exists, render no primary button and close the visit with `You're all caught up. Results land [local campaign close date/time].`

**Explore.** Preserve the complete supporting information without competing with Glance or Act: clicks; active, new, and canceled pre-orders; net change; pre-tax reserved amount; estimated tax and authorized total; conversion; days remaining; results by Creator; Creator activation/verification state; survey answers; customer answers; drop-off data; direct, Proovd-house, organic, and Creator-attributed visitors; comments; updates; permitted exports; and data freshness. Explore is an expandable secondary surface, not a widget grid.

**Milestones and events.** New pre-orders, cancellations, and net change are stored separately (§10.3). An Idea Campaign can cross its order threshold and fall below it again before close; `threshold reached` and `threshold lost` are separate recorded events and notifications (§13.1). First pre-order, halfway to the order threshold, threshold met, and campaign ended may appear once at hero scale, then move into history. The final day is factual, not a theatrical countdown.

**Live editing.** The Founder may directly correct typos, add non-material clarification, update brand notes that do not change permitted claims, and change a community link. Every edit is versioned. Any change to claims, rewards, prices, campaign dates, delivery promises, refund terms, or Creator work/compensation requires Admin review and the applicable material-change process in §5.15; it cannot publish directly. FAQs follow the same rule: non-material clarification may publish, but a FAQ cannot be used to change a promise that is locked elsewhere.

Proovd may add Affiliates while the campaign is live. The Founder sees each proposed or active addition and its compensation terms, but does not search or contact Affiliates directly. A mid-campaign addition does not change campaign type, rewards, prices, dates, delivery promise, or any existing Creator's locked compensation. The new Affiliate receives only deliverables reasonably adjusted to the remaining campaign time. Attribution begins at that Affiliate's tracking-link `activated_at` and never applies retroactively (§6.18).

The Founder cannot directly change after launch: campaign type; Idea order threshold; Product internal goal; reward packages or prices; campaign duration; delivery month/year outside the required process; refund terms for existing transactions; or accepted Creator compensation and work terms.

There are no automatic Day 3, Day 7, or Day 10 `check your campaign` emails. Notifications fire only for a real required action or consequence: a customer question, required update, claim correction, delivery change, threshold met/lost, payment event, campaign end, or available result. Generic `You have activity`, `Your campaign is gaining momentum`, and `See what changed` notifications are prohibited (§13).

### 5.18 Post-campaign: results, payments, and working again

`Campaign ended` and `Results ready` are separate events. After close/capture, once results are ready the founder sees the result summary:

- Pre-orders placed and captured.
- Amount collected.
- Reward subtotal, sales tax, and total collected shown separately.
- Failed payment count.
- Retry-window results.
- Conversion.
- Drop-off points.
- Backer survey answers.
- Per-creator performance.
- Organic vs creator-attributed revenue.
- Bonus triggers.
- Finalized Creator commission and optional fixed Creator payment, where applicable.

The founder then enters the payment/disbursement and fulfillment phase. The MVP does not build a full founder-facing milestone UI, but the founder must see enough status to understand:

- W-9 is required before any founder payout release.
- **Idea Campaign:** if the order threshold was met and charges succeeded, 100% of the eligible founder share becomes payable at Day 3 post-close as the single Founder payment — after W-9 completion, payment/risk checks, and recorded admin approval. There is no second Idea-Campaign payment and no 40/60 split. Any later progress review concerns fulfillment, communication, refunds, risk, or enforcement — not the release of another payment.
- **Product Campaign:** the first payment (40% of the eligible founder share) is scheduled for Day 3 post-close if requirements are met. The remaining payment (60%) is scheduled for Day 14 by default, and is eligible for earlier release after Day 3 — never before — only when admin verifies that the promised digital reward/access has actually been delivered or made available to the affected backers, required backer communications have been sent, no immediate risk flags remain, and all tax/payout requirements are complete (§11.3).
- Delivery obligations remain active.
- Communication cadence remains required.

**Successful creator completion.**

A creator is eligible for a work-again request only when the creator's campaign-participation record is marked `successfully_completed`.

Admin may assign `successfully_completed` only when:

1. The campaign has ended.
2. The creator cleared the readiness gate before beginning work.
3. At least one valid promotional post was submitted and verified.
4. Every agreed deliverable was verified, or a specific deliverable was formally waived by both the founder and admin with a recorded reason.
5. There is no unresolved fraud, invalid-proof, material-breach, or compliance case against that creator for the campaign.
6. Every applicable fixed Creator payment, return, commission adjustment, and Stripe transfer has been resolved or recorded.

Sales performance is not required for successful completion. A creator may qualify even when the campaign underperforms if the creator completed the agreed work correctly.

Stored fields: completion status, completed date, admin actor, evidence links, waived deliverables, and disqualifying reason where applicable.

**Working together again.** After a campaign ends, the founder can request to work again with a creator whose participation record for that campaign is `successfully_completed`:

- The request routes through Proovd. There is no direct founder–creator messaging.
- The creator may accept or decline.
- Stored: original campaign, founder, creator, request date, status, and response (§14.2, §14.3).
- The request does not create a new campaign automatically.
- It does not bypass the one-active-campaign rule, the three-month cooldown, or admin readiness approval.
- Full recurring creator-management remains deferred (§17).

### 5.19 Cross-cutting founder-flow requirements

#### 5.19.1 Founder persona requirements in product copy

The canonical founder persona is an aspiring Gen-Z AI-powered consumer SaaS founder. The product should speak to:

- Real signal over compliments.
- Demand validation before overbuilding.
- The difference between a prototype and proof.
- The difference between a few users and repeatable distribution.
- Creator/distribution partner interest as an early market signal.
- The emotional pain of fake validation from friends.
- The need to prove the consumer outcome, not merely "AI."

Messaging should reinforce:

- "Before you build the AI-powered app, prove people want the outcome."
- "AI is the engine. Demand is the test."
- "A prototype is not proof."
- "A couple of users is not a market."
- "Your group chat is not validation."
- "If it flops, good — you saved months."

These are not necessarily literal UI strings everywhere, but they inform onboarding, helper text, and founder education.

#### 5.19.2 Autosave

The temporary draft, vetting, and campaign forms autosave as the founder works.

The form always shows one of three compact states near the primary action: `Saving…`, `Saved [local time]`, or `Could not save — retrying`. A failed save must not clear valid fields. When the founder returns, the form restores the latest saved draft and states when it was last saved. Before leaving a page with newer unsaved changes, the browser warns the founder.

---

## 6. Affiliate / distribution partner flow

### 6.1 Campaign-specific invitation and signup

The affiliate receives a private invitation for a specific founder/campaign. The invitation opens one compact prefilled signup surface rather than a multi-page onboarding flow.

The compact signup flow contains the password/account-claim field, prefilled profile and channel fields that can be corrected, date of birth/country/state, Terms and Affiliate AUP acceptance, and the 18+/US-based/identity-disclosed/no-duplicate-account/sanctions confirmations. The affiliate submits the Proovd fields with `Confirm and create account`, then uses the only other primary action, `Finish payout setup`, for Stripe embedded or hosted connected-account onboarding. These are one compact account-and-payout setup flow, not separate education pages or a custom Proovd banking form.

Each state has one primary action and at most one secondary exit/help action. It does not branch into separate welcome, education, or splash pages. Stripe may display the legally required identity, tax, bank, and verification fields inside its controlled flow.

If the founder has not completed account claim, the same surface confirms that signup is complete, the founder is still finishing setup, and no action is required. When `founder_signup_complete` occurs (§5.5), the campaign automatically appears in a preparing state and the affiliate receives a notification with one action: `Review campaign`.

The preparing state is informational. The affiliate may read the available brief and campaign kit but cannot accept, decline, propose terms, or begin work until successful listing-fee payment activates the formal campaign opportunity (§5.10).

### 6.2 Single affiliate home and campaign kit

The MVP does not require a multi-tab affiliate dashboard or a sequence of splash screens. The affiliate has one compact home showing the campaign they were recruited for and, if applicable, up to three active partnerships. The current campaign/state carries one primary action and at most one secondary action.

All campaign support material lives inside one attached **Campaign kit**, not across separate pages. The kit contains:

- Why this campaign fits the affiliate's audience.
- A 60-second campaign brief.
- Founder and product summary.
- Problem, solution, and competition/positioning.
- Idea Campaign or Product Campaign explanation and the applicable charging rule.
- Reward packages, prices, campaign dates, and delivery commitments.
- Required posts and deliverables, including remaining-time adjustments for a mid-campaign join.
- Founder-approved visuals, brand direction, blurbs, post suggestions, and talking points.
- Permitted claims, prohibited claims, and any unconfirmed claim warning.
- Unique tracking-link instructions.
- FTC disclosure guide and copy-ready campaign-specific disclosure templates.
- Promotion-channel, spam, minors, self-pre-order, and fraud rules.
- First-post proof and correction instructions.
- Compensation, bonus, optional fixed Creator payment, post-close finalization, adjustment, and payout explanation.
- Plain-language IP/confidentiality summary, with the signed agreement remaining controlling.
- Proovd support route.

The campaign kit is required MVP. A reusable cross-campaign resource library, mini-course system, large educational PDFs, affiliate certification, and automated product tour remain deferred (§17).

### 6.3 Campaign opportunity

Each campaign opportunity shows:

- A two-sentence `Why this fits your audience` note written by admin.
- A `60-second brief` containing the audience, product promise, campaign type, required promotion, compensation, key date, and main delivery/claim risk.
- Founder name.
- Founder entity/sole proprietor if applicable.
- KYC/connected-account readiness status.
- Campaign type.
- Product category.
- Problem.
- Solution.
- Competition/positioning.
- Visuals, branding, story, socials, interview material when available.
- High-effort status and its calculated basis (§5.8).
- Reward packages.
- Delivery dates/months.
- Order threshold or internal goal depending on campaign type.
- Campaign duration.
- Brand perception notes.
- Prohibited claims.
- Founder refund policy for Product Campaigns.
- Compensation structure per the §5.12 matrix.
- Base commission percentage: 30%, or 20% where a Product Campaign optional fixed Creator payment is accepted.
- Performance bonus terms.
- Optional fixed Creator payment request availability (Product Campaigns only).
- Whether percentage bidding above the base is available (high-effort campaigns only).
- Founder’s prior Proovd campaign history if any.
- Option to request sample, demo, or Zoom if admin supports manually.
- Whether the campaign is preparing, open for a formal decision, live, or ended.
- If live, the exact remaining campaign time, adjusted deliverables, and tracking-link activation time.

Performance-bonus terms identify the Creator-specific trigger, measurement unit, maximum percentage, and the fact that only that Creator's captured attributed results count.

When the formal opportunity is active, the campaign has one primary decision action and at most one secondary action. `Accept` may be primary; `Decline` and `Propose terms` may be grouped under the single secondary decision control without hiding either option or implying that declining harms standing. For the private, manually known MVP cohort, the confirmed Affiliate may open the complete Campaign kit before deciding under the pilot exception in §§5.5 and 6.5.

### 6.4 Accept / decline / counter-offer

Actions:

**Accept**

- Affiliate accepts compensation terms.
- Affiliate accepts per-campaign IP and Confidentiality Agreement.
- Affiliate acknowledges FTC disclosure requirement.
- The campaign association becomes `accepted`; it is not yet active work permission.
- Proovd creates the affiliate's unique tracking-link record. The link remains inactive until the applicable §5.16 creator-readiness items are complete.
- Affiliate receives campaign-specific disclosure templates.
- Partnership becomes active only after the campaign is approved and creator readiness is complete. For an affiliate joining a live campaign, activation occurs after that affiliate independently clears readiness (§6.18).
- Compensation structure locks for duration of campaign.
- Confirmation shows a plain-language compensation example, what is locked, what still depends on captured charges/verification, the first required action, and the response/support owner.

**Decline**

- Affiliate enters optional or required free-text reason.
- Founder/admin sees decline signal.
- Declining does not penalize affiliate.
- Confirmation explicitly says the decline was recorded and does not reduce the affiliate's standing; suggested reason chips may speed feedback without making a reason mandatory unless an operating rule requires it.

**Propose terms (percentage bid / optional fixed Creator payment request)**

- On a high-effort campaign, the creator may propose a commission percentage above the applicable base, subject to the 50% total-percentage ceiling (§5.12).
- On a Product Campaign, the creator may request an optional fixed Creator payment regardless of high-effort status (§6.10).
- A creator proposal is shown directly to the founder.
- The founder may accept it, decline it, or propose a revised amount or percentage.
- A founder revision does not constitute acceptance and does not lock the terms. It creates a new proposal version with status `awaiting_creator`.
- The creator may accept the founder's revision, decline it, or submit another revision.
- Terms lock only after both the founder and creator have explicitly accepted the same proposal version.
- A proposal or revision that remains pending at the 72-hour formal-response deadline is not acceptance, does not pause or extend the deadline, and closes if the campaign enters the no-acceptance refund outcome (§11.9).
- Admin observes and may mediate or reject terms that violate platform rules, but admin mediation does not substitute for mutual acceptance.
- Every version stores the proposed values, proposing party, timestamp, response, and superseded version.
- Only the final mutually accepted version determines commission, fixed-payment funding, and creator readiness.
- An accepted optional fixed Creator payment moves that creator's base commission to 20% (§5.12) and must be fully funded by the founder before work begins (§6.10).
- The creator receives a durable summary of the submitted terms, submission time, and next expected update; subsequent revisions show the prior and proposed values side by side.

### 6.5 IP and confidentiality agreement

When the affiliate accepts the campaign opportunity, the affiliate accepts a per-campaign IP and Confidentiality Agreement.

**MVP pre-view exception.** Because every pilot Affiliate is privately recruited, manually known, authenticated, and associated with one specific campaign, the full preparing-state Campaign kit may be visible before the per-campaign agreement is accepted. This exception creates no public access and no work permission. Access is logged, campaign-scoped, revocable, and ends when the invitation/association is revoked. The per-campaign agreement remains mandatory before acceptance becomes active work permission. Post-pilot onboarding must revisit whether a separate confidentiality gate is required before sensitive kit access.

Requirements:

- The per-campaign agreement binds the affiliate only, with Proovd as beneficiary where counsel approves. The Founder's corresponding confidentiality, license, IP, and campaign obligations live in the Founder Terms; the affiliate agreement must not claim that clicking acceptance binds the Founder.
- Separate instance for each campaign-affiliate association.
- Confidentiality lasts two years after campaign end/termination.
- Non-replication of substantially similar product lasts two years.
- Founder retains concept and promotional materials.
- Affiliate retains their own pre-existing IP and creative contribution.
- Affiliate receives limited, non-transferable, revocable license to use promotional materials only during active campaign.
- Affiliate may keep lawfully published campaign content live after campaign end and may reference it in portfolio/case studies.
- Affiliate may not disclose confidential info, build/copy the concept, assist third parties to build/copy it, or use confidential info for other purposes.

### 6.6 FTC disclosure and promotional standards

Every affiliate promotional post must clearly disclose a paid/material relationship with the specific founder or product.

Correct disclosure frame:

- “Paid partnership with [FOUNDER/PRODUCT NAME],” not “Paid partnership with Proovd,” unless Proovd itself is the promoted product.

Acceptable disclosure approaches:

1. Story-integrated text disclosure.
2. Pre-roll verbal disclosure in video/audio.
3. Native platform paid-promotion tools naming founder/product where possible.
4. Prominent #ad / #sponsored when native tools are unavailable.

Disclosure must appear at the start of content or be prominent enough that a reasonable viewer cannot miss it.

Affiliates must:

- Stay within founder brand perception notes.
- Make no product claims beyond campaign page/interview.
- Not promise undisclosed outcomes, benefits, features, or timelines.
- Not deceptively edit founder interview or marketing material.
- Identify campaign type where material.
- Include/substantively communicate the Idea Campaign disclaimer for Idea Campaign promotions.
- Not target minors or audiences known to skew under 18.
- Comply with FTC rules and platform/channel rules.

### 6.7 Where affiliates may promote

Affiliates may promote only through channels they own, administer, guest on, or have permission to use.

They may not:

- Use unsolicited DMs or spam.
- Use mass-promotion platforms for unrelated content.
- Promote from non-primary or identity-hidden accounts.
- Sell, lease, transfer, or share their affiliate account/tracking link.
- Violate host-channel terms or community rules.

Channel-specific rules:

- Newsletter/email: must comply with CAN-SPAM, GDPR where applicable, and newsletter platform rules; no purchased or non-consented lists.
- Student affiliates: must act in personal capacity and not imply school, club, program, or department endorsement.
- Reddit/Discord/forums/course platforms: direct affiliate links are allowed only where host rules allow; otherwise use public campaign URL or compliant endorsement path.
- Proovd house channels: tracked separately and not treated as third-party affiliate performance.

### 6.8 Active partnership view

Each active partnership shows:

- Founder name.
- Product/startup name.
- Campaign type.
- Public campaign link.
- Unique tracking link.
- Disclosure templates.
- Brand perception notes.
- Prohibited claims.
- Reward packages and prices.
- Delivery dates.
- Campaign duration/end date.
- Affiliate joined-at time and tracking-link activation time.
- Remaining-time deliverables where the affiliate joined after launch.
- Compensation structure.
- Optional fixed Creator payment funding and post-completion payment status (§6.10).
- First-post verification status.
- Creator-readiness status; work may not begin until every applicable §5.16 readiness item is complete.
- Clicks driven.
- Pre-orders attributed.
- Captured amount attributed after close.
- Conversion rate.
- Earned commission.
- Performance bonus progress.
- Transfer/payout status.

Metrics refresh on page load; no real-time feed required.

The active-campaign surface displays `Updated [local time]` and explains that figures are not real time. Tracking links and campaign-specific disclosure text each have a one-click copy action with a visible `Copied` confirmation. Earnings are separated into `estimated`, `finalized`, `approved for transfer`, `transferred`, `paid out`, `payout failed`, and `adjusted`, with the exact reason, owner, and next date wherever money is not yet paid.

### 6.9 Compensation structure

Affiliate program is single-tier only. No sub-affiliate, MLM, pyramid, or referral-of-referral compensation.

Compensation mechanisms:

1. **Base commission per the §5.12 matrix.** 30% base, or 20% base where a Product Campaign optional fixed Creator payment is accepted. Quality tier remains an internal creator-assessment input only; it no longer sets a commission floor.
2. **Creator-specific performance bonus.** Founder may offer an additional percentage triggered by that Creator's successfully captured, validly attributed, pre-tax reward-subtotal threshold or unique captured attributed-Backer threshold. Results belonging to organic, house, or another Creator's attribution never satisfy the trigger.
3. **High-effort percentage bidding.** Only on campaigns calculated high-effort under §5.8 may the affiliate bid a commission percentage above the applicable base for that campaign.
4. **Optional fixed Creator payment (Product Campaigns only).** A Creator-requested, Founder-accepted fixed amount for completing the agreed promotional deliverables. It is funded in full before work begins, releases nothing at first post, and is paid only after campaign close, payment reconciliation, and verification of every agreed deliverable (§6.10).
5. **Good-effort thank-you payment.** Optional manual Proovd-funded recognition for an unsuccessful/low-commission campaign where the Affiliate met effort and compliance criteria. It is not an automated earning or guaranteed product benefit.

Commission ceiling:

- Total percentage compensation on any single captured Backer charge cannot exceed 50%, inclusive of base commission, Creator-specific bonus, high-effort bid, or any other percentage arrangement.
- Fixed Creator payments sit outside the 50% commission ceiling.

Locking:

- Once an affiliate and founder accept the same campaign compensation proposal, agreed compensation terms lock for that campaign.
- Founder cannot unilaterally reduce terms after acceptance.
- Every locked Creator-specific bonus stores its trigger unit, threshold, additional percentage, maximum combined percentage, and effective proposal version. On every attributed charge, the platform-side provisional Affiliate amount uses the maximum locked percentage that could become payable. After close, Proovd applies the earned percentage and returns the unearned provisional difference to the Founder through the approved adjustment path (§10.4).

### 6.10 Optional fixed Creator payment

The optional fixed Creator payment exists only on Product Campaigns and is Creator-requested, not Founder-selected. The core/default campaign model remains commission only.

Sequence:

1. A campaign-specific Product Campaign recruit reviews the formal opportunity and expresses interest.
2. The Creator enters a requested fixed amount.
3. The Founder may accept, decline, or propose another amount.
4. A revision creates a new proposal version. Terms lock only when the Creator and Founder explicitly accept the exact same version. Until then, the status is `awaiting_creator` or `awaiting_founder`, no funding request exists, and work cannot begin.
5. The accepted fixed-payment arrangement sets that Creator's base commission to 20% (§5.12).
6. The Founder funds the exact accepted fixed amount in full before the Creator begins work. Partial funding is not allowed.
7. After every §5.16 readiness item is complete, the Creator prepares the agreed work. At the coordinated launch, the Creator publishes and submits each required public link.
8. At `campaign_live_at`, the campaign page and Creator tracking link activate first; the Creator then publishes and submits the public link. Admin verifies the post for attribution validity, disclosure, claims, account ownership, and public accessibility. First-post verification releases US$0 and does not cause the already-scheduled campaign-page launch.
9. At campaign close, Admin verifies every agreed deliverable, required availability period, fraud/compliance status, and any recorded waiver.
10. After the 48-hour charge-retry window closes, Admin finalizes eligible commission and the fixed Creator payment. Proovd transfers the two together to the Creator's approved Stripe connected account, normally on Day 3 after close.

**Funding and payment rules**

- Every accepted arrangement creates one campaign-and-Creator-specific secured allocation.
- Funding status is `not_requested`, `payment_pending`, `funded`, `payment_failed`, `returned`, or `paid`.
- A failed funding payment leaves the Creator blocked from work and may be retried without duplicating the allocation or changing the accepted amount.
- If funding misses the admin-configured deadline, Admin may cancel the association and recruit another affiliate. The 20% base ceases to apply when that association is canceled.
- Funding, return, earnings finalization, Transfer creation, and any recovery use stable idempotency keys.
- The fixed allocation is separate from Backer campaign charges, sales tax, Proovd's 5% fee, and percentage commission calculations. No percentage is calculated on the fixed allocation.
- The accepted fixed amount may not be reduced by an undisclosed Proovd fee.
- The production architecture must identify the Founder-funding charge, descriptor, processing-fee treatment, accounting/tax treatment, return behavior, and Stripe-approved transfer path. Proovd never calls the allocation escrow, custody, trust money, or money already paid to the Creator.
- Live fixed-payment funding remains disabled until Stripe and counsel approve and test the complete funding-and-transfer path.

**Completion and return rules**

- No valid compliant post: the full fixed allocation returns to the Founder and the Creator earns no commission.
- At least one valid compliant attributed post, but one or more other agreed deliverables remain incomplete: the fixed allocation returns to the Founder. The Creator may retain genuine commission from compliant, attributed, successfully captured sales.
- Every agreed deliverable completed and verified: the full fixed amount is eligible for payment after close and reconciliation, even if campaign sales were poor. Performance alone is not a completion test.
- Fraud, fake traffic, self-dealing, false claims, invalid proof, or material breach cancels the unpaid fixed amount and invalid earnings. If money was already transferred, it creates a negative balance and contractual recovery claim.
- A qualifying public post must remain available for the campaign period or the expressly agreed availability period. Story-format media may use its agreed natural lifespan if the campaign record says so before work begins.
- No fixed-payment arrangement: the Creator receives no flat payment and earns commission only.
- Fixed Creator payments remain outside the 50% commission ceiling.

### 6.11 Good-effort thank-you payment

If a campaign generates insufficient captured charges to produce meaningful commission, Proovd may choose to issue a thank-you payment from Proovd's retained listing-fee revenue after every listing-fee refund right for that campaign has been resolved. The Founder is not charged again and the amount is not deducted from Backer charges, Founder share, commission, or a fixed Creator allocation.

Criteria:

- Affiliate published the minimum number of agreed promotional posts; default three unless specified.
- Affiliate tracking link generated the minimum click threshold defined per campaign.
- Promotional content complied with brand notes and Affiliate AUP.

Thank-you payments are discretionary, not guaranteed, not commission, and do not create precedent. The MVP does not calculate, promise, request, or automatically send them. If Admin approves one, Admin manually initiates the payment through the Stripe-approved Affiliate recipient/Transfer path and records the amount, reason, funding source, recipient, approval, Stripe object, tax/accounting treatment, status, and timestamp. No payment may occur until Stripe and tax counsel confirm the permitted manual path. If that approval is absent, Admin may record recognition but must not promise or send money.

### 6.12 Earnings finalization and payment

The MVP does not ask an Affiliate to submit a withdrawal request. Earnings remain estimated during the campaign. After `campaign_close_at`, the 48-hour card-retry window completes, Admin verifies the Creator's agreed work and compliance, and Proovd finalizes commission, performance bonus, and any eligible fixed Creator payment.

Payment timing:

- Commission and Creator-specific performance bonus: finalized from that Creator's successfully captured, validly attributed, pre-tax reward subtotal or captured attributed-Backer count after the retry window.
- Optional fixed Creator payment: eligible only when every §6.10 completion requirement is satisfied; paid with finalized commission, never at first post.
- Manual thank-you payment, if any: separate discretionary Admin operation after listing-fee refund rights are resolved and the Stripe/tax path is approved; it is not combined into or promised with the standard Creator Transfer.
- Standard Creator transfer: Admin-approved and created on or after Day 3 following campaign close.

The Affiliate is onboarded to a Stripe connected account with the capability needed to receive Transfers and payouts. Proovd creates the campaign-specific Transfer only after Admin approval. Stripe records the connected recipient, Transfer status, payout status, reversals, and payout failures. The Affiliate never processes the Backer's card charge and does not gain access to campaign funds before the transfer is created.

If Stripe approval for this exact affiliate-transfer model is pending, earnings may be calculated in test mode but no live fixed-payment funding, commission Transfer, or payout promise may be enabled. The production configuration must be approved in writing and tested before the controlled pilot.

The Creator payment surface shows `estimated`, `finalized`, `approved for transfer`, `transferred`, `paid out`, `payout failed`, or `adjusted`, and states the exact reason and next owner for any unpaid amount. Bank and tax updates route to Stripe; Proovd does not store complete bank details.

### 6.13 Affiliate self-pledging and fraud controls

Affiliate may reserve/back a campaign they are promoting only if they:

- Disclose intended self-pledge before reserving.
- Certify it is genuine and funded with their own money.
- Use identity-disclosed contact/payment info.

Self-pledges do not earn commission, performance bonus, or thank-you payment.

Prohibited:

- Coordinating with backers to inflate metrics.
- Providing funds to others to back campaigns.
- Using multiple IPs/devices/accounts to back same campaign.
- Reciprocal pledging.
- Engagement boosting.
- Artificial inflation of backer count, reserved amount, or conversion rate.

Violations are Affiliate-caused fraud. They cancel unpaid invalid earnings and, if invalid earnings were already transferred, create a negative balance and contractual recovery claim; they may also trigger termination and Stripe/law-enforcement referral.

### 6.14 Non-compete

For one month after an active campaign ends, affiliate may not promote a directly competing product with substantially the same core functionality. Adjacent products are allowed.

### 6.15 Conflict disclosure

Affiliate must disclose business, family, financial, investor, advisor, contractor, employee, backer, or other material relationships with:

- Founder for the campaign they were invited to promote.
- Other affiliates that create coordinated-promotion incentives.
- Directly competing products.
- Founder’s underlying business.

Undisclosed conflicts can trigger partnership suspension.

### 6.16 Affiliate suspension and enforcement

Admin may suspend, pause, terminate, demote, or restrict affiliate account/partnership for:

- AUP breach.
- Fraud.
- Audience metric manipulation.
- Deceptive promotion.
- Host-channel violations.
- Regulatory concern.
- Stripe risk escalation.
- Repeated invalid terminations.

Consequences may include:

- Warning.
- Partnership pause/termination.
- Cancellation of unpaid earnings caused by the Affiliate's fraud, fake traffic, self-dealing, false claims, invalid proof, or material breach.
- A negative balance and contractual recovery for already transferred earnings only when the Affiliate caused the invalid charge, refund, dispute, or breach.
- Quality-tier demotion.
- Percentage-bid eligibility restriction.
- Removal from platform.
- Referral to authorities.

Affiliate can appeal within five business days where policy allows. Admin decision on appeal is final.

### 6.17 Post-campaign work-again requests

After a campaign ends, its founder may request to work again with an affiliate/creator whose participation record for that campaign is `successfully_completed` under §5.18.

- The request routes through Proovd; there is no direct founder–affiliate messaging.
- The affiliate sees the request on their compact home and may accept or decline; declining carries no penalty.
- Stored: original campaign, founder, affiliate, request date, status, and response (§14.3).
- An accepted request does not create a new campaign automatically and does not bypass the founder's one-active-campaign rule, three-month cooldown, or admin readiness approval.
- Full recurring creator-management remains deferred (§17).

### 6.18 Joining a live campaign

Proovd may recruit and invite an additional affiliate at any time after launch and before the campaign ends.

Rules:

- The affiliate still enters through a private campaign-specific invitation and completes the compact §6.1 signup.
- Because the founder has already completed signup, the live campaign appears immediately after the affiliate account is confirmed.
- The affiliate receives the current campaign kit, exact remaining campaign time, and deliverables adjusted to that remaining time.
- The affiliate accepts, declines, or proposes compensation under the same §5.12 matrix. The campaign's locked high-effort classification controls percentage-bid eligibility.
- Adding an affiliate does not change campaign type, public rewards, prices, dates, delivery commitments, or any existing affiliate's locked terms.
- The new affiliate must independently accept the IP/confidentiality agreement, FTC obligations, compensation, and campaign terms and clear every applicable readiness item before promoting.
- The new tracking link records `activated_at`. Only visits and later captured charges attributed after activation may generate commission; no earlier traffic, pre-orders, or charges are attributed retroactively.
- Post-verification status is separate from `activated_at`: traffic after activation is provisional until Admin verifies the post, and invalid/rejected content cannot produce finalized earnings.
- The three-active-partnership cap still applies.
- A campaign that has ended cannot accept a new affiliate.
- A campaign whose initial affiliate-roster outcome failed and whose listing fee was refunded cannot be silently revived by a late affiliate acceptance; the founder must follow the approved resubmission path.

Mid-campaign additions extend distribution; they do not reopen the campaign's completed Proovd review unless the addition requires a material change to public campaign terms or claims.

For the three-active-partnership cap, a partnership occupies a slot from tracking-link activation until campaign close or recorded removal. Preparing, invited, declined, and ended associations do not occupy a slot.

---

## 7. Backer flow

### 7.1 Arrival

Backer arrives at a campaign page via:

- Affiliate tracking link.
- Founder’s plain campaign link.
- Proovd house channel.
- Direct/organic discovery.

If an affiliate link is present, the page shows discreet attribution: “You came through [@affiliatehandle].” The last valid affiliate link clicked before a pre-order wins attribution on that same browser/device. Its first-party attribution cookie lasts until `campaign_close_at`; a later valid affiliate click replaces the earlier affiliate, while a direct return without a new affiliate link preserves the current cookie. MVP does not promise cross-device or cross-browser attribution.

Organic pre-orders through founder’s plain link carry no creator commission.

Proovd house channel traffic is tracked separately from third-party affiliate performance.

### 7.1.1 Discovery timing and affiliate protection

For the first seven campaign days, the public campaign route is accessible through an affiliate link, founder link, or other known direct link but is excluded from Proovd browse/discovery surfaces. Starting on Day 8, the campaign becomes eligible for Proovd public browsing and indexable discovery. The page itself does not change; attribution changes only through the arrival URL/session.

Organic pre-orders or purchases receive no affiliate commission and flow to the founder share after Proovd's 5% platform fee and any other applicable campaign deductions. Affiliate earnings reflect only successfully captured, pre-tax reward subtotal from transactions bearing that Affiliate's valid last-link attribution. The founder receives a Day 8 notification explaining that public discovery is active and how organic, house-channel, and affiliate attribution differ.

### 7.2 Browsing

Backer can read public campaign page without authentication.

Public content includes:

- Campaign title.
- Founder identity.
- Reward packages.
- Delivery dates.
- Campaign type.
- Campaign window.
- Threshold row for Idea Campaigns only.
- Refund/fulfillment links.
- Merchant-of-record disclosure.
- General/public updates.
- Public comments where enabled.

Backer-only updates, pre-order details, cancellation, refund/support requests, and payment update flows require magic-link access.

### 7.3 Pre-order flow

Backer clicks reserve/pre-order CTA.

Flow:

1. Select one reward package for this transaction.
2. Answer fixed pre-checkout survey.
   - “Why do you want this product?” free text.
   - “How likely are you to recommend this to someone?” 1–10.
3. Enter email, phone, US billing country, and postal code; collect the full billing address where the approved tax/payment configuration requires it. A non-US billing location cannot continue in the controlled MVP pilot.
4. Confirm with an unchecked control that the Backer is at least 18.
5. Review the reward subtotal, calculated sales tax, and exact total authorized.
6. Review the campaign-type consent block and acknowledge that email and purchase details will be shared with the Founder solely for fulfillment and purchase support.
7. Optionally, through a separate unchecked control, allow the Founder to send marketing, research, survey, or other non-fulfillment contact.
8. Optionally join Proovd's newsletter through its own unchecked control.
9. Enter card through Stripe.
10. Stripe SetupIntent saves the card for the disclosed future total.
11. No charge happens when the pre-order is placed.
12. Backer receives confirmation email with magic link.

Sold-out tiers remain visible and greyed out.

Idea Campaign: one active pre-order per unique Backer for that campaign. The Backer may change the selected reward before close; the latest active selection and its updated tax/total consent replace the earlier selection. Proovd applies the practical deduplication and Admin-review rule in §3.1; it does not claim that unverified people can never evade detection by using entirely different identities.

Product Campaign: the same Backer may place multiple transactions, but each transaction contains exactly one reward package and its own consent, tax calculation, total, SetupIntent, and cancellation state. Backer count is unique; unit count, active-pre-order value, and captured revenue include every transaction.

The system atomically enforces the US$50,000 per-campaign cap against the pre-tax value of active pre-orders. A new or changed transaction that would exceed the cap is rejected or waitlisted before a SetupIntent is created.

Before the Stripe card field, a compact three-step timeline summarizes the specific transaction:

1. **Today:** save card; charge today = US$0.
2. **At the trigger:** charge the authorized total of US$[TOTAL] — US$[REWARD SUBTOTAL] + US$[SALES TAX] — on [LOCAL DATE/TIME, with UTC secondary] only under the selected campaign-type rule.
3. **Delivery:** receive [REWARD PACKAGE] by [DELIVERY MONTH/YEAR or WINDOW].

The survey explains in one sentence that answers help the founder understand demand. Survey and reward selections survive a payment/setup error; the user is never required to retype them because Stripe or the network failed.

### 7.4 Checkout consent

The checkout consent drawer must satisfy off-session mandate requirements:

- Explicit permission to initiate later payment.
- Anticipated timing and frequency.
- How amount is determined.
- Reward subtotal, calculated sales tax, and exact total authorized.
- Cancellation policy.

The exact consent blocks in Appendix A of this document must be pasted into the implementation with campaign variables. They must also match the separate canonical policy files before launch.

Idea Campaign CTA: “Authorize a future charge if the order threshold is met.”

Product Campaign CTA: “Authorize the pre-order charge on [close date].”

Listing fee CTA: “Agree and Pay US$[X].”

### 7.5 Post-pre-order email

Immediately after a pre-order is placed, backer receives branded confirmation email.

Email includes:

- Campaign name.
- Founder/product branding.
- Reward package selected.
- Reward subtotal, sales tax, and total authorized.
- Pre-order date.
- Campaign close date.
- Statement that card was saved but not charged.
- Charge trigger: threshold met for Idea Campaigns, close date for Product Campaigns.
- Cancellation instructions.
- Magic link.
- Plain-English refund/support summary.
- `support@proovd.co` and one-business-day SLA.
- Localized close date/time with UTC shown secondarily.
- Expected statement descriptor.
- `Add close date to calendar` action using a simple calendar file/link.
- A three-line `What happens next` summary matching the checkout timeline.

The on-screen success state leads with `Pre-order saved — you were not charged` and repeats amount, trigger, selected reward, delivery timing, cancellation deadline, magic-link destination, and seller/MoR. Celebration is restrained so a pre-order cannot be mistaken for a completed purchase.

### 7.5.1 Pre-charge reminder

For any active pre-order that is still scheduled to charge, send a transactional reminder approximately 24 hours before the disclosed trigger. If the pre-order was placed less than 24 hours before the trigger, send the reminder promptly after the pre-order and do not duplicate it.

The reminder includes:

- Campaign and founder/seller name.
- Reward subtotal, sales tax, exact total authorized, and reward package.
- Local charge date/time with UTC secondary.
- The applicable threshold or close-date condition.
- Expected statement descriptor.
- Direct magic-link action to review or cancel before the deadline.
- Support route and one-business-day SLA.

The reminder must not imply that the card will certainly succeed or that an Idea Campaign threshold has been met before that state is final.

### 7.6 Magic-link page

The magic-link page shows:

- Full campaign page.
- Backer’s pre-order details.
- Reward package selected for each transaction.
- Total reserved amount.
- Pre-order date.
- Payment status.
- Whether charge has happened.
- Cancellation button before close.
- Update-card flow during failed-payment retry.
- Full updates feed, including backer-only updates.
- Comment ability when allowed.
- Founder support form.
- Founder community link.
- Refund/support request path after charge.
- Satisfaction survey after delivery.

Magic links are long-lived credentials scoped to one Backer/campaign. They remain valid through fulfillment or final resolution plus 180 days, unless Admin revokes and reissues them for security. Creator or Founder payment does not expire a Backer's link.

### 7.7 Cancellation before close

Before close, backer can cancel at no cost.

Idea Campaign:

- Internal reservation is canceled; the saved PaymentMethod is detached where appropriate.
- No charge.
- On-screen and email confirmation required.

Product Campaign:

- Internal reservation is canceled; the saved PaymentMethod is detached where appropriate.
- No charge.
- Founder notified.
- Confirmation sent to backer.

Both confirmation variants state `Canceled — you were not charged`, identify the campaign/reward, show the cancellation time, and link back to the campaign if the backer wants to place a new pre-order while the campaign is still open. Cancellation remains a single clear action; it must not be obstructed by a retention modal.

Detachment is reference-safe: if the same Customer/PaymentMethod still supports another active transaction, Proovd removes it only from the canceled reservation's future-charge eligibility and does not detach it globally. In every case, the canceled reservation can never create a PaymentIntent.

### 7.8 Close-date charge

At close:

Idea Campaign:

- If order threshold met: active pre-orders are charged off-session.
- If threshold not met: no cards are charged; internal reservations close as no-charge and saved PaymentMethods are detached where appropriate.

Product Campaign:

- Every active pre-order is charged off-session on close date.
- Campaign is keep-what-you-raise.

After successful charge, backer receives receipt.

### 7.9 Failed payment retry

Some cards will fail due to expiration, insufficient funds, decline, or bank challenge.

MVP retry flow:

- A failed pre-order enters a fixed 48-hour retry window beginning with the first close-batch failure.
- Backer receives email to update card.
- Magic-link page shows update-card prompt.
- Admin dashboard shows failed-payment status.
- If card succeeds in retry window, the pre-order becomes captured.
- If still failed at end of retry window, the pre-order is dropped and does not count toward collected total or affiliate commission.
- Founder and Creator payment reconciliation begins only after the 48-hour window closes; the standard review/transfer date is Day 3 after `campaign_close_at`.

The recovery email and magic-link state translate the Stripe outcome into plain language, state whether any money was charged, show the retry deadline in local time, preserve the reward/amount, and provide one primary `Update card` action. Copy must be neutral and non-shaming. Raw decline codes may appear only as secondary support detail.

### 7.10 Comments

Comments use this structure:

- One general campaign comment thread.
- One comment thread under each update.

Backers must access via magic link to comment. Comment author identity uses a privacy-safe display label such as `Backer 014` or a backer-chosen display name; it must not expose the email local-part by default. No profile photo is required.

Flagged comments go to admin. New comments are disabled after campaign end/kill.

### 7.11 Backer recovery

Backer recovery means admin re-sends the magic link. No self-service magic-link resend in MVP unless trivial.

No expired, revoked, or invalid magic link may end on a blank or generic error page. The page explains that the link cannot be used, provides the support route, and—if a secure, rate-limited, non-enumerating resend can be implemented cheaply—offers `Email me a new link`. Support/admin resend preserves the same campaign and pre-order context.

---

## 8. Public campaign page

### 8.1 Required page structure

Every campaign page must render, in order:

1. Campaign title.
2. Founder identity block: legal name, entity or sole proprietor, country, link to founder profile.
3. Reward packages: SKU title, price USD, exact contents, delivery month/year, fulfillment commitment.
4. Campaign type badge: Idea Campaign or Product Campaign.
5. Campaign window: open date and close date/time in the viewer's local timezone, with UTC available as secondary detail.
6. Threshold row for Idea Campaigns only.
7. Refund Policy and Fulfillment Policy links.
8. Merchant-of-record disclosure block.
9. Reserve/pre-order CTA.
10. Story / launch narrative.
11. FAQ.
12. Updates.
13. Comments where enabled.
14. Footer/legal links.

Reward-package prices are pre-tax. Before the Backer saves a card, checkout calculates and shows the reward subtotal, sales tax, and exact total authorized; the campaign page must not imply that a displayed reward price is tax-inclusive unless that is actually true for the approved configuration.

### 8.2 Merchant-of-record disclosure

Always visible above CTA:

```text
Sold by [FOUNDER LEGAL NAME] of [FOUNDER ENTITY or "sole proprietor"], [FOUNDER COUNTRY]. Proovd is the platform, not the seller.
[How this works ↓]
```

Expanded on click, implementation must preserve the substance:

- Founder is merchant of record.
- Founder is responsible for rewards and law compliance.
- Payments processed by Stripe through Stripe Connect.
- Successful pre-order charges processed on founder’s Stripe Standard connected account under preferred architecture.
- Proovd will use only the Stripe Connect payout-control configuration approved for launch; the requested direct-charge configuration and Stripe-directed backup are described on `How payments work` without claiming approval that has not yet been received.
- Proovd is software platform only and not merchant of record.
- Backer gets magic link.
- Backer can message founder about product/delivery/refunds through support form.
- Proovd acknowledges support messages within one business day, passes to founder, and follows up if founder has not responded within 48 hours.
- Platform questions go to `support@proovd.co`.

### 8.3 Idea Campaign vs Product Campaign page differences

| Element | Idea Campaign | Product Campaign |
| --- | --- | --- |
| Threshold row | Required | Hidden |
| Charge trigger | Threshold met by close | Close date |
| Reward delivery | Stated delivery window | Specific month/year, often near-term |
| Before-close cancellation | Internal pre-order canceled; saved PaymentMethod detached where appropriate | Internal pre-order canceled; saved PaymentMethod detached where appropriate; Founder notified |
| CTA | Authorize future charge if order threshold is met | Authorize pre-order charge on close date |
| Refund banner | If threshold not met, no card is charged | After close date, refund eligibility follows policy |
| Public progress display | Threshold progress acceptable | Prefer backer count/units sold, not public dollar goal |

### 8.4 Hero

Hero must be campaign-type aware.

An Idea Campaign hero may show order-threshold progress.

A Product Campaign hero should show:

- Founder/product name.
- Product logo/hero visual.
- Backer count.
- Units reserved/sold.
- Days remaining.
- Popular reward package.
- CTA to reserve pre-order.

For established product brands, the hero may default to product/startup name and logo rather than founder photo/name.

Near the primary CTA, a compact `What happens next` line must show `Card saved today → charge at [trigger] → delivery [month/year]`. It must use the selected reward amount once a tier is chosen and must never replace the full consent block.

### 8.5 Updates

Product Campaign update types in MVP:

- General announcement.
- Backer-only update.

Idea Campaign update types may include:

- General announcement.
- Backer-only update.
- Milestone/progress update.

Founders cannot post updates before campaign is live. They can post during and after campaign.

Updates can include text, images, and embedded video.

Every update displays its publication date in the viewer's local timezone and labels whether it is public or backer-only. Material delivery changes show the prior commitment and revised commitment together rather than silently replacing the original date.

### 8.6 Campaign ended state

When campaign closes naturally, is killed, or is suspended:

- Page remains accessible.
- Banner indicates status.
- Pre-order/backing actions disabled.
- New comments disabled.
- Existing comments and updates visible where appropriate.
- Magic-link views remain available for existing backers.

The ended-state banner states why the campaign ended, whether the viewer was charged, what happens next, and where existing backers can get support. It never uses one generic `Campaign ended` message for threshold miss, natural close, suspension, and kill outcomes.

---

## 9. Website, policy, and Stripe-review surface

The MVP must include the public website/policy pages Stripe expects before live Connect approval.

### 9.1 Homepage

Required structure:

- Hero.
- Value proposition.
- Narrative how-it-works.
- Trust strip above footer.
- Two role-based CTAs.
- Footer with legal entity, contact email, SLA, postal address, policy links.

Trust strip must name:

- Software platform.
- Vetted-founder crowdfunding.
- Proovd LLC, Delaware, USA.
- Manual founder vetting.
- Content creators / affiliates / marketers.
- Delivery dates on every reward.
- Cards not charged until threshold or close date.
- Stripe Connect.
- Founder Stripe Standard connected account.
- Stripe Connect payout controls requested for launch, with the final approved configuration rendered after written approval.
- Stripe-directed backup Connect configuration if required.
- Founder remains merchant of record.
- AUP mirrors Stripe Restricted Businesses list.
- Links to how payments work and safety.

### 9.2 Required public pages

MVP must ship these live routes:

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

### 9.3 Sample campaigns

Because live campaigns may not exist at Stripe application time, two sample campaigns must exist:

- `proovd.co/campaign/sample-pre-build`
- `proovd.co/campaign/sample-pre-launch`

Each sample must:

- Render full campaign UI.
- Use realistic placeholder content.
- Show reward packages.
- Show delivery date/month.
- Show merchant-of-record disclosure.
- Show the correct checkout drawer and consent text.
- Display banner: “Sample campaign — for platform demonstration. No payment information is collected.”
- Not collect real payment information.

### 9.4 Policy implementation requirement

Complete legal-policy drafts are maintained as separate canonical files and are not reproduced in this MVP. Engineering must implement the approved contents of those files on the required routes. No route may contain placeholder, “coming soon,” or summary-only copy at Stripe submission or live launch.

Before publication, the operator must complete a consistency review between those files and this MVP. Where a separate policy file still contains an older commercial or operating rule, this MVP's confirmed owner decisions control the required product behavior and the policy file must be updated before publication. In particular, the policy set must reflect the US-only, 18+ Founder/Affiliate/Backer pilot; campaign-specific recruitment and private signup; the calculated listing fee; the 72-hour mutual-locked-acceptance and three-US-business-day replacement refunds; full Checkout-total refund treatment; the 50% percentage ceiling; the §5.12 compensation matrix; fixed Creator payment funding before work and payment only after close/full completion; tax-exclusive Backer checkout using only the still-usable reservation-time calculation and exact total; immediate disclosed Founder access to Backer fulfillment/support details; practical unique-Backer Idea thresholds; Product multi-transaction rules; cause-based refunds and Affiliate adjustments; campaign-specific Founder payment schedules; the three-month Founder cooldown; and the conditional preferred/backup Stripe architecture.

Important policies/features from the legal stack:

- Terms define Proovd as platform, founder as MoR, two campaign types, listing fee, 5% platform fee, affiliate role, SetupIntent/off-session payments, dispute support, liability limit, Delaware law, support contact.
- Privacy defines role-based data collection, mandatory limited Founder sharing for fulfillment/support, separate optional Founder marketing/research/survey consent, no Affiliate PII access, Stripe/tax data sharing, rights, retention, and international transfer.
- Refund/Cancellation defines Idea Campaign (Pre-build) no-charge threshold failure, pre-close cancellation, post-payout founder-failure recovery for Idea Campaigns, Day 14 failure for Product Campaigns, ghosting, Product Campaign (Pre-launch) founder-policy refunds, delay/not-as-described disputes, listing-fee refunds, statement descriptor.
- Fulfillment defines digital-only fulfillment, delivery windows/months, communication cadence, late delivery, access mechanisms.
- Founder AUP mirrors Stripe restricted list, imposes digital-only launch restriction, sanctions reps, founder delivery reps, refund policy disclosure, communication cadence, delivery-month change process, reversal authorization, one-strike ghost ban, conflict disclosure, personal guaranty for entity founders, suspension, remedies, W-9, quarterly updates.
- Affiliate AUP defines affiliates as independent marketers, sanctions reps, audience verification, FTC disclosure, promotional standards, allowed channels, compensation structure, connected-account/Transfer/payout terms, self-pledging, active cap, non-compete, conflicts, data handling, termination, indemnification, tax compliance, suspension, re-verification, remedies, quarterly updates.
- IP Agreement defines confidentiality, non-replication, license to promotional materials, IP ownership, warranties, two-year term, remedies, Delaware law.

### 9.5 Customer support visibility

Every public page footer must include:

```text
Contact Proovd
Email: support@proovd.co
We respond within one (1) business day, Monday–Friday, excluding U.S. federal holidays.
Postal: Proovd LLC, 254 Chapman Rd, Ste 208 #27541, Newark, DE 19702, USA.

Legal
Terms of Service · Privacy Policy · Cookie Policy · Refund Policy · Fulfillment Policy · Acceptable Use Policy · Stripe Connected Account Agreement · How payments work · Safety
```

Live chat through Tawk.to is expected where implemented and visible on every page during US business hours.

### 9.6 Statement descriptors

Recommended descriptor configuration:

- Platform static descriptor: `PROOVD CAMPAIGNS`.
- Platform shortened prefix: `PROOVD`.
- Campaign descriptor: the actual descriptor computed for the Founder connected account and charge context, validated against Stripe's current character and length rules before launch.
- Listing fee descriptor: `PROOVD LISTING`.

For preferred direct charges, Founder connected-account descriptor behavior must be tested and configured to keep Backer statements recognizable. Checkout, reminders, receipts, and magic-link pages display the computed descriptor that will actually be sent for that campaign; they must not hardcode `PROOVD*[FOUNDERHANDLE]` when Stripe will render something else.

---

## 10. Payments, Stripe Connect, and ledger logic

### 10.1 Stripe architecture

One Stripe Connect platform account hosts every Proovd campaign.

Crowdfunding/marketplace processing is treated as an approval-gated capability, not an assumed self-serve entitlement. Proovd must contact Stripe Sales and obtain written alignment on the chosen Connect configuration before enabling live card collection or campaign charges. Campaign pages, sample campaigns, and non-payment interest collection may be prepared while review is pending, but real SetupIntents, live saved-card reservations, and live PaymentIntents remain disabled until Stripe has approved and enabled the selected production configuration.

Each approved founder becomes a Stripe Standard connected account under Proovd LLC’s Connect platform.

Each approved Affiliate also completes the Stripe connected-account configuration approved specifically for receiving Proovd Transfers and Stripe payouts. The Affiliate account does not process Backer card charges and is not the merchant of record. Proovd stores the connected-account ID, requirements status, transfer-capability status, and payout status, but Stripe collects the underlying identity, tax, and bank information.

Preferred architecture:

- Direct charges on founder’s Standard connected account.
- Platform-managed/manual payout controls only if Stripe confirms that capability in writing for the selected Founder account/configuration; otherwise use the Stripe-directed backup.
- The application-fee amount to Proovd includes Proovd's 5% fee plus the provisionally calculated Affiliate percentage compensation on that charge, where Stripe approves this structure. The provisional amount uses that Creator's maximum locked percentage, including a conditional Creator-specific bonus that could become payable. The amounts are separate liabilities in Proovd's ledger. The Affiliate portion is not Proovd revenue and becomes payable only after close, retry, bonus evaluation, and verification; the unearned difference returns to the Founder through the approved adjustment path.
- Founder remains merchant of record.
- Founder account expected to be debited first for refunds/disputes according to Stripe rules.
- Stripe processing fees are charged to the Founder connected account under the preferred direct-charge model and are displayed separately from Proovd and Affiliate percentages in reconciliation.
- The Founder connected account must have active Stripe Tax settings, a head-office location, product tax code(s), and every required registration before Proovd enables tax collection or a live campaign.

Backup architecture:

- Separate charges and transfers.
- `on_behalf_of` set to founder’s Connected Account where supported/approved.
- Used only if Stripe does not approve sufficient payout controls for direct charges or instructs Proovd to use platform-balance holding.
- Founder remains merchant of record contractually.
- Stripe may debit Proovd platform balance first, with founder recovery handled contractually.
- If Stripe fees initially debit the platform under the approved backup model, the Founder allocation may bear those fees only where the contract, checkout disclosures, ledger, and Stripe approval all support that treatment.

Before live mode, Stripe must confirm in writing: the Founder direct-charge context; the application-fee treatment for Proovd's fee plus Affiliate compensation; the connected-account type/capabilities for Affiliates; the later Transfer from Proovd to an Affiliate; refunds, disputes, reversals, and negative balances; tax handling; descriptors; and the separate Founder-funded fixed Creator payment path. If Stripe rejects any element, Proovd implements the approved SCT/`on_behalf_of` or other directed configuration and updates this brief before enabling the affected live function.

### 10.2 SetupIntent → off-session PaymentIntent

Reservations use this pattern:

1. Backer selects one reward package for the transaction.
2. The system verifies a US billing location and creates the approved Stripe Tax calculation for the reward, Founder connected account, and location.
3. The system stores the calculation ID, `expires_at`, reward subtotal, sales tax, and exact total authorized.
4. Backer accepts campaign-type-specific consent for that exact total.
5. Stripe SetupIntent saves the card.
6. Reservation remains active until canceled, campaign suspended/killed, threshold miss, or charge attempt.
7. At trigger, the system creates an off-session PaymentIntent for exactly the authorized total and links/reuses the reservation-time calculation only while Stripe still reports that calculation usable under the approved integration.

Trigger:

- Pre-build: on/after close only if threshold met.
- Pre-launch: on close date for all active reservations.

Why:

- Card authorizations expire after roughly a week.
- Campaigns run 14+ days.
- The implementation must use SetupIntent-based saved-payment consent that remains valid for the disclosed campaign window and retry period, subject to payment-method validity, customer mandate, current Stripe rules, and end-to-end testing. Proovd does not rely on a fixed 12-month validity promise.
- This decouples campaign launch from charge timing.
- The MVP does not recalculate tax at close and does not implement a higher-tax reconsent state. Campaign duration plus the 48-hour retry period must fit inside the calculation validity approved by Stripe and tax counsel. Before creating the PaymentIntent, Proovd validates the stored calculation and exact amount. If the calculation is expired, invalid, or cannot be linked under the approved integration, Proovd creates no charge, marks the transaction `capture_failed_dropped` with reason `tax_calculation_unusable`, notifies Backer/Founder/Admin, and never substitutes a different amount. Changing an Idea reward before close creates a new calculation and exact-total consent; the prior selection remains active unless that replacement completes successfully.

### 10.3 Reservation ledger

The campaign ledger is a reservation/charge ledger.

Every reservation record must include:

- Reservation ID.
- Campaign ID.
- Campaign type.
- Founder connected account ID.
- Unique Backer key used for Idea-Campaign threshold deduplication; hashed normalized email/phone inputs, Stripe fingerprint reference where available, device/IP risk references, suspected-duplicate case, Admin merge/separate decision, reason, actor, and timestamp are stored separately with least-privilege access.
- Backer email.
- Backer phone.
- US billing country and postal code; full billing address only where required by the approved tax/payment configuration.
- Age-confirmation timestamp and consent version.
- Reward package and SKU.
- Pre-tax reward subtotal.
- Reservation-time sales-tax amount, rate/jurisdiction, provider calculation ID, `expires_at`, timestamp, taxability reason, and close-time usability check/status. There is no MVP tax-reconsent state.
- Exact total authorized.
- Currency USD.
- Affiliate source / tracking link / organic / Proovd house.
- Attribution cookie/session data, clicked Affiliate ID, tracking-link activation time, last-valid-click time, replacement history, and same-browser/device limitation.
- SetupIntent ID.
- Payment method token reference.
- Consent text version.
- Timestamp.
- Survey responses.
- Mandatory Founder fulfillment/support sharing acknowledgment and version.
- Founder operational-data sharing time and delivery/audit status.
- Separate optional Founder marketing/research/survey opt-in.
- Newsletter opt-in.
- Reservation status.
- Cancellation status/timestamp.
- Pre-charge reminder status/timestamp and notification idempotency key.
- Close-date charge batch ID.
- PaymentIntent ID after charge.
- Charge status.
- Failed-payment retry status.
- Refund/reversal status.
- Dispute status.
- Evidence packet status.
- Cap-check result and atomic campaign active-subtotal before/after values.

Statuses:

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

Campaign-level pre-order accounting:

- A saved pre-order is purchase intent tied to a payment method and a future charge rule; it is not collected money.
- New pre-orders, cancellations, and net change are stored separately per campaign (§5.17).
- For Idea Campaigns, `threshold reached` and `threshold lost` events are recorded whenever the active total crosses the order threshold in either direction before close, each with its notification (§13.1).
- Idea Campaign threshold totals use unique Backers with one active pre-order each. Product Campaign transaction totals include every active one-reward transaction while Backer count remains unique.
- Suspected Idea-Campaign duplicates enter a pre-close Admin queue. A shared IP alone never collapses records; any merge/separate action is audited and threshold counts update idempotently.
- Founder live-page `last_seen_count`, `last_seen_at`, delivered current count, and calculated delta are stored per Founder/campaign so Glance can answer what changed (§5.17).
- `Campaign ended` and `Results ready` are separate recorded events.

### 10.4 Money waterfall, tax, and revenue streams

Every campaign charge and reconciliation uses the same calculation order:

1. `reward_subtotal` = the pre-tax price of the selected reward.
2. `sales_tax` = the approved tax calculation added on top and paid by the Backer.
3. `total_authorized` = `reward_subtotal + sales_tax`.
4. `proovd_fee` = 5% of captured `reward_subtotal` only.
5. `affiliate_commission` and Creator-specific percentage bonus = the locked percentages applied only to that Creator's captured, validly attributed `reward_subtotal`; another Creator's, organic, or house results never trigger or receive the bonus.
6. `founder_gross_share` = captured `reward_subtotal - proovd_fee - affiliate_percentage_compensation` for that transaction.
7. Stripe processing fees, refunds, disputes, and cause-based adjustments are shown separately to produce the final net balances under the approved architecture.

Sales tax is never included in the base for Proovd's 5% fee, Creator commission, percentage bonuses, the US$50,000 campaign cap, or the Idea threshold. The Founder is the seller and tax-responsible party for campaign rewards. Stripe Tax's PaymentIntent integration is the preferred calculation/reporting path. The Founder connected account must have active tax settings and required registrations; a zero-tax result caused by `not_collecting` is not treated as proof that no tax is due. Legal/tax review controls registrations, product tax codes, sourcing, filing, and Connect liability.

Three money streams must be separate in product logic, Stripe reporting, and admin reconciliation.

1. **Listing fee**
   - Founder pays Proovd.
   - Stripe Checkout on Proovd’s main platform account.
   - Proovd is merchant of record.
   - Stripe Tax enabled.
   - Descriptor `PROOVD LISTING`.
   - Refunds/disputes are Proovd direct responsibility. A qualifying `full refund` returns the entire Checkout charge actually paid, including the subtotal and associated Stripe Tax reversal/correction.

2. **Campaign application/platform fee**
   - 5% retained from successfully captured campaign charges through Connect where supported.
   - Founder is merchant of record for campaign transaction.
   - Reconciliation occurs through Connect reporting and approved balance treatment.

3. **Affiliate compensation and optional fixed Creator payment**
   - Percentage compensation derives only from successfully captured, validly attributed pre-tax reward subtotal.
   - Under the preferred approved direct-charge model, the platform-side amount on each charge contains Proovd's 5% plus provisional Affiliate percentage compensation at the maximum locked percentage applicable to that Creator, including a conditional bonus that could be earned; internal ledgers keep those amounts separate.
   - After close, retry, bonus evaluation, and verification, the earned Affiliate amount moves through the Affiliate Transfer. Any unearned base/bid/bonus amount that has not been transferred returns to the Founder connected balance through the Stripe-approved application-fee refund/adjustment path. Proovd may never reclassify an unearned Affiliate amount as platform revenue.
   - An optional fixed Creator payment is a separate Founder-funded campaign/Creator allocation and never changes the Backer charge or percentage bases.
   - Admin creates the Affiliate Transfer only after campaign close, the 48-hour retry window, and work/compliance verification.
   - Stripe connected-account, Transfer, payout, reversal, failure, and tax-reporting records are stored for reconciliation.

4. **Manual good-effort thank-you payment**
   - Optional expense paid only from Proovd's retained listing-fee revenue after listing-fee refund rights resolve.
   - Not calculated from Backer charges and not deducted from Founder or Affiliate campaign balances.
   - Created manually through the Stripe-approved recipient/Transfer path only after separate Admin approval and tax/accounting confirmation; otherwise no payment is promised or sent.
   - Recorded as Proovd-funded recognition, not commission, platform liability, or guaranteed Creator earnings.

### 10.5 Campaign close batch

The three controlling timestamps are:

- `listing_paid_at`: begins the 72-hour Affiliate-response/refund window and the Founder's 48-hour free-cancellation period, provided the campaign is not live.
- `campaign_live_at`: begins campaign Day 1, Days 1–7 direct-link-only discovery treatment, Day 8 public discovery eligibility, Creator active-slot use, and live-campaign obligations.
- `campaign_close_at`: ends Backer cancellation and Affiliate joining, fixes the Idea threshold, starts the charge batch and 48-hour retry window, and anchors Day 3 and Day 14 reviews.

At `campaign_close_at`, the system must:

- Lock active reservations.
- Exclude canceled reservations.
- For an Idea Campaign, evaluate the threshold from unique Backers with active pre-orders.
- If threshold is not met, close reservations as no-charge, detach saved PaymentMethods where appropriate, and send no-charge emails. A successful SetupIntent remains a historical Stripe record; Proovd does not attempt to cancel it after success.
- If trigger met, create off-session PaymentIntents for all active reservations.
- Before each PaymentIntent, verify that its stored reservation-time Tax calculation remains usable, belongs to the correct Founder/reward/location, and supports the exact previously authorized total. An unusable calculation produces no PaymentIntent and the explicit `tax_calculation_unusable` drop outcome; there is no close-time recalculation or reconsent branch in MVP.
- Apply statement descriptor logic.
- Apply platform/application fee logic where supported.
- Store PaymentIntent IDs and outcomes.
- Send receipt to successful charges.
- Send failed-payment update-card email to failed charges.
- Open the fixed 48-hour retry window for failed charges.
- Recalculate final collected amount after retry window.
- Preserve an Idea Campaign's successful threshold outcome even when payment failures reduce the amount ultimately collected.
- Finalize base/bid percentages and Creator-specific bonus eligibility only from that Creator's captured attributed pre-tax reward subtotal or captured attributed-Backer count after the retry window, return every unearned provisional difference once, then route Founder-payment and Affiliate-Transfer decisions for recorded Admin approval.

### 10.6 Fraud and risk checks

MVP must support/admin-surface:

- Stripe Radar on every PaymentIntent.
- Normalized email/phone duplicate checks, Stripe payment-method fingerprint where available, and device/IP risk flags for Idea-Campaign threshold review. A shared IP alone never collapses Backers.
- A pre-close suspected-duplicate queue with audited Admin merge/separate decisions and idempotent threshold updates.
- Any single reservation larger than highest reward-tier price flagged for review before close-date charge.
- Click-fraud checks.
- Suspicious conversion spikes.
- Affiliate self-pledge flags.
- Duplicate affiliate account flags.
- Founder/affiliate relationship disclosures.
- Sanctions/OFAC flags where available.
- Manual admin review before capture where necessary.

---

## 11. Outcome, payout, refund, and fulfillment logic

### 11.1 Idea Campaign (Pre-build) outcome logic

At close:

If order threshold not met:

- No cards are charged.
- Internal reservations close as `threshold_not_met_no_charge`; saved PaymentMethods are detached where appropriate. Successful SetupIntents remain immutable historical records.
- Backers receive confirmation.
- Founder receives validation data.
- Campaign closes as below-threshold/no-charge.

If order threshold met:

- Active reservations are captured by off-session PaymentIntent.
- The success decision remains fixed from the unique active-Backer count at close; later card failures do not reverse it.
- Failed cards enter the 48-hour retry window.
- Captured amount becomes subject to the disclosed payment schedule and controls.
- Founder and Creators proceed on the amount actually collected after the retry window.
- The founder becomes eligible for the single Founder payment — 100% of the eligible share — at Day 3 once §11.3 requirements are met, then builds and delivers under the post-close review and enforcement process.

### 11.2 Product Campaign (Pre-launch) outcome logic

At close:

- Every active one-reward transaction is charged; a Backer may have multiple transactions.
- Failed cards enter the 48-hour retry window.
- Whatever is successfully collected is the campaign result.
- Missing internal target does not trigger refunds.
- Founder still proceeds with fulfillment.
- Creator commissions finalize after the 48-hour retry and work/compliance verification.
- Performance bonuses trigger only if their own captured pre-tax thresholds are met.

### 11.3 Founder payment schedule

The founder payment schedule is real and publicly disclosed even if full payment-status UI is deferred. The schedule is campaign-specific.

**Idea Campaign — single Founder payment:**

- If the order threshold was met, 100% of the eligible Founder share from charges successfully collected during the close batch and 48-hour retry window becomes payable at Day 3 post-close.
- Requirements: close-date charge/retry process complete, W-9 on file, payment/risk checks passed, and recorded admin approval.
- There is no second Idea-Campaign payment and no 40/60 split.
- Any later progress review concerns fulfillment, communication, refunds, risk, or enforcement — not the release of another payment.

**Product Campaign — first payment and remaining payment:**

- **First payment:** 40% at Day 3 post-close, after close-date charge/retry process and W-9 on file.
- **Remaining payment:** 60% at Day 14 post-close by default. It may become releasable earlier, but never before first-payment eligibility at Day 3, only after admin verifies actual delivery or live access for the promised reward, confirms that backer communications have been sent, confirms no immediate refund/fraud/fulfillment red flags, and records the evidence and decision. A product merely being “ready” internally is insufficient; the backer-facing promise must be fulfilled or actively available.

Under preferred architecture, funds become payout-eligible through Stripe-approved controls. Under backup architecture, unpaid founder share may remain on Proovd’s Connect platform balance until transfer.

For both campaign types, `eligible Founder share` follows the §10.4 waterfall: captured pre-tax reward subtotal minus Proovd's 5%, Affiliate percentage compensation, applicable cause-based adjustments, and the Stripe fees allocated to the Founder under the approved architecture. Sales tax is shown separately and is never divided among Proovd, Founder, or Affiliate as campaign revenue.

### 11.4 W-9 block

Before any Day 3 founder payment:

- Founder is prompted to submit W-9 immediately after close.
- Deadline is Day 3.
- Missing W-9 blocks every founder payment: the Idea Campaign single Founder payment, and both the Product Campaign first payment and remaining payment.
- Admin can see W-9 status.
- Founder sees payout blocked status.

### 11.5 Day 14 Progress Check

Admin performs a Day 14 Progress Check on every campaign.

For a Product Campaign whose remaining payment was released early under Section 11.3, the documented early-fulfillment review substitutes for the Day 14 release decision but does not remove the founder's continuing delivery, refund, support, communication, dispute, or ghost-ban obligations. Admin still performs a Day 14 status check and records any new red flags.

For an Idea Campaign, the Day 14 Progress Check is an enforcement and monitoring review, not a payment-release gate: the single Founder payment has already become payable at Day 3 where requirements were met, and the check concerns fulfillment, communication, refunds, risk, and enforcement.

Founder passes if they submit adequate evidence of progress/delivery and maintain communication. For Product Campaigns, this can mean confirming that the new feature/reward access has shipped or that backers have their access according to disclosed commitment.

Failure conditions:

- No adequate evidence of progress.
- No substantive campaign update in preceding seven days.
- Unreachable for admin clarification within five business days.
- Material delivery-month bait-and-switch.
- Ghosting.

If fail:

- For a Product Campaign, the remaining payment is not released, and remaining/restricted funds are refunded/reversed pro-rata where possible; Proovd attempts reversal against the released first payment on a best-effort basis where applicable.
- For an Idea Campaign, there is no unreleased payment to withhold; recovery is refund, reversal, dispute, or contractual recovery on a best-effort basis.
- Founder is one-strike ghost banned.

### 11.6 One-strike ghost ban triggers

Founder is permanently banned if:

- Fails Day 14 Progress Check.
- Goes silent for 30+ consecutive days post-payout.
- For Product Campaigns, misses disclosed delivery month by more than 30 days without updated timeline and required approval/notice.
- For Idea Campaigns, fails to deliver by end of disclosed window and fails to communicate updated timeline within 30 days.

### 11.7 Delivery-month changes

For Product Campaigns:

Before the remaining payment releases:

- Founder must request admin approval before notifying backers.
- Admin reviews within five business days.
- Admin evaluates bait-and-switch risk.
- Request may affect Day 14 check.

After the remaining payment releases:

- Founder must notify backers through campaign update before originally disclosed month passes.
- Admin approval not required.
- Founder remains subject to ghost-ban rules.

### 11.8 Refunds and cancellation

Before close:

- Backer cancels: Proovd cancels the internal reservation, prevents a PaymentIntent from being created, and detaches the saved PaymentMethod where appropriate. A successful SetupIntent remains in Stripe history; no refund is needed because no charge occurred.
- Campaign killed before capture: Proovd closes every active internal reservation as no-charge, prevents PaymentIntent creation, and detaches saved PaymentMethods where appropriate.

Idea Campaign threshold miss:

- No charge; no refund needed.

Idea Campaign after a successful charge:

- There is no voluntary or change-of-mind refund merely because the Backer later changes their mind or the early-stage product takes time to build.
- A correction/refund remains available for a duplicate charge, wrong amount, charge after valid cancellation, unauthorized transaction, material campaign misrepresentation, applicable non-delivery, a campaign killed for a serious violation, or any refund required by law, Stripe, or the card issuer.
- The single Founder payment may already have been released at Day 3. Recovery beyond an available Founder balance is best-effort reversal, dispute handling, or contractual recovery; Proovd does not promise that released funds are always recoverable.

Product Campaign post-charge refund:

- The Founder's campaign-specific policy controls voluntary refunds, subject to non-waivable law, card-network/Stripe rules, and Proovd's platform policy.
- The operative policy may originate on the Founder's website, but the exact text or an immutable snapshot, URL, version, and effective date must be preserved in Proovd, shown or directly linked on the campaign and checkout, and stored with the Backer's consent. The Founder cannot retroactively replace the policy for an existing transaction.
- The Founder is MoR, issues and bears the refund through the connected-account/approved flow, and remains responsible when the policy or law requires it. Proovd can intervene if the Founder does not honor the recorded policy.

Refund allocation and Affiliate earnings:

- A routine Founder/product-caused refund does not create an Affiliate clawback. Finalized or transferred valid Affiliate earnings remain with the Affiliate; unfinalized earnings on the refunded transaction may be canceled. The Founder bears the refund. Proovd keeps its 5% unless Proovd elects, Stripe requires, or law requires a fee return.
- If Affiliate fraud, fake traffic, self-dealing, false claims, invalid proof, or material breach caused the charge, refund, or dispute, unpaid earnings are canceled. Already transferred earnings create a negative balance and contractual recovery claim against that Affiliate.
- If Proovd's own system or operational error caused the problem, Proovd corrects it and returns its fee where appropriate; the Affiliate is not debited unless the Affiliate contributed to the cause.
- A Backer dispute unrelated to Affiliate conduct follows the Founder/MoR charge context. A finalized Affiliate earning remains valid unless evidence shows the Affiliate caused the disputed transaction.
- Signed checkout consent, campaign copy, policy version, reminder, receipt, delivery evidence, and support history are dispute evidence. They do not waive legal, card-network, Stripe, or card-issuer rights.

Late delivery:

- Founder/backer issue by default for Product Campaigns.
- Proovd facilitates communication.
- Ghost-ban triggers apply if founder goes silent or misses disclosed delivery by 30+ days without update.

Not-as-described/defective:

- Backer contacts founder first through magic-link support form.
- If no response within 14 days or no resolution, backer can escalate to Proovd.
- Proovd mediates.
- If unresolved, backer retains right to dispute with card issuer.
- Proovd packages and submits evidence within 24 hours of dispute notification.

### 11.9 Listing fee refunds

Listing fee refund rules:

- No-acceptance outcome within the disclosed 72-hour formal response window, which begins at successful listing-fee payment: full refund of the entire listing-fee Checkout charge actually paid. This includes both zero eligible campaign-specific recruits and eligible recruited Affiliates receiving the actionable opportunity but no Creator and Founder mutually accepting the same locked compensation version within the window. A pending proposal is not acceptance and never pauses or extends the deadline. No fixed deduction applies. Recruitment and signup may occur earlier; the clock begins only when the paid Founder's formal opportunity becomes actionable.
- If the accepted launch Creator withdraws, becomes ineligible, or cannot launch before `campaign_live_at`, Admin records `creator_failure_recorded_at`. The three-business-day replacement window begins at that timestamp and ends at a stored due timestamp calculated under the configured US business-day calendar and timezone. Proovd must make a replacement Creator fully ready by that deadline. If no replacement is ready, the Founder receives a full refund of the entire listing-fee Checkout charge actually paid and the campaign enters `refunded_no_creator`.
- Founder cancellation within 48 hours of `listing_paid_at`, before live: full refund of the entire listing-fee Checkout charge actually paid.
- Founder cancellation after that 48-hour window: no automatic refund; Admin discretion.
- Campaign killed by Proovd/AUP: no entitlement to refund; admin discretion.
- Successful campaign/natural close: listing fee not refunded regardless of outcome.
- For every qualifying `full refund`, the refunded amount includes the listing-fee subtotal plus the associated sales-tax reversal/correction under Stripe Tax; it is not subtotal-only. Refund method: direct Stripe refund to the original payment method, typically 5–10 business days.

### 11.10 Founder cancellation

Founder can cancel free within 48 hours of `listing_paid_at` if the campaign has not gone live.

After that, cancellation requires admin approval.

If cancellation occurs before close-date charge:

- No backer was charged.
- Internal reservations are closed, future PaymentIntent creation is blocked, and saved PaymentMethods are detached where appropriate. Successful SetupIntents remain historical Stripe records.
- No backer refund required.
- A funded optional fixed Creator payment has not yet been transferred. It returns to the Founder unless every agreed deliverable was already completed and Admin determines the payment was earned under the accepted terms. Genuine commission remains based only on compliant, attributed, successfully captured charges; before-close cancellation normally means no commission exists.

If cancellation occurs after charges:

- Admin handles refunds/reversals according to policy and Stripe rules.
- Affiliate compensation follows the cause-based §11.8 rules and the completion rules in §6.10; cancellation alone does not manufacture a fixed payment or automatically claw back finalized valid earnings.

### 11.11 Fulfillment

Digital fulfillment is complete when founder provides agreed access mechanism to backer email:

- Login credentials.
- Download link.
- Redemption code.
- Beta enrollment.
- API key.
- Invite/access code.
- Course/book/digital file delivery.

Founder must:

- Send campaign-close confirmation update within 48 hours.
- Post update at least every 30 days from charge to delivery.
- Send delivery notification when access is granted.

Backers receive satisfaction survey after delivery.

---

## 12. Admin panel

The admin panel is the operational core of the MVP.

Admin records are populated automatically from invitation records, Founder and Affiliate signup, vetting, campaign building, Stripe connected-account updates, Backer checkout, tracking, and webhooks. Admin adds review notes, evidence, overrides, and decisions; Admin must not re-enter data that the user or Stripe already supplied. Every manual override stores actor, time, reason, prior value, and new value.

### 12.1 Admin users dashboard

Tabs:

- Founders.
- Affiliates/distribution partners.
- Backers/reservations.
- Admins if needed.

Founder row shows:

- Name.
- Email.
- Invitation status: sent date, named sender, invitation source, and draft-link status (active/claimed/revoked).
- Signup date.
- Country/state.
- Identity status.
- Stripe connected account status.
- W-9 status if applicable.
- Campaign count/history.
- Ready-for-next-campaign flag.
- One-strike ban status.

Founder invitation controls:

- Create, send, resend, and revoke personalized invitations with secure temporary-draft links (§5.1).
- View each invitation record: recipient, named sender, sent time, invitation source, draft-link status, and claim status.

Affiliate row shows:

- Name.
- Email.
- Channel type.
- Niche.
- Audience metric.
- Verification status.
- Quality tier.
- Active partnership count.
- AUP acceptance status.
- W-9/payout status.
- Date-of-birth/country/state eligibility status.
- Stripe connected-account ID, requirements status, transfer capability, and payout status.
- Suspension status.
- Campaign-specific invitations and their states.
- Joined-at and tracking-link activation time per campaign.

### 12.2 Campaign-specific affiliate recruitment and verification

Admin can create a campaign-specific affiliate prospect, send the private signup invitation, and record:

- Full legal name.
- Email.
- Phone.
- Channel type.
- Handle / URL / community / course / network.
- Follower/subscriber/member/download/enrollment metric.
- Engagement / CTR / DAU / rating.
- Audience niche.
- Audience demographics where available.
- Verification evidence.
- Admin-written bio.
- Quality tier.
- Notes.
- Associated founder and campaign.
- Recruitment source and recruiting admin.
- Invitation status and sent time.
- Affiliate signup status.
- Whether the affiliate is intended for the initial launch roster or recruited after launch.

Admin can send, resend, or revoke the private campaign-specific invitation. The affiliate creates or claims their own account through that invitation; there is no generic credential email or public signup.

### 12.3 Campaigns dashboard

Statuses:

- `invited_draft` — secure temporary draft open; no account yet.
- `vetting_submitted` — three core answers submitted; campaign type locked.
- `account_claimed` — also emits `founder_signup_complete` and exposes the preparing campaign to pre-associated affiliates.
- `stripe_onboarding_pending`
- `listing_fee_pending`
- `affiliate_response_and_build` — formal affiliate response window and campaign building running after successful payment, tracked through the separate fields below.
- `pending_review`
- `changes_required` — review completed with required corrections; the existing build is preserved for resubmission. Each correction is classified non-material or material to Creator terms, and affected Creator readiness remains invalid until any required reacceptance completes.
- `approved`
- `creator_prep` — optional fixed Creator payment funding, readiness, draft preparation, and coordinated launch scheduling in progress.
- `creator_replacement` — a required pre-launch Creator failed; `creator_failure_recorded_at` and the exact US-business-calendar replacement due timestamp are stored and the three-business-day replacement window is running.
- `refunded_no_creator` — no replacement became launch-ready in time and the listing fee was fully refunded.
- `live`
- `closed_pending_capture`
- `capture_retry_window`
- `closed_reconciling` — the 48-hour retry window and Founder/Creator earnings reconciliation are incomplete.
- `captured_pending_w9`
- `single_payment_released` — Idea Campaigns only.
- `first_payment_released` — Product Campaigns only.
- `day_14_review`
- `remaining_payment_released` — Product Campaigns only.
- `fulfilled`
- `closed_resolved` — charge, retry, Creator Transfer, Founder-payment, refund/adjustment, and required close records are reconciled; fulfillment may remain separately active where applicable.
- `ended_no_charge`
- `suspended`
- `killed`
- `banned_founder`

Parallel-track fields (§5.15): `affiliate_roster_status` and `campaign_build_status` are stored separately. `review_ready` is derived only when the initial affiliate roster is `launch_ready` and campaign building is `complete`. Additional affiliates added after launch do not reset `review_ready` or reopen review unless their addition requires a material public-campaign change.

Payment and reconciliation are separate flags rather than overloaded campaign states: `retrying`, `founder_payment_eligible`, `founder_payment_paid`, `affiliate_earnings_adjusted`, `affiliate_transfer_eligible`, and `affiliate_transfer_paid`. Their timestamps, amounts, evidence, actor, and Stripe object IDs are stored independently.

Campaign detail shows:

- Founder profile.
- Connected account ID/status.
- Campaign type and permanent lock timestamp; if the type was wrong, the archived campaign and replacement-campaign link (§5.2).
- Temporary draft ID, invitation record, and per-field prefill provenance (§5.3, §14.2).
- Vetting form.
- High-effort status with its three qualifying inputs, calculated result, calculation time, and recording actor/system (§5.8).
- Founder interview booking record (§5.7).
- Listing fee calculation, charge, and refund.
- Creator compensation records per the §5.12 matrix: base percentage, accepted bids, optional fixed Creator payment requests and decisions.
- Creator-specific bonus trigger unit, threshold, maximum percentage, current progress, earned result, and proposal version.
- Affiliate roster.
- Campaign-specific recruitment, invitation, signup, preparing-state visibility, formal-response, joined-at, and tracking-link activation records.
- Commission rates.
- Fixed Creator payment allocations, funding, completion, return, eligibility, Transfer, and payout status (§6.10).
- Provisional Affiliate percentage liability per captured charge at the maximum locked base/bid/bonus percentage, the verified earned amount, the amount transferred, and any unearned/untransferred amount returned to the Founder through the approved application-fee adjustment path.
- Counter-offers.
- Reward packages.
- Delivery dates.
- Refund-policy text/snapshot, source URL, version, effective date, and consent linkage.
- Brand notes.
- Order threshold/internal target.
- Reservations ledger.
- Reward subtotal, reservation-time sales tax, exact total authorized/captured, Tax calculation ID/expiry/usability check, and reconciliation records; no close-time reconsent field exists.
- Unique-Backer key inputs/references, suspected-duplicate cases, audited merge/separate decisions, threshold count, multi-transaction Product totals, and atomic US$50,000 aggregate pre-tax active-pre-order cap checks.
- Founder live-page last-seen count/time, delivered count, delta, and refresh timestamp.
- Charge batch status.
- Failed-payment retries.
- Comments.
- Updates.
- Support tickets.
- Risk flags.
- Founder payment schedule status: single Founder payment (Idea) or first/remaining payments (Product).
- Payout/release records.
- Creator-readiness checklist state (§5.16).
- Review-change materiality, affected fields/Creators, prior/new version, and Creator reacceptance status.
- `creator_failure_recorded_at`, replacement due timestamp, business-day calendar/version, replacement outcome, and listing-fee subtotal/tax/total refund objects.
- Post-campaign work-again requests (§6.17).
- Disputes.

### 12.4 Campaign association and affiliate activation

Admin associates each recruited affiliate/distribution partner with the specific campaign for which they were recruited. The association may be created before founder signup completes, during the formal response window, or after launch.

Each campaign-affiliate association records:

- Campaign.
- Affiliate.
- Proposed base commission per the §5.12 matrix: 30%, or 20% with an accepted optional fixed Creator payment.
- High-effort bid eligibility and any submitted percentage bid.
- Creator-specific performance-bonus terms: trigger unit, attributed threshold, additional percentage, maximum combined percentage, and proposal version.
- Optional fixed Creator payment request and decision record (Product Campaigns only).
- Required post count.
- Minimum click threshold for thank-you eligibility.
- Disclosure template.
- Status.
- Counter-offers.
- IP agreement acceptance.
- AUP acceptance.
- Tracking link.
- Recruitment timing: pre-founder-signup / pre-launch / mid-campaign.
- Invitation sent, affiliate signup, `founder_signup_complete` visibility, formal-opportunity activation, acceptance, joined-at, and tracking-link activation timestamps.
- Private pre-accept Campaign-kit access time, revocation state, and pilot-exception audit record.
- Initial-launch-roster or mid-campaign designation.
- Remaining-time deliverables for a mid-campaign addition.

Creating or updating an initial-roster association updates `affiliate_roster_status` (§12.3). A mid-campaign association is tracked independently and does not change a completed initial-roster status.

### 12.5 Creator proposal and counter-offer management

The Founder receives Creator proposals — percentage bids and optional fixed Creator payment requests — directly and accepts, declines, or proposes a revision. Admin observes and mediates rather than being the only decision surface.

A founder-suggested revision creates a new proposal version with status `awaiting_creator`. It is not accepted and cannot be funded until the creator explicitly accepts that same version. Only a proposal version explicitly accepted by both parties may lock or affect compensation.

The exact formal-response deadline is visible in every proposal. A pending proposal does not pause or extend it. At the deadline, any proposal without mutual acceptance closes as `expired_no_acceptance`; it cannot make the roster launch-ready or prevent the §11.9 refund.

Admin can:

- View every proposal, bid, fixed-payment request, and decision with timestamps.
- Mediate or adjust a proposal where policy requires.
- View the complete version history and prevent stale or superseded versions from being accepted.
- Enforce the §5.12 matrix bases, the high-effort bid eligibility rule, and the 50% total-percentage ceiling.
- Enforce Creator-specific bonus measurement and ensure the maximum locked base/bid/bonus percentage is provisioned without exceeding 50%.
- Lock only the final mutually accepted terms per creator.
- Confirm the Founder's full fixed-payment funding before that Creator begins work (§6.10).

### 12.6 First-post and deliverable verification

Creators submit public post links for verification (§5.16). Admin can:

- Record each creator-submitted public link with its submission time.
- Verify the channel/account is the approved one and the post is publicly accessible.
- Verify disclosure language.
- Verify brand notes compliance.
- Verify no prohibited claims.
- Verify agreed terms against the actual published content.
- Record first-post verification for attribution validity and compliance without releasing money; verification does not cause or gate the already-scheduled campaign-page activation.
- At campaign close, verify every agreed deliverable, required availability period, any formal waiver, and fixed-payment completion eligibility (§6.10).
- Finalize the full fixed Creator payment together with commission only after the 48-hour retry window and all completion checks pass.
- Mark noncompliant and request correction.
- Flag serious breach.

For coordinated Creator launch, Admin schedules the exact launch time. At that time the approved campaign page activates first, scheduled tracking links activate and resolve to it, Creators publish, and Admin verifies submitted public links as they appear. A Creator cannot begin work before the §5.16 readiness gate is complete. A correction-needed or rejected post pauses that Creator's link and blocks invalid earnings from finalizing; it does not reverse the campaign launch. First-post verification never releases a fixed Creator payment.

### 12.7 Reservation / charge ledger

Admin can filter/export by:

- Campaign.
- Founder.
- Affiliate source.
- Organic/house.
- Date range.
- Reservation status.
- SetupIntent status.
- PaymentIntent status.
- Failed-payment status.
- Refund/dispute status.
- Consent version.
- Opt-in status.
- Unique Backer versus transaction count.
- Unique-Backer duplicate-review state and audited merge/separate outcome.
- Reward subtotal, reservation-time sales tax, total authorized, total captured, calculation expiry, and close-time usability status.
- Last-valid Affiliate attribution and tracking-link activation time.
- Campaign-cap check.

### 12.8 Affiliate Transfers and payouts

Admin sees:

- Affiliate.
- Stripe connected-account ID, requirements, and transfer capability.
- Finalized commission, Creator-specific bonus, optional fixed Creator payment, and total approved amount.
- Earnings source.
- Work/compliance verification and adjustment reason.
- Transfer ID, amount, creation date, status, reversal ID where applicable, and idempotency key.
- Stripe payout status and failure reason where available.
- Status: estimated / finalized / approved for transfer / transferred / paid out / payout failed / adjusted.
- Notes.

Manual good-effort thank-you payments appear in a separate Proovd-expense record, not the campaign earnings total. The record shows retained-listing-fee availability, discretionary reason, approval, amount, recipient, Stripe object/status, tax/accounting treatment, and timestamp. Admin may initiate it manually only through the approved Affiliate recipient/Transfer path after listing-fee refund rights resolve. It is never shown as estimated or guaranteed earnings.

Admin approves and creates the campaign-specific Stripe Transfer after close and reconciliation. The Affiliate does not request a withdrawal or enter a payout destination in Proovd; Stripe owns bank, tax, and payout updates.

### 12.9 Milestone / payout controls

Admin panel must track, even if Stripe action is manual:

- Captured amount.
- Pre-tax reward subtotal, sales tax, and total captured shown separately.
- Founder share.
- Proovd 5% fee.
- Affiliate base/bid commission and Creator-specific bonus, including the trigger evidence.
- Provisional Affiliate percentage amount at the maximum locked base/bid/bonus percentage, verified earned amount, Affiliate Transfer, and any return-to-Founder application-fee adjustment; none of the provisional Affiliate amount is recorded as Proovd revenue.
- Manual Proovd-funded thank-you payment record, where separately approved; it is never netted into Founder share or campaign application fees.
- Fixed Creator payment funding, completion, return, eligibility, Transfer, and payout status per Creator (§6.10).
- W-9 status.
- Idea Campaign: single Founder payment (100% at Day 3) eligibility, recorded admin approval, and release action/status.
- Product Campaign: Day 3 first-payment eligibility and release action/status.
- Day 14 Progress Check evidence.
- Day 14 pass/fail.
- Product Campaign early-fulfillment evidence and approve/reject decision, where applicable.
- Product Campaign remaining-payment release/refund/reversal action/status.
- Founder ban status.

### 12.10 Disputes and evidence

Admin can assemble evidence packet containing:

- Consent text version.
- Campaign page disclosures at reservation time.
- Reward package selected.
- Reward subtotal, sales tax, total authorized, and billing-location evidence used for tax calculation.
- Delivery date disclosure.
- SetupIntent record.
- PaymentIntent record.
- Timestamp.
- Survey responses.
- Refund-policy text/snapshot, source URL, version, effective date, and campaign/consent references.
- Fulfillment/delivery record.
- Communication/support log.
- Founder updates.

Admin submits evidence to Stripe within 24 hours of dispute notification.

### 12.11 Kill / suspend switch

Admin can suspend or kill campaign for:

- TOS/AUP violation.
- Fraud.
- Founder request.
- Stripe risk escalation.
- Deceptive marketing.
- Metrics manipulation.
- Sanctions/regulatory concern.
- Other.

Action requires reason dropdown and free-text explanation.

If pre-capture:

- Internal reservations are closed, future PaymentIntent creation is blocked, and saved PaymentMethods are detached where appropriate. Successful SetupIntents remain in Stripe history.
- Backers are not charged.
- Notifications sent.

If post-capture:

- Admin follows refund/reversal policy.
- Remaining held/restricted funds are refunded/reversed where possible.
- Founder/affiliates/backers notified as appropriate.

Campaign page remains accessible with ended/suspended/killed banner.

### 12.12 Settings

Global settings:

- Listing fee base, US$35.
- Optional-item discount amounts, US$2 each for Visuals, Branding, confirmed interview booking, Story, and Socials; maximum savings US$10.
- Listing fee minimum, US$25.
- Promotional discounts.
- Platform fee percentage, default 5%.
- Base commission percentages: 30% standard; 20% with an accepted Product Campaign optional fixed Creator payment.
- High-effort criteria inputs: Visuals, Branding, scheduled/confirmed interview — all three absent means high effort (§5.8).
- Maximum commission ceiling, 50%.
- Interview scheduling settings: meeting providers (Google Meet, Zoom, Microsoft Teams), slot availability, and reminder lead times (§5.7).
- Default required post count, 3.
- Campaign duration min/max.
- Product Campaign default duration, recommended 14 days unless overridden by approved campaign configuration.
- Campaign cap, US$50,000 in aggregate pre-tax active-pre-order value, enforced atomically.
- Failed-payment retry window, fixed at 48 hours.
- Pre-charge reminder lead time, default approximately 24 hours before the disclosed trigger.
- No-acceptance refund window, 72 hours from successful listing-fee payment, when the formal opportunity becomes actionable for eligible campaign-specific affiliates.
- Founder repeat-campaign cooldown, fixed at a minimum of three months for MVP.
- Support SLA.
- Founder payment schedule settings: Idea Campaign single payment at Day 3; Product Campaign first payment Day 3 and remaining payment Day 14.
- Product Campaign early remaining-payment release control, disabled by default and requiring recorded admin evidence and approval.
- Creator replacement window, fixed at three business days before `campaign_live_at`.
- Admin MFA enforcement and reauthentication window for money, refund, connected-account, and kill/suspend actions.

### 12.13 Customer timeline and service workspace

To keep manual service from feeling fragmented, admin must have one chronological, read-only timeline per campaign/reservation that combines existing records rather than creating a new messaging system.

The timeline shows, where applicable:

- Invitation, temporary-draft, account-claim, and verification events.
- Interview booking, reschedule, and cancellation events.
- Campaign status and review feedback.
- Affiliate recruitment, campaign-specific invitation, signup, Stripe onboarding, Founder-signup visibility, formal-opportunity activation, acceptance, mid-campaign addition, bid/fixed-payment proposal, fixed-payment funding, first-post, deliverable-verification, earnings-finalization, Transfer, and payout events.
- Pre-order, tax calculation, consent, cancellation, SetupIntent, capture, 48-hour retry, refund, and dispute events.
- Threshold reached/lost events for Idea Campaigns.
- Transactional emails sent, delivery status where available, and notification suppression/deduplication reason.
- Support case ID, category, owner, SLA due time, last response, and next promised update.
- Founder updates, delivery evidence, payment-release decisions, and admin actions.
- Post-campaign work-again request events.

Low-effort service requirements:

- Support replies start from editable templates but are never locked to a canned response.
- A reply carries the campaign, reservation, charge, and prior case context so the customer is not asked to repeat information already in Proovd.
- Admin sees overdue badges for a missed one-business-day response or a missed customer-facing next-update promise.
- Every internal reason code has a separate plain-language customer explanation; raw fraud/provider language is not pasted into customer communications.
- Before sending a high-impact email, admin can preview it as the recipient will see it, including amounts, dates, seller name, descriptor, and primary action.
- Duplicate webhook/job delivery must not create duplicate customer notifications, not only duplicate money records.

---

## 13. Notifications and email

### 13.1 Transactional emails

Always sent; not opt-out-able.

Every transactional email uses a specific subject, repeats the relevant campaign/product name, includes one primary action at most, shows a plain-text support route, and carries a stable case/reservation/campaign reference in the footer. Dates use the recipient's local timezone when known and include UTC when timing affects a charge or deadline. Emails that report money movement state the amount, seller/MoR, descriptor, and whether the action is pending or completed.

There are no automatic scheduled "check your campaign" emails. A notification fires only for an actual required action, a verified consequence, a payment event, a threshold change, campaign end, or an available result.

Founder/account:

- Personalized invitation with secure temporary-draft link (§5.1).
- Email verification (future public onboarding route).
- Password reset.
- Interview booking confirmation, reminder, reschedule, and cancellation (§5.7).
- Stripe onboarding prompt.
- Listing fee receipt.
- Listing fee refund.
- Formal affiliate response window started (successful listing-fee payment).
- Campaign-specific affiliate roster updates.
- Mid-campaign affiliate proposed/accepted/activated.
- Creator proposal received (percentage bid or optional fixed Creator payment request).
- Affiliate partnership confirmed.
- Campaign submission received with review owner and next-update date.
- Campaign approved.
- Campaign rejected with feedback.
- Fixed Creator payment funding request and confirmation, where applicable.
- Campaign live.
- Threshold reached (Idea Campaigns).
- Threshold lost (Idea Campaigns).
- Campaign ended.
- Results ready.
- W-9 prompt.
- W-9 blocking notice.
- Single Founder payment released/blocked (Idea Campaigns).
- First payment released/blocked (Product Campaigns).
- Day 14 Progress Check request.
- Day 14 pass/fail.
- Product Campaign early-fulfillment review requested/passed/rejected, where applicable.
- Remaining payment released/blocked/refund triggered (Product Campaigns).
- Campaign killed/suspended.
- Ready-for-next-campaign admin flag.
- Work-again request response: accepted or declined (§5.18).

Affiliate:

- Campaign-specific signup invitation.
- Signup confirmed; waiting for founder where applicable.
- Founder signup completed; preparing campaign available.
- Formal campaign opportunity available after listing-fee payment.
- Proposal (percentage bid/fixed-payment request) update and Founder decision.
- Campaign accepted/declined.
- Disclosure template available.
- Fixed Creator payment funded; work may begin once readiness items are complete (§5.16).
- First-post verification passed/failed.
- Fixed Creator payment completion approved/declined after campaign close.
- Campaign live.
- Mid-campaign invitation or activation, including remaining dates and adjusted deliverables.
- Campaign closed.
- Campaign contribution/thank-you recap.
- Commission finalized.
- Stripe Transfer created, creation failed, updated, or reversed.
- Stripe payout paid/failed where available.
- Stripe connected-account information required.
- Suspension/warning.
- Policy re-acceptance required.
- Work-again request from a previous founder (§6.17).

Backer:

- Pre-order confirmation.
- Pre-charge reminder approximately 24 hours before the trigger.
- Pre-order cancellation confirmation.
- Threshold not met / no charge.
- Close-date charge receipt.
- Failed payment / update card.
- Retry success.
- Retry failed / pre-order dropped.
- Refund processed.
- Founder support message received.
- Founder response/follow-up.
- Campaign updates digest.
- Delivery notification.
- Satisfaction survey.
- Campaign suspended/killed.
- Magic-link reissue confirmation where secure resend is implemented.

Admin/internal:

- Invitation claimed / new founder signup.
- Interview booked, rescheduled, or canceled.
- Listing fee paid; formal affiliate response window started.
- Campaign submitted.
- Creator proposal (percentage bid/fixed-payment request) awaiting decision.
- Fixed Creator payment funding received.
- First-post verification required.
- Deliverable and fixed-payment completion verification due after close.
- Threshold reached/lost (Idea Campaigns).
- Close-date charge batch completed.
- Failed-payment spike.
- 48-hour reconciliation complete; Creator Transfer and Founder payment decisions due.
- W-9 missing at Day 3.
- Day 14 check due.
- Dispute received.
- Risk flag.
- Work-again request submitted.
- Mid-campaign affiliate invitation, acceptance, readiness, and tracking-link activation.

### 13.2 Digest notifications

Activity notifications can be bundled into daily/weekly digest.

Digest can include:

- Founder posted update.
- New comments.
- Campaign activity.
- Campaign-affiliate roster updates.

Backers set digest preference at first magic-link visit. Founders/affiliates set in settings.

### 13.3 In-app notifications

Notification history appears on authenticated Founder campaign homes, Affiliate homes, and the Admin panel. It must not create a separate Founder widget dashboard or compete with the one ranked Act item.

No real-time push required. Notifications appear on page load/refresh.

---

## 14. Data, privacy, and access rules

### 14.1 Backer data

Collect/store:

- Email.
- Phone.
- US billing country/postal code and full billing address only where required for tax/payment processing.
- Age-confirmation consent and version.
- Reservation data.
- Reward package/SKU.
- Pre-tax subtotal, reservation-time sales tax, exact total authorized, Tax calculation ID/jurisdiction/expiry/usability status, and captured total.
- Currency.
- Timestamp.
- SetupIntent ID.
- PaymentIntent ID after charge.
- Survey responses.
- Mandatory Founder fulfillment/support sharing acknowledgment.
- Founder operational-data sharing time/status and cancellation follow-up state.
- Separate optional Founder marketing/research/survey opt-in and Proovd newsletter opt-in.
- Privacy-safe comment display label, when the backer comments.
- Magic-link token hash, token version, issued time, last-used time, revoked time/reason, and replacement-token lineage. The raw token is never stored after issuance.
- Device data / cookies as described in Cookie Policy.
- Idea-Campaign deduplication references: private normalized-identity hashes, payment-method fingerprint reference where available, device/IP risk references, suspected-duplicate case, and audited Admin decision. These are fraud/threshold data, not public profile data.

Proovd never sees raw card data.

### 14.2 Founder data

Collect/store:

- Account credentials or OAuth ID.
- Temporary draft identifier.
- Invitation source and invitation record.
- Prefilled account fields, with per-field provenance recording whether the founder or Proovd supplied each prefilled field.
- Vetting text provenance for Problem and Solution: whether the current text was supplied by Proovd or the founder, with edit timestamps (§5.3).
- Campaign-type lock record and, if replaced, the archived-campaign/replacement-campaign link (§5.2).
- `founder_signup_complete` timestamp and the affiliate campaign-visibility events it triggered (§5.5).
- High-effort inputs, calculated result, calculation time, and recording actor/system (§5.8).
- Interview booking records: scheduled time, timezone, meeting provider, meeting link, interviewer, status, reschedule history, and cancellation (§5.7).
- Legal name.
- Date of birth.
- Business/entity name.
- Country/state.
- Phone, with an explicitly unverified status.
- Connected account ID.
- Campaign content.
- Refund-policy text/snapshot, source URL, version, effective date, and campaign/consent references.
- Communications/support messages.
- Listing fee calculation inputs, charge, and refund IDs.
- W-9 status and tax records where required.
- Post-campaign work-again requests: original campaign, founder, creator, request date, status, and response (§5.18).
- Founder live-page last-seen count/time and delivered count/delta per campaign (§5.17).

Stripe collects identity documents and connected-account KYC data directly.

### 14.3 Affiliate data

Collect/store:

- Account credentials.
- Legal name.
- Date of birth, country, state, and 18+/US eligibility confirmation.
- Phone.
- Channel metadata.
- Audience metrics.
- Verification evidence.
- Stripe connected-account ID, requirements status, transfer capability, payout status, and provider-managed tax-information status. Proovd does not store full bank details or Stripe identity documents.
- Campaign activity.
- Campaign-specific recruitment and invitation records: founder, campaign, recruiting admin, source, invitation status, sent time, signup time, and pre-launch/mid-campaign designation.
- Campaign visibility and activation records: preparing-state visible time, formal-opportunity activation time, joined-at time, and tracking-link `activated_at`.
- Full preparing-kit pre-view time, revocation state, and pilot trusted-cohort exception record.
- Remaining-time deliverables for any mid-campaign addition.
- Tracking link metrics.
- Compensation records, including the applicable §5.12 matrix cell, base percentage, accepted percentage bid, Creator-specific bonus unit/threshold/maximum percentage/result, and material-change reacceptance versions.
- Creator proposal version, superseded proposal version where applicable, proposing party, proposed percentage, proposed fixed Creator payment, Creator decision and timestamp, Founder decision and timestamp, proposal status, and final mutually accepted version.
- Fixed-payment allocation ID; funding provider object ID; funding amount, currency, status, attempt, and failure history; completion eligibility; return amount/reason/object/idempotency key; finalized commission/Creator-specific bonus; Transfer amount/ID/status/idempotency key; payout status; and any negative-balance/recovery record (§6.10).
- Provisional Affiliate percentage amount per captured charge at the maximum locked base/bid/bonus percentage; application-fee/platform-side object and amount; verified earned and unearned amounts; return-to-Founder adjustment amount, object, status, reason, and idempotency key; and the rule that no provisional Affiliate amount is Proovd revenue.
- Any discretionary manual thank-you payment: retained-listing-fee availability, reason, amount, Admin approval, recipient, provider object/status, tax/accounting treatment, and timestamp. It is stored separately from campaign earnings.
- Submitted proof links, first-post verification, full-deliverable verification, required availability period, formal waivers, and completion decision (§6.10).
- Creator completion status, completed date, admin actor, evidence links, waived deliverables, and disqualifying reason where applicable (§5.18).
- Post-campaign work-again requests and responses (§6.17).
- Compliance records.

### 14.4 Backer-to-founder sharing

Founder sees aggregate campaign data by default:

- Total reservations/backers.
- Reservation volume.
- Conversion data.
- Aggregate/anonymized survey response data.

Immediately after every successfully saved pre-order, the Founder receives the Backer email and purchase details strictly necessary for fulfillment preparation and purchase support, even though the Backer has not yet been charged. Checkout discloses both the sharing and its timing before consent; it is not presented as optional marketing consent. If the Backer cancels or the campaign ends without charge, the Founder record updates to `canceled/no charge — do not fulfill`. Information already shared is not retroactively retractable and remains limited to operational use.

Founder receives identifiable survey answers or permission for marketing, research, surveys, or other non-fulfillment contact only when the Backer separately selects the applicable unchecked optional consent. The optional choice never affects the ability to pre-order or receive support.

### 14.5 Affiliate data access

Affiliates see aggregate performance data only:

- Clicks.
- Reservations.
- Captured amount.
- Conversion rate.
- Reward tier summary.
- Timestamped attribution.

Affiliates never receive Backer email, name, phone, billing address, or identifiable survey responses, even when the Backer separately allowed the Founder to use identifiable information.

### 14.6 Retention

MVP should support retention policy:

- Backer reservation records and survey responses: 7 years.
- Founder account/tax data: life of account + 7 years.
- Affiliate account/tax data: life of account + 7 years.
- Marketing opt-in records: until unsubscribe + 2 years.
- Magic-link token hashes and issuance/revocation audit records: retained through fulfillment or final resolution plus 180 days, unless Admin revokes and reissues for security. Raw tokens are never retained. Founder or Affiliate payment does not invalidate Backer access.
- Unclaimed temporary drafts and their prefilled vetting content: automatically deleted or irreversibly anonymized 30 calendar days after the invitation was last sent. Resending the invitation rotates the token and begins a new 30-day period. Revocation removes access immediately but does not prevent earlier manual deletion. The deletion/anonymization event, timestamp, and actor or automated job are recorded (§18.4).

---

## 15. Edge cases and recovery

### 15.1 Affiliate ghosting

For a launch affiliate, zero posts within the first seven days of campaign launch. For an affiliate added after launch, zero posts within the agreed first-post period measured from that affiliate's activation, never beyond campaign close.

Recovery:

1. Admin attempts replacement.
2. If multiple affiliates remain, campaign continues.
3. If only one affiliate and replacement found, admin may extend campaign by lost days.
4. If no replacement and campaign cannot perform, admin may suspend/kill.
5. If the Affiliate never made a valid compliant post, the full fixed-payment allocation returns to the Founder and no commission is earned (§6.10).
6. If a valid compliant attributed post exists but later deliverables are incomplete, the full fixed-payment allocation still returns to the Founder; genuine commission from compliant attributed captured sales may remain. Fraud, invalid proof, or material breach cancels invalid earnings and may create recovery.

### 15.2 Partial affiliate ghosting

Affiliate posts then disappears. Handled case-by-case through Admin quality/compliance assessment. May affect thank-you payment, future quality tier, active cap, or removal. A first post alone never earns the fixed Creator payment; unless every agreed deliverable is completed or formally waived, the full fixed allocation returns to the Founder. Genuine commission may remain only for compliant attributed captured sales (§6.10).

### 15.3 Affiliate invalid termination

Affiliate may terminate active partnership only for valid reason:

- Founder materially breached pitch terms.
- Campaign suspended by Proovd.
- Documented health/family/capacity emergency.
- Other admin-accepted reason.

Invalid termination can forfeit a thank-you payment, affect tier/access, reduce the active cap, or remove the Affiliate. No fixed Creator payment is earned unless every agreed deliverable is completed or formally waived. Valid finalized commission is not recovered for termination alone; fraud, invalid proof, self-dealing, false claims, or material breach follows the cause-based adjustment rules in §11.8.

### 15.4 No-acceptance refund

If Proovd has zero eligible campaign-specific recruits, or activates the formal opportunity for eligible recruited Affiliates but no Creator and Founder mutually accept the same compensation-proposal version within the disclosed 72-hour response window beginning at successful listing-fee payment:

- A pending proposal is interest, not acceptance, and does not pause or extend the deadline.
- Admin refunds the entire listing-fee Checkout charge actually paid—including the listing-fee subtotal and associated Stripe Tax reversal/correction—with no fixed deduction.
- Founder notified.
- Campaign returns to draft or is archived.
- Founder may revise/resubmit if allowed.
- A late affiliate response cannot reactivate the failed/refunded campaign automatically.

If an accepted launch Creator fails before `campaign_live_at`, Admin records `creator_failure_recorded_at` and the campaign enters `creator_replacement`. Proovd has three business days from that timestamp, calculated under the configured US business-day calendar and stored as an exact due time, to make a replacement fully ready. Failure produces `refunded_no_creator` and the same full Checkout-charge refund; the Creator payment allocation, if funded, returns to the Founder.

### 15.5 Campaign suspension after reservations but before charge

- No backers charged.
- Internal reservations closed, future PaymentIntent creation blocked, and saved PaymentMethods detached where appropriate; successful SetupIntents remain in Stripe history.
- Backers notified.
- Founder/affiliates notified.
- Page remains with status banner.

### 15.6 Campaign suspension after charge

- Admin follows policy.
- Remaining restricted/held balance refunded pro-rata where possible. For a Product Campaign this includes any unreleased remaining payment; for an Idea Campaign the single Founder payment may already have been released at Day 3, and recovery beyond unreleased funds is best-effort (§11.8).
- Stripe reversals attempted against released funds on best-effort basis.
- Founder may be banned depending on reason.
- Dispute evidence preserved.

### 15.7 Failed close-date batch

If webhook/job fails:

- Admin dashboard must show incomplete charge batch.
- System must support retry without double-charging.
- Idempotency keys required.
- Reservations should remain locked until batch resolution.
- Backers should not receive duplicate receipts.

### 15.8 Backer disputes unknown charge

Statement descriptor should be recognizable. If backer contacts support before dispute:

- Support identifies campaign/founder.
- Sends receipt/context.
- Routes refund/support request to founder where appropriate.
- Documents interaction for evidence.

### 15.9 Policy updates

Founders and affiliates must re-accept materially updated AUPs/Terms. Continued use without re-acceptance results in account suspension until accepted.

---

## 16. MVP campaign configuration template

This section defines the reusable campaign-specific operating brief required for every MVP campaign. The product must not hard-code any founder name, product name, vertical, reward structure, affiliate list, delivery promise, or promotional language.

Each approved campaign receives its own admin-maintained configuration and operating brief. That brief informs copy, review, affiliate sourcing, tier design, and support scripts, but the underlying platform behavior remains generic.

### 16.1 Campaign identity

Every MVP campaign brief must record:

- Campaign title.
- Campaign type: Idea Campaign (Pre-build) or Product Campaign (Pre-launch), locked at vetting submission.
- Founder legal name.
- Founder entity name, or sole proprietor status.
- Founder country and state.
- Founder Stripe Standard connected account ID.
- Product/startup name.
- Product URL, if available.
- Product category.
- Digital reward category.
- Campaign open date and close date/time UTC.
- Delivery month/year for every reward package.
- Internal campaign owner on the Proovd team.

### 16.2 Product and launch scope

Before final campaign copy is written, admin must confirm:

- What the product is.
- Whether the product already exists, is near launch, or is still conceptual.
- For Product Campaigns, what the launch moment is: feature launch, hard launch, founding-member offer, relaunch, beta cohort, or other approved launch frame.
- For Idea Campaigns, what problem is being validated and what order threshold makes the build viable.
- What the founder can realistically deliver.
- What claims the founder can support with evidence.
- What claims must be avoided.
- What screenshots, demos, videos, proof points, testimonials, or product assets are available.
- The exact delivery month/year for each reward package.

The campaign brief must include a clear warning if any product feature, launch claim, delivery promise, or proof point is not yet confirmed. Unconfirmed claims must not appear on public campaign pages, checkout consent text, affiliate briefs, or creator talking points.

### 16.3 Target backer

Each campaign must define a specific target backer profile before affiliate sourcing begins.

The brief must include:

- Primary audience segment.
- Geography, if relevant.
- Age restrictions or exclusions.
- Buyer/backer pain point.
- Why the campaign matters now.
- What outcome the backer is buying or reserving.
- What objections the backer is likely to have.
- What proof points reduce risk.
- Whether the audience is reachable through creators, newsletters, communities, educators, student networks, niche marketers, or other distribution partners.

The target backer definition should be narrow enough that affiliates can immediately understand whether their audience fits.

### 16.4 Founder discovery flow

Before campaign setup is finalized, admin should run founder discovery covering:

1. What is the product or feature being launched or validated?
2. What is the clearest backer outcome?
3. What makes this product credible today?
4. What can be delivered by the disclosed delivery month/year?
5. What reward packages are realistic?
6. What would be a strong entry-tier hook?
7. What would create community, accountability, access, or status at the mid tier?
8. What would create a real economic or high-value hook at the top tier?
9. What refund policy is appropriate for the product type?
10. What claims should affiliates avoid?
11. What founder/product materials can affiliates use?
12. Which audience channels are most relevant to the campaign?
13. For a Product Campaign, is the Founder prepared to consider optional fixed Creator payment requests? An accepted arrangement moves that Creator's base commission from 30% to 20%, must be fully funded before work begins, releases nothing at first post, and is paid only after close and full completion (§5.12, §6.10). Idea Campaigns never support fixed Creator payments.
14. What performance bonuses, if any, are appropriate?

The outcome of discovery is a campaign brief, not final public copy by default. Final campaign copy must still pass admin review.

### 16.5 Affiliate and distribution sourcing plan

For each campaign, admin should define channel categories based on where the target backer actually spends attention.

Possible channel categories include:

- Social creators on YouTube, TikTok, Instagram, X, LinkedIn, Twitch, or other relevant platforms.
- Newsletter and blog operators.
- Podcast hosts.
- Community owners and admins.
- Course instructors and educators.
- Student affiliates and club/community officers.
- Network distributors with legitimate access to the target audience.
- Niche marketers or operators with relevant owned distribution.
- Proovd house channels, tracked separately from third-party affiliate performance.

Each sourced affiliate/distribution partner record must capture:

- Channel type.
- Audience fit.
- Audience size or comparable distribution metric.
- Engagement or quality signal.
- Permission/ownership basis for promotion.
- FTC disclosure expectations.
- Brand/claim restrictions.
- Proposed compensation model.
- Whether the channel is a primary launch driver or secondary/backup distribution.

Sourcing is campaign-specific in MVP. Admin may begin before the founder finishes signup, sends a private campaign-specific invitation, and pre-associates the recruit with that campaign. Admin may continue during the 72-hour formal response window and may recruit an additional affiliate after launch and before close under §6.18. The operating plan must distinguish the initial launch roster from a mid-campaign addition and must never imply that the founder searches a general affiliate marketplace.

### 16.6 Incentive and reward design

Each campaign must have reward packages that are specific, deliverable, and disclosed clearly.

For Idea Campaigns, incentive design must support the order-threshold validation logic. The reward must be tied to a product the founder can build if the threshold is met.

For Product Campaigns, incentive design must support a real founding-member pre-order for a live or near-launch product. The reward should not feel like a vague donation, tip, or speculative investment.

Every campaign should consider three structural pieces:

1. **Strong entry-tier hook.** A low-friction reward or benefit that makes the campaign easy to say yes to.
2. **Community/accountability/access piece.** A mid-tier reason to feel involved beyond a transaction.
3. **Real economic or high-value hook.** A top-tier offer that creates meaningful value without making unsupported promises.

These are product-design requirements, not fixed tier names or fixed prices. Actual tiers are campaign-specific and must be approved by admin.

### 16.7 Campaign setup defaults

Unless the approved campaign brief says otherwise, MVP defaults are:

- Campaign type locked at vetting submission and read-only in campaign setup (§5.2).
- Campaign cap: US$50,000 in aggregate pre-tax active-pre-order value, enforced atomically.
- Product Campaign default duration: 14 days.
- Failed-payment retry window: fixed at 48 hours.
- Currency: USD only.
- Digital rewards only.
- Delivery month/year required on every reward package.
- Founder refund policy required for Product Campaigns.
- Order threshold required for Idea Campaigns.
- Public dollar goal optional for Product Campaigns and should not be treated as a funding gate.
- Backer count / units reserved preferred for Product Campaign public momentum display.
- Organic, house-channel, and affiliate-attributed traffic/revenue tracked separately.

### 16.8 Campaign checkout plain-English substance

Campaign-specific checkout copy must preserve the approved template and fill in campaign variables accurately.

Every checkout flow must clearly tell the backer:

- Who operates the campaign.
- Who the merchant of record is.
- What campaign type they are reserving or pre-ordering under.
- That the card is not charged today when the pre-order is placed.
- When the card will be charged, if applicable.
- How the amount is determined.
- The reward subtotal, sales tax paid by the Backer, and exact total authorized.
- How cancellation works before close.
- What happens if an Idea Campaign order threshold is not met.
- What refund policy applies after a Product Campaign close-date charge.
- What delivery month/year applies to the selected reward package.
- What the statement descriptor will say.
- How to contact support.
- That email and purchase details are shared with the Founder only for fulfillment and purchase support.
- That Founder marketing/research/survey contact requires a separate unchecked optional consent.

### 16.9 Close, post-close, and reporting

Every campaign must define the post-close operating plan before launch.

The plan must include:

- Close-date charge batch timing.
- Failed-payment retry window.
- Founder notification flow.
- Backer receipt flow.
- Affiliate commission/bonus calculation rules per the §5.12 matrix.
- Fixed Creator payment funding, completion, return, Transfer, and payout status per Creator (§6.10).
- W-9 block before any Day 3 founder payment.
- Day 3 payment review: Idea Campaign single Founder payment, or Product Campaign first payment.
- Day 14 Progress Check evidence requirements.
- Product Campaign remaining-payment release/refund/reversal path.
- Delivery update cadence.
- Support routing.
- Case-study metrics.
- Organic vs affiliate-attributed reporting.
- Satisfaction survey timing.

The campaign brief should make it possible for operations, engineering, support, and affiliates to run the campaign without relying on undocumented founder-specific context.

## 17. Explicitly deferred or limited in MVP

Deferred unless engineering effort is trivial or needed for Stripe review:

- Full AI pitch refinement.
- Fully automated founder scoring.
- Algorithmic general-pool affiliate matching; MVP uses campaign-specific recruitment and pre-association.
- Founder-side browsing of all unmatched affiliates.
- Full teaser mode.
- Full affiliate resource library / mini-courses / PDFs.
- 1:1 founder–creator meeting scheduling; the embedded founder-interview scheduling in §5.7 is required MVP, not deferred.
- Direct founder-affiliate messaging beyond admin/support routing.
- Real-time dashboards or sockets.
- Backer accounts/password auth/profile photos.
- Full in-product dispute center.
- Fully automated milestone UI.
- Fully automated payouts.
- A custom Proovd tax-filing product beyond the Stripe/provider records and tax reporting legally required for launch.
- Hosted founder community.
- Non-US founders.
- Non-US affiliates.
- Physical goods.
- B2B enterprise procurement campaigns.
- Mobile app unless already planned.
- Algorithmic matching based on accumulated conversion history; the MVP records recruitment/fit inputs and uses campaign-specific human sourcing and verification.
- Automatic pruning of the bottom 10% of affiliates every two months; performance reporting may inform manual re-verification or offboarding.
- Founder-facing browsing and outreach to the entire unmatched affiliate pool.
- The post-success affiliate-management product for repeatedly collaborating with top partners; the narrow §6.17 post-campaign work-again request is required MVP, not deferred.
- Click-exit surveys and a public/internal "like" signal for zero-reservation campaigns, unless trivial and privacy-safe.
- Public founder ratings or reputation scores. The launch posture intentionally uses internal enforcement and the one-strike ghost ban instead of a Yelp-style rating system.
- Configurable mobile push notifications beyond in-app and email.
- Stock-style metric animations, best-hour/best-day widgets, and other advanced visual analytics.
- Automated first-time product tours and the full set of educational popups/PDF mini-courses described in the product brief. This does not defer the compact campaign-specific signup/waiting state or the single Campaign kit required by §6.1–§6.2.

Required in MVP:

- Personalized invitation with secure temporary draft (§5.1).
- Private campaign-specific affiliate invitations, affiliate-created/claimed accounts, and pre-association before founder signup completes (§4.2, §6.1).
- Automatic campaign visibility for pre-associated affiliates at `founder_signup_complete`, followed by formal decision activation at successful listing-fee payment (§5.5, §5.10).
- A single attached affiliate Campaign kit containing campaign-specific materials, disclosures, promotion rules, proof instructions, compensation/payment explanations, and support (§6.2).
- Pre-account vetting — campaign path choice, Problem, Solution, Competition — and the possible-creator result (§5.3–§5.4).
- Prefilled account claim with per-field provenance (§5.5).
- Embedded founder interview scheduling (§5.7).
- Campaign-type lock at vetting submission (§5.2).
- Stripe Connect Standard connected account onboarding.
- SetupIntent reservation and off-session capture logic.
- Campaign-type separation.
- Checkout consent text.
- Merchant-of-record disclosure.
- Required legal/policy pages.
- Sample campaigns.
- Calculated listing fee (US$35 base, US$2 optional-item discounts, US$25 minimum) through Proovd main Stripe account.
- 5% Connect platform/application fee logic.
- Parallel affiliate-roster/campaign-building status model with derived review readiness (§5.15, §12.3).
- Creator compensation matrix with the 50% ceiling (§5.12).
- W-9 block before any Day 3 founder payment.
- Campaign-specific founder payment schedules: Idea single payment; Product first/remaining payments (§11.3).
- Admin payment-schedule tracking.
- Affiliate AUP acceptance.
- IP agreement acceptance.
- FTC disclosure templates.
- Creator proposal handling: percentage bids and optional fixed Creator payment requests decided by the Founder with Admin oversight.
- Fixed Creator payment funding before work, US$0 release at first post, and post-close full-completion payment verification (§6.10).
- Creator-readiness gate (§5.16).
- Threshold reached/lost events for Idea Campaigns.
- Post-campaign work-again requests (§6.17).
- Mid-campaign affiliate recruitment and activation with adjusted remaining-time deliverables and non-retroactive attribution (§6.18).
- Three-active-partnership cap.
- Backer magic-link support form.
- Failed-payment retry flow.
- Dispute evidence archive.

---

## 18. Implementation notes for tech lead

### 18.1 Build order recommendation

1. Public website/policy routes and sample campaigns.
2. Invitation records and secure temporary drafts with pre-account vetting and the possible-creator result.
3. Campaign type model (locked at vetting) and prefilled account claim.
4. Founder interview scheduling and high-effort/listing-fee calculation.
5. Campaign-specific affiliate prospect records, private signup invitations, affiliate-created/claimed accounts, and `founder_signup_complete` campaign visibility.
6. Stripe connected account onboarding status and listing-fee checkout; successful payment activates formal affiliate opportunities and starts the 72-hour response window while campaign building continues.
7. Parallel Affiliate-roster/campaign-building status model, campaign acceptance, Creator proposals, and fixed Creator payment funding.
8. Campaign page rendering with MoR disclosure and consent drawer.
9. SetupIntent pre-order flow.
10. Reservation ledger — including pre-order counters and threshold events — and magic-link page.
11. Close-date capture batch and failed-payment retry.
12. Admin panel for campaigns/reservations/campaign-affiliate associations, creator readiness, deliverable verification, and mid-campaign additions.
13. Affiliate connected-account onboarding, compensation records, post-close Transfers, payouts, and cause-based adjustments.
14. Campaign-specific founder payment tracking (Idea single payment; Product first/remaining payments), W-9, and Day 14 check.
15. Dispute evidence packet.
16. Post-campaign work-again requests.
17. Campaign-specific operating brief and configuration template.

### 18.2 Idempotency and charge safety

The close-date batch must be idempotent. No double charges.

Each reservation/PaymentIntent creation should use stable idempotency keys tied to reservation ID and charge attempt.

### 18.3 Consent versioning

Every reservation stores:

- Consent text version.
- Campaign page disclosure version/hash.
- Policy version.
- Timestamp.

This matters for disputes.

### 18.4 Magic links and secure temporary-draft links

Magic links are long-lived authentication credentials scoped to one backer/campaign.

Every magic-link and temporary-draft token must be generated from a cryptographically secure source with at least 128 bits of entropy. Store only a one-way hash plus token version and audit metadata; the raw token exists only in the delivered URL. Compare hashes in constant-time where the stack permits, rate-limit token attempts and resend requests, return non-enumerating errors, and log security-relevant use without logging the raw URL/token. Rotation or resend immediately revokes every superseded token. A compromised token can be revoked and replaced without changing the underlying campaign/reservation identity.

All receipt links, update links, card-update links, and support links should resolve to the same identity/scope unless a special short-lived Stripe update-card session is required.

Token revocation is admin-driven.

Founder temporary-draft links (§5.1) are comparable secure credentials:

- Scoped to one invited founder's draft only.
- Revocable by admin at any time; revocation removes access immediately.
- Invalidated when the draft is claimed into an account or the invitation is revoked.
- Expire 30 calendar days after the invitation's most recent send.
- Resending creates a new token and immediately invalidates the previous token.
- Claiming, revoking, or expiring the invitation prevents every prior token from being replayed.
- Never grant access to another founder's data, the admin panel, or any payment action.
- Unclaimed drafts follow the §14.6 retention rule.

### 18.5 Manual operations as records

Even when the money movement or review is manual, the system must record:

- Who took action.
- When.
- Why.
- Amount.
- Stripe object IDs.
- Notes.
- Evidence links.

This applies to invitation sending/revocation, private Campaign-kit access/revocation, archive-and-replace decisions for a wrongly locked campaign type, high-effort overrides, review-change materiality and Creator reacceptance, suspected-Backer duplicate merge/separate decisions, first-post and full-deliverable verification, fixed-payment funding/return/eligibility/Transfer decisions, Creator-specific bonus decisions, manual thank-you payments, `creator_failure_recorded_at` and replacement deadlines, W-9 approval, Founder payment releases, Affiliate earnings adjustments, listing-fee subtotal/tax/total refunds, reversals, disputes, suspension, and work-again request decisions.

### 18.6 Source-of-truth naming

Use internal database terms carefully:

- `reservation` for pre-charge backer commitment.
- `charge` or `captured_charge` for successful PaymentIntent.
- `campaign_application_fee` or `platform_fee` for 5% Connect fee.
- `listing_fee` for Proovd direct founder fee.
- `founder_share` for funds owed/releasable to founder.
- `single_payment`, `first_payment`, and `remaining_payment` for founder payment releases; do not name new fields or statuses `tranche`.
- `affiliate_compensation` for commission/fixed Creator payment/bonus/thank-you/adjustment/Transfer.

Avoid naming DB tables/fields in ways that imply escrow/custody if they might leak to logs/admin UI.


### 18.7 Stripe test API and test-mode setup

The MVP must include a practical Stripe sandbox/test-mode setup before any live campaign payment code is used. This section is a product requirement, not an optional developer note.

#### 18.7.1 Test-mode rule

All Stripe payment work must be built and verified in Stripe sandbox/test mode first. No developer should use live secret keys, live publishable keys, real cards, or live connected accounts while building the MVP.

The application must fail closed when the environment is inconsistent. Examples:

- A live key is present while `STRIPE_MODE=test`.
- A test key is present while `STRIPE_MODE=live`.
- A live connected account ID is used in test mode.
- A test connected account ID is used in live mode.
- A webhook signing secret does not match the configured mode.

Secret keys must be stored only in environment variables or a secrets manager. They must never be committed to the repository, copied into documentation screenshots, stored in frontend code, or sent in chat/email.

#### 18.7.2 Required environment variables

At minimum, the dev/staging environment needs the following Stripe-related variables:

```text
STRIPE_MODE=test
STRIPE_API_VERSION=[locked Stripe API version]
STRIPE_PLATFORM_ACCOUNT_ID=acct_...
STRIPE_PLATFORM_SECRET_KEY=sk_test_...
STRIPE_PLATFORM_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET_PLATFORM=whsec_...
STRIPE_WEBHOOK_SECRET_CONNECT=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...                         # if OAuth is used for Standard accounts
STRIPE_CONNECT_RETURN_URL=https://[app]/stripe/return
STRIPE_CONNECT_REFRESH_URL=https://[app]/stripe/refresh
STRIPE_TEST_FOUNDER_CONNECTED_ACCOUNT_ID=acct_...       # test-only seeded founder account
STRIPE_TEST_AFFILIATE_CONNECTED_ACCOUNT_ID=acct_...     # test-only recipient with approved transfer capability
STRIPE_TEST_BACKUP_MODE_ENABLED=false                   # true only when testing backup SCT behavior
STRIPE_TAX_ENABLED=true
APP_BASE_URL=https://[dev-or-staging-app]
CRON_SECRET=[secret used to trigger protected close-date batch jobs]
```

The exact variable names can change if the engineering team has a naming convention, but the product requirement is that platform keys, webhook secrets, connected-account references, mode, API version, and Connect URLs are explicit and mode-safe.

#### 18.7.3 Stripe account and sandbox setup

Before implementing the live payment flow, engineering must create or configure the following in Stripe sandbox/test mode:

1. Proovd platform Stripe account in test mode.
2. Connect test configuration enabled for the platform account.
3. At least one test Founder Standard connected account.
4. At least one test Affiliate connected account with the Stripe-approved transfer/payout configuration.
5. At least one sample Pre-build campaign tied to the test Founder account.
6. At least one sample Pre-launch campaign tied to the test Founder account.
7. A test listing-fee Checkout flow on Proovd's platform account, separate from Connect campaign charges.
8. Test tax registrations/product tax codes and billing locations sufficient to prove tax-exclusive totals in every supported launch jurisdiction.
9. A test webhook endpoint for Proovd platform events.
10. A test webhook endpoint or configuration that listens for connected-account events where required by the approved Connect architecture.
11. A local webhook-forwarding setup using Stripe CLI or equivalent.
12. A written test-run log showing which scenarios passed, failed, or remain blocked by Stripe, legal, or tax decisions.

#### 18.7.4 Stripe CLI and local webhook forwarding

Local development must support Stripe webhook forwarding so engineers can test asynchronous state changes rather than relying on polling.

Required local workflow:

```bash
stripe login
stripe listen --forward-to localhost:[PORT]/api/stripe/webhook
```

If the app uses separate platform and connected-account webhook handlers, use separate forwarding sessions or a handler that can safely route events by account/context.

The webhook signing secret printed by the CLI must be copied into the local environment as the matching `STRIPE_WEBHOOK_SECRET_*` value. Do not hardcode it.

#### 18.7.5 Required webhook events

The MVP must handle and store Stripe webhook events idempotently. Duplicate delivery must not duplicate reservations, charges, refunds, transfers, commission records, or emails.

Platform-account events to handle:

- `checkout.session.completed` — listing fee paid.
- `checkout.session.expired` — listing fee checkout expired.
- `payment_intent.succeeded` — platform-side successful payment where applicable.
- `payment_intent.payment_failed` — platform-side payment failure where applicable.
- `charge.refunded` — refund record update.
- `charge.dispute.created` — dispute opened.
- `charge.dispute.updated` — dispute state changed.
- `charge.dispute.closed` — dispute closed.

Connect / connected-account events to handle where applicable:

- `account.updated` — connected-account onboarding, requirements, or capability status changed.
- `account.application.authorized` — founder connected account authorized the platform, if OAuth is used.
- `account.application.deauthorized` — founder disconnected or revoked access, if OAuth is used.
- `setup_intent.succeeded` — reservation card saved successfully.
- `setup_intent.setup_failed` — reservation card setup failed.
- `setup_intent.canceled` — a SetupIntent was canceled before successful completion; it is not the event for canceling a successful reservation.
- `payment_method.detached` — a saved PaymentMethod was detached after an internal reservation cancellation, threshold miss, or campaign kill where appropriate.
- `setup_intent.requires_action` — setup requires customer action and must not be treated as complete.
- `payment_intent.succeeded` — close-date charge succeeded.
- `payment_intent.payment_failed` — close-date charge failed and retry/update-card flow begins.
- `payment_intent.requires_action` — off-session charge needs customer action and enters failed/recovery state.
- `payment_intent.canceled` — payment attempt canceled.
- `charge.refunded` — connected-account refund record update.
- `charge.dispute.created` — dispute opened on connected-account charge.
- `charge.dispute.updated` — dispute state changed.
- `charge.dispute.closed` — dispute closed.
- `transfer.created` / `transfer.updated` / `transfer.reversed` — Affiliate or backup SCT transfer lifecycle where applicable. A Transfer API creation failure is recorded from the synchronous API error and retry job; there is no assumed `transfer.failed` webhook.
- `payout.paid` / `payout.failed` — if Stripe-approved payout controls require payout status tracking.

If engineering chooses a smaller event list for MVP, the omitted events must be explicitly justified in the technical plan and must not weaken reservation, charge, refund, dispute, or connected-account status accuracy.

#### 18.7.6 Stripe object storage requirements

Every Stripe-created object that affects campaign state must be stored on the relevant internal record.

Reservation record stores:

- Stripe mode.
- Stripe account context: platform or connected account.
- Founder connected account ID.
- Affiliate connected account ID where the record is attributed and may fund a later Transfer.
- Stripe Customer ID, if used.
- SetupIntent ID.
- PaymentMethod ID or token reference where safe to store.
- SetupIntent status.
- Consent version.
- Campaign page disclosure version/hash.
- Campaign type.
- Reward subtotal, sales tax, exact total authorized, tax calculation ID, and total captured.
- One reward package ID/SKU per transaction.
- Affiliate attribution ID, if any.
- Cancellation timestamp, if canceled.

Charge/capture record stores:

- PaymentIntent ID.
- Charge ID.
- Stripe account context.
- Reward subtotal attempted/captured.
- Sales tax attempted/captured.
- Total attempted/captured.
- Currency.
- Proovd 5% amount, Affiliate percentage-compensation amount, and total application-fee/platform-side amount stored separately.
- Stripe processing fee and the account/balance that bore it.
- Failure code and failure message, if any.
- Retry count.
- Final status.
- Idempotency key.
- Batch run ID.

Refund/reversal/dispute records store:

- Refund ID, reversal ID, transfer ID, payout ID, or dispute ID where applicable.
- Related PaymentIntent/Charge ID.
- Amount.
- Reason.
- Status.
- Evidence packet location.
- Admin actor.
- Timestamp.
- Cause classification: Founder/product, Affiliate, Proovd/system, Backer dispute unrelated to Affiliate, law/Stripe/card issuer, or other reviewed reason.
- Proovd fee treatment, Affiliate earnings treatment, Founder liability, and negative-balance/recovery record where applicable.

Affiliate Transfer/payout records store:

- Affiliate connected-account ID and campaign-association ID.
- Finalized commission, bonus, fixed Creator payment, adjustment, and total Transfer amount.
- Work/compliance completion evidence and Admin approval.
- Transfer ID/status/idempotency key and any reversal ID.
- Payout ID/status/failure reason where available.

#### 18.7.7 Direct-charge test path

The preferred test path must simulate the approved direct-charge architecture as closely as Stripe test mode allows.

Required test behavior:

1. Founder completes or is represented by a test Standard connected account.
2. Backer reserves through the campaign page.
3. SetupIntent is created in the correct connected-account context.
4. Payment method is saved for later use without charging today.
5. Reservation appears in the Proovd reservation ledger.
6. At the campaign trigger, Proovd creates an off-session PaymentIntent in the correct connected-account context.
7. The charge equals the consented reward subtotal plus sales tax; the Proovd 5% and Affiliate percentage compensation are calculated only on the pre-tax subtotal.
8. The platform-side application-fee amount includes the separately ledgered Proovd fee and provisional Affiliate amount where Stripe approved that structure; only verified earnings become payable.
9. Founder remains the merchant of record in internal records and campaign disclosures.
10. Successful charge updates the Backer magic-link page and Founder, Affiliate, and Admin records.
11. Failed charge enters the 48-hour update-card/retry flow and does not count as collected revenue until recovered.
12. After the retry window and completion review, Admin creates one idempotent Transfer to the Affiliate connected account for finalized commission plus any eligible fixed Creator payment.

#### 18.7.8 Backup SCT test path

The backup test path must exist even if not used on day one, because Stripe may require it during approval.

Required test behavior:

1. Backer reservation still uses the same front-end card-save and consent flow.
2. Close-date capture creates the charge using the approved platform-side backup configuration.
3. `on_behalf_of` is set to the founder connected account where supported and approved.
4. Metadata and transfer group tie the charge, reservation, campaign, founder, and affiliate attribution together.
5. Proovd's 5% and provisional Affiliate share are calculated only from the pre-tax reward subtotal and retained/allocated according to the approved backup model; sales tax is separate and only verified Affiliate earnings become payable.
6. Founder share is not transferred or payout-eligible before the disclosed milestone conditions.
7. Transfer, reversal, refund, and dispute records are represented in admin even if the actual money movement remains manual during MVP.
8. UI copy still describes the founder as merchant of record and does not say escrow, trust, custody, or Proovd bank-account hold.

#### 18.7.9 Required test card scenarios

Engineering must test with Stripe sandbox cards that simulate at least the following outcomes. The exact card numbers should be checked against Stripe's current testing documentation during implementation, because Stripe can update testing guidance.

Minimum required scenarios:

| Scenario | Purpose | Expected product behavior |
| --- | --- | --- |
| Successful card | Happy-path SetupIntent and close-date capture | Reservation succeeds; later PaymentIntent succeeds; role surfaces and Admin records update. |
| Generic decline | Failed close-date charge | Reservation moves to failed-payment recovery; no collected revenue counted. |
| Insufficient funds | Realistic failed close-date charge | Backer receives update-card/retry email; admin sees failure reason. |
| Authentication required / 3DS | Off-session payment may require customer action | Charge does not silently succeed; backer gets recovery link. |
| Expired card | Saved card becomes unusable by close | Retry/update-card path works. |
| Incorrect CVC or setup failure | SetupIntent cannot complete | Reservation is not created as active. |
| Processing error | Stripe/API failure simulation | Job retries safely and logs error. |
| Dispute test | Chargeback evidence path | Dispute record created and evidence packet generated. |
| Refund test | Full and partial refund bookkeeping | Refund state updates across backer, founder, affiliate, and admin views. |

Test cards must never appear in production UI or be available to real users.

#### 18.7.10 Required end-to-end payment test cases

The following end-to-end tests must pass in test mode before launch.

**Listing fee tests**

1. Founder pays the calculated listing fee through Proovd platform Checkout.
2. Fee calculation covers every combination: US$35 base with zero completed items; each single US$2 item (Visuals, Branding, confirmed interview booking, Story, Socials); and all five items reaching the US$25 minimum with savings capped at US$10.
3. The interview discount applies only after a booking is confirmed; canceling a confirmed booking before payment recalculates the fee.
4. Listing fee is recorded as a Proovd direct charge, not a Connect campaign charge.
5. Listing fee receipt/confirmation email is sent.
6. Campaign-specific affiliate recruitment, private invitation, signup, and preparing-state association may occur before payment; successful payment activates the formal campaign opportunity and 72-hour response window without duplicating associations or notifications.
7. A qualifying listing-fee refund returns the entire Checkout charge actually paid—subtotal plus the associated Stripe Tax reversal/correction—once and records every object/amount.
8. Listing fee records remain separate from campaign application/platform fees.

**Idea Campaign (Pre-build) threshold-miss tests**

1. Backers reserve below threshold.
2. Cards are saved but not charged.
3. Campaign closes below threshold.
4. No PaymentIntent is created for those reservations.
5. Internal reservations close as no-charge and saved PaymentMethods detach where appropriate; successful SetupIntents remain historical and are not falsely marked canceled.
6. Backers receive no-charge confirmation.
7. Founder sees validation data, not payout eligibility.

**Idea Campaign (Pre-build) threshold-met tests**

1. Backers reserve enough to meet threshold.
2. The practical deduplication rule combines private normalized email/phone hashes, Stripe fingerprint where available, and device/IP risk signals; suspected duplicates reach Admin review. A shared IP alone never merges Backers, and every merge/separate decision is audited.
3. Campaign closes at or above the unique active-Backer threshold.
4. Close-date batch creates off-session PaymentIntents.
5. Successful charges count toward collected revenue; failed charges enter the 48-hour retry/update-card flow.
6. Card failures do not reverse the successful threshold outcome; the Founder proceeds with the amount collected after retry.
7. Proovd fee, Affiliate compensation, tax, and Founder share reconcile under §10.4.
8. The single Founder payment becomes eligible at Day 3 after retry, W-9, payment/risk checks, and recorded Admin approval.
9. No second Idea-Campaign payment object exists; Day 14 records are enforcement-only.

**Product Campaign (Pre-launch) close-date tests**

1. Backers reserve during the campaign window; each transaction contains one reward, and one Backer may create multiple Product transactions.
2. Backers can cancel before close at no cost.
3. Active reservations are charged on close date.
4. Missing an internal target does not refund successful charges.
5. Failed charges enter the fixed 48-hour retry/update-card window.
6. Successfully collected total drives founder/affiliate records.
7. Organic and affiliate-attributed reservations are separated.
8. A Creator-specific performance bonus uses only that Creator's captured attributed pre-tax subtotal or captured attributed-Backer count; organic, house, and other Creators' results do not trigger it.

**Idempotency tests**

1. Close-date batch is run twice manually.
2. Webhook events are delivered twice.
3. Worker crashes halfway through a batch and is re-run.
4. No reservation is charged twice.
5. No affiliate commission is created twice.
6. No duplicate emails are sent for the same final event.
7. Admin can see batch attempt history.
8. No fixed-payment funding/return/Transfer or Founder payment release is recorded twice.

**Founder payment and payout-control tests**

1. W-9 missing blocks every Day 3 founder payment: the Idea Campaign single payment and the Product Campaign first payment.
2. W-9 complete allows Day 3 review.
3. Idea Campaign: admin records single-payment (100%) eligibility, approval, and release at Day 3; no second payment object can be created.
4. Product Campaign: admin records Day 3 first-payment (40%) eligibility and release.
5. Admin records Day 14 Progress Check pass/fail.
6. Product Campaign Day 14 fail blocks the remaining payment and starts the refund/reversal workflow.
7. Idea Campaign Day 14 fail starts enforcement and best-effort recovery without any unreleased-payment refund path.
8. UI never describes payment controls as escrow/trust/custody.
9. Product Campaign early remaining payment cannot release before Day 3.
10. Product Campaign early remaining payment is blocked unless actual reward delivery/live access, backer communication, tax readiness, and a no-red-flags admin decision are recorded.
11. A Product Campaign early release does not skip the Day 14 status check or later fulfillment/ghost-ban monitoring.

**Onboarding, vetting, and campaign-type tests**

1. A personalized invitation opens a secure temporary draft without an account; no SMS OTP exists anywhere in the flow.
2. The path choice, Problem, Solution, and Competition appear one item at a time with progress, Back/Continue, and autosave; the possible-creator result completes before account creation. Provenance is stored for Problem/Solution prefills; Competition cannot be prefilled.
3. Campaign type locks at vetting submission; campaign setup shows it read-only.
4. A locked campaign type cannot change. The wrong-type campaign is archived and a new vetting record begins; no acceptance, reward, payment, or consent is silently migrated.
5. Draft-link revocation removes access immediately; an unclaimed draft follows the §14.6 retention rule.

**Campaign-specific affiliate signup and compact-flow tests**

1. Admin creates a campaign-specific affiliate prospect and sends a private invitation before the founder completes account claim.
2. The invitation allows that affiliate to create or claim only their own account and preserves the campaign association.
3. There is no open public affiliate signup and no generic post-payment pool-browsing requirement.
4. Affiliate onboarding uses a compact flow with no more than the two required primary actions: `Confirm and create account` and the Stripe-controlled `Finish payout setup`; it has no separate welcome, course, or custom banking pages.
5. Before `founder_signup_complete`, the affiliate sees only the completed-signup/waiting state and cannot accept terms or begin work.
6. `founder_signup_complete` makes the preparing campaign and its full single Campaign kit visible to every eligible, authenticated, privately invited pre-associated Affiliate exactly once under the logged/revocable trusted-cohort exception; no public or cross-campaign access exists.
7. Successful listing-fee payment makes the formal opportunity actionable and begins the 72-hour response window exactly once.
8. The formal campaign state has at most one primary and one secondary decision control; accept, decline, and propose-terms outcomes all remain reachable without separate onboarding pages.
9. The Campaign kit contains every required §6.2 item and does not require a separate resource-library, course, or splash-screen sequence.

**Temporary-draft security and retention tests**

1. Magic-link and temporary-draft raw tokens are generated with at least 128 bits of entropy, are delivered but never stored/logged, and only one-way hashes plus audit metadata remain at rest.
2. Altering any character in a valid draft token produces no access.
3. A token for Founder A cannot read or modify Founder B's draft.
4. A token cannot access admin, payment, connected-account, or other Founder records.
5. Resending an invitation invalidates the prior token immediately.
6. Claiming or revoking a draft invalidates every prior token.
7. Replaying a claimed, revoked, expired, or superseded token produces no access and exposes no Founder data.
8. Token/resend attempts are rate-limited and invalid-token responses do not enumerate an email, campaign, or account.
9. Two simultaneous account-claim attempts result in one successful claim and no duplicate account.
10. An unclaimed draft is deleted or anonymized 30 calendar days after the most recent invitation send.
11. Deletion/anonymization leaves the minimum required audit record without retaining the prefilled vetting content.

**Optional-item completion tests**

1. Each optional item qualifies only when its §5.8 completion rule is satisfied.
2. Empty files, placeholders, inaccessible URLs, unapproved story drafts, and unconfirmed interview slots earn no discount.
3. Every valid individual item independently reduces the fee by US$2.
4. Every combination produces the correct price, never below US$25.
5. Admin invalidation before payment records a reason and recalculates the fee.
6. Successful payment locks the completion evidence, discount calculation, high-effort result, and amount paid.

**Initial affiliate-roster readiness tests**

1. One accepted creator with an unresolved proposal does not make the initial roster launch-ready.
2. A pending creator not required for the launch roster does not block readiness after admin closes that consideration.
3. `affiliate_roster_status = launch_ready` only when at least one launch-roster creator has mutually accepted locked terms and every launch-roster requirement is resolved.
4. `review_ready` remains false while the initial roster is not launch-ready or campaign building is incomplete.
5. Zero eligible campaign-specific recruits or no mutually accepted locked proposal by the deadline produces `affiliate_roster_status = failed`, issues the full Checkout-charge refund including tax treatment, and never produces `review_ready`.
6. A late creator response after a failed/refunded no-acceptance outcome cannot silently reactivate the campaign.

**Proposal-version tests**

1. A creator request enters `awaiting_founder`.
2. Founder acceptance locks that exact version.
3. A founder revision enters `awaiting_creator` and creates no funding request.
4. Creator acceptance locks the founder's exact revised version.
5. Creator decline closes the revision without locking terms.
6. Creator countering creates a new version and supersedes the prior version.
7. Stale or simultaneous responses cannot accept two different versions.
8. No commission or fixed-payment record uses a proposal version that was not mutually accepted.
9. A proposal pending at the 72-hour deadline closes as `expired_no_acceptance`, does not pause/extend the deadline, and cannot block the refund.

**Parallel-track and readiness tests**

1. The formal affiliate response window and campaign building run in parallel after successful payment; neither is modeled as a post-payment general-pool search.
2. `review_ready` derives only when `affiliate_roster_status = launch_ready` and `campaign_build_status = complete`; Proovd review cannot start earlier.
3. High-effort status calculates correctly for all eight combinations of its three inputs and locks at successful listing-fee payment.
4. A Creator cannot begin work until every applicable §5.16 readiness item, including full fixed-payment funding where accepted, is complete.
5. A non-material review correction preserves Creator readiness; a material change to economics, work, dates, rewards, claims, delivery, refunds, channel rules, or fixed-payment conditions creates a new version and invalidates affected readiness until explicit reacceptance.

**Mid-campaign affiliate tests**

1. Admin can send a private campaign-specific invitation after the campaign is live and before it ends.
2. After signup, the live campaign appears immediately with its current Campaign kit, exact remaining time, and adjusted deliverables.
3. The new affiliate cannot promote until compensation is mutually accepted, agreements are accepted, readiness is complete, and the tracking link is active.
4. Adding the affiliate does not alter public campaign terms, existing creator compensation, or the completed initial-roster status.
5. `activated_at` is stored for the new tracking link; earlier visits, pre-orders, and charges are never attributed retroactively.
6. The affiliate's three-active-partnership cap is enforced.
7. An ended campaign rejects a new affiliate association.
8. A mid-campaign addition does not reopen Proovd review unless it requires a material public-campaign change.

**Compensation matrix and fixed Creator payment tests**

1. Each of the six §5.12 matrix cells resolves to the correct base percentage and bid eligibility.
2. An Idea Campaign rejects any fixed Creator payment request; a Product Campaign allows one regardless of high-effort status.
3. A percentage bid above base is possible only on high-effort campaigns and is capped at 50% total percentage including bonuses.
4. Accepted fixed-payment terms lock; the Founder funds the full exact amount before work begins; partial funding is rejected.
5. First-post verification records proof/compliance status and releases exactly US$0; it does not activate the campaign page.
6. The full fixed amount becomes eligible only after campaign close, the 48-hour retry window, and verification of every agreed deliverable; it is transferred with finalized commission.
7. If no valid compliant post exists, 100% of the fixed allocation returns to the Founder and the Creator earns no commission.
8. A valid compliant attributed post with incomplete later deliverables returns 100% of the fixed allocation, while genuine commission from compliant captured sales may remain.
9. Underperformance alone does not deny the fixed payment after full completion; fraud/invalid proof/self-dealing/false claims/material breach cancels unpaid invalid earnings and may create a negative balance after transfer.
10. Each Creator-specific bonus stores its unit, threshold, additional percentage, maximum combined percentage, and proposal version; only that Creator's captured attributed results can satisfy it.
11. The provisional Affiliate amount on each attributed charge uses the maximum locked base/bid/bonus percentage, never exceeds the 50% cap, and returns the unearned difference once after reconciliation.

**Manual good-effort thank-you tests**

1. No thank-you payment is calculated, promised, or shown as estimated campaign earnings.
2. Admin cannot approve one before all listing-fee refund rights for that campaign resolve or without the recorded Stripe/tax path.
3. An approved payment uses retained Proovd listing-fee revenue, never Backer charges, Founder share, commission, or fixed-payment funds.
4. Manual initiation stores reason, amount, recipient, Admin approval, Stripe object/status, tax/accounting treatment, and timestamp.
5. Duplicate Admin submission cannot create a second payment.

**Fixed-payment funding, completion, and Transfer-failure tests**

1. A failed funding payment creates no funded allocation and the creator remains blocked.
2. Retrying funding does not create a duplicate allocation or duplicate charge.
3. Partial funding is rejected.
4. Campaign or Creator-association cancellation before completion returns the funded amount once unless the full work was already completed and formally approved.
5. Duplicate first-post verification events release no money and create one verification record.
6. Duplicate completion approval or Transfer jobs create one Transfer only.
7. If no valid compliant post exists, the full fixed amount returns once and the Creator receives no commission.
8. A verified compliant post followed by incomplete later deliverables returns the full fixed amount while retaining only genuine compliant commission.
9. A returned or paid allocation cannot be returned or paid again.
10. Backer tax, campaign fees, Creator commission, and Proovd's 5% are never calculated from the fixed allocation.
11. A Transfer API failure records the synchronous error and retries idempotently; the system does not wait for a nonexistent `transfer.failed` webhook.
12. Live fixed-payment funding and Affiliate Transfers remain disabled until Stripe/legal approval and required test evidence are recorded.

**Launch-transition idempotency tests**

1. At `campaign_live_at`, the approved campaign page activates first and each scheduled tracking link activates once and already resolves to that page before the Creator publishes.
2. The Creator publishes and submits the public URL after page/link activation; verifying the same post twice creates one verification state and no duplicate live transition.
3. Duplicate verification webhooks or Admin submissions create one verification notification and release no fixed-payment money.
4. A correction-needed or rejected post pauses that Creator's link and blocks invalid earnings from finalizing but does not reverse or duplicate the campaign-page launch.
5. No campaign/link activates while any pre-launch readiness requirement remains incomplete; post verification itself is not the page-launch trigger.

**Live-campaign event tests**

1. New pre-orders, cancellations, and net change are stored separately and reconcile to the reservation ledger.
2. An Idea Campaign that crosses the threshold and later falls below it produces one `threshold reached` and one `threshold lost` event, each with a single notification.
3. `Campaign ended` and `Results ready` fire as separate events; no Day 3 / Day 7 / Day 10 scheduled check-in email exists.
4. Glance shows the current active-pre-order count and exact last-visit delta, including a truthful zero-change state; a failed/partial page response does not advance `last_seen_at`.
5. Act shows only the highest-ranked real action or the caught-up done-moment; it never manufactures a generic check task.
6. Explore preserves every §5.17 metric and freshness timestamp without rendering a Founder widget grid.
7. Non-material live edits publish with version history; material claim/reward/price/date/delivery/refund/Creator-term edits cannot publish without Admin review and any required reacceptance.

**Tax, amount, and money-waterfall tests**

1. Checkout calculates and displays reward subtotal, sales tax added on top, and exact total authorized before SetupIntent confirmation.
2. The reservation-time Tax calculation ID, `expires_at`, and exact authorized total are stored. At close, the same usable calculation and exact total are linked/reused under the approved integration; no tax recalculation or reconsent state exists.
3. An expired, invalid, mismatched, or unusable calculation creates no PaymentIntent, records `tax_calculation_unusable`, and sends the required notices; it never substitutes another amount.
4. Proovd's 5%, Affiliate commission, Creator-specific bonus, Idea threshold, and US$50,000 cap all exclude sales tax.
5. Direct-charge reconciliation separately records reward subtotal, tax, total captured, Proovd fee, provisional/final Affiliate amounts, Founder gross share, and Stripe processing fee.
6. The Founder connected account bears Stripe processing fees in the preferred direct-charge test path; any backup allocation follows only the approved recorded configuration.
7. Reservation-time calculation ID/expiry, US location inputs, taxability reason, exact consent, close usability check, charge, refund, and reporting records reconcile; `not_collecting` cannot silently pass a required-registration gate.
8. The controlled pilot cannot accept live card details until legal/tax registration, product-code, calculation-validity, filing-responsibility, and Stripe-architecture gates are signed off.

**Pre-order cardinality and campaign-cap tests**

1. One Idea Backer cannot hold two active pre-orders under the practical key. Linked identity/risk signals create a review case; a shared IP alone does not collapse two Backers, and Admin merge/separate decisions update the threshold once with a complete audit.
2. Changing an Idea reward replaces the active selection only after updated subtotal/tax/total consent succeeds; failure leaves the prior selection intact.
3. One Product Backer can create multiple transactions, each with one reward and separate consent/cancellation status; unique Backer count remains one.
4. Product unit count and revenue include all active/captured transactions.
5. Two simultaneous transactions near the US$50,000 pre-tax cap cannot both pass if their combined value exceeds it; the atomic check accepts only valid capacity and rejects or waitlists the rest.

**Attribution tests**

1. The last valid Affiliate link before pre-order wins on the same browser/device.
2. A later valid Affiliate click replaces an earlier Affiliate cookie; a direct return without a new Affiliate link preserves the current attribution.
3. The cookie expires at `campaign_close_at`; no cross-browser or cross-device claim is made.
4. A link clicked before its `activated_at` or after campaign close creates no payable attribution.
5. A mid-campaign Affiliate receives no retroactive attribution.
6. Traffic and captured charges after `activated_at` remain provisional until public-post verification; rejection prevents invalid earnings from finalizing without changing `campaign_live_at`.
7. Commission and Creator-specific bonuses use only successfully captured pre-tax subtotal or captured Backer count bearing that Creator's valid attribution.

**Reservation cancellation and SetupIntent tests**

1. Canceling a reservation prevents PaymentIntent creation and detaches the PaymentMethod where appropriate without rewriting a successful SetupIntent as canceled.
2. If the same PaymentMethod supports another active Product transaction, canceling one transaction leaves the other usable while removing the canceled transaction's charge authority.
3. `setup_intent.canceled` is handled only for an intent canceled before success; `payment_method.detached` and the internal cancellation event reconcile separately.
4. Threshold miss and pre-charge campaign kill create no PaymentIntent and no refund object.
5. Cancellation, threshold miss, and kill notifications remain idempotent.

**Affiliate connected-account, Transfer, and payout tests**

1. Affiliate signup stores age/country/state eligibility and launches Stripe-controlled identity, tax, bank, and transfer-capability onboarding without a custom Proovd bank form.
2. An incomplete or restricted Affiliate connected account may view a preparing campaign but cannot activate a tracking link or receive a Transfer.
3. The Affiliate never processes the Backer charge and never receives campaign money before Admin creates the post-close Transfer.
4. Commission, bonus, and eligible fixed Creator payment combine into one campaign-specific Transfer after the 48-hour retry and completion review.
5. Provisionally collected Affiliate percentage compensation is never Proovd revenue; earned amounts transfer to the Affiliate, while unearned/untransferred amounts return to the Founder through the approved application-fee adjustment path.
6. Transfer created/updated/reversed and payout paid/failed states reconcile to the internal record; synchronous creation failures retry idempotently.
7. Stripe recipient, Transfer, payout, provisional liability, return, and any negative balance remain auditable for accounting and tax reporting.

**Eligibility, agreement, and access-duration tests**

1. Founder signup stores date of birth/country/state; Affiliate signup stores date of birth/country/state plus explicit 18+/US confirmation; Backer checkout requires an unchecked 18+ confirmation and rejects any non-US billing country for the controlled pilot.
2. Backer identity documents are not collected by default; a recorded risk case is required to request additional verification.
3. The per-campaign IP/confidentiality click acceptance binds the Creator only; the Founder is governed by the separately versioned Founder Terms.
4. A Backer magic link remains valid through fulfillment/final resolution plus 180 days and is not invalidated by Founder or Affiliate payment.
5. Admin can revoke and reissue a compromised link without exposing another Backer's record.
6. A saved pre-order immediately shares the disclosed Backer email/purchase details with the Founder for fulfillment preparation/support; cancellation adds `do not fulfill` and never grants marketing/research permission without the separate opt-in.

**Admin state, timestamp, and security tests**

1. `listing_paid_at`, `campaign_live_at`, and `campaign_close_at` independently anchor every applicable deadline and are never inferred from a generic created/updated timestamp.
2. `changes_required`, `creator_replacement`, `refunded_no_creator`, `closed_reconciling`, and `closed_resolved` enter and exit only through their documented rules.
3. `retrying`, `founder_payment_eligible`, `founder_payment_paid`, `affiliate_earnings_adjusted`, `affiliate_transfer_eligible`, and `affiliate_transfer_paid` remain separate, timestamped flags.
4. User/Stripe-supplied data appears automatically in Admin; manual review never requires re-entry and every override keeps prior value, actor, time, and reason.
5. Admin MFA is required. Money, refund, connected-account, and kill/suspend actions require recent reauthentication and create immutable audit entries.
6. `creator_failure_recorded_at` creates one exact replacement due timestamp under the configured US business-day calendar; retries or later edits cannot silently reset the three-business-day window.

**Descriptor tests**

1. The actual computed connected-account descriptor passes Stripe length/character validation in test mode.
2. Campaign, checkout, reminder, receipt, magic-link, and evidence surfaces display the same computed value.
3. No customer-facing surface hardcodes `PROOVD*[FOUNDERHANDLE]` when the actual charge uses another value.

**Work-again request tests**

1. A creator cannot receive a work-again request before the campaign ends.
2. A creator with no verified post is ineligible.
3. A creator with unresolved deliverables is ineligible.
4. A creator with an unresolved fraud, invalid-proof, material-breach, or compliance case is ineligible.
5. A creator with verified work but zero attributed sales can still qualify.
6. Only admin can assign `successfully_completed`, and the decision stores evidence and timestamp.
7. A later correction to the completion status immediately changes work-again eligibility without deleting the audit history.
8. A founder can send a work-again request only for a creator whose participation record for that founder's ended campaign is `successfully_completed`.
9. The request routes through Proovd; the creator can accept or decline; the outcome is stored and notified.
10. An accepted request creates no campaign and bypasses no one-active-campaign, cooldown, or readiness rule.

**Refund, reversal, and dispute tests**

1. Backer cancels before close: no refund object needed because no charge occurred.
2. Idea Campaign voluntary/change-of-mind refund after a valid charge is rejected, while duplicate/wrong/after-cancellation/unauthorized, material misrepresentation, applicable non-delivery, serious-violation kill, and law/Stripe/card-issuer exceptions route correctly.
3. Product Campaign consent preserves the exact Founder refund-policy text or snapshot, URL, version, and effective date; a later website edit cannot alter an existing transaction.
4. Backer refund after charge creates/records the Stripe refund and a cause classification.
5. Founder/product-caused refund leaves finalized valid Affiliate earnings intact, cancels only unfinalized earnings on the transaction, and assigns the refund to the Founder.
6. Affiliate-caused fraud/fake-traffic/self-dealing/false-claim/invalid-proof refund cancels unpaid earnings and creates a negative balance/recovery record if already transferred.
7. Proovd/system-caused error returns the Proovd fee where appropriate and does not debit an unrelated Affiliate.
8. A Backer dispute unrelated to Affiliate conduct follows the Founder charge context without an automatic Affiliate clawback.
9. Proovd's 5% stays retained on a Founder/product refund unless Proovd elects, Stripe requires, or law requires otherwise; every exception is recorded.
10. Campaign kill before charge closes reservations without charges; campaign kill after charge creates/refers to refund/reversal records.
11. Dispute event creates an evidence-packet task containing consent, tax/amount details, campaign disclosures, policy version, reservation, charge, delivery/support records, and Founder identity/MoR disclosure.
12. Signed consent is treated as evidence, not as a waiver of legal, network, Stripe, or card-issuer rights.

**Listing-fee and replacement tests**

1. The 72-hour no-acceptance clock starts exactly at `listing_paid_at`; a pre-payment invitation does not start it.
2. Only mutually accepted locked terms count; a pending proposal at the deadline closes without pausing/extending the clock.
3. Zero eligible recruits or no locked acceptance within the window refunds the full Checkout total—subtotal plus associated tax reversal/correction—with no deduction.
4. A launch Creator failure before live records `creator_failure_recorded_at`, enters `creator_replacement`, and calculates one exact three-US-business-day due timestamp; a fully ready replacement by that time continues the campaign.
5. No ready replacement by the stored deadline produces `refunded_no_creator`, returns any funded fixed-payment allocation, and refunds the full Checkout total including tax treatment.
6. Founder cancellation within 48 hours of `listing_paid_at` refunds the full Checkout total only if the campaign is not live; later/live cancellation requires Admin review.

#### 18.7.11 Test data reset and documentation

Before live mode, engineering must maintain a short internal test log with:

- Stripe sandbox used.
- Test connected account IDs.
- Test campaign IDs.
- Test reservation IDs.
- Test PaymentIntent IDs.
- Test webhook endpoint used.
- Test cards/scenarios used.
- Pass/fail status for each required scenario.
- Known limitations caused by Stripe approval status or sandbox limitations.

If test data is deleted from Stripe, the corresponding internal test records must either be deleted from the dev database or clearly marked as invalid test artifacts.

#### 18.7.12 Live-mode readiness gate

The app may not switch any campaign to live-mode payment processing until all of the following are true:

- Stripe approval path is confirmed for the selected architecture.
- Stripe has confirmed the Founder charge/application-fee path, Affiliate connected-account and Transfer path, fixed Creator payment funding path, fee/refund/dispute allocation, tax behavior, and descriptors in writing.
- Legal/tax review has confirmed seller responsibility, US pilot scope, registrations, product tax codes, location inputs, reservation-time calculation validity/reuse, filing, and the exact Backer consent/charge treatment.
- The selected architecture is implemented in test mode.
- Required webhook events are receiving and verifying signatures.
- Direct-charge path passes test mode, or the approved backup path passes test mode if Stripe requires backup.
- Test cards cover success, decline, authentication, insufficient funds, setup failure, refund, and dispute scenarios.
- Idempotency tests pass.
- Sample campaigns demonstrate consent and no-charge-today behavior.
- No live keys exist in dev/staging environments.
- No test keys exist in production/live-payment environment.
- A human admin has reviewed the Stripe Dashboard test results against Proovd's internal ledgers.
- The first live enablement is limited to one controlled pilot campaign with named monitoring and rollback owners.

---

## 19. MVP acceptance checklist

The MVP is ready for Stripe review and first MVP campaign execution only when all of the following are true:

### Stripe/platform

- Proovd main Stripe account exists for listing fee.
- Connect platform account setup path identified.
- Stripe test/sandbox environment variables configured and mode-safe.
- No live Stripe keys exist in dev/staging.
- No test Stripe keys exist in production/live-payment environment.
- Stripe API version is locked and documented.
- Founder Standard connected account onboarding works or is mocked for sample.
- Test Founder Standard connected account exists in Stripe sandbox.
- Platform webhook endpoint works and verifies signatures.
- Connected-account webhook handling works where required.
- Stripe CLI or equivalent local webhook forwarding works.
- Preferred/backup architecture wording appears consistently.
- No escrow/trust/custody wording exists in UI.
- Website trust strip live.
- Policy pages live.
- Sample campaigns live.
- Support footer live.
- Separate canonical legal-policy files are complete, published, and consistent with this MVP.
- Private identity, tax, banking, passport, and residential data exist only in approved secure records and Stripe's authenticated collection flows, not in this document or the public website.
- Affiliate connected-account, Transfer, payout, reversal, negative-balance, and tax-reporting behavior has been confirmed with Stripe before live Affiliate payments are enabled.
- Test Affiliate connected account exists with the required transfer capability.
- The provisional Affiliate percentage liability is separate from Proovd revenue; test reconciliation proves the earned amount Transfers once and the unearned/untransferred amount returns once to the Founder through the approved adjustment path.
- The maximum locked base/bid/Creator-specific bonus percentage is provisioned correctly and the unearned bonus difference returns once.
- Any manual thank-you payment path is separately approved by Stripe/tax counsel or remains disabled; it is never promised as campaign earnings.
- Tax-exclusive Backer totals, reservation-time Stripe Tax calculation validity/reuse, exact authorization, unusable-calculation no-charge outcome, and pre-tax percentage bases pass test mode and legal/tax review.

### Campaign mechanics

- Idea Campaign (Pre-build) and Product Campaign (Pre-launch) types exist.
- SetupIntent pre-order flow works.
- Off-session capture batch works in test mode.
- Required test card scenarios pass: success, decline, insufficient funds, authentication required, expired card, setup failure, processing error, refund, and dispute.
- Direct-charge test path passes in the connected-account context, or the approved backup path passes if Stripe requires backup.
- Backup separate-charges-and-transfers path is testable or explicitly blocked only by Stripe approval status.
- Close-date batch idempotency passes duplicate-run, duplicate-webhook, and crash/retry tests.
- Failed-payment retry flow exists.
- Failed-payment retry window is fixed at 48 hours and anchors Day 3 reconciliation.
- Backer cancellation before close works.
- Idea Campaign threshold miss triggers no charge.
- Product Campaign close-date capture works.
- Idea one-active-pre-order/practical unique-Backer review and Product multiple-one-reward-transactions behavior work.
- Non-US Backer billing locations are rejected for the controlled pilot.
- US$50,000 aggregate pre-tax active-pre-order cap is atomic under concurrent requests.
- Scheduled campaign page and tracking links activate before Creator publication; last-valid-link, same-browser/device attribution works through campaign close, excludes pre-activation traffic, and remains provisional until post verification.
- Public page shows MoR disclosure.
- Checkout consent stored.

### Founder

- Personalized invitation and secure temporary draft work; vetting and the possible-creator result complete before account creation.
- Vetting and campaign building present one item at a time with progress, Back/Continue, and autosave rather than an endless scrolling form.
- Prefilled account claim works with per-field provenance; no SMS OTP exists anywhere.
- Campaign type locks at vetting submission and is read-only afterward.
- A wrong locked type archives the campaign and starts new vetting; no type migration exists.
- Founder interview scheduling works end-to-end with confirmation, reminder, reschedule, and cancellation notifications.
- High-effort calculation and the calculated listing fee (US$35 base, US$2 discounts, US$25 minimum) work for every combination.
- Stripe connected account status stored; onboarding completes before listing-fee checkout.
- Campaign-specific affiliates may be recruited, invited, signed up, and pre-associated before founder account claim completes.
- Founder account claim emits `founder_signup_complete` and exposes the preparing campaign to its pre-associated affiliates.
- Listing fee checkout works, and successful payment activates the formal affiliate response window.
- Parallel affiliate-roster and campaign-building tracks work; review readiness derives from both.
- Campaign setup works through the one-decision-at-a-time sequence.
- Preview works.
- Submit/review loop works.
- Material review changes invalidate affected Creator readiness and require explicit acceptance of the new version; non-material corrections do not.
- Optional-item completion criteria are implemented and tested for every discount input.
- Initial affiliate-roster readiness uses the explicit §5.15 rule; no undefined `required creator` condition remains.
- The founder can see pre-associated, reviewing, accepted, declined, proposed, active, and mid-campaign-added affiliate states without browsing or contacting the general pool.
- The Founder campaign home implements the complete Glance/Act/Explore contract: one large active-pre-order count, truthful last-visit delta, threshold/end/freshness context, one ranked real action or caught-up ending, and complete secondary Explore data without a widget dashboard.
- Threshold reached/lost events work for Idea Campaigns.
- W-9 status block exists post-close.
- Campaign-specific founder payment statuses work: Idea single payment; Product first and remaining payments.
- Post-campaign work-again requests work.

### Affiliate

- Private campaign-specific invitations allow affiliates to create or claim their own accounts; there is no open public signup or generic admin-created credential flow.
- Compact onboarding uses only `Confirm and create account` and, when required, `Finish payout setup`, with no custom Proovd bank form or education-page sequence.
- Before founder signup completes, the affiliate receives a clear no-action-needed waiting state on the same surface.
- The preparing campaign appears automatically at `founder_signup_complete`; the formal decision activates at successful listing-fee payment.
- One attached full Campaign kit contains every required campaign-specific support document and asset without creating a resource-library or multi-page splash sequence; preparing-state access is limited to authenticated, privately invited Affiliates and is logged/revocable under the trusted-cohort exception.
- AUP acceptance works.
- Campaign opportunities work for initial and mid-campaign recruits.
- IP agreement acceptance works.
- Tracking links work.
- Creator proposals (percentage bids and optional fixed Creator payment requests) route to the Founder for decision with Admin oversight.
- Founder revisions require explicit creator acceptance before terms lock.
- Pending proposals do not pause or extend the 72-hour deadline and close without acceptance at the no-acceptance outcome.
- First-post and deliverable verification works.
- Fixed Creator payment funding before work, US$0 first-post release, full-completion eligibility, return, and post-close Transfer statuses work.
- The fixed-payment funding/Transfer architecture is approved, recorded, idempotent, and tested before live arrangements are enabled.
- Commission and Creator-specific bonus records work per the §5.12 matrix and only use that Creator's captured attributed results.
- Affiliate Stripe connected-account onboarding, Admin-approved Transfer, payout-status, and failure/reversal flow work.
- Work-again requests are visible and answerable.
- Work-again eligibility derives from the recorded `successfully_completed` status.
- Mid-campaign affiliates receive remaining-time deliverables, clear readiness requirements, and a new tracking link whose attribution begins at activation with no retroactive credit.

### Backer

- Campaign page is readable without auth.
- Reservation flow saves card but does not charge.
- Checkout requires 18+ confirmation and a US billing location, calculates tax on top at reservation, and stores reward subtotal, tax, calculation expiry, exact total authorized, and billing-location evidence.
- Idea one-active-pre-order/unique-Backer and Product multiple-one-reward-transactions rules work.
- Confirmation email/magic link works.
- Magic-link page shows reservation.
- Cancel before close works.
- Update card during retry works.
- Support form routes correctly.
- Mandatory immediate post-reservation Founder sharing for fulfillment preparation/support and separate unchecked optional Founder marketing/research/survey consent are enforced; cancellation adds `do not fulfill` without creating marketing permission.
- Magic links remain usable through fulfillment/final resolution plus 180 days unless revoked and reissued; raw tokens are never stored or logged.

### Admin

- Invitation records and sending/revocation controls work.
- Magic-link and temporary-draft entropy, hash-only storage, rate limiting, non-enumeration, expiration, rotation, replay protection, and 30-day draft deletion/anonymization pass their acceptance tests.
- Campaign review works, gated on the initial affiliate roster being launch-ready and campaign building being complete.
- Campaign-specific affiliate prospect, invitation, association, launch-roster, and mid-campaign activation records work.
- User and Stripe records auto-populate Admin; manual notes and overrides preserve a complete audit trail.
- MFA and reauthentication protect money, refund, connected-account, and kill/suspend actions.
- Creator-readiness checklist tracking works.
- Review-change materiality and Creator reacceptance records work.
- Reservation ledger works.
- Charge batch dashboard works.
- Failed payments visible.
- 48-hour retry and `closed_reconciling`/`closed_resolved` state transitions work.
- Affiliate connected-account, earnings-adjustment, Transfer, and payout records work.
- Admin can reconcile the provisional Affiliate percentage amount, verified earned amount, Transfer, and any return-to-Founder application-fee adjustment without treating the provisional amount as Proovd revenue.
- Admin can reconcile Creator-specific bonus triggers/provisional maximums and any manual Proovd-funded thank-you payment as a separate expense.
- Refund/reversal records exist.
- Dispute evidence archive exists.
- Kill/suspend switch works.
- Founder payment-schedule tracking works for both campaign types.
- Product Campaign early remaining-payment review is evidence-gated, admin-only, logged, and tested.
- First MVP campaign configured without campaign-specific code paths.
- Stripe test-run log exists with sandbox IDs, connected account IDs, test campaign IDs, PaymentIntent IDs, webhook endpoint, scenarios, and pass/fail status.

### Customer experience

- Every waiting/review/payment/recovery state states what happened, next step, owner, next-update time/SLA, available action, and support route.
- Founder forms visibly autosave, restore drafts, preserve fields after errors, and warn on unsaved exit.
- Listing-fee checkout and confirmation show line items, each itemized US$2 discount, descriptor, refund promise, receipt, and next steps.
- Every qualifying `full` listing-fee refund visibly returns the Checkout subtotal and associated sales-tax reversal/correction.
- The Founder's Affiliate-roster state shows recruited/sign-up/response progress and the 72-hour outcome measured from formal-opportunity activation; pending proposals are explicitly not accepted and do not extend the deadline.
- Affiliate signup and campaign availability never become a multi-page education flow; Proovd and Stripe-controlled states each expose only the one required primary action and at most one secondary help/exit action.
- All affiliate guides, disclosures, campaign materials, payment explanations, and support live in the single Campaign kit.
- Affiliate opportunity cards include `Why this fits your audience` and a 60-second summary.
- Accepted/countered affiliate terms produce a durable plain-language confirmation; tracking links and disclosure templates have working copy confirmation.
- The campaign page and tracking links are live before scheduled Creator posts; verification status explains that post review affects provisional earnings, not whether the campaign page exists.
- Affiliate earnings distinguish estimated, finalized, approved for transfer, transferred, paid out, payout failed, and adjusted; any unpaid state shows its reason and next owner.
- Checkout shows the Today → Trigger → Delivery summary using the selected reward, pre-tax subtotal, tax, and exact authorized total.
- Checkout and confirmation state that the Founder receives email/purchase details immediately for fulfillment preparation/support even though no charge occurs today.
- Pre-order success states `you were not charged` and repeats amount, trigger, reward, delivery, seller, descriptor, and cancellation path.
- Pre-charge reminder is sent approximately 24 hours before every still-active scheduled charge without duplication.
- Cancellation always produces on-screen and email proof that the reservation was canceled and no charge occurred.
- Charge, retry, cancellation, refund, and deadline dates render in local time with UTC as secondary detail.
- Failed-payment recovery uses plain language, states whether money moved, preserves reward/amount, and shows one update-card action and deadline.
- Invalid/revoked magic links show a safe recovery route rather than a blank/generic error.
- Comments do not expose a backer's email local-part by default.
- Admin customer timeline joins existing status, payment, email, support, fulfillment, and admin-action records.
- Support cases have a stable reference, owner, SLA due time, next promised update, and context-preserving reply path.
- High-impact transactional emails are previewed with final variables; duplicate events do not create duplicate customer messages.
- Mobile and keyboard/screen-reader QA covers the founder form, affiliate decision flow, campaign page, checkout, magic-link page, and support form.
- The four-number Founder-loop scoreboard is instrumented from existing events; the first 10 invited Founders establish the explicitly labeled controlled-pilot baseline for time to first magic, Founder completion, return after closure, and next-action correction rate.
- Appendix H P0 test cases pass for the first MVP campaign.

### First MVP campaign

- Campaign type confirmed before final copy.
- Product or feature scope confirmed before final copy.
- Delivery month/year locked for every reward package.
- Reward tiers drafted after founder discovery.
- Larger affiliates/distribution partners sourced where appropriate for the campaign vertical.
- Student/network/non-creator affiliates sourced where appropriate for the campaign vertical.
- Affiliate disclosure uses the specific founder/product name, not Proovd, unless Proovd itself is the promoted product.
- Organic, house-channel, and affiliate-attributed revenue tracked separately.
- Case-study data plan ready.

---

## 20. Final product stance

This MVP is a Stripe-reviewable, founder-as-merchant-of-record, affiliate-distributed pre-order platform for digital products.

For founders, it tests whether strangers care enough to reserve or buy before months of overbuilding.

For affiliates, it creates a vetted, fair, trackable way to recommend early products without sacrificing audience trust for pure commission risk.

For backers, it makes the seller, delivery promise, charge timing, cancellation rights, refund route, and support process clear before they authorize payment.

For Stripe, it presents one consistent story: Proovd is a software platform hosting vetted third-party digital-product campaigns through Stripe Connect, using SetupIntent reservations, off-session PaymentIntents, founder Standard connected accounts, disclosed campaign-specific payout controls, strict AUP alignment, and manual review to reduce risk.

---

## Appendix A — Critical exact copy blocks to implement

These blocks are copied into this features file because they are not optional implementation notes. They are product requirements for Stripe review and for clean backer consent.

### A.1 Homepage trust strip

```text
How Proovd works behind the scenes.

Proovd is a software platform for vetted-founder crowdfunding,
operated by Proovd LLC (Delaware, USA). Every founder is vetted
before launch. Proovd recruits content creators / affiliates / marketers for each specific campaign, and every campaign is manually reviewed by our team.
Every reward package on every campaign discloses a delivery month and
year.

Backers' cards are not charged until an Idea Campaign meets its
order threshold or a Product Campaign reaches its disclosed close
date. Successful campaign charges will be processed through Stripe
Connect on the founder's Stripe Standard connected account using the
Connect configuration Stripe approves for Proovd before live launch.
If Stripe requires the documented backup configuration instead,
Proovd will use that configuration. Proovd does not accept live
pre-orders until the applicable configuration has written approval.
The founder remains the merchant of record on every transaction.

Our Acceptable Use Policy mirrors Stripe's Prohibited and Restricted
Businesses list verbatim.

Read more about how payments work →  proovd.co/how-payments-work
Read our full safety controls →  proovd.co/safety
```

### A.2 Campaign-page merchant-of-record block

Visible above CTA:

```text
Sold by [FOUNDER LEGAL NAME] of [FOUNDER ENTITY or "sole proprietor"],
[FOUNDER COUNTRY]. Proovd is the platform, not the seller.
[How this works ↓]
```

Expanded on click:

```text
[FOUNDER LEGAL NAME] is the merchant of record for every transaction
on this campaign and is solely responsible for delivering the rewards
described above and complying with all applicable laws in their
jurisdiction.

Payments are processed by Stripe through Stripe Connect. Successful
pre-order charges will be processed on [FOUNDER LEGAL NAME]'s Stripe
Standard connected account using the Connect configuration Stripe
approves for Proovd before live launch. If Stripe requires Proovd to
use the documented backup configuration instead, funds will be
processed through that configuration and released according to the
same disclosed schedule. Proovd does not accept live pre-orders until
the applicable configuration has written approval. Proovd LLC acts
only as the software platform that hosts this campaign;
Proovd LLC is not the merchant of record and does not take title to
any digital reward sold on this campaign.

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

### A.3 Idea Campaign checkout consent block

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
  US$[TOTAL AUTHORIZED]
  on or shortly after [CLOSE DATE — UTC], if and only if the campaign
  reaches its order threshold of [ORDER THRESHOLD] unique Backers with
  active pre-orders at [CLOSE DATE — UTC]. The threshold measures valid
  purchase commitments at close; it does not guarantee that every saved
  card will later succeed.
- The total above includes the sales tax calculated when you authorize.
  The later charge will occur only if that same tax calculation remains
  usable for the exact total shown above. If it is not usable, you will
  not be charged; Proovd will not substitute a different total.
- If the campaign does not reach the threshold by [CLOSE DATE — UTC],
  no charge will occur, your saved card will be detached from this
  campaign, and you will not be billed.
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
[ ] (unchecked by default) Send me Proovd's monthly newsletter about
new campaigns.

[Authorize pre-order]
```

### A.4 Product Campaign checkout consent block

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
  US$[TOTAL AUTHORIZED]
  on [CLOSE DATE — UTC] for the reward package "[REWARD PACKAGE NAME]"
  described on the campaign page above.
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
- I understand this is a pre-order for an early-stage product or
  feature launch. Delivery is on the disclosed timeline above; in the
  uncommon event of material delay or the rare event of non-delivery, the refund
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
[ ] (unchecked by default) Send me Proovd's monthly newsletter about
new campaigns.

[Authorize pre-order]
```

If an approved campaign proposes to share another field with the Founder for a non-fulfillment purpose, the separate unchecked optional consent must name that exact field and purpose. Mandatory fulfillment/support sharing is limited to the Backer email and purchase details actually required to deliver and support the digital reward.

### A.5 Listing-fee checkout consent block

```text
By clicking Agree and Pay, you agree to pay Proovd LLC a one-time
listing fee of US$[X] plus applicable sales tax, and you agree to
our Terms of Service, Acceptable Use Policy, Refund Policy,
Fulfillment Policy, and Privacy Policy. Your statement will show
"PROOVD LISTING." Questions: support@proovd.co.

Proovd will refund the entire amount charged at this Checkout — the
listing-fee subtotal plus the associated sales-tax reversal or
correction — if no eligible campaign-specific Creator is recruited,
or if no Creator and Founder mutually accept locked campaign terms
within 72 hours after this payment succeeds. A pending proposal does
not pause or extend that deadline. The same full refund applies if a
required launch Creator later fails and Proovd does not make a fully
ready replacement available within three U.S. business days after the
failure is recorded.

[ ] (unchecked by default) Send me Proovd's monthly newsletter about
new campaigns.

[Agree and Pay US$[X]]
```

### A.6 Footer support block

```text
Contact Proovd
Email: support@proovd.co
We respond within one (1) business day, Monday–Friday, excluding U.S.
federal holidays.
Postal: Proovd LLC, 254 Chapman Rd, Ste 208 #27541, Newark, DE 19702,
USA.

Legal
Terms of Service · Privacy Policy · Cookie Policy · Refund Policy ·
Fulfillment Policy · Acceptable Use Policy ·
Stripe Connected Account Agreement · How payments work · Safety
```

### A.7 Sample-campaign banner

```text
Sample campaign — for platform demonstration. No payment information is collected.
```

---

## Appendix B — Product shorthand glossary

Use this glossary internally so product, engineering, support, and ops do not drift.

- **Pre-order / active pre-order:** Customer-facing name for a backer’s pre-charge commitment after SetupIntent succeeds. A saved pre-order is purchase intent tied to a payment method and a future charge rule; it is not collected money.
- **Reservation:** Internal ledger/payment term for the same record (§10.3); not used in customer-facing copy.
- **Captured charge:** A successful off-session PaymentIntent after the threshold/close trigger.
- **Idea Campaign (internal: Pre-build):** Idea-validation campaign where charge occurs only if the order threshold is met. Chosen through `I have an idea`.
- **Product Campaign (internal: Pre-launch):** Live/near-launch product campaign where active pre-orders charge on close date. Chosen through `I have a product`.
- **Order threshold:** The integer number of unique Backers with active Idea-Campaign pre-orders at close. One Backer contributes at most one active pre-order and may change the reward before close. Canceled pre-orders do not count. Payment failures after close do not reverse a successful threshold outcome.
- **Internal target:** Product Campaign momentum goal, not a funding gate.
- **Possible creators:** The pre-account count of creators who may be relevant to a campaign (§5.4). Not a guarantee, not a list of names, and not an acceptance. Campaign-specific recruitment and pre-association may already be underway.
- **Campaign-specific affiliate prospect:** An affiliate recruited for one identified founder/campaign and privately invited to sign up before launch, including before the founder finishes signup.
- **Initial affiliate launch roster:** The affiliates whose accepted terms and readiness are required for the first campaign launch. It does not prevent later mid-campaign additions.
- **Campaign kit:** The single attached collection of campaign-specific briefs, assets, disclosures, claims, deliverables, tracking, proof, compensation/payment explanations, agreements summary, and support required by §6.2.
- **High-effort campaign:** A campaign with no Visuals, no Branding, and no scheduled/confirmed founder interview at calculation time (§5.8). Only high-effort campaigns expose percentage bidding above the base.
- **Founder share:** Captured pre-tax reward subtotal owed/releasable to the Founder after Proovd fee, Affiliate percentage compensation, applicable adjustments, and Stripe fees allocated under the approved architecture. Sales tax is separate.
- **Single Founder payment:** Idea Campaign payout — 100% of the eligible founder share payable at Day 3 post-close after W-9, payment/risk checks, and recorded admin approval.
- **First payment / remaining payment:** Product Campaign payouts — 40% at Day 3 and 60% at Day 14 by default, with the narrow evidence-gated early-release exception (§11.3).
- **Platform/application fee:** Proovd’s 5% fee from successful campaign charges through Connect where supported.
- **Listing fee:** Separate founder charge processed on Proovd’s main Stripe account, calculated as US$35 base minus US$2 for each completed optional item (Visuals, Branding, confirmed interview booking, Story, Socials), capped at US$10 in savings, with a US$25 minimum. Post-MVP pricing is undecided.
- **Payout controls:** Stripe-approved controls that prevent founder payout before the applicable campaign-specific schedule conditions.
- **Backup SCT:** Separate charges and transfers with `on_behalf_of` set to the founder’s Connected Account where supported/approved.
- **Creator:** Founder-facing name for a campaign-specific affiliate/distribution partner (§2.5).
- **Affiliate / distribution partner:** Any approved creator, operator, educator, community owner, student affiliate, network distributor, or niche marketer promoting a campaign.
- **Optional fixed Creator payment:** Product-Campaign-only, Creator-requested, Founder-accepted flat amount, funded in full before work begins, releasing US$0 at first post, and payable with finalized commission only after campaign close, the 48-hour retry window, and verification of every agreed deliverable (§6.10). It sets that Creator's base commission to 20% and sits outside the 50% percentage ceiling.
- **First-post verification:** Admin approval that a Creator's first campaign promotion is public and compliant. It establishes proof/compliance status after the campaign page is already live and releases no fixed Creator money.
- **Affiliate Transfer:** The Admin-approved Stripe Transfer of finalized commission, bonus, and any eligible fixed Creator payment to the Affiliate connected account after close and reconciliation.
- **Tax-exclusive total:** The Backer-authorized total consisting of reward subtotal plus sales tax. Proovd and Affiliate percentages apply only to the pre-tax reward subtotal.
- **Creator-readiness gate:** The §5.16 checklist a creator must clear before beginning work.
- **Work-again request:** A founder's post-campaign request, routed through Proovd, to collaborate again with a creator whose participation record for that campaign is `successfully_completed` (§5.18, §6.17).
- **One-strike ghost ban:** Permanent founder ban triggered by defined failure/ghosting/delivery conditions.

---

## Appendix C — Shape comparison of the four source documents

### C.1 Structural comparison

| Dimension | Proovd Brief V5 | MVP Final v5 | Stripe Connect briefing | Stripe Approval Playbook v5 | Unified result |
| --- | --- | --- | --- | --- | --- |
| Primary job | Explain the company, users, end-to-end experience, policies, and intended future product | Define what must be built and operated for launch | Define the payment posture presented to Stripe | Operationalize website readiness, application answers, Sales outreach, underwriting, controls, documents, and contingencies | Tell the product story, define the complete build/payment contract, and provide the approval runbook |
| Shape | Narrative operating brief that moves from positioning to listing, matching, payments, users, settings, and UI inventory | Numbered requirements specification with roles, flows, states, data, edge cases, implementation notes, tests, and acceptance criteria | Short architecture/risk memo | Long operator playbook containing checklists, field-by-field answers, scripts, Q&A, risk controls, legal drafts, and private application data | Narrative front door + authoritative numbered requirements + reconciliation record + redacted operator runbook |
| Center of gravity | Founder/affiliate/backer experience and operating philosophy | Engineering, operations, compliance, and launch execution | Merchant-of-record posture, Connect architecture, charge timing, and approval | Stripe approval readiness and how Proovd represents/defends the model | Product, engineering, operations, support, policy implementation, Stripe review, and approval execution in one file |
| Time horizon | Mixes MVP, launch operations, growth plan, and future automation | Explicit MVP with deferred list, though still broad | Launch payment architecture | Pre-application website preparation through Sales/underwriting, testing, approval, and first live processing | Labels product scope and carries the operator from build through approval and the controlled pilot |
| Level of specificity | Rich behavioral detail but few formal states or tests | Highly specific: statuses, fields, routes, webhooks, exact copy, tests | Highly specific on a narrow topic | Most detailed on application fields, communications, documents, controls, and response procedures, but duplicates product/policy material | Retains build specificity, absorbs approval detail, redacts private data, and removes duplicated legal-file bodies |
| Stripe coverage | Correct business narrative and payment outline | Deepest implementation coverage | Clearest concise architecture statement | Deepest application/Sales/underwriting coverage | Implementation depth + architecture priority + full application/Sales runbook |
| Main weakness alone | Scope is not consistently separated; some rules conflict internally | Hard to read as a company/product narrative; resembles a launch operating system more than a lean feature list | Too narrow to run or build the product | Not a sufficient product build contract; mixes private data and full legal drafts with operations, and contains architecture/policy values that can drift | Larger, but intentionally one source of truth with protected external records and a visible decision log |

### C.2 What “shape” means here

The Proovd Brief is organized around the business journey: who the users are, why they care, how listing and matching work, how a campaign runs, what happens to money, and what each user sees. The MVP is organized around system boundaries: roles, states, database records, admin actions, webhooks, edge cases, tests, and acceptance. They are not alternative versions of the same document; they answer different questions.

The Stripe Connect briefing is a concise architecture position, while the Stripe Approval Playbook is an approval-operations manual. Neither alone defines the product. The playbook also carried material that should not live in a shared MVP file: complete separate legal drafts and private application values.

The unified shape therefore uses the Proovd Brief as the **reader journey**, the MVP as the **implementation contract**, the Stripe briefing as the **architecture position**, and the playbook as the **application/Sales runbook**. Stripe is a cross-cutting dependency, not a separate late-stage thought: merchant-of-record language, connected-account state, SetupIntent consent, off-session capture, platform fees, payout controls, refunds, disputes, webhooks, test mode, application answers, underwriting evidence, and live-mode approval appear where the relevant product or operating behavior is defined.

### C.3 Scope taxonomy used in the unified document

| Label | Meaning |
| --- | --- |
| Required MVP product | Must exist in the shipped system before the first real campaign or Stripe review, as applicable |
| Required MVP operation | Can be performed manually by admin, but the action, actor, time, reason, amounts, and evidence must be recorded |
| Launch configuration | Campaign-specific or cohort-specific rule controlled through settings/admin rather than hard-coded |
| External dependency | Cannot be declared complete until Stripe/provider confirms it or the required separate authoritative record exists |
| Deferred | Preserved as product intent but not represented as live capability |
| Owner decision | Sources conflict or the product owner must choose a commercial/policy rule |

---

## Appendix D — Reconciliation and owner-decision log

### D.1 Historical source precedence used to create this document

This list explains the merge; the source files are no longer runtime dependencies after their resolved requirements are incorporated here.

1. **Confirmed owner decisions** override conflicting source-file values.
2. **MVP Final v5** controls what engineering must build now because it labels itself authoritative and contains the acceptance checklist.
3. **Stripe Connect briefing** controls the intended payment-architecture priority where it adds payment-specific context not present in the MVP; no Stripe-dependent capability is treated as approved merely because it is written here.
4. **Stripe Approval Playbook v5** controls the application, website-review, Sales, underwriting, document, and risk-control workflow where it does not contradict the first three items. Private values are redacted and complete legal-policy bodies stay in their own canonical files.
5. **Proovd Brief V5** controls product narrative, user rationale, and launch operating intent where it does not conflict with the items above.
6. An unresolved provider capability is recorded as a live-mode gate instead of being guessed.

### D.2 Conflicts and resolutions

| Topic | Proovd Brief V5 | MVP Final v5 | Unified treatment | Status |
| --- | --- | --- | --- | --- |
| AI pitch rewriting | LLM refines problem/solution; founder compares original and accepts responsibility | No AI rewriting at this stage; full AI refinement deferred | Founder writes copy; optional interview material remains; LLM rewrite is deferred and may later require the responsibility confirmation | Resolved by MVP precedence |
| Teaser Mode | Application-gated MVP behavior with per-affiliate reveal | Full teaser mode deferred | Deferred; high-effort flag remains available manually | Resolved by MVP precedence |
| Matching | Algorithm described, with manual matching for first ~50 campaigns | Algorithmic matching explicitly deferred | Superseded by D.6: MVP uses campaign-specific affiliate recruitment, private signup, pre-association, and launch-roster activation rather than a heavy post-payment matching process | Superseded 22 Jul 2026 (D.6) |
| Founder browsing unmatched affiliates | Founder can view same-niche partners and request matches | Founder-side browsing of all unmatched affiliates deferred | Admin can receive/manual-handle requests; no full browse product | Resolved by MVP precedence |
| High-effort commission cap | Affiliate bid has no platform-imposed cap | Total percentage commission capped at 50%; flat payments excluded | 50% is the confirmed hard ceiling for total percentage commission; optional fixed Creator payments remain outside the ceiling | Confirmed by owner; terminology updated 23 Jul 2026 |
| Commission floor | Brief refers to more than 30% base in high-effort cases | Quality-tier floor range 25%–35% | Configurable 25%–35% floor; high-effort counter-offer allowed subject to 50% ceiling | Superseded 22 Jul 2026 (D.5): floors removed; §5.12 matrix bases apply |
| Affiliate commission availability | Pay when relevant charges succeed | Three-calendar-day cooling-off before commissions/bonuses become withdrawable | Superseded: earnings finalize after campaign close and the 48-hour retry window; Admin transfers finalized commission plus any fully earned fixed Creator payment on or after Day 3 | Superseded 23 Jul 2026 (D.7) |
| No-match/no-acceptance refund | No Affiliate accepts in 72 hours: refund less US$25 overhead; a truly impossible manual match can receive full refund; early-founder promo says no overhead refund | No eligible match within window: full listing-fee refund | Current rule: refund the entire Checkout total, including associated tax reversal/correction, when there are zero eligible recruits or no Creator and Founder mutually accept the same locked terms within 72 hours of successful listing payment; pending proposals do not extend the clock | Superseded and fully clarified by D.8 items 11 and 17 |
| Founder cancellation | Free during first two campaign days; after Day 2 admin approval | Free in first two days only if campaign has not gone live; otherwise admin approval | Full listing-fee refund within 48 hours of `listing_paid_at` only while not live; later/live cancellation requires Admin approval | Re-anchored 23 Jul 2026 (D.7) |
| Founder repeat-campaign cadence | One campaign at a time and minimum three-month gap | One active campaign; next campaign waits for admin “ready” flag | One active campaign; after it ends, a three-month minimum cooldown applies, followed by required admin approval/readiness | Confirmed by owner |
| Public discovery | Affiliate-link-only Days 1–7; browse/indexable Day 8 | Organic and house traffic modeled, but the Day 8 switch was not stated | Day 8 discovery rule added to this unified MVP | Incorporated from brief |
| Support SLA | 24-hour response | One business day in footer; one business hour appeared in one exact-copy block; 48-hour founder follow-up | Immediate automated acknowledgment, human response within one business day, founder follow-up after 48 hours | Confirmed by owner |
| Mid-campaign editing | Free until first reservation; only non-material edits after first reservation | Key commercial fields lock at launch; only brand notes, FAQ, community link, and permitted content remain editable | Launch lock applies because it is easier to audit and safer for consent/disputes | Resolved by MVP precedence |
| First 50 founder pricing | US$25 listing fee for first 50 founders | US$75–US$95 with promotional discounts supported | The same cohort of 50 invited founders receives a US$25 listing fee on each founder's first campaign; 5% campaign fee still applies | Superseded 22 Jul 2026 (D.5): no cohort pricing; uniform US$35-base / US$25-minimum calculated fee |
| Affiliate pool pruning | Bottom 10% pruned every two months | Not required | Manual performance review/offboarding allowed; automatic percentile pruning deferred | Deferred |
| Public reputation | No founder rating system | No rating feature specified | Explicitly no public founder rating in MVP; internal enforcement handles trust | Incorporated from brief |

### D.3 Confirmed owner decisions — 21 July 2026

These decisions reflect 21 July 2026. Where D.5 supersedes an item, D.5 controls.

1. **Eligible campaign-specific recruits but zero accepts:** full listing-fee refund in MVP, with no overhead deduction.
2. **Service level:** one business day for a human response.
3. **Commission ceiling:** 50% is the hard ceiling for total percentage commission, including floor, bonus, high-effort bid, or any other percentage arrangement. Optional fixed Creator payments remain outside the ceiling.
4. **Repeat campaigns:** a founder waits at least three months after a campaign and then still requires admin approval/readiness before launching another.
5. **US$25 launch cohort:** the first 50 founders, first 50 campaigns, and first 50 founder invitees are the same invited founder cohort. Each invited founder receives the US$25 listing fee on their first campaign. This is distinct from the separately hand-picked launch affiliate cohort. *(Superseded 22 Jul 2026 by D.5 item 2: the cohort definition stands, but cohort pricing is removed in favor of the uniform calculated fee.)*

### D.4 Confirmed Stripe-playbook integration decisions — 21 July 2026

1. This unified MVP includes the full product/engineering requirements and the complete Stripe application/Sales runbook, but it references rather than reproduces the separate full legal-policy files.
2. Private identity, tax, passport, residential-address, and banking values are replaced with secure placeholders.
3. Preferred architecture is direct charges on Founder connected accounts using the configuration requested from Stripe; SCT/platform-balance treatment is only the Stripe-selected backup. Public copy remains conditional until written approval. *(Current treatment confirmed by D.8 items 1 and 9.)*
4. Founders, Affiliates, and Backers are US-only for the controlled MVP. International Backers are deferred. *(Superseded and narrowed by D.8 item 18.)*
5. Affiliate payment is approval-dependent; the selected direction is an Affiliate recipient connected account receiving Admin-approved Transfers after close, retry, bonus evaluation, and verification. The Affiliate never processes Backer charges, and live Affiliate payments remain disabled until Stripe confirms the exact model. *(Current treatment confirmed by D.8 items 1 and 7.)*
6. Legal and tax product rules are controlling requirements, but live processing remains gated on counsel/tax review and required registrations/configuration; separate policy files must match before publication.
7. Medical and brokerage/finance sample campaigns are replaced with safe digital-product examples.
8. Pre-build Tranche 2 remains a Day 14 decision. Pre-launch Tranche 2 defaults to Day 14 and may release after Day 3 only after actual reward/access fulfillment and recorded admin approval; no fixed Day 14 requirement applies to that narrow fulfilled case. *(Superseded 22 Jul 2026 by D.5 item 5: Idea Campaigns now release a single 100% founder payment at Day 3, and Day 14 becomes enforcement-only for them; the Product Campaign 40/60 rule and early-release exception stand.)*
9. Backer phone is collected but is not phone-verified at MVP.
10. Stripe application outreach uses the email-first sequence in Appendix G.

### D.5 Confirmed owner decisions — 22 July 2026

These decisions supersede any conflicting earlier decision in D.2–D.4.

1. **Chronological founder flow:** campaign-specific affiliate recruitment may begin → invitation with secure temporary draft → campaign path choice (`I have an idea` / `I have a product`) → human-prefilled Problem/Solution and founder-written Competition → possible-creator result before account creation → prefilled account claim and `founder_signup_complete` → preparing campaign appears to pre-associated Affiliates → optional materials and embedded human interview scheduling → high-effort and listing-fee calculation → Stripe Standard onboarding → listing-fee payment → formal Affiliate response window and campaign building → single Proovd review gate → fixed Creator payment funding where accepted and Creator readiness → approved campaign page goes live → tracking links activate → Creators publish and submit proof → Admin verifies posts → additional Affiliates may join before close (§5, §6.18). *(Payment timing is superseded by D.7; exact launch and attribution activation are superseded by D.8 items 2–3.)*
2. **Listing pricing:** US$35 base; US$2 discount each for Visuals, Branding, confirmed interview booking, Story, and Socials; maximum savings US$10; minimum US$25; post-MVP pricing undecided. The first-50 cohort remains invited but has no separate pricing formula. The 5% campaign fee is unchanged.
3. **Customer-facing naming (§2.5):** Founder-facing and backer-facing copy uses `Idea Campaign`, `Product Campaign`, and `pre-order`/`active pre-order`. `Pre-build`, `Pre-launch`, and `reservation` remain internal-only terms. Appendix A exact-copy blocks follow the same customer-facing rule. Product Campaign founder payouts use `first payment` and `remaining payment`; an Idea Campaign has a `single Founder payment`.
4. **Compensation:** the §5.12 matrix replaces Model A/Model B and the 25%–35% quality-tier commission floor. Base 30%; 20% with an accepted Product-Campaign fixed payment; percentage bidding only on high-effort campaigns; the 50% total-percentage ceiling is retained; the fixed amount sits outside the ceiling and is Product-only, Creator-requested, Founder-decided, and fully funded before work. *(The former 50/50 release timing is superseded by D.7.)*
5. **Founder payouts:** Idea Campaigns release a single Founder payment — 100% of the eligible share — at Day 3 after W-9, payment/risk checks, and recorded admin approval; Day 14 becomes enforcement-only for Idea Campaigns, and post-release recovery is best-effort. Product Campaigns keep 40% Day 3 / 60% Day 14 with the evidence-gated early-release exception (§11.3).
6. **High effort is calculated, not judged:** high-effort only when Visuals, Branding, and a scheduled/confirmed founder interview are all absent; inputs, result, calculation time, and actor are stored; the result locks at successful listing-fee payment (§5.8).
7. **No-acceptance refund trigger:** campaign-specific recruitment and signup may occur earlier, but the 72-hour formal response window starts at successful listing-fee payment; zero eligible recruited Creators or no Creator and Founder mutually accepting the same locked terms refunds the entire listing-fee Checkout charge, including associated tax reversal/correction, with no fixed deduction (§11.9). Pending proposals do not pause or extend the deadline. *(Clarified by D.8 items 11 and 17.)*
8. **AI Interview removed:** replaced by embedded human interview scheduling (Google Meet, Zoom, Microsoft Teams) as required MVP (§5.7); helper resources become static guides with copy-paste AI prompts (§5.6).
9. **Onboarding:** no SMS OTP; vetting and the possible-creator result precede account creation through the secure temporary draft; invited-email ownership may be satisfied by the private invitation or Google sign-in; the future public route keeps email verification (§5.1–§5.5).
10. **Post-campaign work-again requests** are required MVP in narrow form (§6.17); full recurring creator management stays deferred.
11. **Notifications:** no scheduled Day 3/7/10 check-ins; `threshold reached`/`threshold lost` events and separate `Campaign ended`/`Results ready` events are added (§13.1).

### D.6 Confirmed owner decisions — affiliate alignment update, 22 July 2026

These decisions supersede conflicting manual-matching, admin-created-account, multi-page affiliate-onboarding, and fixed-launch-roster language elsewhere in the historical sources.

1. **Campaign-specific recruitment:** Proovd recruits affiliates for identified campaigns. Affiliates are not discovered through a heavy post-payment manual-matching process.
2. **Private affiliate signup:** each recruit receives a private campaign-specific invitation and creates or claims their own account. There is no open public affiliate signup and no generic admin-created credential flow.
3. **Founder/affiliate handoff:** recruited affiliates may sign up before the founder finishes signup. Founder account claim emits `founder_signup_complete`, at which point the preparing campaign automatically appears to every eligible pre-associated affiliate.
4. **Formal decision timing:** successful listing-fee payment activates the formal campaign opportunity and begins the 72-hour response window. Earlier recruitment/signup does not begin the paid response clock.
5. **Compact affiliate flow:** Proovd account claim has one primary action, and the only additional onboarding action is Stripe-controlled payout setup. Campaign availability has `Review campaign` as its primary action. No multi-page welcome, splash-screen, custom bank form, or resource-library journey is required.
6. **Single Campaign kit:** all affiliate support documents, disclosures, visuals, talking points, proof instructions, payment explanations, and support live in one campaign-attached kit (§6.2).
7. **Mid-campaign additions:** Proovd may recruit and activate affiliates after launch and before campaign close. Each addition receives adjusted remaining-time deliverables, independently clears readiness, and receives non-retroactive attribution beginning at tracking-link activation (§6.18).
8. **Historical note:** this affiliate-alignment update did not change the then-current payment rule. The former two-stage rule was later superseded in full by D.7 on 23 July 2026.

### D.7 Confirmed owner decisions — final operating alignment, 23 July 2026

These decisions supersede every conflicting active requirement and historical resolution above.

1. **Charge/retry timing:** failed close-date charges receive a fixed 48-hour retry window. Day 3 after `campaign_close_at` is the standard Founder-payment and Affiliate-Transfer review date.
2. **Stripe architecture request:** preferred campaign charges remain direct charges on the Founder Standard connected account. Proovd will ask Stripe to approve a platform-side application-fee amount containing the separately ledgered 5% Proovd fee plus provisional Affiliate percentage compensation, followed by verification and either a post-close Affiliate Transfer or return of the unearned amount to the Founder. SCT/`on_behalf_of` is the backup. No affected live function launches without written approval.
3. **Tax-exclusive checkout:** the Backer pays sales tax on top of the reward subtotal. Checkout shows subtotal, tax, and exact total authorized. The 5% fee, Affiliate percentages, Idea threshold, and US$50,000 cap all exclude tax. The Founder is seller/tax-responsible, subject to counsel/tax review and the approved Stripe Tax/Connect setup.
4. **Affiliate payment rail:** every Affiliate completes a Stripe-approved connected-account onboarding for identity, tax, bank, Transfer, and payout requirements. Admin creates Transfers after reconciliation; the Affiliate does not process Backer charges or request a Proovd withdrawal.
5. **Fixed Creator payment:** the default remains 30% commission only. A Creator-requested fixed amount is available only for Product Campaigns, reduces base commission to 20%, is funded in full before work, releases US$0 at first post, and is paid in full with finalized commission only after close, 48-hour retry, and verification of every agreed deliverable. If no valid compliant post exists, the full fixed allocation returns and no commission is earned; if a valid post exists but later deliverables remain incomplete, the entire fixed amount returns while genuine compliant commission may remain. Poor sales alone do not deny payment after full completion.
6. **Refund shape:** Idea Campaign charges have no voluntary/change-of-mind refund, with defined duplicate/wrong/canceled/unauthorized, misrepresentation, applicable non-delivery, serious-violation, legal, Stripe, and issuer exceptions. Product voluntary refunds use the exact preserved Founder-policy version shown at campaign/checkout. The Founder is MoR and bears Founder/product-caused refunds.
7. **Cause-based Affiliate adjustments:** routine Founder/product refunds and unrelated Backer disputes do not claw back finalized valid Affiliate earnings. Affiliate-caused fraud, fake traffic, self-dealing, false claims, invalid proof, or material breach cancels unpaid earnings and creates a negative balance/recovery record after transfer. Proovd/system errors are borne by Proovd where appropriate. Consent is evidence, never a waiver of mandatory rights.
8. **Pre-order counting:** an Idea Campaign permits one active pre-order per unique Backer, with reward changes before close; its threshold counts unique active Backers. A Product Campaign permits multiple transactions by one Backer, one reward per transaction; Backer count remains unique while revenue/units include all transactions.
9. **Cap and attribution:** the US$50,000 cap applies atomically to aggregate pre-tax active-pre-order value. Attribution uses the last valid Affiliate link before pre-order on the same browser/device, persists through `campaign_close_at`, is replaced by a later valid Affiliate link, and never applies before link activation or retroactively.
10. **Campaign immutability and clocks:** campaign type cannot change after vetting; a wrong type is archived and new vetting begins. `listing_paid_at`, `campaign_live_at`, and `campaign_close_at` are the three controlling time anchors.
11. **Affiliate failure before launch:** after Admin records `creator_failure_recorded_at`, Proovd has three US business days, using the configured business-day calendar and a stored exact due timestamp, to make a replacement Creator fully ready. Otherwise the Founder receives a refund of the entire listing-fee Checkout charge, including associated tax reversal/correction, and the campaign becomes `refunded_no_creator`. *(Clock and refund clarified by D.8 items 11 and 19.)*
12. **Launch and completion:** Admin coordinates the campaign-page activation and Creator posting time. First-post verification is proof/compliance only. A Creator must meet the recorded availability period and every agreed deliverable for fixed-payment eligibility; story-format media may use a pre-agreed natural lifespan.
13. **Backer consent/data/access:** Backers explicitly confirm 18+, provide the billing location needed for tax, and acknowledge mandatory email/purchase-detail sharing with the Founder only for fulfillment/support. Founder marketing/research/survey sharing is separately optional. Magic links last through fulfillment/final resolution plus 180 days unless revoked/reissued.
14. **Eligibility and agreement:** Founder signup collects date of birth/country/state; Affiliate signup collects date of birth/country/state and 18+/US confirmation, with Stripe KYC. The per-campaign IP/confidentiality acceptance binds the Creator only; Founder obligations live in the Founder Terms.
15. **Admin/state/security:** Admin data auto-populates from user inputs and Stripe/webhooks. Main states add `changes_required`, `creator_replacement`, `refunded_no_creator`, `closed_reconciling`, and `closed_resolved`; payment flags remain separate. Admin MFA, reauthentication for sensitive actions, and immutable audits are required.
16. **Descriptor and events:** customer surfaces display the actual validated computed charge descriptor. Successful SetupIntents are never described as canceled when a reservation ends. Transfer creation failures are synchronous API errors; implementation must not rely on a nonexistent `transfer.failed` webhook.
17. **Pilot gate:** development, samples, and test mode may proceed, but the first live campaign is one controlled pilot after Stripe architecture/Transfer approval, tax/legal approval, required policy alignment, security, and all §18.7 tests pass.

### D.8 Confirmed owner decisions — v5.6 final audit closure, 23 July 2026

These decisions supersede every conflicting active requirement and historical resolution above. They close the full-document v5.5 audit and are incorporated throughout v5.6.

1. **Affiliate connected accounts:** Founders are the seller/payment connected accounts for Backer charges. Affiliates are separate recipient connected accounts used only for Admin-approved Transfers/payouts; they never process Backer charges and are never the merchant of record.
2. **Launch order:** at `campaign_live_at`, the approved campaign page activates first, scheduled tracking links activate and already resolve to it, Creators publish and submit their URLs, and Admin verifies the live posts afterward. Verification does not launch or unlaunch the campaign page.
3. **Attribution activation:** each Creator's `activated_at` starts provisional attribution only after the live campaign page exists. Verification preserves valid earnings or pauses the Creator/link and blocks invalid earnings; earlier traffic, pre-orders, and charges never receive retroactive credit.
4. **Review-change reacceptance:** non-material corrections preserve readiness. A material change to economics, work, dates, rewards/prices, claims, delivery, refunds, channel rules, or fixed-payment conditions creates a new version and requires affected Creator reacceptance before approval/live.
5. **Practical unique-Backer rule:** Idea thresholds use private normalized email/phone hashes, Stripe fingerprint where available, device/IP risk signals, and audited Admin review. A shared IP alone never merges Backers. Customer copy promises reasonable deduplication/review, not perfect verified-person prevention; default identity documents remain deferred.
6. **Reservation-time tax:** the controlled MVP stores and reuses the reservation-time Stripe Tax calculation and exact authorized total only while valid under the approved configuration. There is no close-time recalculation or higher-tax reconsent flow. An unusable calculation creates no charge. Stripe/tax approval of this path is a live gate.
7. **Creator-specific bonuses:** bonuses use only the individual Creator's captured attributed pre-tax subtotal or captured attributed-Backer count. Provisional Affiliate compensation uses the maximum locked base/bid/bonus percentage; any unearned difference returns to the Founder.
8. **Manual thank-you payment:** this remains a discretionary, non-guaranteed, non-automated Proovd expense funded only from retained listing-fee revenue after refund rights resolve. Any payment is manually approved, initiated through the Stripe-approved recipient path, and recorded separately from campaign earnings.
9. **Approval-dependent public copy:** before written approval, public/submission surfaces describe the Connect configuration requested or to be approved for launch. They never state that payout controls are already Stripe-approved. After approval, they render the actual approved configuration.
10. **No-dashboard Founder product:** Founder vetting/building present one decision at a time. The live campaign home uses complete Glance/Act/Explore: one active-pre-order count and last-visit delta, one ranked real action or caught-up ending, and complete secondary Explore information without a widget dashboard.
11. **Full listing-fee refund:** every qualifying full refund returns the entire Checkout charge actually paid, including listing-fee subtotal and associated Stripe Tax reversal/correction.
12. **Backer data timing:** after a saved pre-order, the Founder immediately receives the disclosed email/purchase details for fulfillment preparation/support even though no charge occurred. Cancellation marks `do not fulfill`; marketing/research still requires separate opt-in.
13. **Live edits:** non-material clarification may publish with version history. Claims, rewards/prices, dates, delivery, refunds, and Creator work/compensation require Admin review and any applicable reacceptance.
14. **Token security:** magic-link and draft tokens use at least 128 bits of entropy, hash-only storage, rate limiting, non-enumerating errors, immediate rotation/revocation, and no raw-token logging.
15. **MCC:** 5734 is a requested/default classification for applicable software activity, not universal. Stripe confirms the final classification for each supported activity; quasi-cash MCC 6051 is never used.
16. **Pilot Campaign-kit exception:** privately recruited, manually known, authenticated MVP Affiliates may see the full preparing-state Campaign kit before per-campaign acceptance. Access is private, campaign-scoped, logged, and revocable; the per-campaign IP/confidentiality agreement remains mandatory before work.
17. **72-hour acceptance:** only mutually accepted locked compensation terms count. Pending proposals are not acceptance, do not pause/extend the clock, and close if the deadline produces a refund.
18. **US-only Backers:** the controlled MVP pilot accepts only US Backer billing locations. International Backers are deferred until an explicit approved-country rollout exists.
19. **Replacement clock:** Creator failure records `creator_failure_recorded_at`; the three-business-day deadline uses a configured US business-day calendar and stored exact due timestamp that cannot be silently reset.

---

## Appendix E — Proovd Brief feature disposition

This appendix ensures that ideas from the narrative brief are not silently lost when they are not part of the buildable MVP.

| Brief capability or operating rule | Unified disposition |
| --- | --- |
| Two campaign types: Pre-build and Pre-launch | Required MVP product |
| Founder-led crowdfunding powered by trusted distribution | Core positioning |
| Affiliates prioritized as long-term LTV engine | Product decision principle |
| US-only Founders, Affiliates, and Backers; 18+ users | Required controlled-pilot guardrail; international Backers deferred |
| Consumer software/apps/prosumer/digital-product cluster | Required launch guardrail; campaign-specific review |
| No physical goods, work tools, or regulated categories | Required launch guardrail; prosumer exception retained, enterprise procurement rejected |
| US$95 base listing / US$75 with optional fields | Superseded 22 Jul 2026: US$35 base with US$2 optional-item discounts to a US$25 minimum; no cohort pricing; post-MVP pricing undecided |
| Optional visuals, branding, interview, story, and socials | Required form support; optional-field discount inputs |
| AI interview that creates creator-usable material | Replaced 22 Jul 2026: embedded human interview scheduling is required MVP (§5.7); interview material remains usable campaign content |
| LLM problem/solution rewrite with responsibility confirmation | Deferred |
| High-effort badge and commission counter-offer | Required MVP product, with 50% commission ceiling |
| Application-gated Teaser Mode | Deferred |
| Pre-build and Pre-launch-specific helper content | Lean helper content required; full courses/PDF library deferred |
| Possible-creator count before account creation | Required MVP product; no specific partner promise; shown pre-account (§5.4) |
| Actual partner reveal after payment/brand setup | Superseded 22 Jul 2026: recruited affiliates may sign up earlier; the preparing campaign appears at `founder_signup_complete`, and the formal decision activates after listing-fee payment |
| One to five tight matches | Replaced by an admin-confirmed initial launch roster with at least one accepted creator; additional affiliates may join mid-campaign |
| Channel-specific verification metrics | Required admin data and manual verification |
| No self-reported audience metrics without proof | Required operating rule |
| Agencies cannot accept for creator/operator | Required affiliate onboarding rule |
| 72-hour affiliate response clock | Required launch configuration; starts at successful listing-fee payment; only mutually accepted locked terms count; pending proposals do not extend it; no locked acceptance refunds the full Checkout total including tax treatment |
| Last-touch attribution | Required MVP rule: last valid Affiliate click, same browser/device, first-party cookie through campaign close, later valid Affiliate replaces earlier, no cross-device promise |
| Practical unique-Backer dedupe, click velocity, geo checks | Required private normalized email/phone hashes, Stripe fingerprint where available, device/IP risk signals, and audited Admin review; shared IP alone never merges Backers; stronger identity verification deferred |
| Zero-reservation click-off feedback and like signal | Deferred unless trivial/privacy-safe |
| SetupIntent save-card-then-charge | Required MVP product |
| Pre-build threshold charge; Pre-launch close-date charge | Required MVP product |
| Anti-chargeback disclosure and evidence stack | Required MVP product/operation |
| Two-week campaign default | Required launch default; admin-configurable |
| Two-tranche 40% Day 3 / 60% Day 14 | Product Campaigns only (first/remaining payments); Idea Campaigns release a single 100% founder payment at Day 3 (22 Jul 2026) |
| Admin—not AI—judges milestone evidence | Required operating rule |
| One-strike founder ghost ban | Required enforcement rule |
| Material pivot collapses into milestone failure | Required policy/operating rule |
| Material edits require cancellation/relisting | Required post-launch lock/policy |
| Founder community link | Required optional campaign field |
| Affiliate-only Days 1–7; public discovery Day 8 | Required MVP behavior, added in unified document |
| Organic revenue gets no affiliate commission | Required attribution/ledger rule |
| Centralized updates and no private inbox | Required MVP product boundary |
| Quality-tier floors, bonuses, high-effort bids | §5.12 matrix controls (30%/20% bases, high-effort-only bidding, 50% cap); Creator-specific bonuses use only that Creator's captured attributed results; quality tier is internal-only |
| Channel-specific flat/placement-style compensation | Supported on Product Campaigns through a Creator-requested fixed payment + 20% base commission; funded before work, paid only after close/full completion (§6.10) |
| 5% platform fee | Required MVP payment rule |
| Visible Affiliate earnings states | Required: estimated, finalized, approved for transfer, transferred, paid out, failed, and adjusted |
| Good-effort thank-you payment | Optional manual Proovd-funded Admin operation after listing-fee refund rights resolve; no automated calculation or customer promise; Stripe/tax approval required before payment |
| One-month direct-competitor restriction | Required affiliate agreement rule |
| Bottom-10% affiliate pruning every two months | Deferred automatic rule; manual offboarding allowed |
| Hand-pick first ~50 affiliates | Required launch operation |
| Referral/channel partnerships for network growth | Go-to-market operation; not a core product feature |
| US$25 first-50-founder promotion | Superseded 22 Jul 2026: no cohort pricing; the calculated US$35-base / US$25-minimum fee applies to all founders; the 5% campaign fee remains |
| Three active campaigns per affiliate | Required MVP constraint |
| One active campaign per founder | Required MVP constraint |
| Three-month founder gap | Required minimum cooldown, followed by required admin readiness approval |
| FTC disclosure templates and spot checks | Required MVP product/operation |
| Warning, suspension, removal, and earnings adjustment | Retained with cause-based enforcement: unpaid invalid earnings may be canceled, and an already transferred amount may create a negative balance/recovery claim, only when Affiliate fraud, fake traffic, self-dealing, false claims, invalid proof, or material breach caused the invalid earning, charge, refund, or dispute. Routine Founder/product issues and unrelated Backer disputes do not trigger Affiliate clawback. |
| Affiliate termination admin review | Required MVP operation |
| Plug-and-play posts, visuals, blurbs, talking points | Campaign-specific materials required; full reusable resource library deferred |
| Campaign-specific affiliate support documents | Required inside the single Campaign kit; not separate pages or a multi-step course |
| Affiliate onboarding splash screens | Replaced by compact account claim plus Stripe payout setup and one campaign-review action; automated tours remain deferred |
| Affiliates joining after launch | Required until campaign close, with adjusted deliverables and non-retroactive attribution (§6.18) |
| Founder/affiliate meeting scheduler | Deferred; admin may coordinate off-platform. Distinct from the required founder-interview embedded scheduling (§5.7) |
| Backer pre-checkout survey | Required MVP product |
| Founder data sharing | Email/purchase details are shared immediately after a saved pre-order for fulfillment preparation/support and that timing is disclosed; Founder marketing/research/survey contact remains separately optional and unchecked |
| No public founder ratings | Explicit MVP boundary |
| Two-year IP/confidentiality/non-replication agreement | Required Creator-only per-campaign acceptance; Founder obligations live in Founder Terms |
| Admin rubrics and response-time SLAs | Required operating documentation, even if not fully automated |
| Email + in-app support | Required MVP; live chat only if implemented |
| Mobile-first platform | Required responsive design; native app deferred |
| Founder, Affiliate, and Backer product surfaces | Founder is explicitly no-dashboard Glance/Act/Explore; Affiliate compact home and Backer magic-link page remain as scoped |
| Founder Glance/Act/Explore and one-item-at-a-time forms | Required MVP product; widget grids, stock-like visuals, and manufactured activity are prohibited |
| Notification preferences by type/channel | Email/in-app required; full push matrix deferred |
| First-time walkthroughs and popup guides | Deferred unless trivial |
| Post-success affiliate-management product | Deferred; the narrow post-campaign work-again request is required MVP (§6.17) |

---

## Appendix F — Stripe briefing coverage map

| Stripe briefing requirement | Location/disposition in unified MVP |
| --- | --- |
| Proovd software platform; founder merchant of record | Sections 2, 8, 9, 10; exact copy Appendix A |
| One Connect platform; founder Standard accounts | Roles/onboarding and Section 10.1 |
| Affiliate connected accounts receive post-close Transfers but never process Backer charges | Sections 4.2, 6.12, 10.1, 12.8, 18.7 |
| Preferred direct charges with payout controls requested from Stripe | Executive baseline and Section 10.1; public copy remains conditional until written approval |
| Backup separate charges and transfers with `on_behalf_of` | Executive baseline, Section 10.1, backup test path |
| Never call the arrangement escrow/trust/custody | Language rules, implementation naming, acceptance checklist |
| Founder-account-first risk under direct charges; platform-balance-first possibility under backup | Section 10.1 and policy/recovery requirements |
| Founder-share release schedules (Idea single payment at Day 3; Product 40% Day 3 / 60% Day 14) | Sections 11 and 12; tests and acceptance |
| SetupIntent then off-session PaymentIntent | Sections 7, 10, 18; exact checkout copy and tests |
| Campaign preparation before architecture approval | Section 10.1 permits public sample/demo pages and non-payment preparation; real SetupIntents, saved-card reservations, and charges remain blocked until production approval/readiness |
| Separate listing-fee and Connect revenue streams | Sections 5.10 and 10.4 |
| Tax-exclusive Backer totals and pre-tax fee/commission bases | Sections 7, 10.3–10.5, Appendix A, tests |
| Limited-availability / Stripe Sales approval path | Added to Section 10.1 and live-mode readiness gate context |
| One domain and one policy story | Shared guardrails and public website requirements |
| MCC 5734 requested/default only for applicable software activity; Stripe confirms final classification; never 6051 | Shared campaign guardrails and Stripe decision record |
| Same rail for both campaign types | Sections 3 and 10 |
| Pre-build threshold trigger and risk disclosure | Sections 3.1, 7, 8, 11; exact consent copy |
| Pre-launch close-date trigger, keep-what-you-raise, delivery month/year | Sections 3.2, 7, 8, 11; exact consent copy |
| US-only, 18+, US$50,000 aggregate pre-tax active-pre-order cap, digital-only | Shared launch guardrails and settings |
| Manual misleading-claim/fake-rendering review | Campaign review/admin requirements |
| FTC disclosures name founder/product | Affiliate flow and first-campaign checklist |
| AUP mirrors Stripe restricted list; sanctions representations | Website/policy and onboarding requirements |
| Full sandbox, webhook, object, idempotency, refund, dispute, and live-gate coverage | Section 18.7 and Section 19 |

### F.1 External dependency warning

This document describes the intended Stripe architecture; it does not itself prove Stripe approval, legal sufficiency, tax treatment, or technical availability for a particular account. Direct-charge payout controls, Standard-account boundaries, application-fee treatment for Proovd plus Affiliate compensation, Affiliate connected-account Transfers/payouts, fixed Creator payment funding, sales tax, descriptors, negative balances, refunds/disputes, and backup `on_behalf_of` behavior must be confirmed and documented before live mode.

---

## Appendix G — Stripe application and Sales runbook

This appendix is the standalone operator pack for preparing the public site, completing Stripe's platform application, contacting Stripe Sales, answering underwriting questions, supplying documents, and recording the resulting architecture decision. It intentionally does not reproduce the full legal-policy drafts, which remain separate canonical files.

### G.1 Controlling application position

Every application answer, public page, sales email, product screen, and engineering ticket must remain consistent with these facts:

| Topic | Controlling answer |
| --- | --- |
| Business | Proovd is a software platform for vetted-founder crowdfunding and affiliate-led distribution of digital products. |
| Legal entity | Proovd LLC, Delaware, United States. |
| Launch founders | US founders only, age 18+, operating as individuals/sole proprietors or US entities as allowed by Stripe. |
| Launch affiliates | US affiliates only, age 18+, manually invited and identity-disclosed. |
| Affiliate recruitment | Affiliates are recruited for identified campaigns and receive private campaign-specific signup invitations. They may sign up before the founder completes account claim; the preparing campaign appears at `founder_signup_complete`, and the formal opportunity becomes actionable after listing-fee payment. Additional affiliates may join before campaign close. |
| Initial founder cohort | 50 invited founders. “50 founders,” “50 campaigns,” and “50 founder invitees” mean the same cohort: one first campaign per invited founder. The cohort has no separate pricing formula. |
| Initial affiliate cohort | Approximately 50 separately hand-picked affiliate invitees. This is not the first-50-founder pricing cohort. |
| Backers | US adults who explicitly confirm 18+, provide a US billing location, and use USD-capable cards. International Backers are deferred for the controlled MVP pilot. |
| Products | Digital-only products, software, access, subscriptions, files, tools, and clearly described digital rewards. |
| Prohibited launch areas | Physical goods, medical products or treatment claims, financial/investment/brokerage products, crypto, gambling, weapons, regulated goods, deceptive claims, and anything prohibited by Stripe or Proovd's AUP. |
| Campaign types | Pre-build threshold model and Pre-launch keep-what-you-raise model. |
| Reservation model | Card saved with SetupIntent and explicit consent; no charge until the disclosed close trigger. |
| Merchant of record | Founder for campaign transactions; Proovd for the founder listing fee. |
| Platform economics | Founder listing fee plus 5% of captured pre-tax reward subtotal. Affiliate percentage compensation is also calculated on validly attributed pre-tax subtotal. Sales tax is added on top for the Backer and excluded from percentages. The listing fee is US$35 base minus US$2 per completed optional item, capped at US$10 in savings, with a US$25 minimum. |
| Listing-fee promise | A full refund of the entire listing-fee Checkout charge actually paid—including subtotal and associated tax reversal/correction—when no Creator and Founder mutually accept locked terms within 72 hours of `listing_paid_at`, or when a required launch Creator fails and no fully ready replacement exists within three US business days of `creator_failure_recorded_at`. Pending proposals do not extend the deadline. |
| Preferred money movement | Direct charges on the Founder's Standard connected account. Where Stripe approves, the platform-side amount contains separately ledgered Proovd 5% plus provisional Affiliate percentage compensation at the maximum locked base/bid/Creator-specific-bonus percentage; after verification and bonus evaluation Proovd transfers the earned amount or returns the unearned/untransferred amount to the Founder. |
| Backup money movement | Separate charges and transfers with `on_behalf_of` where supported, used only if Stripe selects or requires that architecture. |
| Founder release schedule | Campaign-specific. Pre-build (Idea Campaign): a single payment of 100% of the eligible share at Day 3 after W-9, payment/risk checks, and recorded admin approval. Pre-launch (Product Campaign): 40% at Day 3; the remaining 60% at Day 14 by default, releasable after Day 3 only after actual promised reward/access delivery and recorded admin approval. |
| Affiliate payment | Stripe connected account with required transfer capability; Admin-approved campaign Transfer after close, 48-hour retry, and work verification. Affiliate never processes the Backer charge. This exact use case remains blocked until Stripe approves it. |
| Optional fixed Creator payment | Product Campaign only; Creator-requested, Founder-funded before work, US$0 at first post, paid with finalized commission only after close and full deliverable verification. Separate approval required. |
| Sales tax | US Backer pays the reservation-time calculated tax on top and authorizes the exact total. The same still-usable calculation/total is used at charge; the MVP has no close-time recalculation/reconsent path and drops an unusable calculation without charge. Founder is seller/tax-responsible; registration, calculation-validity/reuse, filing, and Connect treatment require tax/legal and Stripe approval before live. |
| Support | `support@proovd.co`; response within one business day, Monday–Friday excluding US federal holidays. |

Application drafting rules:

- Never describe Proovd as a bank, lender, escrow agent, trustee, custodian, investment marketplace, payment facilitator, or merchant of record for founder campaign sales.
- Never state that Proovd “holds funds in its bank account.” Describe only the selected Stripe Connect architecture and Stripe-approved controls.
- Never claim a Stripe capability is approved until written approval or an enabled account capability proves it.
- Never mix the preferred and backup architectures as though both run simultaneously. State the preference, the fallback, and the fact that Stripe will select/approve the production configuration.
- Never submit raw identity, tax, passport, residential-address, or banking data by ordinary email or place it in this document. Use Stripe's authenticated collection flow or a specifically approved secure channel.
- Describe Stripe connected accounts and Transfers as the selected implementation direction, but do not claim the Affiliate use case is approved until written confirmation exists.
- The operating rules in this document are controlling product requirements. Tax/legal implementation remains a live-mode approval gate, and separate policy files must match before publication.

### G.2 Public-site submission package

The site must be production-quality and accessible without login before the application is submitted. “Coming soon,” lorem ipsum, broken links, empty policy pages, and real card fields on sample campaigns are blockers.

Required public routes and evidence:

| Route | Must demonstrate |
| --- | --- |
| `/` | Clear software-platform description, two campaign types, founder/affiliate CTAs, trust strip, support footer, and policy links. |
| `/about` | Legal entity, operator purpose, launch scope, manual vetting, and contact path. |
| `/how-payments-work` | SetupIntent reservation, close-date charge trigger, founder MoR, direct-charge preference, approved backup possibility, 5% fee, refunds, and milestone controls without escrow language. |
| `/safety` | Manual founder/campaign/affiliate review, digital-only scope, prohibited categories, claim review, fraud monitoring, dispute evidence, sanctions checks, and support escalation. |
| `/terms` | Complete canonical Terms file, not a summary. |
| `/privacy` | Complete canonical Privacy file, including Stripe sharing and optional founder-data sharing. |
| `/cookies` | Complete canonical Cookie file. |
| `/refunds` | Complete canonical refund/cancellation rules for both campaign types and listing fees. |
| `/fulfillment` | Complete digital fulfillment, delivery, communication, and delay rules. |
| `/aup` | Complete founder/platform AUP aligned to current Stripe restricted-business rules. |
| `/affiliate-aup` | Complete affiliate conduct, promotion, sanctions, compensation, and enforcement rules. |
| `/ip-agreement` | Complete per-campaign IP/confidentiality agreement. |
| `/campaign/sample-pre-build` | Safe, realistic Idea Campaign example with threshold, reward, date, MoR disclosure, exact consent, and sample-only banner. |
| `/campaign/sample-pre-launch` | Safe, realistic Product Campaign example with delivery/access promise, reward, date, MoR disclosure, exact consent, and sample-only banner. |

Use these safe sample concepts unless a similarly low-risk replacement is approved:

**Sample Idea Campaign — FocusFlow**

- Product: AI-assisted study and productivity planner for university students.
- Promise: A browser-based planning tool, not medical, therapeutic, academic-guarantee, or financial advice.
- Threshold: A concrete order-count threshold shown publicly.
- Rewards: Digital early-access plans with exact delivery month/year.
- Claims: Limited to workflow, organization, and disclosed product functionality.

**Sample Product Campaign — ClipCraft**

- Product: A live creator video-repurposing tool launching new collaboration features.
- Promise: Access to specified software functionality, with exact access month/year.
- Rewards: Digital access tiers only.
- Claims: Limited to demonstrated product functions; no guaranteed income, reach, or business result.

Submission screenshots should capture:

1. Homepage hero and trust strip.
2. How-payments page architecture and charge-timing sections.
3. Safety controls.
4. Complete footer with legal entity, email, postal address, SLA, and policy links.
5. Both sample campaign pages.
6. Both checkout drawers and consent checkboxes in sample mode.
7. Founder MoR disclosure.
8. Sample-only banner proving that payment information is not collected.

### G.3 Secure application data sheet

Copy the current values from this table into Stripe only after the operator verifies them against the live website and secure company records. Bracketed fields must be completed inside Stripe's authenticated flow or another approved secure channel; they must not be copied into tickets, public documents, or ordinary email.

| # | Stripe field | Proovd answer |
| ---: | --- | --- |
| 1 | Country | United States |
| 2 | Business type | Single-member LLC, unless the verified Stripe account record requires a different exact classification |
| 3 | Legal business name | Proovd LLC |
| 4 | Doing-business-as name | Proovd |
| 5 | EIN / tax ID | `[EIN — SECURE RECORD]` |
| 6 | Public business address | Proovd LLC, 254 Chapman Rd, Ste 208 #27541, Newark, DE 19702, USA |
| 7 | Business phone | `[BUSINESS PHONE — SECURE RECORD]` |
| 8 | Website | `https://proovd.co` |
| 9 | Short description | Software platform for vetted-founder crowdfunding and affiliate-led distribution of digital products. |
| 10 | Long description | Use Section G.5.2. |
| 11 | Products/services | Digital-only pre-order campaigns; founder listing/review; campaign-specific affiliate recruitment and association, attribution, and compensation records; campaign payment orchestration through Stripe Connect. |
| 12 | Suggested MCC | 5734 — Computer Software Stores for applicable software activity only, subject to Stripe's final platform/connected-seller classification; no universal hard-code and never quasi-cash 6051 |
| 13 | Statement descriptor | `PROOVD CAMPAIGNS`, subject to Stripe limits and founder-account configuration |
| 14 | Shortened descriptor prefix | `PROOVD` |
| 15 | Expected volume | MVP forecast only: first cohort of up to 50 invited founders/campaigns; each campaign has a US$50,000 aggregate pre-tax active-pre-order cap; update Stripe with a reasoned monthly projection before submission. |
| 16 | Average transaction | Derive from approved digital reward tiers; document the calculation rather than guessing. |
| 17 | Fulfillment | Digital access, software accounts, subscriptions, files, or other disclosed digital delivery on the campaign's exact month/year. |
| 18 | Refund policy URL | `https://proovd.co/refunds` |
| 19 | Support | `support@proovd.co`; one-business-day response SLA |
| 20 | Representative legal name | `[OWNER LEGAL NAME — SECURE RECORD]` |
| 21 | Representative date of birth | `[DATE OF BIRTH — SECURE RECORD]` |
| 22 | Representative title | Owner / authorized representative, verified against company records |
| 23 | Representative residential address | `[RESIDENTIAL ADDRESS — SECURE RECORD]` |
| 24 | Identity document | `[PASSPORT OR GOVERNMENT ID — STRIPE SECURE UPLOAD]` |
| 25 | Beneficial owner | `[BENEFICIAL OWNER NAME AND OWNERSHIP — SECURE RECORD]` |
| 26 | Bank account | `[US BUSINESS BANK ACCOUNT — STRIPE SECURE COLLECTION]` |

Before using rows 15–16, prepare a one-page forecast with:

- invited campaigns per month;
- expected live campaigns per month;
- average reservations per campaign;
- average digital reward price;
- expected capture success rate;
- gross campaign volume;
- 5% Proovd platform revenue;
- listing-fee revenue shown separately;
- highest plausible transaction and campaign volume;
- refund and dispute assumptions.

### G.4 Connect application/wizard answer map

Stripe can change question wording and order. Answer the substance below, capture screenshots of the submitted answers, and record any wording change that affects the architecture.

| Wizard topic | Answer and operator note |
| --- | --- |
| Platform model/category | Crowdfunding/software marketplace for digital products, subject to Stripe's classification. Do not choose investment, lending, donations, or money transmission. |
| Who sells to the customer | Each founder sells their own digital reward/product and remains merchant of record for the campaign charge. Proovd sells only the listing/review service directly to founders. |
| Platform role | Proovd provides software, manual vetting, campaign presentation, campaign-specific affiliate recruitment/association and attribution, support coordination, and payment orchestration. |
| Charge type | Request preferred direct charges on Founder Standard accounts. Ask Stripe to approve a platform-side application-fee amount containing the separately ledgered 5% Proovd fee plus provisional Affiliate compensation at the maximum locked base/bid/Creator-specific-bonus percentage, followed by a post-close Affiliate Transfer or return of unearned amounts. Disclose SCT with `on_behalf_of` as the backup. |
| Connected-account relationship | Founder is the campaign seller/payment connected account for Backer charges. Affiliates are separate recipient connected accounts used only to receive Admin-approved Transfers/payouts after reconciliation; they never process Backer charges and are not merchants of record. Ask Stripe to confirm the required recipient account model/capabilities. |
| Delayed release | Explain the campaign-specific schedules — Pre-build (Idea): a single 100% payment at Day 3 after checks and recorded approval; Pre-launch (Product): 40% Day 3 / 60% Day 14 with the narrow evidence-based early exception. Ask Stripe which approved control implements them; do not call it escrow. |
| Seller types | US individuals/sole proprietors and US businesses, as Stripe permits. |
| Branding | Campaign page clearly names both Proovd and the founder; charge/receipt/descriptor configuration must make the founder seller and Proovd platform role recognizable. |
| Account type | Standard connected accounts for founders unless Stripe directs a different supported account type in writing. |
| Geographic scope | US Founders, US Affiliates, and US Backers only for the controlled MVP pilot. Non-US Backer billing locations and all cross-border Founder/Affiliate onboarding are deferred. |
| Risk statement | Use Section G.5.3 and offer the controls inventory in Section G.11. |

If a forced-choice wizard answer cannot accurately express the selected architecture:

1. Do not invent a contradictory answer.
2. Save a screenshot of the question and available choices.
3. Choose the closest truthful answer only if a free-text qualification is available.
4. State the qualification in the application notes and first Sales email.
5. Ask Stripe to confirm the answer and architecture in writing before live mode.

### G.5 Canonical application copy

#### G.5.1 Short business description

> Proovd is a US software platform for manually vetted founders to run digital-product pre-order campaigns and work with invited, identity-disclosed affiliates recruited for specific campaigns. Founders remain the sellers and merchants of record; Proovd provides campaign software, campaign-specific affiliate recruitment and activation, attribution, support coordination, and Stripe Connect payment orchestration.

#### G.5.2 Long business description

> Proovd LLC operates a software platform for digital-only, reward-based pre-order campaigns. At MVP, Proovd manually invites and reviews US Founders and approximately 50 US Affiliates, and accepts only US Backers. Affiliates are recruited for identified campaigns, use private campaign-specific signup invitations, and may join before launch or while a campaign is live. Founders offer clearly described software access, subscriptions, digital files, tools, or other digital rewards with a disclosed delivery month and year. US Backers save a card with explicit consent and are charged only at the disclosed trigger. An Idea Campaign charges only if its practical unique-active-Backer threshold is met; a Product Campaign charges active one-reward transactions at close. The Founder remains seller, merchant of record, and tax-responsible party. Backers pay reservation-time calculated sales tax on top and authorize the exact total; Proovd asks Stripe to approve reuse of the still-valid calculation at charge with no close-time reconsent path. Proovd's 5% and Affiliate percentages apply only to captured pre-tax reward subtotal. Proovd asks Stripe to approve direct charges on the Founder account, a platform-side amount containing separately ledgered Proovd and provisional Affiliate shares at the maximum locked base/bid/Creator-specific-bonus percentage, and a later Transfer to the Affiliate recipient connected account after close/retry/verification. Proovd manually reviews campaigns, claims, Affiliates, fraud indicators, fulfillment evidence, refunds, disputes, and payment decisions. The launch excludes physical goods, international Backers, and prohibited or regulated categories.

#### G.5.3 Risk and delayed-release explanation

> Proovd uses manual onboarding and campaign approval, digital-only scope, US-only Founders, Affiliates, and Backers, an 18+ requirement, an atomic US$50,000 pre-tax active-pre-order cap, explicit saved-card/off-session consent, 48-hour failed-payment retry, Radar/internal fraud flags, connected-account and tax-setting checks, W-9 readiness, fulfillment evidence, cause-based refund/Affiliate-adjustment workflows, Admin MFA/reauthentication, and an operator kill switch. Idea Founder share is 100% eligible at Day 3 after retry, W-9, risk checks, and approval; Product follows 40% Day 3 / 60% Day 14 with the evidence-gated early exception. Affiliate commission and any fully earned fixed Creator payment transfer only after close/retry/work verification. Proovd requests the direct-charge/connected-account/Transfer model in this brief and will implement SCT/`on_behalf_of` or another configuration if Stripe directs. Proovd does not describe any arrangement as escrow, trust, or custody.

#### G.5.4 Product and revenue description

> Founders pay Proovd a listing/review fee calculated as US$35 base minus US$2 for each completed optional item, capped at US$10 in savings, with a US$25 minimum. The entire Checkout charge actually paid, including associated tax treatment, is fully refunded when there are zero eligible recruits or no Creator and Founder mutually accept locked terms within 72 hours of successful listing payment, or when a required launch Creator fails and no fully ready replacement exists within three US business days of the recorded failure. Pending proposals do not extend the clock. US Backers pay reservation-time calculated sales tax on top and authorize the exact total; Proovd requests approval to reuse that still-valid calculation/total at charge and to drop an unusable calculation without charge, with no close-time reconsent flow. Proovd's 5% and Affiliate percentages apply only to captured pre-tax reward subtotal. Affiliate compensation has a 30% base, or 20% when a Creator-requested Product-Campaign fixed payment is accepted; percentage bidding exists only on high-effort campaigns, Creator-specific bonuses use only that Creator's captured attributed results, and total percentage compensation is capped at 50%. The fixed amount is funded before work, releases nothing at first post, and is paid with finalized commission only after close, the 48-hour retry window, and verification of every agreed deliverable. Proovd requests Stripe approval for direct charges on Founder Standard accounts, a platform-side amount containing Proovd and provisional Affiliate shares, and a later Transfer to the Affiliate recipient connected account; SCT/`on_behalf_of` is the backup.

### G.6 Pre-submission consistency review

Complete this review against the actual live pages and application draft. Record the date, reviewer, result, screenshots/URLs, and any remediation ticket.

| Check | Pass condition |
| --- | --- |
| Legal entity | Proovd LLC appears consistently; no conflicting entity or DBA. |
| Business model | Every surface says digital-product crowdfunding/software platform, not investment, donation, banking, escrow, or generalized payment processing. |
| Seller/MoR | Founder is seller and MoR for campaign transactions; Proovd is seller/MoR only for its listing fee. |
| Campaign types | Pre-build threshold and Pre-launch close-date rules match Sections 3, 7, 10, and 11. |
| Charge timing | No-charge-today and later off-session charge language is exact and visible before consent. |
| Architecture | Direct charges are identified as preferred; SCT is identified only as Stripe-selected backup. No page claims final approval early. |
| Payment schedules | Idea (Pre-build) single 100% Day 3 payment, Product (Pre-launch) 40% Day 3 / 60% Day 14, and the evidence-gated Product early-release exception match everywhere. |
| Listing fee | US$35 base, US$2 optional-item discounts, US$25 minimum, the full Checkout-total refund including tax treatment, only mutually accepted locked terms counting, pending proposals not extending the 72-hour window, and the clock beginning at successful listing-fee payment all match. |
| Platform fee | 5% is consistent. |
| Geography | US Founders, Affiliates, and Backers only for the controlled pilot; non-US billing locations are rejected. |
| Cohort | Approximately 50 invited founders/campaigns and approximately 50 invited affiliates are not accidentally merged into one actor group. The founder/campaign/invitee terms refer to the same founder cohort. |
| Products | Digital-only scope and prohibited launch categories match. |
| Support | `support@proovd.co` and one-business-day SLA appear on all public pages. |
| Address | Public business address is identical on footer, policies, and application. |
| Samples | Neither sample collects cards; neither uses medical, investment, brokerage, or other high-risk claims. |
| Affiliate payment | Surfaces describe the selected Stripe connected-account/Transfer direction without claiming approval. No live Transfer or payout promise is enabled before written approval. |
| Privacy | Phone is collected but not described as verified. Email/purchase details are mandatorily shared with the Founder immediately after a saved pre-order for fulfillment preparation/support even though no charge occurred; marketing/research/survey contact remains a separate unchecked opt-in. |
| Sensitive data | No EIN, DOB, passport, residential address, bank details, access token, API key, or raw tax form appears in the submission pack. |
| Policy completeness | All canonical legal files are complete, live, internally linked, and implement the current MVP decisions. |

Application package folder:

```text
stripe-application/
  01-public-site-screenshots/
  02-application-answer-export/
  03-company-and-ownership-secure/
  04-bank-and-tax-secure/
  05-product-and-flow/
  06-risk-controls/
  07-forecast/
  08-sales-correspondence/
  09-architecture-decision/
  10-test-and-live-readiness/
```

Folders 03 and 04 must use secure access controls. Ordinary project members, affiliates, founders, and public-site contractors do not receive access by default.

### G.7 Email-first Stripe contact sequence

Email-first is the default path. Use Stripe's current official Sales/contact route and the email address associated with Proovd's Stripe account. Do not use personal social outreach as the primary approval record.

#### G.7.1 Sequence

| Timing | Action | Required record |
| --- | --- | --- |
| Day 0 | Submit the platform/Connect application only after Section G.6 passes. Send the opening Sales request the same business day if a Sales route is available. | Application export, submission ID, screenshots, sent email, recipient/route, timestamp. |
| Day 1 | Confirm automated receipt and add its case/reference number to the tracker. | Case number and acknowledgment. |
| Day 3 | If Stripe requests information, acknowledge within one business day and state when the complete response will arrive. | Response owner and due time. |
| Day 5 | If no human response, send one concise follow-up in the existing thread or case. | Follow-up timestamp. |
| Day 7 | Re-check Dashboard notifications, capability requirements, account email, and spam folders; complete any legitimate requirement through Stripe's authenticated UI. | Screenshot/log of review. |
| Day 10 | If still unanswered, use Stripe's official support/contact path, quote the existing case, and request routing to Connect/platform Sales or underwriting. | New contact reference and link to original case. |
| Ongoing | Keep all answers in one decision log. If Stripe changes the architecture, update this MVP before engineering implements the change. | Dated architecture decision record. |

The timing above is an operating cadence, not a promise about Stripe's response time or approval duration.

#### G.7.2 Opening email

**Subject:** Proovd LLC — Connect review for US digital-product crowdfunding platform

```text
Hello Stripe Connect team,

Proovd LLC is preparing a US MVP for a software platform where manually vetted US founders run digital-only, reward-based pre-order campaigns and work with campaign-specific invited US affiliates. Founders sell their own digital rewards and remain the merchants of record. Proovd provides campaign software, vetting, campaign-specific affiliate recruitment and association, attribution, support coordination, and payment orchestration.

US Backers save a card with explicit consent and are charged only at the disclosed campaign trigger. Reservation-time sales tax is added on top and the exact total is authorized; for the controlled pilot we ask to reuse that still-valid calculation/total at charge and drop an unusable calculation without charging rather than implement close-time reconsent. Proovd and Affiliate percentages apply only to the pre-tax reward subtotal. We prefer direct charges on each Founder's Standard connected account and ask Stripe to approve a platform-side application-fee amount containing the separately ledgered 5% Proovd fee plus provisional Affiliate compensation at the maximum locked base/bid/Creator-specific-bonus percentage. After close, 48-hour retry, bonus evaluation, and verification, Proovd would transfer earned Affiliate amounts to the Affiliate recipient connected account and return unearned/untransferred amounts to the Founder. The Founder payment schedule remains Idea 100% at Day 3 and Product 40% Day 3 / 60% Day 14 by default. We can implement SCT with `on_behalf_of` as a backup if Stripe directs.

Our launch is digital-only, US-Founder, US-Affiliate, US-Backer, 18+, and capped at US$50,000 in aggregate pre-tax active-pre-order value per campaign. We manually review Founders, campaigns, claims, Affiliates, practical unique-Backer signals, fulfillment evidence, refunds, fraud signals, and disputes. Our public payment explanation, safety page, policies, and two non-payment sample campaigns are live at https://proovd.co.

Could you confirm the correct Connect application path and arrange a review of:
1. eligibility for this business model;
2. the preferred versus backup charge architecture;
3. the available payout controls for Standard connected accounts;
4. application-fee, refund, dispute, negative-balance, and statement-descriptor behavior; and
5. whether Affiliates may be connected accounts that receive campaign-specific Transfers from the platform after close, and which account type/capabilities Stripe requires?

We can provide the complete flow, forecast, controls inventory, company documents, and secure identity/banking information through an approved channel.

Thank you,
[OWNER/AUTHORIZED REPRESENTATIVE NAME]
Owner, Proovd LLC
[BUSINESS PHONE]
support@proovd.co
Stripe account: [ACCOUNT ID — INCLUDE ONLY IN STRIPE-AUTHENTICATED CASE]
```

#### G.7.3 Five-business-day follow-up

**Subject:** Re: Proovd LLC — Connect review for US digital-product crowdfunding platform

```text
Hello,

I am following up on case [CASE NUMBER] regarding Proovd's Connect configuration for US digital-product pre-order campaigns. Our public site, policies, sample flows, risk controls, and architecture summary are ready for review. We have not enabled live saved-card reservations or campaign charges.

Please let us know whether this request is with the correct Connect/platform team and what additional information or secure documentation is required. We would especially value written confirmation of the approved charge and founder payout-control configuration before implementation is finalized.

Thank you,
[OWNER/AUTHORIZED REPRESENTATIVE NAME]
Proovd LLC
```

#### G.7.4 Requested written decisions

Do not close the Sales/underwriting track until the decision log answers all of these:

1. Is Proovd's digital-only, reward-based campaign model eligible?
2. Are founder Standard accounts permitted for the proposed relationship?
3. Are direct charges approved?
4. What exact payout/manual-control capability is approved for the disclosed campaign-specific schedules (Idea single Day 3 payment; Product 40% Day 3 / 60% Day 14)?
5. If that control is not approved, is SCT with `on_behalf_of` the required backup?
6. Who is debited first for refunds and disputes under the approved path?
7. Who carries negative balances, and what recovery/reserve expectations apply?
8. Is an application-fee amount containing the separately ledgered 5% Proovd fee plus provisional Affiliate compensation at the maximum locked base/bid/Creator-specific-bonus percentage supported on direct charges, and may Proovd later Transfer earned amounts to the Affiliate recipient connected account or return unearned/untransferred amounts to the Founder connected balance?
9. What statement descriptor and receipt behavior will backers see?
10. Can SetupIntents and off-session PaymentIntents be used for the disclosed campaign window?
11. Are any campaign, transaction, rolling-reserve, or volume limits imposed?
12. May Affiliates be onboarded as connected accounts that receive Admin-approved Transfers after campaign close, retry, and verification? If yes, which account model, capabilities, tax-reporting responsibility, reversal/negative-balance rules, and payout controls apply? If not, record the required alternative before product behavior changes.
13. What capability, monitoring, or document requirements must remain satisfied after launch?
14. Which changes require Stripe notice or renewed review?
15. May Proovd link/reuse the reservation-time Stripe Tax calculation and exact authorized total at a campaign trigger within the approved validity period, with an unusable calculation dropped without charge and no close-time reconsent flow?
16. May a discretionary manual thank-you payment be sent from retained Proovd listing-fee revenue to an Affiliate recipient connected account after all refund rights resolve, and what tax/reporting treatment applies?

### G.8 Sales/underwriting meeting pack

The call owner should have these materials open:

- live homepage, how-payments, safety, policies, and sample campaigns;
- one-page company summary;
- end-to-end flow diagram or written sequence;
- preferred and backup architecture comparison;
- 12-month volume forecast with assumptions;
- controls inventory;
- founder, campaign, affiliate, reservation, refund, and dispute review procedures;
- secure document index without raw secure documents in the meeting invite;
- list of requested written decisions from Section G.7.4;
- notes template with attendees, date, representations made, open questions, owner, due date, and exact follow-up wording.

#### G.8.1 Thirty-second opening

```text
Proovd is a US software platform for manually vetted Founders to validate and pre-sell digital products with an invited Affiliate distribution network and US Backers. The Founder sells the reward and remains merchant of record. Backers save a card and are charged the exact authorized reward subtotal plus reservation-time disclosed sales tax only at the trigger. We are asking Stripe to approve direct charges on Founder Standard accounts, a platform-side amount containing separately ledgered Proovd 5% plus provisional Affiliate compensation at the maximum locked percentage, and a later post-close Transfer to the Affiliate recipient connected account. SCT/`on_behalf_of` is the backup. We will not enable live processing until Stripe confirms the charge, tax-calculation reuse, Transfer, refund/dispute, and fixed-payment paths.
```

#### G.8.2 End-to-end flow to narrate

1. Proovd manually invites and verifies a US founder with a personalized invitation containing a secure temporary-draft link while recruiting reviewed US affiliates for that identified campaign.
2. Recruited affiliates use private campaign-specific links to create or claim accounts and wait while the founder completes signup.
3. In the draft, the founder chooses the campaign path, reviews the human-prefilled Problem/Solution, writes Competition, and sees the possible-creator count — all before creating an account.
4. The founder claims a prefilled account; the preparing campaign automatically appears to its pre-associated affiliates. The founder then completes optional materials or books the human interview and completes the appropriate Stripe connected-account onboarding.
5. The founder pays the calculated listing fee; successful payment activates the formal affiliate response window while the founder builds the campaign in parallel.
6. Proovd resolves the initial launch roster and locks accepted compensation terms — base percentages per the matrix, any high-effort percentage bids, and any Product-Campaign fixed Creator payment funded in full before work. That fixed amount releases nothing at first post.
7. Once the initial roster is launch-ready and campaign building is complete, Proovd reviews the campaign and schedules one coordinated launch time. At that time the approved page activates first, scheduled tracking links activate and resolve to it, Creators publish, and Admin verifies the live posts afterward. Additional Affiliates may join before close under the same agreement, readiness, and non-retroactive attribution controls.
8. A US Backer reads the Founder/MoR, reservation-time tax, exact amount, and charge-timing disclosures; completes the survey; enters unverified phone and a US billing location; confirms 18+; acknowledges that email/purchase details go to the Founder immediately after the saved pre-order for fulfillment preparation/support; separately chooses optional Founder marketing/research/survey contact; and saves a card with explicit consent.
9. Backer may cancel before close without charge.
10. At close, a Pre-build (Idea) campaign charges only if its threshold is met; a Pre-launch (Product) campaign charges all active reservations. Each charge uses the same still-usable reservation-time Tax calculation and exact authorized total; an unusable calculation creates no charge.
11. Successful captured charges update founder, affiliate, backer, and admin ledgers. Failed charges enter the recovery flow.
12. Proovd records the disclosed campaign-specific founder-share eligibility decisions and fulfillment evidence using the Stripe-approved control model.
13. Refunds, disputes, support, affiliate earnings, and campaign updates remain traceable to the original consent and campaign version.

### G.9 Canonical underwriting Q&A

Use these answers as a baseline, then answer the actual question directly. Do not hide exceptions, estimates, or unresolved approval dependencies.

**1. What does Proovd sell?**

Proovd sells software-based campaign listing, review, campaign-specific Affiliate recruitment/association, attribution, and operations services to Founders. A Founder sells the digital reward to each Backer and remains tax responsible. Proovd charges its listing fee directly and earns 5% of captured pre-tax reward subtotal. Under the requested direct-charge model, the platform-side amount would include that 5% plus separately ledgered Affiliate percentage compensation that Proovd later Transfers to the Affiliate connected account after close/retry/verification.

**2. Is this investment crowdfunding or donation crowdfunding?**

No. Backers receive disclosed digital rewards or product access. They receive no equity, debt, revenue share, interest, token, security, charitable receipt, or investment return.

**3. Who is merchant of record?**

The founder is seller and merchant of record for campaign transactions. Proovd is merchant of record only for the separate listing fee it sells to founders.

**4. Why save cards instead of charging immediately?**

Campaigns run beyond a short card-authorization window. The SetupIntent records explicit consent and stores a payment method without a present charge. At the disclosed trigger, Proovd initiates an off-session PaymentIntent in the approved account context. Backers may cancel before close.

**5. How do the two campaign types differ?**

Pre-build is conditional: no Backer is charged if the unique-active-Backer threshold is missed; one Backer has one active Idea pre-order. Pre-launch is a close-date pre-order: active transactions are charged regardless of the internal target; one Backer may place multiple one-reward transactions.

**6. Why is founder share staged?**

The schedule is campaign-specific. A Pre-launch (Product) campaign is staged 40% at Day 3 and 60% at Day 14, with the second portion releasable earlier only on verified delivery evidence. A Pre-build (Idea) campaign releases a single payment of 100% of the eligible share at Day 3, because the charge occurred only after the public order threshold was met; that release still requires W-9 readiness, payment/risk checks, and a recorded admin approval, and later reviews serve enforcement rather than a second release. The disclosed schedule supports tax readiness, communication, fulfillment-evidence review, and response to early fraud/refund/delivery flags. It is not described as escrow. The implementation will use only controls Stripe approves for the selected architecture.

**7. How are founders vetted?**

Proovd manually reviews identity-disclosed founder information, Stripe connected-account readiness, US eligibility, product category, product evidence, claims, campaign type, rewards, delivery terms, refund terms, sanctions representations, policy acceptance, communication commitments, conflicts, and prior Proovd history. A campaign remains unpublished until admin approval.

**8. How are affiliates vetted?**

Approximately 50 launch Affiliates are recruited and invited for identified campaigns. They create or claim accounts through private campaign-specific links, confirm US/18+ eligibility, and complete Stripe-controlled identity/tax/bank onboarding for the requested recipient connected-account configuration. They may join an initial roster or a live campaign and, as a private manually known pilot cohort, may view the full logged/revocable preparing kit before accepting the per-campaign agreement. They accept the Affiliate AUP, Creator-only campaign IP agreement, FTC duties, claim limits, and anti-fraud rules before work. The approved campaign page and tracking links activate before Creator publication; every first post is then checked for attribution validity/compliance and releases no fixed-payment money. The full fixed amount is eligible only after close and complete deliverable verification.

**9. How does Proovd prevent prohibited products and misleading claims?**

Launch scope is digital-only and excludes high-risk/regulated categories. Admin reviews the product, campaign copy, reward, media, claims, evidence, delivery commitment, refund terms, and affiliate materials before publication. Material campaign edits require cancellation/relisting. Admin may suspend or kill a campaign and keeps the AUP aligned to Stripe's current restricted-business rules.

**10. How are fraud and chargebacks managed?**

Proovd uses Stripe Radar plus reservation caps/flags, self-pledge controls, duplicate-account and relationship checks, suspicious conversion/click review, large-reservation review, idempotent charge batches, clear consent records, policy/campaign versioning, delivery/support evidence, refund workflows, webhook monitoring, and a human kill switch. The approved architecture's refund, dispute, and negative-balance allocation will be documented before live mode.

**11. How are refunds handled?**

Before close, cancellation causes no charge. Idea threshold failure causes no charge. After an Idea charge there is no voluntary/change-of-mind refund, with the defined duplicate/wrong/canceled/unauthorized, misrepresentation, applicable non-delivery, serious-violation, legal, Stripe, and issuer exceptions. Product voluntary refunds follow the preserved Founder-policy version shown at consent. The Founder bears Founder/product-caused refunds; finalized valid Affiliate earnings remain unless Affiliate misconduct caused the charge/refund/dispute. Listing-fee refunds follow the 72-hour no-acceptance and three-business-day replacement rules.

**12. What happens if a founder does not deliver?**

Proovd requires progress evidence and communication, blocks unreleased founder share where the approved controls allow, starts refund/reversal and dispute-support workflows, records the incident, and applies a one-strike ghost ban for the defined ghosting conditions. For a Pre-build (Idea) campaign, the single founder payment may already have been released at Day 3, so recovery beyond unreleased funds is reversal-based or contractual on a best-effort basis. Released amounts may require contractual recovery and are not represented as guaranteed recoverable.

**13. What volumes do you expect?**

Use the current documented forecast from Section G.3. State assumptions and ranges. Never substitute the US$50,000 per-campaign cap for an actual expected-volume forecast.

**14. Are backers, founders, or affiliates outside the US?**

Founders, Affiliates, and Backers are US-only for the controlled MVP pilot. Checkout rejects non-US billing locations. International Backers and all cross-border Founder/Affiliate onboarding remain disabled until an explicit country rollout, payment, tax, legal, sanctions, consumer-rights, and provider requirements are approved and implemented.

**15. How are affiliates paid?**

The product attributes captured pre-tax reward subtotal under the last-valid-link rule, applies locked terms (30% base, or 20% with an accepted Product-Campaign fixed payment), applies any Creator-specific bonus only from that Creator's captured attributed results, and enforces the 50% percentage ceiling. The requested model on direct Founder charges routes Proovd's 5% plus provisional Affiliate compensation at the maximum locked base/bid/bonus percentage to the platform, then sends finalized commission and any fully earned fixed payment to the Affiliate recipient connected account after close/retry/verification; unearned/untransferred amounts return to the Founder. This remains disabled until Stripe confirms the exact connected-account, Transfer, adjustment, tax, reversal, negative-balance, and payout requirements.

**16. How is sales tax handled?**

The Founder is seller and tax-responsible party. A US Backer sees and authorizes reward subtotal plus reservation-time calculated sales tax. For the controlled MVP, Proovd asks Stripe/tax counsel to approve linking or reusing that same still-valid calculation and exact total at the later PaymentIntent. The MVP does not recalculate tax or seek higher-total reconsent at close; an expired, invalid, or unusable calculation produces no charge. Proovd and Affiliate percentages, the Idea threshold, and campaign cap exclude tax. A Founder cannot launch until the connected account's tax settings, product code, required registrations, calculation-validity rule, and legal/tax review of liability, sourcing, filing, and refund treatment are complete.

**17. Have you been rejected or terminated by a processor?**

Answer from verified company records. If none, say none. If any, disclose the facts, dates, reason provided, remediation, and current status; do not minimize or speculate.

**18. Who provides customer support?**

Proovd coordinates platform, reservation, and escalation support through `support@proovd.co` with a one-business-day response commitment. Founders remain responsible for product fulfillment and product-specific obligations. All cases are associated with the campaign, reservation, charge, and evidence record where applicable.

**19. What will change after MVP?**

MVP is deliberately limited to US founders/affiliates, digital rewards, manually invited cohorts, manual reviews, one active campaign per founder, three per affiliate, and the stated campaign cap. Any geographic, product-category, account-model, money-movement, or material volume expansion is treated as a controlled change and raised with Stripe when required.

### G.10 Underwriting document pack

Prepare the following before submission. A checklist entry means the document exists, is current, matches the public site/application, and has an owner. It does not mean every file should be emailed. Identity, ownership, tax, and banking records go only through Stripe's authenticated upload or an approved secure channel.

#### G.10.1 Company and ownership — secure

- Certificate of formation/incorporation.
- Good-standing evidence if requested.
- EIN confirmation.
- Operating agreement or ownership register.
- Authorized representative evidence.
- Beneficial-owner names and percentages.
- Government identity document for required representative/owners.
- Residential-address evidence if requested.
- Public business-address evidence.
- US business-bank evidence.
- Explanation of any DBA or domain/entity-name difference.

#### G.10.2 Product and business model

- One-page company summary using the controlling application position.
- Public-site route index.
- Both sample campaign screenshots.
- Founder onboarding and review flow, including campaign-specific affiliate recruitment, private affiliate signup, the `founder_signup_complete` handoff, and the parallel affiliate-response/campaign-building sequence.
- Founder interview scheduling flow.
- Affiliate invite, review, agreement, and tracking flow.
- Backer reservation, cancellation, close-charge, retry, refund, and dispute flow.
- Preferred architecture description.
- Backup architecture description.
- Founder-share eligibility decision flow.
- Affiliate connected-account and Transfer approval dependency.
- Listing-fee and 5% platform-fee explanation.
- Current calculated pricing: US$35 base, US$2 optional-item discounts, US$25 minimum.
- Twelve-month forecast and assumptions.
- Support and escalation procedure.

#### G.10.3 Risk and compliance

- Digital-only allowed/prohibited category matrix.
- Current founder/platform AUP.
- Current affiliate AUP.
- Founder and campaign review rubrics.
- Claim and sample-media review checklist.
- Sanctions eligibility representations and escalation process.
- Fraud and self-pledge controls.
- Reservation and campaign caps.
- Refund/cancellation process.
- Dispute evidence inventory.
- Fulfillment evidence and communication process.
- Ghosting and campaign-kill process.
- Material-change/cancellation/relisting process.
- Data access and retention controls.
- Incident, webhook, and reconciliation procedure.

#### G.10.4 Technical and payment evidence

- Stripe account and Connect platform identifiers stored securely.
- Requested capabilities and their statuses.
- API version.
- Preferred-path object/context diagram.
- Backup-path object/context diagram.
- Webhook endpoint/event list.
- Idempotency design.
- SetupIntent consent/version record.
- PaymentIntent batch/retry design.
- Refund, reversal, transfer, application-fee, and dispute ledger mapping.
- Test-mode scenario log required by Section 18.7.
- Environment/key separation evidence.
- Live-mode enablement checklist and named approver.

#### G.10.5 Response discipline

- Acknowledge every Stripe request within one business day.
- Assign one accountable owner and one internal due time.
- Answer the question asked first, then attach only relevant explanation/evidence.
- Keep estimates labeled as estimates and provide assumptions.
- If an earlier answer was wrong, correct it explicitly with date and impact.
- Do not alter the website or application story merely to sound lower-risk; change the business/product only through an approved internal decision and then update all surfaces.
- Store the exact submitted answer and attachment version in the application folder.
- Send sensitive records only through an authenticated or specifically approved secure route.
- Ask Stripe to confirm material architecture decisions in writing after any call.

### G.11 Risk-control inventory for Stripe

This inventory is both an underwriting attachment and a build/operations commitment. A control may be described as “planned before live mode” only when it is actually in this MVP and has a named acceptance test.

#### G.11.1 Product and delivery risk

1. Digital-only rewards at launch.
2. Manual founder and campaign review before publication.
3. Exact delivery month/year on every reward.
4. Separate Pre-build and Pre-launch logic and disclosures.
5. Pre-build threshold failure creates no charge.
6. Pre-launch reward/access promise is explicit and reviewable.
7. Founder updates and communication cadence remain required after close.
8. Delivery/progress evidence is retained with the campaign record.
9. Material post-launch changes require cancellation/relisting.
10. Admin suspension/kill switch stops new reservations and, when still pre-charge, prevents capture.
11. One-strike ghost-ban workflow for the defined non-response/failure conditions.

#### G.11.2 Card, payment, and fraud risk

1. SetupIntent with versioned explicit consent; no hidden immediate charge.
2. Backer can cancel before close without charge.
3. Stripe Radar on every PaymentIntent.
4. Email/IP reservation caps or review flags.
5. Review flag for any reservation above the highest valid reward-tier amount.
6. Duplicate account, affiliate self-pledge, founder/affiliate relationship, and suspicious conversion flags.
7. Idempotency keys and per-reservation final-state guards for close batches.
8. Webhook signature verification and replay-safe event handling.
9. Failed off-session charge recovery with customer-action/update-card path.
10. Organic, house, and affiliate attribution separated.
11. No commission on Affiliate self-pre-orders or uncaptured amounts. Refunded transactions follow the cause-based rule: unfinalized earnings may cancel; finalized valid earnings remain unless Affiliate misconduct caused the refund/dispute.
12. Environment-safe separation of test and live keys.

#### G.11.3 Refund and dispute risk

1. Exact campaign type, founder/MoR, reward, delivery, charge trigger, cancellation, and refund terms shown before consent.
2. Consent text/version, timestamp, campaign version, IP/session evidence, SetupIntent, reservation, charge, and communication records retained.
3. Refund/reversal/commission-adjustment records linked to the original charge.
4. Proovd support route visible on every public page and campaign.
5. One-business-day support response commitment.
6. Dispute evidence packet task on dispute webhook/event.
7. Evidence includes product/campaign disclosures, receipt, consent, delivery/access, updates, and support history.
8. Founder obligations and recovery rights documented in the canonical AUP/Terms.
9. Admin can block further activity while a material risk issue is investigated.
10. Architecture-specific refund, dispute, negative-balance, transfer-reversal, and application-fee behavior documented before live mode.

#### G.11.4 Founder and affiliate risk

1. US-only, 18+, identity-disclosed launch cohorts.
2. Founder completes the approved Stripe connected-account requirements.
3. Founder accepts digital-only, sanctions, prohibited-business, truthful-claim, fulfillment, refund, communication, and recovery obligations.
4. Affiliate accepts identity, sanctions, FTC disclosure, claim, channel, conflict, self-pledge, anti-fraud, and data-use rules.
5. Campaign-specific affiliate recruitment, private signup, initial-roster readiness, mid-campaign additions, and locked campaign compensation terms per the §5.12 matrix.
6. Percentage-based affiliate compensation capped at 50% per captured attributed charge.
7. Affiliate connected-account, Transfer, payout, and tax-reporting approval required before live Affiliate payments.
8. One active campaign per founder; three active campaigns per affiliate.
9. Three-month founder cooldown after campaign, followed by required admin readiness approval.
10. Admin warning, suspension, removal, unpaid-earnings cancellation, cause-based negative balance/recovery, and appeal records where policy permits.

#### G.11.5 Regulatory and brand-positioning controls

1. No equity, debt, token, interest, revenue share, investment return, or charitable representation.
2. No physical goods at MVP.
3. No medical, finance/brokerage, crypto, gambling, weapons, regulated-goods, or deceptive sample campaigns.
4. AUP tracks Stripe's current restricted-business rules and sanctions obligations.
5. FTC disclosure names the specific founder/product, not Proovd unless Proovd is the promoted product.
6. Affiliate content may not promise unapproved outcomes, features, benefits, or timelines.
7. Backers are 18+; affiliates may not target minors or known under-18-skewing audiences.
8. Founder receives only the email/purchase details required for fulfillment/support by mandatory disclosed sharing; any marketing/research/survey contact or identifiable survey sharing requires a separate unchecked opt-in. Affiliates receive no Backer PII.
9. Backer phone is collected for support/fulfillment context but is not represented as verified.
10. Public language says Stripe Connect and Stripe-approved controls, never escrow/trust/custody.
11. Current policies, campaign copy, application answers, and code behavior pass the consistency review before submission and live launch.

#### G.11.6 Operational controls

1. Human admin owns campaign approval, charge-batch readiness, milestone eligibility, refund/reversal escalation, dispute evidence, and kill/suspend decisions.
2. Every sensitive admin action records actor, timestamp, target, reason, prior state, new state, and evidence link.
3. Daily review during an active close/retry window; at least weekly reconciliation otherwise during MVP operations.
4. One-business-day external support SLA and one-business-day Stripe-request acknowledgment discipline.
5. Capability and requirements status checked before each campaign is allowed to collect live card details.
6. Dashboard, webhook, job, and ledger exceptions surface to an operator; silent failures are not acceptable.
7. Architecture, policy, and volume changes use the controlled-change process in Section G.13.

### G.12 Approval, test, and live-mode sequence

The sequence below is mandatory. Passing a later step never cures a missing earlier gate.

1. **Lock current business scope.** Confirm digital-only, US founder/affiliate cohorts, campaign cap, fees, refund rules, support SLA, and safe samples.
2. **Publish complete review site.** All Section G.2 pages live; samples accept no payment information.
3. **Pass consistency review.** Section G.6 completed with no blocker.
4. **Prepare secure application pack.** Section G.10 complete; private values remain protected.
5. **Submit application and email Sales.** Save exact answers, screenshots, IDs, and case references.
6. **Answer underwriting.** Use canonical Q&A and controls inventory; log corrections and requested changes.
7. **Obtain written architecture decision.** Record direct versus backup path and all requested decisions in G.7.4.
8. **Update this MVP.** Incorporate Stripe's actual decision; remove any now-invalid preferred/backup language before engineering treats it as final.
9. **Implement in test mode.** Build the approved path and the required ledger, webhook, consent, refund, dispute, release-decision, and admin controls.
10. **Run Section 18.7 tests.** Preserve IDs, results, defects, fixes, and re-test evidence.
11. **Complete live account requirements.** Identity, ownership, banking, tax, capability, and any reserve/monitoring requirements are satisfied in Stripe.
12. **Run live-readiness review.** Product, engineering, operations, and the authorized account representative sign the checklist.
13. **Enable live card collection for one controlled campaign.** Do not enable all campaigns at once. Monitor every SetupIntent, charge attempt, webhook, refund, support case, and ledger entry.
14. **Close and reconcile the pilot.** Document capture, 48-hour retry, tax, fees, Founder payments, Affiliate earnings/Transfers/payouts, refunds/disputes, descriptors, and support outcomes before expanding.

While Stripe review is pending:

- Sample campaigns may be public in demonstration mode.
- Founder and affiliate interest/onboarding may proceed without live payment collection.
- Campaign drafts, manual reviews, campaign-specific affiliate recruitment/association, and test-mode engineering may proceed.
- No real card information may be collected.
- No live SetupIntent, PaymentIntent, application fee, Affiliate Transfer, payout, or fixed-payment funding may run.
- No public copy may say Stripe has approved the model or architecture.

#### G.12.1 Architecture decision record

Complete this block when Stripe responds and retain the supporting email/case export:

| Field | Recorded decision |
| --- | --- |
| Stripe case/reference | `[CASE ID]` |
| Decision date | `[YYYY-MM-DD]` |
| Stripe team/contact | `[TEAM/CONTACT]` |
| Approved business model | `[EXACT SCOPE]` |
| Founder account type | `[STANDARD OR STRIPE-DIRECTED TYPE]` |
| Charge architecture | `[DIRECT / SCT BACKUP / OTHER APPROVED CONFIGURATION]` |
| Payout/release control | `[EXACT APPROVED CAPABILITY AND LIMITS]` |
| Application/platform fee | `[SUPPORTED BEHAVIOR]` |
| Refund/dispute debit order | `[EXACT BEHAVIOR]` |
| Negative-balance allocation | `[EXACT BEHAVIOR]` |
| `on_behalf_of` | `[SUPPORTED/REQUIRED/NOT USED]` |
| Statement/receipt behavior | `[EXACT BEHAVIOR]` |
| SetupIntent/off-session approval | `[SCOPE AND LIMITS]` |
| Affiliate connected-account/Transfer path | `[APPROVED ACCOUNT MODEL, CAPABILITIES, TRANSFER/PAYOUT RULES, OR DISABLED]` |
| Account/campaign/volume limits | `[LIMITS]` |
| Reserve/monitoring requirements | `[REQUIREMENTS]` |
| Required future notifications | `[CHANGE TRIGGERS]` |
| Evidence location | `[SECURE FILE/CASE LOCATION]` |
| Internal owner acceptance | `[NAME/DATE]` |

Blank fields mean the decision is unresolved and live mode remains blocked for the affected function.

### G.13 Controlled changes and ongoing Stripe obligations

The following changes require an internal architecture/policy review before implementation and a Stripe check or notice whenever the written decision, Stripe account requirements, or current Stripe rules require it:

- onboarding Founders, Affiliates, or Backers outside the US;
- allowing physical goods or a new product category;
- raising the US$50,000 campaign cap or materially increasing expected volume/transaction size;
- changing founder account type;
- changing direct-charge/SCT architecture, `on_behalf_of`, payout controls, application-fee behavior, or MoR representation;
- changing either campaign-specific founder payment schedule (the Idea single Day 3 payment or the Product 40/60 schedule) or the early Product Campaign exception;
- adding or changing an Affiliate connected-account, Transfer, payout, or tax-reporting method;
- changing reservation duration, charge timing, cancellation, refund, or retry rules;
- adding subscriptions or recurring campaign charges beyond the disclosed reward model;
- enabling automatic approval, automatic milestone release, or materially reducing manual review;
- changing legal entity, ownership, bank account, public business address, domain, support contact, or statement descriptor;
- experiencing a material fraud, dispute, refund, delivery, sanctions, data-security, or negative-balance event;
- receiving a Stripe restriction, capability request, reserve, warning, inquiry, or account-status change.

For each controlled change:

1. Write the proposed change and business reason.
2. Identify affected application answers, public pages, policy files, data model, payment objects, risk controls, tests, and operator procedures.
3. Determine whether Stripe notice/approval is required from the recorded decision and current authenticated account requirements.
4. Obtain the necessary written decision before enabling the change.
5. Update this unified MVP and every separate canonical policy file.
6. Test the change in the appropriate environment.
7. Record deployment, reviewer, evidence, and post-launch monitoring.

### G.14 Standalone-source boundary

If the earlier Stripe briefing and Stripe playbook are deleted, this unified MVP remains the operational source of truth for:

- product scope and role flows;
- campaign, reservation, capture, fee, milestone, refund, dispute, and ledger behavior;
- preferred and backup Stripe architecture;
- test and live-readiness requirements;
- public Stripe-review pages and exact payment disclosures;
- Stripe application fields, canonical descriptions, wizard answers, Sales sequence, underwriting Q&A, document pack, controls inventory, decision record, and change-management process.

It intentionally depends on only these external authoritative records:

1. The separate complete legal-policy files published on the required routes.
2. Proovd's protected company, identity, ownership, tax, and banking records.
3. Stripe's authenticated account state, current requirements, official documentation, and written application/Sales/underwriting decisions.
4. The actual application exports, correspondence, architecture decision record, and test evidence produced by this runbook.

Those records are evidence and authoritative provider/legal artifacts, not missing product requirements. Any conflict discovered between them and this document must block the affected publication or live function until the conflict is resolved and this document is updated.

---

## Appendix H — CX touchpoint audit: low effort, high delight

This audit was completed after a sequential, full-document reread of v5.2. It covers the end-to-end founder, affiliate, backer, admin/support, and Stripe-reviewer journeys. Its purpose is not to add a new product layer; it identifies small details that make the existing manual MVP feel calm, trustworthy, personal, and finished.

### H.1 Audit lens

Every touchpoint was evaluated against six customer questions:

1. **Clarity:** Do I understand what this is and what just happened?
2. **Certainty:** Do I know what happens next and when?
3. **Control:** Can I take the relevant action without asking support?
4. **Continuity:** Does the next screen/email remember my context and prior action?
5. **Recognition:** Does this feel specific to me, my campaign, reward, or audience rather than generic automation?
6. **Recovery:** If something fails, do I know whether money/data changed and how to recover safely?

Audit labels:

| Label | Meaning |
| --- | --- |
| **P0** | Required before the first live campaign because it prevents confusion, support demand, lost trust, or payment anxiety. |
| **P1** | Add during the first founder/affiliate cohort after P0; still low effort but not a live-processing blocker. |
| **Copy/config (C)** | Mostly copy, variables, ordering, empty state, status label, or configuration; usually less than half a day once the state exists. |
| **Small build (S)** | Small UI/email/job using data and infrastructure already required by the MVP; target one to two engineering days, not a new subsystem. |
| **Manual ops (O)** | A reusable template/checklist or named human action using existing admin notes and records. |

An item leaves this appendix's low-effort scope if implementation requires a new payment rail, a new identity system, real-time infrastructure, a third-party integration, AI generation, a new legal position, or a material schema redesign. In that case, preserve the customer problem but move the solution to the deferred roadmap.

### H.2 Highest-leverage P0 touches

If time is tight, implement these first:

1. **Six-question state pattern:** what happened, next step, owner, timing, user action, help route.
2. **No-charge certainty:** every reservation and cancellation explicitly says whether US$0 or another amount moved.
3. **Pre-charge reminder:** amount, seller, trigger, local date/time, descriptor, and direct cancel/review link approximately 24 hours before charge.
4. **Local-time dates:** local time primary, UTC secondary for every charge/cancel/delivery deadline.
5. **Durable confirmations:** every consequential action appears on screen and in the relevant email and product-history surface.
6. **Visible autosave:** founders never wonder whether a long form was saved and never lose valid input after an error.
7. **Human waiting states:** named owner/team, last updated, next update due, and no-action-needed text.
8. **Plain-language recovery:** failed cards, invalid links, refunds, review failures, and suspensions never terminate in a generic error.
9. **Transparent money status:** estimated/finalized/approved-for-transfer/transferred/paid-out/failed/adjusted and the exact reason, owner, and next date for anything unpaid.
10. **Context-preserving support:** stable case reference and a timeline that prevents customers from repeating their story.
11. **Privacy-safe public identity:** comments do not reveal email local-parts; mandatory fulfillment/support sharing and optional marketing/research/survey consent each name only the fields and purposes actually used.
12. **Email deduplication and preview:** event retries do not create duplicate messages; high-impact variables are reviewed before send.

### H.3 Founder touchpoint audit

| ID | Moment | Observed friction or risk | Low-effort CX touch | Effort | Priority | Done when |
| --- | --- | --- | --- | --- | --- | --- |
| F01 | Private invitation | A bare link can feel like mass outreach or phishing. | Personalize with why this founder/product was selected, who invited them, expected setup time, and the next human contact. | O/C | P0 | Invite contains founder/product reference, named sender, `Why you`, setup estimate, and support reply path. |
| F02 | Account claim | The claim/policy steps after the possible-creator result can feel indefinite. | Show a short checklist with completed/current/remaining steps and `about X minutes` only where the estimate is honest; the prefilled fields shorten the honest estimate. | S/C | P0 | Founder always sees current step and can resume without restarting. |
| F03 | Stripe-hosted onboarding handoff | Returning from Stripe to an ambiguous page makes founders doubt completion. | Return to a status page that says complete, still required, or under review and links back to the exact missing requirement. | S | P0 | All Stripe return/refresh outcomes have a human-readable status and safe next action. |
| F04 | Long idea/campaign form | Silent autosave and lost answers destroy trust. | Visible save state, restored-draft notice, unsaved-exit warning, and preserved fields after validation/network errors. | S | P0 | Section 5.19.2 states pass in refresh, offline/error, and navigation tests. |
| F05 | Vetting questions | Sensitive or demanding questions can feel arbitrary. | Add one-line `Why we ask` helper text only on identity, evidence, delivery, refund, audience, and claims fields. | C | P1 | Every high-friction field explains the decision it supports without legal overcopy. |
| F06 | High-effort flag | The label can feel punitive or insulting. | Show the three calculated inputs (Visuals, Branding, confirmed interview booking) and how completing any one moves the campaign to standard before payment; keep the label neutral in founder UI. | C/O | P0 | Founder sees the calculated criteria, not an unexplained score or judgment. |
| F07 | Possible-creator count | A category count can be mistaken for guaranteed acceptance. | Pair the count with `potentially relevant`, last-updated context, and the no-guarantee/refund rule. | C | P0 | Usability check confirms founders do not interpret the count as a promised creator. |
| F08 | Listing-fee checkout | Discounts, two fee streams, and refund conditions can look opaque. | Show the US$35 base line item, each earned US$2 discount as its own labeled line, tax, total, descriptor, separate 5% explanation, and full refund trigger before payment. | C/S | P0 | Amount paid and all conditions match checkout, receipt, Founder campaign home, and policy. |
| F09 | Listing-fee success | A receipt alone creates a dead end. | Show receipt plus the formal affiliate-response window, what happens next, the next update due, and who owns the next action. | C | P0 | Confirmation and email answer all six H.1 questions. |
| F10 | Affiliate roster forming | Campaign-specific recruits may still be signing up or responding, which can feel like silence. | Show recruited, signed-up, reviewing, accepted, and declined states; show the 72-hour clock measured from successful payment, next update due, and `no action needed` when true. | S/O | P0 | No founder waits without a dated expectation; overdue state alerts admin. |
| F11 | Launch roster ready | A status change does not automatically create momentum. | Send a concise `Your launch team is ready` handoff with the accepted roster, why each fit was chosen, unresolved counter-offers, and next setup action. | O/C | P1 | Founder can understand the launch roster and next action without booking a call. |
| F12 | Review rejection | Generic rejection feels arbitrary and causes rework. | Split feedback into required/optional, deep-link to affected fields, preserve draft, and state whether enforcement is involved. | C/S | P0 | Founder can resubmit without re-entering unaffected content. |
| F13 | Campaign approval | Founders can miss locked fields or launch responsibilities. | Provide a one-page launch receipt: final URL, dates, selected Affiliates, locked commercial fields, disclosure, support, and first required update. | C/O | P0 | Approval email and immutable launch snapshot match the version that goes live. |
| F14 | Live campaign home | A raw metric grid without a last-visit answer creates compulsive refreshing. | Implement the §5.17 Glance/Act/Explore contract: one large active-pre-order count, truthful last-visit delta and freshness stamp, one ranked real action or caught-up ending, and complete secondary detail in Explore. | C/S | P0 | A Founder can see what changed, handle the only real action if one exists, and leave with a clear return horizon; refresh-based data is labeled accurately. |
| F15 | Day 8 discovery switch | A channel shift can look like attribution leakage. | Explain what changed, what did not, and how organic revenue differs from affiliate-attributed revenue. | C | P0 | Notification matches attribution ledger and has no vague `more exposure` promise. |
| F16 | Campaign close | A wall of numbers misses the emotional value of validation. | Add a plain-language result recap: strongest signal, weakest signal, top reason from survey, and what the outcome does/does not prove. | O/C | P1 | Admin reviews the recap; no automated claim overstates causality. |
| F17 | W-9 and release status | `Blocked` without a reason/date creates payout anxiety. | Show exact blocker, secure action, submitted/verified status, amount affected, next review date, and no need to resubmit when pending. | C/S | P0 | Founder can tell whether action is required and what amount/timing is affected. |
| F18 | Progress/early-fulfillment review | `Provide evidence` is too vague. | Give a campaign-specific checklist and examples of acceptable evidence, then issue a receipt of submitted items and decision due time. | O/C | P0 | Admin and founder see the same checklist, evidence list, and decision timestamp. |
| F19 | Founder payment decision | Money status may be split across emails/admin language. | Use released/eligible/blocked—not held—and show amount, decision reason, date, remaining obligations, and support route. | C | P0 | Founder campaign home, email, and ledger use identical amount/status language. |
| F20 | Three-month cooldown | A generic lock feels punitive. | Show exact earliest request date and the readiness criteria admin will review; allow founder to prepare updates without opening a campaign. | C | P1 | Founder sees time requirement and admin decision as two distinct gates. |

### H.4 Affiliate/distribution-partner touchpoint audit

| ID | Moment | Observed friction or risk | Low-effort CX touch | Effort | Priority | Done when |
| --- | --- | --- | --- | --- | --- | --- |
| A01 | Campaign-specific invitation | A bare invitation can feel transactional or risky. | Name the founder/campaign, explain why the person/channel was recruited, identify who verified the public profile, and state that signup is for this specific campaign. | O/C | P0 | Invite is recognizable and personal, opens the compact signup, and contains no sensitive payout request. |
| A02 | Compact signup | Prefilled public data can feel surveillant or inaccurate, while a long onboarding sequence delays the campaign. | Label the public source, let the Affiliate correct it, use `Confirm and create account`, then route the single `Finish payout setup` action to Stripe's required identity/tax/bank flow. | C/S | P0 | Affiliate completes Proovd and Stripe-controlled setup without a welcome tour or custom Proovd banking pages. |
| A03 | Waiting for founder | The affiliate may finish signup before the founder, and a blank home can look like rejection. | Keep the campaign association visible and say the founder is finishing setup, no action is required, and the campaign will appear automatically when founder signup completes. | C/S | P0 | The affiliate sees the named campaign and waiting state; `founder_signup_complete` replaces it with the preparing campaign without a new invite. |
| A04 | Campaign opportunity | Long pitch cards force heavy reading before fit is clear. | Put `Why this fits your audience` and the 60-second brief first, with full detail below. | O/C | P0 | Affiliate can state audience fit, work, compensation, date, and risk after the first screen. |
| A05 | Decision controls | A prominent Accept button can create pressure, while three separate buttons violate the compact-flow rule. | Use `Accept` as the primary action and one clearly labeled secondary decision control containing both `Decline` and `Propose terms`; state that declining does not hurt standing. | C | P0 | The surface has no more than two decision controls, and neither decline nor propose terms is hidden or penalized. |
| A06 | Compensation comprehension | Percentages are hard to translate into expected money. | Show a labeled sample captured charge with pre-tax basis, excluded tax, percentage, any fixed-payment condition, post-close timing, and no-guarantee note. | C/S | P0 | Example reconciles to §10.4 and never implies first-post payment. |
| A07 | Accept confirmation | Affiliates may forget what locked or what happens first. | Durable summary of locked terms, contingent terms, first action, dates, link, disclosure, and the rule that first-post verification releases no fixed-payment money. | C | P0 | Confirmation can be revisited from Compliance/Agreements. |
| A08 | Decline | Required explanation can make declining uncomfortable. | Use optional reason chips plus free text; confirm no penalty. If a reason must be required, explain why. | C | P1 | Decline completes in one step and creates useful structured feedback. |
| A09 | Counter-offer | Manual mediation makes status opaque. | Receipt with old/proposed values, submission time, owner, and next update due; revisions show before/after. | C/S | P0 | Affiliate never has to remember which version is pending. |
| A10 | Campaign kit | Hunting across documents and copying links/disclosures is repetitive and error-prone. | Keep the brief, brand/visual assets, talking points, guides, approved claims, deliverables, tracking link, disclosure copy, compensation terms, and support route in one campaign kit; provide one-click copy and a link-test action. | S/C | P0 | Affiliate can prepare from one place; copied text names the founder/product and test clicks do not contaminate production attribution. |
| A11 | First-post verification | Silence after submission creates payment anxiety. | Show submitted URL/time, verification owner, due time, passed/correction-needed status, and exact correction. | C/S | P0 | Affiliate gets a durable decision and correction does not require resubmitting unrelated data. |
| A12 | Live performance | Refresh-based metrics may be mistaken for live or final. | Show last updated, definitions, estimated/final labels, and a short explanation for zero/lagging data. | C | P0 | Affiliate can distinguish clicks, reservations, captured amount, and earnings. |
| A13 | Earnings finalization | A single `locked` balance feels arbitrary. | Separate estimated, finalized, approved for transfer, transferred, paid out, payout failed, and adjusted; show reason/owner/date per amount. | C/S | P0 | Sum reconciles to ledger and cause-based adjustments remain explainable. |
| A14 | Transfer capability pending | An actionable payment control that later fails destroys trust. | Preserve earnings, show the exact Stripe onboarding/approval blocker and owner, suppress false withdrawal controls, and notify when action or transfer becomes available. | C/S | P0 | Pending Affiliate sees the accrued amount and one real next action or `No action needed`. |
| A15 | Campaign close | Affiliates rarely get closure beyond commission. | Send contribution recap: content verified, attributed reservations/capture, final/estimated earnings, next date, and a genuine thank-you. | C/O | P1 | Recap avoids ranking/public comparison and matches final ledger state. |
| A16 | Warning/suspension | Enforcement copy can be vague or adversarial. | State exact behavior/evidence, rule, immediate effect, corrective action, appeal deadline, and human review route. | C/O | P0 | Customer-facing explanation is separate from internal/fraud reason code. |

### H.5 Backer touchpoint audit

| ID | Moment | Observed friction or risk | Low-effort CX touch | Effort | Priority | Done when |
| --- | --- | --- | --- | --- | --- | --- |
| B01 | Affiliate-link arrival | Attribution can feel like covert tracking. | Keep `You came through [handle]`, add a short `They may earn if your later charge succeeds`, and link to privacy/attribution detail. | C | P0 | Backer understands the material relationship before reserving. |
| B02 | First campaign scan | The page contains many disclosures but lacks a fast mental model. | Near the hero, show four facts: product/reward, seller, pay-when rule, and delivery timing. | C | P0 | A first-time user can correctly describe all four after a short scan. |
| B03 | Campaign-type badge | Even with the `Idea Campaign` / `Product Campaign` names, the charge rule is not obvious at a glance. | Pair the badge with one sentence: `Charged only if threshold is met` or `Charged at close for this pre-order`. | C | P0 | Badge meaning is clear without opening policy pages. |
| B04 | Dates/deadlines | UTC-only timing is precise but unfriendly and error-prone. | Display local time primary, UTC secondary; spell out timezone in email and consent. | S/C | P0 | Same instant renders consistently in campaign, checkout, email, magic link, and admin. |
| B05 | Reward selection | Users can lose context between tier and consent. | Keep selected reward, pre-tax subtotal, tax, total authorized, delivery, availability, and refund link visible through checkout. | S | P0 | Selected tier and total cannot silently change and survive recoverable errors. |
| B06 | Pre-checkout survey | Questions before card entry can feel like unnecessary friction. | Explain why Proovd asks, mark optional fields honestly, show a reasonable character limit, preserve answers, and distinguish aggregate demand research from separately optional identifiable sharing. | C/S | P0 | Survey survives errors and optional identifiable sharing matches consent. |
| B07 | Card-save step | `Authorize later` is abstract. | Show Today → Trigger → Delivery with reward, subtotal, tax, total authorized, condition, and dates immediately above Stripe fields. | C/S | P0 | Test user understands US$0 today and the exact future-charge ceiling. |
| B08 | Data sharing and age | Generic categories can overstate what is collected/shared. | Disclose mandatory email/purchase sharing for fulfillment/support, require an unchecked 18+ confirmation, and keep Founder marketing/research/survey and Proovd newsletter choices separate and unchecked. | C/S | P0 | Screenshot, stored consent, export, and policy show the same exact purposes and fields. |
| B09 | Pre-order success | Celebration can be mistaken for completed payment. | Lead with `Pre-order saved — you were not charged`; repeat amount, trigger, seller, descriptor, cancellation, and delivery. | C | P0 | On-screen and email confirmation reconcile exactly with the pre-order record. |
| B10 | Calendar planning | A future charge is easy to forget. | Add a simple calendar action for close/charge deadline with amount, campaign, and cancel/review link. | S | P1 | Generated event uses correct local/UTC instant and never contains sensitive token beyond the needed link. |
| B11 | Pre-charge reminder | Surprise charges create avoidable disputes. | Approximately 24 hours before trigger, remind active backers of amount, seller, condition, date, descriptor, and cancel/review action. | S | P0 | One reminder per active reservation; canceled/dropped reservations receive none. |
| B12 | Cancellation | Existing Pre-build flow allowed no email and could leave doubt. | Always show/send `Canceled — you were not charged`, timestamp, campaign/reward, and re-reserve link if still open; no retention obstacle. | C | P0 | Cancellation is visible in ledger, magic page, and email before close batch. |
| B13 | Threshold miss | `No charge` can still feel like a failed experience. | Thank the backer, clearly confirm US$0 charged and that the card can no longer be charged for this campaign, explain the outcome, and optionally link to future Proovd campaigns without auto-opting marketing. | C | P1 | Closure email has no ambiguous refund language because no charge occurred. |
| B14 | Charge receipt | Stripe receipt alone may not connect the charge to remembered context. | Proovd confirmation repeats founder, campaign, reward, amount, descriptor, delivery, magic link, and support. | C | P0 | Backer can identify the charge without contacting support. |
| B15 | Failed charge | Bank/provider language can feel accusatory or unclear. | State whether any money moved, plain reason category, retry deadline, preserved reward/amount, and one update-card action. | C/S | P0 | Raw decline code is secondary; successful recovery removes stale failure language. |
| B16 | Magic-link page | A list of facts lacks a sense of progression. | Add a compact status rail: Reserved → Charge due/No charge → Captured/Failed → Delivery due → Delivered/Refunded. | S | P1 | Rail is derived from existing states and never predicts an unconfirmed outcome. |
| B17 | Invalid/revoked magic link | Generic token errors are dead ends. | Explain safely, avoid account enumeration, provide support, and add secure/rate-limited resend if cheap. | C/S | P0 | No raw token error or blank page; support receives campaign context where known. |
| B18 | Comments identity | Email local-part can expose a real name or employer. | Use `Backer ###` or chosen display name by default. | S/C | P0 | Public comments expose no email-derived identifier. |
| B19 | Founder update/delay | Replacing a date hides the history customers care about. | Show original and revised date, reason, what is unchanged, next update date, and support/refund route where applicable. | C | P0 | Material update preserves prior commitment in evidence/history. |
| B20 | Support submission | `Message received` does not set expectations. | Immediate acknowledgment with case ID, category, owner, one-business-day due time, and 48-hour founder follow-up rule where relevant. | C/S | P0 | Case appears in customer and admin timelines with the same reference. |
| B21 | Waiting for founder | Silence after routing makes Proovd look absent. | Send a brief status at the promised checkpoint even when there is no resolution: who was contacted, what happens next, and revised update time. | O/C | P0 | Every missed founder response triggers the defined customer follow-up. |
| B22 | Refund initiated | `Refunded` can imply money has already landed. | Say `Refund started`, amount, original method/last four where available, initiation date, estimated bank timing, and support reference; later mark completed when known. | C/S | P0 | Status distinguishes requested, submitted, succeeded, and failed. |
| B23 | Delivery | Access instructions can be separated from the original promise. | Delivery email repeats reward, access link/instructions, disclosed delivery commitment, founder support, Proovd escalation, and a one-click satisfaction response. | C | P0 | Backer can access the reward and get help from one message. |
| B24 | Satisfaction survey | Long surveys suppress feedback. | Start with one-click satisfied/not satisfied or 1–5, then optional reason; use a clear close and no newsletter coercion. | C/S | P1 | Response takes under 30 seconds; negative response creates an admin follow-up task. |
| B25 | Ended/suspended/killed page | One generic ended banner obscures money and next steps. | Tailor banner by outcome: why ended, whether charged, what happens next, and help path. | C | P0 | Threshold miss, natural close, pre-charge kill, and post-charge suspension render distinct copy. |

### H.6 Admin and support touchpoint audit

Admin/support is part of CX even though customers do not see the panel. The aim is to make a small manual team reliable and consistent, not robotic.

| ID | Moment | Observed friction or risk | Low-effort CX touch | Effort | Priority | Done when |
| --- | --- | --- | --- | --- | --- | --- |
| O01 | New review/work item | Manual tasks can sit without ownership. | Every queue item has owner, created time, due time/SLA, priority reason, and next customer update. | S/C | P0 | No open review/support item lacks owner or due time. |
| O02 | Customer context | Information is distributed across role dashboards and Stripe objects. | Build the chronological customer timeline from existing records; no new messaging subsystem. | S | P0 | Admin can reconstruct the user's journey without opening multiple unrelated pages. |
| O03 | Canned replies | Templates speed work but can expose placeholders or irrelevant text. | Editable templates, required-variable check, and preview as recipient before high-impact sends. | S/O | P0 | Send is blocked when required amount/date/name/action placeholder is unresolved. |
| O04 | Reason codes | Internal fraud/risk language can alarm or accuse customers. | Store internal reason separately from a factual customer-facing explanation and corrective action. | C/S | P0 | Customer copy contains no raw Radar/code/internal accusation. |
| O05 | SLA management | One-business-day promise is easy to miss manually. | Due/overdue badges and a daily list of responses and promised updates due. | S | P0 | SLA breach is visible before/when it occurs and gets an owner. |
| O06 | Handoff between admins | Customers can receive contradictory answers. | Case handoff note states verified facts, current owner, next promise, and statements that must not change. | O/C | P0 | New owner can reply without asking the customer to repeat context. |
| O07 | Manual money action | A correct action can still be communicated incorrectly. | Confirmation preview reconciles internal amount/state with Stripe object and customer email before send. | S/O | P0 | Refund/release/payout email amount and status match ledger/object. |
| O08 | Duplicate events | Idempotent money handling alone does not prevent duplicate anxiety-inducing emails. | Add notification idempotency keys and show suppression reason in timeline. | S | P0 | Duplicate webhook/job test creates one final-state message. |
| O09 | Founder/affiliate relationship care | Early cohorts benefit from recognition that software cannot fake. | Add manual moments: campaign-introduction note, launch-eve check, mid-campaign welcome where applicable, close thank-you, and post-campaign debrief prompt, each logged. | O | P1 | Each first-cohort participant receives the relevant human touch once, not spam. |
| O10 | Negative feedback | Survey/support signals can disappear in a general inbox. | Tag `needs follow-up`, assign owner/due time, and close the loop with the customer. | O/S | P1 | Every negative delivery survey or unresolved support score has a recorded outcome. |
| O11 | Content/date edits | A typo fix can accidentally alter a material promise. | Preview customer-visible before/after diff and label material versus non-material edits. | S/O | P0 | Material date/reward/refund changes follow required approval/notice; typo fixes remain auditable. |
| O12 | Launch readiness | Happy-path QA misses the emotional failure states. | Run role-based scripts for waiting, decline, no eligible recruits or acceptances, no-charge, failed card, refund, invalid link, delay, suspension, and support escalation. | O | P0 | Evidence for H.9 scenarios is attached to the first-campaign readiness review. |

### H.7 Stripe reviewer and external-review touchpoint audit

Stripe is not the customer, but reviewer experience affects approval speed and confidence. These touches use only public/non-sensitive material.

| ID | Moment | Observed friction or risk | Low-effort CX touch | Effort | Priority | Done when |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | Submission opening | Reviewer must assemble the model from many pages. | Include a one-page cover index linking the homepage, payment explanation, safety, policies, samples, architecture summary, and named contact. | C/O | P0 | Every link opens without login and no page contains placeholder text. |
| R02 | Sample exploration | Reviewer can lose track of demo versus live behavior. | Persistent sample banner plus obvious links between the Idea Campaign and Product Campaign examples and `How payments work`. | C | P0 | Samples collect no payment data and reviewer can compare both in two clicks. |
| R03 | Architecture review | Preferred and backup paths can appear contradictory. | A side-by-side, one-screen comparison labels `requested`, `backup if Stripe requires`, MoR, charge context, fee, payout control, refund/dispute debit behavior, and unresolved items. | C/O | P0 | Comparison matches G.1, G.4, G.5, and the decision record. |
| R04 | Follow-up request | Inconsistent versions create re-review. | Put version/date on every submitted narrative and keep one correspondence/decision index. | O/C | P0 | The response references the exact current document and supersedes old answers explicitly. |
| R05 | Secure documents | Ordinary email invites oversharing. | Send a non-sensitive document index first and state which records will be supplied only through Stripe-authenticated upload. | O/C | P0 | No private identity, tax, bank, passport, or residential data is emailed. |
| R06 | Decision closure | Verbal agreement can be interpreted differently. | Same-day written recap listing each decision, open item, owner, and requested correction. | O | P0 | G.12.1 fields point to written evidence; blanks remain blockers. |

### H.8 Reusable microcopy patterns

These are structural patterns, not a substitute for Appendix A's exact legal/payment consent. Variables must be populated from the same source records used by the ledger and emails.

#### H.8.1 Waiting/review state

```text
[STATE IN PLAIN LANGUAGE]

What happened: [ONE SENTENCE]
Next: [ONE SENTENCE]
Owner: [PROOVD TEAM / FOUNDER / AFFILIATE / STRIPE / YOU]
Next update by: [LOCAL DATE/TIME] ([UTC])
Your action: [ONE ACTION or "No action needed"]
Reference: [CAMPAIGN / AFFILIATE ASSOCIATION / CASE ID]
Need help? [CONTEXT-PRESERVING SUPPORT ACTION]
```

#### H.8.2 Pre-order success

```text
Pre-order saved — you were not charged.

US$0 charged today
Reserved: [REWARD]
Reward subtotal: US$[REWARD SUBTOTAL]
Sales tax: US$[SALES TAX]
Total authorized: US$[TOTAL AUTHORIZED]
Seller: [FOUNDER LEGAL NAME]
Charge rule: [THRESHOLD CONDITION or CLOSE-DATE CONDITION]
Charge time: [LOCAL DATE/TIME] ([UTC])
Expected statement: [DESCRIPTOR]
Delivery: [MONTH/YEAR or WINDOW]

[Review or cancel pre-order]
```

#### H.8.3 Pre-charge reminder

```text
Your Proovd pre-order is scheduled for its charge decision tomorrow.

Campaign: [CAMPAIGN]
Seller: [FOUNDER]
Reward subtotal: US$[REWARD SUBTOTAL]
Sales tax: US$[SALES TAX]
Total authorized: US$[TOTAL AUTHORIZED]
When: [LOCAL DATE/TIME] ([UTC])
Condition: [IDEA-CAMPAIGN THRESHOLD RULE or PRODUCT-CAMPAIGN CLOSE RULE]
Expected statement: [DESCRIPTOR]

You can review or cancel before the deadline using your secure backer link.
[Review or cancel]
```

For an Idea Campaign, replace `scheduled for its charge decision` with equally precise language if the threshold is not yet final; never say the backer will be charged until the condition is satisfied.

#### H.8.4 Cancellation confirmation

```text
Canceled — you were not charged.

Campaign: [CAMPAIGN]
Reward: [REWARD]
Canceled: [LOCAL DATE/TIME] ([UTC])
Amount charged: US$0

[Return to campaign]
```

#### H.8.5 Failed-payment recovery

```text
We could not complete this pre-order charge.

Nothing new will be counted as collected until the payment succeeds.
Campaign: [CAMPAIGN]
Reward: [REWARD]
Reward subtotal: US$[SUBTOTAL]
Sales tax: US$[SALES TAX]
Total attempted: US$[TOTAL]
Update by: [LOCAL DATE/TIME] ([UTC])

[Update card]

If you do nothing, this pre-order will be canceled after the retry window.
```

The first sentence about whether money moved must reflect the actual Stripe state; do not use it blindly for partial or uncertain outcomes.

#### H.8.6 Refund status

```text
Refund started — US$[AMOUNT]

Sent to: [PAYMENT METHOD / LAST FOUR, if safely available]
Started: [DATE]
Typical bank timing: [VERIFIED RANGE]
Status: [SUBMITTED / SUCCEEDED / FAILED]
Reference: [CASE/REFUND REFERENCE]

[View pre-order or get help]
```

#### H.8.7 Affiliate earnings hold

```text
US$[AMOUNT] recorded

Status: [ESTIMATED / FINALIZED / APPROVED FOR TRANSFER / TRANSFERRED / PAID OUT / PAYOUT FAILED / ADJUSTED]
Why it is not paid yet: [CAMPAIGN OPEN / 48-HOUR RETRY / DELIVERABLES PENDING / STRIPE REQUIREMENTS / ADMIN REVIEW / PAYOUT FAILURE / ADJUSTMENT REASON]
Expected next update: [DATE]
Your action: [ACTION or "No action needed"]
```

#### H.8.8 Support acknowledgment

```text
We received your message — case [CASE ID].

Topic: [CATEGORY]
Owner: [PROOVD SUPPORT / FOUNDER, coordinated by Proovd]
Human response due: [LOCAL DATE/TIME]
If the founder needs to respond, we will follow up after 48 hours if you have not heard back.

Reply to this message to keep everything in one case.
```

### H.9 P0 CX acceptance scenarios

These scenarios are required in addition to Section 18.7 payment tests. They should be exercised on mobile width and desktop, with keyboard navigation and at least one screen-reader pass for the principal action/state.

1. **Founder draft recovery**
   - Enter data across multiple form sections.
   - Simulate failed save/network response and refresh.
   - Valid saved data returns; current state identifies last save; unsaved failure is visible; no silent loss occurs.

2. **Listing-fee transparency**
   - Founder sees the US$35 base, each earned US$2 discount as its own labeled line, tax, total, descriptor, refund promise, and separate 5% explanation.
   - Successful payment creates one receipt/confirmation with next steps and no duplicate email.

3. **Campaign-specific affiliate response wait**
   - Founder pays after campaign-specific affiliates may already have been recruited, signed up, and associated with the preparing campaign.
   - Screen shows recruited, signed-up, reviewing, accepted, and declined states; last updated; next update due; the 72-hour formal outcome measured from successful payment; and a no-action-needed message.
   - Overdue next update appears in admin work queue.

4. **Compact affiliate signup and handoff**
   - A campaign-specific affiliate opens the private invite, reviews or corrects sourced public fields, and creates the account on one compact surface.
   - Before founder signup finishes, the named campaign remains visible in a waiting state with no fabricated action.
   - At `founder_signup_complete`, the preparing campaign appears automatically; after successful listing payment, the formal decision becomes available without another invitation.

5. **Affiliate decision comprehension**
   - Affiliate can identify fit, work, compensation example, key date, and risk from the first request screen.
   - The screen uses no more than two decision controls: `Accept` and one clearly labeled secondary control that exposes both `Decline` and `Propose terms` without concealment or penalty.
   - Each action produces one durable confirmation and correct pending/locked values.

6. **Campaign kit completeness**
   - The affiliate can reach the campaign brief, required work, brand/visual materials, talking points, approved claims, tracking/disclosure tools, compensation rules, proof rules, and support from one campaign kit.
   - The affiliate is not forced through a multi-page splash sequence, course, or document hunt.

7. **Mid-campaign affiliate addition**
   - An affiliate recruited after launch signs up through the same compact campaign-specific flow and sees remaining time, adjusted deliverables, current terms, and the live campaign kit.
   - Their tracking activates only after readiness; no earlier visit or pre-order is retroactively attributed, and existing affiliate terms do not change.

8. **Pre-order no-charge certainty**
   - Before Stripe fields, timeline shows US$0 today, actual future amount/condition/date, and delivery.
   - Success screen and email say no charge occurred and match the stored reservation/consent.

9. **Pre-charge reminder**
   - Active eligible reservation receives one reminder approximately 24 hours before trigger.
   - Canceled, killed, detached, already captured, or dropped reservation receives none.
   - Late-created reservation does not receive duplicate immediate and scheduled reminders.

10. **Cancellation proof**
   - Backer cancels once through magic link.
   - CTA cannot be accidentally double-submitted.
   - Ledger updates before close batch selection.
   - Screen and email show US$0 charged, timestamp, and campaign/reward.

11. **Failed-payment recovery**
   - Decline, insufficient funds, and requires-action outcomes show plain copy and correct money-moved state.
   - Reward/survey data persists.
   - One primary card-update action works; success removes stale failure state.

12. **Invalid magic link**
   - Expired/revoked/malformed tokens expose no reservation or email data.
   - Page provides a safe recovery path and no raw error.
   - Rate-limited resend, if implemented, does not reveal whether arbitrary emails exist.

13. **Refund lifecycle**
    - Requested/submitted/succeeded/failed are distinct.
    - Amount, payment destination reference, initiation date, timing, and support ID match Stripe/internal records.
    - Founder, Proovd, and Affiliate ledgers apply the cause-based rule exactly once without duplicate notifications.

14. **Support continuity**
    - Support submission creates one case with owner and SLA due time.
    - Reply preserves campaign/reservation/charge context.
    - Missed founder response triggers the 48-hour follow-up without asking the backer to repeat details.

15. **Outcome-specific ended pages**
    - Render threshold miss, natural close, pre-charge kill, and post-charge suspension.
    - Each says why it ended, whether this viewer was charged, next step, and support route.

16. **Notification idempotency**
    - Deliver the same reservation, capture, refund, and dispute event twice.
    - Customer receives one final-state message per event/state transition; admin timeline records the suppression.

17. **Consent/data-sharing exactness**
    - Checkout discloses mandatory email/purchase-detail sharing only for fulfillment/support.
    - Required 18+ confirmation and optional Founder marketing/research/survey and Proovd newsletter boxes are unchecked and separate.
    - Founder export always limits operational data to fulfillment/support; identifiable survey/marketing fields appear only with the specific optional consent; Affiliate view contains no PII.

18. **Accessibility and responsive pass**
    - Complete founder form, affiliate decision, backer reservation/cancel, card recovery, and support on a 320px-wide viewport.
    - No clipped amount/date/action; labels and errors are programmatically associated; focus remains logical and visible.

### H.10 First-cohort CX measurement

The MVP should measure whether the touches reduce uncertainty and support demand using existing event and support records. Do not build a new analytics warehouse for this audit.

**Four-number Founder-loop scoreboard.** These four numbers are the controlling product scoreboard; the broader table below diagnoses why they move. No trustworthy production baseline exists for the prior widget-dashboard concept, so the document must not invent one. Label its baseline `not measured`, use the first 10 invited Founders to establish the controlled-pilot baseline, and retain that baseline beside every later cohort result.

| Scoreboard number | Exact MVP definition | Prior-dashboard baseline | Success direction |
| --- | --- | --- | --- |
| Time to first magic | Median elapsed time from a Founder opening the private invitation to the possible-creator result rendering after Problem, Solution, and Competition are complete | Not measured | Down, without lowering completion or answer quality |
| Founder completion | Percentage of opened Founder invitations that reach successful listing-fee payment with Stripe onboarding complete | Not measured | Up |
| Return after closure | Percentage of Founders who open `Results ready` within seven calendar days and complete at least one real post-campaign action: review results, send an eligible work-again request, or open the documented next-campaign-readiness path | Not measured | Up |
| Next-action correction rate | Percentage of Founder sessions in which the ranked Act item is later dismissed, reclassified, or overridden because the underlying state or priority was wrong—not because the Founder completed it | Not measured | Down; every correction retains reason, prior rank, actor, and time |

The scoreboard uses existing invitation, form, payment, session, result, action, and audit timestamps. It does not justify a general analytics dashboard.

| Measure | Why it matters | Low-effort source | Initial review cadence |
| --- | --- | --- | --- |
| Founder onboarding completion and median time | Reveals unclear identity/Stripe handoff | Existing account/onboarding timestamps | Weekly during cohort |
| Form restore/save failures | Finds trust-breaking data loss | Autosave status/error log | Daily while campaigns are drafted |
| Listing-fee support contacts before/after payment | Tests fee/refund clarity | Support category + Checkout state | Per founder |
| Time from listing fee to first formal affiliate response or roster update | Tests campaign-specific response-window reliability | Campaign-association/admin timeline | Per campaign |
| Affiliate opportunity accept/decline/counter rate and response time | Tests pitch fit and decision clarity | Existing campaign-association records | Per campaign |
| Affiliate questions about compensation/payout status | Tests earnings language | Support tags | Weekly |
| Reservation completion rate by failure step | Finds survey/consent/card friction | Existing reservation funnel events | Per campaign day |
| Pre-charge reminder delivery/open/cancel action | Tests surprise-charge prevention | Transactional email + cancellation event | Per close batch |
| Cancellation completed without support | Tests backer control | Reservation/support records | Per campaign |
| Failed-payment recovery rate | Tests recovery copy/action | Retry ledger | Per close batch |
| Unknown-charge contacts/disputes | Tests receipt/descriptor recognition | Support + dispute records | Per charge batch |
| Support first-response SLA and promised-update misses | Tests human reliability | Case owner/due timestamps | Daily |
| Delivery satisfaction and negative follow-up closure | Tests post-payment experience | Survey + case record | Per delivery cohort |
| Duplicate customer notifications suppressed/sent | Tests operational calm | Notification idempotency log | Per launch/close/refund batch |

Do not optimize early metrics by hiding cancellation, discouraging support, pre-checking marketing consent, or redefining failed payments. The goal is fewer surprises and faster recovery, not artificially lower visible problem counts.

### H.11 Deliberately excluded “delight” patterns

The following are not recommended for MVP even if they appear engaging:

- Confetti, streaks, countdown pressure, or celebratory language that can make a saved card look like a completed purchase.
- Fake scarcity, unverified `popular` badges, fabricated live-viewer counts, or urgency unrelated to an actual deadline/quantity.
- AI-generated founder/affiliate support responses presented as human review.
- Public founder ratings, affiliate leaderboards, or shame-based quality rankings.
- Pre-checked age, Founder marketing/research/survey, or newsletter consent; mandatory fulfillment/support sharing must instead be clearly disclosed as part of the purchase.
- A live-chat promise without staffing that can meet it.
- Real-time dashboards when refresh-based data is the actual MVP behavior.
- Automatic milestone/release decisions presented as safety review.
- Generic `Something went wrong` screens with no money/data state or recovery path.
- Multiple competing CTAs in payment, cancellation, refund, or failed-card recovery states.
- Decorative polish that delays the P0 certainty, control, continuity, and recovery requirements.

### H.12 Implementation order

1. Fix exact-copy contradictions, tax totals, age confirmation, and mandatory-versus-optional data-sharing purposes.
2. Create the system-wide state/confirmation/email patterns from Sections 1.2 and H.8.
3. Implement P0 backer payment/cancellation/recovery touches before real SetupIntents are enabled.
4. Implement founder autosave, listing-fee, affiliate-response wait, review, and release-status touches.
5. Implement campaign-specific Affiliate invitation, compact account/Stripe setup, waiting handoff, campaign kit, decision, mid-campaign joining, first-post, earnings, Transfer, and payout-failure touches.
6. Add admin ownership/SLA/customer timeline and notification deduplication.
7. Run H.9 scenarios alongside Section 18.7 tests.
8. Add P1 touches during the first cohort, using H.10 evidence rather than aesthetic preference.

The audit is complete only when the P0 items are represented in product states, emails, admin procedures, and acceptance evidence—not merely approved as copy concepts.

### H.13 Content-design and attention-to-detail QA

Before Stripe submission and before the first live campaign, perform one complete customer-facing copy pass—not a keyword-only check—across the rendered website, emails, dashboards, magic-link pages, support templates, and sample campaigns.

The pass must verify:

- US English is consistent for the US launch, including `authorize`, `canceled`, date formatting, and punctuation, unless a deliberate brand style says otherwise.
- `Founder`, `affiliate/distribution partner`, `backer`, `admin`, `seller`, and `merchant of record` are used consistently for the intended audience. `Creator` is the founder-facing name for the campaign-specific partner (§2.5); in affiliate-facing copy it may describe a subtype but must not make non-creator affiliates feel out of place.
- No undefined acronym—including the legacy `MBP` label—appears in customer-facing copy.
- Every CTA names the actual action: `Save card and pre-order`, `Authorize future charge`, `Cancel pre-order`, `Update card`, `Submit for review`, or similarly precise wording.
- Backer copy never refers to an account/dashboard when the action actually occurs through a magic-link backer page.
- No stray or nonexistent policy name such as `Current Discounts` appears in consent or footer copy.
- Mandatory fulfillment/support sharing and optional Founder marketing/research/survey sharing name only the fields and purposes actually implemented.
- The same reward subtotal, sales tax, total authorized, reward, seller, trigger, delivery date, refund rule/policy version, descriptor, and support SLA appear across campaign, checkout, confirmation, email, and magic-link states.
- Templates contain no unresolved brackets, placeholder variables, duplicated spaces, broken links, malformed line wrapping, or old founder/campaign names.
- Buttons and links have one clear label; links do not use `click here` when the destination/action can be named.
- Empty states, loading states, slow manual-review states, success states, and failure states all have intentional copy.
- Images and embedded video include useful accessible labels/captions where the medium supports them.
- Legal precision stays intact: CX simplification may add a summary but must not hide, contradict, or replace required consent and policy text.

Two-person review is recommended for exact payment/consent emails and pages: one person verifies customer clarity and one verifies variables against the campaign/payment record. This can be a manual first-cohort operation.
