/**
 * Admin notifications — §27.7's history and §27.2's preview (Phase 22c).
 *
 * Two things an Admin needs that nobody else does:
 *
 *  - **the history for any address.** §27.7 gives Admin the same notification
 *    history the Founder and Creator get, and support work is the reason: "did
 *    they get the email" is the first question of half the cases §26.7 opens,
 *    and the alternative to answering it here is guessing at the provider
 *    dashboard. Admin sees the recipient and the provider's message id; the
 *    customer surfaces see neither.
 *
 *  - **§27.2's preview.** "High-impact messages can be previewed with final
 *    variables before manual send." 22a built the machine — one render through
 *    the same catalog entry the sender uses, beside a report of every decidable
 *    §27.2 rule — and left the surface here.
 *
 * ── The preview reports; it does not refuse ────────────────────────────────
 * Two refusing gates already exist where a human actually composes and sends:
 * §7's and §8's invitation previews scan the *rendered* message and block the
 * send while a bracketed marker survives. A third gate here would block on a
 * heuristic — "does this look like a money message" is a judgement — and a gate
 * that blocks on a heuristic trains an Admin to work around it. So this states
 * what correct means and shows where a message falls short.
 *
 * ── There is no send button, and there is nowhere to put one ───────────────
 * The preview renders from the catalog's own sample variables. Nothing here
 * addresses a message, and no route behind it accepts a recipient. §26.8's rule
 * for support templates, applied to the one surface that renders every template
 * in the product: a one-click send would answer a person with a machine.
 */

import { useCallback, useEffect, useState } from 'react';
import { NOTIFICATION_EVENTS, type NotificationEventKey } from '@proovd/shared';
import {
  NotificationHistory,
  type HistoryEntry,
} from '../../surfaces/notifications/NotificationHistory.js';

interface ContractReport {
  actionUrls: string[];
  oneActionAtMost: boolean;
  hasSupportRoute: boolean;
  hasStableReference: boolean;
  optOutRule: 'forbidden' | 'required';
  hasOptOutPath: boolean;
  optOutRuleSatisfied: boolean;
  moneyFactsMissing: string[];
  deadlineNamesTimezone: boolean | null;
  namingViolations: { term: string; specRef: string; replacement: string }[];
  satisfiesContract: boolean;
}

interface PreviewResult {
  eventKey: string;
  audience: string;
  subject: string;
  html: string;
  text: string;
  report: ContractReport;
}

/**
 * The report as rows. `deadlineNamesTimezone: null` means the message carries
 * no deadline — which is not a pass and not a failure, so it says so rather
 * than rendering a tick that would read as one (§1.4).
 */
function reportRows(report: ContractReport) {
  return [
    {
      rule: 'At most one primary action',
      specRef: '§27.2',
      state: report.oneActionAtMost ? 'ok' : 'fail',
      detail: `${report.actionUrls.length} navigable action${report.actionUrls.length === 1 ? '' : 's'}`,
    },
    {
      rule: 'Plain-text support route',
      specRef: '§27.2',
      state: report.hasSupportRoute ? 'ok' : 'fail',
      detail: '',
    },
    {
      rule: 'Stable reference',
      specRef: '§27.2',
      state: report.hasStableReference ? 'ok' : 'fail',
      detail: '',
    },
    {
      rule:
        report.optOutRule === 'forbidden'
          ? 'Not opt-out-able'
          : 'Carries a route to its own preference',
      specRef: report.optOutRule === 'forbidden' ? '§27.2' : '§27.7',
      state: report.optOutRuleSatisfied ? 'ok' : 'fail',
      detail:
        report.optOutRule === 'required'
          ? 'The digest is the one message a person may switch off.'
          : '',
    },
    {
      rule: 'Money facts',
      specRef: '§27.2, §3.3',
      state: report.moneyFactsMissing.length === 0 ? 'ok' : 'fail',
      detail: report.moneyFactsMissing.length ? `Missing: ${report.moneyFactsMissing.join(', ')}` : '',
    },
    {
      rule: 'Deadline spells out its timezone',
      specRef: '§27.1',
      state:
        report.deadlineNamesTimezone === null
          ? 'n/a'
          : report.deadlineNamesTimezone
            ? 'ok'
            : 'fail',
      detail: report.deadlineNamesTimezone === null ? 'This message carries no deadline.' : '',
    },
    {
      rule: 'Naming contract',
      specRef: '§3.1, §3.2',
      state: report.namingViolations.length === 0 ? 'ok' : 'fail',
      detail: report.namingViolations.map((v) => `${v.term} → ${v.replacement}`).join('; '),
    },
  ];
}

const STATE_MARK: Record<string, string> = { ok: '✓', fail: '×', 'n/a': '–' };

export function AdminNotificationsPage() {
  const [email, setEmail] = useState('');
  const [applied, setApplied] = useState('');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const loadHistory = useCallback(async (address: string, before?: string) => {
    const params = new URLSearchParams();
    if (address) params.set('email', address);
    if (before) params.set('before', before);
    const res = await fetch(`/api/admin/notifications/history?${params}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      setFailure('We could not load the delivery history. Nothing was changed.');
      return;
    }
    const body = (await res.json()) as { history: { entries: HistoryEntry[]; nextCursor: string | null } };
    setEntries((current) => (before ? [...current, ...body.history.entries] : body.history.entries));
    setCursor(body.history.nextCursor);
    setFailure(null);
  }, []);

  useEffect(() => {
    void loadHistory('');
    void (async () => {
      const res = await fetch('/api/admin/notifications/catalog', { credentials: 'include' });
      if (res.ok) setKeys(((await res.json()) as { keys: string[] }).keys);
    })();
  }, [loadHistory]);

  const runPreview = useCallback(async (eventKey: string) => {
    setSelected(eventKey);
    if (!eventKey) {
      setPreview(null);
      return;
    }
    const res = await fetch(
      `/api/admin/notifications/preview/${encodeURIComponent(eventKey)}`,
      { credentials: 'include' },
    );
    setPreview(res.ok ? ((await res.json()) as PreviewResult) : null);
  }, []);

  return (
    <div className="admin-page">
      <h1 className="h2">Notifications</h1>

      <section aria-labelledby="admin-notification-history">
        <h2 className="h2" id="admin-notification-history">
          Delivery history
        </h2>
        <p className="admin-note">
          Every message the product recorded, newest first. A delivery the provider never
          confirmed is shown as exactly that — it may still have arrived.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(email);
            void loadHistory(email);
          }}
        >
          <label htmlFor="admin-notification-email">Filter by recipient address</label>
          <input
            id="admin-notification-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Leave empty for every recipient"
          />
          {/* §33.11.4: the control names what it does. `Apply` names nothing —
              on a page with a preview form beside it, it could be either. */}
          <button type="submit" className="btn btn--secondary">
            Filter the history
          </button>
        </form>
        {applied ? <p className="admin-note">Showing messages sent to {applied}.</p> : null}
        {failure ? <p role="alert">{failure}</p> : null}
        <NotificationHistory
          entries={entries}
          showTarget
          {...(cursor ? { onLoadMore: () => void loadHistory(applied, cursor) } : {})}
        />
      </section>

      <section aria-labelledby="admin-notification-preview">
        <h2 className="h2" id="admin-notification-preview">
          Message preview
        </h2>
        <p className="admin-note">
          Renders through the same template the sender uses, with representative variables, and
          reports every §27.2 rule that can be decided from the rendered message. This is a
          report, not a gate — nothing here sends anything to anyone.
        </p>
        <label htmlFor="admin-notification-key">Message</label>
        <select
          id="admin-notification-key"
          value={selected}
          onChange={(event) => void runPreview(event.target.value)}
        >
          <option value="">Choose a message…</option>
          {keys.map((key) => (
            <option key={key} value={key}>
              {NOTIFICATION_EVENTS[key as NotificationEventKey]?.description ?? key} ({key})
            </option>
          ))}
        </select>

        {preview ? (
          <div>
            <p>
              <strong>Subject:</strong> {preview.subject}
            </p>
            <p className="admin-note">Audience: {preview.audience}</p>
            <h3>Contract report</h3>
            <ul className="notification-history__list">
              {reportRows(preview.report).map((row) => (
                <li key={row.rule} className="notification-history__item">
                  <span>
                    {STATE_MARK[row.state]} {row.rule}
                  </span>
                  <span className="notification-history__when">
                    {row.specRef}
                    {row.detail ? ` — ${row.detail}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <h3>Plain-text part</h3>
            <pre className="ended-banner__explanation">{preview.text}</pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}
