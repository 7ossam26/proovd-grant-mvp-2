# Admin Tasks — the floating work panel (post-Phase-24 change)

**This is not a numbered phase.** `docs/master-plan.md` §6's table ends at 24, and §1.1 says
a phase file may never introduce a rule. This brief introduces none: it cites the Spec where
the Spec speaks and, where it does not, it says so in the open rather than manufacturing a
citation. It is the same kind of document the Founders, Creators, Support, Campaigns, and
Backers workspaces were built from — a supplied reference bundle plus the decisions that
reference cannot make for itself.

**Model:** Opus 5. Not because the feature is large, but because almost every decision in it
is a judgement about what the panel must *refuse* to become, and those are invisible to a
reader who only sees the reference.

**Goal:** An Admin can write down what they need to do, point it at the record it belongs to,
and come back to it from anywhere in the Admin panel — without the product ever chasing them
about it.

**Reference bundle:** `docs/design-refrence/Proovd-Tasks.html`. A standalone build of a
Google-Tasks-style floating popup: a launcher pill in the bottom-right corner, a panel that
slides in from the right edge, multiple lists, tasks with notes and an optional due date, and
a reference that points at a Founder plus a tab and a section. It detects at load whether a
workspace is on the page and docks instead of floating when there is nothing to float over.

---

## Read first

Read these before writing anything. Do not work from this brief's paraphrase of them.

- **Spec §26** — Admin operations, all eight subsections. Read it to confirm what this brief
  says below: none of them is a task list.
- **Spec §26.7, §26.8, §27.8** — support cases, the chronological timeline, the published
  response promise. This is the machinery a task panel must not duplicate.
- **Spec §30** — the deferral and prohibition list, both halves.
- **Spec §1**, especially rules 3, 4, and 6, and **§1.1**'s completeness list.
- **Spec §3.1 and §3.2** — the naming table and the banned-term list, including §3.2's last
  paragraph about identifiers.
- **Spec §25.6** (audit) and **§25.8** (retention).
- **Spec §27.1's six questions** and **§28.5**'s accessibility baseline.
- **DNA §5.4** ("Finite by design"), **§5.10** ("Guardrails — addictive, not manipulative"),
  **§5.2**, **§5.6**, **§5.14**.
- `CLAUDE.md`, the five post-Phase-24 workspace sections. They are the house style for a
  build like this one.

---

## Prerequisites

All of Phases 00–24, and the five Admin workspaces built after them. Nothing here depends on
work that has not landed.

---

## The honest position on §1 rule 6

**§26 does not name a task list.** It has eight subsections — Users, Campaign detail,
Affiliate recruitment, Creator proof, the reservation ledger, money controls, support
operations, the timeline — and none of them is this. §26.1 is a list of *fields on a Founder
row and an Affiliate row*; it does not define the Admin panel's section structure at all. The
word "Today" does not appear in the Spec as an Admin surface. Do not go looking for a citation
that makes this feature spec-mandated. There isn't one, and inventing one is worse than the
absence.

That is survivable, and here is exactly why. §1 rule 6 forbids inventing "a new commercial
rule, deadline, fee, eligibility condition, payout rule, campaign state, or consent". It does
not forbid an internal surface. The five Admin workspaces already shipped are themselves not
enumerated by §26 — the five-tab shell came from a reference bundle — and §1 rule 2 expressly
permits composing surfaces differently so long as every specified item, action, state,
disclosure and recovery path is still exposed. A private note an operator writes to themselves
is none of the seven things rule 6 lists.

**It becomes a rule-6 violation the moment the due date binds anything.** A date that drives a
badge on another surface, orders a queue somebody is measured against, appears next to an SLA,
or sends a message is a manufactured deadline. The whole of the "Five mechanisms" section
below exists to make that structurally impossible rather than merely unintended.

The Spec does use the phrase "Admin task" twice — §24.11 creates one on a dispute, due within
24 hours, and §31.8 creates "an owned Admin follow-up task" on a negative satisfaction
response. Both are **system-spawned, record-attached, owned and due-timed**. Neither is this.
Do not implement either of them here, and do not reuse this table for them; they belong to the
services that already own their triggers.

---

## The register that currently says "no", and what to do about it

`shared/src/admin/campaign-workspace.ts` carries this today:

```ts
{
  key: 'tasks',
  label: 'Tasks',
  mark: 'T',
  built: false,
  /* §30 forbids a scheduled queue that chases anybody, so work is recorded on
     the record it belongs to rather than in a queue of its own. */
  absentBecause: 'No task queue — work is recorded on the record it belongs to.',
},
```

Ship the panel without touching this and the Campaigns hub renders "No task queue" beside a
working task panel. That is the §1.4 failure in its purest form.

The entry flips the way `backer_admin` flipped on 2026-08-15 — `built: true`, `absentBecause`
deleted, and the comment replaced with a dated one that says what changed. The `built` /
`absentBecause` invariant is enforced by test in both `campaign-workspace.test.ts` and
`campaigns.test.tsx`, so a half-done flip fails the suite.

**The new comment must not pretend the old reasoning was wrong.** It wasn't. What changed is
that the thing being built is not a queue: nobody is assigned, nothing is scheduled, and no
message is sent. Write that.

**Where the destination points.** Tasks is a panel, not an address, so the honest deep link
opens the panel with that campaign already chosen as the reference rather than navigating to a
page that does not exist. Use a query parameter the shell reads
(`/admin/campaigns/:id?tasks=new`), which keeps `href` a real string and lets `AdminLink` stay
exactly as it is.

---

## Scope

### 1. The record (§1.1, §1.3, §25.6)

Migration `0046_admin_tasks.sql`, hand-written, following 0045's idioms: a prose header
recording the decisions, `--> statement-breakpoint` after every statement, CHECK constraints
for register membership and non-blank text, `GRANT`/`REVOKE` for `proovd_app` with exceptions
granted **by column name**, and write-once triggers where a column must not be rewritten. Add
the journal entry: `idx: 46`, `when: 1786550400000`, `tag: "0046_admin_tasks"`.

Two tables, in a new `backend/src/db/schema/admin-tasks.ts` with a commented `export *` in
`schema/index.ts`:

**`admin_task_lists`** — `id`, `name`, `created_by` (`text` → `user.id`; Better Auth ids are
text, not uuid), `created_at`, `archived_at`, `archived_by`.

**`admin_tasks`** — `id`, `list_id`, `title`, `notes`, `due_on` (`date`, nullable),
`created_by`, `created_at`, `completed_at`, `completed_by`, `deleted_at`, `deleted_by`, and a
nullable reference triple: `ref_kind`, `ref_id`, `ref_label`.

`ref_kind` is CHECK-pinned to the register in §3 below. The three reference columns are
all-or-nothing by CHECK — a `ref_id` with no `ref_kind` is a pointer at nothing.

**Deletion is soft**, and that is a consequence of your shared-visibility decision: on a
shared list, one Admin hard-deleting another's note destroys somebody else's work with no
record. `deleted_at`/`deleted_by` are set, reads filter them out, and the row survives. This
is the repo's standing posture — a correction is a new row and the superseded one survives.

**Completion records who.** On a shared list "done" without an author is a fact nobody can
follow up on.

### 2. Visibility, and the assignee that does not exist

Every Admin sees every list and every task. `created_by` is recorded and rendered, so the team
knows who wrote what.

**There is no `assigned_to` column, and its absence is asserted.** This is the one place this
brief overrides the obvious reading of "shared team task list", and the reason is that
assignment already exists: `support_cases` carries an owner, a waiting party, a due time, a
handoff gate with four required fields, and §27.8's published response promise. A second way to
hand work to a named person would be a second door into rules that machinery encodes, and this
repo refuses that pattern everywhere — see the Campaigns hub, which is read-only for exactly
this reason.

If a task turns out to be work somebody is owed, the answer is a support case, not a column
here. Say that in the schema comment so the next session does not add one.

A read-side "created by me" filter is fine and cheap. A column is not.

### 3. What a task can point at (§11, §1.4)

A register in `shared/src/admin/tasks.ts` naming the five built workspaces —
Founder, Creator relationship, Campaign, Backer, Support case — each with its address pattern.

Resolve the reference server-side into the established shape the Support and Campaigns
workspaces both use:

```ts
{ label: string; href: string | null; unavailableBecause: string | null }
```

`href` and `unavailableBecause` are never both set and never both null; assert both
directions. A reference whose target has since been deleted, or whose workspace does not
exist, renders the reason where the destination would be.

**Keep the reference bundle's own rule**, which is already correct and already matches this
repo's treatment: *"a reference with nothing to navigate to is a label, not a dead button."*

`ref_label` is resolved and stored at write time, not on read. A label resolved on read
silently rewrites what somebody wrote down when a campaign is renamed — the same reasoning the
§18 comment thread records for its stored author display.

### 4. The five mechanisms that keep a due date from chasing (§30, DNA §5.10)

This is the section the feature lives or dies on. All five, and each one asserted:

1. **No schedule-shaped column exists.** `remind_at`, `notify_at`, `recurrence`,
   `repeat_interval`, `next_send_at`, `template_id`, `cadence`, `snooze_until`, `escalate_at`,
   `priority`, and any `sla_*` are absent from both tables. Assert it against
   `information_schema.columns`, and assert the columns that *should* exist in the same test
   so it cannot pass by the table having been renamed away. Clone
   `support-operations.test.ts:1257-1280`.
2. **No notification key is added.** §27's registry has no key that could carry "your task is
   due", and every one of its four `*_due` internal keys is anchored to a Spec-defined
   deadline on a domain record. Adding one fails `notification-coverage.test.ts` until a
   sender exists, and a sender here is precisely what §30 forbids. Assert that no registry key
   matches `/task/`.
3. **No job reads the table.** Scan `backend/src/jobs/` for the table name and assert nothing
   matches. The `relationship_touches` precedent: the absence is the enforcement.
4. **The date drives exactly two things**, both computed at read time from the stored value:
   the pill's `late` / `today` / `future` state, and the optional sort. Nothing else reads
   `due_on`. Assert that no other module imports it.
5. **A pinned sentence rides the due-date control.** Reuse the line this codebase has already
   articulated at `shared/src/admin/support-workspace.ts:352` — *a date you check rather than
   one that chases anybody*. Pin it as a constant, render it with the field, and compare it
   character-for-character in the drift test.

**The launcher's open-count badge is not a violation and should not be removed.** DNA §5.4
asks for finite, countable units "with the count visibly going down. Zero means the session is
over." A count of tasks the Admin wrote themselves, going to zero, is that pattern rather than
its opposite. What §5.4 forbids is *manufacturing* items to extend a session, and nothing here
can manufacture one — every row has a `created_by` who is a person.

### 5. The panel (§1.1, §27.1, §28.5, DNA §5.2, §5.6)

`frontend/src/features/admin/tasks/` — `api.ts`, `shared.tsx`, `TasksPanel.tsx`,
`TaskCompose.tsx`, `tasks.test.tsx`. The `backers/` flat layout is the closest precedent.

Mount `<TasksPanel />` inside `AdminFrame` as a sibling **after** `</main>`
(`AdminLayout.tsx:328`). That puts it inside `RequireRole` — so it never renders for a
non-Admin — and inside `MotionProvider`, and above every route, so it survives navigation
between sections.

Carry over from the reference, because these are its good decisions:

- The launcher pill, its open count, and the overdue tone on the badge.
- The panel sliding from the right, and `prefers-reduced-motion` honoured.
- **Compose covers the panel** (`position: absolute; inset: 0`) rather than opening a second
  floating layer. One panel on screen at a time, never a popup stacked on a popup.
- Changing the reference's kind clears the narrower choice beneath it.
- The "you are looking at X — Use this" strip, which is the fastest path and belongs first.
- Two distinct empty states: nothing open with completed items hidden, and no tasks at all.
- The `late` / `today` / `future` due pill.

Replace, because the reference is a prototype:

- `localStorage` → the API.
- `prompt()` and `confirm()` → `ConfirmDialog`
  (`features/admin/founders/dialogs/ConfirmDialog.tsx`), which opens programmatically and
  restores focus itself.
- The DOM-clicking navigation bridge (`WS.go`, `setTimeout` chains, `.founder-row` queries) →
  React Router links to the resolved `href`.
- Its `SUBTABS` map → the reference register in §3. The eight tabs in the bundle are a
  prototype's Founder-record nav and do not match the real product.
- Its own `<style>` block and hex literals → `proovd.css`.

Every state answers §27.1's six questions through `StatePanel`: loading, empty, failure, and
the state where the API is unreachable. A failure state that says only "could not load" is not
one of them.

### 6. Styling (`proovd.css`)

A new `PHASE 30` banner appended at the end of the file, in the house format: the `════`
header, the spec citations, `added <date>`, and the same three numbered conventions every
section since PHASE 25 restates — tokens only, scoped overrides, responsive is a correction
that names the overflow problem it answers.

Prefix everything `.tsk-`. Reuse `.input`, `.helper`, `.grey`, `.kicker`, `.btn`, `.sr-only`
rather than restyling them.

**Layering.** The 850–899 band is free; nothing occupies it. Put the panel and its launcher
there — above `.dock` (800), and **below `.scrim` (940)** so that when a `ConfirmDialog` opens
the scrim correctly dims the panel behind it, and below `.toast` (1000), which is deliberately
on top because a confirmation must clear a panel. Do not reuse 900 or 950; both are taken
(`.drawer` and `.skip-link` at 900, `.modal` and `.cr-palette` at 950).

**Mobile is a sheet, not a side panel.** `.drawer` already becomes a bottom sheet under 600px
with the comment "§8.1: sheets, not side drawers". Match it. The reference's full-width
side panel at 520px is not the house behaviour.

### 7. API (§26, §33.12.5)

`backend/src/routes/admin-tasks.ts`, declaring full paths under `/api/admin/tasks`, mounted
bare in `app.ts` before `express.static`, with the usual multi-line comment naming what it
implements.

`requireAdmin` on everything. **No `requireFreshSession`** — writing down a note moves no
money, changes no configuration, enforces against nobody, and decides no customer outcome, and
`admin.ts` has recorded since Phase 06a that gating routine daily work is how the gate stops
meaning anything.

**Register every write in `UNGATED_ADMIN_WRITES`** (`shared/src/qa/system.ts:470`) with
`route`, `specRef`, and a `reason` over 60 characters naming the sensitive property it lacks.
The partition test at `system-contract.test.ts:497-568` walks the mounted router with a
two-day-old session and requires the set to partition exactly, in both directions. **This is
the single most likely way this build breaks the suite**, and it will not be a subtle failure.

Add the local re-assertion each workspace suite carries, listing this feature's routes by name.

Resolve the author from `req.authUser?.id`, **never from the request body** — the
`assignToSelf` precedent at `admin-support.ts:469-504`. A caller that can name its own actor
can attribute a note to somebody else.

Audit rows: one per mutation, in the same transaction, via the local `audit()` helper.

### 8. Vocabulary (§3.1, §3.2, §33.11.3)

A `TASKS_BANNED_TERMS` register in the shared module, scanned by test against every payload
and every rendered surface, in the shape of `SUPPORT_BANNED_TERMS`.

**`goal` must never appear, including as an identifier.** §3.2 bans it for an Idea threshold
in every audience, its last paragraph extends the naming rules to tables, fields, jobs and
logs, and §33.11.3's bundle scan already caught `progress.goal` in the Campaigns hub's first
draft. A property name survives minification.

**`reminder` is banned here too**, and this one is not obvious: it is real, live product
vocabulary — §20's pre-charge reminder, Appendix B.3, §27.4/§27.5 — so reusing it for a task
implies an automated send that does not exist.

Also banned: `nudge`, `streak`, `snooze`, `escalate`, `SLA`, `assigned to`, `auto`.
`Overdue` is fine — §27.8 uses it for the support queue and it is established Admin
vocabulary.

---

## Out of scope

- **Assignment.** §26.7's support cases own it, with an owner, a waiting party, a due time and
  a handoff gate.
- **The §24.11 dispute task and the §31.8 follow-up task.** System-spawned, owned by the
  services that trigger them.
- **The `Today` section.** It stays parked. Tasks is a panel, not a section, and nothing here
  changes the shell's nav.
- **Any notification, digest entry, or history entry.** §27.7's digest composes from
  `campaign_updates`, `campaign_comments`, and `association_status_history`; a task is none of
  them, and the digest is a customer-facing message.
- **Retention.** §25.8 defines seven windows and none of them covers Admin-authored internal
  content. That is a genuine gap. **Name it in the schema comment and do not fill it** — §1
  rule 6's "if something seems missing, say so". The precedent is unambiguous:
  `support_case_messages`, `support_cases.internal_reason`, and `relationship_touches.note`
  are none of them swept, and the only retention sweep in the product is for unclaimed
  invitation drafts.
- **Bulk actions, merge, export, attachments, and a shell-wide command palette.** Each gets a
  register entry naming what is missing and why, in the shape of `SUPPORT_PARKED_MESSAGES`.

---

## Traps

**The register that says this feature should not exist.** Read
`shared/src/admin/campaign-workspace.ts:249-257` before writing a line. Two failure modes are
both easy: building the panel and never noticing the entry, and reading the entry and
concluding the feature is forbidden. Neither is right — the entry rules out a *queue that
chases anybody*, and the reference bundle is not one.

**`useButtonProgress` takes the promise, not the callback.** `MotionProvider.tsx:247-270`
records it: the runtime decides what to wait on with `typeof work.then === 'function'` and
substitutes a 1.2-second timer for anything else, so handing it the function plays the whole
morph and never calls the work. **And the test mock has the same trap in reverse** — mocking it
as `(el, work) => await work()` resolves immediately, so `ConfirmDialog` reads a refusal that
has not been assigned yet and closes on a decision the server refused. Copy the mock from
`support.test.tsx:55-83` verbatim, where the second parameter is typed `Promise<unknown>`.
Three admin suites carried the wrong shape until 2026-08-15.

**The reference has no focus management whatsoever.** It toggles a class. Focus must move into
the panel on open and return to the launcher on close, and Escape must close — compose first,
then the panel. Deliberately **not** a focus trap: the panel is non-modal and does not block
the page, and trapping focus in a thing that is not blocking anything strands keyboard users.
Radix's own restore targets `null` and drops focus on `<body>`, which is why `ConfirmDialog`
takes the opening element as a prop and restores focus itself; do the same.

**`Cmd/Ctrl+Shift+T` is "reopen closed tab" in Chrome.** The reference binds it. Pick
something else, and copy the input/textarea/select/contentEditable suppression guard from
`CreatorSearch.tsx:50-55` — without it, the shortcut key typed into the notes field opens or
closes the panel and eats the keystroke. Note that the `/` palette is per-surface today, not
shell-wide; a shell-wide shortcut is new ground, so it must be conservative.

**A shared list makes deletion somebody else's loss.** The reference hard-deletes behind a
`confirm()`. On a shared table that is destroying another person's note with no record.

**The `44px` touch minimum will deform the checkbox.** The reference bundle says so in its own
comment: `proovd.css` sets `min-height: 44px` and padding on every input, which turned its
round checkbox into a 30×44 oval. Pin every axis, and do not solve it by weakening `--touch`.

**Do not add a second event store.** The panel reads and writes its own two tables and nothing
else. §26.8's trap — a second event store that drifts from the first is worse than no
timeline — applies to any temptation to denormalise a campaign name or a Founder's status onto
a task row.

**Every number needs a definition, and an unpopulated one says so.** §16a's rule holds here as
everywhere: a list with no tasks says so; it does not render a zero that reads as an answer.

---

## Done when

- [ ] `docs/design-refrence/Proovd-Tasks.html` is in the repo beside the other bundles.
- [ ] Migration `0046_admin_tasks.sql` creates both tables with their CHECKs, grants, and
      write-once triggers, and `meta/_journal.json` carries `idx: 46`.
- [ ] `information_schema` asserts the absence of `assigned_to` and every schedule-shaped
      column, **and** the presence of the columns that should exist.
- [ ] `asAppRole` proves the grants: the app role cannot `DELETE` a task, and cannot rewrite a
      recorded author or creation time.
- [ ] No notification key matches `/task/`; `notification-coverage.test.ts` still partitions.
- [ ] No file under `backend/src/jobs/` names either table.
- [ ] The shared register is restated in `backend/src/tasks/logic.ts` and drift-tested, with
      the pinned sentences compared character-for-character.
- [ ] Every write is registered in `UNGATED_ADMIN_WRITES` with a `specRef` and a reason over
      60 characters, and `system-contract.test.ts`'s partition passes in both directions.
- [ ] The author is resolved from the session; a request body naming another user is ignored,
      asserted by test.
- [ ] `CAMPAIGN_DESTINATIONS.tasks` is `built: true` with `absentBecause` removed and a dated
      comment saying what changed; both register tests pass.
- [ ] The Campaigns record's Tasks link opens the panel with that campaign pre-selected.
- [ ] A reference whose target is gone renders `unavailableBecause` and no link; `href` and
      `unavailableBecause` are never both set or both null.
- [ ] The panel renders on every Admin route and on none outside `/admin`.
- [ ] Keyboard: launcher reachable, focus enters on open, returns on close, Escape closes
      compose then the panel, and the shortcut is suppressed inside text fields.
- [ ] `axe` passes on the panel open, on compose, and on the empty state.
- [ ] Loading, empty, failure and unreachable states each answer §27.1's six questions.
- [ ] 320px: the panel is a sheet and the page body never scrolls sideways.
- [ ] `TASKS_BANNED_TERMS` is scanned against every payload and every rendered surface, and
      the built bundle contains no `goal` identifier — `npm run build` then the §33.11.3 scan.
- [ ] `npm test`, `npm run typecheck`, and `npm run build` all pass in one run.
- [ ] `CLAUDE.md` gains a dated section in the house style, naming the files, the test counts,
      and — most importantly — **the absences asserted by test**.

**Acceptance:** this feature has no named §33 test, because §33 tests the Spec and the Spec
does not name it. What it must not do is break one: §33.11.3 (the bundle scan), §33.12.5 (the
ungated-write partition), §33.6.11 (no scheduled check-in), and the §27 coverage partition are
the four that will catch a mistake here, and all four must still pass.

---

## After this

`Today` is still the only parked section, and the Money & Fulfillment console is still the one
`CAMPAIGN_DESTINATIONS` entry that names its own absence. Neither is touched by this work.
