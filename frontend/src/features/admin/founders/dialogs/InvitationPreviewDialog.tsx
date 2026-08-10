/**
 * Exactly what the Founder will receive, rendered from the server's own render.
 *
 * ── The preview is the gate, not a mock-up ──────────────────────────────────
 * §7's send gate scans the *rendered* message for bracketed markers, and
 * `sendInvitation` refuses while any remain. So this asks the server to render
 * it and shows what came back — a preview assembled in the browser from the
 * same fields would be a second renderer, and the one that matters would be the
 * one nobody looked at.
 *
 * ── The plain-text part, deliberately ───────────────────────────────────────
 * The response carries the HTML body too, and it is not injected here: the
 * message is styled for an inbox, and dropping it into the Admin panel means
 * whatever it carries inherits this page's stylesheet and this page's origin.
 * The text part is what §27.2 already requires every message to have, and it is
 * the honest answer to "what does it say".
 */

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/index.js';
import { AdminRequestError, fetchInvitationPreview } from '../../api.js';
import { DialogShell } from './ConfirmDialog.js';

type Preview = Awaited<ReturnType<typeof fetchInvitationPreview>>;

interface InvitationPreviewDialogProps {
  prospectId: string;
  kicker: string;
  /** The Founder's preferred name — the panel says whose inbox this lands in. */
  preferredName: string;
  trigger: HTMLElement | null;
  onClose: () => void;
}

export function InvitationPreviewDialog({
  prospectId,
  kicker,
  preferredName,
  trigger,
  onClose,
}: InvitationPreviewDialogProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchInvitationPreview(prospectId)
      .then((result) => {
        if (live) setPreview(result);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setFailure(
          error instanceof AdminRequestError
            ? [error.detail.title, error.detail.whatHappened].filter(Boolean).join(' ')
            : 'The message could not be rendered, so there is nothing to check yet.',
        );
      });
    return () => {
      live = false;
    };
  }, [prospectId]);

  return (
    <DialogShell
      kicker={kicker}
      title={`Preview — exactly what ${preferredName} will receive`}
      description={
        <p className="helper">
          Rendered by the same code that sends it. Nothing is sent from this panel.
        </p>
      }
      trigger={trigger}
      onClose={onClose}
    >
      {(close) => (
        <>
          {failure ? (
            <p className="field-error" role="alert">
              {failure}
            </p>
          ) : preview === null ? (
            <p className="helper" role="status">
              Rendering the message…
            </p>
          ) : (
            <>
              <div className="inv-preview">
                <p className="inv-preview__hero">
                  <b>{preview.subject}</b>
                </p>
                {preview.text
                  .split(/\n{2,}/)
                  .map((paragraph) => paragraph.trim())
                  .filter((paragraph) => paragraph.length > 0)
                  .map((paragraph, index) => (
                    <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
                  ))}
              </div>
              <p className="helper">
                {preview.recipientEmail
                  ? `Addressed to ${preview.recipientEmail}.`
                  : 'No recipient address is recorded yet, so there is nowhere to send this.'}
              </p>
              {preview.unresolved.length > 0 ? (
                <>
                  <p className="helper">
                    Every variable must resolve before this can be sent. These did not:
                  </p>
                  <ul className="plain-list">
                    {preview.unresolved.map((marker) => (
                      <li key={marker}>{marker}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="helper">
                  Every variable is resolved — no placeholder can remain in a sendable
                  preview.
                </p>
              )}
            </>
          )}

          <div className="case-actions">
            <Button tier="tertiary" onClick={close}>
              Close preview
            </Button>
          </div>
        </>
      )}
    </DialogShell>
  );
}
