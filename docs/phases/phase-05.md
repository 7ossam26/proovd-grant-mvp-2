# Phase 05 — Public site, policies, and samples

**Model:** Opus 4.8 — Volume looks mechanical, but Appendix A copy is exact-text mandatory and the banned-vocabulary rules are live. A model that paraphrases the trust strip has created a compliance problem, not a style problem.

**Goal:** every public route in Spec §18 exists on `app.proovd.co`, the policy-versioning machinery works, both sample campaigns render completely and collect nothing, and no surface claims anything that isn't true yet.

This is §32.1's step 1 — the Spec's own recommended starting point for user-visible work, and the first phase where the design system from Phase 02 meets real content.

---

## Read first

- Spec §18 — public route inventory, homepage trust content, campaign page content order, sample campaigns, ended-state contract
- Spec §31.4 — the canonical policy-route contract and the footer requirements
- Spec §27.8 — the exact service SLA block
- Spec §2.1 — legal and payment identity, and the rule against claiming approval before it exists
- Spec Appendix A.1 — the homepage trust strip, **including the note beneath it**
- Spec Appendix A.6 — the sample banner
- DNA §5.12 — dense reference surfaces lead with the gist

---

## Prerequisites

Phase 02 green (design system + StatePanel). Phase 04 green — the policy version records this phase creates are referenced by consent records later, and the footer links to authenticated routes.

Track A2 (policy documents) may still be in legal review. See the scope note below.

---

## Scope

### 1. The route inventory (§18)

All fourteen, on `app.proovd.co`:

```
/                    /about              /how-payments-work
/safety              /terms              /privacy
/cookies             /refunds            /fulfillment
/aup                 /affiliate-aup      /ip-agreement
/campaign/sample-pre-build
/campaign/sample-pre-launch
```

Plus the route shape for approved live campaigns, which Phase 14 fills.

The marketing site at `proovd.co` keeps its own home. Decide and record the canonical redirect between the two — `docs/tech-stack-v2.md` §10 explains why campaign pages, checkout, policy routes, and the magic-link surface must share one origin.

### 2. Homepage

The §18 trust content: vetted-Founder crowdfunding software, both campaign models, manual Founder/campaign/Creator review, digital-only launch scope, cards saved now and charged only under the disclosed trigger, Founder as seller and merchant of record, Stripe Connect under the actual approved configuration, role-based calls to action for Founders and Affiliates, support and policy links.

Appendix A.1 gives the exact trust strip. **Read the sentence immediately after it.**

### 3. Policy routes and versioning

Each policy route renders complete canonical text from a versioned record: title, version, effective date, and the full body. Version identifiers are what consent records reference from Phase 15 onward, and what §29.8's reacceptance flow compares.

**On content timing.** §18 and §31.4 forbid placeholder, "coming soon", and summary-only text at launch. The real text arrives from Track A2. So this phase builds the machinery and the routes, and marks each policy record with an explicit `draft` status that:

- renders normally in development,
- **blocks the §34 live-mode gate while any policy is still `draft`**,
- and never renders text that presents itself as final when it isn't.

Do not invent policy text to fill the gap. Do not ship a summary and call it the policy.

Per DNA §5.12, every policy page opens with a plain-language overview at Glance, with the complete legal text one gesture below, honestly formatted. Nothing is cut — the full text is all there, staged.

### 4. Sample campaigns

`sample-pre-build` renders a realistic, safe Idea Campaign. `sample-pre-launch` renders a realistic, safe Product Campaign. Both show the complete campaign, reward packages, delivery disclosures, the merchant-of-record disclosure, and a correct consent preview.

Both permanently display the Appendix A.6 banner, and **neither accepts real card data** — no Stripe Elements mount, no SetupIntent, no payment method collection of any kind. §34 gates live mode on proving exactly this.

This is also the first exercise of §18's campaign page content order, which Phase 14 builds for real. Follow the fourteen-item order and the campaign-type difference table now, so Phase 14 inherits a correct structure.

### 5. Footer

Every public footer carries (§31.4, §27.8): legal entity, `support@proovd.co`, the one-business-day SLA, postal address, and links to Terms, Privacy, Cookies, Refunds, Fulfillment, AUP, the Stripe Connected Account Agreement, How payments work, and Safety.

The §27.8 block is exact text:

```
Contact Proovd
Email: support@proovd.co
We respond within one (1) business day, Monday–Friday, excluding U.S. federal holidays.
Postal: Proovd LLC, 254 Chapman Rd, Ste 208 #27541, Newark, DE 19702, USA.
```

### 6. Tawk.to

Renders only during staffed US business hours. Outside them it does not render at all — not greyed out, not "we're away". §31.4: never promise unstaffed chat. The email SLA is the real commitment.

---

## Out of scope

Any authenticated surface. Campaign creation. Real campaign rendering. Checkout. Discovery and browse — §18 excludes campaigns from discovery until Day 8, and that logic belongs to Phase 14.

---

## Traps

- **The trust strip cannot claim Stripe approval.** Appendix A.1 is explicit: before production approval, replace the architecture sentence with truthful conditional wording and do not imply approval. §2.1 says no UI may claim approval before it exists. Stripe underwriting (Track A1) is still open, so **the conditional wording is what ships today.** Revisit only when A1 closes.
- **Never describe money as escrowed, held in trust, held in custody, or held in a Proovd bank account** (§2.1). Not on the homepage, not on `/how-payments-work`, not on `/safety`.
- **Use the §3.2 replacement table.** Not "pledge" — reserve a pre-order. Not "all-or-nothing" — conditional charge contingent on the order threshold. Not "campaign goal" for an Idea Campaign — order threshold. Not "we pay founders" — charges are processed through Stripe Connect in the approved account context.
- **`reservation`, `pre-build`, `pre-launch`, and `tranche` must not render** to a Founder or Backer (§3.1). The sample URLs may keep `sample-pre-build` and `sample-pre-launch`; the rendered content uses the customer-facing names.
- **Reward prices are pre-tax** unless an approved configuration says otherwise. Page copy must not imply tax-inclusive pricing when checkout will add tax (§18).
- **Sample campaigns must not mount payment fields at all.** "Disabled" is not the same as absent.
- **No unresolved template variable, broken link, or old campaign name** anywhere — §33.11.6 tests for it.

---

## Done when

- [ ] All fourteen routes resolve on `app.proovd.co` and render complete surfaces
- [ ] Homepage carries every §18 trust item and the Appendix A.1 strip **with conditional architecture wording**
- [ ] Every policy route renders versioned content with title, version, and effective date; `draft` status is visible in Admin and blocks the §34 gate
- [ ] Every policy page opens with a plain-language overview, full text one gesture below
- [ ] Both sample campaigns render completely, show the permanent banner, and mount **no** payment field
- [ ] Footer carries the exact §27.8 block and all ten links
- [ ] Tawk.to renders only inside staffed hours
- [ ] US English and role names are consistent; no `MBP`, `reservation`, `tranche`, or undefined acronym reaches a public surface — **§33.11.3**
- [ ] Every CTA names the actual action; no `Submit`, no `OK` — **§33.11.4**
- [ ] No unresolved variable, broken link, old campaign name, or placeholder policy presented as final — **§33.11.6**
- [ ] Loading, empty, waiting, success, and failure states all use the StatePanel six-question pattern — **§33.11.7**
- [ ] Full keyboard and screen-reader pass at 320px and desktop

**Acceptance:** §33.11.3, §33.11.4, §33.11.6, §33.11.7. Partial credit toward §33.11.5 (cross-surface agreement) and the §34 sample-campaign requirement.
