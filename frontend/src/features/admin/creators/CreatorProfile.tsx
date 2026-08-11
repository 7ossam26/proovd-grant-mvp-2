/**
 * Admin → Creators → Profile & evidence — Spec §8, §5.3, §11, §13, §25.8, §27.2.
 *
 * ── Provenance is the whole design ──────────────────────────────────────────
 * The reference's central idea: a field is not just a value, it is a value
 * somebody is responsible for. The page is four blocks and each one is labelled
 * with who supplied it, because the answer decides what may be done to it:
 *
 *   Affiliate supplied      corrected through a route that records a reason
 *   Admin researched        edited freely — the Affiliate never typed it
 *   Evidence + decision     evidence is recorded; the decision is a human's
 *   Stripe supplied         read-only, everywhere, with no edit control at all
 *
 * The fourth is the one that matters most: §13 makes Proovd the holder of a
 * status and an id and never of the data behind them, so there is no control
 * here that could write one — the absence is the enforcement, exactly as it is
 * on the Creator's own payout surface.
 *
 * ── §11's boundary, stated where it can be breached ─────────────────────────
 * An Admin sees every field on this page; a Founder sees seven columns and none
 * of these. Saying so where the sensitive fields are read is what keeps one out
 * of a support transcript (§3.1's actual risk, which is leakage from an Admin
 * panel rather than the panel itself).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import {
  CREATOR_DIGEST_IS_NOT_ADMIN_WRITABLE,
  CREATOR_RETENTION_NOTE,
  EVIDENCE_IS_REPORTED_NOT_ENFORCED,
  FOUNDER_NEVER_SEES_THIS,
  PROVIDER_READ_ONLY_HELPER,
  QUALITY_TIER_HELPER,
  VERIFICATION_IS_HUMAN,
} from '@proovd/shared';
import { Button, StatePanel } from '../../../components/index.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import { fetchCreator, AdminRequestError, type CreatorWorkspaceDetail } from './api.js';
import {
  FieldRow,
  Group,
  Note,
  ProvenanceBadge,
  Section,
  StateChip,
  payoutTone,
  verificationTone,
} from './shared.js';
import { useCreatorParked } from './parked.js';
import { InvitationDialog } from './dialogs/InvitationDialog.js';
import { VerificationDialog } from './dialogs/VerificationDialog.js';
import { ResearchDialog } from './dialogs/ResearchDialog.js';

type OpenDialog =
  | { kind: 'invitation'; associationId: string; trigger: HTMLElement | null }
  | { kind: 'verification'; associationId: string; trigger: HTMLElement | null }
  | { kind: 'research'; associationId: string; trigger: HTMLElement | null };

export function CreatorProfile() {
  const { prospectId = '' } = useParams();
  const [detail, setDetail] = useState<CreatorWorkspaceDetail | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const parked = useCreatorParked();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setDetail(await fetchCreator(prospectId));
    } catch (error: unknown) {
      setLoadError(
        error instanceof AdminRequestError
          ? error
          : new AdminRequestError({
              error: 'unreachable',
              status: 0,
              title: 'Proovd could not be reached',
              whatHappened: 'The profile could not be read, and the failure carried no explanation.',
              next: 'Try the read again. Nothing was changed by the attempt.',
            }),
      );
    }
  }, [prospectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useProovdMotion(surface, [detail]);

  if (loadError) {
    return (
      <StatePanel
        state={loadError.detail.title}
        whatHappened={
          loadError.detail.whatHappened ??
          'The profile could not be read, so nothing on this page is current.'
        }
        next={loadError.detail.next ?? 'Try the read again. Nothing was changed by the attempt.'}
        owner="Proovd"
        nextUpdate="When you try again"
        action={
          <Button tier="secondary" onClick={() => void load()}>
            Try the read again
          </Button>
        }
        reference="Admin · Creators"
        ring
      />
    );
  }

  if (!detail) {
    return (
      <StatePanel
        state="Reading the profile"
        whatHappened="Proovd is reading what the Affiliate confirmed, what Proovd researched, the evidence, and the Stripe state."
        next="The profile appears as soon as that comes back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Creators"
      />
    );
  }

  const { header, profile } = detail;
  /*
   * Which relationship a record-level edit is filed against.
   *
   * The research record and the verification decision belong to the PERSON, but
   * the routes that write them are association-scoped (`admin-affiliates.ts`
   * was built per campaign relationship). The first relationship is the one the
   * recruitment created, so it is the one those writes are addressed to — and
   * when there is none, the controls are absent rather than pointed at nothing.
   */
  const primaryAssociationId = profile.invitations[0]?.associationId ?? null;

  return (
    <div ref={surface}>
      <header className="cr-context">
        <RouterLink className="crumb" to={`/admin/creators/${header.prospectId}`}>
          ← Back to {header.name}
        </RouterLink>
        <div>
          <p className="kicker">{header.name} · Account level</p>
          <h1 className="cr-context__title" data-reveal="headline">
            Profile &amp; evidence
          </h1>
        </div>
      </header>

      <div className="cr-profile">
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
              <dt>Payout</dt>
              <dd>
                <StateChip tone={payoutTone(header.payout.state)}>{header.payout.label}</StateChip>
              </dd>
            </div>
          </Group>
        </section>

        {/* ── Account & research ─────────────────────────────────────────── */}
        <Section eyebrow="Profile" title="Account & research">
          {profile.blocks.map((block) => (
            <div
              className={`cr-block cr-block--${block.provenance}`}
              key={block.provenance}
            >
              <header className="cr-block__head">
                <div>
                  <ProvenanceBadge provenance={block.provenance} />
                  <h3>{block.title}</h3>
                </div>
                <div className="case-actions">
                  {block.provenance === 'affiliate' ? (
                    <>
                      {/*
                        Correcting somebody else's confirmed record is a §25.6
                        act with a reason. Parked until the correction route
                        exists — an Admin who edits it today would be editing
                        the research record, which is a different fact.
                      */}
                      <Button tier="secondary" small {...parked('requestCorrection')}>
                        Request Affiliate correction
                      </Button>
                    </>
                  ) : null}
                  {block.provenance === 'admin' && primaryAssociationId ? (
                    <Button
                      tier="secondary"
                      small
                      onClick={(event) =>
                        setDialog({
                          kind: 'research',
                          associationId: primaryAssociationId,
                          trigger: event.currentTarget,
                        })
                      }
                    >
                      Edit audience research
                    </Button>
                  ) : null}
                </div>
              </header>
              <Group>
                {block.fields.map((field) => (
                  <FieldRow field={field} key={field.key} />
                ))}
              </Group>
              {block.provenance === 'admin' ? (
                <>
                  <Note>{QUALITY_TIER_HELPER}</Note>
                  <Note>{FOUNDER_NEVER_SEES_THIS}</Note>
                </>
              ) : null}
            </div>
          ))}
        </Section>

        {/* ── Audience verification ──────────────────────────────────────── */}
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
                    setDialog({
                      kind: 'verification',
                      associationId: primaryAssociationId,
                      trigger: event.currentTarget,
                    })
                  }
                >
                  Record verification decision
                </Button>
                <Button tier="tertiary" small {...parked('evidenceUpload')}>
                  Upload Admin research evidence
                </Button>
              </>
            ) : null
          }
        >
          <div className="cr-evidence">
            <Group>
              {profile.verification.metrics.map((metric) => (
                <FieldRow field={metric} key={metric.key} />
              ))}
            </Group>

            <div className="cr-evidence__grid">
              {profile.verification.evidence.length === 0 ? (
                <p className="grey">
                  No §5.3 evidence has been recorded for this subtype yet.
                </p>
              ) : (
                profile.verification.evidence.map((item) => (
                  <div
                    className={item.value ? 'cr-ev' : 'cr-ev cr-ev--missing'}
                    key={item.id}
                  >
                    <strong>{item.label}</strong>
                    <small>{item.basis}</small>
                    {item.value ? (
                      <p>{item.value}</p>
                    ) : (
                      <p className="grey">Not recorded yet</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {profile.verification.by ? (
            <Note>
              Recorded by {profile.verification.by}
              {profile.verification.at ? ` · ${profile.verification.at}` : ''}
            </Note>
          ) : null}
          <Note>{VERIFICATION_IS_HUMAN}</Note>
          <Note>{EVIDENCE_IS_REPORTED_NOT_ENFORCED}</Note>
        </Section>

        {/* ── Stripe ─────────────────────────────────────────────────────── */}
        <Section
          title={profile.provider.label}
          badge={<ProvenanceBadge provenance="provider" />}
          actions={
            <>
              <Button tier="secondary" small {...parked('stripeRefresh')}>
                Refresh Stripe status
              </Button>
              {profile.provider.state === 'requirements_due' ? (
                <Button tier="tertiary" small {...parked('payoutReminder')}>
                  Send payout reminder
                </Button>
              ) : null}
            </>
          }
        >
          {profile.provider.populated ? (
            <Group>
              <div className="frow">
                <dt>Connected account</dt>
                <dd>{profile.provider.accountId}</dd>
              </div>
              <div className="frow">
                <dt>Transfer capability</dt>
                <dd>{profile.provider.transferCapability}</dd>
              </div>
              <div className="frow">
                <dt>Requirements</dt>
                <dd>
                  {profile.provider.requirementsLabel}
                  {profile.provider.requirements.length > 0 ? (
                    <p className="helper">{profile.provider.requirements.join(' · ')}</p>
                  ) : null}
                </dd>
              </div>
              <div className="frow">
                <dt>Last reported</dt>
                <dd>
                  {profile.provider.lastUpdated ?? (
                    <span className="grey">Not recorded yet</span>
                  )}
                </dd>
              </div>
            </Group>
          ) : (
            /* §16a: not yet populated is not zero. It says what it waits on. */
            <p className="grey">{profile.provider.waitingOn}</p>
          )}
          <Note>{PROVIDER_READ_ONLY_HELPER}</Note>
        </Section>

        {/* ── Invitations, one per relationship ──────────────────────────── */}
        <Section
          eyebrow="Campaign invitations"
          title={
            profile.invitations.length === 1
              ? '1 invitation'
              : `${profile.invitations.length} invitations`
          }
        >
          {profile.invitations.length === 0 ? (
            <p className="grey">
              No campaign relationship yet, so there is no invitation to send. §11 ties
              each invitation to one campaign.
            </p>
          ) : (
            <div className="cr-inv-list">
              {profile.invitations.map((invitation) => (
                <article className="cr-inv" key={invitation.associationId}>
                  <span className="cr-inv__main">
                    <strong>{invitation.campaignName}</strong>
                    <small>
                      {invitation.stateLabel}
                      {invitation.lastSentAt ? ` · ${invitation.lastSentAt}` : ' · Not sent'}
                    </small>
                  </span>
                  <Button
                    tier="secondary"
                    small
                    onClick={(event) =>
                      setDialog({
                        kind: 'invitation',
                        associationId: invitation.associationId,
                        trigger: event.currentTarget,
                      })
                    }
                  >
                    {invitation.state === 'draft'
                      ? 'Compose and send'
                      : 'Review invitation delivery'}
                  </Button>
                </article>
              ))}
            </div>
          )}
        </Section>

        {/* ── Recovery, notifications, retention ─────────────────────────── */}
        <Section
          eyebrow="Account support"
          title="Recovery, notifications & retention"
          actions={
            <Button tier="secondary" small {...parked('passwordRecovery')}>
              Send password recovery link
            </Button>
          }
        >
          <Group>
            {profile.support.map((field) => (
              <FieldRow field={field} key={field.key} />
            ))}
          </Group>
          <Note>{CREATOR_DIGEST_IS_NOT_ADMIN_WRITABLE}</Note>
          <Note>{CREATOR_RETENTION_NOTE}</Note>

          {profile.deletionRequest ? (
            <div className="cr-deletion">
              <h3>Deletion request</h3>
              <p>{profile.deletionRequest.detail}</p>
              <p className="helper">
                Received via {profile.deletionRequest.receivedVia} ·{' '}
                {profile.deletionRequest.requestedAt}
              </p>
              {profile.deletionRequest.reviews.length === 0 ? (
                <p className="grey">No review has been recorded yet.</p>
              ) : (
                <ul className="cr-reviews">
                  {profile.deletionRequest.reviews.map((review, index) => (
                    <li key={`${review.at}-${index}`}>
                      <p>{review.note}</p>
                      <p className="helper">
                        {review.actor} · {review.at}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </Section>
      </div>

      {dialog?.kind === 'invitation' ? (
        <InvitationDialog
          prospectId={header.prospectId}
          associationId={dialog.associationId}
          invitation={
            profile.invitations.find((i) => i.associationId === dialog.associationId)!
          }
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            setDetail(next);
            setDialog(null);
          }}
        />
      ) : null}

      {dialog?.kind === 'verification' ? (
        <VerificationDialog
          prospectId={header.prospectId}
          associationId={dialog.associationId}
          verification={profile.verification}
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            setDetail(next);
            setDialog(null);
          }}
        />
      ) : null}

      {dialog?.kind === 'research' ? (
        <ResearchDialog
          prospectId={header.prospectId}
          associationId={dialog.associationId}
          fields={profile.blocks.find((b) => b.provenance === 'admin')?.fields ?? []}
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            setDetail(next);
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}
