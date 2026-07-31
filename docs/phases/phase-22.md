# Phase 22 — Notification sweep

**Model:** Opus 4.8 — Roughly 73 events, each with copy that must satisfy §27.2's rules and the naming contract. Volume plus compliance sensitivity rather than algorithmic difficulty.

**Goal:** every event in §27.3–27.6 exists in the typed registry, sends once, carries the right shape, and is provably covered — with nothing sending that shouldn't.

The registry skeleton was built in Phase 03 and filled by the phases that own each event. This phase closes the gaps and proves coverage.

---

## Read first

- Spec §27 — the whole notification and service contract
- Spec §27.1 — the system-wide state pattern
- Spec §27.2 — transactional email rules
- Spec §27.3, §27.4, §27.5, §27.6 — the four event inventories
- Spec §27.7 — digests and in-app history
- Spec §27.8 — the service SLA
- Spec §30 — the engagement patterns that are forbidden

---

## Prerequisites

Phases 06–21 green. Most events already exist; this phase audits, completes, and proves.

---

## Scope

### 1. Coverage audit

Walk the four inventories and assert every event exists in the registry, has a template, and has a tested send path.

| Inventory | Roughly | Spec |
|---|---|---|
| Founder | 23 events | §27.3 |
| Affiliate | 20 events | §27.4 |
| Backer | 13 events | §27.5 |
| Internal | 17 events | §27.6 |

Because the registry is typed and keyed, coverage is a **test that enumerates the key set**, not a manual checklist. Build that test — it's the artifact that keeps coverage true as the product changes.

### 2. Transactional rules (§27.2)

Every message: **not opt-out-able** · specific subject naming the campaign or product · **at most one primary action** · a plain-text support route and a stable campaign, reservation, or case reference.

Money emails additionally carry amount, seller and merchant of record, expected descriptor, and pending or completed status.

**High-impact messages can be previewed with final variables before manual send.**

**Duplicate webhook or job delivery cannot create a duplicate email** — enforced at `notification_deliveries`, not by the mail provider.

### 3. The state pattern (§27.1)

Every waiting, review, payment, recovery, and exception state answers the six questions, and **every consequential action has both an immediate on-screen confirmation and a durable email or product-history record.** A toast alone is never sufficient.

Dates render local-primary with canonical UTC secondary, and **deadline emails spell out the timezone**.

### 4. Digests and in-app history (§27.7)

An **optional** daily or weekly digest for eligible activity — updates, comments, roster changes. The Backer chooses at first magic-link visit; Founder and Affiliate in settings.

Authenticated Founder, Affiliate, and Admin surfaces get notification history. **Notification history must not turn the Founder home into a widget dashboard or override the one ranked Act item** (§27.7, DNA §5.2).

**No real-time push is required.** §30 defers the push-notification matrix.

### 5. Support SLA (§27.8)

Submission returns case ID, topic, owner, human-response due time, and the 48-hour Founder follow-up rule. **Even without resolution, an update goes out at the promised checkpoint.** Admin sees due and overdue badges and a daily queue of responses and promises due.

The exact footer block is fixed text — verify it renders identically everywhere it appears.

### 6. What must not send

Assert absence, not just presence:

- **No generic Day 3/7/10 "check your campaign" emails** (§20, §33.6.11).
- **No notification without a real action or consequence behind it.**
- No manufactured milestone. First pre-order, halfway, threshold met, and campaign ended each appear **once**, then move to history.
- No engagement sequence, no re-engagement drip, no streak reminder (§30, DNA §5.10).
- **No notification that pressures a user for leaving.**

DNA §5.5's framing is the design rule: anticipation replaces notification pressure. Because arriving always shows what changed since last time, the product never needs to beg.

### 7. Copy pass

Every template checked against the §3 naming contract and the §3.2 replacement table. `reservation`, `pre-build`, `pre-launch`, `tranche`, `MBP`, `pledge`, and `goal` must not reach a Founder or Backer. Every CTA names the actual action.

---

## Out of scope

New product behaviour. If this phase finds a missing *capability* rather than a missing *message*, that belongs to the phase that owns it — record it and fix it there.

---

## Traps

- **Coverage is a test, not a checklist.** A manual audit is correct once and stale immediately.
- **Deduplication lives at `notification_deliveries`.** Provider-level dedup is not a substitute — a retried job with a fresh idempotency key would slip past it.
- **One primary action per message.** Two competing CTAs in a payment or recovery email is a §30 violation.
- **An on-screen confirmation is not a durable record.** §27.1 requires both.
- **Absence tests matter as much as presence tests.** §33.6.11 tests that something does *not* exist.
- **Don't let notification history become a dashboard.** §27.7 says this explicitly, and it's the easiest way to undermine DNA §5.2's single ranked action.

---

## Done when

- [ ] Every event in §27.3–27.6 exists in the registry with a template and a tested send path
- [ ] A coverage test enumerates the key set and fails when an event is added without a template
- [ ] Every message satisfies §27.2 — subject, one action, support route, stable reference
- [ ] Money emails carry amount, seller/MoR, descriptor, and status
- [ ] Duplicate job or webhook delivery produces exactly one email — **§33.9.12**
- [ ] Support cases carry stable reference, owner, due time, context, and the 48-hour rule — **§33.9.10**
- [ ] High-impact messages preview with final variables before manual send
- [ ] Digest preference is capturable for all three roles; notification history exists without becoming a dashboard
- [ ] No generic Day 3/7/10 email exists — **§33.6.11** reconfirmed
- [ ] No message sends without a real action or consequence
- [ ] Every template passes the naming contract and the §3.2 replacement table
- [ ] Deadline emails spell out the timezone; all dates render local-primary with UTC secondary

**Acceptance:** §33.9.10 and §33.9.12 complete; §33.6.11 reconfirmed. This phase's real output is a coverage guarantee across all four inventories.
