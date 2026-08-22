/**
 * The §7 preview — what the Founder will actually receive.
 *
 * The rendered template, in an iframe, plus the gate's own verdict. The iframe
 * is `sandbox`ed with nothing granted: this is an email body, it has no reason
 * to run script or navigate, and the preview must not become a way to execute
 * something inside the Admin origin.
 *
 * ── No link is shown, and that is not an omission ───────────────────────────
 * §28.1 puts the raw draft token in the delivered URL and nowhere else, so the
 * preview renders `…/draft/…` rather than a working link. Previewing cannot
 * mint one and cannot recover the last one — the value is unrecoverable by
 * construction. An Admin who needs the Founder to have a working link sends a
 * new invitation.
 */

import type { InvitationPreview } from '../api.js';

interface Props {
  preview: InvitationPreview;
  onClose: () => void;
}

export function InvitationPreviewDialog({ preview, onClose }: Props) {
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-label="Invitation preview">
        <button className="close-button" type="button" onClick={onClose}>
          Close
        </button>
        <p className="dialog-kicker">Invitation preview</p>
        <h2>{preview.subject}</h2>
        <p className="dialog-lead">
          To {preview.recipientEmail ?? 'no recipient yet'}.{' '}
          {preview.blocked
            ? 'Send is held closed until everything below is resolved.'
            : 'Nothing is unresolved — this is what will be delivered.'}
        </p>

        {preview.missingFields.length > 0 ? (
          <p className="form-note">Missing: {preview.missingFields.join(', ')}</p>
        ) : null}
        {preview.unresolved.length > 0 ? (
          <p className="form-note">Unresolved placeholders: {preview.unresolved.join(', ')}</p>
        ) : null}

        <iframe
          title="Invitation body"
          sandbox=""
          srcDoc={preview.html}
          style={{ width: '100%', height: '55vh', border: '1px solid var(--grey-light)' }}
        />
      </section>
    </div>
  );
}
