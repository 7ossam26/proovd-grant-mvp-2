/**
 * Stage 1 — Invite. Spec §7, §9, §25.6, §28.1.
 *
 * Eleven fields, in two bands, exactly as the reference draws them: the five
 * that ARE the Founder-facing invitation, and the six saved for onboarding that
 * the Founder never sees on it. Then the four-tile state grid, then the action
 * bar. There is no Save control on this screen and none is added — the
 * reference has two buttons and the fields write themselves on blur.
 *
 * ── The send gate is the reference's eleven visible fields ──────────────────
 * Readiness follows the values on this page: all eleven must be present, email
 * must be valid, and both counts must be non-negative integers. Send flushes
 * the complete visible snapshot before delivery, so clicking directly from a
 * focused field cannot race that field's blur autosave.
 *
 * The delivery email still has three legacy compose slots that the reference
 * does not draw. They are composed from the visible Problem, Solution and
 * Business values at Preview/Send time; the authenticated Admin is recorded as
 * sender by the prospect-addressed send route.
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
  composeInvitation,
  createFounderInvitationLink,
  prefillVetting,
  previewInvitation,
  resendFounderInvitation,
  saveFounderPrefills,
  sendFounderInvitation,
  setFounderInvitationOverride,
  type FounderPrefillPatch,
  type InvitationPreview,
} from '../api.js';
import { absoluteTime } from '../format.js';
import { InvitationPreviewDialog } from './InvitationPreviewDialog.js';
import {
  StageFrame,
  StateStrip,
  asRequestError,
  readPanel,
  refusalLine,
  type StageProps,
} from './recordGroup.js';

type Busy = 'idle' | 'saving' | 'saved' | 'sending';

export interface InviteFieldSnapshot {
  name: string;
  business: string;
  problem: string;
  solution: string;
  views: string;
  email: string;
  username: string;
  matches: string;
  affiliateTypes: string[];
  voice1: string;
  voice2: string;
}

/** The reference's `d` gate, kept pure so the enabled state is regression-tested. */
export function inviteFieldsReady(fields: InviteFieldSnapshot): boolean {
  const wholeCount = (raw: string) => {
    const value = Number(raw.trim());
    return raw.trim() !== '' && Number.isInteger(value) && value >= 0;
  };

  const matchCount = Number(fields.matches.trim());
  const textFields = [
    fields.name,
    fields.business,
    fields.problem,
    fields.solution,
    fields.views,
    fields.email,
    fields.username,
    fields.matches,
    fields.voice1,
    fields.voice2,
  ];

  return (
    textFields.every((value) => value.trim().length > 0) &&
    /^\S+@\S+\.\S+$/.test(fields.email.trim()) &&
    wholeCount(fields.views) &&
    wholeCount(fields.matches) &&
    fields.affiliateTypes.length === matchCount &&
    fields.affiliateTypes.every((value) => value.trim().length > 0)
  );
}

function creatorTypesForCount(
  count: number,
  saved: readonly string[] | null | undefined,
  legacy: string | null | undefined,
): string[] {
  const next = (saved ?? []).slice(0, count);
  const fallback = next[0] || legacy || '';
  while (next.length < count) next.push(fallback);
  return next;
}

export function InviteStage({ detail, panel, onSaved }: StageProps) {
  const { header, overview } = detail;
  const p = readPanel(panel);
  const draftId = overview.vetting.draftId;

  const answer = (key: string) => overview.vetting.answers.find((a) => a.key === key)?.text ?? '';
  const invitationValue = (key: string, fallback: string) =>
    overview.invitation.overrides.find((field) => field.key === key)?.value ?? fallback;

  /* Shown in the invitation */
  const [name, setName] = useState(invitationValue('recipientName', header.preferredName));
  const [business, setBusiness] = useState(
    invitationValue('product', header.businessName ?? ''),
  );
  const [problem, setProblem] = useState(answer('problem'));
  const [solution, setSolution] = useState(answer('solution'));
  const [views, setViews] = useState(
    p.prefills?.viewsCount === null || p.prefills?.viewsCount === undefined
      ? ''
      : String(p.prefills.viewsCount),
  );

  /* Saved for onboarding */
  const [email, setEmail] = useState(invitationValue('recipientEmail', header.email));
  const [username, setUsername] = useState(p.prefills?.username ?? '');
  const [matches, setMatches] = useState(
    p.prefills?.affiliateMatches === null || p.prefills?.affiliateMatches === undefined
      ? ''
      : String(p.prefills.affiliateMatches),
  );
  const [affiliateTypes, setAffiliateTypes] = useState(() =>
    creatorTypesForCount(
      p.prefills?.affiliateMatches ?? 0,
      p.prefills?.affiliateTypes,
      p.prefills?.affiliateType,
    ),
  );
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
    invitationValue('recipientName', header.preferredName),
    invitationValue('product', header.businessName ?? ''),
    answer('problem'),
    answer('solution'),
    p.prefills?.viewsCount ?? null,
    invitationValue('recipientEmail', header.email),
    p.prefills?.username ?? '',
    p.prefills?.affiliateMatches ?? null,
    p.prefills?.affiliateType ?? '',
    p.prefills?.affiliateTypes ?? null,
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
      nextTypes,
      nextVoice1,
      nextVoice2,
    ] = JSON.parse(serverValues) as unknown[];
    setName(String(nextName ?? ''));
    setBusiness(String(nextBusiness ?? ''));
    setProblem(String(nextProblem ?? ''));
    setSolution(String(nextSolution ?? ''));
    setViews(nextViews === null ? '' : String(nextViews));
    setEmail(String(nextEmail ?? ''));
    setUsername(String(nextUsername ?? ''));
    setMatches(nextMatches === null ? '' : String(nextMatches));
    setAffiliateTypes(
      creatorTypesForCount(
        nextMatches === null ? 0 : Number(nextMatches),
        Array.isArray(nextTypes) ? nextTypes.map(String) : null,
        String(nextType ?? ''),
      ),
    );
    setVoice1(String(nextVoice1 ?? ''));
    setVoice2(String(nextVoice2 ?? ''));
  }, [serverValues]);

  const [busy, setBusy] = useState<Busy>('idle');
  const [error, setError] = useState<AdminRequestError | null>(null);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState(overview.invitation.linkUrl ?? '');
  const [linkStatus, setLinkStatus] = useState<string | null>(null);

  useEffect(() => {
    setLinkUrl(overview.invitation.linkUrl ?? '');
  }, [overview.invitation.linkUrl]);

  /** The state strip's own value, which is also what the `locked` slot reads. */
  const draftStatus = overview.invitation.state;

  /**
   * An accepted invitation is immutable. Until claim, Admin may correct the
   * recipient/content and resend; the resend rotates the bearer link and
   * preserves the prior delivery snapshot in history.
   *
   * The reference calls that first state `Draft`; this product's own vocabulary
   * for it is `Not sent` (`INVITATION_STATES` in `founders/logic.ts`, the seven
   * values `deriveInvitationState` returns). Comparing against the literal
   * `'Draft'` matched none of them, so the fieldset was locked for every
   * Founder including a brand-new one — the whole screen was read-only.
   *
   * `campaign_invitation_sends` snapshots each delivery, so edits do not rewrite
   * what previously went out. The new values become effective only when Admin
   * explicitly resends or creates a replacement link.
   */
  const locked = draftStatus === 'Invite accepted';

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

  const saveOverride = (
    key: 'recipientName' | 'recipientEmail' | 'product',
    next: string,
    current: string,
  ) => {
    if (locked || next === current) return;
    void persist(() => setFounderInvitationOverride(header.prospectId, key, next));
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

  const readyToSend = inviteFieldsReady({
    name,
    business,
    problem,
    solution,
    views,
    email,
    username,
    matches,
    affiliateTypes,
    voice1,
    voice2,
  });

  const sends = overview.invitation.sends ?? [];
  const sendCount = overview.invitation.facts?.sendCount ?? sends.length;

  const composeVisibleInvitation = () =>
    composeInvitation(draftId, {
      whatWeUnderstood: `Problem: ${problem.trim()}\n\nSolution: ${solution.trim()}`,
      whyInvited: `Proovd prepared this invitation after reviewing ${business.trim()}.`,
      expectedSetupTime: 'Allow about 20 minutes for the guided setup.',
    });

  const saveVisibleSnapshot = () =>
    Promise.all([
      setFounderInvitationOverride(header.prospectId, 'recipientName', name),
      setFounderInvitationOverride(header.prospectId, 'product', business),
      prefillVetting(draftId, { problem, solution }),
      setFounderInvitationOverride(header.prospectId, 'recipientEmail', email),
      saveFounderPrefills(draftId, {
        viewsCount: countOrNull(views),
        username: username.trim() || null,
        affiliateMatches: countOrNull(matches),
        affiliateType: affiliateTypes[0] || null,
        affiliateTypes,
        brandVoice1: voice1.trim() || null,
        brandVoice2: voice2.trim() || null,
      }),
    ]);

  const send = () =>
    persist(async () => {
      setBusy('sending');
      await saveVisibleSnapshot();
      await composeVisibleInvitation();
      const result = sendCount > 0
        ? await resendFounderInvitation(header.prospectId)
        : await sendFounderInvitation(header.prospectId);
      setLinkUrl(result.invitationUrl);
      setSent(
        result.resent
          ? 'A new invitation was sent — the previous link stopped working.'
          : 'Invitation sent.',
      );
    });

  const createLink = () =>
    persist(async () => {
      setBusy('sending');
      setLinkStatus(null);
      await saveVisibleSnapshot();
      await composeVisibleInvitation();
      const result = await createFounderInvitationLink(header.prospectId);
      setLinkUrl(result.invitationUrl);
      setLinkStatus(
        result.resent
          ? 'Replacement link created. The previous link no longer works.'
          : 'Invitation link created.',
      );
    });

  const copyLink = async () => {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
    } catch {
      const input = document.querySelector<HTMLInputElement>('#founder-invitation-link');
      input?.select();
      document.execCommand('copy');
    }
    setLinkStatus('Invitation link copied.');
  };

  /* The action bar's one status line, in priority order. */
  const statusLine = (() => {
    if (sent) return sent;
    if (locked) return 'Invitation accepted — it can no longer be edited or resent';
    const refusal = refusalLine(error);
    if (refusal) return refusal;
    if (busy === 'sending') return 'Sending…';
    if (busy === 'saving') return 'Saving…';
    if (busy === 'saved') return `Saved ${absoluteTime(new Date().toISOString())}`;
    return readyToSend
      ? 'Every required field is valid'
      : 'Complete valid email, views and affiliate-count values';
  })();

  const version =
    p.invitation?.version ??
    overview.invitation.facts?.tokenVersion ??
    overview.invitation.tokenVersion ??
    null;
  const reminders = p.invitation?.reminders ?? (sendCount > 0 ? sendCount - 1 : null);

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
          next={draftStatus === 'Invite accepted' ? 'Onboarding' : 'Founder reviews and accepts'}
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
                  onBlur={() =>
                    saveOverride(
                      'recipientName',
                      name,
                      invitationValue('recipientName', header.preferredName),
                    )
                  }
                />
              </label>
              <label>
                <span>Business Name</span>
                <input
                  value={business}
                  onChange={(e) => setBusiness(e.target.value)}
                  onBlur={() =>
                    saveOverride(
                      'product',
                      business,
                      invitationValue('product', header.businessName ?? ''),
                    )
                  }
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
              <span>{5 + affiliateTypes.length} fields</span>
            </div>
            <div className="prefill-grid">
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() =>
                    saveOverride(
                      'recipientEmail',
                      email,
                      invitationValue('recipientEmail', header.email),
                    )
                  }
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
                  onChange={(e) => {
                    const next = e.target.value;
                    setMatches(next);
                    const count = countOrNull(next);
                    setAffiliateTypes(
                      creatorTypesForCount(count ?? 0, affiliateTypes, affiliateTypes[0]),
                    );
                  }}
                  onBlur={() => savePrefill({ affiliateMatches: countOrNull(matches) })}
                />
              </label>
              {affiliateTypes.map((affiliateType, index) => (
                <label key={index}>
                  <span>Creator type {index + 1}</span>
                  <select
                    value={affiliateType}
                    onChange={(e) => {
                      const selected = e.target.value;
                      const next = affiliateTypes.map((value, itemIndex) =>
                        itemIndex === index || (index === 0 && value === '') ? selected : value,
                      );
                      setAffiliateTypes(next);
                      if (next.every(Boolean)) {
                        savePrefill({
                          affiliateMatches: countOrNull(matches),
                          affiliateType: next[0] || null,
                          affiliateTypes: next,
                        });
                      }
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
              ))}
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

        <section className="invite-link-panel" aria-labelledby="founder-invitation-link-heading">
          <div>
            <p className="dialog-kicker">Founder invitation link</p>
            <h2 id="founder-invitation-link-heading">Copy and send it directly</h2>
            <p>
              Use this when the invitation email does not arrive. Creating a replacement link
              immediately disables the previous one.
            </p>
          </div>
          <label htmlFor="founder-invitation-link">Active invite link</label>
          <div className="invite-link-row">
            <input
              id="founder-invitation-link"
              value={
                linkUrl ||
                (overview.invitation.linkNeedsReplacement
                  ? 'Existing link must be replaced before it can be copied'
                  : draftStatus === 'Invite accepted'
                    ? 'Invitation accepted — no active claim link'
                    : 'No copyable invitation link yet')
              }
              readOnly
              aria-describedby="founder-invitation-link-status"
            />
            {linkUrl ? (
              <button type="button" onClick={() => void copyLink()}>Copy link</button>
            ) : null}
            {!locked ? (
              <button
                type="button"
                onClick={() => void createLink()}
                disabled={!readyToSend || busy === 'sending'}
              >
                {overview.invitation.linkNeedsReplacement ? 'Replace link' : 'Create link'}
              </button>
            ) : null}
          </div>
          <small id="founder-invitation-link-status" role="status">
            {linkStatus ??
              (linkUrl
                ? 'This is the currently active link.'
                : 'The link is available only to authenticated Admin users.')}
          </small>
        </section>

        <div className="actionbar">
          <div>
            <small>{statusLine}</small>
          </div>
          <div className="action-buttons">
            <button
              type="button"
              onClick={() => {
                saveVisibleSnapshot()
                  .then(() => composeVisibleInvitation())
                  .then(() => previewInvitation(draftId))
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
              disabled={locked || !readyToSend || busy === 'sending'}
            >
              {locked
                ? 'Invitation accepted'
                : sendCount > 0
                  ? 'Save edits & resend email'
                  : 'Send invite email'}
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
