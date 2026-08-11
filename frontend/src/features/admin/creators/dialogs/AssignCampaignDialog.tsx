/**
 * Assign an existing Affiliate to another campaign — §8, §11.
 *
 * ── The campaign is chosen, never typed ─────────────────────────────────────
 * The reference's own acceptance audit refuses a free-text campaign or Founder
 * field by name, and the reason is §7's preview gate in another phase: a typed
 * campaign name is a name that matches no campaign, and everything composed
 * from it would reference a product that does not exist. So the control is a
 * `<select>` over a server-supplied list, and the Founder follows from the
 * campaign rather than being a second choice somebody could mismatch.
 *
 * ── It sends nothing ────────────────────────────────────────────────────────
 * The relationship is created at `prospect`. No account, no message, no money,
 * no standing change — the invitation is a separate act under its own gate, and
 * the dialog says so where an Admin would otherwise assume otherwise.
 */

import { useEffect, useState } from 'react';
import { CAMPAIGN_IS_CHOSEN_NOT_TYPED, PROSPECT_CREATES_NO_ACCOUNT } from '@proovd/shared';
import { ConfirmDialog, DialogShell, type DialogSpec } from '../../founders/dialogs/index.js';
import { Button } from '../../../../components/index.js';
import {
  assignToCampaign,
  fetchAssignableCampaigns,
  type AssignableCampaign,
  type CreatorWorkspaceDetail,
} from '../api.js';

export function AssignCampaignDialog({
  prospectId,
  trigger,
  onClose,
  onDone,
}: {
  prospectId: string;
  trigger: HTMLElement | null;
  onClose: () => void;
  onDone: (detail: CreatorWorkspaceDetail) => void;
}) {
  const [campaigns, setCampaigns] = useState<AssignableCampaign[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetchAssignableCampaigns()
      .then(({ campaigns: rows }) => {
        if (live) setCampaigns(rows);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // The list has to arrive before the form can offer a choice. A select with no
  // options is a control that looks operable and is not (§1.4).
  if (!campaigns || failed) {
    return (
      <DialogShell
        kicker="Campaign relationship"
        title="Assign to another campaign"
        description={
          failed
            ? 'The campaign list could not be read, so there is nothing to choose from. Nothing has changed.'
            : 'Reading the campaigns this Affiliate could be attached to.'
        }
        trigger={trigger}
        onClose={onClose}
      >
        {(close) => (
          <div className="case-actions">
            <Button tier="secondary" onClick={close}>
              Close
            </Button>
          </div>
        )}
      </DialogShell>
    );
  }

  const spec: DialogSpec = {
    kicker: 'Campaign relationship',
    title: 'Assign to another campaign',
    body: (
      <>
        <p>{CAMPAIGN_IS_CHOSEN_NOT_TYPED}</p>
        <p className="helper">{PROSPECT_CREATES_NO_ACCOUNT}</p>
      </>
    ),
    fields: [
      {
        id: 'campaignId',
        label: 'Campaign',
        required: true,
        select: true,
        options: campaigns.map((campaign) => ({
          value: campaign.campaignId,
          // The Founder rides in the label rather than being a second control:
          // a form that let an Admin pick a campaign and a mismatched Founder
          // would offer a pair the record cannot hold.
          label: [campaign.name, campaign.founderName, campaign.status]
            .filter(Boolean)
            .join(' · '),
        })),
      },
      {
        id: 'rosterIntent',
        label: 'Roster designation',
        required: true,
        select: true,
        options: [
          { value: 'initial_roster', label: 'Initial launch roster' },
          { value: 'mid_campaign', label: 'Mid-campaign addition' },
        ],
        hint: '§23.4 stores this separately from the relationship status.',
      },
      {
        id: 'whyRecruited',
        label: 'Why this Affiliate, for this campaign',
        textarea: true,
        hint: 'Recorded on the relationship and used when the invitation is composed.',
      },
      {
        id: 'recruitmentSource',
        label: 'Recruitment source',
        hint: '§8 keeps the provenance per campaign relationship.',
      },
    ],
    primary: 'Create the relationship',
    secondary: 'Cancel',
  };

  return (
    <ConfirmDialog
      spec={spec}
      trigger={trigger}
      onClose={onClose}
      onSubmit={async (values) => {
        const detail = await assignToCampaign(prospectId, {
          campaignId: values['campaignId'] ?? '',
          rosterIntent:
            values['rosterIntent'] === 'mid_campaign' ? 'mid_campaign' : 'initial_roster',
          whyRecruited: values['whyRecruited'] ?? null,
          recruitmentSource: values['recruitmentSource'] ?? null,
        });
        onDone(detail);
      }}
    />
  );
}
