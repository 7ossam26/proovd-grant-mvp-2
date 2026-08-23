/**
 * The one build read the four build steps share — Session F.
 *
 * ── One API, one registry, no second writer ─────────────────────────────────
 * There are two build surfaces now and there will be permanently: this sequence
 * and `/campaigns/:campaignId/build`. What keeps that a choice rather than a
 * mistake is that both call the SAME `fetchBuild` / `saveBuild` / `saveFaq` /
 * `saveRewardPackage`, and both read `deriveBuildStatus`'s answer rather than
 * deciding completeness themselves. A field added to one and not the other is
 * exactly the drift two surfaces are usually a mistake because of.
 *
 * ── The typed value never comes back from the server ────────────────────────
 * `useSetupWorkspace`'s rule, and §9's: the caller's state is the only copy of
 * what was typed. A save response is read for everything DERIVED — the build
 * status and the list of what is still missing — and its copies of the text
 * fields are ignored, because a save that raced a keystroke would otherwise
 * reinstate the sentence the Founder had just deleted.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  fetchBuild,
  recordSimulatedListingPayment,
  saveBuild,
  FounderRequestError,
  type BuildFields,
  type BuildState,
} from '../founder/api.js';
import { useAutosave, type AutosaveController } from '../../lib/useAutosave.js';
import { isReferenceWalkthrough } from './referenceWalkthrough.js';

export interface BuildFlowState {
  state: BuildState | null;
  /** A §27.1-shaped sentence, or null. Never a raw error. */
  failure: string | null;
  autosave: AutosaveController<Partial<BuildFields>>;
  /** Applies a response from a control that is not a text field. */
  refresh: () => Promise<void>;
}

export function useBuildFlow(campaignId: string): BuildFlowState {
  const [state, setState] = useState<BuildState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const reconcileOldWalkthroughClick = isReferenceWalkthrough(campaignId)
      ? recordSimulatedListingPayment(campaignId)
      : Promise.resolve();
    reconcileOldWalkthroughClick
      .then(() => fetchBuild(campaignId))
      .then((build) => {
        if (!cancelled) setState(build);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof FounderRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'We could not open your campaign page.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const autosave = useAutosave<Partial<BuildFields>>(
    useCallback(
      async (patch: Partial<BuildFields>) => {
        const result = await saveBuild(campaignId, patch);
        // Only what the server DERIVES. `build` is deliberately not written
        // back over the caller's own text state (§9).
        setState((current) =>
          current
            ? { ...current, buildStatus: result.buildStatus, missing: result.missing }
            : current,
        );
      },
      [campaignId],
    ),
  );

  const refresh = useCallback(async () => {
    setState(await fetchBuild(campaignId));
  }, [campaignId]);

  return { state, failure, autosave, refresh };
}
