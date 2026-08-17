/**
 * Profile & Verification — the four person-level sections in final shape.
 * Spec §8, §5.3, §11, §29, §25.6. Session B of the Affiliate rebuild
 * (2026-08-17; docs/phases/admin-affiliate-rebuild.md,
 * docs/phases/admin-affiliate-reconciliation.md §4).
 *
 * ── Provenance is the whole design ──────────────────────────────────────────
 * Four sections, four provenance badges, and the badge decides what may be
 * edited: `Admin researched / authored` edits freely (the Affiliate never
 * typed it), `Evidence + Admin decision` records decisions a named human
 * made, and the Internal Context block is `Admin only` — §11's boundary,
 * stated where it can be breached.
 *
 * ── The three §1.8 resolutions this file renders ────────────────────────────
 * The tier is a free-text input with the three suggestions as a datalist,
 * never a closed list (§8: assessment data, not a commission floor).
 * Proposal access is a DERIVED badge — §29's restrict_bidding/demote records
 * — with no control here to set it; the sentence beside it says where a
 * change is recorded. And the evidence uploader accepts what the server can
 * actually inspect (PNG, JPG, WEBP, GIF), not the reference's HEIC.
 */

import { useRef, useState } from 'react';
import {
  EVIDENCE_IS_REPORTED_NOT_ENFORCED,
  EVIDENCE_PICTURES_ACCEPTED,
  EVIDENCE_STAYS_WITH_ITS_ITEM,
  FOUNDER_NEVER_SEES_THIS,
  MORE_EVIDENCE_NEEDED_LABEL,
  PROPOSAL_ACCESS_IS_DERIVED,
  QUALITY_TIER_HELPER,
  RED_FLAGS_LABEL,
  VERIFICATION_IS_HUMAN,
  AFFILIATE_EVIDENCE_CATEGORIES,
} from '@proovd/shared';
import { Button } from '../../../../components/index.js';
import { useToast } from '../../../../motion/MotionProvider.js';
import {
  ConfirmDialog,
  DialogShell,
  type DialogSpec,
} from '../../founders/dialogs/index.js';
import {
  recordMetricDecision,
  requestEvidenceUpload,
  removeEvidenceFile,
  verifyEvidenceUpload,
  AdminRequestError,
  type CreatorWorkspaceDetail,
  type MetricDecisionView,
} from '../api.js';
import { FieldRow, Group, Note, ProvenanceBadge, Section, StateChip, verificationTone } from '../shared.js';
import { ResearchDialog } from '../dialogs/ResearchDialog.js';
import { VerificationDialog } from '../dialogs/VerificationDialog.js';

type OpenDialog =
  | { kind: 'research'; trigger: HTMLElement | null }
  | { kind: 'verification'; trigger: HTMLElement | null }
  | { kind: 'metric'; metric: string | null; trigger: HTMLElement | null }
  | { kind: 'upload'; trigger: HTMLElement | null };

export function ProfileTabSection({
  sectionKey,
  detail,
  onDone,
}: {
  sectionKey: string;
  detail: CreatorWorkspaceDetail;
  onDone: (next: CreatorWorkspaceDetail) => void;
}) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const toast = useToast();
  const { header, profile } = detail;
  const prospectId = header.prospectId;

  /*
   * Which relationship a record-level edit is filed against: the research
   * record belongs to the PERSON but the routes that write it are
   * association-scoped (`admin-affiliates.ts` was built per relationship).
   * The first relationship is the one recruitment created. When there is
   * none, the edit controls are absent rather than pointed at nothing.
   */
  const primaryAssociationId = profile.invitations[0]?.associationId ?? null;

  const researchBlock = profile.blocks.find((b) => b.provenance === 'admin');
  const fieldOf = (key: string) => researchBlock?.fields.find((f) => f.key === key);

  const editResearch = (trigger: HTMLElement | null) =>
    setDialog({ kind: 'research', trigger });

  const dialogs = (
    <>
      {dialog?.kind === 'research' && primaryAssociationId ? (
        <ResearchDialog
          prospectId={prospectId}
          associationId={primaryAssociationId}
          fields={researchBlock?.fields ?? []}
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            onDone(next);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'verification' && primaryAssociationId ? (
        <VerificationDialog
          prospectId={prospectId}
          associationId={primaryAssociationId}
          verification={profile.verification}
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            onDone(next);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'metric' ? (
        <MetricDecisionDialog
          prospectId={prospectId}
          metric={dialog.metric}
          decisions={profile.metricDecisions}
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onDone={(next, ask) => {
            onDone(next);
            setDialog(null);
            if (ask && !ask.sent && ask.reason) {
              // Recorded with nothing sent is a state the Admin must see (§1.4).
              toast('Recorded — nothing was sent', { sub: ask.reason });
            }
          }}
        />
      ) : null}
      {dialog?.kind === 'upload' ? (
        <EvidenceUploadDialog
          prospectId={prospectId}
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            onDone(next);
            setDialog(null);
          }}
        />
      ) : null}
    </>
  );

  /* ── Profile ──────────────────────────────────────────────────────────────*/
  if (sectionKey === 'profile') {
    return (
      <>
        <section className="cr-summary">
          <div>
            <p className="kicker">Public presence</p>
            <h2>{profile.summary.handle ?? 'No username recorded'}</h2>
            {profile.summary.channelUrl ? (
              <a
                className="cr-band__channel"
                href={profile.summary.channelUrl}
                target="_blank"
                rel="noreferrer"
                data-press
              >
                Open {profile.summary.platform ?? 'channel'}
              </a>
            ) : null}
          </div>
          <Group>
            <div className="frow">
              <dt>Subtype</dt>
              <dd>{header.subtype ?? <span className="grey">Not researched</span>}</dd>
            </div>
            <div className="frow">
              <dt>Verification</dt>
              <dd>
                <StateChip tone={verificationTone(header.verification.state)}>
                  {header.verification.label}
                </StateChip>
              </dd>
            </div>
            <div className="frow">
              <dt>Location</dt>
              <dd>{header.location ?? <span className="grey">Not claimed</span>}</dd>
            </div>
          </Group>
        </section>

        <Section
          title="Affiliate profile"
          badge={<ProvenanceBadge provenance="admin" />}
          actions={
            primaryAssociationId ? (
              <Button
                tier="secondary"
                small
                onClick={(event) => editResearch(event.currentTarget)}
              >
                Edit profile research
              </Button>
            ) : null
          }
        >
          <Group>
            {['researchedHandle', 'subtype', 'niche', 'source', 'bio']
              .map(fieldOf)
              .filter(Boolean)
              .map((field) => (
                <FieldRow field={field!} key={field!.key} />
              ))}
          </Group>
          <Note>{FOUNDER_NEVER_SEES_THIS}</Note>
        </Section>
        {dialogs}
      </>
    );
  }

  /* ── Audience & Metrics ───────────────────────────────────────────────────*/
  if (sectionKey === 'audience') {
    return (
      <>
        <Section
          title="Audience & channel metrics"
          badge={<ProvenanceBadge provenance="admin" />}
          actions={
            primaryAssociationId ? (
              <Button
                tier="secondary"
                small
                onClick={(event) => editResearch(event.currentTarget)}
              >
                Edit audience research
              </Button>
            ) : null
          }
        >
          <Group>
            {['audienceSize', 'demographics', 'permission', 'sponsored']
              .map(fieldOf)
              .filter(Boolean)
              .map((field) => (
                <FieldRow field={field!} key={field!.key} />
              ))}
          </Group>
        </Section>
        {dialogs}
      </>
    );
  }

  /* ── Verification ─────────────────────────────────────────────────────────*/
  if (sectionKey === 'verification') {
    return (
      <>
        <Section
          title="Audience verification"
          badge={<ProvenanceBadge provenance="evidence" />}
          aside={
            <StateChip tone={verificationTone(profile.verification.state)}>
              {profile.verification.label}
            </StateChip>
          }
          actions={
            primaryAssociationId ? (
              <>
                <Button
                  small
                  onClick={(event) =>
                    setDialog({ kind: 'verification', trigger: event.currentTarget })
                  }
                >
                  Verify audience evidence
                </Button>
                <Button
                  tier="secondary"
                  small
                  onClick={(event) =>
                    setDialog({ kind: 'metric', metric: null, trigger: event.currentTarget })
                  }
                >
                  Request more evidence
                </Button>
                {profile.evidenceFiles.available ? (
                  <Button
                    tier="tertiary"
                    small
                    onClick={(event) =>
                      setDialog({ kind: 'upload', trigger: event.currentTarget })
                    }
                  >
                    Upload Admin research evidence
                  </Button>
                ) : null}
              </>
            ) : null
          }
        >
          {/* The five metrics, each carrying its latest recorded decision or
              its honest absence — the trail beneath the §8 status, never a
              second answer to it. */}
          <div className="cr-metriclist">
            {profile.metricDecisions.map((metric) => (
              <article className="cr-metricrow" key={metric.metric}>
                <span className="cr-metricrow__main">
                  <strong>{metric.label}</strong>
                  {metric.decision ? (
                    <small>
                      {metric.decision === 'verified'
                        ? 'Verified'
                        : MORE_EVIDENCE_NEEDED_LABEL}
                      {metric.decidedAt ? ` · ${metric.decidedAt}` : ''}
                    </small>
                  ) : (
                    <small className="grey">No decision recorded yet</small>
                  )}
                  {metric.detail ? <p>{metric.detail}</p> : null}
                </span>
                <Button
                  tier="secondary"
                  small
                  onClick={(event) =>
                    setDialog({
                      kind: 'metric',
                      metric: metric.metric,
                      trigger: event.currentTarget,
                    })
                  }
                >
                  Record metric decision
                </Button>
              </article>
            ))}
          </div>

          {/* The §5.3 evidence inputs — text, present or named as missing. */}
          <div className="cr-evidence__grid">
            {profile.verification.evidence.length === 0 ? (
              <p className="grey">No §5.3 evidence has been recorded for this subtype yet.</p>
            ) : (
              profile.verification.evidence.map((item) => (
                <div className={item.value ? 'cr-ev' : 'cr-ev cr-ev--missing'} key={item.id}>
                  <strong>{item.label}</strong>
                  <small>{item.basis}</small>
                  {item.value ? <p>{item.value}</p> : <p className="grey">Not recorded yet</p>}
                </div>
              ))
            )}
          </div>

          {/* The evidence pictures (0048), grouped with their research item. */}
          {profile.evidenceFiles.files.length > 0 ? (
            <div className="cr-files">
              {profile.evidenceFiles.files.map((file) => (
                <article className="cr-file" key={file.id}>
                  <span>
                    <strong>{file.filename ?? 'Picture'}</strong>
                    <small>
                      {file.categoryLabel}
                      {file.dimensions ? ` · ${file.dimensions}` : ''}
                      {file.uploadedAt ? ` · ${file.uploadedAt}` : ''}
                    </small>
                    {file.state === 'rejected' ? (
                      <small className="cr-file__rejected">
                        Rejected — the bytes did not qualify ({file.rejection})
                      </small>
                    ) : file.state === 'pending' ? (
                      <small className="grey">Upload not confirmed yet</small>
                    ) : null}
                  </span>
                  <Button
                    tier="tertiary"
                    small
                    onClick={async () => {
                      try {
                        onDone(await removeEvidenceFile(prospectId, file.id));
                      } catch (error) {
                        toast('That picture could not be removed', {
                          sub:
                            error instanceof AdminRequestError
                              ? error.detail.whatHappened ?? undefined
                              : undefined,
                        });
                      }
                    }}
                  >
                    Remove
                  </Button>
                </article>
              ))}
            </div>
          ) : null}

          {!profile.evidenceFiles.available ? (
            /* §16a: unavailable names what it waits on, never a dead control. */
            <p className="grey">{profile.evidenceFiles.waitingOn}</p>
          ) : null}

          {profile.verification.by ? (
            <Note>
              Recorded by {profile.verification.by}
              {profile.verification.at ? ` · ${profile.verification.at}` : ''}
            </Note>
          ) : null}
          <Note>{VERIFICATION_IS_HUMAN}</Note>
          <Note>{EVIDENCE_IS_REPORTED_NOT_ENFORCED}</Note>
        </Section>
        {dialogs}
      </>
    );
  }

  /* ── Internal Context ─────────────────────────────────────────────────────*/
  return (
    <>
      <Section
        title="Internal context & fit"
        badge={<ProvenanceBadge provenance="admin" />}
        actions={
          primaryAssociationId ? (
            <Button
              tier="secondary"
              small
              onClick={(event) => editResearch(event.currentTarget)}
            >
              Edit internal context
            </Button>
          ) : null
        }
      >
        <Group>
          {(() => {
            const tier = fieldOf('tier');
            return tier ? <FieldRow field={tier} /> : null;
          })()}
          {/* §29-derived, never stored — 0048's header states the column's
              absence, and the sentence says where a change is recorded. */}
          <div className="frow">
            <dt>Proposal access</dt>
            <dd>
              {profile.proposalAccess.label}
              {profile.proposalAccess.derivedFrom ? (
                <p className="helper">Derived from {profile.proposalAccess.derivedFrom}</p>
              ) : null}
            </dd>
          </div>
          {(() => {
            const source = fieldOf('source');
            return source ? <FieldRow field={source} /> : null;
          })()}
          <div className="frow">
            <dt>Account state</dt>
            <dd>{header.account}</dd>
          </div>
          {(() => {
            const fit = fieldOf('fit');
            return fit ? (
              <FieldRow field={{ ...fit, label: 'Why this Affiliate fits', emptyLabel: 'No fit note recorded' }} />
            ) : null;
          })()}
          {(() => {
            const conflicts = fieldOf('conflicts');
            return conflicts ? <FieldRow field={conflicts} /> : null;
          })()}
          {(() => {
            /* The reference's label over the existing column (§1.8 item 6). */
            const sanctions = fieldOf('sanctions');
            return sanctions ? (
              <FieldRow field={{ ...sanctions, label: RED_FLAGS_LABEL }} />
            ) : null;
          })()}
          {(() => {
            const notes = fieldOf('notes');
            return notes ? <FieldRow field={notes} /> : null;
          })()}
        </Group>
        <Note>{QUALITY_TIER_HELPER}</Note>
        <Note>{PROPOSAL_ACCESS_IS_DERIVED}</Note>
        <Note>{FOUNDER_NEVER_SEES_THIS}</Note>
      </Section>
      {dialogs}
    </>
  );
}

/* ── The per-metric decision dialog ─────────────────────────────────────────*/

function MetricDecisionDialog({
  prospectId,
  metric,
  decisions,
  trigger,
  onClose,
  onDone,
}: {
  prospectId: string;
  /** Preselected when opened from a metric row; chosen in the dialog otherwise. */
  metric: string | null;
  decisions: MetricDecisionView[];
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (
    next: CreatorWorkspaceDetail,
    ask: { sent: boolean; reason: string | null } | null,
  ) => void;
}) {
  const spec: DialogSpec = {
    kicker: 'Evidence + Admin decision',
    title: metric ? 'Record metric decision' : 'Request more evidence',
    body: (
      <>
        <p>
          One decision per metric, recorded with its detail. The whole-record §8
          verification stays its own decision — this is the trail beneath it.
        </p>
        <p className="helper">
          A “{MORE_EVIDENCE_NEEDED_LABEL}” decision sends the ask to the Affiliate,
          in exactly the words recorded here.
        </p>
      </>
    ),
    fields: [
      {
        id: 'metric',
        label: 'Metric',
        select: true,
        options: decisions.map((entry) => ({ value: entry.metric, label: entry.label })),
        value: metric ?? decisions[0]?.metric ?? '',
      },
      {
        id: 'decision',
        label: 'Decision',
        select: true,
        options: [
          { value: 'verified', label: 'Verified' },
          { value: 'more_evidence_needed', label: MORE_EVIDENCE_NEEDED_LABEL },
        ],
        value: metric ? 'verified' : 'more_evidence_needed',
      },
      {
        id: 'detail',
        label: 'Detail — what the evidence showed, or what is needed',
        textarea: true,
        required: true,
        placeholder: 'Tell the Affiliate which screenshot, analytics export, or document is needed.',
      },
    ],
    primary: 'Record decision',
    secondary: 'Cancel',
  };

  return (
    <ConfirmDialog
      spec={spec}
      trigger={trigger}
      onClose={onClose}
      onSubmit={async (values) => {
        const outcome = await recordMetricDecision(prospectId, {
          metric: values['metric'] ?? '',
          decision:
            values['decision'] === 'verified' ? 'verified' : 'more_evidence_needed',
          detail: values['detail'] ?? '',
        });
        onDone(outcome.detail, outcome.ask);
      }}
    />
  );
}

/* ── The evidence-picture uploader (gap 5, Phase 09a's three steps) ─────────*/

function EvidenceUploadDialog({
  prospectId,
  trigger,
  onClose,
  onDone,
}: {
  prospectId: string;
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (next: CreatorWorkspaceDetail) => void;
}) {
  const [category, setCategory] = useState<string>(AFFILIATE_EVIDENCE_CATEGORIES[0].key);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(): Promise<boolean> {
    if (files.length === 0 || busy) return false;
    setBusy(true);
    setFailure(null);
    try {
      let latest: CreatorWorkspaceDetail | null = null;
      for (const file of files) {
        const bytes = await file.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const checksum = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const presigned = await requestEvidenceUpload(prospectId, {
          category,
          contentType: file.type,
          byteSize: file.size,
          checksumSha256: checksum,
          originalFilename: file.name,
        });
        // The browser PUTs straight to storage; nothing passes through Proovd.
        const put = await fetch(presigned.url, {
          method: 'PUT',
          headers: presigned.requiredHeaders,
          body: bytes,
        });
        if (!put.ok) throw new Error(`The storage provider refused the upload (${put.status}).`);
        // Step 3: the server reads the object back — the bytes decide.
        latest = await verifyEvidenceUpload(prospectId, presigned.fileId);
      }
      if (latest) onDone(latest);
    } catch (error) {
      setFailure(
        error instanceof AdminRequestError
          ? [error.detail.title, error.detail.whatHappened].filter(Boolean).join(' ')
          : error instanceof Error
            ? error.message
            : 'The upload did not complete. Nothing already on the record was changed.',
      );
      setBusy(false);
      return false;
    }
    setBusy(false);
    return true;
  }

  return (
    <DialogShell
      kicker="Evidence + Admin decision"
      title="Add picture evidence"
      description={
        <>
          <p>{EVIDENCE_STAYS_WITH_ITS_ITEM}</p>
          <p className="helper">{EVIDENCE_PICTURES_ACCEPTED}</p>
        </>
      }
      trigger={trigger}
      onClose={onClose}
    >
      {(close) => (
        <>
          <label className="field">
            <span className="field__label">Research item</span>
            <select
              className="input"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {AFFILIATE_EVIDENCE_CATEGORIES.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Choose images</span>
            <input
              ref={inputRef}
              className="input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </label>
          {files.length > 0 ? (
            <p className="helper">{files.map((file) => file.name).join(' · ')}</p>
          ) : null}

          {failure ? (
            <p className="field-error" role="alert">
              {failure}
            </p>
          ) : null}

          <div className="case-actions">
            <Button
              disabled={files.length === 0 || busy}
              onClick={() =>
                void upload().then((ok) => {
                  if (ok) close();
                })
              }
            >
              {busy
                ? 'Uploading…'
                : `Upload ${files.length || ''} evidence file${files.length === 1 ? '' : 's'}`}
            </Button>
            <Button tier="tertiary" onClick={close}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </DialogShell>
  );
}
