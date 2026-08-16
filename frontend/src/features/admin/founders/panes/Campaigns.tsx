/**
 * Campaigns — what this Founder is running, what they have run, and whether
 * they may run another.
 *
 * ── The lifecycle value lives one gesture below its label ───────────────────
 * §3.1 forbids `pre_build`, `pre_launch`, and `reservation` reaching a person,
 * and an Admin surface is read aloud on support calls — so the human label is
 * the answer and `rawStatus` sits inside Technical details, exactly where the
 * reference put it. Both halves come from the server's register; nothing here
 * formats an enum.
 *
 * ── Next-campaign readiness is a recorded decision, not a countdown ─────────
 * §22.10's two gates are independent and derived at the point of use — the
 * waiting period is computed from the campaign's own immutable close instant
 * and the §6 setting, and the readiness review is a person's judgement. So the
 * only controls here record that judgement, and removing it requires the same
 * reason the approval never needed: an approval is a decision, withdrawing one
 * is a correction somebody will be asked about.
 */

import { Button, Tag } from '../../../../components/index.js';
import { Link as RouterLink } from 'react-router';
import type { CampaignSummary, FounderWorkspaceDetail } from '../../api.js';
import {
  Actions,
  Block,
  Expandable,
  Group,
  Missing,
  Row,
  SecTitle,
  type WorkspaceActions,
} from '../shared.js';

interface CampaignsProps {
  detail: FounderWorkspaceDetail;
  actions: WorkspaceActions;
}

function CurrentCampaign({ campaign }: { campaign: CampaignSummary }) {
  return (
    <Block>
      <p className="camp-block__name">
        <b>{campaign.name}</b> <Tag>{campaign.type}</Tag>
      </p>
      <Group>
        <Row label="Status">{campaign.status}</Row>
        <Row label="Campaign setup">{campaign.buildStatus ?? <Missing />}</Row>
        <Row label="Creator readiness">{campaign.rosterReadiness ?? <Missing />}</Row>
        {campaign.review ? (
          <Row label="Proovd review" helper={campaign.review.why}>
            {campaign.review.outcome}
          </Row>
        ) : null}
        <Row label="Listing fee">{campaign.listing ?? <Missing />}</Row>
        <Row label="Opens">{campaign.opensAt ?? <Missing />}</Row>
        <Row label="Closes">{campaign.closesAt ?? <Missing />}</Row>
        {campaign.issue ? <Row label="Current issue">{campaign.issue}</Row> : null}
      </Group>
      <Actions>
        {/* A real route since 2026-08-16: the Campaigns workspace owns campaign
            operations, and this record links into it rather than toasting. */}
        <RouterLink className="btn btn--secondary" to={`/admin/campaigns/${campaign.campaignId}`}>
          <span className="btn__label">Open campaign</span>
        </RouterLink>
      </Actions>
      <Expandable label="Technical details">
        <p className="grey">
          Lifecycle value: <b>{campaign.rawStatus}</b> — Admin surfaces always show the
          human-readable label.
        </p>
      </Expandable>
    </Block>
  );
}

export function Campaigns({ detail, actions }: CampaignsProps) {
  const { header, campaigns } = detail;
  const next = campaigns.next;

  return (
    <>
      <SecTitle>Current campaign</SecTitle>
      {campaigns.current ? (
        <CurrentCampaign campaign={campaigns.current} />
      ) : (
        <p className="grey">
          <b>No active campaign</b>
        </p>
      )}

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
              {header.preferredName} can request another campaign starting{' '}
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
                  onClick={(event) =>
                    actions.confirm('campunapprove', event.currentTarget)
                  }
                >
                  Remove next-campaign approval
                </Button>
              ) : null}
            </Actions>
          ) : null}
        </>
      ) : null}
    </>
  );
}
