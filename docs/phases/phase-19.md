# Phase 19 — Creator earnings and Founder payments

**Model:** Fable 5 — Money leaves the platform here. Provisional-versus-earned reconciliation must happen exactly once, the unearned remainder must return to the Founder and never become platform revenue, and every payment path is idempotent.

**Goal:** Creators are paid what they earned through one idempotent Transfer, the unearned provisional remainder returns to the Founder once, and Founders receive their share on the correct schedule with W-9 blocking everything until verified.

The last phase where money moves outward. Everything reconciles or it doesn't.

---

## Read first

- Spec §22.1 — Creator completion and earnings finalization
- Spec §22.2 — the discretionary good-effort thank-you payment
- Spec §22.3 — Founder W-9 and payment schedule
- Spec §24.4 — the provisional Affiliate amount
- Spec §24.5 — Stripe processing fees
- Spec **Appendix B.7** — Affiliate money status
- Spec §32.3 — the Transfer webhook note
- Spec §11 — the tax-accountability gate built in Phase 10

---

## Prerequisites

Phase 18 green — the retry window has closed and reconciliation has begun. Phase 10's tax-accountability record must be populated; it gates every Transfer.

---

## The seam

Fourteen named tests is more than one session — more than Phase 12's thirteen, which split, and Phases 14–18 all split at less. There is a real seam in this brief: scope 1–5 are **Creator money** — completion verification, earnings finalization, the one Transfer, the §24.4 provisional reconciliation, and the discretionary thank-you — while 6–7 are **Founder money**: the W-9 block and the payment schedules. The dependency runs one way through the eligible-Founder-share formula (scope 7 subtracts the *finalized* Creator compensation scope 4 produces), and the acceptance tests fall the same way, which is the usual sign a seam is real rather than convenient. Scope 8 (§33.8.13, one source many renderers) is testable only once both halves' amounts exist, so it closes 19b.

| Half | Scope | Acceptance | State |
|---|---|---|---|
| **19a** | §22.1 completion verification and the five fixed-payment outcomes, earnings finalization and the B.7 states, the one idempotent Transfer with its synchronous-failure retry, the §24.4 provisional/earned reconciliation with the unearned return, the §11 tax gate on every Transfer, and the §22.2 thank-you | **§33.8.1–§33.8.8, §33.8.14**, the tax-gate done-when | **built** |
| **19b** | §22.3 W-9 request/verification and the block, the Idea single payment, the Product 40%/60% schedule, evidence-gated early release that never skips Day 14, and the money surface consistency pass | **§33.8.9–§33.8.13** | next session |

19a writes no Founder payment object and no W-9 record. 19b reads 19a's finalized amounts rather than recomputing them.

---

## Scope

### 1. Creator completion and earnings

After the retry window, Admin verifies every agreed deliverable and records any waiver agreed by Founder **and** Admin.

**Fixed-payment outcomes — five cases:**

| Situation | Outcome |
|---|---|
| No valid compliant post | Return **100%** of the fixed allocation. No commission. |
| At least one valid compliant attributed post, later deliverables incomplete | Return **100%** of the allocation. **Genuine commission from compliant captured attributed sales may remain.** |
| All deliverables complete and verified | **Full fixed amount is eligible even if sales were poor.** |
| Fraud, fake traffic, self-dealing, false claims, invalid proof, material breach | Cancel unpaid invalid amounts. If already transferred, create a **negative balance and contractual recovery record**. |
| No fixed arrangement | Commission only. |

Creator percentage earnings use **successfully captured, validly attributed, pre-tax reward subtotal**. Bonus uses only that Creator's captured results. Total percentage never exceeds 50%.

### 2. Earnings states (Appendix B.7)

`estimated` · `finalized` · `approved for transfer` · `transferred` · `paid out` · `payout failed` · `adjusted`

**Every non-paid state shows amount, reason, owner, next date or action, and whether Affiliate action is required.** Never `held` where `eligible`, `blocked`, or `released` is accurate.

### 3. The Transfer

Admin creates **one** campaign-specific Affiliate Transfer **on or after Day 3**, covering finalized commission + earned bonus + eligible fixed amount. **Idempotent.**

**The Affiliate never requests a Proovd withdrawal and never receives Backer funds before Transfer creation.** Provider payout failures and requirements route to the Stripe-managed update path.

**A Transfer creation failure is a synchronous API error and a retry-job case. There is no `transfer.failed` webhook** (§32.3) — do not wait for one.

### 4. Provisional reconciliation (§24.4)

At capture, the maximum locked percentage that could be owed — including any conditional Creator-specific bonus — was provisioned. Now:

- Calculate the **earned** percentage after retry and verification.
- Transfer the earned amount **once**.
- **Return every unearned, untransferred difference to the Founder once**, through the approved application-fee adjustment or refund path.
- **Never retain an unearned Creator amount as platform revenue.**

Proovd's 5% and the provisional Affiliate liability stay separate ledger accounts throughout. The liability was never revenue.

### 5. The discretionary thank-you (§22.2)

Proovd **may** choose a thank-you payment when a campaign produced little commission and the Affiliate completed the agreed minimum work (default three posts), met the campaign click threshold, and complied with brand and AUP rules.

- **Never guaranteed, never estimated, never calculated by the product.**
- Funded **only from Proovd's retained listing-fee revenue, after all refund rights resolve.**
- **Never deducted** from Backer charges, Founder share, Creator commission, or the fixed allocation.
- Initiated **manually only**, through an approved recipient path, after tax and accounting approval.
- Record amount, reason, funding source, recipient, approval, provider object and status, tax treatment, and timestamp.
- **If the approval or path is absent, Admin may record recognition but cannot promise or send money.**

Build it as a manual, separately-funded expense with no calculator and no automatic trigger. A UI that estimates it has already violated §22.2.

### 6. W-9 and the block

Immediately after close, request the W-9. **Missing or unverified W-9 blocks every Founder payment.**

Founder payment status shows the exact amount affected, the requirement or blocker, a secure action, submitted and verified state, the next review date, and `No action needed` while under review.

### 7. Payment schedules

**Idea Campaign:** 100% of the eligible Founder share becomes payable at **Day 3**, after retry, W-9, payment and risk checks, and recorded Admin approval. **One `single_payment` object only.** Day 14 creates **no second payment** — it is fulfillment and enforcement review.

**Product Campaign:** first payment **40% at Day 3** after retry and W-9. Remaining payment **60% at Day 14** by default.

**Early remaining payment:** after Day 3 only, and only with recorded proof that the promised reward or access is **actually available to affected Backers**, required communication was sent, tax and payment requirements are complete, and no immediate risk flag exists. **Internal readiness alone is insufficient.** Early release **does not skip the Day 14 status review** or ongoing delivery, refund, and support duties. The control is **disabled by default and evidence-gated** (§6).

**Eligible Founder share** = captured pre-tax reward subtotal − Proovd 5% − Creator percentage compensation − applicable cause-based adjustments − Stripe fees allocated to the Founder under the approved configuration. **Tax is separate.**

### 8. Money surface consistency

Every surface showing an amount — Founder, Creator, Admin, email, timeline — must show **identical amounts, statuses, and reasons** (§33.8.13). One source, many renderers.

---

## Out of scope

Refunds, disputes, and cause-based allocation — Phase 20. Day 14 review itself and fulfillment — Phase 21.

---

## Traps

- **Provisional is never revenue.** §33.8.2. If the unearned remainder lands anywhere but back with the Founder, the ledger is wrong.
- **Reconcile once.** A second reconciliation pass that re-returns an already-returned amount is a silent overpayment.
- **One Transfer combining all three components** — commission, bonus, eligible fixed. §33.8.3.
- **Valid post plus incomplete later work returns the fixed amount but keeps genuine commission.** §33.8.6. The tempting simplification — cancel everything — is wrong.
- **Full completion earns the fixed amount despite weak sales.** §33.8.7. Sales performance is not a completion criterion.
- **Idea creates exactly one payment object.** §33.8.10. If a second `single_payment` can exist, the model is wrong.
- **Early release requires actual delivery evidence**, not internal readiness. §33.8.11.
- **The thank-you cannot be estimated or promised**, cannot use campaign balances, and cannot duplicate. §33.8.14.
- **No `transfer.failed` webhook exists.** Handle the synchronous error.
- **`held` is a forbidden word** where `eligible`, `blocked`, or `released` is accurate.

---

## Done when

- [ ] Proovd 5% and Creator percentage exclude tax — **§33.8.1**
- [ ] Provisional maximum and earned/unearned reconciliation happen once; provisional is never Proovd revenue — **§33.8.2**
- [ ] One Transfer combines finalized commission, earned bonus, and eligible fixed amount — **§33.8.3**
- [ ] A synchronous Transfer failure records and retries idempotently — **§33.8.4**
- [ ] No valid post returns the fixed amount and yields zero commission — **§33.8.5**
- [ ] Valid post + incomplete later work returns the fixed amount but preserves genuine commission — **§33.8.6**
- [ ] Full completion earns the fixed amount despite weak sales — **§33.8.7**
- [ ] A returned or paid allocation cannot repeat — **§33.8.8**
- [ ] W-9 blocks every Founder payment — **§33.8.9**
- [ ] Idea creates only the 100% Day 3 single payment, with no second object — **§33.8.10**
- [ ] Product creates 40%/60%; early remaining payment cannot occur before Day 3 or without delivery, communication, tax, and no-risk evidence — **§33.8.11**
- [ ] Early release does not skip Day 14 — **§33.8.12**
- [ ] Every money surface shows identical amounts, statuses, and reasons — **§33.8.13**
- [ ] The thank-you is never estimated or promised, cannot use campaign balances, and cannot duplicate — **§33.8.14**
- [ ] The tax-accountability record gates every Transfer

**Acceptance:** all fourteen tests in §33.8.
