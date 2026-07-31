/**
 * One Founder — the record, the campaign, and the invitation.
 * Spec §7, §26.1, §26.2, §33.12.4.
 *
 * ── Preview is the gate, and the gate is visible ────────────────────────────
 * §7: "Preview must show final variables and no unresolved placeholder." Phase
 * 06's trap sharpens it: "an unresolved [VARIABLE] in preview must make Send
 * unavailable." So Send is disabled while the server reports anything
 * unresolved, the unresolved markers are named rather than merely counted, and
 * the reason sits beside the disabled control instead of appearing after a
 * failed attempt. The server re-decides independently — a disabled button is
 * not server-side authorization (§1.1).
 *
 * ── The link is never shown ─────────────────────────────────────────────────
 * §28.1 puts the raw token in the delivered URL and nowhere else, so this
 * surface can say a live link exists, which version it is, and when it
 * expires — never the value. An Admin who needs a working link for a Founder
 * resends one, which rotates and invalidates the old.
 *
 * ── Auto-populated, overrides recorded (§33.12.4) ───────────────────────────
 * Campaign status, the three §21 anchors, the send history, and the retention
 * due date are read from the record and are not re-keyable here. What Admin
 * writes is the invitation content, and every edit records prior and new value,
 * actor, reason, and time server-side.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import { Button, Card, Field, Input, StatePanel, Tag, Textarea } from '../../components/index.js';
import {
  fetchFounderDetail,
  fetchInvitationPreview,
  fetchInvitationCopy,
  composeInvitation,
  sendInvitation,
  revokeInvitation,
  AdminRequestError,
  type FounderDetail as FounderDetailData,
  type InvitationPreview,
  type InvitationCopy,
} from './api.js';
import { When } from './FoundersPage.js';

export function FounderDetail() {
  const { draftId = '' } = useParams();
  const [detail, setDetail] = useState<FounderDetailData | null>(null);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [copy, setCopy] = useState<InvitationCopy | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetchFounderDetail(draftId),
      fetchInvitationPreview(draftId).catch(() => null),
      fetchInvitationCopy().catch(() => null),
    ])
      .then(([nextDetail, nextPreview, nextCopy]) => {
        setDetail(nextDetail);
        setPreview(nextPreview);
        setCopy(nextCopy);
      })
      .catch((error: unknown) => {
        if (error instanceof AdminRequestError) setLoadError(error);
      });
  }, [draftId]);

  useEffect(load, [load]);

  if (loadError) {
    return (
      <StatePanel
        state={loadError.detail.title}
        whatHappened={loadError.detail.whatHappened ?? 'This Founder could not be read.'}
        next={loadError.detail.next ?? 'Go back to the Founders list.'}
        owner="Proovd"
        nextUpdate="When you go back"
        action={
          <Button tier="secondary" href="/admin/founders">
            Back to Founders
          </Button>
        }
        reference={`Admin · draft ${draftId}`}
        ring
      />
    );
  }

  if (!detail) {
    return (
      <StatePanel
        state="Loading this Founder"
        whatHappened="Proovd is reading the prospect record, the campaign, and the invitation history."
        next="It appears as soon as it arrives. Nothing has been changed."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference={`Admin · draft ${draftId}`}
      />
    );
  }

  const anonymised = detail.draft.anonymisedAt !== null;

  return (
    <div className="admin-page">
      <header className="admin-page__head">
        <p className="admin-crumb">
          <RouterLink to="/admin/founders">← Founders</RouterLink>
        </p>
        <h1>{detail.prospect.legalName ?? 'Anonymised prospect'}</h1>
        <p className="admin-page__lede">
          {detail.prospect.productName ?? 'The product record was anonymised.'}
        </p>
      </header>

      {anonymised ? (
        <StatePanel
          state="This draft was anonymised"
          whatHappened={`Nobody claimed it within ${copy?.retentionDays ?? 30} calendar days of the most recent send, so its content was irreversibly removed and the link was revoked.`}
          next="Nothing here can be restored. Create a new prospect if you want to approach them again."
          owner="Proovd"
          nextUpdate="No update is pending"
          action="No action needed"
          reference={detail.draft.campaignId}
        />
      ) : null}

      <InvitationPanel detail={detail} preview={preview} onChanged={load} />

      <section className="admin-group" aria-labelledby="prospect-record">
        <h2 className="admin-group__heading" id="prospect-record">
          Prospect record
        </h2>
        <Card>
          <dl className="kv">
            <Row label="Legal name" value={detail.prospect.legalName} />
            <Row label="Preferred name" value={detail.prospect.preferredName} />
            <Row label="Email" value={detail.prospect.email} />
            <Row label="Phone" value={detail.prospect['phone'] as string | null} note="Never verified. Proovd sends no codes to a phone." />
            <Row label="Product" value={detail.prospect.productName} />
            <Row label="Product URL" value={detail.prospect.productUrl} />
            <Row label="Launch frame" value={detail.prospect['launchFrame'] as string | null} />
            <Row label="US and 18+ fit" value={detail.prospect['usAgeFit'] as string | null} />
            <Row label="Delivery feasibility" value={detail.prospect['deliveryFeasibility'] as string | null} />
            <Row label="Compensation expectations" value={detail.prospect['compensationExpectations'] as string | null} />
            <Row label="Creator-sourcing hypothesis" value={detail.prospect['affiliateSourcingHypothesis'] as string | null} />
            <Row label="Invitation source" value={detail.prospect.invitationSource} />
            <Row label="Internal owner" value={detail.prospect.internalOwner} />
            <Row label="Admin notes" value={detail.prospect['adminNotes'] as string | null} />
          </dl>
        </Card>
      </section>

      <CampaignPanel detail={detail} />

      <section className="admin-group" aria-labelledby="send-history">
        <h2 className="admin-group__heading" id="send-history">
          Invitation history
        </h2>
        {detail.sends.length === 0 ? (
          <p>Nothing has been sent yet.</p>
        ) : (
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Sent</th>
                  <th scope="col">To</th>
                  <th scope="col">By</th>
                  <th scope="col">Link version</th>
                  <th scope="col">Link expires</th>
                  <th scope="col">Message ID</th>
                </tr>
              </thead>
              <tbody>
                {detail.sends.map((send) => (
                  <tr key={send.id}>
                    <th scope="row">
                      <When value={send.sentAt} />
                    </th>
                    <td>{send.recipientEmail ?? 'Anonymised'}</td>
                    <td>{send.sentBy}</td>
                    <td>v{send.tokenVersion}</td>
                    <td>
                      <When value={send.tokenExpiresAt} />
                    </td>
                    <td>{send.notificationId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string | null; note?: string }) {
  return (
    <div className="kv__row">
      <dt>{label}</dt>
      <dd>
        {value ?? <span className="setting__unset">Not recorded</span>}
        {note ? <span className="admin-table__sub">{note}</span> : null}
      </dd>
    </div>
  );
}

/* ── §26.2 Campaign detail ────────────────────────────────────────────────── */

function CampaignPanel({ detail }: { detail: FounderDetailData }) {
  const campaign = detail.campaign;
  if (!campaign) return null;

  return (
    <section className="admin-group" aria-labelledby="campaign-detail">
      <h2 className="admin-group__heading" id="campaign-detail">
        Campaign
      </h2>
      <Card>
        <dl className="kv">
          <Row label="Campaign ID" value={campaign.id} />
          <Row
            label="Type"
            value={campaign.type}
            note="Locked at vetting. Guessing it from a discovery call would be a commitment Proovd has not made."
          />
          <Row label="Lifecycle status" value={campaign.status} />
        </dl>

        {/* §23.2: the two tracks are separate columns and are shown separately.
            `review_ready` is derived from them and is never stored as truth. */}
        <h3>Parallel tracks</h3>
        <dl className="kv">
          <Row label="Creator roster" value={campaign.affiliateRosterStatus} />
          <Row label="Campaign build" value={campaign.campaignBuildStatus} />
        </dl>

        {/* §21: the three anchors are dedicated columns and are never inferred
            from created_at or updated_at. Shown as their own block for that
            reason. */}
        <h3>Deadline anchors</h3>
        <dl className="kv">
          <AnchorRow label="Listing paid at" value={campaign.listingPaidAt} />
          <AnchorRow label="Campaign live at" value={campaign.campaignLiveAt} />
          <AnchorRow label="Campaign close at" value={campaign.campaignCloseAt} />
        </dl>
        <p className="admin-note">
          Payment and reconciliation state is not part of the lifecycle status and is
          never shown as one. Those records arrive with the phases that create them.
        </p>
      </Card>
    </section>
  );
}

function AnchorRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="kv__row">
      <dt>{label}</dt>
      <dd>{value ? <When value={value} /> : <span className="setting__unset">Not set yet</span>}</dd>
    </div>
  );
}

/* ── §7 the invitation: compose, preview, send, resend, revoke ────────────── */

function InvitationPanel({
  detail,
  preview,
  onChanged,
}: {
  detail: FounderDetailData;
  preview: InvitationPreview | null;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState({
    whatWeUnderstood: detail.draft.whatWeUnderstood ?? '',
    whyInvited: detail.draft.whyInvited ?? '',
    senderName: detail.draft.senderName ?? '',
    senderEmail: detail.draft.senderEmail ?? '',
    expectedSetupTime: detail.draft.expectedSetupTime ?? '',
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const anonymised = detail.draft.anonymisedAt !== null;
  const claimed = detail.draft.status === 'claimed';
  const blocked = preview?.blocked ?? true;
  const disabled = anonymised || claimed;

  const set = (key: keyof typeof draft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  async function run(label: string, action: () => Promise<unknown>, success: string) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof AdminRequestError
          ? [caught.detail.whatHappened, caught.detail.next].filter(Boolean).join(' ')
          : 'That did not go through. Nothing has changed.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="admin-group" aria-labelledby="invitation">
      <h2 className="admin-group__heading" id="invitation">
        Invitation
      </h2>

      <Card className="invitation">
        <p className="invitation__state">
          {detail.hasLiveToken ? (
            <Tag variant="live">A link is live</Tag>
          ) : (
            <Tag variant="sage">No live link</Tag>
          )}
          {detail.lastSentAt ? (
            <span>
              Last sent <When value={detail.lastSentAt} />
            </span>
          ) : (
            <span>Never sent</span>
          )}
        </p>
        {detail.retentionDueAt && !anonymised ? (
          <p className="admin-note">
            If nobody claims it, this draft is anonymised on{' '}
            <When value={detail.retentionDueAt} />. Resending restarts that window.
          </p>
        ) : null}
        <p className="admin-note">
          The link itself is never shown here. It exists only in the email that was
          delivered — resend to give the Founder a working one, which replaces the old.
        </p>
      </Card>

      {!disabled ? (
        <Card className="admin-form-card">
          <div className="admin-form admin-form--wide">
            <Field label="What Proovd understood about the product">
              <Textarea rows={3} value={draft.whatWeUnderstood} onChange={set('whatWeUnderstood')} />
            </Field>
            <Field label="Why this Founder was invited">
              <Textarea rows={3} value={draft.whyInvited} onChange={set('whyInvited')} />
            </Field>
            <Field label="Named Proovd sender">
              <Input value={draft.senderName} onChange={set('senderName')} />
            </Field>
            <Field label="Reply address" hint="Replies to the invitation come here.">
              <Input type="email" value={draft.senderEmail} onChange={set('senderEmail')} />
            </Field>
            <Field
              label="Honest setup-time expectation"
              hint="What it actually takes. An optimistic number here is a broken promise later."
            >
              <Input value={draft.expectedSetupTime} onChange={set('expectedSetupTime')} />
            </Field>

            <Button
              tier="secondary"
              disabled={busy !== null}
              onClick={() =>
                void run('compose', () => composeInvitation(detail.draft.id, draft), 'Saved.')
              }
            >
              {busy === 'compose' ? 'Saving…' : 'Save invitation content'}
            </Button>
          </div>
        </Card>
      ) : null}

      {preview ? (
        <Card className="invitation__preview">
          <h3>Preview</h3>
          <p className="admin-note">
            The exact message, with final variables. The link shown is a placeholder — the
            real one-time link is generated when you send.
          </p>

          {blocked ? (
            <div className="invitation__gate">
              <p className="invitation__gate-head">Send is unavailable</p>
              <p>
                {preview.unresolved.length > 0
                  ? 'A Founder must never receive a placeholder. Fill these in:'
                  : 'This prospect has no email address to send to.'}
              </p>
              {preview.unresolved.length > 0 ? (
                <ul className="invitation__unresolved">
                  {preview.unresolved.map((marker) => (
                    <li key={marker}>
                      <code>{marker}</code>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <p className="invitation__subject">
            <strong>Subject:</strong> {preview.subject}
          </p>
          <pre className="invitation__text">{preview.text}</pre>
        </Card>
      ) : null}

      {!disabled ? (
        <div className="invitation__actions">
          <Button
            disabled={blocked || busy !== null}
            onClick={() =>
              void run(
                'send',
                () => sendInvitation(detail.draft.id),
                detail.hasLiveToken
                  ? 'Resent. The previous link no longer works and the 30-day window restarted.'
                  : 'Sent.',
              )
            }
          >
            {busy === 'send'
              ? 'Sending…'
              : detail.hasLiveToken
                ? 'Resend invitation'
                : 'Send invitation'}
          </Button>

          <Button
            tier="tertiary"
            aria-expanded={showPreview}
            onClick={() => setShowPreview((was) => !was)}
          >
            {showPreview ? 'Hide rendered email' : 'View rendered email'}
          </Button>

          {detail.hasLiveToken ? (
            <Button
              tier="tertiary"
              aria-expanded={revoking}
              onClick={() => setRevoking((was) => !was)}
            >
              {revoking ? 'Cancel' : 'Revoke link'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showPreview && preview ? (
        <Card>
          {/* The rendered HTML, in an iframe with no scripts and no same-origin
              access. It is Proovd's own template, but rendering arbitrary HTML
              inline into the Admin document is a habit worth not forming. */}
          <iframe
            className="invitation__frame"
            title="Rendered invitation email"
            sandbox=""
            srcDoc={preview.html}
          />
        </Card>
      ) : null}

      {revoking ? (
        <Card className="admin-form-card">
          <div className="admin-form">
            <Field
              label="Why is this being revoked?"
              hint="Stored with the revocation. The Founder's link stops working immediately."
            >
              <Input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} />
            </Field>
            <Button
              tier="secondary"
              disabled={revokeReason.trim().length === 0 || busy !== null}
              onClick={() =>
                void run(
                  'revoke',
                  () => revokeInvitation(detail.draft.id, revokeReason),
                  'Revoked. The link no longer works.',
                ).then(() => {
                  setRevoking(false);
                  setRevokeReason('');
                })
              }
            >
              {busy === 'revoke' ? 'Revoking…' : 'Revoke the link'}
            </Button>
          </div>
        </Card>
      ) : null}

      {notice ? (
        <p className="invitation__notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
