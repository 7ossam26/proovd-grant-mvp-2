/**
 * The Founder record's read-and-route sections — Campaign, Affiliates,
 * Backers & Demand, Money & Fulfillment, Support & Enforcement, History.
 * Spec §14.4, §15, §18, §20, §21, §22, §24.8, §25.6, §26.7, §31.6; built
 * Session C (2026-08-17) to the supplied reference.
 *
 * ── Read-and-route, enforced by what is absent ──────────────────────────────
 * Every panel renders composed state from `detail.operations` and routes to
 * the workspace that owns the action. Where the reference draws a decision
 * control this record must not mount — approve a campaign, record a party's
 * §14.2 acceptance, set a bonus, release a payment, suspend a campaign — the
 * refusal renders as a sentence from `OPERATIONS_ABSENCES`, at the place the
 * reference put the control, so a later session re-adding one fails the
 * register walk (the Create Founder arrangement, applied to operations).
 *
 * ── Each tab is a question the record answers ───────────────────────────────
 * `OPERATIONS_TAB_COPY` pins the questions; the hero is always derived from
 * the record, never a sentence this file invents. Lists are bounded samples
 * beside their totals — the reference's own shape (three comments and a
 * "View all") — and the full list lives in the owning workspace.
 *
 * ── No campaign is a state, not an error ────────────────────────────────────
 * A prospect who has not reached a campaign renders the reference's own
 * absence: the proposed type is shown as editable-intent, never as Product or
 * Idea truth, and nothing below fabricates a campaign-shaped zero (§16a).
 */

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  COMMENTS_NEVER_REWRITTEN,
  FOUNDER_HISTORY_CATEGORIES,
  HISTORY_AUDIT_NOTE,
  MEDIATED_REQUESTS_ABSENT,
  NOTIFICATION_EVENTS,
  OPERATIONS_ABSENCES,
  OPERATIONS_TAB_COPY,
  type NotificationEventKey,
  type OperationsSectionKey,
} from '@proovd/shared';
import { Button, Tag } from '../../../../components/index.js';
import { cn } from '../../../../components/cn.js';
import { useProovdMotion } from '../../../../motion/MotionProvider.js';
import type { FounderWorkspaceDetail, OperationsView } from '../../api.js';
import {
  Actions,
  Block,
  Expandable,
  Group,
  Missing,
  Note,
  Row,
  SecTitle,
  Timeline,
  TimelineRow,
  type WorkspaceActions,
} from '../shared.js';

/* ── The shared scaffold ───────────────────────────────────────────────────*/

type TabOf<S extends OperationsSectionKey> = keyof (typeof OPERATIONS_TAB_COPY)[S] & string;

const TAB_LABELS: Record<string, string> = {
  details: 'Details',
  review: 'Review',
  live: 'Live',
  page: 'Page & Updates',
  relationships: 'Relationships',
  requests: 'Requests',
  performance: 'Performance & Completion',
  demand: 'Demand',
  responses: 'Responses',
  backers: 'Backers',
  close: 'Close',
  payments: 'Payments',
  fulfillment: 'Fulfillment',
  refunds: 'Refunds & Recovery',
  support: 'Support',
  cancellation: 'Cancellation',
  enforcement: 'Enforcement',
  timeline: 'Timeline',
  communications: 'Communications',
};

interface ScaffoldProps<S extends OperationsSectionKey> {
  section: S;
  ariaLabel: string;
  tab: TabOf<S>;
  onTab: (next: TabOf<S>) => void;
  hero: string;
  children: ReactNode;
}

function Scaffold<S extends OperationsSectionKey>({
  section,
  ariaLabel,
  tab,
  onTab,
  hero,
  children,
}: ScaffoldProps<S>) {
  const uid = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useProovdMotion(bodyRef, [tab, hero]);

  const keys = Object.keys(OPERATIONS_TAB_COPY[section]) as TabOf<S>[];
  const copy = (OPERATIONS_TAB_COPY[section] as Record<string, { question: string; subtitle: string }>)[
    tab
  ] ?? { question: '', subtitle: '' };

  function onTabKeys(event: KeyboardEvent<HTMLElement>) {
    const current = keys.indexOf(tab);
    let index = -1;
    if (event.key === 'ArrowRight') index = (current + 1) % keys.length;
    else if (event.key === 'ArrowLeft') index = (current - 1 + keys.length) % keys.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = keys.length - 1;
    if (index < 0) return;
    const next = keys[index];
    if (!next) return;
    event.preventDefault();
    onTab(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div>
      <nav className="fob-tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onTabKeys}>
        {keys.map((key) => (
          <button
            key={key}
            ref={(node) => {
              tabRefs.current[key] = node;
            }}
            type="button"
            id={`${uid}-optab-${key}`}
            className={cn('fob-tab', tab === key && 'is-active')}
            role="tab"
            aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => onTab(key)}
          >
            {TAB_LABELS[key] ?? key}
          </button>
        ))}
      </nav>

      <div ref={bodyRef} role="tabpanel" aria-labelledby={`${uid}-optab-${tab}`}>
        <header className="fob-hero" data-scroll="rise">
          <p className="kicker">{copy.question}</p>
          {/* An h2 — the record's h1 is the page heading (§33.11.2). */}
          <h2 className="h3">{hero}</h2>
          <Note>{copy.subtitle}</Note>
        </header>
        {children}
      </div>
    </div>
  );
}

/* ── The refusal register, rendered ────────────────────────────────────────*/

/**
 * A control the reference draws and this record refuses to mount, rendered
 * as the sentence the register carries — where the reference put the button.
 */
function Refusal({ control }: { control: (typeof OPERATIONS_ABSENCES)[number]['control'] }) {
  const entry = OPERATIONS_ABSENCES.find((absence) => absence.control === control);
  if (!entry) return null;
  return (
    <p className="fop-refusal">
      <b>No “{entry.control}” control renders here.</b> {entry.reason}
    </p>
  );
}

/* ── The no-campaign absence (the reference's own state) ───────────────────*/

function NoCampaign({
  detail,
  owns,
}: {
  detail: FounderWorkspaceDetail;
  owns: string;
}) {
  const proposed = detail.overview.vetting.campaignTypeSelected;
  return (
    <section className="fob-panel" data-scroll="rise">
      <SecTitle>Campaign unavailable</SecTitle>
      <p>
        {owns} remain absent until the invitation workflow creates a campaign. The proposed
        campaign type remains editable and is not treated as Product or Idea truth.
      </p>
      <Group>
        <Row label="Campaign">Not created</Row>
        <Row label="Proposed type">{proposed ?? <Missing />}</Row>
        <Row label="Invitation">{detail.overview.invitation.state}</Row>
        <Row label="Next action">
          {detail.header.adminAction.kind === 'due'
            ? detail.header.adminAction.label
            : detail.header.founderAction.kind === 'due'
              ? detail.header.founderAction.label
              : 'Nothing is due'}
        </Row>
      </Group>
    </section>
  );
}

/* ── Campaign ──────────────────────────────────────────────────────────────*/

export type CampaignTabKey = TabOf<'campaign'>;

interface CampaignSectionProps {
  detail: FounderWorkspaceDetail;
  tab: CampaignTabKey;
  onTab: (next: CampaignTabKey) => void;
  actions: WorkspaceActions;
}

export function CampaignSection({ detail, tab, onTab, actions }: CampaignSectionProps) {
  const ops = detail.operations;

  const hero = !ops
    ? `${detail.header.preferredName} has no campaign yet`
    : tab === 'details'
      ? ops.campaignName
      : tab === 'review'
        ? (ops.review.rounds[0]
            ? ops.review.rounds[0].outcome === 'pending'
              ? 'Pending review'
              : `Round ${ops.review.rounds[0].round} — ${ops.review.rounds[0].outcome.replace(/_/g, ' ')}`
            : 'No review round submitted yet')
        : tab === 'live'
          ? ops.live.isLive
            ? `${ops.live.active} active pre-orders`
            : 'Not live yet'
          : ops.live.publicUrl
            ? 'The public page is live'
            : 'No public page yet';

  return (
    <Scaffold section="campaign" ariaLabel="Campaign record" tab={tab} onTab={onTab} hero={hero}>
      {!ops ? (
        <NoCampaign
          detail={detail}
          owns="Campaign details, review, live truth, the public page, updates, and comments"
        />
      ) : tab === 'details' ? (
        <CampaignDetails detail={detail} ops={ops} actions={actions} />
      ) : tab === 'review' ? (
        <CampaignReview ops={ops} />
      ) : tab === 'live' ? (
        <CampaignLive ops={ops} />
      ) : (
        <CampaignPage ops={ops} />
      )}
    </Scaffold>
  );
}

function CampaignDetails({
  detail,
  ops,
  actions,
}: {
  detail: FounderWorkspaceDetail;
  ops: OperationsView;
  actions: WorkspaceActions;
}) {
  const { campaigns } = detail;
  const next = campaigns.next;
  return (
    <>
      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Campaign details</SecTitle>
        <p className="helper">
          Customer-visible content and operating terms, read from the build record.
        </p>
        <Group>
          <Row label="Type">{ops.typeLabel === 'Proposed' ? 'Proposed' : `${ops.typeLabel} · locked`}</Row>
          <Row label="Status">{ops.statusLabel}</Row>
          {ops.content.fields.map((field) => (
            <Row key={field.label} label={field.label}>
              {field.value ?? <Missing />}
            </Row>
          ))}
        </Group>
        <Refusal control="Edit a campaign field from this record" />
        <Actions>
          <RouterLink className="btn btn--secondary" to={`/admin/campaigns/${ops.campaignId}`}>
            <span className="btn__label">Open in Campaigns workspace</span>
          </RouterLink>
        </Actions>
        {detail.campaigns.current ? (
          <Expandable label="Technical details">
            <p className="grey">
              Lifecycle value: <b>{detail.campaigns.current.rawStatus}</b> — Admin surfaces always
              show the human-readable label.
            </p>
          </Expandable>
        ) : null}
      </section>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Rewards</SecTitle>
        {ops.content.rewards.length === 0 ? (
          <p className="grey">No rewards recorded yet.</p>
        ) : (
          ops.content.rewards.map((reward) => (
            <Block key={reward.title}>
              <p className="camp-block__name">
                <b>{reward.title}</b> <span className="grey">· {reward.price}</span>
              </p>
              {reward.contents ? <p>{reward.contents}</p> : null}
              {reward.delivery ? <p className="helper">Delivery — {reward.delivery}</p> : null}
            </Block>
          ))
        )}
      </section>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>FAQs</SecTitle>
        {ops.content.faqs.length === 0 ? (
          <p className="grey">No FAQs recorded yet.</p>
        ) : (
          <Group>
            {ops.content.faqs.map((faq) => (
              <Row key={faq.question} label={faq.question}>
                {faq.answer}
              </Row>
            ))}
          </Group>
        )}
      </section>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Previous campaigns</SecTitle>
        {campaigns.previous.length === 0 ? (
          <p className="grey">No previous campaigns.</p>
        ) : (
          campaigns.previous.map((campaign) => (
            <Block key={campaign.campaignId}>
              <p className="camp-block__name">
                <b>{campaign.name}</b> <Tag>{campaign.type}</Tag>
              </p>
              <p>
                <b>{campaign.status}</b>
              </p>
              {campaign.lines.length > 0 ? (
                <p className="grey">{campaign.lines.join(' · ')}</p>
              ) : null}
              <Actions>
                <RouterLink
                  className="btn btn--tertiary"
                  to={`/admin/campaigns/${campaign.campaignId}`}
                >
                  <span className="btn__label">View campaign</span>
                </RouterLink>
              </Actions>
            </Block>
          ))
        )}

        {next ? (
          <>
            <SecTitle>Another campaign</SecTitle>
            {next.earliest ? (
              <p>
                {detail.header.preferredName} can request another campaign starting{' '}
                <b>{next.earliest}</b>.
              </p>
            ) : null}
            <Group>
              <Row label="Required waiting period">{next.wait ?? <Missing />}</Row>
              <Row label="Proovd readiness" helper={next.readinessNote}>
                {next.readiness}
              </Row>
            </Group>
            {next.canApprove || next.canRemoveApproval ? (
              <Actions>
                {next.canApprove ? (
                  <Button
                    tier="secondary"
                    onClick={(event) => actions.confirm('campapprove', event.currentTarget)}
                  >
                    Approve for another campaign
                  </Button>
                ) : null}
                {next.canRemoveApproval ? (
                  <Button
                    tier="tertiary"
                    onClick={(event) => actions.confirm('campunapprove', event.currentTarget)}
                  >
                    Remove next-campaign approval
                  </Button>
                ) : null}
              </Actions>
            ) : null}
          </>
        ) : null}
      </section>
    </>
  );
}

function CampaignReview({ ops }: { ops: OperationsView }) {
  const review = ops.review;
  return (
    <>
      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Review state</SecTitle>
        <Group>
          <Row label="Campaign setup">{review.buildStatus ?? <Missing />}</Row>
          <Row label="Roster readiness">{review.rosterReadiness ?? <Missing />}</Row>
          <Row label="Approved">{review.approvedAt ?? 'Not approved yet'}</Row>
        </Group>

        <SecTitle>Review rounds</SecTitle>
        {review.rounds.length === 0 ? (
          <p className="grey">No round has been submitted yet.</p>
        ) : (
          review.rounds.map((round) => (
            <Block key={round.round}>
              <p>
                <b>Round {round.round}</b> — {round.outcome.replace(/_/g, ' ')}
              </p>
              <p className="helper">
                Submitted {round.submittedAt}
                {round.decidedAt ? ` · decided ${round.decidedAt}` : ' · not decided yet'}
              </p>
            </Block>
          ))
        )}

        {review.feedback.length > 0 ? (
          <>
            <SecTitle>Recorded feedback — latest round</SecTitle>
            <Group>
              {review.feedback.map((item, index) => (
                <Row
                  key={`${item.group}-${index}`}
                  label={item.group === 'required' ? 'Required before resubmission' : 'Optional improvement'}
                >
                  {item.text}
                </Row>
              ))}
            </Group>
          </>
        ) : null}

        <Refusal control="Mark reviewed / Approve campaign / Return changes" />
      </section>
    </>
  );
}

function CampaignLive({ ops }: { ops: OperationsView }) {
  const live = ops.live;
  return (
    <>
      <div className="fob-stats" data-scroll="rise">
        <div>
          <b>{live.created}</b>
          <span>Created</span>
        </div>
        <div>
          <b>{live.canceled}</b>
          <span>Canceled</span>
        </div>
        <div>
          <b>{live.conversion ?? '—'}</b>
          <span>Conversion{live.conversion === null ? ' · no valid clicks yet' : ''}</span>
        </div>
      </div>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Live campaign</SecTitle>
        <p className="helper">System-derived performance is read-only.</p>
        <Group>
          <Row label="Live at">{live.liveAt ?? 'Not live yet'}</Row>
          <Row label="Campaign day">
            {live.campaignDay === null ? <Missing /> : `Day ${live.campaignDay}`}
          </Row>
          <Row label="Closes">{live.closesAt ?? <Missing />}</Row>
          <Row label="Discovery">{live.discovery}</Row>
          <Row label="Valid clicks">{String(live.validClicks)}</Row>
          <Row label="Reserved subtotal">
            {live.reservedSubtotal ?? 'Nothing reserved yet'}
          </Row>
          <Row label="Founder updates">{String(live.updatesCount)}</Row>
          <Row label="Comments">{String(live.commentsCount)}</Row>
        </Group>
        {live.publicUrl ? (
          <Actions>
            <a
              className="btn btn--secondary"
              href={live.publicUrl}
              target="_blank"
              rel="noreferrer"
            >
              <span className="btn__label">View live campaign</span>
            </a>
          </Actions>
        ) : null}
      </section>

      {live.threshold ? (
        <section className="fob-panel" data-scroll="rise">
          <SecTitle>Idea live progress</SecTitle>
          <p className="helper">
            No Product refund, fixed-payment, access-evidence, or Product Day-14 control renders.
          </p>
          <Group>
            <Row label="Threshold">{String(live.threshold.required)}</Row>
            <Row label="Unique active Backers">{String(live.threshold.active)}</Row>
            <Row label="Remaining">{String(live.threshold.remaining)}</Row>
            <Row label="Threshold state">{live.threshold.state}</Row>
          </Group>
        </section>
      ) : null}
    </>
  );
}

function CampaignPage({ ops }: { ops: OperationsView }) {
  const page = ops.page;
  return (
    <>
      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Founder updates</SecTitle>
        {page.updates.length === 0 ? (
          <p className="grey">No update has been published yet.</p>
        ) : (
          page.updates.map((update) => (
            <Block key={`${update.title}-${update.publishedAt}`}>
              <p className="camp-block__name">
                <b>{update.title}</b> <Tag>{update.audience}</Tag>
              </p>
              <p>{update.body}</p>
              <p className="helper">
                Published {update.publishedAt}
                {update.materialChange ? ' · material delivery change' : ''}
              </p>
            </Block>
          ))
        )}
        {page.updatesCount > page.updates.length ? (
          <p className="helper">
            Showing {page.updates.length} of {page.updatesCount} updates.
          </p>
        ) : null}
      </section>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Comments &amp; moderation</SecTitle>
        <Note>{COMMENTS_NEVER_REWRITTEN}</Note>
        {page.comments.length === 0 ? (
          <p className="grey">No comments yet.</p>
        ) : (
          page.comments.map((comment) => (
            <Block key={`${comment.author}-${comment.postedAt}`}>
              <p className="camp-block__name">
                <b>{comment.author}</b> <Tag>{comment.state}</Tag>
              </p>
              <p>“{comment.body}”</p>
              <p className="helper">{comment.postedAt}</p>
            </Block>
          ))
        )}
        {page.openFlags > 0 ? (
          <p>
            <b>
              {page.openFlags} open comment {page.openFlags === 1 ? 'flag' : 'flags'} — a person
              decides each one.
            </b>
          </p>
        ) : null}
        {page.commentsCount > page.comments.length ? (
          <p className="helper">
            Showing {page.comments.length} of {page.commentsCount} comments.
          </p>
        ) : null}
      </section>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Visual update requests</SecTitle>
        <p className="grey">
          No visual update request record exists — uploads are not configured (Track A4), and a
          Founder&apos;s ask to replace a visual arrives through support and lives on the case.
        </p>
      </section>
    </>
  );
}

/* ── Affiliates ────────────────────────────────────────────────────────────*/

export type AffiliatesTabKey = TabOf<'affiliates'>;

interface AffiliatesSectionProps {
  detail: FounderWorkspaceDetail;
  tab: AffiliatesTabKey;
  onTab: (next: AffiliatesTabKey) => void;
}

export function AffiliatesSection({ detail, tab, onTab }: AffiliatesSectionProps) {
  const ops = detail.operations;
  const hero = !ops
    ? `${detail.header.preferredName} has no campaign yet`
    : tab === 'relationships'
      ? `${ops.rosterCounts.total} ${ops.rosterCounts.total === 1 ? 'Affiliate' : 'Affiliates'} on this campaign`
      : tab === 'requests'
        ? ops.workAgain.length > 0
          ? `${ops.workAgain.length} work-again ${ops.workAgain.length === 1 ? 'request' : 'requests'} recorded`
          : 'Nothing is waiting on Admin'
        : `${ops.rosterCounts.backersBroughtIn} Backers brought in by ${ops.rosterCounts.total} ${ops.rosterCounts.total === 1 ? 'Affiliate' : 'Affiliates'}`;

  return (
    <Scaffold section="affiliates" ariaLabel="Affiliate record" tab={tab} onTab={onTab} hero={hero}>
      {!ops ? (
        <NoCampaign
          detail={detail}
          owns="Affiliate relationships — an Affiliate relationship is campaign-specific, so they"
        />
      ) : tab === 'relationships' ? (
        <AffiliateRelationships ops={ops} />
      ) : tab === 'requests' ? (
        <AffiliateRequests ops={ops} />
      ) : (
        <AffiliatePerformance ops={ops} />
      )}
    </Scaffold>
  );
}

function AffiliateRelationships({ ops }: { ops: OperationsView }) {
  return (
    <>
      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Roster</SecTitle>
        {ops.roster.length === 0 ? (
          <p className="grey">No Affiliate has been matched to this campaign yet.</p>
        ) : (
          ops.roster.map((relationship) => (
            <Block key={relationship.associationId}>
              <p className="camp-block__name">
                <b>{relationship.name}</b>{' '}
                {relationship.handle ? (
                  <span className="grey">@{relationship.handle.replace(/^@/, '')}</span>
                ) : null}{' '}
                <Tag>{relationship.statusLabel}</Tag>
              </p>
              <Group>
                <Row label="Terms">{relationship.terms}</Row>
                <Row label="Backers brought in">{String(relationship.backers)}</Row>
                <Row label="Valid clicks">{String(relationship.validClicks)}</Row>
                {relationship.launchRequired !== null ? (
                  <Row label="Required for launch">
                    {relationship.launchRequired ? 'Yes' : 'No'}
                  </Row>
                ) : null}
                {relationship.completion ? (
                  <Row label="Completion">{relationship.completion}</Row>
                ) : null}
              </Group>
              <Actions>
                <RouterLink
                  className="btn btn--secondary"
                  to={`/admin/creators/${relationship.prospectId}/relationships/${relationship.associationId}`}
                >
                  <span className="btn__label">Open relationship</span>
                </RouterLink>
                <RouterLink
                  className="btn btn--tertiary"
                  to={`/admin/creators/${relationship.prospectId}`}
                >
                  <span className="btn__label">View Affiliate record</span>
                </RouterLink>
              </Actions>
            </Block>
          ))
        )}
        <Actions>
          <RouterLink
            className="btn btn--tertiary"
            to={`/admin/creators?q=${encodeURIComponent(ops.campaignName)}`}
          >
            <span className="btn__label">Add Affiliate match in the Creators workspace</span>
          </RouterLink>
        </Actions>
        <Refusal control="Record a proposal acceptance, counter, or decline for either side" />
        <Refusal control="Set a Creator bonus" />
      </section>
    </>
  );
}

function AffiliateRequests({ ops }: { ops: OperationsView }) {
  return (
    <>
      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Work-again requests</SecTitle>
        {ops.workAgain.length === 0 ? (
          <p className="grey">No work-again request has been recorded on this campaign.</p>
        ) : (
          ops.workAgain.map((request) => (
            <Block key={`${request.creatorName}-${request.requestedAt}`}>
              <p className="camp-block__name">
                <b>{request.creatorName}</b> <Tag>{request.status}</Tag>
              </p>
              {request.message ? <p>“{request.message}”</p> : null}
              <p className="helper">
                Requested {request.requestedAt}
                {request.respondedAt ? ` · responded ${request.respondedAt}` : ''}
              </p>
              {request.responseNote ? <p className="helper">“{request.responseNote}”</p> : null}
            </Block>
          ))
        )}
        <Note>{MEDIATED_REQUESTS_ABSENT}</Note>
        <Actions>
          <RouterLink className="btn btn--tertiary" to="/admin/support">
            <span className="btn__label">Open Support</span>
          </RouterLink>
        </Actions>
      </section>
    </>
  );
}

function AffiliatePerformance({ ops }: { ops: OperationsView }) {
  const ranked = [...ops.roster].sort((a, b) => b.backers - a.backers);
  return (
    <>
      <div className="fob-stats" data-scroll="rise">
        <div>
          <b>{ops.rosterCounts.total}</b>
          <span>Affiliates on this campaign</span>
        </div>
        <div>
          <b>{ops.rosterCounts.backersBroughtIn}</b>
          <span>Backers brought in</span>
        </div>
        <div>
          <b>{ops.rosterCounts.validClicks}</b>
          <span>Valid clicks</span>
        </div>
      </div>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Performance on this campaign</SecTitle>
        <p className="helper">
          Ranked by Backers brought in. Deep Affiliate analytics live in the Affiliate record.
        </p>
        {ranked.length === 0 ? (
          <p className="grey">No Affiliate has been matched to this campaign yet.</p>
        ) : (
          <Group>
            {ranked.map((relationship, index) => (
              <Row
                key={relationship.associationId}
                label={`${index + 1} · ${relationship.name}`}
              >
                {relationship.backers} Backers · {relationship.validClicks} clicks ·{' '}
                {relationship.terms}
              </Row>
            ))}
          </Group>
        )}
      </section>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Completion and work again</SecTitle>
        {ranked.length === 0 ? (
          <p className="grey">Nothing to complete yet.</p>
        ) : (
          <Group>
            {ranked.map((relationship) => (
              <Row key={relationship.associationId} label={relationship.name}>
                {relationship.completion ?? 'Not decided yet'}
                {relationship.workAgain ? ` · work again: ${relationship.workAgain}` : ''}
              </Row>
            ))}
          </Group>
        )}
        <Refusal control="Send a work-again request" />
      </section>
    </>
  );
}

/* ── Backers & Demand ──────────────────────────────────────────────────────*/

export type BackersTabKey = TabOf<'backers'>;

interface BackersSectionProps {
  detail: FounderWorkspaceDetail;
  tab: BackersTabKey;
  onTab: (next: BackersTabKey) => void;
}

export function BackersSection({ detail, tab, onTab }: BackersSectionProps) {
  const ops = detail.operations;
  const hero = !ops
    ? `${detail.header.preferredName} has no campaign yet`
    : tab === 'demand'
      ? `${ops.live.active} active Backers`
      : tab === 'responses'
        ? `${ops.responses.total} recorded ${ops.responses.total === 1 ? 'response' : 'responses'}`
        : `${ops.backerRows.total} ${ops.backerRows.total === 1 ? 'pre-order' : 'pre-orders'} recorded`;

  return (
    <Scaffold section="backers" ariaLabel="Backer demand record" tab={tab} onTab={onTab} hero={hero}>
      {!ops ? (
        <NoCampaign
          detail={detail}
          owns="Demand, responses, pre-orders, and payment outcomes"
        />
      ) : tab === 'demand' ? (
        <BackersDemand ops={ops} />
      ) : tab === 'responses' ? (
        <BackersResponses ops={ops} />
      ) : (
        <BackersRows ops={ops} />
      )}
    </Scaffold>
  );
}

function BackersDemand({ ops }: { ops: OperationsView }) {
  const live = ops.live;
  return (
    <>
      <div className="fob-stats" data-scroll="rise">
        <div>
          <b>{live.active}</b>
          <span>Backers</span>
        </div>
        <div>
          <b>{live.validClicks}</b>
          <span>Valid clicks</span>
        </div>
        <div>
          <b>{live.conversion ?? '—'}</b>
          <span>Conversion{live.conversion === null ? ' · no valid clicks yet' : ''}</span>
        </div>
      </div>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Attribution</SecTitle>
        <p className="helper">Generated from valid tracking and pre-order events.</p>
        <Group>
          {ops.demand.split.map((source) => (
            <Row key={source.label} label={source.label}>
              {source.label === 'Direct & organic'
                ? `${source.backers} Backers — a pre-order with no winning Creator link`
                : `${source.clicks} valid clicks · ${source.backers} Backers`}
            </Row>
          ))}
          <Row label="Reserved subtotal">{live.reservedSubtotal ?? 'Nothing reserved yet'}</Row>
        </Group>
      </section>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Drop-off feedback</SecTitle>
        <p className="grey">
          No cancellation-reason record exists — a Backer who cancels is not asked why, and this
          panel will not invent a reason distribution from data nobody collected.
        </p>
      </section>
    </>
  );
}

function BackersResponses({ ops }: { ops: OperationsView }) {
  return (
    <section className="fob-panel" data-scroll="rise">
      <SecTitle>Checkout responses</SecTitle>
      <p className="helper">
        Original answers remain immutable. What may leave this screen respects the Backer&apos;s
        own consent — each row carries it.
      </p>
      {ops.responses.rows.length === 0 ? (
        <p className="grey">No survey response has been recorded yet.</p>
      ) : (
        ops.responses.rows.map((response, index) => (
          <Block key={`${response.backer}-${index}`}>
            <p className="camp-block__name">
              <b>{response.backer}</b> <span className="grey">· {response.reward}</span>{' '}
              <Tag>{response.consent}</Tag>
            </p>
            {response.why ? <p>“{response.why}”</p> : null}
            <p className="helper">
              {response.status}
              {response.recommend !== null ? ` · recommend ${response.recommend}/5` : ''}
            </p>
          </Block>
        ))
      )}
      {ops.responses.total > ops.responses.rows.length ? (
        <p className="helper">
          Showing {ops.responses.rows.length} of {ops.responses.total} responses.
        </p>
      ) : null}
      <Refusal control="Export the audit trail or the response dataset" />
    </section>
  );
}

function BackersRows({ ops }: { ops: OperationsView }) {
  return (
    <section className="fob-panel" data-scroll="rise">
      <SecTitle>Backers</SecTitle>
      {ops.backerRows.rows.length === 0 ? (
        <p className="grey">No pre-order has been recorded yet.</p>
      ) : (
        ops.backerRows.rows.map((row, index) => (
          <Block key={`${row.backer}-${index}`}>
            <p className="camp-block__name">
              <b>{row.backer}</b> <span className="grey">· {row.reward}</span>{' '}
              <Tag>{row.status}</Tag>
            </p>
            <p className="helper">
              Created {row.createdAt} · {row.attribution}
              {row.caseRef ? ' · ' : ''}
              {row.caseRef && row.caseId ? (
                <RouterLink to={`/admin/support/${row.caseId}`}>{row.caseRef}</RouterLink>
              ) : null}
            </p>
          </Block>
        ))
      )}
      {ops.backerRows.total > ops.backerRows.rows.length ? (
        <p className="helper">
          Showing {ops.backerRows.rows.length} of {ops.backerRows.total} pre-orders.
        </p>
      ) : null}
      <Actions>
        <RouterLink
          className="btn btn--secondary"
          to={`/admin/backers?view=backers&campaignId=${encodeURIComponent(ops.campaignId)}`}
        >
          <span className="btn__label">Open Backers workspace</span>
        </RouterLink>
      </Actions>
    </section>
  );
}

/* ── Money & Fulfillment ───────────────────────────────────────────────────*/

export type MoneyTabKey = TabOf<'money'>;

interface MoneySectionProps {
  detail: FounderWorkspaceDetail;
  tab: MoneyTabKey;
  onTab: (next: MoneyTabKey) => void;
}

export function MoneySection({ detail, tab, onTab }: MoneySectionProps) {
  const ops = detail.operations;
  const payments = detail.money.payments;

  const hero = !ops
    ? `${detail.header.preferredName} has no campaign yet`
    : tab === 'close'
      ? ops.close.batch
        ? ops.close.batch.completedAt
          ? 'The close batch has run'
          : 'Close batch in progress'
        : ops.close.scheduledClose
          ? `Scheduled to close ${ops.close.scheduledClose}`
          : 'No close scheduled yet'
      : payments.populated
        ? 'Money decisions have records'
        : 'Nothing is due yet';

  return (
    <Scaffold section="money" ariaLabel="Money record" tab={tab} onTab={onTab} hero={hero}>
      {!ops ? (
        <NoCampaign
          detail={detail}
          owns="Payment, fulfillment, refund, dispute, and recovery records"
        />
      ) : tab === 'close' ? (
        <MoneyClose ops={ops} />
      ) : tab === 'payments' ? (
        <MoneyPayments detail={detail} />
      ) : tab === 'fulfillment' ? (
        <MoneyFulfillment ops={ops} />
      ) : (
        <MoneyRefunds ops={ops} />
      )}
    </Scaffold>
  );
}

function MoneyClose({ ops }: { ops: OperationsView }) {
  const close = ops.close;
  return (
    <>
      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Campaign close</SecTitle>
        <p className="helper">Scheduled, actual, outcome, capture, and reconciliation.</p>
        <Group>
          <Row label="Scheduled close">{close.scheduledClose ?? <Missing />}</Row>
          <Row label="Close batch">
            {close.batch
              ? `${close.batch.status} · started ${close.batch.startedAt}${close.batch.completedAt ? ` · completed ${close.batch.completedAt}` : ''}`
              : 'Not yet'}
          </Row>
          <Row label="Outcome">{close.batch ? close.batch.outcome : 'Pending close'}</Row>
          {close.finalActive !== null ? (
            <Row label="Final active">{String(close.finalActive)}</Row>
          ) : null}
          {close.canceledExcluded !== null ? (
            <Row label="Canceled excluded">{String(close.canceledExcluded)}</Row>
          ) : null}
          <Row label="Capture state">{close.captureState}</Row>
          {close.retryWindow ? <Row label="Retry window">{close.retryWindow}</Row> : null}
          <Row label="Reconciliation">{close.reconciliation}</Row>
          <Row label="Results">
            {close.resultsPreparedAt
              ? `Prepared ${close.resultsPreparedAt}`
              : 'Not prepared yet'}
          </Row>
        </Group>
      </section>

      {close.idea ? (
        <section className="fob-panel" data-scroll="rise">
          <SecTitle>Idea close</SecTitle>
          <p className="helper">No Product first/remaining-payment pathway renders.</p>
          <Group>
            <Row label="Threshold">
              {close.idea.threshold === null ? 'No threshold recorded' : String(close.idea.threshold)}
            </Row>
            <Row label="Final unique active Backers">
              {close.idea.finalActive === null ? 'Not final' : String(close.idea.finalActive)}
            </Row>
            <Row label="State">{close.idea.state}</Row>
          </Group>
        </section>
      ) : (
        <section className="fob-panel" data-scroll="rise">
          <SecTitle>Product close</SecTitle>
          <p className="helper">
            No Idea threshold control renders. The first and remaining payments are on the
            Payments tab, read from the one §22.3 resolver.
          </p>
        </section>
      )}
    </>
  );
}

function MoneyPayments({ detail }: { detail: FounderWorkspaceDetail }) {
  const money = detail.money;
  const payments = money.payments;
  return (
    <>
      <section className="fob-panel" data-scroll="rise">
        <SecTitle>W-9</SecTitle>
        <p>
          <b>{money.w9.value}</b>
        </p>
        <Note>{money.w9.line}</Note>
        <Refusal control="Send a W-9 reminder" />
      </section>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Founder payments</SecTitle>
        {!payments.populated ? (
          <p className="grey">
            {payments.waitingOn ?? 'Nothing has reached the point of being payable yet.'}
          </p>
        ) : (payments.value ?? []).length === 0 ? (
          <p className="grey">No Founder payments yet.</p>
        ) : (
          (payments.value ?? []).map((payment) => (
            <Block key={`${payment.campaignName}-${payment.label}`}>
              <p className="helper">{payment.campaignName}</p>
              <p className="camp-block__name">
                <b>{payment.amount}</b> <span className="grey">· {payment.label}</span>
              </p>
              <p>
                <b>{payment.status}</b>
              </p>
              <Note>{payment.line}</Note>
            </Block>
          ))
        )}
        <Refusal control="Approve, hold, or release a Founder payment" />
      </section>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Payment blockers</SecTitle>
        {money.blockers.length === 0 ? (
          <p className="grey">
            <b>Nothing is blocked.</b>
          </p>
        ) : (
          money.blockers.map((blocker) => (
            <div className="att-box" key={`${blocker.reason}-${blocker.state}`}>
              <p>
                <b>
                  {blocker.amount ? `${blocker.amount} ` : ''}
                  {blocker.state}
                </b>
              </p>
              <Group>
                <Row label="Reason">{blocker.reason}</Row>
                <Row label="Owner">{blocker.owner}</Row>
                <Row label="Action">{blocker.action}</Row>
                {blocker.nextReview ? <Row label="Next review">{blocker.nextReview}</Row> : null}
              </Group>
            </div>
          ))
        )}
      </section>

      {money.pricing ? (
        <section className="fob-panel" data-scroll="rise">
          <SecTitle>Creator pricing eligibility</SecTitle>
          <p>
            <b>{money.pricing.value}</b>
          </p>
          {money.pricing.reasons ? (
            <ul className="plain-list">
              {money.pricing.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          {money.pricing.note ? <Note>{money.pricing.note}</Note> : null}
        </section>
      ) : null}
    </>
  );
}

function MoneyFulfillment({ ops }: { ops: OperationsView }) {
  const fulfillment = ops.fulfillment;
  if (!fulfillment.available) {
    return (
      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Fulfillment unavailable</SecTitle>
        <p className="grey">{fulfillment.waitingOn}</p>
        {/* True in both states — the decision console is absent whether or
            not a fulfillment record exists yet. */}
        <Refusal control="Decide a Day-14 review or a fulfillment evidence request" />
      </section>
    );
  }
  return (
    <>
      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Fulfillment</SecTitle>
        <Group>
          <Row label="Mechanism">{fulfillment.mechanism ?? <Missing />}</Row>
          <Row label="Delivered">{fulfillment.deliveredAt ?? 'Not delivered yet'}</Row>
          {fulfillment.obligations.map((obligation) => (
            <Row key={obligation.label} label={obligation.label}>
              {obligation.state}
              {obligation.dueAt ? ` · due ${obligation.dueAt}` : ''}
            </Row>
          ))}
        </Group>
      </section>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Delivery commitments</SecTitle>
        <p className="helper">Original and revised commitments remain visible together.</p>
        {fulfillment.commitments.length === 0 ? (
          <p className="grey">No commitment recorded yet.</p>
        ) : (
          <Group>
            {fulfillment.commitments.map((commitment) => (
              <Row
                key={commitment.sequence}
                label={commitment.original ? 'Original promise' : `Revision ${commitment.sequence}`}
              >
                {commitment.month} — {commitment.text}
              </Row>
            ))}
          </Group>
        )}
        <Refusal control="Decide a Day-14 review or a fulfillment evidence request" />
      </section>
    </>
  );
}

function MoneyRefunds({ ops }: { ops: OperationsView }) {
  const refunds = ops.refunds;
  const nothing =
    refunds.totalRefunds === 0 && refunds.totalDisputes === 0 && refunds.recoveryRecords === 0;
  return (
    <section className="fob-panel" data-scroll="rise">
      <SecTitle>Refunds &amp; recovery</SecTitle>
      {nothing ? (
        <p className="grey">
          <b>No open case.</b> Cases appear only from real charge, dispute, support, or
          enforcement events.
        </p>
      ) : (
        <Group>
          <Row label="Open refunds">{String(refunds.openRefunds)}</Row>
          <Row label="All refund records">{String(refunds.totalRefunds)}</Row>
          <Row label="Open disputes">{String(refunds.openDisputes)}</Row>
          <Row label="All dispute records">{String(refunds.totalDisputes)}</Row>
          <Row label="Recovery records">{String(refunds.recoveryRecords)}</Row>
        </Group>
      )}
    </section>
  );
}

/* ── Support & Enforcement ─────────────────────────────────────────────────*/

export type SupportTabKey = TabOf<'support'>;

interface SupportSectionProps {
  detail: FounderWorkspaceDetail;
  tab: SupportTabKey;
  onTab: (next: SupportTabKey) => void;
}

export function SupportSection({ detail, tab, onTab }: SupportSectionProps) {
  const ops = detail.operations;
  const openCases = ops ? ops.supportCases.filter((c) => c.status !== 'Resolved').length : 0;

  const hero = !ops
    ? `${detail.header.preferredName} has no campaign yet`
    : tab === 'support'
      ? `${openCases} open ${openCases === 1 ? 'case' : 'cases'}`
      : tab === 'cancellation'
        ? ops.cancellation
          ? ops.cancellation.state
          : 'No open request'
        : ops.enforcement.campaignActions.length > 0 || detail.details.ban
          ? 'Enforcement has records'
          : 'No active restriction';

  return (
    <Scaffold
      section="support"
      ariaLabel="Support and enforcement record"
      tab={tab}
      onTab={onTab}
      hero={hero}
    >
      {!ops ? (
        <NoCampaign detail={detail} owns="Support cases, cancellation, and enforcement records" />
      ) : tab === 'support' ? (
        <SupportCases ops={ops} />
      ) : tab === 'cancellation' ? (
        <SupportCancellation detail={detail} ops={ops} />
      ) : (
        <SupportEnforcement detail={detail} ops={ops} />
      )}
    </Scaffold>
  );
}

function SupportCases({ ops }: { ops: OperationsView }) {
  return (
    <section className="fob-panel" data-scroll="rise">
      <SecTitle>Support cases</SecTitle>
      {ops.supportCases.length === 0 ? (
        <p className="grey">No case has been opened for this Founder.</p>
      ) : (
        ops.supportCases.map((supportCase) => (
          <Block key={supportCase.caseId}>
            <p className="camp-block__name">
              <b>{supportCase.reference}</b>{' '}
              {supportCase.subject ? <span className="grey">· {supportCase.subject}</span> : null}{' '}
              <Tag>{supportCase.status}</Tag>
            </p>
            <p className="helper">
              Owner — {supportCase.owner}
              {supportCase.due ? ` · ${supportCase.due}` : ''}
            </p>
            <Actions>
              <RouterLink
                className="btn btn--tertiary"
                to={`/admin/support/${supportCase.caseId}`}
              >
                <span className="btn__label">Open support case</span>
              </RouterLink>
            </Actions>
          </Block>
        ))
      )}
      <Actions>
        <RouterLink className="btn btn--secondary" to="/admin/support">
          <span className="btn__label">Open the Support workspace</span>
        </RouterLink>
      </Actions>
      <p className="helper">
        A new case is opened from the Support workspace, which owns the intake, the owner, and
        the response promise.
      </p>
    </section>
  );
}

function SupportCancellation({
  detail,
  ops,
}: {
  detail: FounderWorkspaceDetail;
  ops: OperationsView;
}) {
  const cancellation = ops.cancellation;
  return (
    <section className="fob-panel" data-scroll="rise">
      <SecTitle>Cancellation</SecTitle>
      {!cancellation ? (
        <>
          <p className="grey">
            <b>No request.</b> Cancellation consequences and approval controls appear only after
            a Founder-owned request exists.
          </p>
          <Group>
            <Row label="Campaign">{ops.campaignName}</Row>
            <Row label="Campaign state">{ops.statusLabel}</Row>
            <Row label="Backer consequence">Not applicable</Row>
          </Group>
        </>
      ) : (
        <Group>
          <Row label="Request state">{cancellation.state}</Row>
          <Row label="Path">{cancellation.kind ?? <Missing />}</Row>
          <Row label="Requested">{cancellation.requestedAt ?? <Missing />}</Row>
          <Row label="Decided">{cancellation.decidedAt ?? 'Not decided yet'}</Row>
          {cancellation.customerExplanation ? (
            <Row label="Customer explanation">{cancellation.customerExplanation}</Row>
          ) : null}
        </Group>
      )}
      {cancellation && cancellation.state === 'Pending decision' ? (
        <p className="helper">
          The decision is recorded through the §31.6 review, whose Admin screen is not built
          yet — the request stays visibly pending here until a person decides it.
        </p>
      ) : null}
      {detail.details.standing.detail ? (
        <Note>{detail.details.standing.detail}</Note>
      ) : null}
    </section>
  );
}

function SupportEnforcement({
  detail,
  ops,
}: {
  detail: FounderWorkspaceDetail;
  ops: OperationsView;
}) {
  const ban = detail.details.ban;
  return (
    <>
      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Suspension, kill &amp; ban</SecTitle>
        <p className="helper">Sensitive actions are audited and never shown as a vague block.</p>
        <Group>
          <Row label="Account standing">{detail.details.standing.value}</Row>
          <Row label="Campaign enforcement">
            {ops.enforcement.campaignActions.length === 0
              ? 'No campaign suspension or kill recorded'
              : `${ops.enforcement.campaignActions.length} recorded ${ops.enforcement.campaignActions.length === 1 ? 'action' : 'actions'}`}
          </Row>
          <Row label="Founder ban">{ban ? 'Banned — permanent' : 'Not banned'}</Row>
        </Group>
        {ban ? (
          <Block>
            <p>
              <b>{ban.trigger}</b>
            </p>
            <p className="helper">Decided {ban.decidedAt}</p>
            <p>{ban.notice}</p>
          </Block>
        ) : null}
        <p className="helper">
          Account-level suspension, restore, and the ban are recorded from this record&apos;s
          header under <b>Account actions</b>, each behind its own gate.
        </p>
        <Refusal control="Suspend or kill the campaign from this record" />
        <Refusal control="Send warning" />
      </section>

      {ops.enforcement.campaignActions.length > 0 ? (
        <section className="fob-panel" data-scroll="rise">
          <SecTitle>Recorded campaign actions</SecTitle>
          {ops.enforcement.campaignActions.map((action, index) => (
            <Block key={`${action.action}-${index}`}>
              <p className="camp-block__name">
                <b>{action.action}</b> <Tag>{action.phase}</Tag>
              </p>
              <Group>
                <Row label="Category">{action.category}</Row>
                <Row label="Customer explanation">{action.customerExplanation}</Row>
                <Row label="Recorded">{action.occurredAt}</Row>
              </Group>
            </Block>
          ))}
        </section>
      ) : null}
    </>
  );
}

/* ── History ───────────────────────────────────────────────────────────────*/

export type HistoryTabKey = TabOf<'history'>;

interface HistorySectionProps {
  detail: FounderWorkspaceDetail;
  tab: HistoryTabKey;
  onTab: (next: HistoryTabKey) => void;
  /** The record's ONE internal-note write — the header's meeting-note dialog. */
  onAddNote: (trigger: HTMLElement | null) => void;
}

export function HistorySection({ detail, tab, onTab, onAddNote }: HistorySectionProps) {
  const hero =
    tab === 'timeline'
      ? `${detail.history.length} recorded ${detail.history.length === 1 ? 'event' : 'events'}`
      : `${detail.communications.total} ${detail.communications.total === 1 ? 'message' : 'messages'} recorded`;

  return (
    <Scaffold section="history" ariaLabel="History record" tab={tab} onTab={onTab} hero={hero}>
      {tab === 'timeline' ? (
        <>
          <Actions>
            <Button
              tier="secondary"
              onClick={(event) => onAddNote(event.currentTarget)}
            >
              Add internal note
            </Button>
          </Actions>
          <p className="helper">
            A note explains what happened around an immutable event — it is the same meeting-note
            record the header writes, and it lands on this timeline as an Admin change.
          </p>
          <TimelineBody detail={detail} />
          <Refusal control="Export the audit trail or the response dataset" />
        </>
      ) : (
        <Communications detail={detail} />
      )}
    </Scaffold>
  );
}

/**
 * The activity feed — the 2026-08-16 History pane's body, absorbed into the
 * section's Timeline tab (Session C). The chips are counts the server sent;
 * the plain line and the §25.6 audit record stay two different things; the
 * filter result is announced (§28.5).
 */
function TimelineBody({ detail }: { detail: FounderWorkspaceDetail }) {
  const [filter, setFilter] = useState<string>('all');
  const entries = detail.history;

  const chips = useMemo(
    () =>
      FOUNDER_HISTORY_CATEGORIES.map((category) => ({
        key: category.key,
        label: category.label,
        count:
          category.key === 'all' ? entries.length : (detail.historyCounts[category.key] ?? 0),
      })).filter((chip) => chip.key === 'all' || chip.count > 0),
    [entries.length, detail.historyCounts],
  );

  const shown = useMemo(
    () => (filter === 'all' ? entries : entries.filter((entry) => entry.category === filter)),
    [entries, filter],
  );

  return (
    <>
      <SecTitle>Activity</SecTitle>

      <div className="filters">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={cn('filter-tag', filter === chip.key && 'is-active')}
            aria-pressed={filter === chip.key}
            onClick={() => setFilter(chip.key)}
          >
            {chip.label}
            {chip.key === 'all' ? ` · ${chip.count}` : ''}
          </button>
        ))}
      </div>

      <p className="helper" role="status">
        Showing {shown.length} of {entries.length} recorded events.
      </p>

      {shown.length === 0 ? (
        <p className="grey">Nothing recorded under this filter yet.</p>
      ) : (
        <Timeline>
          {shown.map((entry) => (
            <TimelineRow
              key={`${entry.occurredAt}-${entry.title}-${entry.source}`}
              at={entry.at}
              title={entry.title}
              body={entry.body}
            >
              {entry.reason ? <p className="helper">Reason — {entry.reason}</p> : null}
              {entry.audit ? (
                <Expandable label="Technical details" small>
                  <Group>
                    <Row label="Changed by">{entry.audit.by}</Row>
                    <Row label="Field">{entry.audit.field}</Row>
                    <Row label="Previous value">{entry.audit.priorValue}</Row>
                    <Row label="New value">{entry.audit.newValue}</Row>
                    <Row label="Reason">{entry.audit.reason}</Row>
                    <Row label="Evidence">{entry.audit.evidence}</Row>
                    <Row label="Time">{entry.audit.at}</Row>
                    <Row label="Read from">{entry.source}</Row>
                  </Group>
                </Expandable>
              ) : null}
            </TimelineRow>
          ))}
        </Timeline>
      )}

      <Note>{HISTORY_AUDIT_NOTE}</Note>
    </>
  );
}

function Communications({ detail }: { detail: FounderWorkspaceDetail }) {
  const communications = detail.communications;
  return (
    <section className="fob-panel" data-scroll="rise">
      <SecTitle>Communication history</SecTitle>
      {communications.rows.length === 0 ? (
        <p className="grey">Nothing has been sent to this address yet.</p>
      ) : (
        <Group>
          {communications.rows.map((row, index) => (
            <Row key={`${row.eventKey}-${index}`} label={describeNotification(row.eventKey)}>
              {row.target} · {row.state}
              {row.at ? ` · ${row.at}` : ''}
            </Row>
          ))}
        </Group>
      )}
      {communications.total > communications.rows.length ? (
        <p className="helper">
          Showing {communications.rows.length} of {communications.total} recorded messages.
        </p>
      ) : null}
      <Refusal control="Compose a Founder message" />
    </section>
  );
}

/**
 * 22c's rule: the payload carries the §27 KEY and the label resolves here from
 * the shared registry — a fourth copy of 123 descriptions would drift. An
 * unknown key renders as it came: a key with no registry entry means the
 * register and a sender disagree, and swallowing that would hide it.
 */
function describeNotification(eventKey: string): string {
  const definition = NOTIFICATION_EVENTS[eventKey as NotificationEventKey];
  return definition?.description ?? eventKey;
}
