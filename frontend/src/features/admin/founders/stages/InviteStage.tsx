/**
 * Stage 1 — Invite. Spec §7, §9, §25.6, §28.1.
 *
 * Eleven fields, in two bands, exactly as the reference draws them: the five
 * that ARE the Founder-facing invitation, and the six saved for onboarding that
 * the Founder never sees on it. Then the four-tile state grid, then the action
 * bar. There is no Save control on this screen and none is added — the
 * reference has two buttons and the fields write themselves on blur.
 *
 * ── The send gate is READ, never recomputed ─────────────────────────────────
 * `canSend`, `unresolvedMarkers` and `missingBeforeSend` arrive on the workspace
 * payload. This surface renders them and nothing else: a readiness the browser
 * worked out is one a caller skips by posting to the route directly, and
 * `POST …/send` is the moment an invitation reaches a real person. The preview
 * is NOT fetched to learn the gate — it is fetched when somebody asks to read
 * the message, which is the only thing it is for.
 *
 * When the payload does not state `canSend` at all, that is neither permission
 * nor a refusal: the control stays live and the server's answer is what gets
 * rendered. Guessing in either direction would be this screen inventing a gate
 * (§1.4).
 *
 * ── The five compose fields are deliberately absent ─────────────────────────
 * §7's `whatWeUnderstood` / `whyInvited` / `senderName` / `senderEmail` /
 * `expectedSetupTime` have a route (`PUT …/invitation`) and no place on this
 * screen — the reference states outright that "the Founder sees only the five
 * invitation fields", and its two bands hold eleven fields, none of them these.
 * They are not written from here. If the record is missing one, the gate says
 * so by name in the action bar rather than this screen growing a twelfth field
 * the design does not have.
 *
 * ── "Preview full sequence" ─────────────────────────────────────────────────
 * The reference's own words, kept verbatim. Recorded risk: exactly one
 * invitation template exists, so "sequence" names a series of messages that
 * does not — §1.4 territory, and a copy decision rather than a code one.
 */

import { useEffect, useState } from 'react';
import { PREFILL_AFFILIATE_TYPES } from '@proovd/shared';
import {
  AdminRequestError,
  prefillVetting,
  previewInvitation,
  saveFounderPrefills,
  sendInvitation,
  updateFounderField,
  type FounderPrefillPatch,
  type InvitationPreview,
} from '../api.js';
import { absoluteTime } from '../format.js';
import { InvitationPreviewDialog } from './InvitationPreviewDialog.js';
import {
  StageFrame,
  StateStrip,
  asRequestError,
  invitationGate,
  readPanel,
  refusalLine,
  type StageProps,
} from './recordGroup.js';

type Busy = 'idle' | 'saving' | 'saved' | 'sending';

export function InviteStage({ detail, panel, onSaved }: StageProps) {
  const { header, overview } = detail;
  const p = readPanel(panel);
  const draftId = overview.vetting.draftId;
  const gate = invitationGate(detail);

  const answer = (key: string) => overview.vetting.answers.find((a) => a.key === key)?.text ?? '';

  /* Shown in the invitation */
  const [name, setName] = useState(header.preferredName);
  const [business, setBusiness] = useState(header.businessName ?? '');
  const [problem, setProblem] = useState(answer('problem'));
  const [solution, setSolution] = useState(answer('solution'));
  const [views, setViews] = useState(
    p.prefills?.viewsCount === null || p.prefills?.viewsCount === undefined
      ? ''
      : String(p.prefills.viewsCount),
  );

  /* Saved for onboarding */
  const [email, setEmail] = useState(header.email);
  const [username, setUsername] = useState(p.prefills?.username ?? '');
  const [matches, setMatches] = useState(
    p.prefills?.affiliateMatches === null || p.prefills?.affiliateMatches === undefined
      ? ''
      : String(p.prefills.affiliateMatches),
  );
  const [affiliateType, setAffiliateType] = useState(p.prefills?.affiliateType ?? '');
  const [voice1, setVoice1] = useState(p.prefills?.brandVoice1 ?? '');
  const [voice2, setVoice2] = useState(p.prefills?.brandVoice2 ?? '');

  /**
   * The panel supplement arrives after the workspace payload, so five of these
   * eleven fields are empty on the first render and hold a real value on the
   * next. `useState` only reads its initial value once — without this the
   * screen would render the Admin's own prefills as blank and then let somebody
   * blur an empty field over a saved one. The snapshot is the SERVER's values,
   * so the effect fires only when the record itself changed.
   */
  const serverValues = JSON.stringify([
    header.preferredName,
    header.businessName ?? '',
    answer('problem'),
    answer('solution'),
    p.prefills?.viewsCount ?? null,
    header.email,
    p.prefills?.username ?? '',
    p.prefills?.affiliateMatches ?? null,
    p.prefills?.affiliateType ?? '',
    p.prefills?.brandVoice1 ?? '',
    p.prefills?.brandVoice2 ?? '',
  ]);

  useEffect(() => {
    const [
      nextName,
      nextBusiness,
      nextProblem,
      nextSolution,
      nextViews,
      nextEmail,
      nextUsername,
      nextMatches,
      nextType,
      nextVoice1,
      nextVoice2,
    ] = JSON.parse(serverValues) as (string | number | null)[];
    setName(String(nextName ?? ''));
    setBusiness(String(nextBusiness ?? ''));
    setProblem(String(nextProblem ?? ''));
    setSolution(String(nextSolution ?? ''));
    setViews(nextViews === null ? '' : String(nextViews));
    setEmail(String(nextEmail ?? ''));
    setUsername(String(nextUsername ?? ''));
    setMatches(nextMatches === null ? '' : String(nextMatches));
    setAffiliateType(String(nextType ?? ''));
    setVoice1(String(nextVoice1 ?? ''));
    setVoice2(String(nextVoice2 ?? ''));
  }, [serverValues]);

  const [busy, setBusy] = useState<Busy>('idle');
  const [error, setError] = useState<AdminRequestError | null>(null);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  /** The state strip's own value, which is also what the `locked` slot reads. */
  const draftStatus = overview.invitation.state;

  /**
   * The reference's `locked` slot: the fieldset is live until an invitation has
   * actually gone out, and read-only afterwards.
   *
   * The reference calls that first state `Draft`; this product's own vocabulary
   * for it is `Not sent` (`INVITATION_STATES` in `founders/logic.ts`, the seven
   * values `deriveInvitationState` returns). Comparing against the literal
   * `'Draft'` matched none of them, so the fieldset was locked for every
   * Founder including a brand-new one — the whole screen was read-only.
   *
   * Locking after the send is the right rule and not merely the reference's:
   * `campaign_invitation_sends` snapshots what was actually delivered, and an
   * edit afterwards would leave the record saying something different from the
   * message in somebody's inbox. Changing the content means sending a new
   * invitation, which rotates the token and writes a new send row.
   */
  const locked = draftStatus !== 'Not sent';

  async function persist(run: () => Promise<unknown>) {
    setBusy('saving');
    setError(null);
    try {
      await run();
      setBusy('saved');
      onSaved();
    } catch (e: unknown) {
      setError(asRequestError(e));
      setBusy('idle');
    }
  }

  const saveField = (key: string, next: string, current: string) => {
    if (locked || next === current) return;
    void persist(() => updateFounderField(header.prospectId, key, next));
  };

  const savePrefill = (patch: FounderPrefillPatch) => {
    if (locked) return;
    void persist(() => saveFounderPrefills(draftId, patch));
  };

  /**
   * An empty number field is `null` — "nobody recorded one" — and never `0`.
   * A count of zero is a real answer somebody could give, so the two cannot
   * share a representation (§1.4: "not yet populated" is not zero).
   */
  const countOrNull = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const value = Number(trimmed);
    return Number.isInteger(value) && value >= 0 ? value : null;
  };

  const send = () =>
    persist(async () => {
      setBusy('sending');
      const result = await sendInvitation(draftId);
      setSent(
        result.resent
          ? 'A new invitation was sent — the previous link stopped working.'
          : 'Invitation sent.',
      );
    });

  /* The action bar's one status line, in priority order. */
  const statusLine = (() => {
    if (sent) return sent;
    const refusal = refusalLine(error);
    if (refusal) return refusal;
    if (busy === 'sending') return 'Sending…';
    if (busy === 'saving') return 'Saving…';
    if (busy === 'saved') return `Saved ${absoluteTime(new Date().toISOString())}`;
    if (gate.canSend === true) return 'Every required field is valid';
    if (gate.canSend === false) {
      const missing = gate.missingBeforeSend ?? [];
      const unresolved = gate.unresolvedMarkers ?? [];
      if (missing.length) return `Required before sending: ${missing.join(', ')}`;
      if (unresolved.length) return `Unresolved in the message: ${unresolved.join(', ')}`;
      /* The reference's own words where the gate names nothing specific. */
      return 'Complete valid email, views and affiliate-count values';
    }
    return 'This record does not state whether the invitation is ready to send.';
  })();

  const sends = overview.invitation.sends ?? [];
  const version = p.invitation?.version ?? overview.invitation.tokenVersion ?? null;
  const reminders = p.invitation?.reminders ?? (sends.length > 0 ? sends.length - 1 : null);

  return (
    <>
      <StageFrame
        stage="Invite"
        heading="Ready to personalize"
        lead="The Founder sees only the five invitation fields. Account prefills remain hidden until onboarding."
      >
        <StateStrip
          status={draftStatus}
          lastChange={
            p.draft?.updatedAt
              ? absoluteTime(p.draft.updatedAt)
              : (overview.invitation.stateAt ?? 'Not sent')
          }
          /* The reference's own branch: an accepted invitation's next step is
             Onboarding, not another read of the invitation. */
          next={draftStatus === 'Accepted' ? 'Onboarding' : 'Founder reviews and accepts'}
        />

        {/* The trailing space is the reference's own conditional `locked` slot. */}
        <fieldset className={`invite-prefill ${locked ? 'locked' : ''}`} disabled={locked}>
          <section className="prefill-section">
            <div className="prefill-heading">
              <div>
                <h2>Shown in the invitation</h2>
                <p>These five fields are the complete Founder-facing invitation.</p>
              </div>
              <span>5 fields</span>
            </div>
            <div className="prefill-grid">
              <label>
                <span>Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => saveField('preferred', name, header.preferredName)}
                />
              </label>
              <label>
                <span>Business Name</span>
                <input
                  value={business}
                  onChange={(e) => setBusiness(e.target.value)}
                  onBlur={() => saveField('bizLegal', business, header.businessName ?? '')}
                />
              </label>
              <label className="wide">
                <span>Problem</span>
                <textarea
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                  onBlur={() => {
                    if (!locked && problem !== answer('problem')) {
                      void persist(() => prefillVetting(draftId, { problem }));
                    }
                  }}
                />
              </label>
              <label className="wide">
                <span>Solution</span>
                <textarea
                  value={solution}
                  onChange={(e) => setSolution(e.target.value)}
                  onBlur={() => {
                    if (!locked && solution !== answer('solution')) {
                      void persist(() => prefillVetting(draftId, { solution }));
                    }
                  }}
                />
              </label>
              <label>
                <span>Number of views</span>
                <input
                  type="number"
                  min={0}
                  value={views}
                  onChange={(e) => setViews(e.target.value)}
                  onBlur={() => savePrefill({ viewsCount: countOrNull(views) })}
                />
              </label>
            </div>
          </section>

          <section className="prefill-section onboarding-prefill">
            <div className="prefill-heading">
              <div>
                <h2>Saved for onboarding</h2>
                <p>Required before sending. The Founder does not see these on the invitation.</p>
              </div>
              <span>6 fields</span>
            </div>
            <div className="prefill-grid">
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => saveField('email', email, header.email)}
                />
              </label>
              <label>
                <span>Username</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onBlur={() => savePrefill({ username: username.trim() || null })}
                />
              </label>
              <label>
                <span>Number of affiliate matches</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={matches}
                  onChange={(e) => setMatches(e.target.value)}
                  onBlur={() => savePrefill({ affiliateMatches: countOrNull(matches) })}
                />
              </label>
              <label>
                <span>Type of affiliate</span>
                {/*
                  The reference's OWN nine, not `AFFILIATE_SUBTYPES`. The two
                  registers are deliberately different: this one splits
                  newsletter from blog and student from network distributor.
                */}
                <select
                  value={affiliateType}
                  onChange={(e) => {
                    setAffiliateType(e.target.value);
                    savePrefill({ affiliateType: e.target.value || null });
                  }}
                >
                  <option value="">Select one</option>
                  {PREFILL_AFFILIATE_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Brand voice descriptor 1</span>
                <input
                  value={voice1}
                  onChange={(e) => setVoice1(e.target.value)}
                  onBlur={() => savePrefill({ brandVoice1: voice1.trim() || null })}
                />
              </label>
              <label>
                <span>Brand voice descriptor 2</span>
                <input
                  value={voice2}
                  onChange={(e) => setVoice2(e.target.value)}
                  onBlur={() => savePrefill({ brandVoice2: voice2.trim() || null })}
                />
              </label>
            </div>
          </section>
        </fieldset>

        <section className="compact-state-grid">
          <div>
            <span>Invitation version</span>
            {/* Zero sends is an absence, not `v0` — nothing has been minted. */}
            <strong>{version === null ? 'None sent' : `v${version}`}</strong>
            <small>Previous versions remain in history</small>
          </div>
          <div>
            <span>Delivery</span>
            <strong>{p.invitation?.deliveryState ?? overview.invitation.state}</strong>
            <small>
              {p.invitation?.deliveryAt
                ? absoluteTime(p.invitation.deliveryAt)
                : (overview.invitation.stateAt ?? 'Nothing delivered yet')}
            </small>
          </div>
          <div>
            <span>Reminders</span>
            <strong>{reminders === null ? 'Not recorded' : String(reminders)}</strong>
            <small>Last delivery recorded in History</small>
          </div>
          <div>
            <span>Account</span>
            <strong>{header.account}</strong>
            <small>Separate from invitation state</small>
          </div>
        </section>

        <div className="actionbar">
          <div>
            <small>{statusLine}</small>
          </div>
          <div className="action-buttons">
            <button
              type="button"
              onClick={() => {
                previewInvitation(draftId)
                  .then((result) => {
                    setPreview(result);
                    setPreviewOpen(true);
                  })
                  .catch((e: unknown) => setError(asRequestError(e)));
              }}
            >
              Preview full sequence
            </button>
            <button
              className="primary"
              type="button"
              onClick={send}
              disabled={gate.canSend === false || busy === 'saving' || busy === 'sending'}
            >
              Send invite
            </button>
          </div>
        </div>
      </StageFrame>

      {previewOpen && preview ? (
        <InvitationPreviewDialog preview={preview} onClose={() => setPreviewOpen(false)} />
      ) : null}
    </>
  );
}
