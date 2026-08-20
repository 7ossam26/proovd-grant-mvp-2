/**
 * We want to see your product — Founder Flow v2, the reference's `[data-visuals]`.
 *
 * REBUILT FROM SCRATCH 2026-08-20 against the supplied reference
 * (`Proovd Founder Flow v2.dc.html`, `[data-visuals]` / `kindWide`) and its
 * screenshot. What stood here was Session D's `AnswerPage` layout — a trail
 * line, the optional tag, the §12 question as the heading, a stacked file list,
 * a dashed `UploadZone`, the helper accordion and a nav row. None of that is
 * left. What replaced it is the reference's own composition on a fixed stage:
 * the pill, one 112px headline, a two-column panel — a 500px drop zone with a
 * link row under it on the left, the file list on the right — and one `Next`.
 *
 * ── The layout model is the reference's, not an approximation of it ────────
 * Authored once on a fixed 2496x1542 stage and scaled to the viewport by
 * `fitStages()`:
 *
 *     let s = Math.min(innerWidth/2496, innerHeight/1542) * (pageScale || .78);
 *
 * No branch of that function names this screen — `c` is `vetting` and
 * `vReviewing` is false at `vStep` 3 — so it takes `pageScale` alone. Every
 * child below carries the reference's own pixel value on that stage: an 860px
 * left column, an 80px gutter, a 500px drop zone, a 32px gap, a 112px input
 * beside a 290px button, 120px above the panel, 130px above a 165px CTA.
 * Nothing reflows; the stage scales. Measured against the reference in Chrome
 * at 1860x922: stage scale 0.4664, column 1491px, panel `860px 551.062px`.
 *
 * ── The column's width is this screen's own headline ───────────────────────
 * `width: fit-content` over `align-items: flex-start`, and the widest child is
 * the 112px `We want to see your product...` — 1491px at Satoshi's own metrics.
 * That is the same 1491 the SOCIALS screen borrows by rendering this sentence
 * hidden (`.ff-soc__measure`); here it is the real headline, so there is
 * nothing to measure and nothing hidden. The pill is `align-self: center` over
 * that width, which is why it reads as centred while everything else is flush
 * left.
 *
 * ── The discount is the SETTING, never the reference's `$2` ────────────────
 * The reference hardcodes `FEE_PER=2`. §6 makes it
 * `listing_fee_item_discount_cents` and Phase 06's rule is that a hardcoded
 * number is a bug even when it is right, so the pill renders
 * `state.fee.itemDiscountCents` in the reference's own `$2 discount` shape —
 * whole dollars when the setting is whole, cents when it is not. With no
 * calculation to read it says `optional: discount` rather than inventing a
 * number this browser made up (§1.4). There is no fee arithmetic in this file.
 *
 * ── The link row is drawn and it is not wired, and that is stated on it ────
 * The reference's `addLink` appends the URL to the same `files` list an upload
 * lands in. There is no such record here: `campaign_assets.storage_key` is NOT
 * NULL, so a visual is an object we fetched and read, and §12's whole evidence
 * rule for this item is "we opened it and looked at it". A URL would have to be
 * fetched from wherever a Founder pointed, on a schedule nobody defined, and
 * could change after approval into something they never approved. Building that
 * is a §12 evidence decision and a migration, not a surface rebuild.
 *
 * So the row is drawn at the reference's own geometry and is honestly
 * unavailable: the control says so before anybody types rather than taking a
 * link and dropping it, which is the R2 arrangement this flow already uses in
 * three places. `VISUALS_LINK_ABSENT` sits in the 130px gap the composition
 * already leaves above the CTA, so not one reference box moves for it.
 *
 * ── What the reference's file row does not carry ───────────────────────────
 * Its row is a label and an `x`. §12 needs two more things on it: which state
 * the object is in (`pending` / `stored` / `rejected`, and the reason when it
 * did not count) and the Founder's approval, which §28.4 forbids folding into
 * the upload — a file can sit there stored and not counting, and the row has to
 * say which. Both go INSIDE the reference's own `#DEF6FF` block as a second
 * line, so the list keeps its width, its 34px gap and its position.
 *
 * The label is the real filename rather than the reference's `File N added`,
 * which is what that string stands in for; a record with no filename falls back
 * to the reference's own shape.
 *
 * ── There is no Back on a plain arrival, and that is not a missing box ─────
 * The reference's `back()` sends `vetting` vStep 3 to vStep 2 (Positioning) and
 * this cannot: Positioning is behind the draft token and §10's claim
 * invalidated it. Sending it to Last look instead — five pages FORWARD — is
 * what closed a ring here once before, and `AnswerPage`'s header records it.
 * An edit opened from Last look still returns there, because that contract is
 * in the address (`?from=review`) and not in the sequence, and there the
 * control is drawn exactly as the reference draws it.
 *
 * ── The bell carries a count of reading, never a count of messages ─────────
 * The reference's is `mailCount: 2 + Math.max(0, vStep - 3)` — two at `vStep`
 * 3, which is what the screenshot shows. There is no inbox in this product and
 * an unread count over a message system that does not exist is §1.4's failure
 * with a number on it. The badge carries the number of reading cards the drawer
 * actually holds, and the control opens that drawer — which is what the
 * reference's does too. It does not shake, for the reason `FlowPage` records.
 *
 * ── §12's lock ────────────────────────────────────────────────────────────
 * After the listing fee is paid the calculation and its evidence lock and the
 * server refuses a write. The reference has no such state; the zone and the
 * rows say so and offer nothing rather than offering a control the server will
 * refuse (§1.4).
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { EVIDENCE_REJECTIONS, founderFlowIndex, founderFlowPath } from '@proovd/shared';
import { SurfaceLoading } from '../../features/public/states.js';
import { StatePanel, NO_ACTION } from '../../components/index.js';
import { socialAddPop, socialNudge, stageRelayIn } from '../../components/anim.js';
import {
  fileChecksum,
  putToStorage,
  removeAsset,
  requestUpload,
  setAssetApproval,
  verifyUpload,
  FounderRequestError,
  type AssetState,
  type WorkspaceState,
} from '../founder/api.js';
import { FlowPage, HelpDrawer, flowDirection, useFlowNav } from './FlowPage.js';
import { useSetupWorkspace } from './useSetup.js';

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()` for a page it treats as ordinary: the stage's own size as the
   divisors and `pageScale` alone. */

const FIT_W = 2496;
const FIT_H = 1542;
/** The prototype's `pageScale` prop default. */
const PAGE_SCALE = 0.78;

function stageScale(): string {
  const s = Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * PAGE_SCALE;
  // `s.toFixed(4)` is the reference's own — it writes the transform as a string
  // and rounds there, so this is the same number to the digit rather than one
  // that agrees to five decimal places.
  return s.toFixed(4);
}

/**
 * The reference's own relay order for this screen, out of `verifyIntro`'s fixed
 * list `pill, head, field, boxes, note, fee, sub, hint, panel, art, art2, cta,
 * edit`. Passed to `stageRelayIn` rather than read from the DOM, because the
 * 0.085s stagger follows THAT order and not document order. This screen carries
 * four of the thirteen, and unlike Socials one of them is the pill.
 */
const RELAY = ['pill', 'head', 'panel', 'cta'] as const;

/** The reference's own `isUrl`, character for character. */
const URL_SHAPE = /^(https?:\/\/)?(www\.)?[\w-]+(\.[\w-]+)+(\/[^\s]*)?$/i;

/**
 * Why the link row is drawn and not wired. See the header — it is a §12
 * evidence decision, so the sentence names what does count instead.
 */
const VISUALS_LINK_ABSENT =
  'Pasting a link is not switched on: a visual counts once we have fetched the file and looked at it, and a link is not something we can check that way yet. Add the picture or the clip itself and it counts straight away.';

/** The server sends codes; the register owns the sentences (§27.1). */
function rejectionText(code: string): string {
  return (EVIDENCE_REJECTIONS as Record<string, string>)[code] ?? 'This one does not count yet.';
}

/**
 * The reference's `optional: $2 discount`, with the number read from the §6
 * setting the server calculated with. Whole dollars stay whole — `$2`, the
 * reference's own shape — and a setting with cents in it renders them rather
 * than being rounded into a claim that is not quite true.
 */
function discountLabel(cents: string | undefined): string {
  if (!cents) return 'optional: discount';
  const value = Number(cents);
  if (!Number.isFinite(value) || value <= 0) return 'optional: discount';
  const dollars = value / 100;
  const shown = value % 100 === 0 ? String(dollars) : dollars.toFixed(2);
  return `optional: $${shown} discount`;
}

export function VisualsStep() {
  const { campaignId = '' } = useParams();
  const setup = useSetupWorkspace(campaignId);

  if (setup.failure) {
    return (
      <FlowPage pageId="visuals" param={campaignId}>
        <div className="ff-vis__failure">
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
    return <SurfaceLoading subject="your visuals" reference="Your campaign" />;
  }

  return (
    <FlowPage pageId="visuals" param={campaignId}>
      <VisualsScreen campaignId={campaignId} state={setup.state} refresh={setup.refresh} />
    </FlowPage>
  );
}

/** Split from the loader so `useFlowNav` — which only exists under `FlowPage` — is available. */
function VisualsScreen({
  campaignId,
  state,
  refresh,
}: {
  campaignId: string;
  state: WorkspaceState;
  refresh: (promise: Promise<{ workspace: WorkspaceState }>) => Promise<void>;
}) {
  const { leave, leaveToPage } = useFlowNav();
  const [params] = useSearchParams();
  const fromReview = params.get('from') === 'review';

  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Read once, during the first render: `FlowPage` resets the module value in
  // its own layout effect, and a later re-render would read the reset.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  // The reference's `st.linkDraft`. Held here and nowhere else — there is no
  // record behind it, which is what the row says.
  const [linkDraft, setLinkDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [said, setSaid] = useState('');

  // `fitStages`, for this screen. First, so the first paint is already at the
  // right scale — and on resize, because the reference refits there too.
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

  // The entrance — `verifyIntro`'s `runRelay`, which is all this screen gets:
  // it has no `[data-anim="grow"]`, no cupids, no `[data-flourish]`, and it is
  // neither `[data-lastlook]` nor `[data-paynow]`, so every one of that
  // function's earlier branches is false.
  useLayoutEffect(() => stageRelayIn(root.current, direction.current ?? 1, RELAY), []);

  const locked = state.listingPaid;
  const uploads = state.uploadsAvailable && !locked;
  const items = state.visuals;

  /**
   * The reference's `addFile` — presign, PUT, then the server reads the object
   * BACK and decides what it is (§12). No file body reaches Proovd's own
   * process and there is no route that would accept one (tech-stack §9).
   */
  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setFailure(null);
      try {
        const presigned = await requestUpload(campaignId, {
          purpose: 'visual',
          contentType: file.type,
          byteSize: file.size,
          checksumSha256: await fileChecksum(file),
          filename: file.name,
        });
        await putToStorage(presigned, file);
        await refresh(verifyUpload(campaignId, presigned.assetId));
        setSaid(`${file.name} added. We are checking we can open it.`);
      } catch (error) {
        setFailure(
          error instanceof FounderRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'That file did not upload. Nothing else has changed.',
        );
      } finally {
        setBusy(false);
        if (fileInput.current) fileInput.current.value = '';
      }
    },
    [campaignId, refresh],
  );

  /**
   * `addLink`, as far as it can honestly go.
   *
   * The reference's empty and malformed branches both end in `linkErr`, which
   * nothing on its screen renders — pressing Add on a bad address there does
   * nothing at all, visibly. That is reproduced as the nudge its sibling
   * `addSocial` uses for the same case, plus a sentence, because a control that
   * silently declines is one somebody presses again (§27.1). A well-formed
   * address gets the same answer the row already carries.
   */
  function addLink() {
    const value = linkDraft.trim();
    if (!URL_SHAPE.test(value)) {
      socialNudge(linkInput.current);
      setSaid(value ? 'That does not look like a web address.' : 'Paste a link first.');
      return;
    }
    socialAddPop(addButton.current);
    setSaid(VISUALS_LINK_ABSENT);
  }

  /** `visualsNext:()=>this.afterSection({vStep:4,brandStage:'logo'})` — Your brand. */
  function next() {
    if (fromReview) leaveToPage('last-look', 1);
    else leave(founderFlowPath('branding', campaignId), 1);
  }

  const readingCount = founderFlowIndex('visuals') + 1;

  return (
    <div className="ff-vis" ref={root}>
      {/* The reference's own control, bottom-left. See the header for why it is
          drawn only for an edit opened from Last look. */}
      {fromReview ? (
        <button
          type="button"
          className="ff-vis__back"
          aria-label="Back to Last look"
          onClick={() => leaveToPage('last-look', -1)}
        >
          <svg
            viewBox="0 0 24 24"
            width="11"
            height="11"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 5 8 12l7 7" />
          </svg>
          Back
        </button>
      ) : null}

      <div className="ff-vis__top">
        {/* Not a link. A campaign's own half-finished form is not a site, and
            the way out of one should not be the brand. */}
        <img className="ff-vis__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        <HelpDrawer
          pageId="visuals"
          param={campaignId}
          trigger={
            <button type="button" className="ff-vis__help">
              Help
            </button>
          }
        />
      </div>

      {/* The reference's mail bell, bottom-right, opening the same drawer HELP
          does. See the header for what its number is and is not. */}
      <HelpDrawer
        pageId="visuals"
        param={campaignId}
        trigger={
          <button
            type="button"
            className="ff-vis__mailbtn"
            aria-label={`Help and reading — ${readingCount} pages`}
          >
            <span className="ff-vis__mail" aria-hidden="true">
              <img src="/assets/mail.webp" alt="" />
              <span className="ff-vis__mailcount">{readingCount}</span>
            </span>
          </button>
        }
      />

      <div className="ff-vis__stage" data-page-stage="1" ref={stage}>
        <div className="ff-vis__col">
          <span className="ff-vis__pill" data-stage-anim="pill">
            {discountLabel(state.fee?.itemDiscountCents)}
          </span>

          <h1 className="ff-vis__head" data-stage-anim="head">
            We want to see your product...
          </h1>

          <div className="ff-vis__panel" data-stage-anim="panel">
            <div className="ff-vis__left">
              {/* The reference's 500px zone. It is a `label` over a real file
                  input rather than a `button`, so a keyboard user reaches the
                  browser's own picker and the control has a real accessible
                  name (§28.5). The box is identical either way. */}
              <input
                ref={fileInput}
                type="file"
                id="ff-vis-file"
                className="ff-vis__fileinput"
                accept="image/*,video/mp4,video/quicktime"
                disabled={!uploads || busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <label
                className={uploads ? 'ff-vis__drop' : 'ff-vis__drop is-off'}
                htmlFor="ff-vis-file"
              >
                <svg viewBox="0 0 24 24" width="126" height="126" fill="#8FCBA3" aria-hidden="true">
                  <path d="M12 2.6 3.6 11h4.6v6.2h7.6V11h4.6z" />
                  <rect x="6.4" y="19.1" width="11.2" height="2.5" />
                </svg>
                {locked ? (
                  <>
                    <span className="ff-vis__droplabel">Your files are locked</span>
                    <span className="ff-vis__droptypes">
                      Your listing fee is paid, so these stay as they were checked.
                    </span>
                  </>
                ) : state.uploadsAvailable ? (
                  <>
                    <span className="ff-vis__droplabel">
                      {busy ? 'Adding your file…' : 'Tap to add a file'}
                    </span>
                    <span className="ff-vis__droptypes">PNG, JPG, MP4</span>
                  </>
                ) : (
                  <>
                    <span className="ff-vis__droplabel">Adding files is not switched on yet</span>
                    <span className="ff-vis__droptypes">
                      There is nowhere to put a file on this deployment. Nothing you have written is
                      lost, and we will tell you when it is on.
                    </span>
                  </>
                )}
              </label>

              <div className="ff-vis__linkrow">
                <input
                  ref={linkInput}
                  className="ff-vis__link"
                  type="url"
                  placeholder="paste your link"
                  aria-label="Paste a link to your product"
                  aria-describedby="ff-vis-link-note"
                  value={linkDraft}
                  onChange={(event) => setLinkDraft(event.target.value)}
                  onKeyDown={(event) => {
                    /* Enter presses Add, which is this row's own action.
                       The reference binds Enter GLOBALLY (`enterAdvance`) and
                       excludes only a TEXTAREA — so pressing it here leaves the
                       page entirely, and somebody who typed an address and
                       expected to add it is on the next screen instead. Every
                       other rebuilt screen in this flow binds Enter to the
                       field's own control (`EmailStep` sends, `BrandingStep`
                       adds a swatch) and nothing binds it to navigation. */
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addLink();
                    }
                  }}
                />
                <button
                  ref={addButton}
                  type="button"
                  className="ff-vis__add"
                  aria-describedby="ff-vis-link-note"
                  onClick={addLink}
                >
                  Add
                </button>
              </div>
            </div>

            {items.length ? (
              <ul className="ff-vis__list">
                {items.map((asset, index) => (
                  <FileRow
                    key={asset.id}
                    asset={asset}
                    index={index}
                    locked={locked}
                    onApprove={(approved) => {
                      void refresh(setAssetApproval(campaignId, asset.id, approved));
                      setSaid(
                        approved
                          ? 'Approved for your campaign.'
                          : 'Approval removed. It stays here and does not count.',
                      );
                    }}
                    onRemove={() => {
                      void refresh(removeAsset(campaignId, asset.id));
                      setSaid('File removed.');
                    }}
                  />
                ))}
              </ul>
            ) : (
              /* The reference's own empty panel: a dashed rule and nothing
                 inside it. It says nothing, so it is not in the reading order —
                 what the list is for is on the zone beside it. */
              <div className="ff-vis__empty" aria-hidden="true" />
            )}
          </div>

          {/* The reference's own word, and it is `next` in §33.11.4's
              `OBJECTLESS_CTA_LABELS` — the same knowing exception `Socials`,
              `ConfirmProblem` and `ConfirmAnswer` already carry on these pages,
              where the reference's copy is the specification. What costs the
              composition nothing is naming the destination to a screen reader,
              so the accessible name does and it contains the visible word
              (WCAG 2.5.3). */}
          <button
            type="button"
            className="ff-vis__cta"
            data-stage-anim="cta"
            aria-label={fromReview ? 'Next — back to Last look' : 'Next — your brand'}
            onClick={next}
          >
            Next
          </button>

          {/* Absolutely positioned inside the 130px gap the composition already
              leaves above the CTA, so neither of these can move a reference
              box. The first is why the row above is drawn and not wired; the
              second is whatever just happened, announced. */}
          <p className="ff-vis__note" id="ff-vis-link-note">
            {VISUALS_LINK_ABSENT}
          </p>
          {failure ? (
            <p className="ff-vis__failline" role="alert">
              {failure}
            </p>
          ) : null}
          <p className="ff-vis__live sr-only" role="status" aria-live="polite">
            {said}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * One file, in the reference's own `#DEF6FF` block.
 *
 * Its label and its `x` are the reference's line, unchanged. The second line is
 * §12's: which state the object is in, and the approval §28.4 keeps as its own
 * unchecked control.
 */
function FileRow({
  asset,
  index,
  locked,
  onApprove,
  onRemove,
}: {
  asset: AssetState;
  index: number;
  locked: boolean;
  onApprove: (approved: boolean) => void;
  onRemove: () => void;
}) {
  const name = asset.filename ?? `File ${index + 1} added`;

  return (
    <li className="ff-vis__file">
      <div className="ff-vis__filetop">
        <span className="ff-vis__filename" title={name}>
          {name}
        </span>
        {locked ? null : (
          <button
            type="button"
            className="ff-vis__filex"
            aria-label={`Remove ${name}`}
            onClick={onRemove}
          >
            x
          </button>
        )}
      </div>

      <div className="ff-vis__filemeta">
        {asset.state === 'pending' ? (
          <span className="ff-vis__filenote">Still uploading.</span>
        ) : asset.state === 'rejected' ? (
          <span className="ff-vis__filenote">{rejectionText(asset.rejection ?? '')}</span>
        ) : locked ? (
          <span className={asset.approved ? 'ff-vis__filenote is-ok' : 'ff-vis__filenote'}>
            {asset.approved ? 'Approved and counting.' : 'Not approved, so it does not count.'}
          </span>
        ) : (
          <label className="ff-vis__approve">
            <input
              type="checkbox"
              checked={asset.approved}
              onChange={(event) => onApprove(event.target.checked)}
            />
            Approved for use on my campaign
          </label>
        )}
      </div>
    </li>
  );
}
