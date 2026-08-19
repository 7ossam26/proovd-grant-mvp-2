/**
 * Screen 6 — your numbers — Creator Flow v2, Session C, 2026-08-19.
 *
 * ── This screen renders a function the reference computes and never draws ───
 * `verifySpec()` sits at line 2457 of the prototype, builds a per-channel list
 * of metric fields, and is rendered nowhere — a genuine bug in a prototype
 * whose output is good. It is built here from `AFFILIATE_SUBTYPE_DEFINITIONS`
 * rather than from the reference's own six-branch switch, because that register
 * already carries every one of these ids and is already what an Admin verifies
 * against. Two lists would mean a Creator answering one question and an Admin
 * verifying a different one.
 *
 * The set comes from the SERVER (`metricsAsked`), so the fields shown and the
 * values the write accepts are decided in one place — a field the browser
 * derived and the route refused would be a box somebody could type into and
 * never save.
 *
 * ── Three things the reference draws that are refused ───────────────────────
 * *"This is what shapes your affiliate score and whether founders trust you"* —
 * §8 makes verification an Admin's recorded judgement over §5.3's evidence, not
 * a count of files, and a number of screenshots deciding how many Founders can
 * see somebody is §30's percentile pruning with a friendlier face. The
 * `matchPct` meter rising 25% per upload, and the `Add proof to unlock` state
 * behind it, go with it: no threshold in §5.3 or §8 exists for that meter to
 * measure. All three are in `CREATOR_FLOW_ABSENCES`.
 *
 * ── The upload is a named absence ───────────────────────────────────────────
 * The RECORD exists — 0048's `affiliate_evidence_files` is keyed on the
 * prospect, so a Creator-supplied row needs no new table — and the bucket does
 * not. Same position as screen 5's photo, said for the thing an Admin will
 * eventually verify against.
 *
 * ── The register's `basis` is ADMIN copy and does not render here ───────────
 * `AFFILIATE_SUBTYPE_DEFINITIONS` gives every evidence input a `basis`, and it
 * is written for the person doing the §8 verification: "The audience-size
 * metric §8 requires on the prospect." Rendering that to a Creator puts a Spec
 * section reference on a customer surface — the leak the Campaigns hub recorded
 * when `§21:` read aloud nine times, and worse here because the audience is not
 * an operator. Found by the browser pass.
 *
 * So the label renders and the basis does not, and what a Creator reads instead
 * is `CHANNEL_METRICS_ARE_YOUR_OWN_FIGURES` — which says the same useful thing
 * (these are your figures, somebody checks them) in words written for them.
 *
 * ── A subtype that asks for nothing says so ─────────────────────────────────
 * `student_affiliate` and `niche_marketer` have no audience figure among §5.3's
 * inputs; their evidence is a promotion plan and a disclaimer. §16a's rule
 * applies twice over: not yet populated is not zero, and here it is not even a
 * gap — nobody was asked.
 */

import { useState } from 'react';
import { useParams } from 'react-router';
import {
  CHANNEL_METRICS_ARE_YOUR_OWN_FIGURES,
  CHANNEL_METRICS_NOT_ASKED,
  CREATOR_EVIDENCE_UNAVAILABLE,
  CREATOR_VERIFY_HEAD,
  CREATOR_VERIFY_LEDE,
  CREATOR_VERIFY_READ_ONLY,
  AFFILIATE_SUBTYPE_DEFINITIONS,
} from '@proovd/shared';
import { Button, Field } from '../../components/index.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { CreatorFlowPage, useCreatorFlowNav } from './CreatorFlowPage.js';
import { useInvitation } from './useInvitation.js';
import { saveCreatorMetrics, CreatorRequestError } from '../creator/api.js';
import type { CreatorInvitationState } from '../creator/api.js';

/**
 * The label for one metric id, from §5.3's own register.
 *
 * Looked up across every subtype rather than within one, because the id is what
 * the server sent and the register is where its words live — the same reason
 * the interim signup resolved a channel tile's label rather than rendering its
 * id (§3.1: an internal name on a customer surface).
 *
 * The register's `basis` is deliberately NOT returned. See the header.
 */
function metricLabel(id: string): string {
  for (const definition of AFFILIATE_SUBTYPE_DEFINITIONS) {
    const input = definition.evidence.find((e) => e.id === id);
    if (input) return input.label;
  }
  // Unreachable while the server sends ids from the same register, and a
  // readable fallback rather than a crash if that ever stops being true.
  return id.replace(/_/g, ' ');
}

export function VerifyStep() {
  const { token = '' } = useParams();
  const { state, unavailable } = useInvitation(token);

  if (unavailable) return <LinkUnavailable />;
  if (!state) {
    return <SurfaceLoading subject="your numbers" reference="Your invitation link" />;
  }

  return (
    <CreatorFlowPage pageId="verify" param={token}>
      <Body token={token} loaded={state} />
    </CreatorFlowPage>
  );
}

function Body({ token, loaded }: { token: string; loaded: CreatorInvitationState }) {
  const { leaveToPage } = useCreatorFlowNav();
  const asked = loaded.metricsAsked;

  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const id of asked) seed[id] = loaded.metrics.values[id] ?? '';
    return seed;
  });
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function advance() {
    if (saving) return;
    setSaving(true);
    setRefusal(null);
    try {
      // A subtype that asks nothing sends nothing. The service treats an empty
      // object as a no-op rather than as a clear, so passing through this
      // screen never retires an answer somebody gave earlier.
      if (asked.length > 0) await saveCreatorMetrics(token, values);
      leaveToPage('agree', 1);
    } catch (caught) {
      setRefusal(
        caught instanceof CreatorRequestError
          ? (caught.detail.whatHappened ?? 'That could not be saved.')
          : 'That could not be saved, and nothing was changed.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="crf-verify">
      <h1 className="crf-verify__head" data-anim="head">
        {CREATOR_VERIFY_HEAD}
      </h1>
      <p className="crf-verify__lede" data-anim="sub">
        {CREATOR_VERIFY_LEDE}
      </p>

      {asked.length === 0 ? (
        <p className="crf-verify__none" data-anim="panel">
          {CHANNEL_METRICS_NOT_ASKED}
        </p>
      ) : (
        <>
          <div className="crf-verify__fields" data-anim="field">
            {asked.map((id) => {
              return (
                <Field key={id} label={metricLabel(id)}>
                  <input
                    className="input"
                    value={values[id] ?? ''}
                    // Deliberately NOT `type="number"`. "About 40k" and "12,300
                    // on the main list" are real answers, and the column is
                    // text for that reason — a numeric field would refuse them
                    // and push somebody to type a figure they do not have.
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [id]: event.target.value }))
                    }
                  />
                </Field>
              );
            })}
          </div>
          <p className="crf-verify__basis" data-anim="sub">
            {CHANNEL_METRICS_ARE_YOUR_OWN_FIGURES}
          </p>
        </>
      )}

      {/* Where the reference draws its upload control and its score meter.
          Neither renders; this says why the first one does not. */}
      {loaded.uploads.available ? null : (
        <p className="crf-verify__absent" data-anim="panel">
          {CREATOR_EVIDENCE_UNAVAILABLE}
        </p>
      )}

      <p className="crf-verify__note" data-anim="sub">
        {CREATOR_VERIFY_READ_ONLY}
      </p>

      {refusal ? (
        <p className="crf-verify__problems" role="alert">
          {refusal}
        </p>
      ) : null}

      <div className="crf-nav" data-anim="cta">
        <Button tier="tertiary" onClick={() => leaveToPage('presence', -1)}>
          Back to Your bio
        </Button>
        <Button tier="primary" disabled={saving} onClick={() => void advance()}>
          {saving ? 'Saving…' : 'Next: the agreement'}
        </Button>
      </div>
    </div>
  );
}
