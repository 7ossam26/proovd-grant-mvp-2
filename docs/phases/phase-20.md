# Phase 20 — Refunds, disputes, and enforcement

**Model:** Fable 5 — Cause-based allocation decides who bears a refund across four parties with different rights. Getting it wrong claws back money a Creator validly earned, or leaves Proovd holding a liability that belongs elsewhere.

**Goal:** every refund, reversal, and dispute is classified by cause and allocated correctly between Founder, Creator, Proovd, and Backer; evidence packets assemble within 24 hours; and enforcement actions are recorded with the evidence that justified them.

The phase that decides who pays when something goes wrong.

---

## Read first

- Spec §24.8 — refund, reversal, dispute, and cause allocation
- Spec §24.9 — Idea refund exceptions
- Spec §24.10 — Product refund policy
- Spec §24.11 — dispute evidence
- Spec §24.12 — statement descriptors
- Spec §26.7 — support, dispute, and kill operations
- Spec §29 — enforcement and exceptional operations, all ten subsections
- Spec **Appendix B.6** — refund copy
- Spec §31.6 — Founder cancellation after Backer charges

---

## Prerequisites

Phase 19 green — earnings are finalized and Transfers exist, so a refund now has to reason about money that may already have moved. Phase 16 green — support and kill decisions are already recorded there.

---

## Scope

### 1. Before charge versus after charge

**Before charge:** cancellation, threshold miss, and pre-charge kill require **no refund object at all**. They prevent the PaymentIntent and remove future-charge eligibility. There is nothing to refund because nothing was collected (§33.7.4).

**After charge:** cause classification decides everything.

### 2. Cause allocation (§24.8)

| Cause | Allocation |
|---|---|
| **Founder or product caused** | Founder bears the refund. **Finalized and transferred valid Affiliate earnings remain.** Unfinalized earnings on the refunded transaction may cancel. Proovd keeps its 5% unless it elects otherwise, or Stripe or law requires return. |
| **Affiliate-caused fraud or breach** | Cancel unpaid invalid earnings. An already-transferred amount creates a **negative balance and contractual recovery record**. |
| **Proovd or system error** | Proovd corrects it and returns its fee where appropriate. **An unrelated Affiliate is not debited.** |
| **Backer dispute unrelated to the Affiliate** | Follows the Founder/MoR charge context. **Finalized Affiliate earnings remain** unless evidence shows Affiliate causation. |
| **Law, Stripe, or card issuer** | Follow the mandatory outcome and record the allocation. |

Every case stores cause classification, Proovd fee treatment, Affiliate treatment, Founder liability, recovery, evidence, Admin, and timestamps.

**Consent and evidence do not waive law, network, Stripe, or issuer rights.** No stored agreement overrides a chargeback right.

### 3. Idea refund exceptions (§24.9)

After a valid capture there is **no voluntary or change-of-mind refund**. These route to review: duplicate charge · wrong amount · charge after valid cancellation · unauthorized transaction · material campaign misrepresentation · applicable non-delivery · campaign killed for serious violation · refund required by law, Stripe, network, or issuer.

**Because the single Founder payment may have released on Day 3, recovery beyond available balance is best-effort** reversal, dispute, or contract recovery. **Never promise that all released funds are recoverable.**

### 4. Product refund policy (§24.10)

Preserve exact text or an immutable snapshot with source URL, title, version, and effective date. Show and link at campaign and checkout. **Store its version with each consent.** Later website edits **cannot alter existing transactions.**

The Founder as MoR issues and bears the refund. **Proovd can intervene when the Founder does not honour the recorded policy.**

### 5. Dispute evidence (§24.11)

On dispute, create an Admin task **due within 24 hours**. The packet includes: consent text, version, and timestamp; the campaign disclosure and version at reservation; Founder identity and MoR disclosure; reward, subtotal, tax, total, location evidence, and descriptor; the delivery date and promise; SetupIntent and PaymentIntent/charge; survey responses where relevant and permitted; the immutable refund-policy version; fulfillment evidence; and updates plus support and communication history.

Everything in that list already exists from earlier phases. **Assemble, do not re-derive.**

### 6. Refund lifecycle and copy

Every refund has a lifecycle — `requested` / `submitted` / `succeeded` / `failed` — and a cause classification.

Appendix B.6 governs the copy: amount, destination method with last four where safely available, start date, typical bank timing as a **verified range**, status, and a case reference. **Never promise an exact settlement date.**

### 7. Statement descriptors (§24.12)

The platform static descriptor is `PROOVD CAMPAIGNS` where applicable; the prefix is `PROOVD`; the listing fee is `PROOVD LISTING`. **The campaign descriptor is the actual validated value sent in the Founder account context** — never hard-code `PROOVD*[FOUNDERHANDLE]` if the provider sends something else.

Campaign, checkout, reminder, receipt, magic-link, support, and evidence views **all display the same computed value** (§33.9.13).

### 8. Suspension and kill (§26.7, §29.7)

Reason category plus free text. Pre-capture behaviour was built in Phase 16; **post-capture** invokes the refund, reversal, and recovery policy, restricts unreleased funds where possible, notifies roles, and preserves evidence.

**Successful SetupIntents remain historical, never rewritten as canceled.**

Ended pages must distinguish threshold miss, natural close, pre-charge kill, and post-charge suspension — **one generic message is prohibited** (§33.9.9).

### 9. Enforcement (§29)

- **29.1 Affiliate self-pre-order:** permitted only after disclosing intent and certifying a genuine self-funded purchase with identity-disclosed information. **Earns no commission, bonus, or thank-you.** Prohibited: funding or coordinating others to inflate metrics, multiple account/IP/device identities on one Idea campaign, reciprocal pre-order schemes, engagement or click boosting, artificial inflation of any kind.
- **29.2 Conflicts:** disclose material business, family, financial, investor, advisor, contractor, employee, Backer, Founder, other-Affiliate, or competitor relationships. Undisclosed conflict may suspend the partnership.
- **29.3 Competitor restriction:** one month after the active campaign ends, no promotion of a directly competing product with substantially the same core function. Adjacent products remain allowed.
- **29.4 Suspension and appeal:** Admin may warn, pause, terminate, demote, restrict bidding, remove, or refer. Customer-facing enforcement states the **exact evidence and behaviour, the rule, the immediate effect, the correction, the appeal deadline, and a human route.** The internal reason stays separate. Appeal window five business days where policy allows; Admin's appeal decision is final.
- **29.5 Ghosting:** launch Creator with zero posts in the first seven campaign days; mid-campaign Creator with zero posts in the agreed period. Recovery: attempt replacement, continue when others remain, extend for lost days if the only Creator was replaced, suspend or kill if the campaign cannot perform. **Invalid termination cannot claw back valid finalized commission absent Affiliate-caused invalidity.**
- **29.8 Policy updates:** material Terms or AUP updates require reacceptance; continued use is suspended until accepted. Store version and acceptance time.
- **29.9 Unknown charge support:** before a dispute, support identifies Founder and campaign, sends receipt and context, routes refund or product support, and stores the interaction as evidence.
- **29.10 Not-as-described:** Backer contacts the Founder first through magic-link support. **If no response within 14 days or no resolution, the Backer may escalate to Proovd.** Proovd mediates. **The Backer retains issuer dispute rights**, and Proovd packages evidence within 24 hours of dispute notice.

---

## Out of scope

Fulfillment, Day 14, and the ghost ban — Phase 21. The full in-product dispute centre is **deferred** by §30.

---

## Where this phase splits

Thirteen named tests is level with Phase 12, which split, and two of them (§33.9.10, §33.9.11) already pass from Phase 16b. The brief does not name a seam, so this session added one (master-plan §1.3 step 6), on the boundary between **the refund money machine** and **the operations and enforcement that invoke it**. The dependency runs one way: a post-capture kill *invokes* the refund/reversal/recovery policy, and a dispute's allocation reuses the same §24.8 cause register.

| Half | Scope | Acceptance | State |
|---|---|---|---|
| **20a** | The §24.8 cause register and allocation records (feeding 19b's `causeBasedAdjustmentsCents`), the reservation-refund lifecycle `requested/submitted/succeeded/failed` with Appendix B.6, the §24.9 Idea exception register with no voluntary-refund path, §24.10 hardening (the consent's policy snapshot preserves text + hash), the earnings treatments per cause (cancel-unfinalized at finalization, adjusted + contractual recovery post-transfer), `charge.refunded` on both endpoints, and the Admin refund-case surface | **§33.9.1–§33.9.5**, the allocation half of **§33.9.6** | built |
| **20b** | §24.11 dispute records, the 24-hour Admin task, and the evidence packet; `charge.dispute.*` + `transfer.reversed`; §24.12 descriptor consolidation across the seven surfaces; §26.7/§29.7 post-capture suspension/kill invoking 20a's machinery; the outcome-specific ended pages; §29.1–29.5 and §29.8–29.10 enforcement records including the Backer support path; the §33.9.12 suppression record | **§33.9.7–§33.9.9**, the dispute-ingestion half of **§33.9.6**, **§33.9.12**, **§33.9.13** | built |

20a builds no dispute object and no enforcement change; 20b classifies its dispute and kill cases through 20a's cause register rather than a second one.

---

## Traps

- **A Founder-caused refund does not claw back finalized valid Affiliate earnings.** §33.9.3. This is the most tempting wrong simplification in the phase.
- **An unrelated dispute does not automatically claw back the Affiliate.** §33.9.6.
- **Proovd's own error must not debit an unrelated Affiliate.** §33.9.5.
- **Never promise full recoverability** after a Day 3 release. Best-effort is the honest and required framing.
- **Consent never waives issuer rights.** Copy implying otherwise is both wrong and unenforceable.
- **The descriptor is computed, not assumed** — and identical across seven surfaces. §33.9.13.
- **Internal fraud and provider codes never become customer copy.** §33.9.11.
- **Ended pages are outcome-specific.** §33.9.9.
- **Enforcement copy names the actual behaviour and evidence.** A vague "policy violation" fails §29.4.

---

## Done when

- [ ] Product consent preserves the immutable Founder policy version — **§33.9.1**
- [ ] Every refund has a full lifecycle and cause classification — **§33.9.2**
- [ ] A Founder-caused refund does not claw back finalized valid Affiliate earnings — **§33.9.3**
- [ ] An Affiliate-caused refund cancels or recovers **only** invalid earnings — **§33.9.4**
- [ ] A Proovd error does not debit an unrelated Affiliate and returns the fee where appropriate — **§33.9.5**
- [ ] An unrelated dispute does not automatically claw back the Affiliate — **§33.9.6**
- [ ] The evidence packet includes all required consent, tax, policy, delivery, and support data — **§33.9.7**
- [ ] Pre-charge kill closes without charge; post-charge kill invokes recovery — **§33.9.8**
- [ ] Ended pages distinguish threshold miss, natural close, pre-charge kill, and post-charge suspension — **§33.9.9**
- [ ] Support cases carry stable reference, owner, due time, context, and the 48-hour follow-up — **§33.9.10**
- [ ] Internal fraud and provider codes never become raw customer copy — **§33.9.11**
- [ ] A duplicate event creates one customer message and a timeline suppression record — **§33.9.12**
- [ ] The computed campaign descriptor passes provider validation and matches across campaign, checkout, reminder, receipt, magic link, support, and evidence — **§33.9.13**
- [ ] Dispute tasks are created and due within 24 hours

**Acceptance:** all thirteen tests in §33.9.
