/**
 * The upload zone and the file rows — Founder Flow v2, Session D.
 *
 * Visuals (screen 10) and Branding (screen 11) both upload, and both go through
 * the Phase 09a path unchanged: presign, the browser PUTs straight to R2, then
 * the server reads the object BACK and decides what it is. No file body ever
 * reaches Proovd's own process (tech-stack §9), and there is no route that
 * would accept one.
 *
 * ── R2 is unconfigured, and the absence is named rather than disabled ───────
 * Track A4. `unconfiguredStorage` throws, the presign answers 503 naming the
 * gap, and `workspace.uploadsAvailable` carries the same fact on the read — so
 * the surface renders the reason where the control would be instead of a
 * control that fails when pressed. The Affiliate evidence uploader's
 * arrangement, for the same reason: somebody has already chosen a file by the
 * time a dead control answers.
 *
 * ── Approval is its own control ─────────────────────────────────────────────
 * §12: a visual counts only when it is "uploaded, accessible, and Founder-
 * approved for campaign use". §28.4 forbids bundling that into the upload, so
 * it is a separate unchecked control on the row — which is also why a file can
 * sit there stored and not counting, and the row says which.
 */

import { useRef, useState } from 'react';
import { Button, Option, Tag } from '../../components/index.js';
import { FounderRequestError, type AssetState } from '../founder/api.js';
import { rejectionText } from './AnswerPage.js';

export function AssetRow({
  asset,
  disabled,
  onApprove,
  onRemove,
}: {
  asset: AssetState;
  disabled: boolean;
  onApprove: (approved: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <li className="ff-file">
      <span className="ff-file__name">{asset.filename ?? 'Uploaded file'}</span>
      {asset.state === 'rejected' ? (
        <span className="ff-file__note">
          <Tag>Does not count</Tag> {rejectionText(asset.rejection ?? '')}
        </span>
      ) : asset.state === 'pending' ? (
        <span className="ff-file__note">Still uploading.</span>
      ) : (
        <Option
          label="Approved for use on my campaign"
          checked={asset.approved}
          disabled={disabled}
          onCheckedChange={onApprove}
        />
      )}
      <Button tier="tertiary" small onClick={onRemove} disabled={disabled}>
        Remove this file
      </Button>
    </li>
  );
}

export function UploadZone({
  purpose,
  available,
  disabled,
  label,
  onUpload,
}: {
  purpose: 'visual' | 'logo';
  available: boolean;
  disabled: boolean;
  label: string;
  onUpload: (file: File) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!available) {
    return (
      <p className="ff-upload__absent">
        Uploading is not switched on for this deployment yet, so there is nowhere to put a file.
        Everything else on this page works and nothing you have written has been lost — you can
        add files here once we turn it on, and we will tell you when.
      </p>
    );
  }

  async function choose(file: File) {
    setBusy(true);
    setFailure(null);
    try {
      await onUpload(file);
    } catch (error) {
      setFailure(
        error instanceof FounderRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'That file did not upload. Nothing else has changed.',
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="ff-upload">
      <input
        ref={inputRef}
        type="file"
        id={`ff-upload-${purpose}`}
        className="ff-upload__input"
        accept={purpose === 'logo' ? 'image/*' : 'image/*,video/mp4,video/quicktime'}
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void choose(file);
        }}
      />
      {/* The reference's 500px dashed zone. It is a `label` rather than a button
          over a hidden input, so a keyboard user reaches the real file control
          and the browser's own picker opens (§28.5). */}
      <label className="ff-upload__zone" htmlFor={`ff-upload-${purpose}`}>
        <span className="ff-upload__glyph" aria-hidden="true">
          ↓
        </span>
        <span className="ff-upload__label">{busy ? 'Adding your file…' : label}</span>
        <span className="ff-upload__types">
          {purpose === 'logo' ? 'PNG or JPG' : 'PNG, JPG or MP4'}
        </span>
      </label>
      {failure ? (
        <p className="ff-answer__refusal" role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
