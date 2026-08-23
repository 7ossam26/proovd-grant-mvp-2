/**
 * Founder and campaign settings — the panel's persistent controls.
 *
 * Its lead states the two rules that make this sheet work: the controls do not
 * belong to a campaign stage, and the destructive ones take a recorded reason.
 * Both are the reference's own words and both are true here — the one
 * destructive control with a route behind it (§26.7's access decision) is
 * refused by the SERVER without a reason, not merely by the dialog.
 *
 * Every action shown as a button has a real route or a local export behind it.
 * Two rows remain explanatory by product rule: bulk account deletion is
 * prohibited by retention obligations, and arbitrary campaign archival is not
 * a lifecycle transition. Neither is rendered as an enable-able control.
 *
 * ── Two reference strings are not reproduced, and both are mock data ────────
 * The reference's owner control reads `Change to Omar` because its roster is
 * two hardcoded names; `internal_owner` here is free text on the record, so the
 * control is `Change` and it opens the manual-edit sheet. Its `Restricted`
 * account word is likewise replaced by the record's own state vocabulary
 * (`Access suspended`), because that is the word the server, the audit row and
 * the Founder's own refusal all use.
 */

import type { ReactNode } from 'react';
import type { FounderWorkspaceDetail } from '../api.js';
import { Overlay } from './Overlay.js';

/** One row: the object on the left, the action — or its absence — on the right. */
function SettingRow({
  title,
  description,
  action,
  danger = false,
}: {
  title: string;
  description: string;
  action: ReactNode;
  danger?: boolean;
}) {
  return (
    <article {...(danger ? { className: 'danger-row' } : {})}>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {action}
    </article>
  );
}

/** The reason standing where a control would be. Never a disabled button. */
function NotBuilt({ children }: { children: string }) {
  return <small>{children}</small>;
}

export type SettingsTool = 'message' | 'support' | 'notes' | 'history';

interface Props {
  detail: FounderWorkspaceDetail;
  applicationReviewRequirement: {
    required: boolean;
    locked: boolean;
    lockedReason: string | null;
  } | null;
  onTool: (tool: SettingsTool) => void;
  onAccessDecision: (action: 'suspend' | 'restore') => void;
  onApplicationReviewRequirement: (required: boolean) => void;
  onPasswordRecovery: () => void;
  onRevokeSessions: () => void;
  warningCount: number;
  onAddWarning: () => void;
  onExportAccount: () => void;
  onExportCampaign: () => void;
  onStopCampaign: () => void;
  onChangeOwner: () => void;
  onClose: () => void;
}

export function SettingsDialog({
  detail,
  applicationReviewRequirement,
  onTool,
  onAccessDecision,
  onApplicationReviewRequirement,
  onPasswordRecovery,
  onRevokeSessions,
  warningCount,
  onAddWarning,
  onExportAccount,
  onExportCampaign,
  onStopCampaign,
  onChangeOwner,
  onClose,
}: Props) {
  const { header, campaigns } = detail;
  const suspended = header.account === 'Access suspended';
  const accessAvailable = header.availableActions.includes(suspended ? 'restore' : 'suspend');

  return (
    <Overlay label="Founder and campaign settings" onClose={onClose}>
      <p className="dialog-kicker">Persistent controls</p>
      <h2>Founder and campaign settings</h2>
      <p className="dialog-lead">
        These controls remain available from every campaign stage. Destructive actions require a
        recorded reason.
      </p>

      <div className="settings-groups">
        <section>
          <header>
            <h3>Founder account</h3>
            <span>{header.account}</span>
          </header>

          <SettingRow
            title="Send password reset"
            description="Send a secure reset email without viewing or changing the password."
            action={
              header.account === 'Not created yet' ? (
                <NotBuilt>No account exists yet; resend the invitation instead.</NotBuilt>
              ) : (
                <button type="button" onClick={onPasswordRecovery}>Send reset</button>
              )
            }
          />
          <SettingRow
            title="Revoke active sessions"
            description="Sign the Founder out on every device while keeping the account active."
            action={
              header.account === 'Not created yet' ? (
                <NotBuilt>No account exists yet, so there are no sessions.</NotBuilt>
              ) : (
                <button type="button" onClick={onRevokeSessions}>Revoke</button>
              )
            }
          />
          <SettingRow
            title={suspended ? 'Restore account' : 'Restrict account'}
            description={
              suspended
                ? 'Return the account to active use.'
                : 'Block Founder actions while preserving every record.'
            }
            action={
              accessAvailable ? (
                <button
                  type="button"
                  onClick={() => onAccessDecision(suspended ? 'restore' : 'suspend')}
                >
                  {suspended ? 'Restore' : 'Restrict'}
                </button>
              ) : (
                <NotBuilt>{`Not available while the account is ${header.account}.`}</NotBuilt>
              )
            }
          />
          <SettingRow
            title="Add account warning"
            description="Increase the persistent warning count and mark the account for attention."
            action={
              <button type="button" onClick={onAddWarning}>
                Add warning ({warningCount})
              </button>
            }
          />
          <SettingRow
            title="Export account record"
            description="Download profile, eligibility, account status and warning data."
            action={<button type="button" onClick={onExportAccount}>Export JSON</button>}
          />
          <SettingRow
            danger
            title="Account deletion"
            description="Account-closure requests are recorded and reviewed; retained campaign, payment, tax, support and audit records are never bulk-deleted."
            action={
              <NotBuilt>Bulk deletion is prohibited by the retention policy.</NotBuilt>
            }
          />
        </section>

        <section>
          <header>
            <h3>Campaign</h3>
            <span>{campaigns.current?.status ?? 'No campaign record'}</span>
          </header>

          <SettingRow
            title="Require Application Review"
            description="When on, the Founder must receive approval before the listing-fee step. When off, the flow skips Application Review."
            action={
              applicationReviewRequirement ? (
                applicationReviewRequirement.locked ? (
                  <NotBuilt>
                    {applicationReviewRequirement.lockedReason ??
                      'This setting is locked because the campaign has progressed.'}
                  </NotBuilt>
                ) : (
                  <button
                    type="button"
                    aria-pressed={applicationReviewRequirement.required}
                    onClick={() =>
                      onApplicationReviewRequirement(!applicationReviewRequirement.required)
                    }
                  >
                    {applicationReviewRequirement.required ? 'Turn off' : 'Turn on'}
                  </button>
                )
              ) : (
                <NotBuilt>No current campaign is available.</NotBuilt>
              )
            }
          />
          <SettingRow
            title="Stop campaign"
            description="Stop all campaign actions immediately without deleting the record."
            action={
              campaigns.current ? (
                <button type="button" onClick={onStopCampaign}>Stop</button>
              ) : (
                <NotBuilt>No current campaign is available.</NotBuilt>
              )
            }
          />
          <SettingRow
            title="Change campaign owner"
            description="Transfer persistent Admin ownership for this campaign and Founder record."
            action={
              <button type="button" onClick={onChangeOwner}>
                Change
              </button>
            }
          />
          <SettingRow
            title="Campaign archival"
            description="Campaigns reach Complete through their lifecycle. Archival is reserved for correcting a locked campaign type and always creates a clean replacement."
            action={<NotBuilt>Arbitrary archival is not a valid campaign lifecycle action.</NotBuilt>}
          />
          <SettingRow
            title="Export complete campaign"
            description="Download invite, onboarding, payments, Creators, campaign page, Backers and fulfillment data."
            action={
              campaigns.current ? (
                <button type="button" onClick={onExportCampaign}>Export JSON</button>
              ) : (
                <NotBuilt>No current campaign is available.</NotBuilt>
              )
            }
          />
        </section>

        <section>
          <header>
            <h3>Communication and audit</h3>
            <span>Available in every stage</span>
          </header>

          <SettingRow
            title="Message Founder"
            description="Open the persistent Founder conversation."
            action={
              <button type="button" onClick={() => onTool('message')}>
                Message
              </button>
            }
          />
          <SettingRow
            title="Support cases"
            description="View existing cases or open a case tied to the current stage."
            action={
              <button type="button" onClick={() => onTool('support')}>
                Open
              </button>
            }
          />
          <SettingRow
            title="Internal notes"
            description="Read and add Founder-scoped notes that persist across campaigns."
            action={
              <button type="button" onClick={() => onTool('notes')}>
                Open
              </button>
            }
          />
          <SettingRow
            title="Activity history"
            description="Review immutable Admin, Founder, system, payment and campaign events."
            action={
              <button type="button" onClick={() => onTool('history')}>
                Open
              </button>
            }
          />
        </section>
      </div>
    </Overlay>
  );
}
