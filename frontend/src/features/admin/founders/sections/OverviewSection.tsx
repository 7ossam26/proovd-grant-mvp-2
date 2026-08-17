/**
 * The record's Overview — Spec §26.1, §26.2, §27.1, §9, §10, §12, DNA §5.2;
 * built 2026-08-16 to the supplied reference.
 *
 * What needs attention now, the one decision to make, the Founder summary,
 * the current campaign at a glance, the latest activity, and the Admin-owned
 * discovery context with its meeting notes — in the reference's order.
 *
 * ── Three refusals live here, visibly ───────────────────────────────────────
 * The reference draws `Edit` on Problem, Solution, the Story, and a free-form
 * audience count. §9 makes the answers the Founder's own words (the prefill
 * moves only while the server says it may), §12 makes the Story's approval the
 * Founder's completing act, and 0042 replaced the audience count with a closed
 * range — so Problem/Solution offer the prefill edit exactly while
 * `answer.editable` is true and are read-only with provenance after, the
 * Story is not a row here at all (it is §12's optional item, Session B's
 * Onboarding tab), and the audience renders the recorded range with
 * `CREATOR_MATCH_CAVEAT` riding it.
 *
 * ── The hero never claims "real time" ───────────────────────────────────────
 * §30. The counts are what the server read when this page loaded, and the
 * quiet line says exactly that.
 */

import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  CREATOR_MATCH_CAVEAT,
  NO_ACTIVE_CAMPAIGN_LABEL,
  type AttentionAction,
} from '@proovd/shared';
import { Button } from '../../../../components/index.js';
import type { DiscoveryView, FounderWorkspaceDetail } from '../../api.js';
import {
  Actions,
  Group,
  Missing,
  Note,
  Row,
  SecTitle,
  Timeline,
  TimelineRow,
  type WorkspaceActions,
} from '../shared.js';
import { Details } from '../panes/Details.js';

export interface DiscoveryEditRequest {
  /** The `PUT …/:draftId/prospect` key this field writes through. */
  key: string;
  label: string;
  value: string | null;
  helper: string | null;
}

export interface OverviewSectionProps {
  detail: FounderWorkspaceDetail;
  actions: WorkspaceActions;
  /** Resolved by the shell: section jumps and the campaign-workspace route. */
  onAttentionAction: (act: AttentionAction, trigger: HTMLElement | null) => void;
  onOpenHistory: () => void;
  onAddMeetingNote: (trigger: HTMLElement | null) => void;
  onAddResearch: (trigger: HTMLElement | null) => void;
  onEditDiscovery: (field: DiscoveryEditRequest, trigger: HTMLElement | null) => void;
}

export function OverviewSection({
  detail,
  actions,
  onAttentionAction,
  onOpenHistory,
  onAddMeetingNote,
  onAddResearch,
  onEditDiscovery,
}: OverviewSectionProps) {
  const { header, overview, campaigns, money, discovery, campaignFacts, history } = detail;
  const attention = header.attention;
  const facts = campaignFacts;

  const subject = header.businessName ?? header.preferredName;

  /* ── The hero ─────────────────────────────────────────────────────────── */

  const heroHeadline = attention.needed
    ? attention.text
    : `Nothing is waiting on Proovd for ${subject}`;
  const heroBody = attention.needed
    ? header.adminAction.label
    : [
        `${header.lifecycle}.`,
        discovery.fields.find((f) => f.key === 'internalOwner')?.value
          ? `${discovery.fields.find((f) => f.key === 'internalOwner')?.value} owns this record internally.`
          : null,
        header.founderAction.kind === 'due'
          ? `The Founder’s own next step is: ${header.founderAction.label}.`
          : null,
      ]
        .filter(Boolean)
        .join(' ');

  const factsLine = facts
    ? [
        header.lifecycle,
        facts.activeBackers !== null
          ? `${facts.activeBackers} active pre-order${facts.activeBackers === 1 ? '' : 's'}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <>
      <section className="fov-hero" aria-labelledby="fov-hero-title">
        <p className="kicker">What needs your attention now?</p>
        <h2 className="h3" id="fov-hero-title">
          {heroHeadline}
        </h2>
        {heroBody ? <p className="fov-hero__body">{heroBody}</p> : null}
        {factsLine ? (
          <p className="fov-hero__facts">
            {factsLine}
            <span className="helper"> · Figures update when this page is refreshed</span>
          </p>
        ) : null}
      </section>

      {/* ── The decision card ─────────────────────────────────────────────── */}

      <section className="fov-decide" aria-label="Decision to make">
        {attention.needed ? (
          <>
            <p className="kicker">Decision to make</p>
            <h3>{attention.action?.label ?? header.adminAction.label}</h3>
            <p className="grey">{attention.text}</p>
            <Actions>
              {attention.action ? (
                <Button
                  small
                  onClick={(event) =>
                    onAttentionAction(attention.action!.act, event.currentTarget)
                  }
                >
                  {attention.action.label}
                </Button>
              ) : null}
              <Button
                tier="tertiary"
                small
                onClick={(event) =>
                  onEditDiscovery(
                    discoveryField(discovery, 'adminNotes'),
                    event.currentTarget,
                  )
                }
              >
                Add internal note
              </Button>
            </Actions>
          </>
        ) : (
          <>
            <p className="kicker">No Admin action due</p>
            <h3>{header.adminAction.label}</h3>
            <p className="grey">
              Nothing here is blocked. Open it only if you want current campaign context.
            </p>
            <Actions>
              {header.currentCampaign ? (
                <RouterLink
                  className="btn btn--secondary btn--sm"
                  to={`/admin/campaigns/${header.currentCampaign.campaignId}`}
                >
                  <span className="btn__label">Open the campaign record</span>
                </RouterLink>
              ) : null}
              <Button
                tier="tertiary"
                small
                onClick={(event) =>
                  onEditDiscovery(
                    discoveryField(discovery, 'adminNotes'),
                    event.currentTarget,
                  )
                }
              >
                Add internal note
              </Button>
            </Actions>
          </>
        )}
      </section>

      {/* ── Founder summary ───────────────────────────────────────────────── */}

      <SecTitle>Founder summary</SecTitle>
      <Note>The Founder’s own answers with their provenance, and where they are now.</Note>
      <Group>
        {overview.vetting.answers
          .filter((answer) => answer.key !== 'views')
          .map((answer) => (
            <Row
              key={answer.key}
              label={answer.label}
              helper={
                answer.provenance ??
                (answer.key === 'competition'
                  ? 'Written by the Founder. Never prefilled (§9).'
                  : null)
              }
            >
              {answer.text ?? <Missing>Not answered yet</Missing>}
              {answer.editable && overview.vetting.draftId ? (
                <Button
                  tier="secondary"
                  small
                  className="btn--edit"
                  aria-label={`Edit ${answer.label}`}
                  onClick={(event) =>
                    actions.editAnswer(
                      {
                        draftId: overview.vetting.draftId!,
                        key: answer.key as 'problem' | 'solution',
                        label: answer.label,
                        text: answer.text,
                      },
                      event.currentTarget,
                    )
                  }
                >
                  Edit
                </Button>
              ) : null}
            </Row>
          ))}
        {overview.vetting.answers
          .filter((answer) => answer.key === 'views')
          .map((answer) => (
            <Row key={answer.key} label={answer.label} helper={CREATOR_MATCH_CAVEAT}>
              {answer.text ?? <Missing>Not answered yet</Missing>}
            </Row>
          ))}
        <Row label="Account status">
          {header.account}
          {detail.details.standing.detail ? (
            <p className="helper">{detail.details.standing.detail}</p>
          ) : null}
        </Row>
        <SummaryFact label="Internal owner" value={fieldValue(discovery, 'internalOwner')} />
        <SummaryFact label="Discovery source" value={fieldValue(discovery, 'invitationSource')} />
        <Row label="Campaign type">{header.typeChip}</Row>
        <Row label="Campaign state">{header.lifecycle}</Row>
        <Row label="Account claim">
          {overview.accountCreatedAt ? `Claimed · ${overview.accountCreatedAt}` : 'Not claimed'}
        </Row>
        <Row label="Onboarding">
          {header.setup.stage}
          {header.setup.detail ? <p className="helper">{header.setup.detail}</p> : null}
        </Row>
        <Row label="Stripe">{header.paymentSetup}</Row>
        <Row label="Listing fee">
          {money.listings[0]?.status ?? <Missing>Not available yet</Missing>}
        </Row>
        <Row label="W-9">{money.w9.value}</Row>
        <Row label="Cooldown / next campaign">
          {campaigns.next?.wait ?? campaigns.next?.readiness ?? (
            <Missing>Not yet applicable</Missing>
          )}
        </Row>
      </Group>

      {/* ── Current campaign ──────────────────────────────────────────────── */}

      <section className="fov-campaign" aria-labelledby="fov-campaign-title">
        <SecTitle id="fov-campaign-title">Current campaign</SecTitle>
        {campaigns.current ? (
          <>
            <Note>One glance at campaign truth.</Note>
            <Group>
              <Row label="Campaign">{campaigns.current.name}</Row>
              <Row label="Campaign type">{campaigns.current.type}</Row>
              <Row label="Campaign state">{header.lifecycle}</Row>
              <Row label="Live at">
                {facts?.liveAt ?? <Missing>Not launched yet</Missing>}
              </Row>
              <Row label="Close">
                {facts?.closesAt ?? campaigns.current.closesAt ?? (
                  <Missing>Not scheduled yet</Missing>
                )}
              </Row>
              <Row label="Campaign day">
                {facts?.campaignDay !== null && facts?.campaignDay !== undefined ? (
                  `Day ${facts.campaignDay}`
                ) : (
                  <Missing>Not launched yet</Missing>
                )}
              </Row>
              <Row label="Public discovery">
                {facts?.discoveryOpenedAt ?? <Missing>Not opened yet</Missing>}
              </Row>
              <Row label="Active Backers">
                {facts?.activeBackers !== null && facts?.activeBackers !== undefined ? (
                  facts.activeBackers
                ) : (
                  <Missing>None can exist before launch</Missing>
                )}
              </Row>
              {facts?.threshold !== null && facts?.threshold !== undefined ? (
                <Row label="Progress">
                  {facts.activeBackers ?? 0} of {facts.threshold} unique active Backers
                </Row>
              ) : null}
              <Row label="Active Creators">
                {facts?.activeAffiliates !== null && facts?.activeAffiliates !== undefined ? (
                  facts.activeAffiliates
                ) : (
                  <Missing>None can exist before launch</Missing>
                )}
              </Row>
              <Row label="Current Admin action">
                <span className={header.adminAction.kind === 'due' ? 'fdir-due' : undefined}>
                  {header.adminAction.label}
                </span>
              </Row>
              <Row label="Current Founder action">
                <span
                  className={
                    header.founderAction.kind === 'due' ? 'fdir-due fdir-due--founder' : undefined
                  }
                >
                  {header.founderAction.label}
                </span>
              </Row>
            </Group>
            <Actions>
              <RouterLink
                className="btn btn--secondary btn--sm"
                to={`/admin/campaigns/${campaigns.current.campaignId}`}
              >
                <span className="btn__label">Open campaign</span>
              </RouterLink>
              {facts?.publicUrl ? (
                <a
                  className="btn btn--tertiary btn--sm"
                  href={facts.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="btn__label">View live campaign</span>
                </a>
              ) : null}
            </Actions>
          </>
        ) : (
          <p className="grey">{NO_ACTIVE_CAMPAIGN_LABEL}</p>
        )}
      </section>

      {/* ── Recent activity ───────────────────────────────────────────────── */}

      <SecTitle>Recent activity</SecTitle>
      <Note>The latest important events — not the whole ledger.</Note>
      {history.length === 0 ? (
        <p className="grey">Nothing has happened on this record yet.</p>
      ) : (
        <>
          <Timeline>
            {history.slice(0, 5).map((entry, index) => (
              <TimelineRow key={index} at={entry.at} title={entry.title} body={entry.body} />
            ))}
          </Timeline>
          <Actions>
            <Button tier="tertiary" small onClick={onOpenHistory}>
              View full timeline
            </Button>
          </Actions>
        </>
      )}

      {/* ── Discovery & internal context ───────────────────────────────────── */}

      <SecTitle>Discovery &amp; internal context</SecTitle>
      <Note>Admin-owned working context. Internal to Proovd; never rendered to the Founder.</Note>
      <Group>
        {discovery.fields.map((field) => (
          <div className="frow" key={field.label}>
            <dt>{field.label}</dt>
            <dd>
              {field.value ?? <Missing>Not recorded</Missing>}
              {field.key ? (
                <Button
                  tier="secondary"
                  small
                  className="btn--edit"
                  aria-label={`Edit ${field.label}`}
                  onClick={(event) =>
                    onEditDiscovery(
                      { key: field.key!, label: field.label, value: field.value, helper: field.helper },
                      event.currentTarget,
                    )
                  }
                >
                  Edit
                </Button>
              ) : null}
              {field.helper ? <p className="helper">{field.helper}</p> : null}
            </dd>
          </div>
        ))}
        <Row label="Research recorded">
          {discovery.research.length === 0 ? (
            <Missing>None recorded yet</Missing>
          ) : (
            <ul className="fov-research">
              {discovery.research.map((entry, index) => (
                <li key={index}>{entry}</li>
              ))}
            </ul>
          )}
        </Row>
        <Row label="Meeting notes recorded">
          {discovery.meetingNotes.length === 0 ? (
            <Missing>None on file yet</Missing>
          ) : (
            `${discovery.meetingNotes.length} on file`
          )}
        </Row>
      </Group>

      {discovery.meetingNotes.map((note) => (
        <article className="fov-note" key={note.id}>
          <p className="kicker">
            {note.meetingDate} · recorded by {note.recordedBy}
          </p>
          <p>
            <b>{note.decisions}</b>
          </p>
          <p className="grey">
            {note.participants} · follow-up: {note.followUp} · source: {note.sourceLink}
          </p>
          {note.notes ? <p className="grey">{note.notes}</p> : null}
        </article>
      ))}

      {/* ── Next best action ──────────────────────────────────────────────── */}

      <section className="fov-next" aria-label="Next best action">
        <p className="kicker">Next best action</p>
        <h3>A new off-platform conversation happened</h3>
        <p className="grey">
          Keep the decision, participants, follow-up, and source attached to this Founder.
        </p>
        <Actions>
          <Button small onClick={(event) => onAddMeetingNote(event.currentTarget)}>
            Add meeting note
          </Button>
          <Button tier="tertiary" small onClick={(event) => onAddResearch(event.currentTarget)}>
            Add research
          </Button>
        </Actions>
      </section>

      {/* ── Identity & preferences — the full record (DNA §5.2's Explore) ──── */}

      <SecTitle id="sec-identity">Identity &amp; preferences — the full record</SecTitle>
      <Note>
        Every registered field with its edit control, the account standing record, and any
        deletion request. The complete inventory, one gesture below the summary (DNA §5.14).
      </Note>
      <Details detail={detail} actions={actions} />
    </>
  );
}

/* ── Small pieces ───────────────────────────────────────────────────────────*/

function fieldValue(discovery: DiscoveryView, key: string): ReactNode {
  return discovery.fields.find((f) => f.key === key)?.value ?? null;
}

function discoveryField(discovery: DiscoveryView, key: string): DiscoveryEditRequest {
  const field = discovery.fields.find((f) => f.key === key);
  return {
    key,
    label: field?.label ?? key,
    value: field?.value ?? null,
    helper: field?.helper ?? null,
  };
}

function SummaryFact({ label, value }: { label: string; value: ReactNode }) {
  return <Row label={label}>{value ?? <Missing>Not recorded</Missing>}</Row>;
}
