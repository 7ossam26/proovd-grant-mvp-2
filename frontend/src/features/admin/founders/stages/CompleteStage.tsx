/**
 * Stage 11 — Complete. Spec §22.9, §22.10, §25.7, §25.8, §26.7, §27.1, §29.6, §30.
 *
 * The one true ending in the product: the four-tile final result, the wrap
 * timeline that explains how those numbers were arrived at, the Creator
 * records, the two archive decisions, and the Founder's campaign list.
 *
 * ── This stage has no action bar ────────────────────────────────────────────
 * Confirmed absent in the reference, and structurally right: the screen's one
 * commitment — "Approve and create new campaign" — lives inside
 * `.archive-actions`, downstream of the application review that unlocks it. The
 * `→` between those two controls is a `::before` mark supplied by CSS and is
 * NOT copy; the right-hand column also reverses their order in CSS, so the DOM
 * order here is the quiet control first and the commitment second.
 *
 * ── Where each control actually goes ───────────────────────────────────────
 * Preview wrap        → local, over the wrap lines the record already sent.
 * Export Backers CSV  → a Blob written from the rows already on the page. It
 *                       fetches nothing, so §25.7's line between seeing and
 *                       exporting stays exactly where it already was.
 * Data-access decisions → GET /api/admin/backers/data-requests, listed in a
 *                       dialog. The decide route is §26.7's freshness-gated
 *                       POST and is a per-request decision rather than
 *                       something this list control can carry.
 * Open application review → the record shell's own stage switch, so the
 *                       reference's "go to review" is real navigation rather
 *                       than a button that looks like it.
 * Approve and create new campaign → POST /api/admin/campaigns/:id/next-readiness
 *                       with decision `ready`. §22.10's readiness decision is
 *                       the record a new campaign actually waits on; nothing
 *                       here creates a campaign behind it.
 *
 * ── Two controls that are drawn and inert, and why ─────────────────────────
 * 1. `Send work-again request`. §22.9 makes this the Founder's own ask and its
 *    route is Founder-scoped (`POST /api/founder/campaigns/:id/work-again`). An
 *    Admin control posting there would be Admin acting as the Founder.
 * 2. The archive rows. Switching the record to another campaign is the shell's
 *    navigation, and this stage is handed no affordance for it.
 *
 * ── Cooldown is derived, and its blocker is part of the answer ─────────────
 * §29.6 keeps the cooldown date out of storage on purpose — it is derived by
 * `nextCampaignEarliestAt`. A bare date with no blocker beside it reads as "no
 * wait", so when the route cannot compute one the tile says so and names what
 * it is waiting on rather than showing a plausible date.
 *
 * ── The wrap is composed once, upstream ────────────────────────────────────
 * `readFounderWrap` already composes this timeline, and it deliberately sorts
 * Creators by handle rather than by Backer count. The reference sorts by
 * Backers and badges the top three, which is a public ranking of people — §30
 * bans that outright, and a sorted list is still a ranking because the order is
 * the claim. So this file renders the route's order and never re-sorts, never
 * badges, and never builds a second wrap.
 *
 * ── One reference bug kept ─────────────────────────────────────────────────
 * `${n} campaign records` has no singular, so a Founder with one campaign reads
 * "1 campaign records". That literal is kept because the directory count reads
 * the same way and the two must agree.
 */

import { useState } from 'react';
import { call } from '../../api.js';
import {
  DecisionDialog,
  StageFrame,
  StateStrip,
  ValueDialog,
  asRequestError,
  downloadFile,
  refusalLine,
  usd,
  type StageProps,
} from './recordGroup.js';
import { absoluteTime } from '../format.js';

/* ── The routes this stage calls ──────────────────────────────────────────── */

interface DataRequestRow {
  id?: string | null;
  purpose?: string | null;
  detail?: string | null;
  decision?: string | null;
  requestedAt?: string | null;
}

const readDataRequests = (): Promise<{ requests?: readonly DataRequestRow[] | null }> =>
  call('/api/admin/backers/data-requests');

/** §22.10's next-campaign readiness — the record a reapplication waits on. */
const decideNextReadiness = (
  campaignId: string,
  body: { decision: string; criteriaNote: string; customerExplanation: string },
): Promise<unknown> =>
  call(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/next-readiness`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/* ── The panel supplement, read optimistically ────────────────────────────── */

interface WrapEntry {
  /** The phase gutter — `Launch`, `Creator work`, `Backers`, `Final`. */
  phase: string;
  fact: string;
}

interface CompleteCreatorRow {
  id: string;
  name?: string | null;
  handle?: string | null;
  /** `${n} Backers · ${amount} reserved · ${posts}`, composed by the route. */
  summary?: string | null;
}

interface CompleteBackerRow {
  id: string;
  name?: string | null;
  reward?: string | null;
  subtotalCents?: string | number | null;
  source?: string | null;
  comment?: string | null;
}

interface ArchiveRow {
  campaignId: string;
  name?: string | null;
  type?: string | null;
  /** The stage the record ended in, composed. */
  stage?: string | null;
  completedAt?: string | null;
  current?: boolean | null;
}

interface CompleteSlice {
  statusLabel?: string | null;
  closedAt?: string | null;
  finalResult?: string | null;
  backerCount?: number | null;
  capturedCents?: string | number | null;
  founderNetCents?: string | number | null;
  creatorCount?: number | null;
  creatorTotalCents?: string | number | null;
  cooldown?: {
    /** Derived by `nextCampaignEarliestAt`, never stored (§29.6). */
    earliestAt?: string | null;
    /** Why it cannot be computed. Rendered whenever it is present. */
    blocker?: string | null;
  } | null;
  /** From `readFounderWrap`. Never rebuilt here. */
  wrap?: readonly WrapEntry[] | null;
  creators?: readonly CompleteCreatorRow[] | null;
  backers?: readonly CompleteBackerRow[] | null;
  archive?: readonly ArchiveRow[] | null;
}

function completeSliceOf(panel: unknown): CompleteSlice {
  return (panel as { complete?: CompleteSlice | null } | null | undefined)?.complete ?? {};
}

/* ── Why the two drawn-and-inert controls are inert ───────────────────────── */

const WHY = {
  workAgain:
    'Send work-again request — §22.9 makes this the Founder’s own ask, and its route is Founder-scoped. An Admin control that sent it would be Admin acting as the Founder.',
  archiveRow:
    'Selecting another campaign record from this list is the record shell’s navigation, and this stage is handed no affordance for it. Every row is composed from the workspace payload’s own campaign list.',
} as const;

type Sheet =
  | { kind: 'view'; label: string; lines: string[] }
  | { kind: 'approve_new' };

/* ── The screen ───────────────────────────────────────────────────────────── */

export function CompleteStage({ detail, panel, onSaved, onOpenStage }: StageProps) {
  const { header, campaigns } = detail;
  const c = completeSliceOf(panel);
  const campaignId = campaigns.current?.campaignId ?? '';

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const captured = usd(c.capturedCents);
  const founderNet = usd(c.founderNetCents);
  const creatorTotal = usd(c.creatorTotalCents);
  const wrap = c.wrap ?? [];
  const creators = c.creators ?? [];
  const backers = c.backers ?? [];
  const displayName = header.preferredName || header.legalName;

  /* The archive, current record first — `.campaign-archive > button:first-of-type`
     is what carries §1's selection treatment, so the order is load-bearing. */
  const archive: ArchiveRow[] =
    c.archive && c.archive.length
      ? [...c.archive]
      : [
          ...(campaigns.current
            ? [
                {
                  campaignId: campaigns.current.campaignId,
                  name: campaigns.current.name,
                  type: campaigns.current.type,
                  stage: campaigns.current.status,
                  current: true,
                } satisfies ArchiveRow,
              ]
            : []),
          ...campaigns.previous.map(
            (p): ArchiveRow => ({
              campaignId: p.campaignId,
              name: p.name,
              type: p.type,
              stage: p.status,
            }),
          ),
        ];

  const cooldownBlocked = Boolean(c.cooldown?.blocker) || !c.cooldown?.earliestAt;

  const dismiss = () => {
    setSheet(null);
    setRefusal(null);
  };

  const view = (label: string, lines: string[]) => setSheet({ kind: 'view', label, lines });

  async function submit(run: () => Promise<unknown>) {
    setBusy(true);
    setRefusal(null);
    try {
      await run();
      setBusy(false);
      dismiss();
      onSaved();
    } catch (e: unknown) {
      setBusy(false);
      setRefusal(refusalLine(asRequestError(e)) ?? 'The request did not complete.');
    }
  }

  /**
   * The reference's own CSV, written from the rows already on the page. Nothing
   * is fetched and no column is chosen by the caller, so this exports exactly
   * what the panel was authorised to render.
   */
  const exportBackersCsv = () =>
    downloadFile(
      `${campaignId || header.prospectId}-backers.csv`,
      [
        'Name,Pledge,Source,Comment',
        ...backers.map((b) =>
          [
            b.name ?? '',
            `${b.reward ?? ''} ${usd(b.subtotalCents) ?? ''}`.trim(),
            b.source ?? '',
            b.comment ?? '',
          ]
            .map((cell) => `"${cell.replace(/"/g, '""')}"`)
            .join(','),
        ),
      ].join('\n'),
      'text/csv',
    );

  const openDataAccess = () => {
    readDataRequests()
      .then((r) => {
        const rows = r.requests ?? [];
        view(
          'Data-access requests',
          rows.length
            ? rows.flatMap((row) => [
                `${row.id ?? 'request'} · ${row.decision ?? 'undecided'} · requested ${absoluteTime(
                  row.requestedAt,
                )}`,
                `${row.purpose ?? 'No purpose recorded'} — ${row.detail ?? 'no detail recorded'}`,
              ])
            : ['No requests'],
        );
      })
      .catch((e: unknown) =>
        view('Data-access requests', [
          refusalLine(asRequestError(e)) ?? 'The request queue could not be read.',
        ]),
      );
  };

  return (
    <>
      <StageFrame
        stage="Complete"
        heading="Campaign archive"
        lead="The closed campaign remains intact while cooldown, reapplication, exports and follow-up requests continue."
      >
        <StateStrip
          status={c.statusLabel ?? campaigns.current?.status ?? header.lifecycle}
          lastChange={c.closedAt ? `Campaign closed ${absoluteTime(c.closedAt)}` : 'Campaign closed'}
          next="Cooldown, reapply, then create a new campaign record"
        />

        <div className="record-groups">
          {/* ── the payoff ──────────────────────────────────────────────── */}
          <section className="final-summary">
            <div>
              <span>Final result</span>
              <strong>{c.finalResult ?? 'Not composed'}</strong>
              <small>
                {c.backerCount === null || c.backerCount === undefined
                  ? 'Backer count not composed'
                  : `${c.backerCount} Backers`}
                {' · '}
                {captured ? `${captured} captured` : 'captured total not composed'}
              </small>
            </div>
            <div>
              <span>Founder net</span>
              <strong>{founderNet ?? 'Not composed'}</strong>
              <small>Ledger locked</small>
            </div>
            <div>
              <span>Creators</span>
              <strong>{c.creatorCount ?? creators.length}</strong>
              <small>{creatorTotal ? `${creatorTotal} total` : 'Creator total not composed'}</small>
            </div>
            <div>
              <span>Cooldown</span>
              {/* §29.6: the date is derived, never stored. A date with no
                  blocker beside it would read as "no wait". */}
              <strong>
                {cooldownBlocked ? 'Not yet computable' : absoluteTime(c.cooldown?.earliestAt ?? null)}
              </strong>
              <small>
                {c.cooldown?.blocker ??
                  (cooldownBlocked
                    ? 'The cooldown anchor is not recorded on this campaign yet.'
                    : 'Eligible to apply · not automatically approved')}
              </small>
            </div>
          </section>

          {/* ── the retrospective log ───────────────────────────────────── */}
          <section className="campaign-timeline">
            <header>
              <h2>Founder wrap timeline</h2>
              <button
                type="button"
                onClick={() =>
                  view(
                    'Founder wrap preview',
                    wrap.length
                      ? wrap.map((entry) => `${entry.phase}: ${entry.fact}`)
                      : ['The Founder wrap is not composed on this record yet.'],
                  )
                }
              >
                Preview wrap
              </button>
            </header>
            <ol>
              {wrap.length ? (
                wrap.map((entry) => (
                  <li key={`${entry.phase}-${entry.fact}`}>
                    <time>{entry.phase}</time>
                    <strong>{entry.fact}</strong>
                  </li>
                ))
              ) : (
                <li>
                  <time>Wrap</time>
                  <strong>
                    The Founder wrap is composed once, upstream. This record has not returned it.
                  </strong>
                </li>
              )}
            </ol>
          </section>

          {/* ── the Creator records ─────────────────────────────────────── */}
          <section className="creator-records">
            <header>
              <h2>Creator results and work-again requests</h2>
              <span>Every request is per Creator</span>
            </header>
            {creators.map((creator) => (
              <article className="creator-record compact" key={creator.id}>
                <div className="creator-main">
                  <span>{creator.handle ?? 'Handle not recorded'}</span>
                  <h3>{creator.name ?? 'Creator'}</h3>
                  <p>{creator.summary ?? 'Results not composed for this Creator.'}</p>
                </div>
                <div className="inline-actions">
                  <button type="button" disabled aria-describedby="creators-why">
                    Send work-again request
                  </button>
                </div>
              </article>
            ))}
            <small id="creators-why">{WHY.workAgain}</small>
          </section>

          {/* ── the two archive decisions ───────────────────────────────── */}
          <section className="archive-actions">
            <div>
              <h2>Backer data and retained access</h2>
              <p>
                The closed campaign, exports, agreements, support and payment history remain
                available.
              </p>
              <div className="inline-actions">
                <button type="button" onClick={exportBackersCsv}>
                  Export Backers CSV
                </button>
                <button type="button" onClick={openDataAccess}>
                  Data-access decisions
                </button>
              </div>
            </div>
            <div>
              <h2>Cooldown and reapplication</h2>
              <p>
                Cooldown eligibility is not approval. A new campaign begins only after a separate
                application decision.
              </p>
              {/* CSS reverses these two and draws a → between them; the arrow is
                  a ::before mark and is not in the DOM. */}
              <div className="inline-actions">
                <button
                  type="button"
                  disabled={!onOpenStage}
                  onClick={() => onOpenStage?.('review')}
                >
                  Open application review
                </button>
                <button
                  className="primary"
                  type="button"
                  disabled={busy}
                  onClick={() => setSheet({ kind: 'approve_new' })}
                >
                  Approve and create new campaign
                </button>
              </div>
              {refusal ? <p>{refusal}</p> : null}
            </div>
          </section>

          {/* ── the Founder's campaign list ─────────────────────────────── */}
          <section className="campaign-archive">
            <header>
              <h2>{displayName}’s campaign archive</h2>
              <span>{archive.length} campaign records</span>
            </header>
            {archive.map((row) => (
              <button key={row.campaignId} type="button" disabled aria-describedby="archive-why">
                <span>
                  <strong>{row.name ?? 'Campaign'}</strong>
                  <small>{row.campaignId}</small>
                </span>
                <span>{row.type ?? 'Type not recorded'}</span>
                <span>{row.stage ?? 'Stage not recorded'}</span>
                <span>
                  {row.current
                    ? 'Current campaign'
                    : row.completedAt
                      ? absoluteTime(row.completedAt)
                      : 'Completion date not recorded'}
                </span>
              </button>
            ))}
            <small id="archive-why">{WHY.archiveRow}</small>
          </section>
        </div>
      </StageFrame>

      {sheet?.kind === 'view' ? (
        <ValueDialog label={sheet.label} lines={sheet.lines} onClose={dismiss} />
      ) : null}

      {sheet?.kind === 'approve_new' ? (
        <DecisionDialog
          kicker="Reapplication"
          heading="Approve and create new campaign"
          lead="§22.10's readiness decision is the record a new campaign waits on. Approving it records the criteria met; it does not create the campaign."
          submitLabel="Approve"
          withCustomerExplanation
          busy={busy}
          refusal={refusal}
          onDecide={(criteriaNote, customerExplanation) =>
            void submit(() =>
              decideNextReadiness(campaignId, {
                decision: 'ready',
                criteriaNote,
                customerExplanation,
              }),
            )
          }
          onClose={dismiss}
        />
      ) : null}
    </>
  );
}
