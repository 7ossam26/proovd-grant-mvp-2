/**
 * The one read and the one save every onboarding screen uses — Creator Flow v2,
 * Session B, 2026-08-19.
 *
 * Four screens each fetching their own slice would be four shapes of the same
 * record, and the first field two of them both render is the first place they
 * disagree. `GET /api/affiliate-invitation/:token` already returns the landing,
 * the whole profile, the conditional state and the policies in one call, so
 * every screen reads that and picks what it needs.
 *
 * ── The typed value never comes back from the server ────────────────────────
 * `useAutosave` takes a patch and reports an OUTCOME; it returns no value and
 * the caller's own state is the only copy of what was typed. That single
 * decision is the whole autosave bug class — §9's "a failed save never clears
 * valid fields" — and the obvious implementation, refetch-on-error, is exactly
 * the bug. Nothing here refetches after a save.
 *
 * ── A key absent from the patch writes nothing ──────────────────────────────
 * `saveSignupProfile` honours `undefined` as "not in this request", so a screen
 * sending one field cannot blank another screen's answer. This hook does not
 * merge, batch, or fill in — it passes through.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAutosave, type AutosaveController } from '../../lib/useAutosave.js';
import {
  fetchInvitation,
  saveInvitation,
  type CreatorInvitationState,
  type CreatorPatch,
} from '../creator/api.js';

export interface InvitationRead {
  /** Null while loading. */
  state: CreatorInvitationState | null;
  /**
   * True when the token did not resolve.
   *
   * §5.5: invalid, expired, revoked, claimed, and never-existed are one answer.
   * The surface renders `LinkUnavailable` for all of them, and this flag is the
   * only thing it knows.
   */
  unavailable: boolean;
}

export function useInvitation(token: string): InvitationRead {
  const [state, setState] = useState<CreatorInvitationState | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setUnavailable(false);
    fetchInvitation(token)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return { state, unavailable };
}

export function useInvitationSave(token: string): AutosaveController<CreatorPatch> {
  return useAutosave<CreatorPatch>(
    useCallback((patch: CreatorPatch) => saveInvitation(token, patch), [token]),
  );
}
