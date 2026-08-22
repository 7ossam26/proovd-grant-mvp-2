/**
 * Book your founder interview — Founder Flow v2, the reference's `[data-sched]`.
 *
 * REBUILT FROM SCRATCH 2026-08-20 against the supplied reference
 * (`Proovd Founder Flow v2.dc.html`, `[data-sched]` / `kindWide`) and its
 * screenshot. The surface that stood here was Session D's `AnswerPage` layout —
 * a trail line, the optional tag, the question as the heading, a booking `Card`
 * and two `StatePanel`s. None of that is left. What replaced it is the
 * reference's own composition: a pill, one headline, three platform tiles, four
 * time chips, and one `Next`.
 *
 * ── The picker is no longer refused, and the reason it was is now moot ─────
 * `FOUNDER_FLOW_ABSENCES` carried an entry refusing these tiles and chips,
 * because "a picker of our own is a second scheduler". Building it made that
 * entry untrue, so it is removed rather than left standing — a register saying
 * an element is absent while the page renders it is worse than no register (the
 * `EmailStep` precedent).
 *
 * It is not a second scheduler, and the thing that decides that is which STATUS
 * it can write. `POST .../interview` → `recordBooking` always writes
 * `selected`, and §12 is explicit that a slot somebody picked and nobody
 * confirmed does not complete the item. `confirmed` is reachable only from the
 * Cal.com webhook or from an Admin reconciling a missed delivery (tech-stack
 * §12, and Phase 09's own trap — don't leave `confirmed` reachable only by
 * webhook). So the tiles and chips are the SELECTION half of the model this
 * product already had, and the route they drive has existed since Phase 09a
 * with no frontend caller at all — reachable only from the Admin workspace.
 *
 * ── The layout model is the reference's, not an approximation of it ────────
 * Authored once on a fixed 2496x1542 stage and scaled to the viewport by
 * `fitStages()`:
 *
 *     let s = Math.min(innerWidth/2496, innerHeight/1542) * (pageScale || .78);
 *
 * No branch of that function names this screen — `c` is `vetting` and
 * `vReviewing` is false at `vStep` 5 — so it takes `pageScale` alone. Every
 * child below carries the reference's own pixel value on that stage: a 44px
 * pill under 26/46 padding, a 121px headline 72px below it, a 110px gap to the
 * panel, 260px tiles in a 30px grid, 130px chips in a 26px grid, 62px between
 * the two sections, and a 165px CTA 130px down. Nothing reflows; the stage
 * scales, which is why the composition is identical at every viewport.
 *
 * `isClaimPhone()` returns `false` in the reference — one composition
 * everywhere — so its `kindPhone` branch is dead code there and this is what
 * every viewport gets, exactly as there.
 *
 * ── The column's width comes from a sentence that is not on this screen ────
 * The reference's own first child is the VISUALS headline, measured and thrown
 * away, so the stage-3 screens share one column width. Reproduced verbatim
 * rather than replaced with the number it computes to, because the number is a
 * font measurement: a hardcoded width would be right on this machine and wrong
 * the moment the face is revised. `aria-hidden`, `visibility:hidden` and
 * `height:0` are all three of its own, so it is in no accessibility tree and
 * takes no space.
 *
 * ── The four slots are the reference's labels over real instants ───────────
 * `this.SLOTS=['Tue 10:00','Wed 14:00','Thu 09:30','Fri 16:00']` — a mock, with
 * no date behind it. `recordBooking` needs a real `scheduledAt`, so each label
 * resolves to the NEXT occurrence of that weekday and time in the viewer's own
 * zone. The visible copy is the reference's, byte for byte; the accessible name
 * carries the date it resolved to, because `Tue 10:00` alone does not say which
 * Tuesday and a screen reader has nothing else to go on.
 *
 * They are computed from a fixed clock captured once on mount rather than read
 * per render: `new Date()` inside the map would let a chip's instant move
 * between the render that displayed it and the click that books it.
 *
 * ── Two independent absences, and the screen says which ────────────────────
 * §6 names the interview providers, availability, interviewers and reminder
 * lead time as settings and fixes none of them; Cal.com is Track A4. Either
 * missing means nothing to book, and they are different problems for different
 * people — the server folds them into `bookable` and `embed.available`, and
 * this reports which (§1.4, §27.1).
 *
 * While `bookable` is false the chips still render exactly as the reference
 * draws them and are `aria-disabled` rather than `disabled`, so a keyboard user
 * meets the explanation a sighted user can see (§28.5, the Support workspace's
 * own rule). Offering a slot nobody is available for is §1.4's failure with a
 * border on it; removing the chips would not be this screen.
 *
 * ── §12's rule is confirmation, and the screen says which state it is in ───
 * "A selected-but-unconfirmed, canceled, or abandoned slot does not count."
 * Those are five different facts and a Founder who picked a time is entitled to
 * know their US$2 is not earned yet, so the record below the CTA names the
 * state rather than showing a date and leaving it at that. It is absolutely
 * positioned under the column, in the room the composition already leaves, so
 * not one reference box moves for it.
 *
 * ── The bell carries a count of reading, never a count of messages ─────────
 * The reference's is `mailCount: 2 + Math.max(0, vStep - 3)` — four at `vStep`
 * 5, which is what the screenshot shows. There is no inbox in this product and
 * an unread count over a message system that does not exist is §1.4's failure
 * with a number on it. The badge carries the number of reading cards the drawer
 * actually holds, derived from `FOUNDER_FLOW_PAGES`, and the control opens that
 * drawer — which is what the reference's does too.
 *
 * It does not shake. The reference loops it every six seconds for as long as
 * the page is open; `FlowPage` has recorded since Session B that an element
 * moving indefinitely to draw attention is the pattern DNA §5.10 and §30 name,
 * whatever it opens.
 *
 * ── §12's lock ────────────────────────────────────────────────────────────
 * After the listing fee is paid the calculation and its evidence lock, and the
 * server refuses a write. The reference has no such state; the record says so
 * and offers nothing rather than offering a control the server will refuse.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { founderFlowIndex, founderFlowPath, type MeetingProvider } from '@proovd/shared';
import { SurfaceLoading } from '../../features/public/states.js';
import { StatePanel, NO_ACTION } from '../../components/index.js';
import { stageRelayIn } from '../../components/anim.js';
import {
  bookInterview,
  cancelInterview,
  FounderRequestError,
  type WorkspaceState,
} from '../founder/api.js';
import { InterviewEmbed } from '../founder/InterviewBooking.js';
import { FlowPage, HelpDrawer, flowDirection, useFlowNav } from './FlowPage.js';
import { useSetupWorkspace } from './useSetup.js';

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()` for a page it treats as ordinary: the stage's own size as the
   divisors and `pageScale` alone. */

const FIT_W = 2496;
const FIT_H = 1542;
/** The prototype's `pageScale` prop default. */
const PAGE_SCALE = 0.78;

function stageScale(): number {
  return Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * PAGE_SCALE;
}

/**
 * The reference's own relay order for this screen, out of `verifyIntro`'s fixed
 * list `pill, head, field, boxes, note, fee, sub, hint, panel, art, art2, cta,
 * edit`. Passed to `stageRelayIn` rather than read from the DOM, because the
 * 0.085s stagger follows THAT order and not document order.
 */
const RELAY = ['pill', 'head', 'panel', 'cta'] as const;

/**
 * `this.PLATFORMS`, in the reference's own order, against this product's own
 * stored values.
 *
 * The reference's ids are `meet` / `zoom` / `teams`; the stored values are
 * `MEETING_PROVIDERS` — `google_meet` / `zoom` / `microsoft_teams` — so the id
 * is this product's and the LABEL is the reference's, which is the one place
 * the two disagree: `MEETING_PROVIDER_LABELS` spells the third one
 * `Microsoft Teams` and the reference's tile says `Teams`.
 *
 * The reference wins on the label, because the brief for this screen is a
 * reproduction and the tile word is part of the composition. Both names are the
 * same product written long and short, so nothing is misleading and neither is
 * an internal name (§3.1) — the register keeps owning what §27.3's four
 * interview emails and the Admin workspace say. This screen uses ONE name per
 * provider throughout: the tile and the booking record below the CTA both read
 * from here, so the page can never say `Teams` in one place and
 * `Microsoft Teams` in another.
 */
const PLATFORMS = [
  { id: 'google_meet', icon: 'meet', label: 'Google Meet' },
  { id: 'zoom', icon: 'zoom', label: 'Zoom' },
  { id: 'microsoft_teams', icon: 'teams', label: 'Teams' },
] as const satisfies readonly { id: MeetingProvider; icon: string; label: string }[];

/** The name this screen shows for a stored provider value. */
function platformLabel(id: string | null): string | null {
  return PLATFORMS.find((p) => p.id === id)?.label ?? null;
}

/**
 * `this.SLOTS`, verbatim, plus the weekday and time each one names.
 *
 * `day` is `Date.getDay()` — Sunday 0. The label is the reference's own string
 * and the pair beside it is what makes an instant out of it; they are declared
 * together so a label cannot drift from the time it resolves to.
 */
const SLOTS = [
  { label: 'Tue 10:00', day: 2, hour: 10, minute: 0 },
  { label: 'Wed 14:00', day: 3, hour: 14, minute: 0 },
  { label: 'Thu 09:30', day: 4, hour: 9, minute: 30 },
  { label: 'Fri 16:00', day: 5, hour: 16, minute: 0 },
] as const;

/**
 * The four slots as real instants, all inside ONE week and in the order the
 * reference draws them.
 *
 * The obvious reading — "the next Tuesday, the next Wednesday, …" — resolves
 * each label independently, and on a Friday that puts `Fri 16:00` four days
 * BEFORE `Tue 10:00` while the chips still read left to right Tue, Wed, Thu,
 * Fri. A time picker whose options are not in time order is a booking somebody
 * makes by mistake, so the week is anchored once: the first label decides it,
 * and the rest are day offsets from there. `SLOTS` is in ascending weekday
 * order, so every offset is forward and every instant is after the anchor —
 * which is itself strictly in the future.
 *
 * Local, because the label is local: `Tue 10:00` means ten in the morning where
 * the Founder is, and the record stores their zone beside the instant for
 * exactly that reason. Built from the `{y, m, d}` parts rather than by adding
 * milliseconds, so a slot that crosses a DST boundary still lands at the hour
 * on its own face.
 */
function resolveSlots(now: Date): { label: string; at: Date }[] {
  const first = SLOTS[0];
  const anchor = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    first.hour,
    first.minute,
    0,
    0,
  );
  let ahead = (first.day - anchor.getDay() + 7) % 7;
  if (ahead === 0 && anchor.getTime() <= now.getTime()) ahead = 7;
  anchor.setDate(anchor.getDate() + ahead);

  return SLOTS.map((slot) => {
    const at = new Date(anchor);
    at.setDate(at.getDate() + (slot.day - first.day));
    at.setHours(slot.hour, slot.minute, 0, 0);
    return { label: slot.label, at };
  });
}

/** §12's five booking states, in the words a Founder needs (§3.1). */
const BOOKING_STATE: Record<string, { tag: string; line: string }> = {
  selected: {
    tag: 'Not confirmed yet',
    line: 'You picked this time and nobody at Proovd has confirmed it, so it does not count towards your listing fee yet. We will email you when it is confirmed.',
  },
  confirmed: {
    tag: 'Confirmed',
    line: 'This is booked. It counts towards your listing fee.',
  },
  rescheduled: {
    tag: 'Moved',
    line: 'This booking was moved. It counts once the new time is confirmed.',
  },
  canceled: {
    tag: 'Canceled',
    line: 'This booking was canceled, so it does not count towards your listing fee. Pick another time.',
  },
  abandoned: {
    tag: 'Never confirmed',
    line: 'This time came and went without being confirmed, so it does not count. Pick another.',
  },
};

/** Whether a booking still occupies the slot — `recordBooking` refuses a second. */
const LIVE = new Set(['selected', 'confirmed']);

export function InterviewStep() {
  const { campaignId = '' } = useParams();
  const setup = useSetupWorkspace(campaignId);

  if (setup.failure) {
    return (
      <FlowPage pageId="interview" param={campaignId}>
        <div className="ff-int__failure">
          <StatePanel
            state="We could not open your campaign"
            whatHappened={setup.failure}
            next="Reload the page. Nothing you have saved is affected — this is only about reading it back."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
            ring
          />
        </div>
      </FlowPage>
    );
  }

  if (!setup.state) {
    return <SurfaceLoading subject="your interview" reference="Your campaign" />;
  }

  return (
    <FlowPage pageId="interview" param={campaignId}>
      <InterviewScreen campaignId={campaignId} state={setup.state} refresh={setup.refresh} />
    </FlowPage>
  );
}

/** Split from the loader so `useFlowNav` — which only exists under `FlowPage` — is available. */
function InterviewScreen({
  campaignId,
  state,
  refresh,
}: {
  campaignId: string;
  state: WorkspaceState;
  refresh: (promise: Promise<{ workspace: WorkspaceState }>) => Promise<void>;
}) {
  const { leave, leaveToPage } = useFlowNav();
  const [params] = useSearchParams();
  const fromReview = params.get('from') === 'review';

  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  // Read once, during the first render: `FlowPage` resets the module value in
  // its own layout effect, and a later re-render would read the reset.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  const interview = state.interview;
  const booking = interview.booking;
  const live = booking !== null && LIVE.has(booking.status);
  const locked = state.listingPaid;

  /* The chips' instants. One clock, captured on mount — see the header. */
  const [now] = useState(() => new Date());
  const slots = useMemo(() => resolveSlots(now), [now]);

  /* `st.ans.interview.platform` and `.slot`. Seeded from a live booking where
     one matches, so returning to the page shows what was booked rather than an
     empty picker — and left empty where it does not, because a tile selected
     against a booking it does not describe is worse than none. */
  const [platform, setPlatform] = useState<MeetingProvider | null>(
    () =>
      (PLATFORMS.find((p) => p.id === booking?.provider)?.id as MeetingProvider | undefined) ??
      null,
  );
  const [slotLabel, setSlotLabel] = useState<string | null>(() => {
    if (!booking?.scheduledAt) return null;
    const at = new Date(booking.scheduledAt);
    return slots.find((s) => s.at.getTime() === at.getTime())?.label ?? null;
  });

  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  // `fitStages`, for this screen. First, so the first paint is already at the
  // right scale — and on resize, because the reference refits there too.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      el.style.transform = `translate(-50%, -50%) scale(${stageScale()})`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // The entrance — `verifyIntro`'s `runRelay`, which is all this screen gets:
  // it has no `[data-anim="grow"]`, no cupids, no `[data-flourish]`, and it is
  // neither `[data-lastlook]` nor `[data-paynow]`, so every one of that
  // function's earlier branches is false.
  useLayoutEffect(() => stageRelayIn(root.current, direction.current ?? 1, RELAY), []);

  const bookable = interview.bookable && !locked && !live;

  /** Why a chip or tile cannot be operated, in the words that name which. */
  const blockedBecause = locked
    ? 'Your listing fee is paid, so this is locked as it was checked.'
    : live
      ? 'There is already an interview on this campaign. Cancel it below to pick another time.'
      : null;

  const pick = useCallback(
    (run: () => void) => {
      if (blockedBecause) {
        setSaid(blockedBecause);
        return;
      }
      setFailure(null);
      run();
    },
    [blockedBecause],
  );

  /**
   * `schedNext:()=>this.afterSection({vStep:6})` — Your story, or Last look
   * when the step was opened from there.
   *
   * The reference always advances, because its picker records nothing. This one
   * records first when there is something to record, and does NOT advance on a
   * refusal: telling somebody they had booked a time when the server declined
   * it is the §1.4 failure this whole screen is careful about. Everything else
   * — nothing chosen, nothing bookable, a booking already live — advances, as
   * there. §12 makes the answer optional and skipping it costs nothing else.
   */
  const next = useCallback(async () => {
    const go = () => leave(founderFlowPath(fromReview ? 'last-look' : 'story', campaignId), 1);

    const chosen = slots.find((s) => s.label === slotLabel);
    if (!bookable || !platform || !chosen) {
      go();
      return;
    }

    setBusy(true);
    setFailure(null);
    try {
      await refresh(
        bookInterview(campaignId, {
          meetingProvider: platform,
          scheduledAt: chosen.at.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        }),
      );
      go();
    } catch (error) {
      /* The server's refusals are §27.1-shaped and say which of the two
         absences stopped it — `recordBooking` names the missing §6 settings in
         `next`, and `already_live` names the booking in the way. The bare
         `title` is a heading; what a Founder can act on is the pair under it.
         Falling back to a sentence of our own rather than to `error.message`,
         which is that same title. */
      const detail =
        error instanceof FounderRequestError
          ? [error.detail.whatHappened, error.detail.next].filter(Boolean).join(' ')
          : '';
      setFailure(
        detail ||
          'We could not record that time. Nothing has been booked and nothing else on this page has changed.',
      );
    } finally {
      setBusy(false);
    }
  }, [bookable, platform, slotLabel, slots, campaignId, refresh, leave, fromReview]);

  // Announce a refusal once it renders, so it is not only a visible sentence.
  useEffect(() => {
    if (failure) setSaid(failure);
  }, [failure]);

  const readingCount = founderFlowIndex('interview') + 1;
  const described = booking ? BOOKING_STATE[booking.status] : undefined;

  return (
    <div className="ff-int" ref={root}>
      {/* The reference's own control, bottom-left. `back()` at `vStep` 5 goes to
          `vStep` 4 with `brandStage='colors'` — which is Your brand colours,
          not the logo screen before it. That page did not exist when this screen
          was rebuilt, so Back pointed at `branding`; it points at `color` now.
          Or to Last look when the step was opened from there, which is this
          product's own `?from=review` contract. Its label names where it goes
          only to a screen reader: the visible word is the reference's own
          `Back`. */}
      <button
        type="button"
        className="ff-int__back"
        aria-label={fromReview ? 'Back to Last look' : 'Back to Your brand colours'}
        onClick={() => leaveToPage(fromReview ? 'last-look' : 'color', -1)}
      >
        <svg
          viewBox="0 0 24 24"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 5 8 12l7 7" />
        </svg>
        Back
      </button>

      <div className="ff-int__top">
        {/* Not a link. A campaign's own half-finished form is not a site, and
            the way out of one should not be the brand. */}
        <img className="ff-int__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        <HelpDrawer
          pageId="interview"
          param={campaignId}
          trigger={
            <button type="button" className="ff-int__help">
              Help
            </button>
          }
        />
      </div>

      {/* The reference's mail bell, bottom-right, opening the same drawer HELP
          does. See the header for what its number is and is not. */}
      <HelpDrawer
        pageId="interview"
        param={campaignId}
        trigger={
          <button
            type="button"
            className="ff-int__mailbtn"
            aria-label={`Help and reading — ${readingCount} pages`}
          >
            <span className="ff-int__mail" aria-hidden="true">
              <img src="/assets/mail.webp" alt="" />
              <span className="ff-int__mailcount">{readingCount}</span>
            </span>
          </button>
        }
      />

      <div className="ff-int__stage" data-page-stage="1" ref={stage}>
        <div className="ff-int__col">
          {/* See the header. The visuals headline, measured and discarded, so
              the stage-3 screens share one column width. */}
          <span aria-hidden="true" className="ff-int__measure">
            We want to see your product...
          </span>

          {/* §12 calls this optional and worth a discount, and the reference
              says both in one pill. The amount is NOT restated: the reference
              hardcodes `$2` and §6 makes it `listing_fee_item_discount_cents`,
              so it renders what the server computed and nothing when there is
              no calculation to read (Phase 06's rule). */}
          <span className="ff-int__pill" data-stage-anim="pill">
            {state.fee?.itemDiscountCents
              ? `optional: $${(Number(state.fee.itemDiscountCents) / 100).toFixed(
                  Number(state.fee.itemDiscountCents) % 100 === 0 ? 0 : 2,
                )} discount`
              : 'optional: lowers your listing fee'}
          </span>

          <h1 className="ff-int__head" data-stage-anim="head">
            Book your founder interview
          </h1>

          <div className="ff-int__panel" data-stage-anim="panel">
            <span className="ff-int__label" id="ff-int-how">
              Choose how to meet
            </span>
            <div className="ff-int__tiles" role="group" aria-labelledby="ff-int-how">
              {PLATFORMS.map((entry) => {
                const on = platform === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={on ? 'ff-int__tile is-on' : 'ff-int__tile'}
                    aria-pressed={on}
                    aria-disabled={blockedBecause ? true : undefined}
                    onClick={() => pick(() => setPlatform(entry.id))}
                  >
                    <span className="ff-int__icon" aria-hidden="true">
                      <PlatformIcon kind={entry.icon} />
                    </span>
                    <span className="ff-int__tilelabel">{entry.label}</span>
                  </button>
                );
              })}
            </div>

            <span className="ff-int__label ff-int__label--time" id="ff-int-when">
              Pick a time
            </span>
            <div className="ff-int__slots" role="group" aria-labelledby="ff-int-when">
              {slots.map((slot) => {
                const on = slotLabel === slot.label;
                return (
                  <button
                    key={slot.label}
                    type="button"
                    className={on ? 'ff-int__slot is-on' : 'ff-int__slot'}
                    aria-pressed={on}
                    aria-disabled={blockedBecause ? true : undefined}
                    /* The reference's `Tue 10:00` does not say which Tuesday,
                       and a screen reader has nothing else to go on. */
                    aria-label={slot.at.toLocaleString(undefined, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                    onClick={() => pick(() => setSlotLabel(slot.label))}
                  >
                    {slot.label}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            className="ff-int__cta"
            data-stage-anim="cta"
            aria-label={fromReview ? 'Next — back to Last look' : 'Next — your story'}
            disabled={busy}
            onClick={() => void next()}
          >
            Next
          </button>

          {/* Absolutely positioned under the column, in the room the
              composition already leaves, so no reference box moves for any of
              it. Everything here is a state the reference does not have: it
              holds its answer in memory and has nothing to record, refuse or
              lock. */}
          <div className="ff-int__state">
            {failure ? <p className="ff-int__failline">{failure}</p> : null}

            {booking && described ? (
              <p className="ff-int__record">
                <span
                  className={
                    booking.status === 'confirmed'
                      ? 'ff-int__tag ff-int__tag--on'
                      : 'ff-int__tag'
                  }
                >
                  {described.tag}
                </span>
                <span className="ff-int__recordline">
                  {booking.scheduledAt
                    ? new Date(booking.scheduledAt).toLocaleString(undefined, {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZoneName: 'short',
                      })
                    : 'No time set yet'}
                  {platformLabel(booking.provider) ? ` · ${platformLabel(booking.provider)}` : ''}
                  {' — '}
                  {described.line}
                </span>
                {live && !locked ? (
                  <button
                    type="button"
                    className="ff-int__mini"
                    onClick={() =>
                      void refresh(
                        cancelInterview(
                          campaignId,
                          booking.id,
                          'Canceled by the Founder from the setup flow',
                        ),
                      )
                    }
                  >
                    Cancel this interview
                  </button>
                ) : null}
              </p>
            ) : null}

            {blockedBecause && !live ? (
              <p className="ff-int__note">{blockedBecause}</p>
            ) : null}

            {/* §12's own mechanism, where a Founder can reach it. The picker
                records the selection; this is where the provider confirms it,
                and `embed.available` is false while Cal.com is unconfigured. */}
            {interview.embed.available &&
            interview.embed.eventTypeLink &&
            interview.embed.reference &&
            !live ? (
              <details className="ff-int__embed">
                <summary>Book it on the calendar instead</summary>
                <InterviewEmbed
                  eventTypeLink={interview.embed.eventTypeLink}
                  reference={interview.embed.reference}
                />
              </details>
            ) : null}
          </div>

          <p className="ff-int__live sr-only" role="status" aria-live="polite">
            {said}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The three brand marks, from the reference's own inline SVG.
 *
 * Inline rather than files, exactly as there: they are three shapes on one
 * screen and a request each is three round trips for something that never
 * changes. Every path, viewBox and fill below is the reference's.
 */
function PlatformIcon({ kind }: { kind: string }) {
  if (kind === 'meet') {
    return (
      <svg viewBox="0 0 87 72" width="92" height="75" aria-hidden="true">
        <path fill="#00832d" d="M49.5 36l8.53 9.75 11.47 7.33 2-17.02-2-16.64-11.69 6.44z" />
        <path fill="#0066da" d="M0 51.5V66c0 3.315 2.685 6 6 6h14.5l3-10.96-3-9.54-9.95-3z" />
        <path fill="#e94235" d="M20.5 0L0 20.5l10.55 3 9.95-3 2.95-9.41z" />
        <path fill="#2684fc" d="M20.5 20.5H0v31h20.5z" />
        <path
          fill="#00ac47"
          d="M82.6 8.68L69.47 19.42v33.66l13.19 10.79c1.97 1.54 4.85.13 4.85-2.37V11c0-2.54-2.95-3.93-4.91-2.32zM49.5 36v15.5h-29V72h43c3.315 0 6-2.685 6-6V53.08z"
        />
        <path fill="#ffba00" d="M63 0H20.5v20.5h29V36l20-16.57V6c0-3.315-2.685-6-6-6z" />
      </svg>
    );
  }
  if (kind === 'zoom') {
    return (
      <svg viewBox="0 0 48 48" width="92" height="92" aria-hidden="true">
        <rect width="48" height="48" rx="11" fill="#2D8CFF" />
        <path
          fill="#fff"
          d="M11 18.5A2.5 2.5 0 0 1 13.5 16h13a2.5 2.5 0 0 1 2.5 2.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 11 29.5zm21 2.2l4.2-2.7c.5-.32 1.3-.3 1.3.55v10.9c0 .85-.8.87-1.3.55L32 27.3z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" width="92" height="92" aria-hidden="true">
      <circle cx="35" cy="14" r="6.5" fill="#7B83EB" />
      <rect x="6" y="14" width="26" height="22" rx="4" fill="#5059C9" />
      <path fill="#fff" d="M11.5 19.5h15v3.7h-5.7v11.3h-3.6V23.2h-5.7z" />
    </svg>
  );
}
