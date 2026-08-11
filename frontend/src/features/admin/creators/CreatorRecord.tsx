/**
 * Admin → Creators → one Affiliate — Spec §26.1, §8, §11, §2.2.
 *
 * The identity band, the four facts, the one thing that needs doing, and every
 * campaign relationship this person holds.
 *
 * ── Why the relationships are here and not on a tab ─────────────────────────
 * §2.2 caps a Creator at three active partnerships, and §11 ties each
 * invitation to one campaign. "What is this person running, and can they take
 * another" is the question an Admin opens the record with, so it is on the
 * first screen rather than behind a gesture (DNA §5.1 — one hero, and this is
 * it).
 *
 * ── Every action the header offers came from the server ─────────────────────
 * `header.availableActions` is walked, never composed here. A menu the browser
 * assembled is a menu that will eventually offer something the route refuses,
 * and the Founder workspace has taken the same position since it was built.
 *
 * ── Loading, failure, and empty each answer for themselves ──────────────────
 * §27.1's six questions, through `StatePanel`, on every one — including the
 * read that never resolves, which is a state a person genuinely sees.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import {
  ACTIVE_PARTNERSHIP_LABEL,
  CREATOR_NO_ATTENTION_LABEL,
  CREATOR_SUSPENSION_IS_NOT_A_BAN,
} from '@proovd/shared';
import { Button, StatePanel } from '../../../components/index.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import {
  fetchCreator,
  AdminRequestError,
  type CreatorWorkspaceDetail,
} from './api.js';
import {
  AttentionObject,
  Fact,
  FactsStrip,
  Monogram,
  OwnerPill,
  Section,
  StateChip,
  payoutTone,
  verificationTone,
} from './shared.js';
import { AssignCampaignDialog } from './dialogs/AssignCampaignDialog.js';
import { DeletionRequestDialog } from './dialogs/DeletionRequestDialog.js';

type OpenDialog =
  | { kind: 'assign'; trigger: HTMLElement | null }
  | { kind: 'deletion'; trigger: HTMLElement | null };

export function CreatorRecord() {
  const { prospectId = '' } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CreatorWorkspaceDetail | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const surface = useRef<HTMLDivElement>(null);

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
              whatHappened:
                'This Affiliate record could not be read, and the failure carried no explanation.',
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
          'This Affiliate record could not be read, so nothing on this page is current.'
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
        state="Reading this Affiliate"
        whatHappened="Proovd is reading their profile, evidence, campaign relationships, and history."
        next="The record appears as soon as that comes back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Creators"
      />
    );
  }

  const { header, relationships } = detail;
  /* Bound once so the branch below narrows: `associationId` exists only on the
     needed shape, and TypeScript cannot follow it through a JSX ternary. */
  const attention = header.attention.needed ? header.attention : null;
  const canAssign = header.availableActions.includes('assign');
  const canRecordDeletion = header.availableActions.includes('deletion');

  return (
    <div ref={surface}>
      <section className="cr-band">
        <div className="cr-band__top">
          <RouterLink className="crumb" to="/admin/creators">
            ← All Affiliates
          </RouterLink>
          {/*
            The prospect id, quotable on a support call. Rendered as the record
            reference rather than as a decorative code — there is no `AF-1048`
            scheme in this product, and inventing one would be a second identity
            for a row that already has one.
          */}
          <span className="cr-band__ref">{header.prospectId}</span>
        </div>

        <div className="cr-band__identity">
          <Monogram large>{header.initials}</Monogram>
          <div>
            <p className="kicker">
              {[header.subtype, header.niche].filter(Boolean).join(' · ') ||
                'Subtype not recorded'}
            </p>
            <h1 className="cr-band__name">{header.name}</h1>
            {header.channelUrl ? (
              <a
                className="cr-band__channel"
                href={header.channelUrl}
                target="_blank"
                rel="noreferrer"
                data-press
              >
                {[header.handle, header.platform].filter(Boolean).join(' · ')}
              </a>
            ) : (
              <p className="grey">
                {[header.handle, header.platform].filter(Boolean).join(' · ') ||
                  'No channel recorded'}
              </p>
            )}
            {header.location ? <p className="grey">{header.location}</p> : null}
          </div>
          <div className="cr-band__actions">
            <Button
              tier="secondary"
              small
              onClick={() => void navigate(`/admin/creators/${header.prospectId}/profile`)}
            >
              View profile &amp; evidence
            </Button>
            <Button
              tier="secondary"
              small
              onClick={() => void navigate(`/admin/creators/${header.prospectId}/controls`)}
            >
              View account controls
            </Button>
            <Button
              tier="tertiary"
              small
              onClick={() => void navigate(`/admin/creators/${header.prospectId}/history`)}
            >
              View full history
            </Button>
          </div>
        </div>

        <FactsStrip>
          <Fact label="Verification">
            <StateChip tone={verificationTone(header.verification.state)}>
              {header.verification.label}
            </StateChip>
          </Fact>
          <Fact label={ACTIVE_PARTNERSHIP_LABEL}>
            {header.slots.used} of {header.slots.limit}
          </Fact>
          <Fact label="Payout">
            <StateChip tone={payoutTone(header.payout.state)}>{header.payout.label}</StateChip>
          </Fact>
          <Fact label="Account">{header.account}</Fact>
        </FactsStrip>
      </section>

      <div className="cr-record">
        {attention ? (
          <AttentionObject
            owner={attention.owner}
            label={attention.label}
            detail={attention.detail}
            action={
              /*
               * The owner decides which control appears. An Admin-owned item
               * gets the primary action; a Stripe- or Affiliate-owned one gets
               * none, because offering Proovd a button for somebody else's work
               * is §1.4's failure.
               */
              attention.owner === 'Admin' && attention.associationId ? (
                <Button
                  onClick={() =>
                    void navigate(
                      `/admin/creators/${header.prospectId}/relationships/${attention.associationId}`,
                    )
                  }
                >
                  Open the campaign relationship
                </Button>
              ) : attention.owner === 'Admin' ? (
                <Button
                  onClick={() => void navigate(`/admin/creators/${header.prospectId}/profile`)}
                >
                  Review the record
                </Button>
              ) : null
            }
          />
        ) : (
          <p className="cr-caught-up">{CREATOR_NO_ATTENTION_LABEL}</p>
        )}

        <Section
          eyebrow="Campaign relationships"
          title={`${relationships.length} campaign${relationships.length === 1 ? '' : 's'}`}
          actions={
            canAssign ? (
              <Button
                tier="secondary"
                small
                onClick={(event) => setDialog({ kind: 'assign', trigger: event.currentTarget })}
              >
                Assign to another campaign
              </Button>
            ) : null
          }
        >
          {relationships.length === 0 ? (
            <p className="grey">
              No campaign relationship yet. Assigning one records a prospect-state
              relationship — it sends nothing, and the invitation is a separate act.
            </p>
          ) : (
            <div className="cr-rel-list">
              {relationships.map((relationship) => (
                <article className="cr-rel" key={relationship.associationId}>
                  <span
                    className={
                      relationship.holdsSlot ? 'cr-rel__mark cr-rel__mark--live' : 'cr-rel__mark'
                    }
                    aria-hidden="true"
                  />
                  <span className="cr-rel__main">
                    <strong>{relationship.campaignName}</strong>
                    <small>
                      {[relationship.founderName, relationship.designation]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                  <OwnerPill owner={relationship.owner} prefix />
                  <span className="cr-rel__state">
                    <strong>{relationship.status}</strong>
                    <small>
                      {relationship.closesAt
                        ? `Closes ${relationship.closesAt}`
                        : relationship.campaignType ?? 'Campaign type not set'}
                    </small>
                  </span>
                  <Button
                    tier="secondary"
                    small
                    onClick={() =>
                      void navigate(
                        `/admin/creators/${header.prospectId}/relationships/${relationship.associationId}`,
                      )
                    }
                  >
                    View campaign relationship
                  </Button>
                </article>
              ))}
            </div>
          )}
        </Section>

        <section className="cr-quiet">
          <div>
            <strong>{header.verification.label}</strong>
            <small>
              {header.verification.missing.length === 0
                ? 'Every §5.3 evidence input for this subtype is recorded'
                : `${header.verification.missing.length} §5.3 evidence ${header.verification.missing.length === 1 ? 'input' : 'inputs'} outstanding`}
            </small>
          </div>
          <div>
            <strong>{header.payout.label}</strong>
            <small>Stripe-owned state</small>
          </div>
          <div className="cr-quiet__actions">
            {canRecordDeletion ? (
              <Button
                tier="tertiary"
                small
                onClick={(event) => setDialog({ kind: 'deletion', trigger: event.currentTarget })}
              >
                Record deletion request
              </Button>
            ) : null}
            <Button
              tier="tertiary"
              small
              onClick={() => void navigate(`/admin/creators/${header.prospectId}/profile`)}
            >
              Inspect account details
            </Button>
          </div>
        </section>

        {header.account === 'Access suspended' ? (
          <p className="helper">{CREATOR_SUSPENSION_IS_NOT_A_BAN}</p>
        ) : null}
      </div>

      {dialog?.kind === 'assign' ? (
        <AssignCampaignDialog
          prospectId={header.prospectId}
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            // Never patched locally: the server's re-read is the answer, and a
            // locally-edited copy is a claim about an outcome nobody confirmed.
            setDetail(next);
            setDialog(null);
          }}
        />
      ) : null}

      {dialog?.kind === 'deletion' ? (
        <DeletionRequestDialog
          prospectId={header.prospectId}
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
