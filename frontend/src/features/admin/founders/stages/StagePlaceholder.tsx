/**
 * A stage whose screen is not built yet.
 *
 * Deliberately not a blank `.workspace`: §1.4 makes an empty screen
 * indistinguishable from a broken one, and this panel is being built stage by
 * stage. So each un-built stage renders its own name, what the record already
 * knows about it, and where that work is done today — the same arrangement the
 * Admin section placeholders use.
 *
 * The facts below come from the workspace payload, which the server composes in
 * full for every stage. Nothing is waiting on data; what is waiting is the
 * screen.
 */

import type { FounderWorkspaceDetail } from '../api.js';
import { stageById, type FounderStageId } from '../stages.js';

interface Props {
  stageId: FounderStageId;
  detail: FounderWorkspaceDetail;
}

export function StagePlaceholder({ stageId, detail }: Props) {
  const stage = stageById(stageId);
  const campaign = detail.campaigns.current;

  return (
    <section className="workspace" id="main">
      <div className="workspace-grid">
        <div className="workspace-inner">
          <div className="stage-heading">
            <p className="stage-name">{stage?.label ?? 'Stage'}</p>
            <h1>This stage is being built</h1>
            <p>
              The record behind it is complete — every fact this stage needs is already composed by
              the server. What is missing is the screen.
            </p>
          </div>

          <section className="state-strip">
            <div>
              <span>Campaign</span>
              <strong>{campaign?.name ?? 'None yet'}</strong>
            </div>
            <div>
              <span>Lifecycle</span>
              <strong>{campaign?.status ?? detail.header.lifecycle}</strong>
            </div>
            <div>
              <span>Next</span>
              <strong>{detail.header.adminAction.label}</strong>
            </div>
          </section>

          <section className="compact-state-grid">
            <div>
              <span>Build status</span>
              <strong>{campaign?.buildStatus ?? '—'}</strong>
              <small>From the campaign record</small>
            </div>
            <div>
              <span>Roster readiness</span>
              <strong>{campaign?.rosterReadiness ?? '—'}</strong>
              <small>§16's derived readiness</small>
            </div>
            <div>
              <span>Listing</span>
              <strong>{campaign?.listing ?? '—'}</strong>
              <small>§13's listing fee</small>
            </div>
            <div>
              <span>Account</span>
              <strong>{detail.header.account}</strong>
              <small>Separate from campaign state</small>
            </div>
          </section>

          {campaign?.issue ? (
            <div className="actionbar">
              <div>
                <small>{campaign.issue}</small>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
