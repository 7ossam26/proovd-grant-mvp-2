# Pilot rollback plan

Spec §34, `docs/phases/phase-24.md` scope 6.

Written before cutover, not after a problem. §34 makes a named rollback owner a
condition of live mode, and a plan that leaves in-flight reservations undefined
is not a plan — Backers who saved a card under live mode carry a real
commitment, and the point of writing this down is that nobody has to work out
what happens to them while it is happening.

**Status: not yet operable.** The mechanism below is built and tested. The
triggers, the decision-maker, and the party communication owners are Track A6
and are **deliberately blank** — Spec §1 rule 6 forbids inventing them, and a
plan naming a person who has not agreed is worse than a plan that says nobody
has been named yet. Every field is required on the enablement record, so a
pilot cannot be enabled until they are filled in.

---

## What is already decided, because it is code

### How live mode is disabled

One statement:

```
POST /api/admin/live-mode/rollback   { rolledBackBy, reason }
```

or, at the service, `rollBackPilot(db, { rolledBackBy, reason })`.

It is a single conditional `UPDATE` on the one live row in
`pilot_campaign_enablements`. **No deployment, no restart, no cache** — the gate
is read on every money call precisely so that this takes effect on the next one.
A cached gate would be a rollback that does not take effect, and the reason §34
asks for a rollback owner is that somebody may need it to take effect in
seconds.

The reason is required. A rollback with no reason is live money stopped by
somebody nobody can ask about it, and the answer the affected people are owed
starts with that sentence.

Re-enabling afterwards is a **new** enablement with its own gate snapshot. There
is no un-rollback: why live money stopped is not a fact to erase.

### What stops immediately

Every operation that creates new exposure, refused at the one gateway every
service shares:

| Stops | Because |
| --- | --- |
| Saving a card (`createCustomer`, `confirmSetupIntent`) | §34: real card data, live SetupIntent |
| Charging at close (`createOffSessionPaymentIntent`) | §34: live PaymentIntent |
| The listing Checkout and fixed-payment funding | §34: real card data, live fixed funding |
| Affiliate Transfers and the §22.2 thank-you payment | §34: Affiliate Transfer |
| Creating or releasing a Founder payment | §34: any payout promise |

The campaign-scoped services refuse by name before they do anything, so a
blocked pre-order is a refusal the Backer reads rather than a failure they see.

### What deliberately keeps working

| Keeps working | Because |
| --- | --- |
| Refunds (`createRefund`) — listing, reservation, and the fixed-payment return | Money going **back**. §34's blocked list names six things and a refund is not among them. |
| Detaching a saved card (`detachPaymentMethod`) | Releasing a card, not saving one. §20 cancellation, the §21 threshold miss, and §26.7 kill all need it. |
| Connected-account onboarding, tax quotes, webhook verification, provider reads | §34's own first list: onboarding and test-mode engineering proceed while the gate is closed. |
| Everything that is not money — drafting, review, recruitment, support, the public site | §34's first list. |

This split is the plan's most important property. A gate that closed everything
would strand exactly the people this document exists for: someone with a live
charge and no path to a refund, or a live saved card and no path to remove it.

### What happens to reservations already saved

Nothing is rewritten, and nothing is charged.

- **Saved, uncharged cards stay saved and uncharged.** The SetupIntent is
  historical and stays that way (§23.5). Nothing about the reservation moves.
- **The close batch is blocked**, returning `blocked` with the live-mode reason
  rather than capturing. The close is still owed; the sweep picks it up again if
  live mode is re-enabled. Nothing enters the retry window, because no charge
  was attempted — the gate throws rather than returning a decline, which is why
  a blocked capture does not read to the system as a failed card.
- **Backers can still cancel**, and the card still detaches.
- **Already-captured charges stay captured**, and the §24.8 refund path is fully
  available. If the decision is to unwind them, that runs through
  `recordRefundCase` → preview → `executeRefund` like any other refund, with its
  cause, its Admin, and its Appendix B.6 message. There is no bulk path and
  there should not be one.

---

## What is not yet decided — Track A6

These are required on the enablement record. The pilot cannot be enabled while
any of them is blank.

### What triggers a rollback

> _Not yet stated._ Must be observable conditions the monitoring owner can
> recognise without a judgement call — not "if something goes wrong".

### Who decides, and how they are reached

> _Not yet named._ §34: a named person, reachable, who knows they hold it. Not a
> team alias and not "whoever's on call" — the enablement refuses both.

### What each affected party is told, and by whom

> _Not yet stated._ Needs one line per party: Backers, the Founder, and every
> Creator on the roster, each with the person who sends it. §27.1's six
> questions apply — what happened, what next, who owns it, when the next update
> comes, what they can do now, how they get help.

---

## Before the first live reservation

Three things confirmed against the real world, recorded in
`pilot_preflight_confirmations`. The pilot can be enabled without them; the
first reservation should not happen until all three are in.

1. **The statement descriptor as an issuer prints it.** The §24.12 kernel
   produces `PROOVD* <suffix>`; what a Backer actually recognises on a statement
   is what matters.
2. **Live webhook delivery on both endpoints.** Signature verification passing
   in test proves the code, not that the live endpoint is reachable.
3. **The monitoring owner can see `/admin/risk`.** An owner who cannot see what
   they are monitoring is a name on a form.
