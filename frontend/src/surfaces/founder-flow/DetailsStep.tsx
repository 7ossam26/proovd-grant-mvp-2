/**
 * Screen 16 — Your details — Founder Flow v2.
 *
 * BUILT FROM SCRATCH 2026-08-21 to the supplied reference
 * (`Proovd Founder Flow v2.dc.html`, `[data-hello]` / `kindWide`), on the terms
 * every 1:1 screen in this flow ships under: the reference outranks the design
 * system HERE, and nowhere else. It is inserted where the reference puts it —
 * Last look's `allGood` is `{si: I('intake')}`, and `intake` is this page.
 *
 * ── The layout model is the reference's, literally ─────────────────────────
 * `position: fixed; inset: 0; overflow: hidden` around a fixed 2496x1542 stage
 * scaled to the viewport by `fitStages()`:
 *
 *     let s = min(innerWidth/2496, innerHeight/1542) * (pageScale || .78);
 *     if (!hero && c === 'intake') s *= .92;   // "the details card runs tall"
 *
 * Verified in a browser against the reference: at 1280x800 its stage matrix
 * reads `0.368`, and `min(1280/2496, 800/1542) * .78 * .92` is `0.36800`.
 * Nothing here reflows; the stage scales instead, which is why the composition
 * is identical at every viewport (§33.11.1). `isClaimPhone()` returns `false`
 * in the reference — "one composition everywhere: the phone posture stays off"
 * — so its `kindPhone` branch is dead code and this is what every viewport
 * gets, exactly as there.
 *
 * ── The relay order is the reference's own list, not document order ────────
 * `verifyIntro` maps a fixed sequence — `pill, head, field, boxes, note, fee,
 * sub, hint, panel, art, art2, cta, edit` — over the page and relays whatever
 * it finds. Three exist here, and in that order they are `panel, art, cta`,
 * which is NOT the order they appear in the markup. Sampled frame by frame
 * against the reference: panel starts at 12ms, art at 96ms, cta at 179ms —
 * the 0.085s stagger over the mapped list. `cta` is a child of `panel` and is
 * relayed anyway, because the reference relays both.
 *
 * ── The greeting is an `h1`, and that is the one semantic departure ────────
 * The reference draws this page with no heading element at all: its greeting
 * is a `<span>`, and a person arriving here from a bookmark has nothing naming
 * the page (§33.11.2). It is an `h1` with `margin: 0`, `font-weight: 700` and
 * `line-height: normal` — the project's `h1..h6` globals reset — so the box it
 * occupies is identical to the reference's span, measured. Nothing about the
 * picture changes; what changes is that a screen reader can find the page.
 *
 * ── The name is shown and never asked for ──────────────────────────────────
 * The reference's field is a label and a value, not an input, and `helloName`
 * falls back to a literal `AhmedEhab`. Here it is the Founder's own recorded
 * name; `legal_name` is what Stripe is later given, and §5.2 keeps changing it
 * on the guarded settings path with its own reason and its own audit row, so
 * there is deliberately no control for it on this screen.
 *
 * ── Next is not gated; Enter is, and the reference does both ───────────────
 * `helloNext` advances unconditionally, so the visible control never refuses.
 * `enterAdvance` is a different path — a document-level keydown that runs
 * `ctaState()` first, and this page's entry is
 *
 *     const ok = p.name.trim() && p.phone.trim() && age !== null && age >= 18;
 *     return { show: true, label: 'Continue', blocked: !ok };
 *
 * so a stray Enter with the form half-filled does nothing while the button
 * beside it would have worked. That asymmetry is deliberate there and is kept:
 * a keystroke is not a decision, and this is the last data-entry screen before
 * the Match beat and payout setup. It also bails inside a textarea, with the
 * help drawer open, or with the calendar open — the reference's own three
 * exemptions.
 *
 * The 18+ arithmetic is `dobAge()`'s, and it decides ONLY that keystroke. §10
 * collects the date and lists the 18+ representation separately, as something
 * the Founder states; Proovd derives no age and never claims to have verified
 * one, and nothing on the server reads this number.
 *
 * The gate's first term is the one place this cannot be literal. The prototype
 * initialises `profile.name` to `''` and gives this screen no name INPUT — the
 * value it shows is a display fallback — so `p.name.trim()` is never satisfied
 * and Enter is dead there, verified by pressing it. Here the name comes from
 * the record and is normally present, so the rule is reproduced and the gap it
 * has in the prototype is not: reproducing "Enter never works" would be
 * reproducing a missing input rather than a behaviour.
 *
 * ── Back goes to Last look, and the reference's own answer is an artefact ──
 * There, Last look is `vetting` with `vReviewing` set, so `back()` falls
 * through to `si - 1` and lands on the last vetting ANSWER rather than on the
 * review somebody actually came from. In this product every page is an address
 * and `vReviewing` does not exist, so the linear convention wins — the same
 * decision `ConfirmProblem` records for the same reason.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { StatePanel, NO_ACTION } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import {
  dobCellPop,
  dobMonthsFade,
  dobPanelClose,
  dobPanelOpen,
  dobPanelPlace,
  dobYearsPage,
  stageRelayIn,
} from '../../components/anim.js';
import { FlowPage, HelpDrawer, flowDirection, useFlowNav } from './FlowPage.js';
import { preloadMatchArtwork } from './MatchStep.js';
import {
  fetchFounderDetails,
  saveFounderDetails,
  FounderRequestError,
  type FounderDetails,
} from '../founder/api.js';

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()`, including the branch that names this screen. */

const FIT_W = 2496;
const FIT_H = 1542;
/** The prototype's `pageScale` prop default. */
const PAGE_SCALE = 0.78;
/** `if (!hero && c === 'intake') s *= .92;` — "the details card runs tall". */
const INTAKE_SCALE = 0.92;

function stageScale(): number {
  return (
    Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) *
    PAGE_SCALE *
    INTAKE_SCALE
  );
}

/** `verifyIntro`'s fixed list, filtered to what this page has. */
const RELAY = ['panel', 'art', 'cta'] as const;

/* ── The copy, verbatim ────────────────────────────────────────────────────
   Every string below is the reference's own. `Next` is not in §33.11.4's
   `OBJECTLESS_CTA_LABELS`; `Back` is, and is answered by the accessible name
   rather than by overriding the reference's visible word. */

const GREETING = 'Good to have you!';
const NAME_LABEL = 'Username:';
const PHONE_LABEL = 'Phone Number:';
const PHONE_PLACEHOLDER = '+1 (---) ------';
const DOB_LABEL = 'Birthdate:';
const DOB_EMPTY = 'Pick your date of birth';
const CLEAR = 'Clear';
const CTA_LABEL = 'Next';
/** Not the reference's — it has a record in memory and no name to be missing. */
const NAME_ABSENT = 'Not on file yet';

/* ── The calendar's own vocabulary ─────────────────────────────────────────
   `this.MONTHS` and the two shorter lists, verbatim. */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
/** `['S','M','T','W','T','F','S']` — Sunday first, as `getDay()` counts. */
const DOWS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** `dobBase`'s floor, and `dobYears`' page size. */
const YEAR_FLOOR = 1940;
const YEAR_PAGE = 12;

interface View {
  y: number;
  m: number;
}

/** `dobPretty()` — `1 Jan 1990`. */
function pretty(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}`;
}

/** `dobView()` — the stored date's month, or January of this year. */
function viewFor(iso: string | null): View {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (m) return { y: Number(m[1]), m: Number(m[2]) - 1 };
  return { y: new Date().getFullYear(), m: 0 };
}

/** `dobBase()` — the decade page a year falls on. */
function baseFor(year: number): number {
  return Math.max(
    YEAR_FLOOR,
    Math.floor((year - YEAR_FLOOR) / YEAR_PAGE) * YEAR_PAGE + YEAR_FLOOR,
  );
}

/**
 * Today, as `YYYY-MM-DD` in the viewer's own timezone.
 *
 * Built from the three integers rather than from `toISOString()`, which is UTC
 * and puts "today" a day out for anybody west of London — on a calendar that
 * greys out the future, that is a day nobody can pick.
 */
function todayIso(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function isoOf(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * `dobAge()`, verbatim — and it decides one keystroke and nothing else.
 *
 * Three integers rather than a `Date` difference: `new Date('1990-01-31')`
 * parses as UTC midnight and reads as the 30th west of London, which on a
 * birthday is an off-by-one only some people would ever see.
 */
function ageFrom(iso: string | null): number | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return null;
  const now = new Date();
  let age = now.getFullYear() - Number(m[1]);
  const months = now.getMonth() - (Number(m[2]) - 1);
  if (months < 0 || (months === 0 && now.getDate() < Number(m[3]))) age -= 1;
  return age;
}

export function DetailsStep() {
  const { campaignId = '' } = useParams();
  const [details, setDetails] = useState<FounderDetails | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    // The next screen's three large reference PNGs must be decoded before its
    // exact GSAP timeline begins; see `preloadMatchArtwork`.
    void preloadMatchArtwork();

    let cancelled = false;
    fetchFounderDetails(campaignId)
      .then(({ details: next }) => {
        if (!cancelled) setDetails(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof FounderRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'We could not read your details.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  return (
    <FlowPage pageId="details" param={campaignId}>
      <Screen
        campaignId={campaignId}
        details={details}
        failure={failure}
        onDetails={setDetails}
      />
    </FlowPage>
  );
}

function Screen({
  campaignId,
  details,
  failure,
  onDetails,
}: {
  campaignId: string;
  details: FounderDetails | null;
  failure: string | null;
  onDetails: (next: FounderDetails) => void;
}) {
  const { leave, leaveToPage, swapToPage } = useFlowNav();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  // Read once, during the first render: `FlowPage` resets the module value in
  // its own layout effect, and a later re-render would read the reset.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  /* The typed value never comes back from the server (§9's rule): the box is
     the only copy of what was typed, and a save that raced a keystroke must not
     reinstate a digit somebody had just deleted. */
  const [phone, setPhone] = useState<string | null>(null);
  const [dob, setDob] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const seeded = useRef(false);

  if (details && !seeded.current) {
    seeded.current = true;
    setPhone(details.phone ?? '');
    setDob(details.dateOfBirth);
  }

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
  }, [details]);

  // The relay. It waits for the record, because the panel cannot travel before
  // there is a panel.
  useLayoutEffect(() => {
    if (!details) return;
    return stageRelayIn(root.current, direction.current ?? 1, RELAY);
  }, [details]);

  const save = useCallback(
    async (patch: { phone?: string | null; dateOfBirth?: string | null }) => {
      try {
        const { details: next } = await saveFounderDetails(campaignId, patch);
        onDetails(next);
        setSaveError(null);
      } catch (error) {
        setSaveError(
          error instanceof FounderRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'We could not save that just now. It is still in the box — try again.',
        );
      }
    },
    [campaignId, onDetails],
  );

  /** `helloNext`, plus the one flush the reference has no server to need. */
  const advance = useCallback(() => {
    if ((phone ?? '') !== (details?.phone ?? '')) void save({ phone });
    // The reference swaps `intake` to `match` immediately. The arriving Match
    // screen owns the full transition, so there is no outgoing page fade here.
    swapToPage('match');
  }, [phone, details, save, swapToPage]);

  /*
    `enterAdvance`, with its three exemptions and its `ctaState()` gate.

    Bound on `document` as it is there, so a keystroke anywhere on the page
    counts. A textarea is exempt in the reference and there is none here; the
    check is kept anyway, because it is what the rule IS rather than what this
    page happens to contain. The drawer and the calendar are read from the DOM
    — an open Radix dialog and a mounted `[data-cal]` are the same two facts
    `this.state.drawer` and `this.state.dobOpen` carry there.
  */
  useEffect(() => {
    if (!details) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement) return;
      if (active?.closest('[role="dialog"]')) return;
      if (document.querySelector('[data-cal]')) return;

      const age = ageFrom(dob);
      const ok =
        !!details.name?.trim() && !!(phone ?? '').trim() && age !== null && age >= 18;
      if (!ok) return;
      advance();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [details, phone, dob, advance]);

  return (
    <div className="ff-hl" ref={root}>
      {/* The reference's own control, bottom-left. Its label names where it
          goes only to a screen reader: the visible word is `Back`. */}
      <button
        type="button"
        className="ff-hl__back"
        aria-label="Back to Last look"
        onClick={() => leaveToPage('last-look', -1)}
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

      <div className="ff-hl__top">
        {/* Not a link. A draft address is not a site, and the way out of a
            Founder's own half-finished form should not be the brand. */}
        <img className="ff-hl__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        <HelpDrawer
          pageId="details"
          param={campaignId}
          trigger={
            <button type="button" className="ff-hl__help">
              Help
            </button>
          }
        />
      </div>

      {failure ? (
        <div className="ff-hl__state">
          <StatePanel
            state="We could not open your details"
            whatHappened={failure}
            next="Reload the page. Nothing you have saved is affected — this is only about reading it back."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
            ring
          />
        </div>
      ) : !details ? (
        /* The reference holds its record in memory and never waits for one, so
           the loading state is ours. `Get help` is deliberately absent from it —
           a support control a fraction of a second into a read is one nobody
           needs — and on this screen it is in the chrome above regardless. */
        <div className="ff-hl__state">
          <SurfaceLoading subject="your details" reference="Your account" />
        </div>
      ) : (
        <div className="ff-hl__stage" data-page-stage="1" ref={stage}>
          <div className="ff-hl__grid">
            <img
              className="ff-hl__art"
              data-stage-anim="art"
              src="/assets/avatar.webp"
              alt=""
            />

            <div className="ff-hl__panel" data-stage-anim="panel">
              <h1 className="ff-hl__greet">{GREETING}</h1>

              <div className="ff-hl__row ff-hl__row--name">
                <span className="ff-hl__label">{NAME_LABEL}</span>
                <span className="ff-hl__value">{details.name ?? NAME_ABSENT}</span>
              </div>

              <div className="ff-hl__row ff-hl__row--phone">
                <label className="ff-hl__label" htmlFor="ff-hl-phone">
                  {PHONE_LABEL}
                </label>
                <input
                  id="ff-hl-phone"
                  className="ff-hl__input"
                  type="tel"
                  placeholder={PHONE_PLACEHOLDER}
                  value={phone ?? ''}
                  onChange={(event) => setPhone(event.target.value)}
                  onBlur={() => {
                    if ((phone ?? '') !== (details.phone ?? '')) void save({ phone });
                  }}
                />
              </div>

              <DobRow
                value={dob}
                onPick={(iso) => {
                  setDob(iso);
                  void save({ dateOfBirth: iso });
                }}
              />

              <button
                type="button"
                className="ff-hl__cta"
                data-stage-anim="cta"
                onClick={advance}
              >
                {CTA_LABEL}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chrome, not composition: the reference's column is a fixed vertical
          rhythm and one more line moves everything, so a save that failed says
          so on the layer the Back control and the wordmark already occupy. */}
      {saveError ? (
        <p className="ff-hl__foot" role="alert">
          {saveError}{' '}
          <button type="button" className="ff-hl__foot-link" onClick={() => leave('/support')}>
            Get help
          </button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The birthdate row, and the calendar under it.
 *
 * The panel is the reference's structure exactly: a `height: 0` relative holder
 * as the panel's fifth child, an absolutely positioned `scale(2.6)` box inside
 * it, and the calendar authored in ordinary CSS pixels within that. The stage
 * is at ~0.368 and the box at 2.6, so the calendar renders at ~0.957 of its
 * natural size — which is how the prototype keeps a calendar legible on a page
 * whose type is authored at 54px. It is reproduced as the mechanism rather than
 * as the resulting numbers, because the resulting numbers are viewport-relative
 * (`--cell`, `--small` and the rest are `vw` clamps evaluated against the real
 * window, not the stage).
 */
function DobRow({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (iso: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  /** `dobYearMode`. Reset to day mode on every open, as `dobToggle` does. */
  const [yearMode, setYearMode] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [base, setBase] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);

  const field = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const months = useRef<HTMLDivElement>(null);
  const pageDir = useRef<1 | -1>(1);

  const current: View = view ?? viewFor(value);
  const decadeBase = base ?? baseFor(current.y);
  const now = new Date().getFullYear();
  const decadeMax = Math.floor((now - YEAR_FLOOR) / YEAR_PAGE) * YEAR_PAGE + YEAR_FLOOR;
  const today = todayIso();

  /* `dobToggle`'s open: the panel grows from the field's own height to its
     natural height over 0.45s `power3.out`, its rows fade in behind that on a
     0.045s stagger after 0.16s, and if the grown panel would reach past the
     fold it lifts inside the same movement. */
  useLayoutEffect(() => {
    if (!open || closing) return;
    return dobPanelOpen(panel.current, field.current);
  }, [open, closing]);

  /* `dobYearMode()` — centre the month scroller on the month in view and fade
     it in. */
  useLayoutEffect(() => {
    if (!open || closing) return;
    if (!yearMode) return;
    const box = months.current;
    if (!box) return;
    const cur = box.querySelector<HTMLElement>(`[data-month="${current.m}"]`);
    if (cur) box.scrollTop = cur.offsetTop - box.clientHeight / 2 + cur.offsetHeight / 2;
    dobMonthsFade(box);
    // The scroll position is set once per entry into year mode; `current.m` is
    // read at that moment and must not re-run the effect as the scroller moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closing, yearMode]);

  /*
    `dobPlace()`, at the reference's own four call sites — after the year-mode
    toggle, after a year, after a month, and after a day. All four are the same
    fact, "the panel's content changed size", so here they are one effect over
    the mode and the month in view.

    It deliberately does NOT run on the first open: `dobPanelOpen`'s own
    measurement is the placement there, and re-placing on top of it would fight
    the growth tween. Without this the day-mode cap survives the swap and clips
    year mode — which is what the browser pass caught, as a missing `Clear`.
  */
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (!open || closing) {
      placed.current = false;
      return;
    }
    if (!placed.current) {
      placed.current = true;
      return;
    }
    dobPanelPlace(panel.current, field.current);
  }, [open, closing, yearMode, current.y, current.m, value]);

  const close = useCallback(
    (after?: () => void) => {
      setClosing(true);
      dobPanelClose(panel.current, field.current, () => {
        setClosing(false);
        setOpen(false);
        setYearMode(false);
        after?.();
      });
    },
    [],
  );

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    setYearMode(false);
    setView(current);
    setOpen(true);
  };

  /** `dobStep(dir)` — refuses to walk past the floor or past this year. */
  const step = (dir: 1 | -1) => {
    let m = current.m + dir;
    let y = current.y;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    if (m > 11) {
      m = 0;
      y += 1;
    }
    if (y < YEAR_FLOOR || y > now) return;
    setView({ y, m });
  };

  /** `dobPage(dir)`. */
  const page = (dir: 1 | -1) => {
    pageDir.current = dir;
    setBase(Math.min(decadeMax, Math.max(YEAR_FLOOR, decadeBase + dir * YEAR_PAGE)));
  };

  useLayoutEffect(() => {
    if (!open || !yearMode || base === null) return;
    dobYearsPage(panel.current, pageDir.current);
  }, [base, open, yearMode]);

  /** `dobPick(iso)` — the cell pops, then the panel shuts 300ms later. */
  const pick = (iso: string) => {
    onPick(iso);
    setView(viewFor(iso));
    dobCellPop(panel.current);
    window.setTimeout(() => close(), 300);
  };

  /* `dobCells()` — one button per day of the month, the first one placed on the
     weekday column the month starts in. A future date is rendered and inert. */
  const start = new Date(current.y, current.m, 1).getDay();
  const dim = new Date(current.y, current.m + 1, 0).getDate();
  const cells = Array.from({ length: dim }, (_, i) => {
    const iso = isoOf(current.y, current.m, i + 1);
    return { d: i + 1, iso, sel: value === iso, future: iso > today };
  });

  const years = Array.from({ length: YEAR_PAGE }, (_, i) => {
    const y = decadeBase + i;
    return { y, on: y === current.y, off: y > now };
  });

  return (
    <>
      <div className="ff-hl__row ff-hl__row--dob">
        <span className="ff-hl__label" id="ff-hl-dob-label">
          {DOB_LABEL}
        </span>
        <button
          type="button"
          ref={field}
          data-dobfield="1"
          className={value ? 'ff-hl__dob is-set' : 'ff-hl__dob'}
          aria-labelledby="ff-hl-dob-label"
          aria-expanded={open}
          onClick={toggle}
        >
          {value ? pretty(value) : DOB_EMPTY}
          <svg
            viewBox="0 0 24 24"
            width="46"
            height="46"
            fill="none"
            stroke="#41ED98"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="5" width="18" height="16" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <line x1="8" y1="3" x2="8" y2="7" />
            <line x1="16" y1="3" x2="16" y2="7" />
          </svg>
        </button>
      </div>

      {/* The reference's `position: relative; height: 0` holder, so the panel
          costs the column nothing and overlays the button below it. */}
      <div className="ff-hl__calholder">
        <div className="ff-hl__calscale">
          <div className="ff-hl__calwrap">
            {open ? (
              <div
                className="ff-hl__cal"
                data-cal="1"
                ref={panel}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    close(() => field.current?.focus());
                  }
                }}
              >
                <div className="ff-hl__cal-head">
                  {!yearMode ? (
                    <button
                      type="button"
                      className="ff-hl__cal-arrow"
                      aria-label="Previous month"
                      onClick={() => step(-1)}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="ff-hl__cal-month"
                    aria-expanded={yearMode}
                    onClick={() => setYearMode((was) => !was)}
                  >
                    {MONTHS[current.m]} {current.y}
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#41ED98"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ transform: `rotate(${yearMode ? '180deg' : '0deg'})` }}
                      aria-hidden="true"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {!yearMode ? (
                    <button
                      type="button"
                      className="ff-hl__cal-arrow"
                      aria-label="Next month"
                      onClick={() => step(1)}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="9 6 15 12 9 18" />
                      </svg>
                    </button>
                  ) : null}
                </div>

                {yearMode ? (
                  <>
                    <div className="ff-hl__cal-decade">
                      <button
                        type="button"
                        className="ff-hl__cal-arrow"
                        aria-label="Earlier years"
                        onClick={() => page(-1)}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="15 18 9 12 15 6" />
                        </svg>
                      </button>
                      <span className="ff-hl__cal-decade-label">
                        {decadeBase} – {Math.min(decadeBase + 11, now)}
                      </span>
                      <button
                        type="button"
                        className="ff-hl__cal-arrow"
                        aria-label="Later years"
                        onClick={() => page(1)}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    </div>

                    <div className="ff-hl__cal-years">
                      {years.map((y) => (
                        <button
                          key={y.y}
                          type="button"
                          data-year={y.y}
                          className={
                            y.on
                              ? 'ff-hl__cal-year is-on'
                              : y.off
                                ? 'ff-hl__cal-year is-off'
                                : 'ff-hl__cal-year'
                          }
                          aria-pressed={y.on}
                          onClick={() => {
                            if (y.off) return;
                            setView({ y: y.y, m: current.m });
                            setYearMode(false);
                          }}
                        >
                          {y.y}
                        </button>
                      ))}
                    </div>

                    <div className="ff-hl__cal-monthwrap">
                      <div className="ff-hl__cal-months" ref={months}>
                        <div className="ff-hl__cal-months-pad">
                          {MONTHS.map((label, i) => {
                            const d = Math.abs(current.m - i);
                            return (
                              <button
                                key={label}
                                type="button"
                                data-month={i}
                                className={
                                  d === 0
                                    ? 'ff-hl__cal-mo is-on'
                                    : d === 1
                                      ? 'ff-hl__cal-mo is-near'
                                      : 'ff-hl__cal-mo'
                                }
                                onClick={() => {
                                  setView({ y: current.y, m: i });
                                  setYearMode(false);
                                }}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <span className="ff-hl__cal-rule ff-hl__cal-rule--a" />
                      <span className="ff-hl__cal-rule ff-hl__cal-rule--b" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="ff-hl__cal-dows">
                      {DOWS.map((t, i) => (
                        <span key={`${t}${i}`} aria-hidden="true">
                          {t}
                        </span>
                      ))}
                    </div>

                    <div className="ff-hl__cal-cells">
                      {cells.map((cell, i) => (
                        <button
                          key={cell.iso}
                          type="button"
                          data-cell="1"
                          data-sel={cell.sel ? '1' : '0'}
                          className={
                            cell.sel
                              ? 'ff-hl__cal-cell is-sel'
                              : cell.future
                                ? 'ff-hl__cal-cell is-future'
                                : 'ff-hl__cal-cell'
                          }
                          style={i === 0 ? { gridColumnStart: start + 1 } : undefined}
                          aria-pressed={cell.sel}
                          aria-label={`${cell.d} ${MONTHS[current.m]} ${current.y}`}
                          onClick={() => {
                            if (cell.future) return;
                            pick(cell.iso);
                          }}
                        >
                          {cell.d}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div className="ff-hl__cal-foot">
                  <button
                    type="button"
                    className="ff-hl__cal-clear"
                    onClick={() => close(() => onPick(null))}
                  >
                    {CLEAR}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
