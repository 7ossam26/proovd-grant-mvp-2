/**
 * Account & Payout Setup — the three person-level sections in final shape.
 * Spec §11, §5.5, §13, §25.8, §27.2, §27.7, §29.8, §28.1. Session B of the
 * Affiliate rebuild (2026-08-17; docs/phases/admin-affiliate-rebuild.md,
 * docs/phases/admin-affiliate-reconciliation.md §5).
 *
 * ── What each section may do follows its provenance ─────────────────────────
 * Account & Eligibility is `Affiliate supplied`: corrected through the route
 * that records a reason with the prior value read from the row (§33.12.4), or
 * asked about through the §11 correction request — never silently overwritten.
 * Agreements is versioned acceptance, read-only, with §29.8's audience-wide
 * requirement as its one control. Stripe is `Stripe supplied · read only`
 * with no edit control anywhere — the refresh re-reads the provider's own
 * fact, and the absence of anything else is §13's enforcement.
 *
 * ── The invitation lifecycle renders its `Opened` refusal ───────────────────
 * `INVITATION_LIFECYCLE_STEPS` carries `absentBecause` on exactly one step:
 * §27 ships no tracking pixel, so there is no record the step could render,
 * and the surface says so where the value would be — never "Not recorded" as
 * though somebody forgot.
 */

import { useState } from 'react';
import {
  AFFILIATE_ACCOUNT_CORRECTION_FIELDS,
  CORRECTION_APPENDS_NEW_VALUE,
  CORRECTION_REQUEST_LEAVES_VALUE,
  CREATOR_DIGEST_IS_NOT_ADMIN_WRITABLE,
  CREATOR_RETENTION_NOTE,
  INVITATION_LIFECYCLE_STEPS,
  PASSWORD_RECOVERY_CONSEQUENCE,
  PROVIDER_READ_ONLY_HELPER,
  REACCEPTANCE_IS_AUDIENCE_WIDE,
} from '@proovd/shared';
import { Button } from '../../../../components/index.js';
import { ConfirmDialog, type DialogSpec } from '../../founders/dialogs/index.js';
import { useToast } from '../../../../motion/MotionProvider.js';
import {
  correctAccountField,
  requestCorrection,
  requirePolicyReacceptance,
  sendPasswordRecovery,
  refreshStripeStatus,
  fetchCreator,
  AdminRequestError,
  type CreatorInvitationView,
  type CreatorWorkspaceDetail,
} from '../api.js';
import { FieldRow, Group, Note, ProvenanceBadge, Section, StateChip, payoutTone } from '../shared.js';
import { PayoutReminderDialog } from './PerformanceSections.js';
import { InvitationDialog } from '../dialogs/InvitationDialog.js';
import { DeletionRequestDialog } from '../dialogs/DeletionRequestDialog.js';

type OpenDialog =
  | { kind: 'correct'; trigger: HTMLElement | null }
  | { kind: 'ask'; trigger: HTMLElement | null }
  | { kind: 'recovery'; trigger: HTMLElement | null }
  | { kind: 'reacceptance'; trigger: HTMLElement | null }
  | { kind: 'invitation'; associationId: string; trigger: HTMLElement | null }
  | { kind: 'deletion'; trigger: HTMLElement | null };

export function AccountTabSection({
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

  const accountBlock = profile.blocks.find((b) => b.provenance === 'affiliate');
  const claimed = header.account !== 'Not claimed yet';

  const dialogs = (
    <>
      {dialog?.kind === 'correct' ? (
        <AccountCorrectionDialog
          prospectId={prospectId}
          fields={accountBlock?.fields ?? []}
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            onDone(next);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'ask' ? (
        <RequestCorrectionDialog
          prospectId={prospectId}
          fields={accountBlock?.fields ?? []}
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onDone={(next, ask) => {
            onDone(next);
            setDialog(null);
            if (!ask.sent && ask.reason) {
              toast('Recorded — nothing was sent', { sub: ask.reason });
            }
          }}
        />
      ) : null}
      {dialog?.kind === 'recovery' ? (
        <ConfirmDialog
          spec={{
            kicker: 'Account support',
            title: 'Send password recovery link',
            body: (
              <>
                <p>
                  {header.name} · the recorded account address. One reset path — the same
                  message their own “forgot password” produces.
                </p>
                <p className="helper">{PASSWORD_RECOVERY_CONSEQUENCE}</p>
              </>
            ),
            fields: [],
            primary: 'Send password recovery link',
            secondary: 'Cancel',
          }}
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            onDone(await sendPasswordRecovery(prospectId));
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'reacceptance' ? (
        <ReacceptanceDialog
          prospectId={prospectId}
          published={profile.agreements.publishedVersions}
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            onDone(next);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'invitation' ? (
        <InvitationDialog
          prospectId={prospectId}
          associationId={dialog.associationId}
          invitation={
            profile.invitations.find((i) => i.associationId === dialog.associationId)!
          }
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            onDone(next);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'deletion' ? (
        <DeletionRequestDialog
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

  /* ── Account & Eligibility ────────────────────────────────────────────────*/
  if (sectionKey === 'eligibility') {
    return (
      <>
        <Section
          title="Account & eligibility"
          badge={<ProvenanceBadge provenance="affiliate" />}
          actions={
            <>
              {claimed ? (
                <Button
                  tier="secondary"
                  small
                  onClick={(event) => setDialog({ kind: 'correct', trigger: event.currentTarget })}
                >
                  Correct account information
                </Button>
              ) : null}
              <Button
                tier="tertiary"
                small
                onClick={(event) => setDialog({ kind: 'ask', trigger: event.currentTarget })}
              >
                Request Affiliate correction
              </Button>
            </>
          }
        >
          <Group>
            {(accountBlock?.fields ?? []).map((field) => (
              <FieldRow field={field} key={field.key} />
            ))}
          </Group>
        </Section>

        {/* The invitation line, one per relationship (§11), with the
            lifecycle facts the reference's modal renders. */}
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
              No campaign relationship yet, so there is no invitation to send. §11 ties each
              invitation to one campaign.
            </p>
          ) : (
            <div className="cr-inv-list">
              {profile.invitations.map((invitation) => (
                <article className="cr-inv cr-inv--wide" key={invitation.associationId}>
                  <span className="cr-inv__main">
                    <strong>{invitation.campaignName}</strong>
                    <small>
                      {invitation.stateLabel}
                      {invitation.lastSentAt ? ` · ${invitation.lastSentAt}` : ' · Not sent'}
                      {' · private, campaign-specific claim path'}
                    </small>
                  </span>
                  <InvitationLifecycle invitation={invitation} />
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
                    {invitation.state === 'draft' ? 'Compose and send' : 'Review invitation lifecycle'}
                  </Button>
                </article>
              ))}
            </div>
          )}
        </Section>

        <Section eyebrow="Account support" title="Recovery & retention"
          actions={
            <>
              <Button
                tier="secondary"
                small
                onClick={(event) => setDialog({ kind: 'recovery', trigger: event.currentTarget })}
              >
                Send password recovery link
              </Button>
              <Button
                tier="tertiary"
                small
                onClick={(event) => setDialog({ kind: 'deletion', trigger: event.currentTarget })}
              >
                Record deletion request
              </Button>
            </>
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
        {dialogs}
      </>
    );
  }

  /* ── Agreements ───────────────────────────────────────────────────────────*/
  if (sectionKey === 'agreements') {
    const { agreements } = profile;
    return (
      <>
        <Section
          title="Account agreements"
          badge={<ProvenanceBadge provenance="evidence" />}
          actions={
            agreements.publishedVersions.length > 0 ? (
              <Button
                tier="secondary"
                small
                onClick={(event) =>
                  setDialog({ kind: 'reacceptance', trigger: event.currentTarget })
                }
              >
                Require current policy reacceptance
              </Button>
            ) : null
          }
        >
          <Group>
            <div className="frow">
              <dt>Platform Terms</dt>
              <dd>{agreements.terms ?? <span className="grey">Pending claim</span>}</dd>
            </div>
            <div className="frow">
              <dt>Affiliate AUP</dt>
              <dd>{agreements.aup ?? <span className="grey">Pending claim</span>}</dd>
            </div>
            <div className="frow">
              <dt>Current policy</dt>
              <dd>
                {agreements.policyState === 'reacceptance_required'
                  ? 'Reacceptance required'
                  : agreements.policyState === 'not_claimed'
                    ? 'Pending claim'
                    : 'Accepted'}
              </dd>
            </div>
            <div className="frow">
              <dt>Consent owner</dt>
              <dd>Affiliate · exact version</dd>
            </div>
          </Group>

          {agreements.publishedVersions.length === 0 ? (
            /* §31.4: every document is draft today, and a requirement may cite
               only a published version — so the control is absent WITH the
               reason, not disabled without one. */
            <Note>
              No published policy version exists yet (Track A2 — the eight documents are in
              legal review), and a §29.8 requirement may cite only a published version, so
              there is nothing a reacceptance could point at.
            </Note>
          ) : null}

          <div className="cr-agreement-list">
            {agreements.perCampaign.map((row) => (
              <article key={row.associationId}>
                <span>
                  <strong>{row.campaignName}</strong>
                  <small>Per-campaign IP, confidentiality, disclosure and commercial acceptance</small>
                </span>
                <b>{row.state}</b>
              </article>
            ))}
          </div>
        </Section>
        {dialogs}
      </>
    );
  }

  /* ── Stripe ───────────────────────────────────────────────────────────────*/
  return (
    <>
      <Section
        title={profile.provider.label}
        badge={<ProvenanceBadge provenance="provider" />}
        aside={<StateChip tone={payoutTone(profile.provider.state)}>{header.payout.label}</StateChip>}
        actions={
          <>
            <Button
              tier="secondary"
              small
              onClick={async () => {
                try {
                  onDone(await refreshStripeStatus(prospectId));
                  toast('Stripe status re-read', {
                    sub: 'The block now shows what the provider reported just now.',
                  });
                } catch (error) {
                  toast('The Stripe status could not be re-read', {
                    sub:
                      error instanceof AdminRequestError
                        ? (error.detail.whatHappened ?? undefined)
                        : undefined,
                  });
                  onDone(await fetchCreator(prospectId));
                }
              }}
            >
              Refresh Stripe status
            </Button>
            {profile.provider.state === 'requirements_due' ? (
              // Gap 3 — the real send (Session C), shared with the Transfers
              // section and the Overview attention.
              <StripePayoutReminder detail={detail} onDone={onDone} />
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
              <dt>Payout status</dt>
              <dd>{header.payout.label}</dd>
            </div>
            <div className="frow">
              <dt>Last reported</dt>
              <dd>
                {profile.provider.lastUpdated ?? <span className="grey">Not recorded yet</span>}
              </dd>
            </div>
          </Group>
        ) : (
          /* §16a: not yet populated is not zero. It says what it waits on. */
          <p className="grey">{profile.provider.waitingOn}</p>
        )}
        <Note>{PROVIDER_READ_ONLY_HELPER}</Note>
      </Section>
      {dialogs}
    </>
  );
}

/* ── The invitation lifecycle facts, with the `Opened` refusal ──────────────*/

/** The Stripe strip's reminder control — a trigger and the one shared dialog. */
function StripePayoutReminder({
  detail,
  onDone,
}: {
  detail: CreatorWorkspaceDetail;
  onDone: (next: CreatorWorkspaceDetail) => void;
}) {
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button tier="tertiary" small onClick={(event) => setTrigger(event.currentTarget)}>
        Send payout reminder
      </Button>
      {trigger ? (
        <PayoutReminderDialog
          detail={detail}
          trigger={trigger}
          onClose={() => setTrigger(null)}
          onDone={(next) => {
            onDone(next);
            setTrigger(null);
          }}
        />
      ) : null}
    </>
  );
}

function InvitationLifecycle({ invitation }: { invitation: CreatorInvitationView }) {
  const latest = invitation.sends[0] ?? null;
  const valueFor = (step: (typeof INVITATION_LIFECYCLE_STEPS)[number]): string => {
    switch (step.key) {
      case 'created':
        return invitation.createdAt ?? 'Recorded';
      case 'sent':
        return invitation.lastSentAt ?? 'Not sent';
      case 'delivered':
        return latest
          ? latest.confirmed
            ? latest.at
            : 'Recorded, not confirmed delivered'
          : 'Not sent';
      case 'signup_started':
        return invitation.signupStartedAt ?? 'Not started';
      case 'claimed':
        return invitation.claimedAt ?? 'Not claimed';
      case 'expiry':
        return invitation.tokenExpiresAt ?? 'No live link';
      case 'delivery_failure':
        return latest && !latest.confirmed ? 'Delivery unconfirmed — see the send record' : 'None';
      case 'token':
        return invitation.state === 'claimed'
          ? 'Revoked automatically after claim'
          : invitation.state === 'revoked'
            ? 'Revoked by Admin'
            : 'Scoped to one Affiliate and campaign';
      default:
        return '—';
    }
  };

  return (
    <dl className="cr-lifecycle">
      {INVITATION_LIFECYCLE_STEPS.map((step) => (
        <div key={step.key} className={step.absentBecause ? 'cr-lifecycle__absent' : undefined}>
          <dt>{step.label}</dt>
          <dd>{step.absentBecause ?? valueFor(step)}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── The two correction dialogs ─────────────────────────────────────────────*/

function AccountCorrectionDialog({
  prospectId,
  fields,
  trigger,
  onClose,
  onDone,
}: {
  prospectId: string;
  fields: { key: string; label: string; value: string | null }[];
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (next: CreatorWorkspaceDetail) => void;
}) {
  /*
   * The current value rides in the option label — the reference's own pattern
   * (`Username · mira`) — so the previous value is in front of the Admin at
   * the moment they choose. The server reads the prior from the row under
   * lock regardless (§33.12.4); this is display, not the record.
   */
  const currentOf = (key: string): string => {
    const match: Record<string, string> = {
      name: 'name',
      username: 'username',
      email: 'email',
      phone: 'phone',
      country: 'location',
      state_region: 'location',
    };
    return fields.find((f) => f.key === match[key])?.value ?? 'Not supplied';
  };

  const spec: DialogSpec = {
    kicker: 'Affiliate supplied · Admin correction',
    title: 'Correct account information',
    body: <p className="helper">{CORRECTION_APPENDS_NEW_VALUE}</p>,
    fields: [
      {
        id: 'field',
        label: 'Account field',
        select: true,
        options: AFFILIATE_ACCOUNT_CORRECTION_FIELDS.map((entry) => ({
          value: entry.key,
          label: `${entry.label} · ${currentOf(entry.key)}`,
        })),
        value: AFFILIATE_ACCOUNT_CORRECTION_FIELDS[0].key,
      },
      { id: 'newValue', label: 'Corrected value', required: true },
      { id: 'reason', label: 'Correction reason', textarea: true, required: true },
    ],
    primary: 'Record corrected account information',
    secondary: 'Cancel',
  };

  return (
    <ConfirmDialog
      spec={spec}
      trigger={trigger}
      onClose={onClose}
      onSubmit={async (values) => {
        onDone(
          await correctAccountField(prospectId, {
            field: values['field'] ?? '',
            newValue: values['newValue'] ?? '',
            reason: values['reason'] ?? '',
          }),
        );
      }}
    />
  );
}

function RequestCorrectionDialog({
  prospectId,
  fields,
  trigger,
  onClose,
  onDone,
}: {
  prospectId: string;
  fields: { key: string; label: string; value: string | null }[];
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (next: CreatorWorkspaceDetail, ask: { sent: boolean; reason: string | null }) => void;
}) {
  const options = fields
    .filter((field) => ['username', 'name', 'email', 'phone', 'location'].includes(field.key))
    .map((field) => `${field.label} · ${field.value ?? 'Not supplied'}`);

  const spec: DialogSpec = {
    kicker: 'Affiliate supplied',
    title: 'Request Affiliate correction',
    body: <p className="helper">{CORRECTION_REQUEST_LEAVES_VALUE}</p>,
    fields: [
      {
        id: 'subjectLabel',
        label: 'Affiliate-owned field',
        select: true,
        options,
        value: options[0] ?? '',
      },
      {
        id: 'note',
        label: 'What should be checked',
        textarea: true,
        required: true,
        placeholder: 'State the suspected issue and the evidence needed.',
      },
    ],
    primary: 'Send Affiliate correction request',
    secondary: 'Cancel',
  };

  return (
    <ConfirmDialog
      spec={spec}
      trigger={trigger}
      onClose={onClose}
      onSubmit={async (values) => {
        const outcome = await requestCorrection(prospectId, {
          subjectLabel: values['subjectLabel'] ?? '',
          note: values['note'] ?? '',
        });
        onDone(outcome.detail, outcome.ask);
      }}
    />
  );
}

/* ── §29.8, audience-wide, said so ──────────────────────────────────────────*/

function ReacceptanceDialog({
  prospectId,
  published,
  trigger,
  onClose,
  onDone,
}: {
  prospectId: string;
  published: { slug: string; version: string; title: string }[];
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (next: CreatorWorkspaceDetail) => void;
}) {
  const spec: DialogSpec = {
    kicker: 'Versioned acceptance',
    title: 'Require current policy reacceptance',
    body: (
      <>
        <p>
          Continued use and active Affiliate links pause until the Affiliate accepts the
          material policy version.
        </p>
        <p className="helper">{REACCEPTANCE_IS_AUDIENCE_WIDE}</p>
      </>
    ),
    fields: [
      {
        id: 'slug',
        label: 'Material policy version',
        select: true,
        options: published.map((entry) => ({
          value: entry.slug,
          label: `${entry.title} · ${entry.version}`,
        })),
        value: published[0]?.slug ?? '',
      },
      {
        id: 'reason',
        label: 'Material change and reason',
        textarea: true,
        required: true,
      },
    ],
    primary: 'Require current policy reacceptance',
    secondary: 'Cancel',
  };

  return (
    <ConfirmDialog
      spec={spec}
      trigger={trigger}
      onClose={onClose}
      onSubmit={async (values) => {
        const chosen = published.find((entry) => entry.slug === values['slug']);
        await requirePolicyReacceptance({
          slug: chosen?.slug ?? '',
          version: chosen?.version ?? '',
          audience: 'affiliate',
          reason: values['reason'] ?? '',
        });
        onDone(await fetchCreator(prospectId));
      }}
    />
  );
}
