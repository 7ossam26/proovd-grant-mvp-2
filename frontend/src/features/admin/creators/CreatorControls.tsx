/**
 * Admin → Creators → Policy, cases & access — Spec §26.7, §29, §25.8.
 *
 * ── Two scopes, side by side and never merged ───────────────────────────────
 * An ACCOUNT suspension is a reversible review of the person: it stops them
 * reaching `/api/creator/*` on their next call, and a restore lets them back in.
 * A §29 enforcement action is against ONE campaign relationship and carries five
 * customer-facing statement fields and a five-business-day appeal window.
 *
 * The reference puts both on one screen and so does this — but as two sections
 * with different words, because reading them as one list is how a link pause
 * and a termination come to look like the same kind of act.
 *
 * ── There is no ban here, and nowhere to add one ────────────────────────────
 * §22.7's one-strike sanction is a FOUNDER record. The Spec states no permanent
 * Creator equivalent, so `affiliate_access_actions.action` admits two values by
 * CHECK, there is no `affiliate_ghost_bans` table, and this surface offers no
 * third control.
 *
 * ── What is parked, and why ─────────────────────────────────────────────────
 * Compliance and support case intake. §26.7's support cases exist and are the
 * Admin support console's subject, not this one — and opening one from here
 * would be a second path into a queue that already has an owner.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import {
  CREATOR_SUSPENSION_IS_NOT_A_BAN,
  ISSUER_RIGHTS_SENTENCE,
} from '@proovd/shared';
import { Button, StatePanel } from '../../../components/index.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import { fetchCreator, AdminRequestError, type CreatorWorkspaceDetail } from './api.js';
import { Group, Note, Section } from './shared.js';
import { useCreatorParked } from './parked.js';
import { AccessDecisionDialog } from './dialogs/AccessDecisionDialog.js';
import {
  EnforcementDialog,
  type EnforcementDialogKind,
} from './dialogs/EnforcementDialog.js';

export function CreatorControls() {
  const { prospectId = '' } = useParams();
  const [detail, setDetail] = useState<CreatorWorkspaceDetail | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [accessTrigger, setAccessTrigger] = useState<HTMLElement | null>(null);
  /**
   * A §29 form is always against ONE relationship, so the open dialog carries
   * which — there is no account-level enforcement to fall back on, and a form
   * that had to guess would be guessing which campaign somebody is sanctioned
   * on.
   */
  const [enforcement, setEnforcement] = useState<{
    kind: EnforcementDialogKind;
    associationId: string;
    campaignName: string;
    appealId?: string;
    trigger: HTMLElement | null;
  } | null>(null);
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
              whatHappened:
                'The policy and access record could not be read, and the failure carried no explanation.',
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
          'The policy and access record could not be read, so nothing on this page is current.'
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
        state="Reading the policy and access record"
        whatHappened="Proovd is reading the account standing, every §29 enforcement action, and the recorded disclosures."
        next="The record appears as soon as that comes back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Creators"
      />
    );
  }

  const { header, standing } = detail;
  const suspended = header.account === 'Access suspended';
  const canSuspend = header.availableActions.includes('suspend');
  const canRestore = header.availableActions.includes('restore');

  return (
    <div ref={surface}>
      <header className="cr-context">
        <RouterLink className="crumb" to={`/admin/creators/${header.prospectId}`}>
          ← Back to {header.name}
        </RouterLink>
        <div>
          <p className="kicker">{header.name} · Account level</p>
          <h1 className="cr-context__title" data-reveal="headline">
            Policy, cases &amp; access
          </h1>
        </div>
      </header>

      <div className="cr-profile">
        {/* ── Account standing ───────────────────────────────────────────── */}
        <section className={suspended ? 'cr-banner cr-banner--warn' : 'cr-banner'}>
          <div>
            <h2>{suspended ? 'Account access suspended' : 'Account eligible'}</h2>
            <p>
              {suspended
                ? 'This Affiliate cannot reach their Creator surfaces while the review is open. Their campaign relationships, accepted terms, and anything already earned are unchanged.'
                : standing.policyReacceptanceOpen
                  ? 'A policy update is outstanding, so their Creator surfaces are blocked until they accept it.'
                  : 'No account-level review is open.'}
            </p>
          </div>
          {canSuspend || canRestore ? (
            <Button
              tier={suspended ? 'primary' : 'secondary'}
              onClick={(event) => setAccessTrigger(event.currentTarget)}
            >
              {suspended ? 'Restore Affiliate account' : 'Suspend Affiliate account'}
            </Button>
          ) : null}
        </section>

        {standing.account.latest ? (
          <Section eyebrow="Latest access decision" title={standing.account.latest.action === 'suspend' ? 'Suspended' : 'Restored'}>
            <Group>
              <div className="frow frow--wide">
                <dt>Reason</dt>
                <dd>{standing.account.latest.reason}</dd>
              </div>
              {standing.account.latest.reviewOwner ? (
                <div className="frow">
                  <dt>Review owner</dt>
                  <dd>{standing.account.latest.reviewOwner}</dd>
                </div>
              ) : null}
              {standing.account.latest.nextReviewAt ? (
                <div className="frow">
                  <dt>Next update due</dt>
                  <dd>
                    {standing.account.latest.nextReviewAt}
                    {/* §30: a promise, never a schedule. Nothing sweeps it. */}
                    <p className="helper">
                      A commitment shown to the person, not a job. Nothing sends a reminder.
                    </p>
                  </dd>
                </div>
              ) : null}
              <div className="frow">
                <dt>Recorded by</dt>
                <dd>
                  {standing.account.latest.actor} · {standing.account.latest.at}
                </dd>
              </div>
            </Group>
          </Section>
        ) : null}

        <Note>{CREATOR_SUSPENSION_IS_NOT_A_BAN}</Note>

        {/* ── §29's per-relationship enforcement ─────────────────────────── */}
        <Section
          eyebrow="Campaign relationships"
          title={
            standing.enforcement.length === 0
              ? 'No enforcement action recorded'
              : `${standing.enforcement.length} enforcement ${standing.enforcement.length === 1 ? 'action' : 'actions'}`
          }
        >
          {/*
            One row per relationship, because §29 records against a relationship
            and an Admin has to say which. A single "record an action" control
            with a campaign picker would be the same choice made worse: the
            record already knows which relationships exist.
          */}
          <div className="cr-rel-list">
            {detail.relationships.map((relationship) => (
              <article className="cr-rel" key={relationship.associationId}>
                <span className="cr-rel__main">
                  <strong>{relationship.campaignName}</strong>
                  <small>{relationship.status}</small>
                </span>
                <div className="case-actions">
                  <Button
                    tier="secondary"
                    small
                    onClick={(event) =>
                      setEnforcement({
                        kind: 'action',
                        associationId: relationship.associationId,
                        campaignName: relationship.campaignName,
                        trigger: event.currentTarget,
                      })
                    }
                  >
                    Record enforcement action
                  </Button>
                  <Button
                    tier="tertiary"
                    small
                    onClick={(event) =>
                      setEnforcement({
                        kind: 'conflict',
                        associationId: relationship.associationId,
                        campaignName: relationship.campaignName,
                        trigger: event.currentTarget,
                      })
                    }
                  >
                    Record conflict
                  </Button>
                  <Button
                    tier="tertiary"
                    small
                    onClick={(event) =>
                      setEnforcement({
                        kind: 'self_preorder',
                        associationId: relationship.associationId,
                        campaignName: relationship.campaignName,
                        trigger: event.currentTarget,
                      })
                    }
                  >
                    Record self-pre-order
                  </Button>
                </div>
              </article>
            ))}
          </div>

          {standing.enforcement.length === 0 ? (
            <p className="grey">
              Nothing has been recorded against any of this Affiliate&rsquo;s campaign
              relationships. §29&rsquo;s actions are per relationship, never per account.
            </p>
          ) : (
            <div className="cr-versions">
              {standing.enforcement.map((action) => (
                <article className="cr-enforcement" key={action.id}>
                  <header>
                    <strong>{action.actionKind.replace(/_/g, ' ')}</strong>
                    <small>
                      {action.campaignName} · {action.at}
                    </small>
                  </header>
                  {/* The five §29 fields, exactly as recorded. A record with no
                      row shape for them cannot exist, so none is ever absent. */}
                  <Group>
                    <div className="frow frow--wide">
                      <dt>What happened</dt>
                      <dd>{action.statement.evidenceAndBehavior}</dd>
                    </div>
                    <div className="frow frow--wide">
                      <dt>Rule</dt>
                      <dd>{action.statement.ruleViolated}</dd>
                    </div>
                    <div className="frow frow--wide">
                      <dt>Immediate effect</dt>
                      <dd>{action.statement.immediateEffect}</dd>
                    </div>
                    <div className="frow frow--wide">
                      <dt>How to correct it</dt>
                      <dd>{action.statement.correctionPath}</dd>
                    </div>
                    <div className="frow frow--wide">
                      <dt>Human route</dt>
                      <dd>{action.statement.humanRoute}</dd>
                    </div>
                    <div className="frow">
                      <dt>Appeal due</dt>
                      <dd>
                        {action.appealDueAt ?? <span className="grey">Not applicable</span>}
                        <p className="helper">
                          Five business days on the committed holiday calendar, stored with the
                          version that produced it.
                        </p>
                      </dd>
                    </div>
                    {action.appeal ? (
                      <div className="frow frow--wide">
                        <dt>Appeal</dt>
                        <dd>
                          {action.appeal.grounds}
                          <p className="helper">
                            {action.appeal.decision
                              ? `Decided ${action.appeal.decision} · ${action.appeal.decidedAt ?? ''}`
                              : 'Submitted; no decision recorded yet.'}
                          </p>
                        </dd>
                      </div>
                    ) : null}
                  </Group>
                  {/*
                    Offered only while the decision is genuinely open. §29.4
                    makes it write-once, so a second control against a decided
                    appeal would be one the route refuses.
                  */}
                  {action.appeal && !action.appeal.decision ? (
                    <div className="case-actions">
                      <Button
                        tier="secondary"
                        small
                        onClick={(event) =>
                          setEnforcement({
                            kind: 'appeal',
                            associationId: action.associationId,
                            campaignName: action.campaignName,
                            appealId: action.appeal!.id,
                            trigger: event.currentTarget,
                          })
                        }
                      >
                        Decide the appeal
                      </Button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </Section>

        {/* ── §29.1, §29.2 disclosures ───────────────────────────────────── */}
        <Section
          eyebrow="Disclosures"
          title={
            standing.disclosures.length === 0
              ? 'No disclosure recorded'
              : `${standing.disclosures.length} recorded`
          }
        >
          {standing.disclosures.length === 0 ? (
            <p className="grey">
              Nothing has been disclosed. A conflict or a self-pre-order is recorded as what
              somebody told us — recording it decides nothing.
            </p>
          ) : (
            <div className="cr-versions">
              {standing.disclosures.map((disclosure, index) => (
                <article className="cr-version" key={`${disclosure.at}-${index}`}>
                  <span className="cr-version__no">
                    {disclosure.kind === 'conflict' ? 'Conflict' : 'Self'}
                  </span>
                  <span className="cr-version__main">
                    <strong>{disclosure.detail}</strong>
                    <small>
                      {disclosure.campaignName} · {disclosure.at}
                    </small>
                  </span>
                </article>
              ))}
            </div>
          )}
          <Note>
            A recorded self-pre-order moves that reservation&rsquo;s attribution to blocked,
            so it earns no commission. That follows from the record rather than from an
            Admin&rsquo;s discretion.
          </Note>
        </Section>

        {/* ── Parked: the support console owns cases ─────────────────────── */}
        <Section
          eyebrow="Case intake"
          title="Compliance and support cases"
          actions={
            <Button tier="secondary" small {...parked('caseIntake')}>
              Record a compliance or support case
            </Button>
          }
        >
          <p className="grey">
            §26.7&rsquo;s support cases have their own console, with the §27.8 response clock
            and the handoff gate. Opening one from here would be a second path into a queue
            that already has an owner.
          </p>
          <Note>{ISSUER_RIGHTS_SENTENCE}</Note>
        </Section>
      </div>

      {enforcement ? (
        <EnforcementDialog
          kind={enforcement.kind}
          prospectId={header.prospectId}
          associationId={enforcement.associationId}
          campaignName={enforcement.campaignName}
          {...(enforcement.appealId ? { appealId: enforcement.appealId } : {})}
          trigger={enforcement.trigger}
          onClose={() => setEnforcement(null)}
          onDone={(next) => {
            setDetail(next);
            setEnforcement(null);
          }}
        />
      ) : null}

      {accessTrigger ? (
        <AccessDecisionDialog
          prospectId={header.prospectId}
          suspended={suspended}
          trigger={accessTrigger}
          onClose={() => setAccessTrigger(null)}
          onDone={(next) => {
            setDetail(next);
            setAccessTrigger(null);
          }}
        />
      ) : null}
    </div>
  );
}
