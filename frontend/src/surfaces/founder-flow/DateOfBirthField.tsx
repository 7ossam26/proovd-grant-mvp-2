/**
 * The date of birth, and its calendar — Founder Flow v2, Session D.
 *
 * §10 lists a date of birth among the account-claim contents; the reference
 * draws "a custom calendar (month scroller, year mode, decade paging, 18+
 * validation with an inline hint)". Both are here, and two choices in how are
 * worth stating.
 *
 * ── It is a text field with a calendar, not a calendar with a text field ────
 * The typed `YYYY-MM-DD` box is the primary path and always works: it is what a
 * password manager fills, what somebody who knows their own birthday types
 * fastest, and what a screen reader handles without any of this. The calendar
 * is a disclosure beneath it for people who would rather point. Both write the
 * same value, so there is one record and no mode to be stuck in.
 *
 * ── The panel is a disclosure, not a popover ────────────────────────────────
 * It opens inline below the field rather than in a portal. That is the
 * reference's own "positions below the field", and it removes three things a
 * popover would have cost: positioning maths at 320px, a focus trap around
 * something that blocks nothing, and a new Radix primitive with new styles and
 * new motion wiring for one field. Escape closes it and focus returns to the
 * control that opened it.
 *
 * ── The 18+ check is a courtesy over a recorded representation ──────────────
 * §10 collects the date and lists "US/18+ and sanctions representations"
 * separately, as things the Founder states. Proovd derives no age and never
 * claims to have verified one — which is exactly what the Admin Eligibility tab
 * already renders — so this hint is advice beside the field and NOT a gate:
 * `completeClaim` refuses on a missing date, never on an age this browser
 * computed. `FLOW_AGE_IS_YOUR_STATEMENT` says so where somebody would otherwise
 * read the hint as an identity check.
 *
 * ── Dates are three integers, never a `Date` ────────────────────────────────
 * Every calculation below is on `{ y, m, d }`. `new Date('1990-01-31')` parses
 * as UTC midnight and renders as the 30th in every timezone west of London,
 * which on a birthday field is a silent off-by-one that only some Founders
 * would ever see.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { FLOW_AGE_IS_YOUR_STATEMENT } from '@proovd/shared';
import { Button, Field, Input } from '../../components/index.js';

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

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function parse(value: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysIn(y, m)) return null;
  return { y, m, d };
}

function format({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Monday-first weekday index (0–6) of the first of the month. */
function firstWeekday(y: number, m: number): number {
  return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
}

/** Whole years between two calendar dates, by the ordinary birthday rule. */
function yearsBetween(born: Ymd, today: Ymd): number {
  let age = today.y - born.y;
  if (today.m < born.m || (today.m === born.m && today.d < born.d)) age -= 1;
  return age;
}

function todayYmd(): Ymd {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

/** Move a date by days, months or years, clamping the day into the month. */
function shift(date: Ymd, by: { days?: number; months?: number; years?: number }): Ymd {
  if (by.days) {
    const utc = new Date(Date.UTC(date.y, date.m - 1, date.d + by.days));
    return { y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() };
  }
  const total = (date.y + (by.years ?? 0)) * 12 + (date.m - 1) + (by.months ?? 0);
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { y, m, d: Math.min(date.d, daysIn(y, m)) };
}

export function DateOfBirthField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'days' | 'years'>('days');
  const panelId = useId();
  // `Button` is a Phase 02 primitive and does not forward a ref. Returning
  // focus to the control that opened a disclosure is required (§28.5) and is
  // not worth widening a component eleven surfaces share, so the toggle is
  // addressed by id — which is a real handle rather than a stored node that
  // can outlive its element.
  const toggleId = `${panelId}-toggle`;
  const focusToggle = () => document.getElementById(toggleId)?.focus();

  const parsed = parse(value);
  const today = todayYmd();
  // Somebody with no answer yet is shown a plausible decade rather than this
  // year, which would be twenty-something PageUps from any real birthday.
  const [cursor, setCursor] = useState<Ymd>(parsed ?? { y: today.y - 30, m: 1, d: 1 });

  useEffect(() => {
    if (parsed) setCursor(parsed);
    // Only when the stored value itself changes — otherwise every keystroke in
    // the calendar would be undone by this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const age = parsed ? yearsBetween(parsed, today) : null;
  const future = parsed ? format(parsed) > format(today) : false;

  return (
    <div className="ff-dob">
      <Field
        label="Date of birth"
        hint="Four digits, then month, then day — 1990-01-31."
        id="ff-dob-input"
      >
        <Input
          type="text"
          inputMode="numeric"
          autoComplete="bday"
          placeholder="1990-01-31"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>

      <div className="ff-dob__row">
        <Button
          tier="tertiary"
          small
          disabled={disabled}
          aria-expanded={open}
          aria-controls={panelId}
          id={toggleId}
          onClick={() => {
            setMode('days');
            setOpen((current) => !current);
          }}
        >
          {open ? 'Close the calendar' : 'Pick it on a calendar'}
        </Button>

        {parsed && !future ? (
          <span className="ff-dob__age" role="status">
            {age !== null && age >= 18
              ? `That is ${age} — 18 or over.`
              : `That is ${age}, which is under 18.`}
          </span>
        ) : null}
        {future ? (
          <span className="ff-dob__age" role="status">
            That date has not happened yet.
          </span>
        ) : null}
        {value.trim() !== '' && !parsed ? (
          <span className="ff-dob__age" role="status">
            We read dates as four digits, then month, then day.
          </span>
        ) : null}
      </div>

      <p className="ff-dob__note">{FLOW_AGE_IS_YOUR_STATEMENT}</p>

      {open ? (
        <div
          className="ff-cal"
          id={panelId}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setOpen(false);
              focusToggle();
            }
          }}
        >
          {mode === 'days' ? (
            <DayGrid
              cursor={cursor}
              selected={parsed}
              onCursor={setCursor}
              onPickYear={() => setMode('years')}
              onSelect={(picked) => {
                onChange(format(picked));
                setOpen(false);
                focusToggle();
              }}
            />
          ) : (
            <YearGrid
              cursor={cursor}
              onSelect={(y) => {
                setCursor((current) => ({ ...current, y, d: Math.min(current.d, daysIn(y, current.m)) }));
                setMode('days');
              }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function DayGrid({
  cursor,
  selected,
  onCursor,
  onPickYear,
  onSelect,
}: {
  cursor: Ymd;
  selected: Ymd | null;
  onCursor: (next: Ymd) => void;
  onPickYear: () => void;
  onSelect: (picked: Ymd) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [focusing, setFocusing] = useState(false);

  useEffect(() => {
    if (!focusing) return;
    gridRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  }, [focusing, cursor.y, cursor.m, cursor.d]);

  const lead = firstWeekday(cursor.y, cursor.m);
  const count = daysIn(cursor.y, cursor.m);

  function move(next: Ymd) {
    setFocusing(true);
    onCursor(next);
  }

  return (
    <>
      <div className="ff-cal__head">
        <Button
          tier="tertiary"
          small
          aria-label="Go to the previous month"
          onClick={() => onCursor(shift(cursor, { months: -1 }))}
        >
          ‹
        </Button>
        <button type="button" className="ff-cal__label" onClick={onPickYear}>
          {MONTHS[cursor.m - 1]} {cursor.y}
          <span className="ff-cal__label-hint">Change the year</span>
        </button>
        <Button
          tier="tertiary"
          small
          aria-label="Go to the next month"
          onClick={() => onCursor(shift(cursor, { months: 1 }))}
        >
          ›
        </Button>
      </div>

      <div className="ff-cal__weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      {/* One tab stop for the whole grid, arrows inside it — the roving
          tabindex a date grid needs so a keyboard user is not tabbing through
          thirty-one buttons to reach the end of a month (§28.5). */}
      <div
        className="ff-cal__grid"
        role="grid"
        aria-label={`${MONTHS[cursor.m - 1]} ${cursor.y}`}
        ref={gridRef}
        onKeyDown={(event) => {
          const map: Record<string, Parameters<typeof shift>[1] | undefined> = {
            ArrowLeft: { days: -1 },
            ArrowRight: { days: 1 },
            ArrowUp: { days: -7 },
            ArrowDown: { days: 7 },
            PageUp: event.shiftKey ? { years: -1 } : { months: -1 },
            PageDown: event.shiftKey ? { years: 1 } : { months: 1 },
          };
          const by = map[event.key];
          if (by) {
            event.preventDefault();
            move(shift(cursor, by));
            return;
          }
          if (event.key === 'Home') {
            event.preventDefault();
            move({ ...cursor, d: 1 });
          }
          if (event.key === 'End') {
            event.preventDefault();
            move({ ...cursor, d: daysIn(cursor.y, cursor.m) });
          }
        }}
      >
        {Array.from({ length: lead }, (_unused, index) => (
          <span key={`lead-${index}`} className="ff-cal__blank" />
        ))}
        {Array.from({ length: count }, (_unused, index) => {
          const day = index + 1;
          const isCursor = day === cursor.d;
          const isSelected =
            selected !== null &&
            selected.y === cursor.y &&
            selected.m === cursor.m &&
            selected.d === day;
          return (
            <button
              key={day}
              type="button"
              className={isSelected ? 'ff-cal__day is-selected' : 'ff-cal__day'}
              tabIndex={isCursor ? 0 : -1}
              aria-pressed={isSelected}
              aria-label={`${day} ${MONTHS[cursor.m - 1]} ${cursor.y}`}
              onClick={() => onSelect({ y: cursor.y, m: cursor.m, d: day })}
              onFocus={() => onCursor({ ...cursor, d: day })}
            >
              {day}
            </button>
          );
        })}
      </div>
    </>
  );
}

function YearGrid({ cursor, onSelect }: { cursor: Ymd; onSelect: (year: number) => void }) {
  // Twelve at a time, aligned to the decade the cursor is in — the reference's
  // "year mode, decade paging", which is what makes a 1970s birthday two
  // gestures away rather than fifty.
  const [start, setStart] = useState(Math.floor(cursor.y / 10) * 10 - 1);

  return (
    <>
      <div className="ff-cal__head">
        <Button tier="tertiary" small aria-label="Go to earlier years" onClick={() => setStart(start - 12)}>
          ‹
        </Button>
        <span className="ff-cal__label" aria-live="polite">
          {start} – {start + 11}
        </span>
        <Button tier="tertiary" small aria-label="Go to later years" onClick={() => setStart(start + 12)}>
          ›
        </Button>
      </div>
      <div className="ff-cal__years">
        {Array.from({ length: 12 }, (_unused, index) => {
          const year = start + index;
          return (
            <button
              key={year}
              type="button"
              className={year === cursor.y ? 'ff-cal__year is-selected' : 'ff-cal__year'}
              onClick={() => onSelect(year)}
            >
              {year}
            </button>
          );
        })}
      </div>
    </>
  );
}
