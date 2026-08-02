# Proovd MVP

Founder-led crowdfunding platform. Vetted Founders run campaigns, hand-recruited
Creators promote them, Backers save a card and are charged later under a
disclosed rule, and Admin operates the exceptions behind a polished surface.

Private repository. Not open source.

## Governing documents

Read these before changing anything — they win over anything inferred from the
code.

| Authority | Document |
| --- | --- |
| 1. Behavior, data, state, money, tax, acceptance | [docs/spec/Proovd-MVP-Engineering-Implementation-Spec-v1_0.md](docs/spec/Proovd-MVP-Engineering-Implementation-Spec-v1_0.md) |
| 2. Visual, interaction, motion, content design | [docs/spec/Proovd_DNA.md](docs/spec/Proovd_DNA.md) + [frontend/public/proovd.css](frontend/public/proovd.css) |
| 3. Implementation mechanics | [docs/tech-stack-v2.md](docs/tech-stack-v2.md) |
| 4. Sequencing | [docs/master-plan.md](docs/master-plan.md) |

Working rules for contributors and for Claude Code sessions live in
[CLAUDE.md](CLAUDE.md). Per-phase briefs live in [docs/phases/](docs/phases/).

## Status

Built one phase at a time against `docs/master-plan.md` §6. **Phases 00–11 are
complete**; Phase 12 — the formal Creator opportunity and the 72-hour decision
the listing payment now starts — is next. Money moves in test mode only, and
the live-mode gate stays shut.

| Phase | Delivered |
| --- | --- |
| 00 | Repo structure, design-system and prebuilt files in place |
| 01 | Express backend, Postgres, Drizzle, env guard, test harness |
| 02 | Design-system vocabulary, `StatePanel`, `Flow`, component gallery |
| 03 | Domain kernel — money, state machines, calendar, audit, idempotency |
| 04 | Auth — three account roles, Admin MFA and freshness gate, token service |
| 05 | The fourteen public routes, policy versioning, two sample campaigns |
| 06a | Global configuration, the production-prerequisites gate, the Admin shell |
| 06b | Transactional email, the Founder invitation and draft, the retention sweep |
| 07 | Pre-account vetting, the permanent campaign-type lock, the account claim |
| 08a | Creator recruitment, subtype verification evidence, the private invitation |
| 08b | The Creator's compact signup, the payout handoff, the named waiting state |
| 08c | The preparing reveal, the Campaign kit, access logging and revocation |
| 09a | The campaign workspace, the five optional items and their evidence, uploads, high-effort, the itemised listing fee |
| 09b | The embedded interview: the signed booking webhook, reconciliation, and the four interview notifications |
| 10a | Stripe foundations: the pinned client, both signed webhook endpoints, idempotent event handling, and the provider-object ledger |
| 10b | Hosted onboarding for Founders and Creators, its four return states, and the tax-accountability gate |
| 11 | The listing-fee Checkout, its seven atomic effects, the two clocks, the single full refund, and Founder cancellation |

Four briefs have been built in halves. Phase 06 bundles four independent
deliverables; Phase 08 bundles three — recruitment, the Creator's signup, and
the preparing reveal with its Campaign kit; Phase 09 bundles the optional-item
workspace and a third-party scheduling integration; Phase 10 bundles the
payments substrate and the two onboarding surfaces built on it. Splitting them
was a scheduling decision, not a scope one: each half is built against the same
brief and lands its own named acceptance tests. Every named test from §33.1.1 to
§33.1.9 passes, so does every one from §33.2.1 to §33.2.4, and so does every one
from §33.3.1 to §33.3.8, plus §33.3.11.

Phase 09 split along the line between a domain record and a vendor. The booking
record went first and is the source of truth — a scheduling provider is a source
of events, not of domain state — so the four booking conditions, the reschedule
history, and the recalculation on cancellation were built and tested before any
webhook existed. That ordering is what makes a confirmed interview reachable
when a delivery is missed, rather than a thing only the vendor can grant.

## Layout

npm workspaces, one root `package.json`, one multi-stage `Dockerfile`.

```
shared/     Zod schemas, money waterfall, state machines, business-day calendar
  src/policies/   the eight canonical policy records and their versions
  src/settings/   the §6 operating-constant register
  src/vetting/    the §9 vetting sequence, its copy, and the two campaign paths
  src/affiliates/ the §5.3 subtypes and their evidence, §8's recruitment
                  record, and §2.2's active-partnership slot rule
  src/workspace/  the §12 optional items, what does not count as evidence for
                  each, the copy-ready helper resources, and the interview
                  statuses
  src/checkout/   the Appendix A.5 listing-fee consent, verbatim, and the
                  resolver that fills in its two amounts
backend/    Express 5 + Drizzle + Postgres 16
  src/auth/           Better Auth config, guards, token service, seeding
  src/policies/       the §34 policy gate
  src/settings/       reading, validating, and versioning the §6 constants
  src/admin/          the production-prerequisites panel
  src/invitations/    Founder prospects, the invitation, the retention sweep
  src/vetting/        the §9 answers and their provenance, the §10 account claim
  src/affiliates/     Creator recruitment, verification, the private
                      invitation, and the §11 compact signup
  src/workspace/      the §12 evidence rules, the interview booking record,
                      high-effort, and the listing-fee calculation
  src/storage/        presigned R2 uploads and what a stored object really is
  src/interviews/     the booking provider, its signed webhook, the campaign
                      reference that binds a booking, and the reminder job
  src/payments/       the pinned Stripe client, connected accounts and their
                      four onboarding states, hosted onboarding, the
                      provider-object ledger, the tax-accountability gate, the
                      listing Checkout and its seven atomic effects, the single
                      full refund, Founder cancellation, and the two clocks
  src/notifications/  the deduplicating sender, Resend, the email templates
  src/jobs/           pg-boss, on the same Postgres
frontend/   React 19 + Vite, styled solely by proovd.css
  src/features/public/   the fourteen public routes, footer, sample campaigns
  src/features/admin/    the Admin shell, Founders, Creators, configuration,
                         prerequisites
  src/surfaces/          the unusable-link page
  src/surfaces/draft/    the Founder journey: vetting, result, account claim
  src/surfaces/creator/  the Creator's compact signup, waiting state, and the
                         preparing Campaign kit
  src/surfaces/founder/  the campaign workspace: five optional items as a flow,
                         the fee preview, the helper resources, and the listing
                         payment with its Appendix A.5 consent
  src/surfaces/payouts/  Stripe onboarding for both roles, and where Stripe
                         sends people back to
docs/       Spec, DNA, tech stack, master plan, phase briefs
```

`shared/money` holds the **only** implementation of the payment waterfall. Both
the checkout preview and the close batch call it.

**The backend never imports `@proovd/shared` at runtime.** That package exports
TypeScript source, the backend compiles under `rootDir: src`, and the production
image ships only `backend/dist`. Where the server needs a shared fact it
restates it and a drift test fails the suite if the two diverge — the state
enums in `backend/src/db/schema/domain.ts`, the required policy slugs in
`policy-gate.ts`, and the setting bounds carried as columns on `app_settings`
are all the same pattern. Frontend and test files import it freely; Vite and
Vitest resolve the workspace source directly.

## Domains

`proovd.co` is the marketing home and lives in its own repository.
`app.proovd.co` is this one, and it owns **every** route in Spec §18's public
inventory — including the ones that read like marketing.

That is not a preference. §18's attribution contract sets a first-party cookie
when a Backer arrives through a Creator link and reads it at pre-order; if the
campaign page and the checkout sit on different hosts, Safari and Chrome drop
it and Creator compensation is computed from nothing. Backer magic links are
campaign-scoped to the same origin for the same reason.

**The recorded redirect:** `proovd.co/<path>` 301s to `app.proovd.co/<path>`
for every path in the §18 inventory except `/`, which stays the marketing home.
The inventory itself is in
[frontend/src/features/public/site.ts](frontend/src/features/public/site.ts) —
one list, read by the router, the header, the footer, and the broken-link test.

## Policies

The eight canonical documents of Spec §31.4 are a **register, not text**.
[shared/src/policies/documents.ts](shared/src/policies/documents.ts) holds one
record per document — slug, route, title, version, status, effective date, and
the coverage §31.4 requires. The backend's `policy_versions` table mirrors it
row for row, and a drift test fails the suite if they disagree.

**Every document is currently `draft`, and that is the correct state.** The
approved text is in legal review, and the Spec forbids both filling the gap
with invented prose and shipping a summary in its place. So each route renders
its versioned record and says plainly that the document is in review.

`draft` blocks the fourth condition of Spec §34's live-mode gate. Phase 24
releases it by publishing the documents — not by bypassing the check.

**It also blocks the Founder account claim, and that is deliberate.** Spec §10
requires a Founder to accept the Terms, the Founder AUP, and the privacy policy
before an account exists, and a consent record may cite only a published
version — a database trigger, not a convention, because the failure would
otherwise be silent. So while the documents are with the lawyers, the last step
of the Founder journey refuses in the open: it says why, says that nothing was
created and nothing entered was lost, and offers no button. Asking someone to
accept text Proovd's own lawyers have not agreed records agreement to nothing.

## Global configuration

Every operating constant Spec §6 names lives in `app_settings`, seeded from the
register at [shared/src/settings/registry.ts](shared/src/settings/registry.ts)
and administered at `/admin/settings`. From Phase 06 on, **later code reads the
setting, never a constant** — a hardcoded duration is a bug even when the number
is right. `shared/src/money/constants.ts` survives as the seed values the
register and the migration agree on, not as something to import at a call site.

Each setting declares where its value comes from, and the distinction decides
what the surface will let you do:

| Provenance | Meaning |
| --- | --- |
| `specified` | §6 states the value. It seeds, and Admin may change it. |
| `operator` | §6 names the setting and fixes **no** value. No default exists anywhere; it ships unset and blocks. |
| `derived` | The value follows a committed artifact. Not editable. |

**Six settings ship with no value and that is correct.** Approved campaign
minimum and maximum duration, the interview providers, availability,
interviewer roster, reminder lead time, and the Admin reauthentication window —
Spec §6 names all of them and fixes a number for none. Spec §1 rule 6 forbids
inventing one, so they are empty, and the prerequisites panel blocks until an
operator states them. The same reasoning as `VITE_SUPPORT_CHAT_*`.

The two `derived` settings are the business-day calendar version and its
timezone. They come from the committed calendar in `shared/calendar`, and a
database trigger refuses to edit them: Spec §29.6 requires the calendar version
to be stored with every computed deadline and forbids an edit silently resetting
one, so a new calendar is a new committed version and a deployment.

Changes are versioned and audited by the database, not by convention.
`app_settings.updated_by` and `update_reason` are `NOT NULL`, so an update that
does not say who and why never commits, and a trigger writes the
`app_setting_versions` row that no application code can skip.

## Production prerequisites

`/admin/prerequisites` renders Spec §6's readiness list — the ten items that
must hold before Proovd may collect a live card. Five the app re-checks on every
load; five a named person verifies and records with a note and evidence, which
is Spec §34's own "recorded as complete" and Spec §1.3's rule that manual work
counts only when the app records it. Each item says which kind it is, because
showing a human check as a system check would imply automation that does not
exist (Spec §1.4).

**Incomplete prerequisites block, they do not warn.** There is no override on
that page, no "proceed anyway", and no place to add one. Spec §34 is released by
satisfying its conditions.

## The Founder invitation

There is no public signup, for any role. A Founder exists because an Admin found
them off-platform, recorded a prospect, wrote an invitation, previewed it, and
sent it. Spec §7 governs the whole path, and three rules shape the code:

**Preview is a gate.** The template renders every unfilled field as a bracketed
marker — `[WHAT PROOVD UNDERSTOOD]` — and the server scans the *rendered*
subject, HTML, and text for them. While any remain, Send is unavailable, and the
send route re-decides independently of the disabled button. A Founder never
receives a placeholder.

**Resend is a real second email; a duplicate job is not.** The notification
dedup key in `notification_deliveries` is the *send*, not the draft. Keying on
the draft would satisfy Spec §27.2's rule against duplicate deliveries and break
Spec §7's requirement that resend work — the second invitation would be
swallowed as a duplicate of the first. Resending rotates the token, invalidates
the previous one immediately, and restarts the retention window.

**The link is never shown in Admin.** Spec §28.1 puts the raw token in the
delivered URL and nowhere else, so the Admin surface reports that a live link
exists, which version it is, and when it expires. An Admin who needs a working
link for a Founder resends one.

The Founder's landing page at `/draft/:token` names them and their product,
explains what happens next, and **asks for nothing** — no account, no card, no
form, not even a disabled one. Every unusable link, for every reason, renders one
identical page.

## Vetting, the type lock, and the account claim

The Founder journey is four questions, a result, and an account — Spec §9 and
§10 — and the whole of it happens behind the invitation link, with no session
and no account until the very last step.

**The campaign type locks permanently at submission, and there is no migration
path.** Idea Campaign or Product Campaign decides whether there is an order
threshold, how many pre-orders one Backer may place, which refund policy
applies, and when the Founder is paid — so both options are shown in full, with
what each commits them to, before either is chosen, and the permanence is said
plainly twice. Once locked, a database trigger refuses to change it, for every
future phase and every support script. A wrong lock is corrected by archiving
the record and starting a fresh one: a new campaign, a new draft, an empty
vetting record, and nothing carried across — no Creator acceptance, no reward,
no payment, no consent. The code that does it reads none of those tables, which
is a stronger guarantee than checking that it copied none of them.

**Competition is never prefilled.** Proovd drafts the Problem and the Solution
from discovery and the Founder edits them; the Competition box starts empty and
stays that way. It is the one field that proves the Founder did their own
thinking, so there is no column to prefill it into, no parameter that would
carry one, and a `CHECK` constraint that refuses to record it as anything but
theirs. Every field stores who supplied the value that is in it now, what
Proovd originally supplied, and when the Founder took it over.

**Everything saves as it is typed, and a failed save never costs a sentence.**
The status line says `Saving…`, `Saved 14:32`, or `Could not save — retrying`,
and it says `retrying` only while a retry is genuinely scheduled — a refusal is
a decision, not a transient failure. The typed value is never replaced by a
server response, so nothing the server says can empty a box.

**The possible-creator result promises nothing.** It is a relevance signal a
named Admin records with its basis, shown once before the account exists, with
every one of Spec §10's limits beside it in full. Recruitment is Spec §8's and
has not happened yet, so there is no roster to count — inventing a formula over
an empty table would produce a number that means nothing. A zero result and an
unrecorded one look identical to the Founder: a waiting state owned by Proovd.
Distinguishing them would tell them a number Spec §10 forbids showing.

**The claim is one transaction.** It creates the account, invalidates the draft
link, keeps the draft and its provenance, emits `founder_signup_complete`
exactly once, and moves the campaign to `account_claimed`. A retry, a
double-submit, and two genuinely concurrent claims all produce one account and
one event — the idempotency key settles the first two, the conditional update on
the token settles the third.

## Creator recruitment

Creators do not apply. There is no open signup for them either — a Creator
exists because an Admin researched a public channel, recorded why it fits one
specific campaign, and sent one private invitation. Spec §8 governs it, and the
shape of the code follows three of its sentences.

**The internal quality tier is a note, not a score.** Spec §8 allows Admin to
record one and forbids it acting as a commission floor. A ranked tier — bronze
to gold, 1 to 5 — is a value that can be sorted and multiplied, so the first
phase that needs a default percentage would find one already sitting there. It
is therefore free text with no scale: a database constraint refuses a bare
number or a percentage, and there is no list of tier levels anywhere to import.
Naming the levels would also invent an eligibility scheme the Spec does not
state. A rule enforced by the type survives refactors that a rule enforced by
convention does not.

**The invitation is bound to one association, and the database binds it.** An
invitation link carries a single campaign-Creator association id and nothing
else — no draft, no campaign, no Backer identity — enforced by a check
constraint rather than by every route that reads a token. A Creator recruited to
two campaigns holds two associations and receives two invitations, because Spec
§11 ties them to the campaign that caused the invitation. One link is never
usable against another campaign.

**Two sentences in every invitation cannot be edited.** Spec §8 requires the
email to say that the opportunity may still be preparing, and that declining
later does not harm standing. Both are promises about how Proovd behaves rather
than facts about this recruitment, so they are fixed template text — an editable
promise is one that gets softened for a Founder who wants a roster filled. The
compose surface shows them read-only, no route writes them, and a test compares
the sent body against them.

Everything else mirrors the Founder invitation deliberately: preview is a
server-side gate on the rendered message, resend rotates the token and produces
a genuinely new email, and the send row is written before the provider call so
nothing can be delivered without a record of it. The two senders are kept as
separate code rather than merged, because they differ in token scope, dedup
identity, state machine, and required contents — and the difference that matters
most is the one the acceptance suite is about.

**A slot is counted, never stored.** Spec §2.2 lets one Creator hold three
active partnerships, running from tracking-link activation until the campaign
closes or they are removed. That is derived from the association's state on
every read, so a flag nobody cleared can never strand someone at three. A paused
Creator still holds their slot — a pause is not a closed campaign, and releasing
it would let one Creator hold four campaigns by having one go wrong. Recruiting,
inviting, and preparing consume nothing.

**The Founder sees a card, not a file.** After the account claim a Founder sees
each recruited Creator's public handle, channel, niche, and status. They cannot
browse a pool, cannot message anyone, and cannot see the email, phone, legal
name, quality tier, verification evidence, or internal notes. The query that
serves that view does not select those columns at all — there is no filtering
step in it that a later change could forget.

## The Creator's signup

One page. Spec §11 gives the flow a single primary action — `Confirm and create
account` — and then exactly one more, `Finish payout setup`. It forbids the
alternatives by name: no welcome tour, no multi-page education sequence, no
separate banking page, no public signup. So there is one route serving the whole
flow, one primary button on the page, and no step counter anywhere.

**Proovd does not ask for bank or tax details, and could not store them.**
Getting paid needs a Stripe account in the Creator's name, and Stripe collects
the identity, tax, and banking data through its own onboarding. Spec §11 forbids
reproducing those fields in a custom form and Spec §5.3 says Proovd stores
statuses and IDs and "never full bank details" — so there is no route here that
accepts one, no column that could hold one, and a database constraint that keeps
the connected-account column looking like a Stripe account reference and nothing
else. The payout step lands in Phase 10; until then the panel reports its true
status and renders no control, because a button that does nothing is worse than
no button.

**Everything Proovd prefilled says so, and every correction is kept.** The
recruitment record fills in the name, handle, channel, niche, audience metric,
and the Admin-written bio; each one carries a line saying Proovd wrote it, and
that line flips the moment the Creator changes it. What Proovd originally
suggested survives beside what replaced it — that pairing is what Spec §11 means
by Admin seeing "corrections to prefilled fields".

The channel *type* is shown but not editable. It is Admin's classification under
Spec §5.3, and it decides which verification evidence was required and recorded;
a Creator flipping it would silently invalidate a verification. A correction
there goes to support.

**Five confirmations, five separate controls.** Spec §11 asks a Creator to
confirm they are 18+, US-based, the actual operator behind the channel, not
running duplicate accounts, and sanctions-eligible. Spec §28.4 forbids bundling
optional consent, so each is its own unchecked control, its own field, and its
own column. There is no "accept all", and nothing in the save path can set more
than one.

**Two agreements, and they are still drafts.** Spec §11 names Terms and the
Creator acceptable-use policy — not the privacy policy, which §10's Founder
claim takes because §10's own list names it. Collecting an acceptance the Spec
does not ask for is as wrong as skipping one it does. Both documents are with
the lawyers, so the claim refuses in the open exactly as the Founder's does: it
says why, says nothing was created and nothing entered was lost, and renders no
button.

**The waiting state is named and owns itself.** Once the account exists and the
Founder has not finished their own setup, the same page confirms the signup,
names the campaign, says the Founder is still setting up, says Proovd owns the
step, says when the next update comes, and says `No action needed` — Spec §11's
exact words, which live in one exported constant that the surface and the
confirmation email both read. Accept, decline, propose, and link activation are
unreachable: none of them exists yet, and the formal opportunity only opens
after the listing fee is paid.

## The preparing pre-view

The most confidentiality-sensitive thing in the product. When a Founder finishes
claiming their account, every Creator already recruited and signed up for that
campaign can suddenly read the Founder's unreleased product information — having
signed nothing.

Spec §31.5 permits that only as a narrow, pilot-only exception, and only while it
stays **private, authenticated, logged, campaign-scoped, and revocable**. Each of
those is a mechanism here, not an intention.

**It happens exactly once, guarded three ways.** Spec §10 says so twice — the
campaign "appears automatically in `preparing` exactly once", and Admin must see
that "no duplicate visibility event or email may occur after retries". So there
is an idempotency key per association, a conditional status update that matches
nothing the second time, and the delivery-dedup constraint on the notification.
Any one would stop the ordinary case; all three are there because a duplicate
event must never duplicate state or a message, and this event is no different
from a webhook in that respect.

Each Creator is revealed in their own transaction. One person's failure — a
revoked kit, a provider refusal — must not roll back another's: they are
independent grants to independent people, and an all-or-nothing batch would let
one bad row hold a whole roster in the dark.

**Every read is logged, and the log holds no content.** `campaign_kit_access` is
insert-only and records who opened what, when — never any of the material. A
copy of a Founder's confidential text in an insert-only table would be a copy no
revocation could ever reach. The access row is written by the same function that
returns the content, so there is no arrangement of routes that serves the kit
without recording it.

**Revocation is immediate and one-way.** Admin withdraws access with a stored
reason; the next read refuses before a single field of the Founder's material is
selected. A database trigger refuses to clear the stamp, because an access grant
nobody consciously made is precisely what this exception cannot survive.
Re-granting is deliberately not built.

**The kit is early, and says so.** Spec §14.1 lists the *complete formal* kit —
rewards, prices, base percentage, tracking links — and almost none of it exists
before the campaign is built and the listing fee is paid. Spec §10's phrase is
"currently available", so the Creator sees the Founder, the Problem, the
Solution, the Competition, and the campaign type, followed by a list of what is
missing and why. Rendering those sections empty would read as a campaign
offering nothing rather than one that has not been built yet.

**Nothing here is an offer.** Compensation is Spec §12's and arrives with the
formal opportunity, so no percentage is selected into this view at all — there
is no field to accidentally turn into a control. Accept, decline, propose, and
link activation do not exist as routes or as buttons. The surface says, in the
same view as the material, that reading is not accepting and that the material
is confidential.

## The optional items and the listing fee

A Founder can do five optional things — visuals, branding, an interview with
someone at Proovd, a story, and a public profile — and each one takes US$2 off
their listing fee. Spec §12 governs it, and one sentence in it decides the whole
shape of the code: each item completes **only on objective evidence**.

**Saying it is done never counts.** There is no route, no field, and no column
that lets a Founder mark an item complete. The server re-derives all five
decisions from the stored content every time anything changes, and it rejects
each near-miss Spec §12 names by name: an empty file, a placeholder, the same
file twice, a link that does not open, a story that has been written but not
approved, an interview slot that was picked but never confirmed. A discount
handed out for a self-report would not be a discount for doing the work.

**Approval is of a version, not of a box.** A Founder who approves a story and
then rewrites it has an unapproved draft again, so the edit clears the approval
in the same statement. They always approve the words that will actually be
published.

**Files go from the browser straight to storage and never touch our server.**
The browser asks for a signed URL, uploads to it, and the server then reads the
object back out of the bucket and decides what it actually is — from the bytes,
not from what the browser claimed. A document renamed to `.png` is not an image.
The signature covers the exact object, its type, and its size, so a URL issued
for one photo cannot be reused for anything else, and it expires in minutes.

**Admin can take a completion back, and must say why twice.** Spec §12 allows an
invalidation before payment with a reason, and gives the Founder the correction.
The internal reason and the sentence the Founder reads are separate fields, both
required — an invalidation nobody can read is one nobody can correct. Granting a
completion without evidence is a *different* act, recorded as an override with
the evidence it rests on, and it survives every later save: an override the next
autosave silently withdrew would not be one.

**The fee is calculated on the server and only ever displayed in the browser.**
The base, each earned saving as its own line, and the subtotal all come from the
server, which reads the four Spec §6 numbers from configuration rather than from
code. There is no arithmetic on a fee anywhere in the frontend — that is how a
preview and a charge come to disagree. Sales tax is added at Checkout by Stripe
Tax, so no tax line and no "total due now" appears before then: a zero would be
a claim nobody has made. The 5% Proovd keeps from what a campaign collects is a
different stream and says so, in a sentence that travels with every preview.

**High effort describes preparation, never quality.** A campaign is classified
high-effort only when there are no visuals, no branding, and no interview. It
controls exactly one thing — whether a Creator may propose a percentage above the
base rate — and it controls nothing about fixed payments. The surface says all of
that, because a Founder who reads the phrase with no context reads it as a
verdict.

**Uploads and interviews are both switched off, and both say so.** The storage
bucket and the scheduling account are outstanding setup, and Spec §6 names the
interview providers, hours, interviewers, and reminder timing as settings while
fixing a value for none of them. So an unconfigured deployment renders no upload
control and no booking control at all, rather than one that would fail — and the
workspace names what is missing instead of going quiet. Every other item still
counts toward the fee.

**The guidance is text you copy, not a button that writes for you.** Spec §12
asks for copy-ready help with competition, branding, visuals, and story,
including reusable prompts — and rules out an embedded AI product; Spec §30
defers AI rewriting by name. So the prompts sit beside a copy control, there is
no model client anywhere in the repository, and a test scans the guidance to keep
it that way. A transcript is not a story, and neither is a summary.

## The embedded interview

A Founder books a conversation with someone at Proovd without leaving the
product, and a confirmed booking takes US$2 off their listing fee and changes
how a Creator may be paid. That makes an ordinary calendar integration a path
into a commercial decision, and the code is shaped by that rather than by the
vendor's happy path.

**Our database is the source of truth; the provider is a source of events.**
The booking record, its four states, its reschedule history, and the
recalculation on cancellation were all built and tested before any webhook
existed. A confirmed interview is therefore reachable when a delivery is
missed — Admin reconciles it through the same code the webhook uses, and the
history records which arrived how. A vendor outage costs a Founder nothing.

**Two independent facts have to agree before a booking binds to a campaign.**
The provider lets whoever opens the booking form prefill its metadata, so a
campaign id in the payload is a value the *booker* chose. Trusting it would let
one Founder attach a booking, its saving, and its effect on Creator pay to
someone else's campaign — and the webhook signature would not help, because it
proves where the payload came from, not who typed what into it. So Proovd issues
its own signed reference to the authenticated Founder of one campaign and
recomputes it on the way back in, **and** separately checks that the person who
booked is that campaign's Founder. A delivery that satisfies one and not the
other is recorded and routed to a person rather than guessed into place.

**A redelivery changes nothing.** The provider's event id is claimed before any
work happens, in the same table Stripe's events will use. A repeat increments a
counter, writes an audit row, and stops — one booking, one history entry, one
email, however many times it arrives.

**Each of the four emails is deduplicated at its own granularity.** A
confirmation and a cancellation happen once per booking. A reschedule happens as
often as the Founder moves it, and a reminder belongs to a particular scheduled
time — so both are keyed on the booking *and* the time. Keying a reschedule on
the booking alone would send the first move and silently swallow every one
after it.

**The emails say what actually happened to the money.** Cancelling before the
listing fee is paid gives the US$2 back; cancelling after it does not change what
was paid. The sentence is composed against the campaign's real state rather than
written into the template, because a template that assumed either would be wrong
for half of its readers.

**The booking form is an iframe, not a script in our page.** That page holds the
Founder's session and their unreleased product information, and a third-party
script in it can read both. The live-chat widget on the public pages does inject
a script; those pages hold neither.

Booking is switched off until an operator states the interview providers, hours,
interviewers, and reminder lead time — Spec §6 names all four and fixes none —
and until a scheduling account exists. Until then no booking control renders at
all, the reminder job sends nothing and says so in the log, and the webhook
accepts nothing. Every other optional item still counts toward the fee.

## Stripe foundations

This is the plumbing every payment phase runs through — built and proved on its
own before any money ran over it, and right about four things before anything
was built on top.

**The API version is locked by the operator, not by the package.** Inheriting
whatever version the SDK happened to ship would mean a routine dependency update
silently changing the shape of every object the ledger reads. The app refuses to
start without an explicit dated version.

**Two webhook endpoints, two signing secrets, and they may not be the same.**
One is for Proovd's own money — the listing fee, where Proovd is the seller. The
other is for campaign money, where the Founder is. A single secret shared
between them would let either endpoint accept the other's events, and the
separation between those two streams would stop being enforced by anything. The
app refuses to boot if the two match.

It is also honest about what it cannot check. A test signing secret and a live
one look identical, so no startup check can prove which mode a secret belongs
to — what proves it is signature verification at the endpoint, which fails
closed. A check that claimed otherwise would pass while being wrong.

**A duplicate delivery can never move anything twice.** The provider's event id
is claimed before any work happens; a redelivery increments a counter, records
an audit row, and stops. When a handler fails partway the claim deliberately
stays — the event is visibly unfinished and the retry is visibly a retry, rather
than a fresh delivery that could repeat half-completed work.

**Nothing is stored that Proovd should not hold.** Stripe collects identity
documents during onboarding; Proovd stores statuses, requirement names, and
references. There is no column that could hold a document, the requirement lists
are filtered to names and constrained to arrays at the database, and no raw
provider payload is kept anywhere.

**An account's state is one of four words, and a refusal outranks everything.**
Stripe reports an account as booleans, four requirement lists, and a disabled
reason. A Founder needs to know one thing: complete, more information required,
under review, or restricted. Every Stripe reason is mapped by name, and one that
has never been seen resolves to restricted — the safe direction, because a
restricted account must not be offered a way to pay.

What "complete" means depends on the role. A Founder account is the seller for
its campaign and needs to be able to take charges; a Creator account only ever
receives, and needs to be able to be paid out. One shared definition would
either block Creators on a capability they never use or pass Founders who cannot
sell.

## Getting paid

Founders sell through a Stripe account in their own name; Creators are paid into
one. Proovd issues a link and reads a status, and that is the entire
integration.

**Proovd never collects the details and could not store them.** Stripe takes the
identity, tax, and bank information through its own onboarding. There is no route
here that accepts one of those fields, no input on the surface, and no column
that could hold one — the absence is the enforcement, not a policy someone has to
remember. A test posts a bank account number at five plausible addresses and
asserts none of it lands anywhere.

**Coming back from Stripe always lands on one of four plain statuses.** Finished;
more information needed, naming exactly what and offering a way to carry on;
under review, saying who owns it and when to expect news; or stopped, with a
route to a person and no invitation to try again. Never a spinner, never a raw
list of requirement codes.

The state is re-read from Stripe on the way back rather than taken from the last
webhook — someone who finishes and lands back within the second would otherwise
be shown the state from before they started. And landing back does not mean
success: Stripe returns people who abandoned halfway just as it returns people
who finished.

**A stopped account is offered support, not another attempt.** It also cannot
reach payment. Sending someone through onboarding that will fail the same way is
worse than telling them plainly, and showing a stopped account a way to pay is
the specific failure the rule exists to prevent.

**Onboarding is reused, never repeated.** The account belongs to the person, not
to a campaign, so a Creator recruited to a second campaign is already done. It
also keeps payouts on one account rather than splitting them across several that
Stripe treats as unrelated people.

**What incomplete onboarding blocks, and what it does not.** A Creator whose
setup is unfinished cannot activate a tracking link or receive payment — but
campaign review carries on. Blocking the review too would stall a Founder over
something a different person has not done yet.

**Before any Creator is paid, someone has to have written down who is
responsible for tax.** Not a checkbox: seven recorded facts — the payer, who
files the 1099, which form and what data is required, the threshold, how
corrections are handled, and who reconciles — with a named approver and a
reference to where the approval lives. Until that record exists, Creator payment
is blocked, and it is blocked separately for test and live. The record holds who
is *responsible* for tax data and never the data itself; a value shaped like a
taxpayer identification number is refused by the database.

That gate is built now rather than in the phase that first pays a Creator. A
gate written in the phase it is meant to stop is a gate written under deadline by
someone who wants it open.

## Paying the listing fee

The first real money in the product, and the only place Proovd is the merchant
of record rather than the Founder. A Founder pays a one-off fee to list their
campaign, and that single successful payment does seven things at once.

**The total is agreed before it is charged.** Spec Appendix A.5 fixes the
consent word for word, and it names an exact total — which means the sales tax
has to be known before the Founder agrees to anything, not worked out afterwards
at the payment page. So the surface asks for a billing address, the server
calculates the tax and stores that calculation, and the Checkout session charges
exactly the number the consent showed. If the tax cannot be calculated there is
no consent to show and no way to pay: a total nobody was shown must never be
charged, and a zero caused by missing configuration is not evidence that no tax
is due.

**The consent is rendered, never rewritten.** It lives as one constant compared
against the Spec's own appendix by a test, beside the sentences Spec §7 and §8
fix for the two invitations. Only the two amounts are substituted, and the
resolver refuses anything that is not a formatted amount — a consent with a
bracket left in it records agreement to nothing.

**Seven effects, one transaction.** A successful payment stores the money and
its itemisation, locks the fee calculation and the evidence behind it, moves the
campaign on, opens the formal opportunity for every eligible Creator, starts a
72-hour deadline and a 48-hour cancellation window, begins campaign building,
and sends the receipt and the Creator notices. All of it or none of it: the
worst possible outcome here is a partial application, because a clock that
started beside a lock that did not looks fine until the fee changes under
someone.

**The lock is total.** After payment, nothing recalculates — not the completed
items, not the discounts, not the high-effort classification, and not the amount.
Cancelling the interview afterwards does not claw back its saving, because the
Founder was charged against a record and that record no longer moves. Editing
the campaign is still allowed; it just changes nothing about what was paid.

**The clocks are stored, not recomputed.** Both deadlines are written down at
payment along with the window lengths that produced them, and a database
constraint ties each one to the moment of payment. Changing the configured
window later moves future deadlines and never a promise already made. A
background sweep notices each deadline exactly once.

**The refund is the whole charge, once.** Spec §13 promises the entire Checkout
amount back — the fee plus its sales tax — under three conditions, and every one
of them goes through a single refund path built here so the later phases that
trigger it call it rather than writing a second one. "Once" is a unique index,
"never partial" is a database trigger comparing the refund against the payment,
and a retried refund is the same refund at Stripe. The record is written before
the provider is called, so a failure halfway leaves something visible and
retryable rather than money that moved with no trace of it.

**Cancelling has two paths and the code takes the one the rule takes.** Inside
the stored 48-hour window and before the campaign is live, a Founder cancels and
gets everything back including tax, automatically. After that, or once live, it
becomes a request a person decides — with no automatic refund, said plainly on
the surface rather than discovered later.

**A Creator whose access was withdrawn does not get it back by someone else
paying.** The payment opens the formal opportunity for Creators who are prepared
and whose Campaign kit access is intact. One that an Admin consciously revoked
is skipped, recorded, and left to a person. And listing money never mixes with
campaign money: the tables that hold it have no column that could reference a
pre-order or a Founder's connected account, and the webhook that applies it is
reachable only from Proovd's own endpoint.

**Never a promised settlement date.** Refund messages say the bank typically
takes 5–10 business days and that an exact date cannot be promised, because that
timing genuinely is not ours to promise.

## Retention

Unclaimed draft content is irreversibly anonymised 30 calendar days after the
**most recent send** (Spec §25.8, §33.1.3) by a pg-boss job on the same Postgres.
That covers the vetting answers, the half-filled account details, and the
before/after values in the provenance history — that history holds a verbatim
copy of every version of every answer, and emptying the source while leaving it
behind would be a retention policy with a hole in it.
Resending restarts the clock, which is why `campaign_invitation_sends` is
append-only and `UPDATE` on `sent_at` is revoked from the application role: a
retention clock a later statement could move is not a retention policy.

The rows survive; their content does not. What remains is the minimum audit
evidence Spec §25.8 asks for — that an invitation existed, when it was sent and
by whom, that nobody claimed it, and when it was anonymised. Deleting the rows
outright would leave the insert-only audit trail pointing at nothing, which is
not a stronger privacy position, just an unauditable one.

Revocation and anonymisation happen in one transaction. A revoked token beside
live draft content is not compliance, and a crash between the two would leave
that state permanently. Database triggers refuse to clear `anonymised_at` or
write content back afterwards.

## Setup

Requires Node >= 20, a Postgres 16+ for integration tests, and the Stripe CLI
for local webhook forwarding.

```bash
npm install
cp .env.example .env        # fill in real values; never commit .env
npm run dev:backend
npm run dev:frontend
```

`backend/src/env.ts` is Zod-validated and **fails closed** on any live/test key
or mode mismatch — a `sk_live_` key with `STRIPE_MODE=test` exits non-zero at
boot, by design. It also refuses to boot without `BETTER_AUTH_SECRET` or
`ADMIN_REAUTH_WINDOW_SECONDS`, and rejects a half-configured Google OAuth or a
half-configured storage bucket rather than failing later at the redirect or
mid-upload.

The four `R2_*` values are all-or-nothing and optional to boot. With none of
them set, uploads refuse loudly and the campaign workspace says so; with three
of them set, the app exits rather than issuing signed URLs a bucket will
reject. The three `CALCOM_*` values behave the same way: none of them means no
booking embed and a webhook that accepts nothing, and two of them means the app
does not start.

`STRIPE_TAX_ENABLED` gates the listing payment for the same reason. The consent
a Founder signs names an exact total including sales tax, so with tax switched
off there is no exact total to show and the payment surface says so instead of
offering a way to pay. A zero tax line produced by missing configuration is not
evidence that no tax is due (Spec §31.7), so it is never rendered as one.

`ADMIN_REAUTH_WINDOW_SECONDS` deliberately has no default. Spec §6 names the
Admin reauthentication window as a setting and fixes no value, so the operator
states it — the code does not invent one.

From Phase 06 that variable is the **first-boot seed**, not the running value.
An Admin cannot reach the settings surface before the app is running and
guarded, so the app writes it into the `admin_reauth_window_seconds` setting
while that setting is still empty, and ignores it from then on. Changing the
variable later does not change the window, and a restart cannot silently reset
a window an Admin has chosen. `requireFreshSession` reads the setting per
request and refuses — with a 503 naming the settings page — while it is unset.

## Commands

| Command | Does |
| --- | --- |
| `npm test` | Vitest across all workspaces |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | `tsc --noEmit` across shared, backend, frontend |
| `npm run build` | Build shared, then backend, then frontend |

Run a single test with Vitest's filter: `npx vitest run -t "<name>"`. Run one
workspace with `npx vitest run --project shared`.

The backend integration suites need a real Postgres. Set `TEST_DATABASE_URL` to
use an existing one, or leave it unset and Testcontainers starts
`postgres:16-alpine` (needs Docker). Migrations run `CREATE ROLE proovd_app`, so
the connecting role needs `CREATEROLE` or superuser, and `CREATE DATABASE` —
each test file that starts the app harness provisions its own database and drops
it afterwards, so one file's rows are never another file's surprise.

With neither Docker nor a spare server, a throwaway cluster does the job:

```bash
initdb -D /tmp/pgdata -U postgres --auth=trust
pg_ctl -D /tmp/pgdata -o "-p 55432" -l /tmp/pg.log start
createdb -h 127.0.0.1 -p 55432 -U postgres proovd_test
TEST_DATABASE_URL=postgres://postgres:x@127.0.0.1:55432/proovd_test npm test
pg_ctl -D /tmp/pgdata stop
```

The frontend and shared suites need neither Docker nor a database.

## Conventions that are not negotiable

- **Money is integer cents in `bigint`.** Never floats, never `NUMERIC`
  arithmetic in application code.
- **Stripe runs in test mode.** Live mode is gated by Spec §34 and is not open.
  No public surface may claim Stripe production approval before it exists
  (Spec §2.1). The homepage trust strip ships Appendix A.1 verbatim with
  exactly one sentence replaced by truthful conditional wording; that
  substitution lives in
  [frontend/src/features/public/trust-strip.ts](frontend/src/features/public/trust-strip.ts)
  and is reversed only when underwriting closes.
- **Sample campaigns collect nothing.** No form, no input, no iframe, no
  provider script — "disabled" is not the same as absent, and Spec §34 gates
  live mode on proving it.
- **Live chat renders only inside staffed hours**, and outside them not at all.
  Spec §31.4 names the hours as a setting and fixes no number, so
  `VITE_SUPPORT_CHAT_*` has no default and an unconfigured deployment shows no
  chat. The real commitment is the one-business-day email SLA in the footer.
- **`proovd.css` only** on the frontend — no Tailwind, no CSS-in-JS, no hex
  literals. GSAP is the only motion runtime, vendored under
  `frontend/public/vendor/gsap/`, never installed from npm.
- **Audit tables are insert-only.** `UPDATE` and `DELETE` are revoked from the
  application role at the database level. So are the settings-change history
  and the recorded production prerequisites.
- **Operating constants come from configuration, never from code.** Spec §6
  names roughly thirty of them; all of them are settings, and a later phase that
  needs 72 hours reads the setting. A hardcoded duration is a bug even when the
  number is right.
- **An unconfigured email provider refuses loudly.** The fallback transport
  throws; it does not silently succeed. Spec §1.4 forbids implying automation
  that does not exist, and an Admin must never see an invitation reported as
  sent when nothing left the building.
- **So does an unconfigured scheduling provider.** No booking embed renders, the
  reminder job sends nothing and records that it did, and the webhook accepts
  nothing at all — "no secret configured" and "wrong signature" are the same
  answer.
- **So does unconfigured object storage.** Same decision, same reason: a no-op
  would let a Founder see "visual uploaded", earn a US$2 saving for it, and find
  out at the campaign page. With no bucket configured the workspace renders no
  upload control at all, and the app refuses to boot on a half-configured one.
- **No file ever reaches the application server.** The browser uploads to a
  signed URL scoped to one object, and the server reads the object back to
  decide what it is. There is no upload route, no multipart parser, and nothing
  written to the container's disk (tech stack §9).
- **An item completes on evidence or it does not complete.** Spec §12's discount
  rules are decided server-side from stored content, on every change. Nothing a
  Founder can send sets a completion, and an Admin who grants one without
  evidence is recorded as having done exactly that.
- **Money is calculated once, on the server.** The listing fee is read from the
  Spec §6 settings and rendered by the browser. A second implementation in a
  component is how a preview and a charge diverge.
- **Exact customer copy is a constant compared against the Spec.** Appendix
  A.5's listing-fee consent, Appendix A.1's trust strip, and the Spec §27.8
  contact block are each pinned by a test that reads the specification itself.
  Only named variables are substituted, and a resolver refuses a value that
  would leave a bracket in the rendered text.
- **A deadline is stored with the window that produced it.** Both listing clocks
  are written at payment and tied to it by a database constraint, so changing a
  configured window later moves future deadlines and never one already promised
  (Spec §29.6).
- **A refund is the whole charge, once.** A unique index makes it once, a
  database trigger makes it whole, and a stable idempotency key makes a retry
  the same refund rather than a second one. Refund messages never promise a
  settlement date.
- **A third-party payload never names its own campaign.** A scheduling webhook
  is bound by a reference Proovd issued and recomputes, *and* by checking that
  the person who booked owns that campaign. A signature proves where a payload
  came from, not who filled it in.
- **Provider events are claimed before any work happens.** One table, unique on
  the provider's event id, shared by every integration. A redelivery updates
  audit and produces no second state and no second message.
- **Webhook signatures are verified on the raw bytes, before anything parses
  them.** A global JSON body parser would destroy the bytes and the failure
  would read as a provider misconfiguration. No route in this app installs one.
- **Test and live never share a row.** Every stored provider object records the
  mode it came from, mode is part of its identity, and a database trigger
  refuses to change it — because Spec §34 asks Proovd to *prove* the two never
  mixed.
- **No message ever asks for bank details, tax details, a password, or identity
  documents.** Spec §8 states it for Creators; it applies everywhere. An email
  that asks for those trains people to answer the one that isn't from us.
- **There is no public signup, for any role.** Accounts are created server-side
  by `seedAccount` in [backend/src/auth/seed.ts](backend/src/auth/seed.ts), by
  the Founder account claim, and by the Creator's signup — the last two
  reachable only with a valid invitation token. None exposes a route anyone can
  find without being invited, and a test scans the tree for a second way in.
- **Proovd never collects bank, tax, or identity-document fields.** Stripe's own
  onboarding does, and Proovd stores only statuses and provider IDs (Spec §5.3,
  §11). There is no such route, no such column, and a database constraint on the
  connected-account reference to keep it that way.
- **An internal quality tier is never a rate.** Spec §8 makes it assessment data
  and forbids it acting as a commission floor. It is stored as free text with no
  ordering, and a database constraint refuses a bare number or percentage — so
  there is nothing in the column for a later phase to sort or multiply.
- **The campaign type locks permanently and there is no migration path.** Spec
  §9 is explicit, and a database trigger enforces it rather than a service rule.
  A wrong lock is corrected by archiving and restarting, never by converting.
- **Phone numbers are collected and never verified.** No SMS OTP path exists
  anywhere in the tree, a test scans for one, and `user.phone_verified` is
  pinned false by a `CHECK` constraint.
- **Backers have no account.** They use campaign-scoped magic links through
  [backend/src/auth/token-service.ts](backend/src/auth/token-service.ts) —
  never Better Auth's magic-link plugin, which would create accounts and
  sessions the Spec forbids.
- **Every token is bound to exactly one subject.** Three scopes — a Founder's
  invited draft, a Backer's campaign magic link, and a Creator's campaign
  invitation — and a check constraint refuses any row carrying more than one.
  Scope binding is a property of the database, not a habit of the routes.
- **The preparing pre-view is logged and revocable, or it is not permitted.**
  Spec §31.5 grants it on those conditions, so the access log is insert-only,
  the read that serves the kit is the read that logs it, and revocation is
  one-way at the database level.
- **Every token failure returns one identical response.** Invalid, expired,
  revoked, claimed, malformed, rate-limited, and never-existed are
  indistinguishable to the caller; the real reason goes only to the audit log.
  Never add a reason field, and never let a rate limiter answer with a 429.
- Secrets live in the deployment environment, never in the repo, the frontend
  bundle, email, or documentation. `.env.example` documents variable *names*
  and non-secret shape only.

The full invariant list — naming, state, idempotency, time, tokens, forbidden
patterns — is in [CLAUDE.md](CLAUDE.md).
