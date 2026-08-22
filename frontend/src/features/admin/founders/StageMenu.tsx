/**
 * The campaign workflow menu — the reference's `☰` overlay.
 *
 * Eleven stages, always all eleven. A locked stage stays on screen with its own
 * reason on it rather than being hidden: an absent row reads as a stage that
 * does not exist, and this workflow has eleven of them whether or not one
 * record has reached them yet.
 *
 * ── Reachability is a high-water mark, not the current position ─────────────
 * `reached` is `campaigns.workflow_stage_reached` — a ratchet with a database
 * trigger refusing a lower index. It is deliberately NOT derived from
 * `campaigns.status`, because status moves backward: `changes_required` follows
 * `pending_review`, and `capture_retry_window` follows `closed_pending_capture`.
 * A menu whose locks came from status would re-lock a screen somebody had
 * already worked in, the moment a campaign was sent back for changes.
 *
 * ── A locked row is clickable, and answers ─────────────────────────────────
 * The reference's own behaviour, and the right one. Clicking a locked stage
 * produces `${label} is inactive. Go to ${reached} first.` and leaves the menu
 * open. Silently swallowing the click would leave a person pressing a row that
 * never responds, which is indistinguishable from a broken menu (§1.4).
 */

import {
  FOUNDER_WORKFLOW_LABELS,
  FOUNDER_WORKFLOW_STAGE_IDS,
  workflowStageAvailable,
  type FounderWorkflowStageId,
} from '@proovd/shared';
import { Overlay } from './dialogs/Overlay.js';

interface Props {
  /** Which stage the workspace is showing right now. */
  shown: FounderWorkflowStageId;
  /** The furthest stage this campaign has EVER reached. */
  reached: FounderWorkflowStageId;
  onPick: (id: FounderWorkflowStageId) => void;
  onClose: () => void;
  /** The reference's refusal toast for a locked stage. */
  onRefuse: (message: string) => void;
}

export function StageMenu({ shown, reached, onPick, onClose, onRefuse }: Props) {
  const reachedLabel = FOUNDER_WORKFLOW_LABELS[reached];

  return (
    <Overlay label="Campaign workflow" onClose={onClose}>
      <p className="dialog-kicker">Campaign workflow</p>
      <h2>Go to a stage</h2>
      <p className="dialog-lead">
        Past and current stages are available. Future stages remain visible but inactive until{' '}
        {reachedLabel} is completed.
      </p>

      <nav className="stage-menu-list" aria-label="Campaign stages">
        {FOUNDER_WORKFLOW_STAGE_IDS.map((id) => {
          const available = workflowStageAvailable(id, reached);
          const active = id === shown;
          const label = FOUNDER_WORKFLOW_LABELS[id];

          return (
            <button
              key={id}
              type="button"
              className={`${active ? 'active' : ''} ${available ? 'available' : 'locked'}`}
              {...(active ? { 'aria-current': 'page' as const } : {})}
              aria-disabled={!available}
              onClick={() => {
                if (!available) {
                  onRefuse(`${label} is inactive. Go to ${reachedLabel} first.`);
                  return;
                }
                onPick(id);
              }}
            >
              <span>
                <strong>{label}</strong>
                <small>{active ? 'Currently open' : available ? 'Available' : 'Inactive'}</small>
              </span>
              <b>{active ? 'Open' : available ? 'View' : `Go to ${reachedLabel}`}</b>
            </button>
          );
        })}
      </nav>
    </Overlay>
  );
}
