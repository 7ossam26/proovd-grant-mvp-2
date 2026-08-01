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

Built one phase at a time against `docs/master-plan.md` §6. **Phases 00–07 are
complete and Phase 08a–08b are built**; Phase 08c (the preparing reveal and the
Campaign kit) is next.

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

Two briefs have been built in halves. Phase 06 bundles four independent
deliverables; Phase 08 bundles three — recruitment, the Creator's signup, and
the preparing reveal with its Campaign kit. Splitting them was a scheduling
decision, not a scope one: each half is built against the same brief and lands
its own named acceptance tests. Every named test from §33.1.1 to §33.1.9 passes,
and so does §33.2.1.

Still to come in Phase 08: **08c**, the preparing reveal and the Campaign kit
(§33.2.4, and the second half of §33.1.9).

## Layout

npm workspaces, one root `package.json`, one multi-stage `Dockerfile`.

```
shared/     Zod schemas, money waterfall, state machines, business-day calendar
  src/policies/   the eight canonical policy records and their versions
  src/settings/   the §6 operating-constant register
  src/vetting/    the §9 vetting sequence, its copy, and the two campaign paths
  src/affiliates/ the §5.3 subtypes and their evidence, §8's recruitment
                  record, and §2.2's active-partnership slot rule
backend/    Express 5 + Drizzle + Postgres 16
  src/auth/           Better Auth config, guards, token service, seeding
  src/policies/       the §34 policy gate
  src/settings/       reading, validating, and versioning the §6 constants
  src/admin/          the production-prerequisites panel
  src/invitations/    Founder prospects, the invitation, the retention sweep
  src/vetting/        the §9 answers and their provenance, the §10 account claim
  src/affiliates/     Creator recruitment, verification, the private
                      invitation, and the §11 compact signup
  src/notifications/  the deduplicating sender, Resend, the email templates
  src/jobs/           pg-boss, on the same Postgres
frontend/   React 19 + Vite, styled solely by proovd.css
  src/features/public/   the fourteen public routes, footer, sample campaigns
  src/features/admin/    the Admin shell, Founders, Creators, configuration,
                         prerequisites
  src/surfaces/          the unusable-link page
  src/surfaces/draft/    the Founder journey: vetting, result, account claim
  src/surfaces/creator/  the Creator's compact signup and waiting state
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
`ADMIN_REAUTH_WINDOW_SECONDS`, and rejects a half-configured Google OAuth rather
than failing later at the redirect.

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
- **Every token failure returns one identical response.** Invalid, expired,
  revoked, claimed, malformed, rate-limited, and never-existed are
  indistinguishable to the caller; the real reason goes only to the audit log.
  Never add a reason field, and never let a rate limiter answer with a 429.
- Secrets live in the deployment environment, never in the repo, the frontend
  bundle, email, or documentation. `.env.example` documents variable *names*
  and non-secret shape only.

The full invariant list — naming, state, idempotency, time, tokens, forbidden
patterns — is in [CLAUDE.md](CLAUDE.md).
