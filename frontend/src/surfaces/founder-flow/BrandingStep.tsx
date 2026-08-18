/**
 * Screen 11 — Branding — Founder Flow v2, Session D.
 *
 * §12: "a usable logo/wordmark and saved direction containing at least colors
 * and typography/style guidance are provided and Founder-approved." Colours and
 * typography are named separately in that sentence, so they are two fields —
 * one "direction" box would make "contains at least colours" a substring search
 * over prose.
 *
 * ── The swatches build the colours text; they are not a second record ───────
 * The reference draws a draggable HSV plane over a hue bar, an editable hex
 * field, and three swatch slots. The plane is refused (`FOUNDER_FLOW_ABSENCES`):
 * a drag surface with no keyboard equivalent fails §28.5, and §12 does not ask
 * for a colour VALUE — it asks for saved direction, which is writing. What
 * survives is the part that carries the meaning: a hex field that appends a
 * line to the colours box, and the swatches that box already implies. So there
 * is still exactly ONE record for the colours, and the chips are a reading of
 * it rather than a second place it lives.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Button, Field, Input, Option, Textarea } from '../../components/index.js';
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

/** Every `#rgb` / `#rrggbb` in the saved colours text, in the order written. */
function swatchesIn(text: string): string[] {
  const found = text.match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g) ?? [];
  return [...new Set(found.map((hex) => hex.toLowerCase()))];
}

function isHex(value: string): boolean {
  return /^#?[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(value.trim());
}

export function BrandingStep() {
  const { campaignId = '' } = useParams();

  return (
    <AnswerPage pageId="branding" itemKey="branding">
      {({ state, autosave, refresh }) => (
        <BrandingControls
          campaignId={campaignId}
          state={state}
          autosave={autosave}
          refresh={refresh}
        />
      )}
    </AnswerPage>
  );
}

type Controls = Parameters<
  Exclude<Parameters<typeof AnswerPage>[0]['children'], undefined>
>[0];

function BrandingControls({
  campaignId,
  state,
  autosave,
  refresh,
}: {
  campaignId: string;
} & Pick<Controls, 'state' | 'autosave' | 'refresh'>) {
  // Local copies, because the server's are ignored on every response (§9).
  const [colors, setColors] = useState(state.brand.colors ?? '');
  const [typography, setTypography] = useState(state.brand.typography ?? '');
  const [hex, setHex] = useState('');
  const loaded = useState(() => ({ done: false }))[0];

  useEffect(() => {
    if (loaded.done) return;
    loaded.done = true;
    setColors(state.brand.colors ?? '');
    setTypography(state.brand.typography ?? '');
  }, [loaded, state.brand.colors, state.brand.typography]);

  const readOnly = state.listingPaid;

  function changeColors(next: string) {
    setColors(next);
    autosave.queue({ brandColors: next });
  }

  function addSwatch() {
    const value = hex.trim().startsWith('#') ? hex.trim() : `#${hex.trim()}`;
    if (!isHex(value)) return;
    const line = `${value} — `;
    changeColors(colors ? `${colors.trimEnd()}\n${line}` : line);
    setHex('');
  }

  return (
    <>
      <ul className="ff-file-list">
        {state.brand.logos.map((asset) => (
          <AssetRow
            key={asset.id}
            asset={asset}
            disabled={readOnly}
            onApprove={(approved) => void refresh(setAssetApproval(campaignId, asset.id, approved))}
            onRemove={() => void refresh(removeAsset(campaignId, asset.id))}
          />
        ))}
      </ul>

      <UploadZone
        purpose="logo"
        available={state.uploadsAvailable}
        disabled={readOnly}
        label="Add your logo"
        onUpload={async (file) => {
          const presigned = await requestUpload(campaignId, {
            purpose: 'logo',
            contentType: file.type,
            byteSize: file.size,
            checksumSha256: await fileChecksum(file),
            filename: file.name,
          });
          await putToStorage(presigned, file);
          await refresh(verifyUpload(campaignId, presigned.assetId));
        }}
      />

      <Field
        label="Your colours"
        hint="Which colours, and where each one is used. A hex code on its own does not say what it is for."
        id="ff-brand-colors"
      >
        <Textarea
          rows={5}
          value={colors}
          disabled={readOnly}
          onChange={(event) => changeColors(event.target.value)}
        />
      </Field>

      {swatchesIn(colors).length > 0 ? (
        <ul className="ff-swatches" aria-label="Colours in what you have written">
          {swatchesIn(colors).map((value) => (
            <li key={value} className="ff-swatch">
              {/* The chip is decorative; the hex beside it is the accessible
                  name, because a colour a screen reader cannot say is not a
                  label (§28.5). */}
              <span
                className="ff-swatch__chip"
                aria-hidden="true"
                style={{ background: value }}
              />
              <span className="ff-swatch__hex">{value}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="ff-hexrow">
        <Field
          label="Add a colour"
          hint="Paste a hex code and we put it in the box above for you to say what it is for."
          id="ff-brand-hex"
        >
          <Input
            value={hex}
            disabled={readOnly}
            placeholder="#41ED98"
            onChange={(event) => setHex(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addSwatch();
              }
            }}
          />
        </Field>
        <Button
          tier="secondary"
          disabled={readOnly || !isHex(hex)}
          onClick={addSwatch}
        >
          Add this colour
        </Button>
      </div>

      <Field
        label="Your typography or style"
        hint="What the type is doing, and why it fits what you are making."
        id="ff-brand-type"
      >
        <Textarea
          rows={5}
          value={typography}
          disabled={readOnly}
          onChange={(event) => {
            setTypography(event.target.value);
            autosave.queue({ brandTypography: event.target.value });
          }}
        />
      </Field>

      {/* The completing act (§12), and its own control (§28.4). */}
      <Option
        label="I approve this direction for my campaign"
        checked={state.brand.approved}
        disabled={readOnly}
        onCheckedChange={(approved) => autosave.queue({ brandApproved: approved })}
      />

      <HelperBlock subject="branding" title="Help with your brand direction" />
    </>
  );
}
