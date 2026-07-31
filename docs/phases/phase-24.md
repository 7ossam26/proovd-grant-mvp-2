# Phase 24 — The live-mode gate

**Model:** Opus 4.8 — Little code, maximum consequence. The failure mode is declaring a condition satisfied that isn't, and every condition here is one a motivated person can talk themselves past.

**Goal:** eleven conditions verified, all 131 acceptance tests green, Track A closed, and one named pilot campaign cut over to live with monitoring and rollback owners.

**This is the phase that decides whether a real person's card can be charged.** Nothing here is a formality.

---

## Read first

- Spec §34 — the live-mode readiness gate, in full
- Spec **Appendix C** — the final implementation definition
- Spec §2.1 — legal and payment identity
- Spec §24.1 — the approved-configuration boundary
- Spec §31.7 — Founder seller tax readiness
- `docs/master-plan.md` §2 — Track A

---

## Prerequisites

Phases 01–23 green. **All of Track A closed.** If any Track A item is open, this phase cannot complete — that's the design.

---

## Scope

### 1. The eleven conditions (§34)

The first campaign cannot collect live card details until **every one** of these holds:

1. **Production payment architecture, account roles, and capabilities are recorded and match the implementation.** Not "should match" — verified against what Stripe actually approved, side by side with the code.
2. **Affiliate recipient Transfer/payout and the fixed-payment path are approved and enabled — or those features remain disabled.** A half-state is not permitted: either the capability exists or the feature is off.
3. **Tax registrations, product codes, seller responsibility, calculation validity and reuse, filing, refund treatment, and the exact consent are reviewed and configured.** Per §31.7 this includes each Founder's head-office location, product tax code, registration, and active provider tax settings.
4. **All canonical policy files are complete and consistent.** No `draft` status remains — Phase 05's gate is released here, not bypassed.
5. **Test/live key separation and webhook signatures pass.**
6. **Required test-card and idempotency cases pass** (§32.5, §33.7.7).
7. **Sample campaigns prove no-charge-today consent and collect no cards.**
8. **Admin MFA, reauthentication, audit, and token security pass.**
9. **P0 CX, accessibility, support, and notification-deduplication tests pass.**
10. **A human Admin reconciles provider test results to internal ledgers.** A person, comparing Stripe's records to the ledger, line by line, and signing off. Not a script.
11. **One pilot campaign has named monitoring and rollback owners.** Named people, reachable, who know they hold it.

### 2. What stays blocked, and what doesn't

While the gate is closed, these **may** proceed: public demos, interest collection, Founder and Affiliate onboarding, campaign drafting, manual review, recruitment, and test-mode engineering.

These **may not**: real card data, live SetupIntent or PaymentIntent, live application fee, live fixed funding, Affiliate Transfer, or any payout promise.

**Enforce this in code, not in policy.** A feature flag with a fail-closed default, checked at every money-touching entry point.

### 3. Truthful copy at cutover

Two things change wording the moment Stripe approval is real, and **only** then:

- **Appendix A.1's trust strip** — Phase 05 shipped conditional architecture wording because approval didn't exist. Now replace it with the truthful final sentence. §2.1: no UI may claim approval before it exists, and equally, don't leave hedged copy in place once the hedge is false.
- **Appendix A.2's MoR block** — verify the Stripe Connect description matches the configuration actually approved.

Re-run §33.11.5's cross-surface consistency test after any copy change.

### 4. Appendix C — the completion definition

Spec Appendix C defines completion as the app running **the entire lifecycle without undocumented operator knowledge**. Verify each of its four statements by walking the flow, not by reading the code:

- **Admin** can configure, invite a Founder, recruit Creators, support account claims, activate the response window through one listing payment, manage proposals and roster readiness, review and version, require reacceptance, record funding and readiness, coordinate the launch order, monitor attribution and risk, execute a safe idempotent close and retry, reconcile every party, and manage fulfillment, disputes, enforcement, completion, and future work.
- **The Founder** can move from invitation to future readiness **without a widget dashboard or a hidden rule.**
- **The Creator** can move from private invitation to optional future collaboration **without receiving Backer PII or being forced into direct Founder contact.**
- **The Backer** can understand seller, reward, charge rule, tax-inclusive authorized total, delivery, cancellation, data sharing, refund, and support before saving a card; receive proof no charge occurred; cancel or recover safely; recognise any later charge; receive the reward or documented help; and retain campaign-scoped access through final resolution.

### 5. Cutover

Enable live mode for **one named pilot campaign only** (§6: the first live enablement is limited to one named pilot with monitoring and rollback owners).

Before the first live reservation: confirm the descriptor renders correctly on a real statement, confirm webhook delivery in live mode, and confirm the monitoring owner can see the risk inventory.

### 6. The rollback plan

Written before cutover, not after a problem:

- What triggers a rollback.
- Who decides, and how they're reached.
- How live mode is disabled — the same fail-closed flag, flipped.
- What happens to reservations already saved when it's flipped.
- What each affected party is told, and by whom.

Reservations saved under live mode carry a real commitment. **A rollback plan that leaves them undefined is not a rollback plan.**

---

## Out of scope

Everything. If something needs building, the gate stays closed.

---

## Traps

- **Do not mark a condition satisfied by inference.** "Tax is probably fine, we configured Stripe Tax" is not §34.3.
- **Condition 10 is a human task.** A passing test suite is not reconciliation. A person compares provider records to internal ledgers and signs.
- **A half-enabled Transfer capability fails condition 2.** Disable the feature or enable the capability.
- **Draft policies fail condition 4.** Phase 05's `draft` gate exists to be released here, deliberately, not routed around.
- **Don't leave conditional approval copy in place after approval.** Both directions of §2.1 matter.
- **Named owners means named people**, not a team alias and not "whoever's on call."
- **The gate is code.** A checklist someone can proceed past is not a gate.

---

## Done when

- [ ] All eleven §34 conditions are verified with recorded evidence and a named verifier
- [ ] All 131 §33 acceptance tests pass in one run
- [ ] Every Track A item — A1 through A6 — is closed
- [ ] No policy route remains in `draft`
- [ ] The live-mode flag is fail-closed and enforced at every money-touching entry point
- [ ] Appendix A.1 and A.2 copy is truthful for the configuration actually approved
- [ ] Cross-surface consistency re-passes after the copy change
- [ ] Appendix C's four statements are verified by walking the flows
- [ ] Human reconciliation of provider test results to internal ledgers is complete and signed
- [ ] One named pilot campaign is enabled, with named monitoring and rollback owners
- [ ] The written rollback plan covers triggers, decision-maker, mechanism, in-flight reservations, and party communication
- [ ] Descriptor, webhook delivery, and risk inventory verified in live mode before the first live reservation

**Acceptance:** all 131 tests across §33.1 through §33.12, plus every §34 condition.

---

## After this

The MVP is live for one pilot campaign. §2.2's limits still hold: one controlled pilot first, US-only, 18+, USD, digital-only rewards, $50,000 aggregate pre-tax cap, one active campaign per Founder, three active-partnership slots per Creator.

Scale beyond the pilot is a decision made with data, not a phase in this plan.
