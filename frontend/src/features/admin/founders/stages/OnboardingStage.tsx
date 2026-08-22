/**
 * Stage 2 — Onboarding. Spec §9, §12, §26.2, §27.
 *
 * Twenty-four records in four groups, every one carrying its own source and its
 * own state. The reference's own sub-heading is the design rule: "Stage status
 * no longer marks unrelated answers complete" — a Founder who has written a
 * story and not uploaded a logo has one item done and one empty, and this
 * screen is not allowed to average them into a percentage.
 *
 * Structure, copy, classes, order and enabled states are the reference's. Only
 * the DATA differs: the reference ships a fixed Founder, and every value here
 * arrives from the workspace payload and the panel supplement.
 *
 * ── Admin watches; the Founder acts ────────────────────────────────────────
 * No row on this stage carries `Edit` or `Request change` — the reference gives
 * this group no `onEdit` and no `onRequestChange`, because a submitted
 * application is decided on the stage after this one. What the rows do carry is
 * `View` and `Download`, and both are local: `View` renders the saved content
 * the record already sent, and `Download` writes it to a file in the browser.
 *
 * ── The two action-bar controls ────────────────────────────────────────────
 * `Message Founder` opens the record's own conversation dialog — the same one
 * the record bar's Message tool opens, which states plainly that there is no
 * Founder message store and that a message to a Founder is a support case.
 * `Send reminder` posts to the Founder record's reminder route; where the
 * server has none, its refusal is what the Admin reads. Neither pretends.
 */

import { useState } from 'react';
import { AdminRequestError, call } from '../../api.js';
import { MessageDialog } from '../dialogs/MessageDialog.js';
import { relativeTime } from '../format.js';
import {
  RecordGroup,
  StageFrame,
  StateStrip,
  ValueDialog,
  accountRows,
  action,
  asRequestError,
  campaignAnswerRows,
  downloadFile,
  downloadNameFor,
  firstName,
  optionalItemRows,
  readPanel,
  refusalLine,
  withActions,
  type RecordRowProps,
  type RowAction,
  type SharedRow,
  type StageProps,
} from './recordGroup.js';

export function OnboardingStage({ detail, panel }: StageProps) {
  const { header, overview, campaigns } = detail;
  const p = readPanel(panel);
  /* The reference addresses the Founder by first name in both composed lines. */
  const who = firstName(header.preferredName);

  const [viewing, setViewing] = useState<{ label: string; lines: string[] } | null>(null);
  const [messaging, setMessaging] = useState(false);
  const [error, setError] = useState<AdminRequestError | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const view = (row: SharedRow): RowAction =>
    action('View', () =>
      setViewing({ label: row.label, lines: row.value ? [row.value] : [] }),
    );

  const download = (row: SharedRow): RowAction =>
    action('Download', () =>
      downloadFile(downloadNameFor(row.label), row.value ?? ''),
    );

  /* ── Group 1 — nine account facts, read-only on this stage ────────────── */
  const group1 = accountRows(detail, p).map((row) => withActions(row, []));

  /* ── Group 2 — the six campaign answers ───────────────────────────────── */
  const group2 = campaignAnswerRows(detail, p).map((row) =>
    withActions(
      row,
      /* Only the three prose answers have something to read and to export. */
      row.key === 'problem' || row.key === 'solution' || row.key === 'competition'
        ? [view(row), download(row)]
        : [],
    ),
  );

  /* ── Group 3 — the six optional-item display rows ─────────────────────── */
  const group3 = optionalItemRows(p).map((row) =>
    withActions(
      row,
      row.key === 'optional.visuals'
        ? [download(row)]
        : row.key === 'optional.story'
          ? [view(row), download(row)]
          : [],
    ),
  );

  /* ── Group 4 — persistent setup ───────────────────────────────────────── */
  const setup = p.persistentSetup;
  const refundsUrl = setup?.refundsUrl ?? null;
  const community = setup?.community ?? null;
  const communityValue = community
    ? [community.choice, community.url].filter(Boolean).join(' · ') || null
    : null;
  /* All eight policy documents are in legal review, so this list is empty on a
     real record. An empty list is a fact about the policies, not about the
     Founder, and the row says which. */
  const legalRecords = setup?.legalRecords ?? null;
  const isProduct = (overview.vetting.campaignType ?? campaigns.current?.type ?? '').includes(
    'Product',
  );

  const group4: RecordRowProps[] = [
    {
      label: 'Product refunds page',
      value: refundsUrl,
      absence: 'No refunds page saved',
      source: 'Founder saved',
      status: refundsUrl ? `Valid URL${isProduct ? ' · Required for Product' : ''}` : 'Empty',
      tone: refundsUrl ? 'done' : 'waiting',
      actions: [],
    },
    {
      label: 'Community',
      value: communityValue,
      absence: 'No community saved',
      source: 'Founder selected',
      status: communityValue ? 'Saved' : 'Empty',
      tone: communityValue ? 'plain' : 'waiting',
      actions: [],
    },
    {
      label: 'Legal records',
      value: legalRecords && legalRecords.length ? legalRecords.join(' · ') : null,
      absence:
        'No acceptance is recorded — every policy document is still a draft, so a consent may not cite one',
      source: 'Acceptance events',
      status: legalRecords && legalRecords.length ? 'Versions and timestamps retained' : 'Empty',
      tone: legalRecords && legalRecords.length ? 'done' : 'waiting',
      actions: [
        action('View', () => setViewing({ label: 'Legal records', lines: legalRecords ?? [] })),
      ],
    },
  ];

  /**
   * The reminder posts against the Founder record. There is no §27 reminder key
   * today, so the server is expected to refuse — and the refusal is what
   * renders. Reporting "Reminder sent" over a request that never delivered one
   * is the one outcome this must never produce (§1.4).
   */
  const sendReminder = () => {
    setSending(true);
    setError(null);
    setSent(null);
    call(`/api/admin/founders/${encodeURIComponent(header.prospectId)}/reminders`, {
      method: 'POST',
      body: JSON.stringify({ subject: 'onboarding' }),
    })
      .then(() => setSent('Reminder sent and recorded'))
      .catch((e: unknown) => setError(asRequestError(e)))
      .finally(() => setSending(false));
  };

  return (
    <>
      <StageFrame
        stage="Onboarding"
        heading={`${who}’s real saved onboarding`}
        lead="Each item has its own source and state. Stage status no longer marks unrelated answers complete."
      >
        <StateStrip
          status={p.onboarding?.statusLabel ?? overview.vetting.progressStatus}
          lastChange={
            p.onboarding?.lastSavedAt
              ? `Saved ${relativeTime(p.onboarding.lastSavedAt)}`
              : 'No save recorded against this record'
          }
          next={p.onboarding?.nextLabel ?? `${who} submits the application`}
        />

        <div className="record-groups">
          <RecordGroup title="Account, verification and eligibility" rows={group1} />
          <RecordGroup title="Core campaign answers" rows={group2} />
          <RecordGroup title="Optional items and listing-fee effect" rows={group3} />
          <RecordGroup title="Persistent setup" rows={group4} />

          <div className="actionbar">
            <div>
              <small>
                {sent ??
                  refusalLine(error) ??
                  'Only the Founder can submit the application for review. Admin can monitor progress or send help.'}
              </small>
            </div>
            <div className="action-buttons">
              <button type="button" onClick={() => setMessaging(true)}>
                Message Founder
              </button>
              <button
                className="primary"
                type="button"
                onClick={sendReminder}
                disabled={sending}
              >
                Send reminder
              </button>
            </div>
          </div>
        </div>
      </StageFrame>

      {viewing ? (
        <ValueDialog label={viewing.label} lines={viewing.lines} onClose={() => setViewing(null)} />
      ) : null}

      {messaging ? (
        <MessageDialog founderName={header.legalName} onClose={() => setMessaging(false)} />
      ) : null}
    </>
  );
}
