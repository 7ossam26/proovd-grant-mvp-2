/**
 * Screen 10 — Visuals — Founder Flow v2, Session D.
 *
 * §12: "at least one non-placeholder campaign visual or video is uploaded,
 * accessible, and Founder-approved for campaign use." Every clause of that is
 * decided by the server from the object it read back; this screen uploads and
 * approves, and reports what it was told.
 *
 * ── The reference's link row is not built, and that is a real decision ──────
 * The prototype offers "paste your link" beside the upload zone. There is no
 * column for a linked visual: `campaign_assets` holds a storage key, a
 * checksum, the bytes' own dimensions and the format read from its magic bytes
 * — the whole §12 evidence rule is "we fetched it and looked at it". A URL
 * would have to be fetched from wherever a Founder pointed, on a schedule
 * nobody defined, and could change after approval to something the Founder
 * never approved. §12's socials step is where a URL is genuinely the record and
 * `checkSocialUrl` is what it costs to do safely.
 */

import { useParams } from 'react-router';
import {
  fileChecksum,
  putToStorage,
  removeAsset,
  requestUpload,
  setAssetApproval,
  verifyUpload,
} from '../founder/api.js';
import { AnswerPage, HelperBlock } from './AnswerPage.js';
import { AssetRow, UploadZone } from './SetupUploads.js';

export function VisualsStep() {
  const { campaignId = '' } = useParams();

  return (
    <AnswerPage pageId="visuals" itemKey="visuals">
      {({ state, refresh }) => (
        <>
          <ul className="ff-file-list">
            {state.visuals.map((asset) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                disabled={state.listingPaid}
                onApprove={(approved) =>
                  void refresh(setAssetApproval(campaignId, asset.id, approved))
                }
                onRemove={() => void refresh(removeAsset(campaignId, asset.id))}
              />
            ))}
          </ul>

          <UploadZone
            purpose="visual"
            available={state.uploadsAvailable}
            disabled={state.listingPaid}
            label="Add a photo or video"
            onUpload={async (file) => {
              const presigned = await requestUpload(campaignId, {
                purpose: 'visual',
                contentType: file.type,
                byteSize: file.size,
                checksumSha256: await fileChecksum(file),
                filename: file.name,
              });
              await putToStorage(presigned, file);
              // The server reads the object back and decides what it is (§12).
              await refresh(verifyUpload(campaignId, presigned.assetId));
            }}
          />

          <HelperBlock subject="visuals" title="Help with your visuals" />
        </>
      )}
    </AnswerPage>
  );
}
