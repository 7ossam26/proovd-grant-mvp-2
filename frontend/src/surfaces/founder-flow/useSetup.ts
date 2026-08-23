/**
 * The one workspace read the five §12 answers and Last look share — Session D.
 *
 * ── Why a hook and not six fetches ──────────────────────────────────────────
 * The five answers and the review are six addresses over ONE record. Six copies
 * of "load it, autosave a patch, apply what the server derived" is six chances
 * to get the §9 autosave rule wrong in one of them, and the wrong one is the
 * page nobody tested. `Workspace.tsx` had all six in a single component, which
 * solved it by having one copy; splitting into pages means the copy moves here.
 *
 * ── The typed value never comes back from the server ────────────────────────
 * §9's rule, and `useAutosave`'s whole design: the caller's state is the only
 * copy of what was typed. A save response is read for everything DERIVED — the
 * item decisions, the fee, the high-effort classification, the approvals — and
 * its copies of the text fields are ignored, because a save that raced a
 * keystroke would otherwise reinstate the sentence the Founder had just
 * deleted. Each answer page holds its own local text state for exactly that
 * reason, and this hook never writes one back.
 *
 * ── Nothing here computes money ─────────────────────────────────────────────
 * `state.fee` arrives as decimal strings of integer cents and is formatted, not
 * calculated. Phase 09's trap: a second implementation in a React component is
 * how the preview and the charge diverge. There is no arithmetic on a fee
 * anywhere under `frontend/src/surfaces/`, and Session D adds none.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  cacheFounderWorkspace,
  fetchWorkspace,
  saveWorkspace,
  FounderRequestError,
  type WorkspacePatch,
  type WorkspaceState,
} from '../founder/api.js';
import { useAutosave, type AutosaveController } from '../../lib/useAutosave.js';

export interface SetupWorkspace {
  state: WorkspaceState | null;
  /** A §27.1-shaped sentence, or null. Never a raw error. */
  failure: string | null;
  autosave: AutosaveController<WorkspacePatch>;
  /** Applies a response from a control that is not a text field. */
  refresh: (promise: Promise<{ workspace: WorkspaceState }>) => Promise<void>;
}

export function useSetupWorkspace(campaignId: string): SetupWorkspace {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWorkspace(campaignId)
      .then(({ workspace }) => {
        if (!cancelled) setState(workspace);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof FounderRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'We could not open your campaign.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const autosave = useAutosave<WorkspacePatch>(
    useCallback(
      async (patch: WorkspacePatch) => {
        const { workspace } = await saveWorkspace(campaignId, patch);
        setState(workspace);
      },
      [campaignId],
    ),
  );

  const refresh = useCallback(
    async (promise: Promise<{ workspace: WorkspaceState }>) => {
      const result = await promise;
      cacheFounderWorkspace(campaignId, result);
      setState(result.workspace);
    },
    [campaignId],
  );

  return { state, failure, autosave, refresh };
}
