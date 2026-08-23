/**
 * Stage 5 — Matching. Spec §14.2, §14.3, §25.6, §26.2.
 *
 * The reference's own arrangement: four summary tiles, the add-an-offer form,
 * the Founder-dashboard offer list, the policy note, and the action bar.
 *
 * ── The compensation model, and the one thing this screen must never do ─────
 * The reference lets an Admin set a percentage and publish it. §14.2 keeps
 * acceptance bilateral: the Creator proposes, the Founder accepts, and Admin is
 * not a party. `routes/admin-decisions.ts` records that the ABSENT accept route
 * is the enforcement — "Admin cannot substitute for either party's acceptance"
 * — and `affiliates/decisions.ts`: "Admin mediates; Admin never agrees."
 *
 * Migration 0059 resolves the two by making the Admin's percentage an OFFER and
 * nothing more. `association_admin_offers` writes no `proposal_versions` row,
 * so `proposal_party` never needs an `admin` value, migration 0017's two
 * partial unique indexes are untouched, and no acceptance is ever attributed to
 * an Admin. The Founder still answers in their own dashboard, through the route
 * they already use.
 *
 * That is exactly what the `.policy-note` on this screen says, which is why its
 * sentence is reproduced word for word and stays that way. It is not
 * decoration — it is the posture the schema enforces, written down where the
 * person setting the percentage will read it.
 *
 * The percentage is sent as BASIS POINTS. The reference's control is
 * `step="0.1"`; every percent column in the money tree is an `integer` and
 * `shared/money` has a one-implementation rule that a decimal column would fork
 * quietly. 32.5% is 3250, and migration 0059's CHECK holds 10–5000.
 *
 * ── The one thing the route needs that the reference does not collect ──────
 * `POST …/offer` takes `{ offerBasisPoints, internalReason }`, because §25.6
 * requires a recorded decision to state its reason beside the prior value.
 * `Edit percentage` therefore opens the shared manual-edit sheet with
 * `reasonRequired`, which puts the reason in the same sheet as the value.
 * Adding one collects it in the decision sheet on the way through, because the
 * form itself cannot grow a field: `.matching-add-form` places its two labels
 * by `nth-of-type`, so a third would land outside the grid it was drawn for.
 *
 * ── Remove is a withdrawal, not a sanction ─────────────────────────────────
 * It opens the decision sheet (`Remove affiliate offer` / `Remove offer`) and
 * calls `POST …/offer/withdraw`. It deliberately does NOT route through §29
 * enforcement: that path needs seven inputs, records an action against the
 * Creator's standing, and notifies them of a sanction. Taking an offer back off
 * a dashboard is none of those things.
 *
 * ── One local sheet ────────────────────────────────────────────────────────
 * `Open dossier` and `Payment model` are the reference's record sheet — kicker
 * `Record`, a `pre.detail-copy`, one `Done`. The kit's `ValueDialog` is a
 * different object (`Saved content`, paragraphs), and `.detail-copy` is what
 * pins this sheet to the narrow step, so the record sheet is built here.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { prefillAffiliateTypeLabel, summarizePrefillAffiliateTypes } from '@proovd/shared';
import { AdminRequestError, call } from '../../api.js';
import { relativeTime } from '../format.js';
import {
  DecisionDialog,
  ManualEditDialog,
  StageFrame,
  StateStrip,
  asRequestError,
  refusalLine,
  type StageProps,
} from './recordGroup.js';
import {
  basisPointsFromPercent,
  percentFromBasisPoints,
  readSupplement,
  type PanelCandidate,
  type PanelOffer,
} from './setupFields.js';

const enc = encodeURIComponent;

/** Said where a row carries no campaign association to write against. */
const NO_ASSOCIATION =
  'This row has no campaign association, so there is nothing to write an offer against.';

/* ── The reference's record sheet ─────────────────────────────────────────── */

function RecordSheet({
  title,
  body,
  onClose,
}: {
  title: string;
  body: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay">
      <section className="dialog" role="dialog" aria-modal="true" ref={ref}>
        <button className="close-button" type="button" onClick={onClose}>
          Close
        </button>
        <p className="dialog-kicker">Record</p>
        <h2>{title}</h2>
        <pre className="detail-copy">{body}</pre>
        <div className="dialog-actions">
          <button className="primary" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    </div>
  );
}

/* ── Readers ──────────────────────────────────────────────────────────────── */

/**
 * The reference's four response words.
 *
 * Everything the 19-state association enum can hold that is not a decided
 * answer is still waiting on the Founder, and saying so is more honest than
 * putting an internal state name in front of somebody on a support call.
 */
function founderResponseLabel(offer: PanelOffer): string {
  const value = (offer.founderResponse ?? '').trim();
  if (value === 'Accepted' || value === 'Declined' || value === 'Expired') return value;
  return 'Waiting for Founder';
}

function audienceLine(offer: PanelOffer): string {
  const parts = [
    offer.followers ? `${offer.followers} followers` : null,
    offer.reach ? `${offer.reach} reach` : null,
    offer.engagement,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Not recorded';
}

/* ── The calls this screen owns ───────────────────────────────────────────── */

const fetchCandidates = (campaignId: string): Promise<{ candidates?: PanelCandidate[] }> =>
  call(`/api/admin/campaigns/${enc(campaignId)}/affiliate-candidates`);

/** A revision supersedes the live row rather than editing it (migration 0059). */
const recordOffer = (
  campaignId: string,
  associationId: string,
  offerBasisPoints: number,
  internalReason: string,
): Promise<unknown> =>
  call(`/api/admin/campaigns/${enc(campaignId)}/affiliates/${enc(associationId)}/offer`, {
    method: 'POST',
    body: JSON.stringify({ offerBasisPoints, internalReason }),
  });

const withdrawOffer = (
  campaignId: string,
  associationId: string,
  reason: string,
): Promise<unknown> =>
  call(
    `/api/admin/campaigns/${enc(campaignId)}/affiliates/${enc(associationId)}/offer/withdraw`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  );

const sendFinalCampaign = (campaignId: string, associationId: string): Promise<unknown> =>
  call(
    `/api/admin/campaigns/${enc(campaignId)}/affiliates/${enc(associationId)}/final-campaign`,
    { method: 'POST', body: JSON.stringify({}) },
  );

/* ── The stage ────────────────────────────────────────────────────────────── */

type OpenDialog =
  | { kind: 'record'; title: string; body: string }
  | { kind: 'add'; associationId: string; name: string; basisPoints: number }
  | { kind: 'edit'; offer: PanelOffer }
  | { kind: 'remove'; offer: PanelOffer }
  | null;

export function MatchingStage({ detail, panel, onSaved, onOpenStage }: StageProps) {
  const supplement = readSupplement(panel);
  const matching = supplement.matching ?? null;
  const campaignId = detail.campaigns.current?.campaignId ?? null;
  const offers = matching?.offers ?? [];
  const model = matching?.paymentModel ?? null;
  const accepted = offers.filter((o) => founderResponseLabel(o) === 'Accepted').length;
  const creatorTypeSummary =
    summarizePrefillAffiliateTypes(supplement.prefills?.affiliateTypes) ??
    prefillAffiliateTypeLabel(supplement.prefills?.affiliateType);

  const [candidates, setCandidates] = useState<PanelCandidate[] | null>(null);
  const [candidateRefusal, setCandidateRefusal] = useState<string | null>(null);
  const [chosen, setChosen] = useState('');
  const [percent, setPercent] = useState('');
  const [open, setOpen] = useState<OpenDialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminRequestError | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    fetchCandidates(campaignId)
      .then((body) => {
        if (cancelled) return;
        setCandidates(body.candidates ?? []);
        setCandidateRefusal(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setCandidates([]);
        setCandidateRefusal(refusalLine(asRequestError(e)) ?? 'The roster could not be read.');
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, detail]);

  function say(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  async function run(work: () => Promise<unknown>, closed: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      setOpen(null);
      say(closed);
      onSaved();
    } catch (e: unknown) {
      setError(asRequestError(e));
    } finally {
      setBusy(false);
    }
  }

  const roster = candidates ?? [];
  const selectPlaceholder = candidateRefusal
    ? candidateRefusal
    : candidates === null
      ? 'Reading the roster…'
      : roster.length === 0
        ? 'No Creator is on this campaign’s roster yet'
        : 'Select an affiliate';

  return (
    <>
      <StageFrame
        stage="Matching"
        heading="Affiliates and dashboard offers"
        lead="Choose each affiliate and set the percentage. Every added offer appears directly in the Founder dashboard."
      >
        <StateStrip
          status={matching?.status ?? 'Negotiating'}
          lastChange={
            matching?.lastChange ? relativeTime(matching.lastChange) : 'No offer recorded yet'
          }
          next="Founder reviews the offers"
        />

        <div className="record-groups">
          <section className="split-summary">
            <div>
              <span>Possible matches</span>
              <strong>{supplement.prefills?.affiliateMatches ?? 'Not prefilled'}</strong>
              <small>
                {creatorTypeSummary
                  ? `${creatorTypeSummary} · Admin prefill, not calculated`
                  : 'Admin prefill, not calculated'}
              </small>
            </div>
            <div>
              <span>Payment model</span>
              <strong>{model?.model ?? 'Not selected yet'}</strong>
              <small>
                {model?.baseCutPercent === null || model?.baseCutPercent === undefined
                  ? 'Waiting on the Founder’s own §14.3 selection'
                  : `${model.baseCutPercent}% campaign base · ${model.status ?? 'Not acknowledged'}`}
              </small>
            </div>
            <div>
              <span>Affiliate offers</span>
              <strong>{offers.length}</strong>
              <small>All visible in the Founder dashboard</small>
            </div>
            <div>
              <span>Founder responses</span>
              <strong>{accepted} accepted</strong>
              <small>Read-only here · Founder responds in their dashboard</small>
            </div>
          </section>

          <form
            className="matching-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              const basisPoints = basisPointsFromPercent(percent);
              if (!chosen || basisPoints === null) {
                say('Choose a Creator and enter 0.1–50%');
                return;
              }
              const candidate = roster.find((c) => c.associationId === chosen);
              setError(null);
              setOpen({
                kind: 'add',
                associationId: chosen,
                name: candidate?.name ?? 'this Creator',
                basisPoints,
              });
            }}
          >
            <div>
              <h2>Add an affiliate offer</h2>
              <p>
                Choose the affiliate and set the exact percentage. Adding it publishes the offer to
                the Founder dashboard.
              </p>
            </div>
            <label>
              <span>Affiliate</span>
              <select
                required
                value={chosen}
                onChange={(e) => setChosen(e.target.value)}
                disabled={!campaignId || roster.length === 0}
              >
                <option value="">{selectPlaceholder}</option>
                {roster.map((c) => (
                  <option
                    key={c.associationId ?? c.prospectId ?? c.name ?? ''}
                    value={c.associationId ?? ''}
                    disabled={Boolean(c.offered)}
                  >
                    {[c.name, c.handle].filter(Boolean).join(' · ')}
                    {c.offered ? ' · Added' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Percentage set by Admin</span>
              <div className="percentage-input">
                <input
                  type="number"
                  min="0.1"
                  max="50"
                  step="0.1"
                  placeholder="30"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                />
                <b>%</b>
              </div>
            </label>
            <button className="primary" type="submit" disabled={busy || !campaignId}>
              Add to Founder dashboard
            </button>
          </form>

          <section className="creator-records">
            <header>
              <h2>Founder dashboard offers</h2>
              <span>Admin controls the affiliates and percentages</span>
            </header>

            {offers.map((offer, index) => {
              const id = offer.associationId ?? offer.prospectId ?? `offer-${index}`;
              const pct = percentFromBasisPoints(offer.offerBasisPoints);
              const response = founderResponseLabel(offer);
              const finalCampaign = offer.finalCampaignStatus ?? 'Not sent';
              const visible =
                offer.visibleInFounderDashboard === false ||
                offer.offerBasisPoints === null ||
                offer.offerBasisPoints === undefined
                  ? 'Not visible'
                  : 'Visible';
              const writable = Boolean(campaignId && offer.associationId);

              return (
                <article className="creator-record" key={id}>
                  <div className="creator-main">
                    <span>{offer.handle ?? 'No handle recorded'}</span>
                    <h3>{offer.name ?? 'Unnamed'}</h3>
                    <p>{offer.fit ?? 'No fit note is recorded on this association.'}</p>
                  </div>
                  {/* DOM order is Audience, percentage, dashboard, response,
                      final campaign. The stylesheet places them by `nth-child`,
                      so changing this order silently rearranges the card. */}
                  <dl>
                    <div>
                      <dt>Audience</dt>
                      <dd>{audienceLine(offer)}</dd>
                    </div>
                    <div>
                      <dt>Admin-set percentage</dt>
                      <dd>{pct ?? 'No offer recorded'}</dd>
                    </div>
                    <div>
                      <dt>Founder dashboard</dt>
                      <dd>{visible}</dd>
                    </div>
                    <div>
                      <dt>Founder response</dt>
                      <dd>{response}</dd>
                    </div>
                    <div>
                      <dt>Final campaign</dt>
                      <dd>{finalCampaign}</dd>
                    </div>
                  </dl>
                  <div className="inline-actions">
                    <button
                      type="button"
                      onClick={() =>
                        setOpen({
                          kind: 'record',
                          title: offer.name ?? 'Unnamed',
                          body: [
                            offer.handle ?? 'No handle recorded',
                            `Followers: ${offer.followers ?? 'Not recorded'}`,
                            `Reach: ${offer.reach ?? 'Not recorded'}`,
                            `Engagement: ${offer.engagement ?? 'Not recorded'}`,
                            `Fit: ${offer.fit ?? 'Not recorded'}`,
                            `Admin-set percentage: ${pct ?? 'No offer recorded'}`,
                            `Founder dashboard: ${visible}`,
                            `Founder response: ${response}`,
                            `Final campaign: ${finalCampaign}`,
                          ].join('\n'),
                        })
                      }
                    >
                      Open dossier
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        writable ? setOpen({ kind: 'edit', offer }) : say(NO_ASSOCIATION)
                      }
                    >
                      Edit percentage
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        writable ? setOpen({ kind: 'remove', offer }) : say(NO_ASSOCIATION)
                      }
                    >
                      Remove
                    </button>
                    {response === 'Accepted' && finalCampaign === 'Not sent' ? (
                      <button
                        className="primary"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          writable
                            ? void run(
                                () =>
                                  sendFinalCampaign(
                                    campaignId as string,
                                    offer.associationId as string,
                                  ),
                                `Final campaign sent to ${offer.name ?? 'the Creator'}`,
                              )
                            : say(NO_ASSOCIATION)
                        }
                      >
                        Send final campaign
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </section>

          {/* §14.2's posture, in the words the schema enforces. Verbatim. */}
          <section className="policy-note">
            <strong>What happens next</strong>
            <p>
              The Founder sees each affiliate and Admin-set percentage in their dashboard. The
              Founder responds there; the Admin does not accept, reject or counter offers on this
              page.
            </p>
          </section>

          <div className="actionbar">
            <div>
              <small>
                {refusalLine(error) ??
                  'Campaign Setup can open once at least one affiliate offer is visible in the Founder dashboard'}
              </small>
            </div>
            <div className="action-buttons">
              <button
                type="button"
                onClick={() =>
                  setOpen({
                    kind: 'record',
                    title: 'Creator payment model',
                    body: [
                      model?.model ?? 'No model selected yet',
                      `Base cut: ${
                        model?.baseCutPercent === null || model?.baseCutPercent === undefined
                          ? 'Not recorded'
                          : `${model.baseCutPercent}%`
                      }`,
                      `Representative: ${model?.representative ?? 'Not recorded'}`,
                      `Status: ${model?.status ?? 'Not acknowledged'}`,
                    ].join('\n'),
                  })
                }
              >
                Payment model
              </button>
              <button
                className="primary"
                type="button"
                disabled={offers.length === 0}
                onClick={() =>
                  onOpenStage
                    ? onOpenStage('setup')
                    : say('The record shell did not hand this stage a way to move between stages.')
                }
              >
                Open Campaign Setup
              </button>
            </div>
          </div>
        </div>
      </StageFrame>

      {open?.kind === 'record' ? (
        <RecordSheet title={open.title} body={open.body} onClose={() => setOpen(null)} />
      ) : null}

      {open?.kind === 'add' && campaignId ? (
        <DecisionDialog
          kicker="Admin decision"
          heading="Add affiliate offer"
          lead={`Record why ${open.name} is being offered ${percentFromBasisPoints(open.basisPoints)} on this campaign. The offer is published to the Founder dashboard, and the Founder answers it there — this records the offer, not an agreement.`}
          submitLabel="Add to Founder dashboard"
          busy={busy}
          refusal={refusalLine(error)}
          onClose={() => setOpen(null)}
          onDecide={(reason) =>
            void run(async () => {
              await recordOffer(campaignId, open.associationId, open.basisPoints, reason);
              setChosen('');
              setPercent('');
            }, 'Offer added to the Founder dashboard')
          }
        />
      ) : null}

      {open?.kind === 'edit' && campaignId ? (
        <ManualEditDialog
          label={`Percentage · ${open.offer.name ?? 'Unnamed'}`}
          initialValue={
            open.offer.offerBasisPoints === null || open.offer.offerBasisPoints === undefined
              ? ''
              : String(open.offer.offerBasisPoints / 100)
          }
          reasonRequired
          busy={busy}
          refusal={refusalLine(error)}
          onClose={() => setOpen(null)}
          onSave={(value, reason) => {
            const basisPoints = basisPointsFromPercent(value);
            if (basisPoints === null) {
              say('Choose a Creator and enter 0.1–50%');
              return;
            }
            /* A revision supersedes the live row rather than editing it, so it
               posts to the same offer route the add does (migration 0059). */
            void run(
              () =>
                recordOffer(campaignId, open.offer.associationId as string, basisPoints, reason),
              'Offer revised',
            );
          }}
        />
      ) : null}

      {open?.kind === 'remove' && campaignId ? (
        <DecisionDialog
          kicker="Admin decision"
          heading="Remove affiliate offer"
          lead={`Remove ${open.offer.name ?? 'this Creator'} and their ${
            percentFromBasisPoints(open.offer.offerBasisPoints) ?? 'recorded'
          } offer from the Founder dashboard. This withdraws an offer and is not an enforcement action against the Creator.`}
          submitLabel="Remove offer"
          busy={busy}
          refusal={refusalLine(error)}
          onClose={() => setOpen(null)}
          onDecide={(reason) =>
            void run(
              () => withdrawOffer(campaignId, open.offer.associationId as string, reason),
              'Offer withdrawn from the Founder dashboard',
            )
          }
        />
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </>
  );
}
