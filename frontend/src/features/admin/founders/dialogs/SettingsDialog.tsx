/**
 * Founder and campaign settings — the panel's persistent controls.
 *
 * Its lead states the two rules that make this sheet work: the controls do not
 * belong to a campaign stage, and the destructive ones take a recorded reason.
 * Both are the reference's own words and both are true here — the one
 * destructive control with a route behind it (§26.7's access decision) is
 * refused by the SERVER without a reason, not merely by the dialog.
 *
 * ── Eleven of the fourteen rows have no route, and each says which ──────────
 * A settings index is exactly where a control that silently does nothing is
 * least visible, so none of them is a disabled button. Each renders its title
 * and its description exactly as the reference does, and where the action would
 * be there is one sentence naming what is missing. That is the codebase's
 * standing rule (prefer absent, with the reason rendered where the control
 * would be) and the honest reading of §1.4 — a disabled control invites
 * somebody to work out how to enable it.
 *
 * The three that are real:
 *   · Restrict / Restore    → POST …/access, freshness-gated, reason required
 *   · Change campaign owner → PUT …/:draftId/prospect { internalOwner }
 *   · the four Communication rows → they open the sheets beside them
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
  onTool: (tool: SettingsTool) => void;
  onAccessDecision: (action: 'suspend' | 'restore') => void;
  onChangeOwner: () => void;
  onClose: () => void;
}

export function SettingsDialog({
  detail,
  onTool,
  onAccessDecision,
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
            action={<NotBuilt>No password-reset route exists yet.</NotBuilt>}
          />
          <SettingRow
            title="Revoke active sessions"
            description="Sign the Founder out on every device while keeping the account active."
            action={<NotBuilt>No session-revocation route exists yet.</NotBuilt>}
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
            action={<NotBuilt>The record keeps no warning count.</NotBuilt>}
          />
          <SettingRow
            title="Export account record"
            description="Download profile, eligibility, account status and warning data."
            action={<NotBuilt>No account-record export route exists yet.</NotBuilt>}
          />
          <SettingRow
            danger
            title="Delete Founder account"
            description="Hide the Founder from the directory, ban access, stop and archive every campaign."
            action={
              <NotBuilt>This is four recorded acts and no route performs them together.</NotBuilt>
            }
          />
        </section>

        <section>
          <header>
            <h3>Campaign</h3>
            <span>{campaigns.current?.status ?? 'No campaign record'}</span>
          </header>

          <SettingRow
            title="Stop campaign"
            description="Stop all campaign actions immediately without deleting the record."
            action={<NotBuilt>No campaign-stop route exists yet.</NotBuilt>}
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
            title="Archive campaign"
            description="Move the campaign to Complete while preserving financial, content and communication records."
            action={<NotBuilt>Archiving without restarting the campaign is not built.</NotBuilt>}
          />
          <SettingRow
            title="Export complete campaign"
            description="Download invite, onboarding, payments, Creators, campaign page, Backers and fulfillment data."
            action={<NotBuilt>No campaign export route exists yet.</NotBuilt>}
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
