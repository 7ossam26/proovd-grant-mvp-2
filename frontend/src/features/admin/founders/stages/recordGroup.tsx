/**
 * The shared stage kit for the Admin Founder panel — 2026-08-22.
 *
 * Four stage screens (Invite, Onboarding, Application review, Listing fee) are
 * built out of exactly one repeating object: `.record-group`, its column rail,
 * and `.record-row`. One implementation, because four hand-written copies of a
 * five-track grid is three chances for a header label to stop sitting above the
 * column it names.
 *
 * ── The row's shape is the reference's, verbatim ────────────────────────────
 *   section.record-group > header > h2{title} + span{"N items"}
 *   div.record-table-head[aria-hidden] > span×5  Item · Saved content · Source
 *                                                · Status · Actions
 *   div.record-row.{tone} > strong{label}
 *                         + div > span{value} (+ small{note})
 *                         + span.row-source{source ?? "System"}
 *                         + span.status-tag.{tone}{status ?? "Saved"}
 *                         + span.row-actions > button*
 *
 * The count is always the plural word — `1 items` is what the reference says,
 * and a surface that quietly corrects it is a surface that disagrees with the
 * design it was copied from. `RecordGroup` takes the rows and counts them
 * itself, so the number and the list can never drift.
 *
 * ── Controls are built as the reference builds them ─────────────────────────
 * Same element, same label, same enabled state. Where a control's write is
 * refused — `enforce_vetting_write()` on a submitted answer, a field key the
 * §25.6 register does not carry — the control still calls the closest real
 * route and the SERVER'S refusal is what the Admin reads. Nothing here predicts
 * a refusal, and nothing reports a save that did not happen.
 *
 * `RowAction.unavailable` remains for a caller that has a specific reason to
 * state in place of a control; the four stages in this kit do not use it.
 *
 * ── Nothing here composes a fact ────────────────────────────────────────────
 * Values, sources, statuses and amounts all arrive resolved from the server.
 * `usd()` turns integer cents into the reference's own `$29` and does no
 * arithmetic; there is no subtraction anywhere in this file. A `Saved $6` the
 * browser worked out is a second answer waiting to disagree with the ledger.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatCents, prefillAffiliateTypeLabel } from '@proovd/shared';
import { AdminRequestError, type FounderWorkspaceDetail } from '../api.js';
import { absoluteTime } from '../format.js';

/* ── Tones ────────────────────────────────────────────────────────────────── */

/** The reference's four row textures. `.status-tag` carries the same word. */
export type RecordTone = 'plain' | 'done' | 'action' | 'waiting';

/* ── Actions ──────────────────────────────────────────────────────────────── */

/**
 * Fixed order, everywhere, so two rows never present the same pair reversed.
 *
 * `label` stays `string` rather than this union: sibling stages carry controls
 * of their own (`Open dossier`, `Withdraw`) and a row system that can only
 * express four words is a row system each of them re-implements. Anything not
 * named here sorts after the four, keeping their relative order intact.
 */
export const ROW_ACTION_ORDER = ['Edit', 'Request change', 'View', 'Download'] as const;

export type RowActionLabel = (typeof ROW_ACTION_ORDER)[number];

export interface RowAction {
  label: RowActionLabel | (string & {});
  /** Present when the action has somewhere to go. */
  onClick?: () => void;
  /**
   * Why it does not. Rendered in the actions cell, and the button is inert.
   * Supplying both `onClick` and `unavailable` is a bug; `unavailable` wins.
   */
  unavailable?: string;
}

export const action = (label: string, onClick: () => void): RowAction => ({
  label,
  onClick,
});

export const inert = (label: string, unavailable: string): RowAction => ({
  label,
  unavailable,
});

/** Known labels first, in the fixed order; anything else keeps its own place. */
function actionRank(label: string): number {
  const index = (ROW_ACTION_ORDER as readonly string[]).indexOf(label);
  return index === -1 ? ROW_ACTION_ORDER.length : index;
}

/* ── The row ──────────────────────────────────────────────────────────────── */

export interface RecordRowProps {
  /** Column 1. The reference's `strong`. */
  label: string;
  /** Column 2. `null` renders `absence` in its place — never a blank cell. */
  value: string | null;
  /** What to say where the value would be. §1.4: an absence names itself. */
  absence?: string;
  /** A second, quieter line under the value. */
  note?: string | null;
  /** Column 3. Defaults to the reference's own fallback. */
  source?: string | null;
  /** Column 4. Defaults to the reference's own fallback. */
  status?: string | null;
  tone?: RecordTone;
  actions?: RowAction[];
}

function RecordRow({
  label,
  value,
  absence,
  note,
  source,
  status,
  tone = 'plain',
  actions = [],
}: RecordRowProps) {
  const ordered = [...actions].sort((a, b) => actionRank(a.label) - actionRank(b.label));
  const reasons = Array.from(
    new Set(ordered.filter((a) => a.unavailable).map((a) => `${a.label} — ${a.unavailable}`)),
  );

  return (
    <div className={`record-row ${tone}`}>
      <strong>{label}</strong>
      <div>
        <span>{value ?? absence ?? 'Not recorded'}</span>
        {note ? <small>{note}</small> : null}
      </div>
      <span className="row-source">{source ?? 'System'}</span>
      <span className={`status-tag ${tone}`}>{status ?? 'Saved'}</span>
      <span className="row-actions">
        {ordered.map((a) => (
          <button
            key={a.label}
            type="button"
            disabled={Boolean(a.unavailable) || !a.onClick}
            aria-disabled={Boolean(a.unavailable) || !a.onClick}
            onClick={a.unavailable ? undefined : a.onClick}
          >
            {a.label}
          </button>
        ))}
        {reasons.map((reason) => (
          <small key={reason}>{reason}</small>
        ))}
      </span>
    </div>
  );
}

/* ── The group ────────────────────────────────────────────────────────────── */

export interface RecordGroupProps {
  title: string;
  rows: RecordRowProps[];
}

export function RecordGroup({ title, rows }: RecordGroupProps) {
  return (
    <section className="record-group">
      <header>
        <h2>{title}</h2>
        {/* Always "items". The reference never inflects it. */}
        <span>{rows.length} items</span>
      </header>
      <div className="record-table-head" aria-hidden="true">
        <span>Item</span>
        <span>Saved content</span>
        <span>Source</span>
        <span>Status</span>
        <span>Actions</span>
      </div>
      {rows.map((row) => (
        <RecordRow key={row.label} {...row} />
      ))}
    </section>
  );
}

/* ── Download ─────────────────────────────────────────────────────────────── */

/**
 * `Download` — the saved content as a file, built in the browser.
 *
 * This is the reference's own mechanism and it needs no route: the value is
 * already on the page, so the control writes a Blob and clicks a link at it.
 * Nothing leaves the origin and no asset is fetched, so §25.7's line between
 * seeing and exporting is drawn where it already was — this exports exactly
 * what the panel was authorised to render.
 */
export function downloadFile(filename: string, content: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 800);
}

/** `Founder story` → `founder-story.txt`. The reference's own file naming. */
export function downloadNameFor(label: string): string {
  return `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.txt`;
}

/* ── Money ────────────────────────────────────────────────────────────────── */

/**
 * JSON cannot carry a `bigint`, so the panel sends integer cents as a decimal
 * string (a number is accepted for a route that has not switched yet). Anything
 * that is not a whole number of cents is refused rather than rounded — §24.3's
 * integer rule exists precisely so no surface gets to decide what `2.005` meant.
 */
export function toCents(value: string | number | bigint | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

/**
 * The reference's own `usd()` — `$29`, `$2.58`, `$35`.
 *
 * Digits come from `shared/money`'s `formatCents`, which works on the digits of
 * the `bigint` and never round-trips through a float. The only thing added here
 * is the reference's rendering: a `$` prefix and no trailing `.00`. No
 * `toLocaleString`, and no arithmetic.
 */
export function usd(cents: string | number | bigint | null | undefined): string | null {
  const value = toCents(cents);
  if (value === null) return null;
  return `$${formatCents(value).replace(/\.00$/, '')}`;
}

/** U+2212 MINUS SIGN, as the reference uses — not a hyphen. */
export const MINUS = '−';

/** `−$2`, or null when the record does not state the amount. */
export function minusUsd(cents: string | number | bigint | null | undefined): string | null {
  const rendered = usd(cents);
  return rendered === null ? null : `${MINUS}${rendered}`;
}

/* ── The panel supplement ─────────────────────────────────────────────────── */

/**
 * `GET /api/admin/founder-panel/:prospectId`, typed optimistically.
 *
 * The workspace payload (`FounderWorkspaceDetail`) predates these four screens
 * and does not carry the account verification facts, the Admin prefills, the
 * optional-item evidence, the application review, or the fee calculation. The
 * panel route composes them.
 *
 * EVERY field is optional on purpose. This type is a statement of what the
 * screens would render if the route composed it, not a claim that it does — a
 * key that has not arrived renders its own absence with a reason, and never a
 * zero, a blank, or a plausible default. That is the difference §1.4 draws
 * between "not yet populated" and "nothing".
 */
export interface PanelOptionalItem {
  /** One of `OPTIONAL_ITEM_KEYS`: visuals · branding · interview · story · socials. */
  key: string;
  complete?: boolean | null;
  /** Integer cents this item took off the listing fee, when it qualified. */
  savingCents?: string | number | null;
  /** Composed display content — a filename, a saved story, a joined link list. */
  content?: string | null;
  /** Branding is displayed as two rows and is ONE record. Both read from here. */
  logo?: string | null;
  colors?: string | null;
  source?: string | null;
  /** Why it does not qualify, when it does not. */
  reason?: string | null;
}

export interface PanelFeeLine {
  key?: string | null;
  label?: string | null;
  amountCents?: string | number | null;
  qualifies?: boolean | null;
}

export interface FounderPanel {
  draft?: {
    status?: string | null;
    updatedAt?: string | null;
  } | null;

  invitation?: {
    /** `max(campaign_invitation_sends.token_version)`. Null before any send. */
    version?: number | null;
    /** `count(sends) - 1`, composed by the route — never subtracted here. */
    reminders?: number | null;
    deliveryState?: string | null;
    deliveryAt?: string | null;
  } | null;

  /** The Admin prefills the Invite stage writes and Onboarding reads back. */
  prefills?: {
    viewsCount?: number | null;
    affiliateMatches?: number | null;
    /** A `PREFILL_AFFILIATE_TYPES` id, never a label. */
    affiliateType?: string | null;
    brandVoice1?: string | null;
    brandVoice2?: string | null;
    username?: string | null;
  } | null;

  account?: {
    /** `secure_tokens.claimed_at` for the `founder_email_code` token. */
    emailVerifiedAt?: string | null;
    /** Projected from `audit_events` action `founder.password_set`. */
    passwordSetAt?: string | null;
    dateOfBirth?: string | null;
    /** The composed age-check result. Absent where nothing computes one. */
    ageCheck?: string | null;
    legalNameSource?: string | null;
    standing?: string | null;
    standingDetail?: string | null;
  } | null;

  onboarding?: {
    /** `campaign_vetting.last_saved_at`. */
    lastSavedAt?: string | null;
    /** The total-map label for where onboarding stands. */
    statusLabel?: string | null;
    nextLabel?: string | null;
  } | null;

  optionalItems?: PanelOptionalItem[] | null;

  persistentSetup?: {
    refundsUrl?: string | null;
    community?: { choice?: string | null; url?: string | null } | null;
    /** Accepted policy documents. Empty while all eight are `draft`. */
    legalRecords?: string[] | null;
  } | null;

  applicationReview?: {
    /** An `APPLICATION_REVIEW_OUTCOMES` id. */
    outcome?: string | null;
    /** `campaign_application_reviews.round` — the reference's Submission N. */
    round?: number | null;
    submittedAt?: string | null;
    requiredAnswers?: {
      labels?: string[] | null;
      confirmed?: number | null;
      total?: number | null;
    } | null;
    optionalQualifications?: {
      labels?: string[] | null;
      qualified?: number | null;
      total?: number | null;
      /** Integer cents. Composed server-side; never summed in the browser. */
      discountCents?: string | number | null;
    } | null;
    changeRequests?: {
      fieldKey: string;
      reason?: string | null;
      requestedAt?: string | null;
      resolvedAt?: string | null;
    }[] | null;
  } | null;

  listingFee?: {
    /** The composed state — `Calculated`, `Link sent`, `Paid`, a refusal. */
    status?: string | null;
    calculatedAt?: string | null;
    baseCents?: string | number | null;
    /** `listing_fee_calculations.discount_lines`, one per §12 item. */
    lines?: PanelFeeLine[] | null;
    subtotalCents?: string | number | null;
    /** base − subtotal, composed SERVER-side. Absent renders as absent. */
    savedCents?: string | number | null;
    minSubtotalCents?: string | number | null;
    /** Null before the checkout is paid — there is no tax until then. */
    taxCents?: string | number | null;
    totalCents?: string | number | null;
    paid?: boolean | null;
    paidAt?: string | null;
    transactionId?: string | null;
    /** What follows the fee. The reference reads `Matching`. */
    nextLabel?: string | null;
  } | null;
}

/**
 * The prop arrives as `unknown` so this file's optimistic view of the route can
 * never fail a build against whatever type the panel client settles on. Reads
 * are all optional-chained, so a shape that does not match simply renders the
 * absences.
 */
export function readPanel(panel: unknown): FounderPanel {
  return panel && typeof panel === 'object' ? (panel as FounderPanel) : {};
}

export function panelItem(panel: FounderPanel, key: string): PanelOptionalItem | undefined {
  return panel.optionalItems?.find((i) => i.key === key);
}

/* ── The gate the Invite stage reads ──────────────────────────────────────── */

/**
 * §7's send gate, as the workspace payload states it.
 *
 * Read, never recomputed: a readiness the browser worked out is one a caller
 * skips by posting to the route directly, and `POST …/send` is the moment an
 * invitation reaches a real person. `canSend === undefined` means the payload
 * does not state it — which is not permission and not a refusal, so the control
 * stays live and the server's answer is what gets rendered.
 */
export interface InvitationGate {
  canSend?: boolean;
  /** Bracketed markers still in the rendered message. */
  unresolvedMarkers?: string[];
  /** §7 list items that never appear in the message, so the render cannot see them. */
  missingBeforeSend?: string[];
}

export function invitationGate(detail: FounderWorkspaceDetail): InvitationGate {
  return detail.overview.invitation as InvitationGate;
}

/* ── Stage props ──────────────────────────────────────────────────────────── */

export interface StageProps {
  detail: FounderWorkspaceDetail;
  /** The `GET /api/admin/founder-panel/:prospectId` supplement. See `readPanel`. */
  panel?: unknown;
  /**
   * Which stage the shell resolved. Present because the shell passes it to
   * every screen; a stage that renders one heading does not need to read it.
   */
  stageId?: string;
  onSaved: () => void;
  /**
   * Set by the record shell when a stage's action bar moves to another stage.
   * Optional: without it the control is inert and says so, rather than being a
   * button that looks like navigation and is not.
   */
  onOpenStage?: (stageId: string) => void;
}

/* ── The stage frame ──────────────────────────────────────────────────────── */

export interface StageFrameProps {
  stage: string;
  heading: string;
  lead: string;
  children: ReactNode;
}

export function StageFrame({ stage, heading, lead, children }: StageFrameProps) {
  return (
    <section className="workspace" id="main">
      <div className="workspace-grid">
        <div className="workspace-inner">
          <div className="stage-heading">
            <p className="stage-name">{stage}</p>
            <h1>{heading}</h1>
            <p>{lead}</p>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

export interface StateStripProps {
  status: string;
  lastChange: string;
  next: string;
}

export function StateStrip({ status, lastChange, next }: StateStripProps) {
  return (
    <section className="state-strip">
      <div>
        <span>Status</span>
        <strong>{status}</strong>
      </div>
      <div>
        <span>Last change</span>
        <strong>{lastChange}</strong>
      </div>
      <div>
        <span>Next</span>
        <strong>{next}</strong>
      </div>
    </section>
  );
}

/* ── Refusals ─────────────────────────────────────────────────────────────── */

/**
 * The server's own words. §27.1's six answers arrive in `whatHappened` /
 * `next`; paraphrasing them in the browser is how the two start disagreeing.
 */
export function refusalLine(error: AdminRequestError | null): string | null {
  if (!error) return null;
  const { title, whatHappened, next } = error.detail;
  return [title, whatHappened, next].filter(Boolean).join(' — ');
}

export function asRequestError(e: unknown): AdminRequestError | null {
  return e instanceof AdminRequestError ? e : null;
}

/* ── Dialogs ──────────────────────────────────────────────────────────────── */

/**
 * The overlay shell. `.overlay > .dialog[role=dialog][aria-modal]` with the
 * reference's own close control, plus the two things a modal owes a keyboard:
 * Escape closes it, and focus starts inside it.
 */
function Overlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay">
      <section className="dialog" role="dialog" aria-modal="true" ref={ref}>
        <button className="close-button" type="button" onClick={onClose}>
          Close
        </button>
        {children}
      </section>
    </div>
  );
}

export interface ManualEditDialogProps {
  /** The reference puts the field's own label in the dialog heading. */
  label: string;
  initialValue: string;
  /** When supplied the value is chosen, not typed — the Affiliate type case. */
  options?: readonly { id: string; label: string }[];
  /** §25.6 requires a reason once the Founder owns the account. */
  reasonRequired?: boolean;
  busy?: boolean;
  refusal?: string | null;
  onSave: (value: string, reason: string) => void;
  onClose: () => void;
}

export function ManualEditDialog({
  label,
  initialValue,
  options,
  reasonRequired,
  busy,
  refusal,
  onSave,
  onClose,
}: ManualEditDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [reason, setReason] = useState('');

  return (
    <Overlay onClose={onClose}>
      <form
        className="decision-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value, reason);
        }}
      >
        <p className="dialog-kicker">Manual Admin edit</p>
        <h2>{label}</h2>
        <p className="dialog-lead">
          Change the saved value directly. The edit is recorded in History and does not create a
          Founder change request.
        </p>
        <label>
          <span>Saved value</span>
          {options ? (
            <select
              className="manual-edit-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              <option value="">Select one</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="manual-edit-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </label>
        {reasonRequired ? (
          <label>
            <span>Required reason</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="This reason is shown to the Founder when applicable and saved to History"
            />
          </label>
        ) : null}
        {refusal ? <p className="form-note">{refusal}</p> : null}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            Save edit
          </button>
        </div>
      </form>
    </Overlay>
  );
}

/** The reference addresses the Founder by first name in every dialog lead. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export interface RequestChangeDialogProps {
  /** The field this request is linked to. */
  label: string;
  /** The Founder's own name, as the reference addresses them — first name. */
  founderName: string;
  busy?: boolean;
  refusal?: string | null;
  onRequest: (reason: string) => void;
  onClose: () => void;
}

export function RequestChangeDialog({
  label,
  founderName,
  busy,
  refusal,
  onRequest,
  onClose,
}: RequestChangeDialogProps) {
  const [reason, setReason] = useState('');

  return (
    <Overlay onClose={onClose}>
      <form
        className="decision-form"
        onSubmit={(e) => {
          e.preventDefault();
          onRequest(reason);
        }}
      >
        <p className="dialog-kicker">Admin decision</p>
        <h2>Request change · {label}</h2>
        <p className="dialog-lead">
          Explain exactly what is wrong with “{label}” and what {founderName} must change. This
          request will be linked to this field and shown to the Founder.
        </p>
        <label>
          <span>Required reason</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="This reason is shown to the Founder when applicable and saved to History"
          />
        </label>
        {refusal ? <p className="form-note">{refusal}</p> : null}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            Request this change
          </button>
        </div>
      </form>
    </Overlay>
  );
}

export interface DecisionDialogProps {
  kicker: string;
  heading: string;
  lead: string;
  submitLabel: string;
  /** §25.6 keeps the two apart — only the second may ever reach a Founder. */
  withCustomerExplanation?: boolean;
  busy?: boolean;
  refusal?: string | null;
  onDecide: (internalReason: string, customerExplanation: string) => void;
  onClose: () => void;
}

export function DecisionDialog({
  kicker,
  heading,
  lead,
  submitLabel,
  withCustomerExplanation,
  busy,
  refusal,
  onDecide,
  onClose,
}: DecisionDialogProps) {
  const [internalReason, setInternalReason] = useState('');
  const [customerExplanation, setCustomerExplanation] = useState('');

  return (
    <Overlay onClose={onClose}>
      <form
        className="decision-form"
        onSubmit={(e) => {
          e.preventDefault();
          onDecide(internalReason, customerExplanation);
        }}
      >
        <p className="dialog-kicker">{kicker}</p>
        <h2>{heading}</h2>
        <p className="dialog-lead">{lead}</p>
        <label>
          <span>Required reason</span>
          <textarea
            value={internalReason}
            onChange={(e) => setInternalReason(e.target.value)}
            placeholder="This reason is shown to the Founder when applicable and saved to History"
          />
        </label>
        {withCustomerExplanation ? (
          <label>
            <span>Explanation for the Founder</span>
            <textarea
              value={customerExplanation}
              onChange={(e) => setCustomerExplanation(e.target.value)}
              placeholder="This reason is shown to the Founder when applicable and saved to History"
            />
          </label>
        ) : null}
        {refusal ? <p className="form-note">{refusal}</p> : null}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

/**
 * `View` — the saved content at full length.
 *
 * Entirely local: it renders text the record already sent, so it needs no route
 * and claims no export. `Download` is the one that would leave the panel, and
 * that is exactly the one §25.7 keeps behind a route that does not exist yet.
 */
export function ValueDialog({
  label,
  lines,
  onClose,
}: {
  label: string;
  lines: string[];
  onClose: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="decision-form">
        <p className="dialog-kicker">Saved content</p>
        <h2>{label}</h2>
        {lines.length ? (
          lines.map((line, i) => (
            <p className="dialog-lead" key={`${i}-${line.slice(0, 24)}`}>
              {line}
            </p>
          ))
        ) : (
          <p className="dialog-lead">Nothing is saved against this item yet.</p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ══ The rows two stages share ═════════════════════════════════════════════ */

/**
 * Onboarding and Application review render the SAME twenty-one records — the
 * nine account facts, the six campaign answers, the six optional-item display
 * rows — and differ only in their group headings and in which controls each row
 * carries. So the rows are composed once here and the actions are attached by
 * the stage.
 *
 * A record collected on two screens is a record whose two copies eventually
 * disagree, and a suite that tests both copies makes the disagreement look
 * correct. One builder is the whole defence.
 */
export interface SharedRow {
  /** Stable key — what an `Edit` writes and a change request is linked to. */
  key: string;
  label: string;
  value: string | null;
  absence?: string;
  note?: string | null;
  source: string;
  status: string;
  tone: RecordTone;
}

/** What a cell says when the panel route did not compose the fact at all. */
const NOT_STATED = 'Not stated by this record';

/** `Qualifies · −$2`, or just `Qualifies` where the record states no amount. */
function withSaving(head: string, savingCents: string | number | null | undefined): string {
  const amount = minusUsd(savingCents);
  return amount ? `${head} · ${amount}` : head;
}

/* ── Group: the account, verification and eligibility (9) ─────────────────── */

export function accountRows(detail: FounderWorkspaceDetail, p: FounderPanel): SharedRow[] {
  const { header, overview } = detail;
  const account = p.account;
  const campaignType = overview.vetting.campaignType ?? overview.vetting.campaignTypeSelected;
  const username = p.prefills?.username ?? null;

  return [
    {
      key: 'campaign_choice',
      label: 'Campaign choice',
      value: campaignType,
      absence: 'No campaign type is recorded on this draft',
      source: 'Founder confirmed',
      status: campaignType ? `Founder confirmed · ${campaignType}` : 'Not chosen yet',
      tone: campaignType ? 'done' : 'waiting',
    },
    {
      key: 'email_verification',
      label: 'Email verification',
      value: header.email,
      source: 'Founder + OTP',
      status: account?.emailVerifiedAt
        ? `Verified by six-digit code · ${absoluteTime(account.emailVerifiedAt)}`
        : account
          ? 'Not verified yet'
          : NOT_STATED,
      tone: account?.emailVerifiedAt ? 'done' : account ? 'waiting' : 'plain',
    },
    {
      key: 'password',
      label: 'Password',
      /* True at every state, and the only fact this row may assert about the
         value itself — §28.2 keeps the hash out of every read path. */
      value: 'Password contents are never visible',
      source: 'Founder account',
      status: account?.passwordSetAt
        ? `Password created · ${absoluteTime(account.passwordSetAt)}`
        : account
          ? 'No password recorded'
          : NOT_STATED,
      tone: account?.passwordSetAt ? 'done' : account ? 'waiting' : 'plain',
    },
    {
      key: 'username',
      label: 'Username',
      value: username,
      absence: 'No username is prefilled on this draft',
      source: 'Admin prefill',
      status: username ? 'Shown read-only to Founder' : 'Not prefilled',
      tone: username ? 'done' : 'waiting',
    },
    {
      key: 'phone',
      label: 'Phone',
      value: header.phone,
      absence: 'No phone number saved',
      source: 'Founder saved',
      /* A CHECK pins `user.phone_verified` false and §33.1.8 scans the tree to
         keep it that way, so both halves of this string are permanent facts. */
      status: header.phone ? 'Filled · Not SMS verified' : 'Empty · Not SMS verified',
      tone: header.phone ? 'plain' : 'waiting',
    },
    {
      key: 'dob',
      label: 'Date of birth',
      value: account?.dateOfBirth ?? null,
      absence: 'No date of birth saved',
      source: 'Founder saved',
      status: account?.ageCheck ?? (account ? 'Age check not computed on this record' : NOT_STATED),
      tone: account?.ageCheck ? 'done' : 'plain',
    },
    {
      key: 'display_name',
      label: 'Display name',
      value: header.preferredName,
      absence: 'No display name saved',
      source: 'Founder profile',
      status: 'Separate from legal identity',
      tone: 'plain',
    },
    {
      key: 'legal_name',
      label: 'Legal name',
      value: header.legalName,
      absence: 'No legal name saved',
      source: account?.legalNameSource ?? 'Stripe / Founder',
      status: 'Permission-gated',
      tone: 'plain',
    },
    {
      key: 'account_standing',
      label: 'Account standing',
      value: account?.standing ?? header.account,
      source: 'Persistent account',
      status: account?.standingDetail ?? (header.account === 'Active' ? 'Clear' : header.account),
      tone: header.account === 'Active' ? 'done' : 'waiting',
    },
  ];
}

/* ── Group: the campaign answers (6) ──────────────────────────────────────── */

/**
 * §9's provenance, in the reference's words.
 *
 * `provenanceOf()` on the server says "Originally prepared by Proovd · Last
 * edited by Maya"; the reference's two cells say `Admin prefill → Founder` and
 * `Founder edited and confirmed`. The reference wins on wording, and the
 * mapping is surface-local — the server's register is not renamed to match one
 * screen.
 */
function answerCells(
  text: string | null,
  provenance: string | null,
): { source: string; status: string; tone: RecordTone } {
  if (!text) return { source: 'Founder saved', status: 'Not answered yet', tone: 'waiting' };
  if (provenance?.startsWith('Originally prepared by Proovd')) {
    return {
      source: 'Admin prefill → Founder',
      status: provenance.includes('Last edited by')
        ? 'Founder edited and confirmed'
        : 'Founder confirmed unchanged',
      tone: 'done',
    };
  }
  return { source: 'Founder saved', status: 'Founder typed · Confirmed', tone: 'done' };
}

export function campaignAnswerRows(detail: FounderWorkspaceDetail, p: FounderPanel): SharedRow[] {
  const answers = detail.overview.vetting.answers;
  const find = (key: string) => answers.find((a) => a.key === key) ?? null;

  /* The reference's labels, not the shared register's. `Competition` is
     `Competition and alternatives` in `VETTING_ANSWER_LABELS`; renaming the
     register to match one screen would break every other reader of it. */
  const prose: { key: string; label: string; answerKey: string }[] = [
    { key: 'problem', label: 'Problem', answerKey: 'problem' },
    { key: 'solution', label: 'Solution', answerKey: 'solution' },
    { key: 'competition', label: 'Competition', answerKey: 'competition' },
  ];

  const views = p.prefills?.viewsCount;
  const matches = p.prefills?.affiliateMatches;
  const typeLabel = prefillAffiliateTypeLabel(p.prefills?.affiliateType);
  const noViews = views === null || views === undefined;
  const noMatches = matches === null || matches === undefined;

  return [
    ...prose.map((spec) => {
      const answer = find(spec.answerKey);
      const cells = answerCells(answer?.text ?? null, answer?.provenance ?? null);
      return {
        key: spec.key,
        label: spec.label,
        value: answer?.text ?? null,
        absence: 'Nothing saved against this answer',
        ...cells,
      };
    }),
    {
      key: 'views_count',
      label: 'Number of views',
      value: noViews ? null : String(views),
      absence: 'No number prefilled',
      source: 'Admin prefill',
      /* Never presented as measured: nothing in the MVP counts a view. */
      status: noViews ? 'Not prefilled' : 'Prefilled · Not calculated',
      tone: noViews ? 'waiting' : 'plain',
    },
    {
      key: 'affiliate_matches',
      label: 'Possible affiliate matches',
      value: noMatches ? null : String(matches),
      absence: 'No estimate prefilled',
      source: 'Admin prefill',
      status: noMatches ? 'Not prefilled' : 'Estimate · Not a guarantee',
      tone: noMatches ? 'waiting' : 'plain',
    },
    {
      key: 'affiliate_type',
      label: 'Affiliate type',
      value: typeLabel,
      absence: 'No type prefilled',
      source: 'Admin prefill',
      status: typeLabel ? 'Canonical taxonomy' : 'Not prefilled',
      tone: typeLabel ? 'plain' : 'waiting',
    },
  ];
}

/* ── Group: the optional items (6 display rows over 5 records) ────────────── */

/**
 * §12 defines FIVE optional items. The reference displays SIX rows, splitting
 * `branding` into logos and colors.
 *
 * Both branding rows read the ONE `campaign_optional_items` record, and only
 * the colors row is ever allowed to carry the saving — two rows each claiming
 * `−$2` would state a US$4 discount the ledger never granted.
 */
export function optionalItemRows(p: FounderPanel): SharedRow[] {
  const composed = p.optionalItems != null;
  const item = (key: string) => panelItem(p, key);
  const branding = item('branding');

  const qualifier = (
    key: string,
    head: string,
    value: string | null,
  ): { status: string; tone: RecordTone } => {
    if (!composed) return { status: NOT_STATED, tone: 'plain' };
    const record = item(key);
    if (record?.complete) return { status: withSaving(head, record.savingCents), tone: 'done' };
    return {
      status: record?.reason ?? (value ? 'Saved · Does not qualify' : 'Empty'),
      tone: 'waiting',
    };
  };

  const visuals = item('visuals');
  const interview = item('interview');
  const story = item('story');
  const socials = item('socials');

  return [
    {
      key: 'optional.visuals',
      label: 'Product visuals',
      value: visuals?.content ?? null,
      absence: 'No visual uploaded',
      source: visuals?.source ?? 'Founder upload',
      ...qualifier('visuals', 'Qualifies', visuals?.content ?? null),
    },
    {
      key: 'optional.branding.logos',
      label: 'Branding · logos',
      value: branding?.logo ?? null,
      absence: 'No logo uploaded',
      source: 'Founder upload',
      /* Never an amount: the branding saving is claimed once, on the row below. */
      status: !composed ? NOT_STATED : branding?.logo ? 'Saved' : 'Empty',
      tone: !composed ? 'plain' : branding?.logo ? 'done' : 'waiting',
    },
    {
      key: 'optional.branding.colors',
      label: 'Branding · colors',
      value: branding?.colors ?? null,
      absence: 'No colours saved',
      source: 'Founder saved',
      ...qualifier('branding', 'Qualifies branding', branding?.colors ?? null),
    },
    {
      key: 'optional.interview',
      label: 'Founder interview',
      value: interview?.content ?? null,
      absence: 'No confirmed booking',
      source: 'Founder selected',
      ...qualifier('interview', 'Complete', interview?.content ?? null),
    },
    {
      key: 'optional.story',
      label: 'Founder story',
      value: story?.content ?? null,
      absence: 'No story saved',
      source: 'Founder saved',
      ...qualifier('story', 'Complete', story?.content ?? null),
    },
    {
      key: 'optional.socials',
      label: 'Social links',
      value: socials?.content ?? null,
      absence: 'No links saved',
      source: 'Founder saved',
      ...qualifier('socials', 'Qualifies', socials?.content ?? null),
    },
  ];
}

/** A `SharedRow` plus the controls a stage decided it carries. */
export function withActions(row: SharedRow, actions: RowAction[]): RecordRowProps {
  return {
    label: row.label,
    value: row.value,
    absence: row.absence,
    note: row.note,
    source: row.source,
    status: row.status,
    tone: row.tone,
    actions,
  };
}
