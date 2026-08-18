/**
 * Screen 5 — the address — Founder Flow v2, Session C.
 *
 * ── What this screen is for, and the headline it does not use ───────────────
 * The reference's headline is `To save your progress verify your email:` and
 * that is refused. Progress is already saved: §9's autosave has been writing
 * every answer through the draft token since screen 2, and the link in the
 * invitation is what brings a Founder back to all of it. A sentence naming the
 * wrong mechanism is the §1.4 failure in one line, and it is the line somebody
 * reads while deciding whether they can close the tab.
 *
 * What confirming an address actually buys is that we can reach them — the
 * campaign, the review, the money and the deadlines all arrive there — and that
 * is what the headline says.
 *
 * ── It writes the claim profile, not a new record ───────────────────────────
 * `founder_claim_profiles.email`, through the route that already owns it. The
 * address is prefilled from the invitation and `emailSupplier` records which of
 * the two it is (§5.2): unchanged is `invited_link`, edited is
 * `self_supplied_unverified` — and the code, next screen, is what turns either
 * into `code_verified`.
 *
 * ── The field's ink stays legible ───────────────────────────────────────────
 * The reference greys the address to `#A2AFA8` while the field has focus. That
 * is `--grey` on `--white`, about 2.2:1, applied to the text a person is
 * actively typing — the token for placeholders and disabled ink, and the one
 * Session B moved five sentences off. The dashed brand underline is what marks
 * focus here.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { founderFlowPath } from '@proovd/shared';
import { Button, Field } from '../../components/index.js';
import { describeSaveState } from '../../lib/autosave.js';
import { useAutosave } from '../../lib/useAutosave.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import {
  fetchClaim,
  saveClaim,
  requestEmailCode,
  type ClaimPatch,
  type ClaimView,
} from '../draft/api.js';
import { FlowPage, useFlowNav } from './FlowPage.js';
import { SurfaceLoading } from '../../features/public/states.js';

/** Shape only. The server decides, and a code that never arrives is the answer. */
function looksLikeAddress(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function EmailStep() {
  const { token = '' } = useParams();
  const [loaded, setLoaded] = useState<ClaimView | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchClaim(token)
      .then((view) => {
        if (!cancelled) setLoaded(view);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (unavailable) return <LinkUnavailable />;
  if (!loaded) return <SurfaceLoading subject="your email" reference="Your invitation link" />;

  return (
    <FlowPage pageId="email" token={token} badge>
      <Body token={token} loaded={loaded} />
    </FlowPage>
  );
}

function Body({ token, loaded }: { token: string; loaded: ClaimView }) {
  const { leave } = useFlowNav();
  // The typed value never comes back from the server. `useAutosave` reports an
  // outcome and returns nothing, deliberately — the caller's state is the only
  // copy of what was typed, and that one decision is the whole autosave bug
  // class (§9: "a failed save never clears valid fields").
  const [address, setAddress] = useState(loaded.profile.fields.email.value ?? '');
  const [busy, setBusy] = useState(false);

  const autosave = useAutosave<ClaimPatch>(
    useCallback((patch: ClaimPatch) => saveClaim(token, patch), [token]),
  );

  const status = describeSaveState(autosave.state);
  const valid = looksLikeAddress(address);

  function change(next: string) {
    setAddress(next);
    autosave.queue({ email: next });
  }

  async function send() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      // The address has to be stored before the code is minted — the code's
      // hash binds it, so a code sent against a half-saved address would not
      // verify against the saved one.
      await autosave.flush();
      // One answer for every outcome, and nothing here branches on it.
      await requestEmailCode(token);
      leave(founderFlowPath('code', token), 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ff-email">
      <h1 className="ff-email__head" data-anim="head">
        Where should we reach you?
      </h1>
      <p className="ff-email__lede" data-anim="sub">
        Your campaign, the review, and anything about money all arrive at this address. We will
        send a six-digit code to confirm it works.
      </p>

      <div className="ff-email__field" data-anim="field">
        <Field
          label="Your email address"
          hint={
            loaded.profile.fields.email.prefilled
              ? 'Filled in from your invitation. Change it if this is not the address you want.'
              : undefined
          }
        >
          <input
            className="ff-email__input"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            value={address}
            onChange={(event) => change(event.target.value)}
            onKeyDown={(event) => {
              // §10 of the disagreement list: Enter advances only where the
              // page's single control is a one-line input. This is that case.
              if (event.key === 'Enter') {
                event.preventDefault();
                void send();
              }
            }}
          />
        </Field>
      </div>

      <div className="ff-nav" data-anim="cta">
        <Button
          tier="tertiary"
          onClick={() => leave(founderFlowPath('campaign-type', token), -1)}
        >
          Back to Campaign type
        </Button>
        <span
          className="ff-confirm__status"
          role="status"
          aria-live="polite"
          data-state={autosave.state.status}
        >
          {status}
        </span>
        <Button tier="primary" disabled={!valid || busy} onClick={() => void send()}>
          Send me a code
        </Button>
      </div>
    </div>
  );
}
