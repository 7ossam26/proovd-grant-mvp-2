/**
 * The private campaign invitation — §8, §11, §28.1.
 *
 * ── Compose, preview, then send. Three acts, in that order ──────────────────
 * §8 requires a preview before a manual send, and `previewAffiliateInvitation`
 * scans the RENDERED subject, HTML, and text for unresolved markers rather than
 * checking the caller's list of fields. This dialog shows what that scan found
 * and disables Send while anything is outstanding — and the send route
 * re-decides independently, because a disabled button is not authorization
 * (§1.1).
 *
 * ── The raw token appears nowhere ───────────────────────────────────────────
 * §28.1 puts the raw value in the delivered URL and nowhere else. What is shown
 * is the SHAPE of the claim URL, that a live link exists, and every send with
 * its sender and confirmation state — never a link an Admin could click.
 *
 * ── An unconfirmed send is a state, not an error ────────────────────────────
 * The send row is written BEFORE the provider call and confirmed after, so
 * `confirmed: false` means "recorded, not confirmed delivered". Rendering it as
 * a failure would be wrong; rendering it as success would be worse.
 */

import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { Button, Field, Input, Textarea } from '../../../../components/index.js';
import { DialogShell } from '../../founders/dialogs/index.js';
import {
  AdminRequestError,
  composeInvitation,
  fetchCreator,
  previewInvitation,
  revokeInvitation,
  sendInvitation,
  type CreatorInvitationView,
  type CreatorWorkspaceDetail,
  type InvitationPreview,
} from '../api.js';

export function InvitationDialog({
  prospectId,
  associationId,
  invitation,
  trigger,
  onClose,
  onDone,
}: {
  prospectId: string;
  associationId: string;
  invitation: CreatorInvitationView;
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (detail: CreatorWorkspaceDetail) => void;
}) {
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState({
    whyRecruited: '',
    reviewedPresence: '',
    senderName: '',
    senderEmail: '',
  });

  const loadPreview = () => {
    previewInvitation(associationId)
      .then(setPreview)
      .catch((error: unknown) => {
        setFailure(
          error instanceof AdminRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'The preview could not be read.',
        );
      });
  };

  useEffect(loadPreview, [associationId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      onDone(await fetchCreator(prospectId));
    } catch (error: unknown) {
      // The server's refusal is what the Admin reads, verbatim.
      setFailure(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'That did not complete, and nothing was changed.',
      );
      setBusy(false);
      loadPreview();
    }
  }

  return (
    <DialogShell
      kicker={`${invitation.campaignName} · Campaign invitation`}
      title={invitation.stateLabel}
      description="One private invitation per campaign relationship. Composing it changes only the record; sending it is the separate act."
      trigger={trigger}
      onClose={onClose}
    >
      {(close) => (
        <>
          {failure ? (
            <p className="helper" role="alert">
              {failure}
            </p>
          ) : null}

          {invitation.unresolved.length > 0 ? (
            <>
              <p className="helper">
                Before this can be sent: {invitation.unresolved.join(', ')}.
              </p>
              {/*
                §8's invitation names the Founder and the product, and neither
                is written from this screen. Recruitment may run before Founder
                onboarding, so this is a state a campaign genuinely reaches —
                naming the blocker without naming its destination is what made
                it a dead end.
              */}
              {invitation.unresolved.some((entry) => entry.includes('Founder’s record')) ? (
                <p className="helper">
                  Those last ones are the Founder’s to record, not this screen’s.{' '}
                  <RouterLink to={`/admin/campaigns/${invitation.campaignId}`}>
                    Open the campaign
                  </RouterLink>{' '}
                  to reach their record. Nothing here is lost meanwhile.
                </p>
              ) : null}
              <Field label="Why this Affiliate was recruited">
                <Textarea
                  value={composing.whyRecruited}
                  onChange={(event) =>
                    setComposing((c) => ({ ...c, whyRecruited: event.target.value }))
                  }
                />
              </Field>
              <Field label="What was reviewed">
                <Textarea
                  value={composing.reviewedPresence}
                  onChange={(event) =>
                    setComposing((c) => ({ ...c, reviewedPresence: event.target.value }))
                  }
                />
              </Field>
              <Field label="Sender name">
                <Input
                  value={composing.senderName}
                  onChange={(event) =>
                    setComposing((c) => ({ ...c, senderName: event.target.value }))
                  }
                />
              </Field>
              <Field label="Sender email">
                <Input
                  type="email"
                  value={composing.senderEmail}
                  onChange={(event) =>
                    setComposing((c) => ({ ...c, senderEmail: event.target.value }))
                  }
                />
              </Field>
            </>
          ) : null}

          {preview ? (
            <div className="cr-preview">
              <p className="kicker">Preview</p>
              <p>
                <b>{preview.subject}</b>
              </p>
              {/*
                The plain-text part, rendered as text. The HTML body is never
                injected into this page: an Admin surface that rendered a
                composed message as markup would be executing content composed
                elsewhere in the same origin as the Admin session.
              */}
              <pre className="cr-preview__body">{preview.text}</pre>
              <p className="helper">
                Claim link shape: {preview.claimUrlShape} · the raw token is only ever in the
                delivered URL.
              </p>
              {preview.unresolved.length > 0 ? (
                <p className="helper">
                  The rendered message still contains: {preview.unresolved.join(', ')}.
                </p>
              ) : null}
            </div>
          ) : null}

          {invitation.sends.length > 0 ? (
            <div className="cr-sends">
              <p className="kicker">Send history</p>
              <ul>
                {invitation.sends.map((send, index) => (
                  <li key={`${send.at}-${index}`}>
                    <b>{send.at}</b> · {send.by} · {send.to}
                    <span className="helper">
                      {send.confirmed
                        ? 'Delivery confirmed'
                        : 'Recorded, delivery not confirmed'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="case-actions">
            {invitation.unresolved.length > 0 ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    composeInvitation(associationId, {
                      whyRecruited: composing.whyRecruited || null,
                      reviewedPresence: composing.reviewedPresence || null,
                      senderName: composing.senderName || null,
                      senderEmail: composing.senderEmail || null,
                    }),
                  )
                }
              >
                Save the invitation
              </Button>
            ) : null}

            {/*
              Send is always here, and the PREVIEW decides whether it is
              available — the preview is the gate's own answer over the
              rendered message, where `invitation.unresolved` is only an input
              hint. This used to be the `else` of the branch above, so a
              blocker the four boxes cannot write — `[PRODUCT NAME]`, which
              lives on the Founder's record — hid the Send control entirely and
              left no way to reach it and no statement of why.
            */}
            <Button
              disabled={busy || !preview || preview.blocked}
              onClick={() => void run(() => sendInvitation(associationId))}
            >
              {invitation.state === 'sent' ? 'Send a new invitation' : 'Send the invitation'}
            </Button>

            {invitation.hasLiveToken ? (
              <Button
                tier="secondary"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    revokeInvitation(associationId, {
                      reason: 'Revoked from the Creator workspace.',
                    }),
                  )
                }
              >
                Revoke the link
              </Button>
            ) : null}

            <Button tier="tertiary" onClick={close}>
              Close
            </Button>
          </div>
        </>
      )}
    </DialogShell>
  );
}
