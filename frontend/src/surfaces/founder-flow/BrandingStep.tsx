/**
 * More about your brand… — Founder Flow v2, the reference's `[data-brandlogo]`.
 * This is the first half of the one branding answer. Its Next is a bare hop to
 * `[data-brand]` (our `/color` route); only that second screen ends the answer.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { founderFlowPath } from '@proovd/shared';
import { NO_ACTION, StatePanel } from '../../components/index.js';
import { fileRowIn, stageRelayIn } from '../../components/anim.js';
import { SurfaceLoading } from '../../features/public/states.js';
import {
  fileChecksum,
  FounderRequestError,
  putToStorage,
  removeAsset,
  requestUpload,
  verifyUpload,
  type WorkspaceState,
} from '../founder/api.js';
import { FlowPage, HelpDrawer, flowDirection, useFlowNav } from './FlowPage.js';
import { useSetupWorkspace } from './useSetup.js';

const FIT_W = 2496;
const FIT_H = 1542;
const PAGE_SCALE = 0.78;
const RELAY = ['pill', 'head', 'panel', 'cta'] as const;

function stageScale(): string {
  return (
    Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * PAGE_SCALE
  ).toFixed(4);
}

/** Shared with the second half of the answer (`ColorStep`). */
export function swatchesIn(text: string): string[] {
  const found = text.match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g) ?? [];
  return [...new Set(found.map((hex) => hex.toLowerCase()))];
}

function discountLabel(cents: string | undefined): string {
  if (!cents) return 'optional: discount';
  const value = Number(cents);
  if (!Number.isFinite(value) || value <= 0) return 'optional: discount';
  const dollars = value / 100;
  return `optional: $${value % 100 === 0 ? String(dollars) : dollars.toFixed(2)} discount`;
}

export function BrandingStep() {
  const { campaignId = '' } = useParams();
  const setup = useSetupWorkspace(campaignId);

  if (setup.failure) {
    return (
      <FlowPage pageId="branding" param={campaignId}>
        <div className="ff-brandlogo__state">
          <StatePanel
            state="We could not open your campaign"
            whatHappened={setup.failure}
            next="Reload the page. Nothing you have saved is affected — this is only about reading it back."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
            ring
          />
        </div>
      </FlowPage>
    );
  }

  if (!setup.state) {
    return <SurfaceLoading subject="your brand" reference="Your campaign" />;
  }

  return (
    <FlowPage pageId="branding" param={campaignId}>
      <BrandLogoScreen
        campaignId={campaignId}
        state={setup.state}
        refresh={setup.refresh}
      />
    </FlowPage>
  );
}

function BrandLogoScreen({
  campaignId,
  state,
  refresh,
}: {
  campaignId: string;
  state: WorkspaceState;
  refresh: (promise: Promise<{ workspace: WorkspaceState }>) => Promise<void>;
}) {
  const { leave } = useFlowNav();
  const [params] = useSearchParams();
  const fromReview = params.get('from') === 'review';
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const locked = state.listingPaid;
  const canUpload = state.uploadsAvailable && !locked && !busy;

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      el.style.transform = `translate(-50%, -50%) scale(${stageScale()})`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useLayoutEffect(
    () => stageRelayIn(root.current, direction.current ?? 1, RELAY),
    [],
  );

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setFailure(null);
      try {
        const presigned = await requestUpload(campaignId, {
          purpose: 'logo',
          contentType: file.type,
          byteSize: file.size,
          checksumSha256: await fileChecksum(file),
          filename: file.name,
        });
        await putToStorage(presigned, file);
        await refresh(verifyUpload(campaignId, presigned.assetId));
        setSaid(`${file.name} added.`);
        window.setTimeout(() => fileRowIn(root.current), 30);
      } catch (error) {
        setFailure(
          error instanceof FounderRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'That logo did not upload. Nothing else has changed.',
        );
      } finally {
        setBusy(false);
        if (fileInput.current) fileInput.current.value = '';
      }
    },
    [campaignId, refresh],
  );

  function openPicker() {
    if (locked) {
      setSaid('Your logo is locked because the listing fee is paid.');
      return;
    }
    if (!state.uploadsAvailable) {
      setFailure(
        'Adding files is not switched on for this deployment. Nothing already saved has changed.',
      );
      return;
    }
    fileInput.current?.click();
  }

  function next() {
    leave(
      fromReview
        ? `${founderFlowPath('color', campaignId)}?from=review`
        : founderFlowPath('color', campaignId),
      1,
    );
  }

  function back() {
    leave(
      fromReview
        ? `${founderFlowPath('visuals', campaignId)}?from=review`
        : founderFlowPath('visuals', campaignId),
      -1,
    );
  }

  return (
    <div className="ff-brandlogo" ref={root}>
      <button type="button" className="ff-brandlogo__back" onClick={back}>
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 5 8 12l7 7" />
        </svg>
        Back
      </button>

      <div className="ff-brandlogo__top">
        <img className="ff-brandlogo__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        <HelpDrawer
          pageId="branding"
          param={campaignId}
          trigger={<button type="button" className="ff-brandlogo__help">Help</button>}
        />
      </div>

      <HelpDrawer
        pageId="branding"
        param={campaignId}
        trigger={
          <button type="button" className="ff-brandlogo__mailbtn" aria-label="Help and reading — 3 messages">
            <span className="ff-brandlogo__mail" aria-hidden="true">
              <img src="/assets/mail.webp" alt="" />
              <span className="ff-brandlogo__mailcount">3</span>
            </span>
          </button>
        }
      />

      <div className="ff-brandlogo__stage" data-page-stage="1" ref={stage}>
        <div className="ff-brandlogo__col">
          <span className="ff-brandlogo__measure" aria-hidden="true">We want to see your product...</span>
          <span className="ff-brandlogo__pill" data-stage-anim="pill">{discountLabel(state.fee?.itemDiscountCents)}</span>
          <h1 className="ff-brandlogo__head" data-stage-anim="head">More about your brand...</h1>

          <div className="ff-brandlogo__panel" data-stage-anim="panel">
            <input
              ref={fileInput}
              id="ff-brandlogo-file"
              className="ff-brandlogo__fileinput"
              type="file"
              accept="image/png,image/jpeg,video/mp4"
              disabled={!canUpload}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <button type="button" className="ff-brandlogo__drop" aria-describedby={failure ? 'ff-brandlogo-failure' : undefined} onClick={openPicker}>
              <span className="ff-brandlogo__upload">Upload Logo</span>
              <svg viewBox="0 0 24 24" width="126" height="126" fill="#8FCBA3" aria-hidden="true">
                <path d="M12 2.6 3.6 11h4.6v6.2h7.6V11h4.6z" />
                <rect x="6.4" y="19.1" width="11.2" height="2.5" />
              </svg>
              <span className="ff-brandlogo__dropcopy">
                <span>{busy ? 'Adding your file…' : 'Tap to add a file'}</span>
                <span>PNG, JPG, MP4</span>
              </span>
            </button>

            {state.brand.logos.length ? (
              <ul className="ff-brandlogo__list">
                {state.brand.logos.map((asset, index) => (
                  <LogoRow
                    key={asset.id}
                    index={index}
                    locked={locked}
                    onRemove={() => {
                      void refresh(removeAsset(campaignId, asset.id));
                      setSaid('Logo removed.');
                    }}
                  />
                ))}
              </ul>
            ) : null}
          </div>

          <button type="button" className="ff-brandlogo__cta" data-stage-anim="cta" aria-label="Next — choose your brand colours" onClick={next}>Next</button>
          {failure ? <p className="ff-brandlogo__failure" id="ff-brandlogo-failure" role="alert">{failure}</p> : null}
          <p className="sr-only" role="status" aria-live="polite">{said}</p>
        </div>
      </div>
    </div>
  );
}

function LogoRow({ index, locked, onRemove }: { index: number; locked: boolean; onRemove: () => void }) {
  // The reference names the slot, not the local file. Removing a row therefore
  // closes the gap and the remaining labels are numbered again on render.
  const label = `Logo ${index + 1} added`;
  return (
    <li className="ff-brandlogo__file" data-brandlogo-file-row="1">
      <span title={label}>{label}</span>
      {locked ? null : <button type="button" aria-label={`Remove ${label}`} onClick={onRemove}>x</button>}
    </li>
  );
}
