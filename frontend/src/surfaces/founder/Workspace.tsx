/**
 * The Founder campaign workspace — Spec §12, DNA §5.9, §5.12, §5.14.
 *
 * §12: "The workspace presents one coherent decision at a time with progress,
 * Back/Continue, autosave, save recovery, and a complete preview/summary in the
 * secondary surface. It is not a widget dashboard or endless form."
 *
 * So it is a `Flow` — the Phase 02 primitive DNA §5.9 exists for — with the
 * five §12 items as five steps and the complete preview as the review moment.
 * Five cards on one screen would be the widget dashboard §12 rules out; five
 * screens each asking one question is the same content with the sequencing done
 * for the Founder.
 *
 * ── Nothing here decides completion, and nothing here computes money ────────
 * Both are the phase's traps. The server re-derives all five decisions from the
 * stored content on every change and returns them; this surface renders what it
 * is told. There is no `complete` a control can set, no `$35 − $2 × n` in this
 * file, and the fee panel parses cents only to format them.
 *
 * ── The typed value never comes back from the server ───────────────────────
 * §9's rule, inherited by every autosaving Proovd surface: `useAutosave` takes
 * a patch and reports an outcome, and the response's *derived* parts — items,
 * fee, high-effort — are applied while its copies of the text fields are
 * ignored. A save that raced a keystroke would otherwise reinstate the sentence
 * the Founder had just deleted.
 *
 * ── What is absent ─────────────────────────────────────────────────────────
 * No generate button, anywhere (§12: "not an embedded AI product"; §30 defers
 * AI rewriting). No progress bar toward a discount, no streak, no countdown —
 * DNA §5.10 and §30 forbid manufactured urgency, and a saving that is always
 * available needs none.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { OPTIONAL_ITEMS, EVIDENCE_REJECTIONS, type OptionalItemKey } from '@proovd/shared';
import {
  Button,
  Card,
  Field,
  Flow,
  Input,
  Measure,
  Option,
  Section,
  StatePanel,
  Tag,
  Textarea,
  NO_ACTION,
  type FlowStep,
} from '../../components/index.js';
import { PageLoading } from '../../features/public/states.js';
import { useAutosave } from '../../lib/useAutosave.js';
import { describeSaveState } from '../../lib/autosave.js';
import { FeePreview, HighEffortPanel } from './FeePreview.js';
import { HelperResources } from './HelperResources.js';
import { InterviewEmbed } from './InterviewBooking.js';
import {
  fetchWorkspace,
  saveWorkspace,
  requestUpload,
  putToStorage,
  verifyUpload,
  setAssetApproval,
  removeAsset,
  addSocial,
  recheckSocial,
  confirmSocialControl,
  removeSocial,
  cancelInterview,
  fileChecksum,
  FounderRequestError,
  type WorkspaceState,
  type WorkspacePatch,
  type AssetState,
  type ItemState,
} from './api.js';

/** The server sends codes; the register owns the sentences (§27.1). */
function rejectionText(code: string): string {
  return (EVIDENCE_REJECTIONS as Record<string, string>)[code] ?? 'This is not complete yet.';
}

function ItemStatus({ item }: { item: ItemState | undefined }) {
  if (!item) return null;

  if (item.complete) {
    return (
      <p className="item-status item-status--done">
        <Tag variant="moss">Complete</Tag>{' '}
        {item.decisionSource === 'admin_override'
          ? 'Proovd recorded this as complete.'
          : 'This saving is on your listing fee.'}
      </p>
    );
  }

  return (
    <div className="item-status">
      <Tag>Not complete yet</Tag>
      <ul className="item-status__reasons">
        {item.rejections.map((code) => (
          <li key={code}>
            {code === 'invalidated' && item.invalidated.explanation
              ? item.invalidated.explanation
              : rejectionText(code)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Uploads ──────────────────────────────────────────────────────────────── */

function AssetRow({
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
    <li className="asset-row">
      <span className="asset-row__name">{asset.filename ?? 'Uploaded file'}</span>
      {asset.state === 'rejected' ? (
        <span className="asset-row__note">{rejectionText(asset.rejection ?? '')}</span>
      ) : asset.state === 'pending' ? (
        <span className="asset-row__note">Still uploading.</span>
      ) : (
        <Option
          label="Approved for use on my campaign"
          checked={asset.approved}
          disabled={disabled}
          onCheckedChange={onApprove}
        />
      )}
      <Button tier="tertiary" small onClick={onRemove} disabled={disabled}>
        Remove
      </Button>
    </li>
  );
}

function UploadControl({
  purpose,
  available,
  disabled,
  onUpload,
}: {
  purpose: 'visual' | 'logo';
  available: boolean;
  disabled: boolean;
  onUpload: (file: File) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!available) {
    // §1.4. A control that cannot work is worse than none — the same decision
    // as `Finish payout setup` in the Creator signup (Phase 08b).
    return (
      <p className="fine">
        Uploading is not switched on for this deployment yet. Everything else on this page works,
        and nothing you have written has been lost.
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
    <div className="upload">
      <input
        ref={inputRef}
        type="file"
        id={`upload-${purpose}`}
        className="upload__input"
        accept={purpose === 'logo' ? 'image/*' : 'image/*,video/mp4,video/quicktime'}
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void choose(file);
        }}
      />
      <label className="btn btn--secondary upload__label" htmlFor={`upload-${purpose}`}>
        {busy ? 'Uploading…' : purpose === 'logo' ? 'Add a logo' : 'Add a visual'}
      </label>
      {failure ? <p className="field__error">{failure}</p> : null}
    </div>
  );
}

/* ── The surface ──────────────────────────────────────────────────────────── */

export function CampaignWorkspace() {
  const { campaignId = '' } = useParams();
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Local copies of the two free-text areas. The server's copies are ignored on
  // every response — see the header note.
  const [colors, setColors] = useState('');
  const [typography, setTypography] = useState('');
  const [story, setStory] = useState('');
  const [socialUrl, setSocialUrl] = useState('');
  const [socialControls, setSocialControls] = useState(false);
  const loaded = useRef(false);

  /**
   * Applies a save response.
   *
   * The two text areas read from `colors` / `typography` / `story`, not from
   * this state, so an autosave response can never replace what is in a box —
   * §9's rule, and the single most common autosave bug. What the response *is*
   * read for is everything derived: the item decisions, the fee, the
   * high-effort classification, and the approvals, all of which only the server
   * knows.
   */
  const apply = useCallback((next: WorkspaceState) => {
    setState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchWorkspace(campaignId)
      .then(({ workspace }) => {
        if (cancelled) return;
        setState(workspace);
        if (!loaded.current) {
          // DNA §5.12: returning restores what was saved.
          setColors(workspace.brand.colors ?? '');
          setTypography(workspace.brand.typography ?? '');
          setStory(workspace.story.text ?? '');
          loaded.current = true;
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof FounderRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'We could not load your campaign.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const autosave = useAutosave<WorkspacePatch>(
    useCallback(
      async (patch: WorkspacePatch) => {
        const { workspace } = await saveWorkspace(campaignId, patch);
        apply(workspace);
      },
      [campaignId, apply],
    ),
  );

  const refresh = useCallback(async (promise: Promise<{ workspace: WorkspaceState }>) => {
    const { workspace } = await promise;
    setState(workspace);
  }, []);

  if (failure) {
    return (
      <Section>
        <Measure>
        <StatePanel
          state="We could not open your campaign"
          whatHappened={failure}
          next="Reload the page. If it keeps happening, contact support and we will look."
          owner="Proovd"
          nextUpdate="As soon as you tell us"
          action={NO_ACTION}
          reference={campaignId}
          getHelp={{ href: '/support' }}
        />
        </Measure>
      </Section>
    );
  }

  if (!state) return <PageLoading />;

  const readOnly = state.listingPaid;
  const item = (key: OptionalItemKey) => state.items.find((i) => i.item === key);
  const record = (key: OptionalItemKey) => OPTIONAL_ITEMS.find((i) => i.key === key)!;

  async function upload(purpose: 'visual' | 'logo', file: File) {
    const presigned = await requestUpload(campaignId, {
      purpose,
      contentType: file.type,
      byteSize: file.size,
      checksumSha256: await fileChecksum(file),
      filename: file.name,
    });
    await putToStorage(presigned, file);
    // The server reads the object back and decides what it is (§12).
    await refresh(verifyUpload(campaignId, presigned.assetId));
  }

  /* ── The five steps ─────────────────────────────────────────────────────── */

  const visuals = record('visuals');
  const branding = record('branding');
  const interview = record('interview');
  const storyItem = record('story');
  const socials = record('socials');

  const steps: FlowStep[] = [
    {
      id: 'visuals',
      label: visuals.label,
      title: visuals.question,
      summary: item('visuals')?.complete ? 'Complete' : 'Not complete yet',
      content: (
        <div className="step">
          <p className="lede">{visuals.completesWhen}</p>
          <ItemStatus item={item('visuals')} />

          <ul className="asset-list">
            {state.visuals.map((asset) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                disabled={readOnly}
                onApprove={(approved) =>
                  void refresh(setAssetApproval(campaignId, asset.id, approved))
                }
                onRemove={() => void refresh(removeAsset(campaignId, asset.id))}
              />
            ))}
          </ul>

          <UploadControl
            purpose="visual"
            available={state.uploadsAvailable}
            disabled={readOnly}
            onUpload={(file) => upload('visual', file)}
          />

          <HelperResources subject="visuals" />
        </div>
      ),
    },
    {
      id: 'branding',
      label: branding.label,
      title: branding.question,
      summary: item('branding')?.complete ? 'Complete' : 'Not complete yet',
      content: (
        <div className="step">
          <p className="lede">{branding.completesWhen}</p>
          <ItemStatus item={item('branding')} />

          <ul className="asset-list">
            {state.brand.logos.map((asset) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                disabled={readOnly}
                onApprove={(approved) =>
                  void refresh(setAssetApproval(campaignId, asset.id, approved))
                }
                onRemove={() => void refresh(removeAsset(campaignId, asset.id))}
              />
            ))}
          </ul>

          <UploadControl
            purpose="logo"
            available={state.uploadsAvailable}
            disabled={readOnly}
            onUpload={(file) => upload('logo', file)}
          />

          {/* §12 names colours and typography separately, so they are two
              fields. One "direction" box would make "contains at least colours"
              a substring search. */}
          <Field label="Colours" hint="Which colours, and where each one is used.">
            <Textarea
              value={colors}
              disabled={readOnly}
              onChange={(event) => {
                setColors(event.target.value);
                autosave.queue({ brandColors: event.target.value });
              }}
            />
          </Field>

          <Field label="Typography or style" hint="What the type is doing, and why it fits.">
            <Textarea
              value={typography}
              disabled={readOnly}
              onChange={(event) => {
                setTypography(event.target.value);
                autosave.queue({ brandTypography: event.target.value });
              }}
            />
          </Field>

          <Option
            label="I approve this direction for my campaign"
            checked={state.brand.approved}
            disabled={readOnly}
            onCheckedChange={(approved) => autosave.queue({ brandApproved: approved })}
          />

          <HelperResources subject="branding" />
        </div>
      ),
    },
    {
      id: 'interview',
      label: interview.label,
      title: interview.question,
      summary: item('interview')?.complete ? 'Confirmed' : 'Not booked',
      content: (
        <div className="step">
          <p className="lede">{interview.completesWhen}</p>
          <ItemStatus item={item('interview')} />

          {state.interview.booking ? (
            <Card>
              <p className="state-panel__key">Your booking</p>
              <p className="state-panel__val">
                {state.interview.booking.scheduledAt
                  ? new Date(state.interview.booking.scheduledAt).toLocaleString()
                  : 'Time not set'}{' '}
                — {state.interview.booking.status}
              </p>
              {state.interview.booking.status === 'selected' ||
              state.interview.booking.status === 'confirmed' ? (
                <Button
                  tier="tertiary"
                  small
                  disabled={readOnly}
                  onClick={() =>
                    void refresh(
                      cancelInterview(
                        campaignId,
                        state.interview.booking!.id,
                        'Canceled by the Founder from the workspace',
                      ),
                    )
                  }
                >
                  Cancel this interview
                </Button>
              ) : null}
            </Card>
          ) : null}

          {/* §12: "book a human Proovd interview without leaving the product."
              The embed only mounts when §6's settings are stated AND the
              provider is configured — the server folds both into
              `embed.available`. */}
          {state.interview.embed.available &&
          state.interview.embed.eventTypeLink &&
          state.interview.embed.reference &&
          !state.interview.booking ? (
            <InterviewEmbed
              eventTypeLink={state.interview.embed.eventTypeLink}
              reference={state.interview.embed.reference}
            />
          ) : null}

          {/* §6 names the interview providers, availability, interviewers, and
              reminder lead time as settings and fixes none of them. Until an
              operator states them there is nothing bookable, and offering a
              slot nobody is available for is §1.4's failure. */}
          {!state.interview.bookable ? (
            <StatePanel
              state="Booking an interview is not open yet"
              whatHappened="Proovd has not published interview times for this deployment."
              next="We will email you when it opens. Every other item on this page still counts toward your listing fee."
              owner="Proovd"
              nextUpdate="When interview times are published"
              action={NO_ACTION}
              reference={campaignId}
              getHelp={{ href: '/support' }}
            />
          ) : (
            <p className="fine">
              Interview times: {state.interview.availability}. We run interviews on{' '}
              {state.interview.providers.join(', ')}.
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'story',
      label: storyItem.label,
      title: storyItem.question,
      summary: item('story')?.complete ? 'Approved' : 'Not approved yet',
      content: (
        <div className="step">
          <p className="lede">{storyItem.completesWhen}</p>
          <ItemStatus item={item('story')} />

          <Field label="Your campaign story">
            <Textarea
              rows={12}
              value={story}
              disabled={readOnly}
              onChange={(event) => {
                setStory(event.target.value);
                autosave.queue({ storyText: event.target.value });
              }}
            />
          </Field>

          {/* The completing act. §12 rejects a transcript, a summary, and an
              unapproved draft — all of which are this field before approval. */}
          <Option
            label="I approve this story for my public campaign page"
            checked={state.story.approved}
            disabled={readOnly}
            onCheckedChange={(approved) => autosave.queue({ storyApproved: approved })}
          />
          <p className="fine">
            Editing the story afterwards clears this, so you always approve the words that will be
            published.
          </p>

          <HelperResources subject="story" />
        </div>
      ),
    },
    {
      id: 'socials',
      label: socials.label,
      title: socials.question,
      summary: item('socials')?.complete ? 'Complete' : 'Not complete yet',
      content: (
        <div className="step">
          <p className="lede">{socials.completesWhen}</p>
          <ItemStatus item={item('socials')} />

          <ul className="asset-list">
            {state.socials.map((profile) => (
              <li className="asset-row" key={profile.id}>
                <span className="asset-row__name">{profile.handle ?? profile.url}</span>
                <span className="asset-row__note">
                  {profile.accessible === true
                    ? 'Opens when we check it.'
                    : profile.rejection
                      ? rejectionText(profile.rejection)
                      : 'Not checked yet.'}
                </span>
                <Option
                  label="This is mine"
                  checked={profile.controlsConfirmed}
                  disabled={readOnly}
                  onCheckedChange={(confirmed) =>
                    void refresh(confirmSocialControl(campaignId, profile.id, confirmed))
                  }
                />
                <Button
                  tier="tertiary"
                  small
                  disabled={readOnly}
                  onClick={() => void refresh(recheckSocial(campaignId, profile.id))}
                >
                  Check again
                </Button>
                <Button
                  tier="tertiary"
                  small
                  disabled={readOnly}
                  onClick={() => void refresh(removeSocial(campaignId, profile.id))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>

          <Field label="Profile address" hint="A public page for you or the product.">
            <Input
              value={socialUrl}
              disabled={readOnly}
              onChange={(event) => setSocialUrl(event.target.value)}
            />
          </Field>
          {/* §28.4 forbids bundling a confirmation into another action, so the
              claim of control is its own unchecked control. */}
          <Option
            label="I control this profile"
            checked={socialControls}
            disabled={readOnly}
            onCheckedChange={setSocialControls}
          />
          <Button
            tier="secondary"
            disabled={readOnly || !socialUrl.trim()}
            onClick={() => {
              void refresh(
                addSocial(campaignId, { url: socialUrl.trim(), controlsConfirmed: socialControls }),
              ).then(() => {
                setSocialUrl('');
                setSocialControls(false);
              });
            }}
          >
            Add this profile
          </Button>

          <HelperResources subject="competition" />
        </div>
      ),
    },
  ];

  return (
    <Section>
      <Measure>
      <header className="workspace__head">
        <h1 className="page-title">Your campaign</h1>
        {/* §12's autosave status, in the §9 vocabulary every Proovd surface
            speaks. `retrying` appears only while a retry is genuinely pending. */}
        <p className="autosave-status" aria-live="polite">
          {describeSaveState(autosave.state)}
        </p>
      </header>

      {readOnly ? (
        <StatePanel
          state="Your listing fee is paid, so these are fixed"
          whatHappened="The savings you earned were applied to what you paid. Changing something now does not change that amount."
          next="Carry on building your campaign page."
          owner="Proovd"
          nextUpdate="No further update needed"
          action={NO_ACTION}
          reference={campaignId}
          getHelp={{ href: '/support' }}
        />
      ) : null}

      <Flow
        steps={steps}
        persistKey={`workspace:${campaignId}`}
        reviewTitle="Everything so far"
        confirmLabel="Done for now"
        done={{
          title: 'Saved.',
          body: 'Come back whenever you like — everything here stays as you left it.',
        }}
      />

      {/* §12: "a complete preview/summary in the secondary surface." */}
      <div className="workspace__secondary">
        <FeePreview fee={state.fee} />
        <HighEffortPanel highEffort={state.highEffort} />
      </div>
      </Measure>
    </Section>
  );
}
