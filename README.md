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

Built one phase at a time against `docs/master-plan.md` §6. **Phases 00–24 are
complete** — every lifecycle phase, the whole notification contract, the P0
pass, and the live-mode gate itself. **All 131 named acceptance tests pass in a
single run.**

Money moves in test mode only. **The Spec §34 gate is now code rather than a
checklist**, and it is shut: ten of its eleven conditions are unsatisfied, and
eight of those wait on Track A — Stripe underwriting, legal review of the eight
policy documents, tax registration, accounts and assets, the contrast sign-off,
and two named pilot owners. None of that is a coding task. The gate is released
by satisfying it, and there is no override on any surface and nowhere to add
one.

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
| 12a | The formal Creator opportunity, the three decisions, immutable proposal versions, the bilateral lock, and the no-acceptance deadline |
| 12b | Campaign building, the six roster-readiness rules, Admin review rounds, the approved snapshot, and the general materiality machine |
| 13 | The optional fixed Creator payment as a fourth money stream, and the thirteen-item Creator-readiness checklist |
| 14a | The coordinated launch, first-post verification and its three outcomes, and the required-Creator failure with its replacement window |
| 14b | The live public campaign page, the attribution contract, discovery timing, and the outcome-specific ended state |
| 14c | Founder-authored campaign updates: the audience-by-model rule, the material-delivery-change pairing, and the public rendering |
| 14d | The Creator active-partnership dashboard — link, locked terms, readiness, first-post state, and clicks |
| 15a | The Backer pre-order: eligibility, the atomic cap, reservation-time tax, the exact consent, the SetupIntent, and the immediate Founder operational share |
| 15b | The campaign-scoped magic link, free cancellation, the practical-deduplication queue, and the pre-charge reminder |
| 16a | The reservation and charge ledger, the money controls, the risk-control inventory, and the high-impact override machine |
| 16b | Support cases against the published SLA, the handoff note, campaign suspension and kill, and the composed customer timeline |
| 17a | The Founder's live campaign home — Glance, one ranked action, Explore — with the delivery receipt behind the last-visit delta, the composed pre-order counts, and the threshold crossings that fire once each |
| 17b | Live editing's three tiers and the FAQ loophole, the Backer comment thread, mid-campaign Creators with no retroactive credit, and the Creator's named earnings states |
| 18a | The close batch, the threshold decided once from the state at exactly close, tax-usability validation, off-session capture, and the one 48-hour recovery window |
| 18b | The window's end, the update-card recovery, results with their Admin-reviewed narrative, and Admin reconciliation |
| 19a | Creator completion decisions, earnings finalization and the provisional/earned reconciliation, the one idempotent Transfer, and the thank-you that computes nothing |
| 19b | The Founder W-9 block, the Idea single payment and the Product 40%/60% schedule, and evidence-gated early release that never skips Day 14 |
| 20a | The refund cause register, the reservation-refund lifecycle, the Idea exceptions with no voluntary path, and the per-cause earnings treatments |
| 20b | Disputes and their 24-hour task, the assembled evidence packet, one statement descriptor everywhere, post-capture enforcement, and the §29 records |
| 21a | Fulfillment and its four Founder obligations, delivery-date changes and their two paths, the Day 14 Progress Check, and the one-strike ghost ban |
| 21b | Creator completion and the work-again request, Founder next-campaign readiness, the Backer's derived status and satisfaction, and campaign resolution |
| 22a | The notification coverage machine: every §27 event either sends or is recorded as deliberately unsent, and every message it can send is proved against the transactional contract |
| 22b | All 44 missing messages: the roster update decided by a real state change, the review round, the fixed Creator payment, the mid-campaign Creator, the queue notices, and the magic-link reissue that names nobody |
| 22c | The optional activity digest — the one email anyone can switch off — with the notification history that stays a record rather than becoming a dashboard |
| 23a | The P0 accessibility and content sweep: every principal flow rendered and checked, the built bundle grepped, and one pre-order compared across all seven surfaces |
| 23b | The system contract: the three anchors and every deadline they drive, the adversarial idempotency sweep, the provider test matrix with its retained evidence log, the direct-architecture proof, and the first-cohort scoreboard whose baseline is `not measured` |
| 24 | The live-mode gate as code: §34's eleven conditions with their filed evidence, the fail-closed refusal at the one gateway every money path shares, the single named pilot campaign, and the rollback that is one statement |

Several briefs have been built in halves. Phase 06 bundles four independent
deliverables; Phase 08 bundles three — recruitment, the Creator's signup, and
the preparing reveal with its Campaign kit; Phase 09 bundles the optional-item
workspace and a third-party scheduling integration; Phase 10 bundles the
payments substrate and the two onboarding surfaces built on it; Phase 12, 14,
15, 16, and 17 each bundle two or more full deliverables with their own named
tests. Splitting them was a scheduling decision, not a scope one: each half is
built against the same brief and lands its own named acceptance tests. Every
named test from §33.1.1 to §33.1.9 passes, every one from §33.2.1 to §33.2.13,
every one from §33.3.1 to §33.3.11, every one from §33.4.1 to §33.4.9, every one
from §33.5.1 to §33.5.13, **every one from §33.6.1 to §33.6.13, every one from
§33.7.1 to §33.7.12, every one from §33.8.1 to §33.8.14, every one from §33.9.1
to §33.9.13, every one from §33.10.1 to §33.10.10, every one from §33.11.1 to
§33.11.7, and every one from §33.12.1 to §33.12.7**. That is all 131.

Phase 09 split along the line between a domain record and a vendor. The booking
record went first and is the source of truth — a scheduling provider is a source
of events, not of domain state — so the four booking conditions, the reschedule
history, and the recalculation on cancellation were built and tested before any
webhook existed. That ordering is what makes a confirmed interview reachable
when a delivery is missed, rather than a thing only the vendor can grant.

Phase 16 split along a different line: between surfaces that **read and
reconcile** records that already exist, and operations that **create new records
and new customer messages**. The ledger, the money controls, and the risk
inventory are all reads over what Phases 03 through 15 already wrote; support
cases, suspension, and the timeline are not. The acceptance tests fall the same
way, which is usually the sign that a seam is real rather than convenient.

Phase 17 split on the same kind of line: between the campaign as it is
**observed** — what the Founder reads, and the counting and event substrate under
it — and the **changes people make while it runs**, which are live edits, a
Creator joining mid-campaign, and a Backer acting before close. Its brief did not
name a seam, so that half of the split was written back into the phase file
rather than left implicit; a plan that is wrong and not corrected is how a plan
rots.

Phase 22 split into thirds, and the *order* is the point. The registry holds 121
notification events and 44 of them had no sender. The audit has to exist before
anyone can know what to fill, and the contract test has to exist before forty-odd
new templates are written against it — a contract applied afterwards is a
retrofit, and a retrofit is how the one message that violates it survives. So the
first third builds the machine and records every gap with the phase that owns it,
the second writes the missing messages into a suite that already refuses a bad
one, and the third composes the optional digest and history layer on top. That is
the same ordering Phase 09 used for the booking record and Phase 10 for the
payments substrate.

Phase 23 splits on the line its own acceptance draws. §33.11 is about what a
person **sees** — the rendered surface, the rendered message, and whether seven
renderings of one pre-order agree — while §33.12 is about what the system
**does** under replay, under a clock, and under a stale session. 23a is the
first; 23b is the second, together with the provider test matrix and its
evidence log. Nothing in either half adds behaviour: §32.1's last step verifies
what is already built, and what the sweep finds is either a defect it fixes or a
gap it records with the phase that owns it.

Between them the two halves found four things. Three were defects and were fixed:
copy shipped in every browser that no source grep of `frontend/` could see, six
failure states that answered two of §27.1's six questions, and a payment-flag
trail the application role could rewrite. The fourth was a register that was
wrong about the product rather than the other way round — it would have required
renaming five of the Spec's own campaign states — and the register was corrected.
Deciding which of the two is happening is most of what this phase is for.

One item stays open and says so in its own artifact. The provider test matrix
runs against the in-memory gateway, which verifies real webhook signatures but
creates nothing at Stripe, so §34's requirement that a human reconcile provider
test results to internal ledgers still needs a run against a real test-mode
account with the CLI forwarding webhooks. `docs/evidence/stripe-test-matrix.md`
records that as an unresolved item rather than leaving it to be inferred.

Phase 24 builds almost nothing, and that is the phase. Its out-of-scope section
is one word — "Everything. If something needs building, the gate stays closed."
What it adds is the gate: a register the money path reads and refuses on, at the
one point every service in the product shares. The eleven conditions are Spec
§34's own, in §34's order, and most of them are judgements about the world
outside the process — what Stripe approved, whether the tax registrations exist,
whether two people know they are on the hook. Those are recorded with a named
verifier and evidence, and no code path can satisfy one by inference.

## After the phases

Work since Phase 24 is not numbered. Each piece is built from a supplied
reference plus the decisions that reference cannot make for itself, and each is
recorded in [CLAUDE.md](CLAUDE.md) with its date. The Admin panel's five
workspaces, its floating task list, and the public campaign page came that way;
the current one is the Founder's own onboarding.

**The campaign page was rebuilt in three sessions, all of which have landed.** Spec §18 defines that page's *content* and hands presentation to the
DNA document by name — "the DNA UX document controls presentation" — so a
redesign is licensed and dropping one of its fourteen items is not. The
reference drops four; they are placed rather than lost.

The first session writes no public surface at all. It is the record: the columns
and two small tables the designed page needs, the §20 live-editing tier for
every one of them, and the authoring routes behind them. Three things it found
are worth naming, because each had been true for a while and invisible:

- **A build column wired everywhere except one list is a column no Founder can
  write.** There is no schema validation on a build patch anywhere — the
  assignment list inside the save function is the entire allowlist — so a new
  field has to be added in five places, and the test drives a save and a read
  and compares every value rather than trusting that it was.
- **An Idea campaign could not be finished through the product.** Twelve of the
  twenty-four build columns had no input on the Founder's own surface, four of
  them required, so the page listed them under "still needed" with nowhere to
  type them. No route or migration was missing; the whole gap was markup.
- **Two numbers on the public page were hardcoded `null`.** The threshold
  progress bar carried a comment saying it needed reservation counts from a
  later phase. That phase shipped and the null stayed, so no real Idea campaign
  has ever drawn the bar — on the largest section of the page being rebuilt.

One rule was applied wider than it was written. Spec §20 stops an FAQ answer
from quietly moving a delivery date, and it names the FAQ *by example*. This
session added ten more directly-publishable text fields, and a section heading
reading "Shipping in March 2027" moves a date exactly as an FAQ answer would —
so the check now runs on all of them, and the three fields it does not run on
are listed with the property that makes each one structurally unable to carry a
promise. The default is that a new field is checked.

The second session builds the page itself, and adds no column, no route, and no
register entry — every deliverable is markup, CSS, motion, or a test. The band
order becomes the reference's; the item list stays §18's. The four items the
reference does not draw at all are placed rather than lost, and three of
them — who is selling this, the refund summary, and the merchant-of-record
disclosure — become one band sitting immediately before the reward cards,
because §18 requires that disclosure above the pre-order action and that band
is the last thing a reader passes before any control that can open checkout.

The page's own acceptance test was split in two, deliberately. One checks the
band order, which is a design decision and may change again. The other checks
that all fourteen of §18's items are present and in document order, which may
not. The old single test would have passed a page that had quietly dropped an
item into a footer.

A browser pass at 1280 and 320 found three defects, none of which a headless
DOM or an accessibility scanner can see. This is the fourth rebuild in a row
where that has been true:

- **The threshold bar rendered completely full at 168 of 250.** The scroll
  reveal animated the fill from zero to "whatever the element currently reads",
  and it read the untouched default rather than the real value. The helper now
  takes the value as a required argument, so the number the bar draws and the
  number it announces to a screen reader come from one expression.
- **The sticky campaign header had no background**, so everything below scrolled
  through it.
- **An accordion heading has been near-black on dark green since the design
  system was written**, because it reads a hardcoded colour and has no dark-mode
  slot. That includes the page's own "How this works" disclosure, which has
  shipped that way since the campaign page first went live. Fixed at the slot,
  so every dark band in the product gets it.

Chrome's headless window has a minimum width of about 500px, so the first 320px
screenshot was really the left third of a 489px render and read as an overflow
that was not there. Rendering the page inside a 320px iframe gives a true
viewport; at that width every band stacks and nothing scrolls sideways.

The last session is the checkout modal and the follow record.

The modal is a restyle and nothing more. The dialog was already a real dialog —
portal, overlay, focus trap, Escape, backdrop dismiss — and its three steps
already matched the reference's shell, so what changed is a progress rail, a
summary card, and a done-state icon. It did not gain a card field: the
reference has one because it has no backend, and Spec §34 gates live mode on
sample pages mounting no payment field at all. One thing the reference draws
was left out rather than faked — a "founding user #248" line, because that
number is minted when a Backer first comments, not when they pre-order, and
inventing one would be a fabricated position in a queue.

**The follow record is a deliberate exception to the rule this codebase runs
on.** Spec §1 rule 6 says invent no new commercial capability, and capturing an
email from somebody who has not pre-ordered — then mailing them — is exactly
that. It is built by explicit product direction and recorded as a deviation, so
a later session does not delete it as a mistake or read it as permission for
more. What keeps it narrow is asserted by tests rather than intended:

- One message, and it is a receipt. The recurring mail is the summary the
  product already had; following adds no second message, no welcome, and no
  re-engagement.
- Double opt-in, and the confirm and unsubscribe links act on a click rather
  than on being fetched — an email scanner prefetching a one-click link would
  otherwise complete a consent, or cancel one, on somebody's behalf.
- The public form is the same kind of non-answering route the "send my link
  again" ask already was: one frozen reply for a hit, a miss, a bad address, an
  unknown campaign, and a caller over the rate limit, because a route that
  answers differently tells anyone who asks which addresses are interested in
  which campaign.
- A follower sees only what the public sees. Updates written for people who
  actually pre-ordered never reach them — a disclosure rule, not a mail bug, so
  the code branches on being a follower rather than on the delivery channel
  they share with real Backers.
- Nothing chases anybody. There is no column anywhere to record when to send a
  follow-up, no job that reads the table except the one that deletes from it,
  and no public follower count. The absences are checked, because the strongest
  form of a promise not to chase somebody is having nowhere to write down when.
- Retention is the window the Spec already fixes for marketing consent — until
  unsubscribe, plus two years — and the erasure is irreversible at the database
  rather than by a service being careful.

One open question was answered in writing instead of by editing a test. A
marketing send conventionally carries an unsubscribe header, and a test forbids
adding one because it would attach to every message the product sends,
including receipts and deadlines that nobody may opt out of. The header does
not ship; the summary already carries its own unsubscribe as its single action.
If deliverability later requires it, it attaches to the non-transactional
messages alone, as its own decision with its own test.

### The Founder's onboarding, being rebuilt

The path a Founder walks from opening a pre-filled invitation to a live
campaign becomes twenty-six full-screen steps with no app chrome. It is six
sessions; the first four have landed. The walk that scopes the rest is
[docs/phases/founder-reconciliation](docs/phases/founder-flow-reconciliation.md),
and the brief is [docs/phases/founder-flow-v2.md](docs/phases/founder-flow-v2.md).

**The first session writes no screen. It is the record — and four of its five
changes are the Spec being restored rather than departed from.** In August a
product decision had simplified the vetting flow: the Founder stopped choosing
their own campaign path, the positioning question was dropped and replaced with
one about audience size, and the relevance signal stopped being a screen. That
was recorded at the time as a deliberate deviation, not a defect. The same kind
of decision has now withdrawn it, so all four go back to what Spec §9 and §10
describe. The audience-size question retires from being *asked* only — the
answers people already gave are still theirs, still stored, and still shown to
Admin, and a campaign onboarded after the change says the question was never
asked rather than showing a blank.

One of those returns cost more than a register change, and the reason is worth
recording. While the Founder had no campaign-path screen, a saved position on
that step was mapped to the first question — correct at the time. With the
screen back, that mapping silently resumes a Founder one step past where they
stopped, so where a Founder can *be* is now a different list from what they
*answer*.

**The order the reference draws is wrong in three places, and code that already
exists refuses each one.** The five bonus answers upload files and book a call,
which needs an account; the reference asks for them before the account exists.
The listing-fee screen is drawn before payout setup, but the fee cannot be paid
until payout setup is complete, so as drawn it offers a payment the server
declines. And the relevance signal is drawn late, where the Spec puts it before
the account. All three moved, and each move is written down as a move so a
later reader can see it was decided rather than missed.

**Walking the prototype rather than reading it found three things the brief had
not.** The most serious: the order-threshold screen collects a dollar amount
with a $500 minimum, and an Idea campaign's threshold is a *number of Backers*,
not money — with no minimum the product has ever agreed to. The other two are a
third place the internal word for Creators reaches a Founder, and a second
"in review" screen that approves a person rather than a campaign.

**One genuinely new record was added, and it is a deliberate exception.** The
reference asks the Founder, during onboarding, whether they would fund an
optional fixed payment to a Creator. Under the Spec that payment is the
Creator's to request and both sides accept one version of it, so an answer given
before any Creator exists has no place in that negotiation. It is built by
explicit product direction and it binds nothing — enforced by what the table
cannot hold: no amount, no percentage, and no reference to a proposal. It also
cannot exist at all for an Idea campaign, which the Spec forbids the payment on,
and the database refuses it two independent ways.

**The second session is the shell and the first four screens**, and it adds no
column, no server route and no migration — it is a surface, a register, a
stylesheet section and a suite. Each page is its own web address, so a Founder
who closes the tab on step three comes back to step three, and the help panel
lists the page they are on and every page behind it with a line saying what each
one is for. It does not list the pages ahead: a panel that did would be a
progress bar with reading attached, offering to jump to addresses that refuse.

Two of the reference's own touches were changed rather than copied. It shows one
campaign type at a time between arrows; both now render at once, because the
Spec requires the choice explained before it is made and behind an arrow half
that explanation belongs to somebody who never pressed it. And it hides the
`Next` button while a Founder is editing; a primary action that disappears
inside a twenty-six step sequence is a trap on a phone, so the panel still grows
and the button stays.

**Walking it in a real browser found four defects nothing else could — the fifth
rebuild in a row where that is true.** A stray `*/` inside a stylesheet comment
closed the comment early and silently deleted the whole new token block, so
every page rendered at browser-default type. A label on the dark panel was
styled through a class name that does not exist, rendering dark green on dark
green while the automated accessibility check saw a perfectly correct label. A
decorative shape had no size. And the palette's lightest grey, which is meant
for placeholder text, was carrying a permanence warning and a legal line at
about half the contrast those need.

**The third session finishes everything reachable on the invitation link** — the
address, a six-digit confirmation code, the last of the three questions, and the
relevance signal — and it carries two of the rebuild's three deliberate
exceptions.

The code is the larger of them. Nothing in this product had a one-time code
before, and the important thing about this one is what it does not do: it
confirms that an address can be reached, and it creates no account. The account
still happens where the Spec puts it, one screen later, with its own agreements
chosen one at a time. Six digits is only a secret if two things hold — every
wrong answer looks identical to every other kind of wrong answer, and there is a
limit on guesses — so the tests compare whole responses rather than fields, and
they exhaust the guess counter and then try the *right* code to prove it is
finished. A code is stored as a keyed digest of the draft, the address and the
digits together, not a plain hash: six digits have only a million possible
values, so a plain hash would eventually collide two live codes and would itself
be a lookup table back to the code. Binding the address in has a second effect
worth having — change your address and the code you were sent stops working,
which is right, because the thing being verified is the address.

Asking for a code answers the same sentence whatever happened, including when
you have asked too many times, and it answers *before* it does the work: a hit
sends mail and a miss returns immediately, and that difference is measurable even
when the words match.

The other exception is dictation on the two open-ended questions. It transcribes
and does nothing else — there is no summarize, rewrite or suggest control, and
the recording is not kept, because none of the retention rules covers one and
inventing a rule would be the same overreach in the other direction. What lands
in the box is the Founder's own words, saved exactly as typing them would be.
The provider is unconfigured here, so the screen says so where the microphone
would be rather than offering a button that refuses.

**The reference asks two of its questions twice, and the second asking was not
built.** There is one stored answer for each, so collecting either in two places
would eventually produce two versions of it. What the positioning screen does
instead is name any earlier answer that is still empty and link back to the page
that owns it. Two more of the reference's own touches were refused: a line
claiming Creators are "ready to promote this" — nobody has agreed to anything at
that point — and a breakdown of them by category, which no record holds. And its
email headline says confirming an address is what saves your progress, which is
not what saves your progress: the link in the invitation is, and everything has
been saving as you type since the second screen.

**Walking it in a browser again found four defects, the sixth rebuild in a row.**
A spacing value that does not exist in the scale, so the rule was dropped and a
whole screen's gaps collapsed to nothing. A floating help badge sitting on top of
the primary button on a short laptop window. Placeholder-grey carrying a real
instruction — and the first fix for that was itself a bug, styling the dark
panel's hint dark-green-on-dark-green, which is the same class of thing the
previous session found. And a background colour naming a token this stylesheet
has never defined, which has left one Admin surface's file rows with no
background since the day they shipped.

Two of those were the stylesheet being silently invalid rather than wrong, which
has now happened twice, so two checks run on every commit: every comment opens
and closes exactly once, and every colour or spacing value names something the
file actually defines. Values a component deliberately supplies itself are
exempt, and both checks read the file with comments removed — the first version
failed on its own explanation.

**The fourth session is the account, and the five optional answers behind it.**
It is the boundary the whole flow turns on: everything before it is an
invitation link and everything after it is a signed-in Founder, because a
successful claim deliberately uses that link up. So a page now says which of the
two it is addressed by, and the help panel from a later page still shows the
earlier ones with their explanations but stops offering to jump to them — the
address they need no longer exists, and a panel offering it would send somebody
to a dead-link page from their own help.

The account transaction itself was not touched. What was needed after it was a
way to carry on: the Spec's claim creates an account and mentions no session, so
somebody has to sign in. Rather than add a second way of minting a session to
the most carefully guarded transaction in the product, the screen signs in the
ordinary way — with the password the person just chose, through the same route
anyone else uses. If that fails the account still exists, and the screen says so
rather than implying the claim was lost.

It still cannot complete, and that is correct. The eight legal documents are
drafts, an acceptance may only cite a published one, and so the account cannot
be created yet — the screen renders the reason where the button would be.

Date of birth is a typed field with a calendar underneath it rather than a
calendar with a field: typing is what a password manager fills and what a screen
reader handles, and the calendar is for people who would rather point. The 18+
check beside it is a courtesy over something the Founder states themselves —
Proovd derives no age and never claims to have verified one — so nothing refuses
on a number the browser worked out.

**Whether a bonus answer counts is decided by the server, from what was actually
provided, and the screens say so where somebody would look for the checkbox that
is not there.** There is no control that marks one done and no field that
carries one; the tests post four plausible spellings of "complete" at the route
and count five answers still incomplete. The saving each one earns is read from
the setting that defines it rather than written into the page — the prototype
hardcodes the three fee numbers, and all three are configuration.

Last look is the eight answers in one place with what the listing fee comes to.
The five optional ones open; the three from the earlier questions do not, and
that is not a policy — those are locked when the answers are submitted, and the
route that wrote them is behind the link the account claim just used up. Opening
one of the five from here brings you back here rather than continuing forward,
and that promise is kept in the web address, so it survives a reload in the
middle of an edit.

Two of the reference's own elements were refused for reasons worth stating. Its
interview screen draws its own meeting-platform tiles and time slots; the
booking calendar is the source of truth for what was booked, and a second picker
is a second calendar that will eventually disagree with it. And its brand screen
draws a draggable colour square with no keyboard equivalent, on the one screen
where the alternative — typing a hex code — is free.

**Walking it in a browser found two more defects, the seventh rebuild in a row.**
A small status chip stretched into a full-width bar, because an inline element
inside a vertical stack is stretched to the container by default; the automated
check reads a perfectly correct chip either way. And the rule that says what
makes an answer count is written as the finished state — "Your booking is
confirmed." — which is right as a rule and reads as a claim that it already
happened when it sits under the question on the one screen where nothing is
booked. Both now carry a label saying it is a condition.


Three parts of the flow cannot be completed in the current environment, and none
of them is stubbed: the eight policy documents are still in legal review so the
account step refuses in the open and says why, and file storage and the
scheduling provider are both unconfigured so the upload and interview steps
render a named absence rather than a dead control.

## Layout

npm workspaces, one root `package.json`, one multi-stage `Dockerfile`.

```
shared/     Zod schemas, money waterfall, state machines, business-day calendar
  src/policies/   the eight canonical policy records and their versions
  src/settings/   the §6 operating-constant register
  src/vetting/    the §9 vetting sequence, its copy, the two campaign paths,
                  the onboarding flow's page register, the eight-answer
                  sequence over §9's and §12's two registers, and the
                  email code
  src/affiliates/ the §5.3 subtypes and their evidence, §8's recruitment
                  record, and §2.2's active-partnership slot rule
  src/workspace/  the §12 optional items, what does not count as evidence for
                  each, the copy-ready helper resources, and the interview
                  statuses
  src/checkout/   the Appendix A.5 listing-fee consent and the A.3/A.4 pre-order
                  consents, verbatim, and the resolvers that fill in their
                  amounts
  src/build/      the §14.4 build ingredients and the six roster-readiness rules
  src/launch/     the launch step order and the first-post verification checks
  src/attribution/ the click outcomes, the four attribution statuses, and the
                  Day 8 discovery window
  src/admin/      the eleven ledger dimensions, what may leave in an export,
                  the nine money-control lines, the money-status vocabulary,
                  the ten risk signals, and the overridable-field register
  src/support/    the support topics and owners, the published SLA numbers, the
                  Appendix B.8 acknowledgement, the four handoff facts, the
                  eight suspend/kill reason categories, and the timeline sources
  src/live/       the five ranked next actions, the exact Glance and caught-up
                  copy, the eleven Explore sections and their definitions, the
                  four milestones, the count and threshold derivations, the
                  three live-editing tiers, the comment rules, and the seven
                  Creator earnings states with Appendix B.7
  src/notifications/ the ~120 transactional events, the transactional-email
                  rules, the money facts as four message classes with their
                  detectors, the naming contract as a scanner, and the optional
                  digest: its preference vocabulary, the three eligible activity
                  kinds, the window kernels, and what it must never become
  src/qa/         the P0 pass as registers: every principal flow and the five
                  §28.5 keyboard paths, the CTA rule, the placeholder patterns,
                  the six-question detectors, what a bundle scan can decide, the
                  seven surfaces and eight facts §33.11.5 compares — and, for the
                  system half, every deadline with the instant it is anchored on,
                  the lifecycle/payment-flag separation, what makes an Admin
                  action sensitive, the state-changing paths with their
                  mechanisms, and the provider test outcomes and evidence fields
  src/measurement/ the four first-cohort metrics, the gate that keeps them
                  `not measured` until ten Founders, the three facts no metric
                  may exclude, and the tables an analytics warehouse arrives as
  src/live-mode/  the §34 gate: the eleven conditions with how each is decided
                  and the Track A item behind it, §34's two lists as a partition
                  over every gateway operation, the money entry points and which
                  are deliberately ungated, Appendix C's four statements as
                  walks, and the five facts a rollback plan must state
backend/    Express 5 + Drizzle + Postgres 16
  src/auth/           Better Auth config, guards, token service, seeding
  src/policies/       the §34 policy gate
  src/settings/       reading, validating, and versioning the §6 constants
  src/admin/          the production-prerequisites panel, the reservation and
                      charge ledger, the money controls, the risk inventory,
                      and the high-impact preview/override machine
  src/measurement/    the first-cohort scoreboard — a read across seven existing
                      tables that owns none of them and writes nothing
  src/live-mode/      the §34 gate read (fail-closed four ways, never cached),
                      the filed condition answers, the one named pilot
                      enablement and its rollback, and the decorator that
                      refuses live money at the single Stripe chokepoint
  src/reservations/   the Backer pre-order, the atomic cap, reservation-time
                      tax, cancellation, deduplication, and the magic link
  src/live/           the Founder campaign home: the delivery receipt behind the
                      last-visit delta, the composed pre-order counts, the ranked
                      next action and its corrections, Explore, and the threshold
                      crossings and milestones
  src/campaign/       campaign building and review, materiality, updates, the
                      public page, and live editing's one tiered door plus the
                      comment thread
  src/invitations/    Founder prospects, the invitation, the retention sweep
  src/vetting/        the §9 answers and their provenance, the §10 account claim,
                      and the six-digit email code
  src/transcription/  the dictation port — transcribes, stores nothing
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
  src/notifications/  the deduplicating sender, Resend, the email templates, the
                      register of events that deliberately do not send, the
                      render catalog behind the coverage test, the preview with
                      its transactional-contract report, and the optional
                      digest: the preference, the composer that reads activity
                      rather than deliveries, and the history read
  src/jobs/           pg-boss, on the same Postgres
frontend/   React 19 + Vite, styled solely by proovd.css
  src/features/public/   the fourteen public routes, footer, sample campaigns
  src/features/admin/    the Admin shell and its workspaces, each built from a
                         supplied reference after Phase 24: Founders (rebuilt
                         2026-08-16/17 — the six-card directory with its two
                         action columns, the eight-section person record with
                         Onboarding's four tabs, the five-step Create Founder
                         compose, the Edit Founder sheet, and the six
                         read-and-route sections from Campaign through
                         History's Timeline/Communications split),
                         Creators (rebuilt to a second reference 2026-08-17,
                         complete in three sessions — the one-route eight-tab
                         record shell with the Selected-relationship switcher
                         and migration 0048's six record families, the two
                         person-level tabs with the evidence uploader, the
                         per-metric trail and the live Stripe re-read, and the
                         four campaign-scoped tabs plus History: deliverables
                         and availability checked against the AGREED term,
                         the payout reminder that sends an existing message,
                         case intake through the one queue, and the seven
                         refused controls as a register; the walk is
                         docs/phases/admin-affiliate-reconciliation.md),
                         Campaigns, Support, Backers, and the
                         floating Tasks panel; Today is the one parked section
  src/surfaces/          the unusable-link page
  src/surfaces/draft/    what is left of the old draft journey: the client the
                         onboarding pages call
  src/surfaces/founder-flow/ the onboarding flow itself — the full-bleed page
                         shell and its help drawer, the invite, the three
                         questions, the campaign type, the address and its
                         code, the relevance signal, the account claim with
                         its calendar, the five optional answers, and Last
                         look
  src/surfaces/creator/  the Creator's compact signup, waiting state, and the
                         preparing Campaign kit
  src/surfaces/founder/  the listing fee and payout setup, the helper
                         resources, the Appendix A.5 consent, the live
                         campaign home — Glance, one action, Explore — and the
                         campaign build, where every §14.4 ingredient finally
                         has a box (twelve had none, four of them required)
  src/surfaces/notifications/ the digest preference and notification history,
                         one page for both roles and the Backer control
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

## The live-mode gate

The last thing built, and the smallest. Spec §34 lists eleven conditions that
must all hold before a real person's card can be charged, and the phase that
implements it has a one-word scope for everything else: if something needs
building, the gate stays closed.

**The gate is code.** A page of eleven ticks beside an enabled button is a
checklist, and a checklist is something a motivated person walks past at the end
of a long week. So the conditions are a register the money path reads, and the
refusal happens at the one Stripe gateway object every service in the product
receives — which means a service written in a later phase inherits it without
knowing the gate exists.

**A gateway operation with no decided disposition stops the app from booting.**
The decorator is built by walking the register rather than by listing method
names, and it throws at startup if the gateway carries a callable member nobody
has classified. Adding a money method and forgetting to decide whether it may
run through a closed gate is therefore a deployment that does not start, rather
than an ungated path that looks exactly like a gated one.

**Refunds and card detachment deliberately keep working.** §34 blocks six
things, all of which create exposure: real card data, a live SetupIntent or
PaymentIntent, a live application fee, live fixed funding, an Affiliate
Transfer, a payout promise. A refund is not among them, and adding it would mean
a gate closing — because a condition lapsed, or because the rollback owner
flipped it at 2am — while simultaneously stranding every Backer who is owed
money back or has a live card with no path to remove it. §34 asks what happens
to reservations already saved; that is the answer.

**Nothing is satisfied by inference.** Two conditions the app genuinely decides
on every read: whether the eight canonical documents are published, and whether
the environment separates test keys from live ones. Three are decided by the
acceptance suite, and a running server cannot watch its own test run — so those
are filed, naming what was run and where the output is. The remaining six are
human judgements about Stripe's underwriting, the tax registrations, a deployed
origin, a reconciliation somebody performed, and two people who know they are on
call for a pilot. Each carries a written reason for why the process cannot
answer it, so a later session adding a heuristic that "usually" gets it right is
a visible edit rather than a quiet one.

**An unanswered condition is unsatisfied, and a gate that cannot read itself is
shut.** There is no path through the code that returns "open" because something
could not be determined, no cached answer, and no request body that opens live
mode — the enablement reads the gate itself rather than taking it from whoever
is calling.

**One named pilot campaign, enforced by the database.** Spec §6 limits the first
live enablement to one pilot with a named monitoring owner and a named rollback
owner. A unique index over a constant means a second enablement cannot exist
anywhere in the system; the two owners are rows with a name, a way to reach
them, and a record of who confirmed they know they hold it. A team alias and
"whoever's on call" are both refused by name, because Spec §34 says so twice.

**The rollback plan is a column, not an intention.** All five facts — what
triggers it, who decides and how they are reached, how live mode is disabled,
what happens to reservations already saved, and what each party is told and by
whom — are `NOT NULL` on the enablement. "Written before cutover, not after a
problem" has exactly one enforceable form: the row cannot exist without it.
Rolling back is one statement and takes effect on the next money call, because
nothing caches the gate. Re-enabling afterwards is a new record with its own
gate snapshot; there is no un-rollback, because why live money stopped is not a
fact to erase. The plan itself is at [docs/rollback-plan.md](docs/rollback-plan.md),
with its owner fields deliberately blank and marked as Track A6.

**Appendix C is walked, not read.** The Spec's completion definition is that the
app runs the whole lifecycle "without undocumented operator knowledge", so the
record is of a person going to a surface and getting through it. The column that
matters is the one for knowledge that is written down nowhere: naming it and
marking the step passed is refused by the service and unrepresentable in the
database, because a walk that only succeeded because the walker knew a trick is
a failed walk with a passing feeling.

**Today the gate is shut and says why.** Ten of eleven conditions are
unsatisfied. Every policy document is a draft, no condition has been filed, and
eight of them wait on Track A. That is the correct state, and the phase that
releases it does so by closing Track A rather than by writing more code.

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

Between 10 and 18 August 2026 it was briefly three questions with the campaign
path set by Admin, by a product decision recorded as a deviation at the time.
That decision has been withdrawn and this section describes the flow again.

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

## Admin operations

Spec §2 says the MVP is manual behind a polished surface. This is that surface —
every reservation and charge, the money as it reconciles, and the risks a person
has to look at before a campaign closes.

**Eleven filters, and the list is not kept by hand.** Spec §26.5 names eleven
dimensions the ledger filters and exports by. A list in prose is a list nobody
can test, so it is a register: the server restates it, the query builder walks
it, the filter form renders it, and a test fails if a dimension is quietly
dropped or a twelfth appears with no Spec line behind it. The same is true of the
nine money-control lines and the ten risk signals — and the panels *throw* if any
registered line is missing from what they built, because a reconciliation an
Admin no longer performs would otherwise just disappear.

**Seeing is not exporting.** Spec §25.7 limits what Admin may hand out, not only
what Admin may see. The Backer's email, phone, billing address, survey answers,
and card fingerprint all render on screen, because support and risk work needs
them in front of a person. None of them can enter an export: the export reads its
column list from the register rather than from whoever asked, there is no
override parameter, and the screen says which columns will be withheld before the
button is pressed rather than leaving someone to conclude the data is missing.

**Not yet populated is not zero.** Most money-control lines fill in later phases,
and every ledger column defaults to zero — so a naïve reconciliation screen would
say "Proovd's 5%: US$0.00" for a campaign whose close batch simply has not run.
That is indistinguishable from a campaign that captured nothing, and only one of
the two is a fact. Each line therefore says *not yet populated* and names what it
is waiting for. The risk inventory draws the same distinction: a fraud check that
cannot run until there are payments to check reports **not yet observable**, never
"no risk found".

**A zero tax line is never treated as proof that no tax is due.** Spec §31.7 says
it outright, and it is the one risk signal with no clean-looking state: a
`not_collecting` result is always a blocking risk, and a campaign whose seller tax
readiness has not been recorded is itself an instance of it. Readiness is four
recorded facts — head-office location, product tax code, registration, and active
provider tax settings — and three of four does not make a campaign ready. Nothing
is scored or ranked into an index, because a risk score is an eligibility rule
with arithmetic in front of it, and the Spec forbids inventing those.

**Moving money without seeing what the customer will be told is how support ends
up contradicting the ledger.** So a high-impact action needs four things: a recent
sign-in, a preview of the customer-visible consequences, idempotency, and an
immutable audit row. Three of those already had a home. The preview did not — and
a preview that is merely *displayed* is one nothing enforces, because the next
caller can post straight past it. It is therefore a record: computed for an exact
payload, frozen with a hash of it, and cited by the execution. Change the payload
after reading the consequences and the hash no longer matches, which is the whole
point.

**An override without a before is unauditable.** The prior value is read from the
row itself, under lock, inside the transaction that changes it — never taken from
the caller, because a caller that supplies both halves can supply a flattering
pair. The record is insert-only at the database level: update and delete are
revoked, so the "before" cannot be rewritten later, which is the only reason it is
worth anything. And the fields that *can* be overridden are a fixed list; a route
that accepted any field name would happily record an override of something that
does not exist, leaving an audit trail that looks complete and points at nothing.

**Admin never re-types what the system already holds.** User and provider data
auto-populates, and Admin adds only review, decision, evidence, and override
data. The enforcement is the absence of a route: there is nowhere to send a
corrected email address, a different tax amount, or a substituted payment
reference. A test posts forged values at every plausible address and asserts
nothing moved.

**Internal codes never become customer copy.** A Stripe decline code or a fraud
signal in an explanation a Backer reads is refused at the point an Admin can fix
it, rather than discovered in a support transcript. The internal reason may name
it — those two are separate columns for exactly this reason.

**Money is `eligible`, `blocked`, or `released`, and never "held".** Proovd does
not hold anyone's money; Stripe settles to the Founder's own account, so a screen
that said otherwise would be describing an arrangement that does not exist. Where
money is blocked, the requirement blocking it is named — "blocked" with no reason
is the same euphemism wearing a different word.

## Support, suspension, and the timeline

The other half of the operations surface: not what Admin reads, but what Admin
does — and the record it leaves behind.

**The published SLA is a real deadline, computed on the real calendar.** Spec
§27.8 commits Proovd to a response "within one (1) business day, Monday–Friday,
excluding U.S. federal holidays". That makes it a business-day deadline in the
same sense as the Creator replacement window, so it is computed once from the
committed versioned holiday calendar, stored with the version that produced it,
and fixed by a database trigger. A promise made to a person is not moved by a
later edit — and both deadlines read the same calendar, because two would
eventually disagree on a public holiday.

**A case carries everything the system already knows.** The campaign, the
reward, the subtotal, the tax, the exact authorized total, the statement
descriptor, the date the card was saved. Spec §26.8 requires that a user is
never asked to repeat facts Proovd already holds, so responses start from
editable templates already filled in with them. Templates are starting points:
nothing sends itself, because a person who writes in deserves an answer from a
person.

**Raw provider and fraud codes never reach a customer.** A decline code or a
fraud rule is genuinely useful — to support, on an internal note, which is
exactly where Spec §26.8 puts it. The same code in a reply the customer reads is
refused by the server, and so is one in the public explanation of why a campaign
was stopped. No shipped template contains one either, because a template that
did would put a support agent one keystroke from a leak.

**The queue shows what is late, not just what is due.** An SLA nobody can see
breached is an SLA that gets breached, so a case that went past its deadline last
week is still in the queue, still badged, and sorted to the top. There are three
clocks — the one-business-day response, the next promised update, and the
48-hour follow-up when a Founder owes the answer — and a case can be fine on one
and late on another. An internal note does not clear the breach: a case that
looked answered while the person waiting had heard nothing would be the SLA
failing quietly, which is the only way it really fails.

**Changing owner requires a handoff note, and the note comes first.** Four
things: what has actually been verified, who is taking it, what the customer has
already been promised, and what must not now be contradicted. All four are
required by the database and named individually when one is missing. A note that
could be written afterwards is one that gets skipped and backfilled, so the note
and the ownership change are a single transaction.

**Suspension and kill need a category and a reason, and the phase is not the
operator's to declare.** Whether a campaign is before or after capture is read
from its own lifecycle — a caller who could assert "this is pre-capture" could
close pre-orders that have already been charged. Before capture, the full set
runs: every active pre-order closes without a charge, no future payment can be
created for that campaign, cards are detached only where no other live
transaction still needs them, roles are notified, and the page stays up saying
what happened. After capture the decision, the audit, and the notice are
recorded and no money moves — refunds and reversals belong to a later phase, and
a second refund path is exactly what this one was told not to build.

**A saved card that was authorized stays part of the record.** A killed pre-order
moves to its own state — distinct from one the Backer cancelled, because who
ended it matters — and the successful SetupIntent behind it is never rewritten.
It happened; the record says so.

**The timeline composes; it does not duplicate.** There is no timeline table, no
writer, and no job that appends to one. Every entry is read at request time out
of the record that already owns that fact, and each says which table it came
from — so the timeline cannot drift from the ledger, which is the only property
that makes it worth having during a dispute. A pre-order's timeline includes its
campaign's events, because someone asking what happened to their pre-order needs
to know the campaign was stopped.

**Human touches are logged once and cannot be scheduled.** Spec §26.8 lets Admin
record five personal moments with a first-cohort Founder — an introduction, a
launch-eve check, a mid-campaign welcome, a close thank-you, a debrief — and
insists they never become a sequence. So each may be logged once per campaign,
there is no date field, no recurrence, no template, and no job that sends one. A
second attempt is refused rather than quietly accepted: it is either a mistake or
the beginning of the thing the rule forbids.

## The Admin's own notes

Admins can write down what they need to do, point each note at the record it
belongs to — a Founder, a Creator relationship, a campaign, a Backer, a support
case — and come back to it from anywhere in the Admin panel: a small floating
panel, in the spirit of Google Tasks, that rides above every Admin screen
without belonging to any of them.

The Spec does not name this surface, and the build does not pretend it does.
What keeps a private to-do list from quietly becoming product machinery is a
set of refusals, each enforced rather than intended. There is no assignee —
handing work to a named person is what support cases are for, with their owner,
due time, and published response promise — and the column that would hold one
does not exist. The due date is a day the author checks, never a moment
anything fires: no schedule-shaped column exists, no notification could carry
"your task is due", no background job reads the table, and the server never
even interprets the stored date — the little late/today/future pill is computed
in the browser against the reader's own calendar. The sentence that states this
travels with the date field itself.

Every list is shared and every note says who wrote it, so removing one is soft:
the row survives with who removed it and when, and the database refuses a hard
delete outright. A reference keeps the label it was written with — renaming a
campaign later never rewrites somebody's note — while the destination is
re-checked on every read, so a pointer at a record that no longer answers
renders as a label with the reason, never a dead button. And the count on the
launcher only ever goes down to zero, because nothing in the product can
manufacture a task: every one was typed by a person.

## The Founder's live campaign

Once a campaign is live the Founder gets one page, and it is a chronological
workspace rather than a dashboard: one large number, one thing to do, and
everything else a level below. Spec §20 and the DNA's three altitudes stop being
principles here and become a tested surface.

**The last-visit delta cannot be lost to a failed render.** Spec §20 requires the
last-seen position to advance only after the rendered state was *successfully
delivered*, and no server can assert that about its own response — the connection
can drop after the last byte leaves. So reading the page issues a receipt
recording exactly what it showed and advances nothing, and the surface
acknowledges that receipt only once the render has committed. A render that threw
never acknowledges; the receipt stays open and the same delta is still there next
time. The position moves to the count the receipt recorded, never to the count at
the moment of acknowledgement, because otherwise acknowledging a delta you read
would silently swallow one that arrived while you were reading it.

**Nothing counts pre-orders into a counter.** New, canceled, and net are composed
on every read from the append-only transition history that the pre-order, the
cancellation, and the kill already write. A second set of counters could drift
from the record it summarises, and a Founder would act on the drift. Composing
them also makes the reconciliation structural: the four numbers partition one
set, so they agree by construction rather than by discipline. A killed pre-order
is counted separately from a cancelled one — only one of those is a Backer
changing their mind.

**A threshold crossing notifies once, every time it happens.** An Idea campaign
can cross its order threshold, fall back under it, and cross again, and each of
those is its own event with its own message. That is deduplicated by the
*transition* rather than by a day or a count: the evaluation compares against the
last crossing actually recorded, so it runs on every pre-order and every
cancellation and writes nothing when nothing moved. The database refuses two
crossings in the same direction and refuses a campaign to lose a threshold it
never reached. The messages key on the crossing rather than the campaign —
keying on the campaign would send the first one and quietly swallow every later
one.

**There is no scheduled check-in email, and no place to add one.** Spec §20 rules
out generic Day 3/7/10 "check your campaign" mail, so every message this phase
can produce sits behind a real state transition. The next action a Founder is
shown works the same way: each of the five ranked actions reads from a record
that already exists — a suspension, an open review, a support case waiting on
them, an announced delivery change with no update published yet, a milestone that
actually happened. None of them is produced by a timer or an absence, and when
none of them exists the page closes with the caught-up sentence and no button at
all. That ending is a designed moment, not an empty state to be filled, so there
is no fallback branch to fill it.

**A ranking can be overridden, and the override has to be documented.** A
recorded safety decision can move something above its natural rank, but it can
only promote an action that is genuinely there — it cannot conjure one. Every
later correction, dismissal, and reclassification stores the prior rank, the
reason, who did it, and when, insert-only, because those rows are counted as a
quality metric and a rate computed over an editable table can be improved without
improving anything.

**Explore is a first-class space, not a bin.** Eleven sections, each carrying the
definition of what its numbers count, because two people reading "conversion"
differently is the ordinary failure of a metrics screen. A section whose phase
has not run says what it is waiting for rather than showing a zero, and a
conversion rate with no clicks behind it is reported as undefined rather than as
0%. Freshness is stated as a time and the page says it refreshes when loaded;
nothing anywhere claims to be live or real time.

## Changing a campaign that is already running

Once real people have committed money, an edit is not just an edit. Spec §20
sorts every change into three tiers, and the sorting is done by the *field*
rather than by what the Founder calls the change — a reviewed field has no
direct write path while a campaign is live, whatever anybody names it. There is
exactly one edit route, because a route per tier would let a caller pick which
rules apply by picking a URL.

**Typos, brand notes, the community link, and FAQ clarifications publish
immediately**, and every one writes a history row carrying the value before and
after. The "before" is read from the stored row, never taken from the request:
a caller who supplies both halves can supply a flattering pair, and a history
like that is worth nothing.

**Claims, rewards, prices, dates, delivery promises, refund terms, and Creator
channel rules cannot publish directly.** The Founder describes what they want
and why, and it becomes a request a reviewer decides. Applying it runs the same
materiality machinery the pre-launch review uses — it versions the change,
invalidates the affected Creators' readiness, and creates one reacceptance task
each — and a database constraint refuses to mark a request applied without a
recorded change behind it.

**The campaign type, the order threshold, the internal target, what a Backer
already agreed to buy, and accepted Creator compensation cannot be changed at
all.** That tier is not a slower version of the second one; it is a different
answer, and no request is opened for it.

**An FAQ answer cannot quietly move a delivery date.** The FAQ is in the first
tier, which without a check would make it the one unreviewed path to every
promise in the second. So an answer that states a date, a price, a refund term,
or a shipping commitment is redirected to review. The detector is deliberately
broad: a false positive costs a day, and a miss moves a date nobody accepted.

## Comments

Spec §18 gives each campaign one general thread and one thread per update, and
only a Backer holding a magic link may post — which is why the thread lives on
the magic-link page rather than on the public campaign page, where nobody is
authenticated.

**A Backer is a number, and the number means nothing.** `Backer 7` is a
per-campaign sequence assigned at their first comment: not derived from their
email, their id, or anything else, and restarted per campaign so it does not
leak how many comments the platform has seen. A chosen display name is allowed —
except one that is the local part of the Backer's own email address, which is
refused outright. Someone typing that has almost certainly not realised the
thread is public, and the cost of being wrong is publishing part of an address.

**Reporting a comment routes it to a person and hides nothing.** There is no
automatic moderation in the Spec and none was invented; a flagged comment stays
up until an Admin decides, because auto-hiding would hand every reader a removal
button. The confirmation says exactly that rather than implying the comment went
away. New comments close when the campaign does, and reading stays open.

## Joining a campaign that is already running

Admin can recruit a Creator after launch, through the same private invitation
and the same compact signup — nothing about that path is duplicated. What is
specific to joining late is three things.

**The terms are for the time that is actually left**, and they are stored as
they were shown. A Creator who joined with nine days remaining agreed to a
nine-day deliverable, and recomputing that later would show them a window that
has shrunk since. The campaign's high-effort classification is copied at the
moment they join rather than read back afterwards, and a database trigger
refuses to move any of it.

**Their link activates now, not when the campaign launched.** That single choice
is the whole of "no retroactive attribution" — the click ledger already decides
every click against the link's own activation time and records anything earlier
as earning nothing, with the reason written down. So traffic from before they
existed on the campaign stays with the campaign, and the record says why.

**Nothing else moves.** Adding a Creator does not change public terms, does not
touch another Creator's locked agreement, and does not reopen campaign review.
The three-active-partnership cap is checked before the Creator is asked to
accept anything, because telling someone they cannot start after they have
agreed is asking them to agree to something they could not do.

## What the product will and will not email you

Spec §27 names about 120 transactional messages across four audiences, and by
this point in the build most of them existed and nobody could say which. The
notification sweep makes that answerable.

**Every event either sends or is written down as deliberately not sending.** The
registry is 121 keys; 77 have a sender and 44 are recorded with a reason, an
owner, and — where the claim is that only the *message* is missing — the table
that already holds the fact it would carry. A test asserts the two lists
partition the register exactly: none in both, none in neither. Adding an event
without either building it or recording why it is absent fails the suite.

**The three kinds of absence are different things and are labelled as such.**
Some are decisions: the Spec asks for public-route email verification "if later
enabled" and there is no public signup to verify, and it asks for a
failed-payment *spike* alert while fixing no threshold anywhere — inventing one
is exactly what the Spec forbids. Those own nothing and belong to nobody's
backlog. Others are messages waiting on behaviour that has not been built yet,
and they name the phase that owns the behaviour. The rest are messages whose
behaviour already exists and is recorded, which is the only kind that is really
a gap.

**The rules are checked against the rendered message, not the sender's
intention.** At most one primary action, a plain-text support route, a stable
reference to quote, no unsubscribe anywhere, and — for money — the amount, who
sold it, what the statement will show, and where the money stands. Each is
decided by rendering the actual email and reading it, the same way the invitation
preview has always scanned the rendered message rather than the record behind it.

**Money messages come in four kinds, because one would be wrong.** Read flatly,
the money rule would demand a card-statement descriptor on a cancellation — on
the one message where it matters most not to imply money moved — and on a
Founder payment that appears on nobody's statement at all. So a message is about
money leaving a card now, money leaving that card later, money moving toward
someone, or money that did not move and will not. The middle two carry an
explicit not-charged sentence; only the first two carry a seller and a
descriptor.

The sweep found five real defects and they were fixed rather than reclassified.
The pre-charge reminder named an amount, a seller, and a descriptor and never
said the card had not been charged. The listing receipt named no merchant of
record, on the single charge in the product where that is Proovd rather than the
Founder. A failed Creator transfer told someone something had gone wrong with an
unnamed sum. Three notices carried no reference to quote back to support. And
fourteen senders were emitting a bare paragraph of text with no support route,
no reference, and not even a complete document — each locally reasonable, and
collectively the largest hole in the contract.

**A deadline names its timezone, and `Z` does not count.** Several internal
notices rendered a raw ISO instant, which is canonical UTC and spells nothing out
to someone reading it at ten at night in Denver. The suite refuses a bare ISO
instant anywhere, and the register names which messages carry a deadline at all —
one that says work is due *now* is deliberately excluded, because demanding a
timezone from it would push it to invent a deadline the Spec never states.

**There is still no scheduled check-in email, and now there is a test that says
so.** No key matches a check-in, nudge, streak, or drip shape; no sender, job, or
template mentions a re-engagement sequence; no message manufactures urgency or
scarcity or claims to be real time. Absence is asserted as deliberately as
presence.

**Exactly one email can be switched off, and it is the only one that carries a
way to do it.** Every transactional message is unstoppable by design — you cannot
unsubscribe from a receipt for a charge on your card. The optional activity
digest is the single exception, so the two rules have to stay apart: the digest
is composed from *activity* — campaign updates, comments, roster changes — and
never from the record of what was emailed. Build it the obvious way, as "here is
everything we sent you since last time", and someone who turned it off has
unsubscribed from something they cannot, while someone who turned it on gets
every receipt twice. The contract check knows which rule applies to which
message: a transactional email with an unsubscribe link fails, and so does a
digest without one.

Nothing sets a frequency on anyone's behalf. There is no default, no backfill,
and no code path that creates a preference as a side effect of anything else —
so a person who never chooses simply never receives one, which is the correct
outcome rather than a gap. Choosing "no summary emails" is a recorded answer and
is kept distinct from never having been asked, because only the second should be
asked again. Every choice and every change is written by a database trigger, not
by the code that saves it.

**A summary of nothing is not sent.** A digest with no activity in its window
would be a scheduled generic email with a subject line on it, which is the exact
thing the rest of this section exists to refuse — so the job composes first and
sends only if there is something to say. A quiet week is silence.

**Notification history is a record, not a dashboard.** Founders, Creators, and
Admin can see what was sent to them, when, and whether the provider confirmed it
— a message we recorded but never got confirmation for says exactly that rather
than showing as delivered. It has its own page, deliberately not the campaign
home, and it carries no unread count and no badge: there is no column that could
hold one, nothing that marks anything read, and nothing on it that competes with
the single next action the campaign home ranks. The message bodies are not
stored; you already have those in your inbox, and a second copy would be personal
data with nothing to gain from it.

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

The frontend and shared suites need neither Docker nor a database. The frontend
suite does build the production bundle once, in `vitest.global-setup.ts`, when
`frontend/dist` is older than the source: §33.11.3's scan reads what actually
ships rather than the source, and a stale bundle would pass while the code it
was built from had the violation. It runs before the worker pool exists —
building inside a test file starved the jsdom workers and timed out three
unrelated suites.

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
- **What Admin may see and what Admin may export are different sets.** Spec
  §25.7's limits apply to what Admin can hand out, not only to what Admin can
  look at. The exporter reads its permitted columns from a register, never from
  the caller, and there is no override flag to add one.
- **A ledger surface never prints a zero it did not compute.** A money line whose
  phase has not run says so and names what it is waiting for. A risk check that
  cannot yet run reports *not yet observable*, not *clear*. Spec §1.4 forbids
  implying an answer the system does not have.
- **A high-impact action shows the customer-visible consequences first.** The
  preview is a stored record hashed against the exact payload, not a screen the
  execution merely followed — so changing the payload after reading it refuses.
- **An override records before, after, reason, actor, and time, and the before
  is read from the row.** The record is insert-only at the database level, since
  a "before" that can be rewritten afterwards protects nothing (Spec §33.12.4).
- **A last-seen position advances only on an acknowledged delivery.** Reading a
  page cannot advance it, because a server cannot know its own response arrived.
  A failed render leaves the receipt open and the delta intact (Spec §20).
- **A summary that could drift from its record is not built.** Pre-order counts
  compose from the append-only transition history and the campaign timeline
  composes from the tables that own each fact. Neither has a writer.
- **No message is sent on a timer without a consequence behind it.** Spec §20
  rules out generic check-in email, so every notification traces to a real state
  transition, and no table in the live-operations phase carries a schedule,
  cadence, or next-send column.
- **Every notification event either sends or is recorded as deliberately not
  sending.** The two lists partition the register exactly, and a recorded
  absence names its reason, its owner, and — where only the message is missing —
  the table that already holds the fact. A new event with neither fails the
  suite.
- **Transactional email is never opt-out-able, and the check is on the rendered
  message.** At most one primary action, a plain-text support route, a stable
  reference, and for money the amount, the seller and merchant of record, the
  expected statement descriptor, and where the money stands. A deadline names
  its timezone in words; a bare ISO instant is refused.
- **An empty next-action list is a designed ending, not a gap.** The caught-up
  sentence is exact copy and renders with no control beside it; there is no
  branch that manufactures a call to action (Spec §20, DNA §5.4).
- **What a live edit is allowed to do is decided by the field, not by the
  editor.** Spec §20's three tiers are a register; a reviewed field has no
  direct write path and an unchangeable one has no request path either. Any
  directly-publishable text stating a date, price, or refund term routes to
  review — an FAQ answer is the Spec's example, not the scope, and a section
  heading is the same loophole with a different name. The handful of fields
  exempt from that check are listed with the property that makes each one
  unable to carry a promise at all.
- **A comment is what people read.** Its body and its author are fixed once
  posted; only the moderation decision may be written afterwards, and reporting
  one routes it to a person rather than hiding it (Spec §18).
- **A mid-campaign Creator's link activates at activation, never at launch.**
  That is what makes prior traffic earn nothing, and the click ledger already
  records the reason against every earlier click.
- **Money is never described as `held`.** Spec §22.3 gives three accurate words —
  `eligible`, `blocked` with the named requirement, and `released`. Proovd holds
  no one's money, so the euphemism would describe an arrangement that does not
  exist, and Spec §3.2 already bans the rest of that vocabulary everywhere.
- **No live money moves through a closed §34 gate, and the refusal is at the
  gateway rather than at each caller.** A gateway operation with no recorded
  disposition stops the application from booting. The operations that unwind
  exposure — a refund, a card detachment — are deliberately not blocked, because
  a closed gate must never strand somebody who is owed money back.
- **The gate is never cached, and there is no override anywhere.** A cached gate
  is a rollback that does not take effect. No route sets `open`, no request body
  opens live mode, and an unanswered condition is unsatisfied rather than
  unknown.
- Secrets live in the deployment environment, never in the repo, the frontend
  bundle, email, or documentation. `.env.example` documents variable *names*
  and non-secret shape only.

The full invariant list — naming, state, idempotency, time, tokens, forbidden
patterns — is in [CLAUDE.md](CLAUDE.md).
