# Phase 06 — Admin shell, global config, and the Founder invitation

**Model:** Opus 4.8 — The configuration surface is ~25 constants that every later phase reads, and getting one wrong propagates silently. The invitation email is customer-facing copy under §7's honesty constraints.

**Goal:** Admin can log in, configure every operating constant the system will ever read, create a Founder prospect, preview and send a personalized invitation, and watch a secure draft link land. Campaign reaches `invited_draft`.

This is the first phase where a real person receives something.

---

## Read first

- Spec §6 — Phase 0 global configuration, every constant, and the fail-closed rule
- Spec §7 — Phase 1 invitation and draft, in full
- Spec §26.1 — Admin Users surface, Founder row and detail
- Spec §26.2 — Campaign detail
- Spec §26 preamble — why the Admin panel is the only dashboard-style product
- Spec §27.2 — transactional email rules
- Spec §25.8 — retention
- DNA §5.2 — Glance / Act / Explore, which the Admin panel uses at density

---

## Prerequisites

Phases 03, 04, 05 green. The domain kernel supplies the constants' home and the audit writer; auth supplies Admin MFA and the token service.

---

## Scope

### 1. Admin shell

Spec §26 licenses dashboard density **here and nowhere else** — the Admin panel monitors many users, cases, deadlines, money states, and risks at once. DNA §5.14 still applies: complexity is staged, never amputated, and Explore is a first-class space rather than a dumping ground.

Build the shell, navigation, and two surfaces:

- **Users → Founders** (§26.1): name/email, invitation sender/source/sent/claim/draft-link status, signup, country/state, 18+ and identity status, connected-account status, W-9 status, campaign history, active-campaign limit, cooldown, ready-next flag, ban status, and the create/send/resend/revoke controls.
- **Campaign detail** (§26.2): exposes the campaign record, with the parallel-track and payment flags shown **separately**. User and provider data auto-populates; Admin adds only review, decision, evidence, and override data — never re-keying something the system already holds.

### 2. Global configuration (§6)

One settings surface holding every operating constant. These are read by later phases; none may be hardcoded anywhere else.

Listing-fee base $35 · $2 per optional item · max discount $10 · minimum $25 · platform fee 5% of captured pre-tax reward subtotal · Affiliate base 30%, or 20% where an accepted Product-Campaign fixed payment exists · percentage ceiling 50% per attributed captured charge · high-effort inputs · campaign cap $50,000 · Product default duration 14 days with approved min/max · failed-payment retry window 48 hours · pre-charge reminder ~24 hours · Affiliate formal-response window 72 hours from `listing_paid_at` · Founder free-cancellation 48 hours from `listing_paid_at` while not live · Creator replacement window three US business days from `creator_failure_recorded_at` · business-day calendar, timezone, and holiday version · Founder cooldown at least three months · payment schedules (Idea 100% Day 3; Product 40% Day 3 / 60% Day 14) · Product early-remaining-payment control, **disabled by default and evidence-gated** · interview providers, availability, interviewers, reminder lead times · default required promotional post count of three · support SLA · Admin MFA and reauthentication window.

Plus a **prerequisites panel** verifying that required public routes, policies, support details, sample campaigns, transactional email configuration, Stripe test/live separation, webhook endpoints, tax configuration gates, and pilot feature flags are present. **Incomplete prerequisites fail closed** — they block, they don't warn.

### 3. Email — Resend

First real transactional email. Wire Resend plus React Email, and route every send through the Phase 03 notification registry and `notification_deliveries`.

§27.2 rules: not opt-out-able; specific subject naming the campaign or product; at most one primary action; plain-text support route and a stable reference; high-impact messages previewable with final variables before manual send; duplicate webhook or job delivery cannot produce a duplicate email.

### 4. Founder prospect and invitation

Admin creates the prospect and the initial campaign container after off-platform discovery, recording product, launch frame, US/18+ fit, delivery feasibility, early compensation expectations, and affiliate-sourcing hypothesis.

The invitation surface holds the twelve items in §7 — recipient name, email, phone if known, Founder/product reference, product name and URL, what Proovd understood, why this Founder was invited, named sender and reply route, invitation source and internal campaign owner, honest setup-time expectation, process summary with no-guarantee language, draft status, and Admin notes with discovery evidence.

Create, **preview**, send, resend, revoke. Preview shows final variables and **no unresolved placeholder** — that's a hard gate on sending, not a nicety. Send stores recipient, sender, source, sent time, notification ID, draft ID, token version, expiration, and status.

### 5. The Founder-facing surfaces

**The email** is specific, recognizable, and transactional: the Founder/product reference, what Proovd understood, why they were selected, who sent it, what the process includes, an honest time expectation, no guarantee of Creator acceptance or campaign result, a reply/support path, and **one** secure draft action.

**The draft landing state** names the Founder and product and explains what will happen before an account or payment is required. It does not ask for anything yet — Phase 07 owns the vetting flow.

### 6. Retention job

pg-boss: unclaimed draft content is deleted or irreversibly anonymised **30 calendar days after the most recent send**, with minimum audit evidence retained. Resend restarts the clock. The token service's `expireStaleDrafts()` revokes the tokens; this job must anonymise the associated draft content **in the same transaction** — a revoked token beside live draft content is not compliance.

---

## Out of scope

Vetting (Phase 07). Affiliate anything (Phase 08). Stripe (Phase 10). Any Founder surface past the draft landing.

---

## Traps

- **Admin must not promise outcomes.** §7: no promise of acceptance, results, reward pricing, or participation by a specific Creator. This constrains the invitation copy, the prospect notes UI, and the email template.
- **Constants live in configuration, not in code.** If a later phase needs 72 hours, it reads the setting. A hardcoded duration is a bug even when the number is right.
- **Fail closed means blocking.** An incomplete prerequisite disables the dependent action. It does not render a yellow warning next to an enabled button.
- **Preview is a gate.** An unresolved `[VARIABLE]` in preview must make Send unavailable.
- **Never request sensitive data by email** — no bank, tax, password, or identity fields in any message body (§8 states this for Affiliates; apply it everywhere).
- **The Admin panel is a dashboard; nothing else is.** Don't let its density leak into Founder surfaces.
- **`Saving…` / `Saved [time]` / `Could not save — retrying`** is the autosave vocabulary from §9. Establish it here for Admin forms so Phase 07 inherits it.

---

## Done when

- [ ] Admin logs in with MFA; sensitive actions demand recent reauthentication
- [ ] Every §6 constant is configurable, persisted, versioned, and read from configuration by at least one consumer
- [ ] The prerequisites panel blocks — not warns — on any incomplete item
- [ ] Founder prospect and campaign container create; campaign is `invited_draft`
- [ ] Preview shows final variables; an unresolved placeholder makes Send unavailable
- [ ] Send stores all nine recorded fields; resend rotates the token and restarts the 30-day clock; revoke ends access immediately
- [ ] The invitation email carries all nine §7 items and exactly one primary action
- [ ] A personalized draft opens without an account and grants **no other access** — **§33.1.1**
- [ ] Token alteration, cross-Founder access, replay, expiration, revoke, resend, and simultaneous claim all fail safely — **§33.1.2**
- [ ] The 30-day deletion/anonymisation job runs from the **most recent send** and leaves minimum audit evidence — **§33.1.3**
- [ ] Every Admin action writes an audit row with actor, prior/new value, reason, and time
- [ ] A duplicate job or webhook cannot produce a second invitation email

**Acceptance:** §33.1.1, §33.1.2, §33.1.3. Partial credit toward §33.12.4 (Admin auto-population and override recording).
