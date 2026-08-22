/**
 * Stage 8 — Live. Spec §17, §18, §20, §21, §25.7, §27.1, §29, §30, §33.8.13.
 *
 * The reference's own five bands, in its order: the six-number KPI field with
 * the live Backer count as its one hero, the campaign rail, the Founder-request
 * queue, the captured Creator posts, and the attribution table. This stage has
 * **no `.actionbar`** — confirmed absent in the reference, and correctly so:
 * there is no stage-level progression here, only per-record decisions sitting
 * on the records they act on.
 *
 * ── Where each control actually goes ───────────────────────────────────────
 * Pause          → POST /api/admin/campaigns/:id/enforcement, action `suspend`
 * Resume         → the same route, and it refuses: `enforcement_action` admits
 *                  only `suspend` and `kill`, so there is no un-suspend. The
 *                  control is drawn as the reference draws it and the server's
 *                  own refusal renders — it never reports a save.
 * End early      → POST /api/admin/close/:id/resume. The close batch is the
 *                  only thing that ends a campaign, and it refuses until
 *                  `campaign_close_at` has passed. `kill` was NOT used: it is
 *                  terminal and skips the success-rule check this dialog
 *                  promises to run.
 * Approve / Deny → POST /api/admin/live/change-requests/:requestId
 * Approve post   → POST /api/admin/post-submissions/:id/verify, outcome
 *                  `passed`, carrying the recorded checklist; the server names
 *                  the failed checks if any is missing.
 * Request changes (post) → the same route, outcome `correction_needed`.
 * The three reads — Open public campaign, Preview as Backer, Open — are detail
 * dialogs exactly as the reference has them, and Export Admin report writes a
 * Blob from what is already on the page. None of the four needs a route.
 *
 * ── Two controls that are drawn and inert, and why ─────────────────────────
 * 1. `Request changes` on a Founder request. `campaign_change_requests.status`
 *    is CHECK-pinned to `open` / `applied` / `declined`, and the decide route
 *    turns anything that is not the literal `applied` into a decline with no
 *    error. Wiring this control would silently DENY the Founder's request while
 *    telling the Admin it asked for changes — the one case on this screen where
 *    calling the closest route is worse than not calling it.
 * 2. `Founder reported an issue`. `founder_post_acknowledgements` is
 *    acknowledge-only — seven columns, no free text, no UPDATE or DELETE grant
 *    — so nothing stores an Admin-recorded Founder issue, and the post verify
 *    route would record a rejection, which is a different decision.
 *
 * ── Nothing on this screen computes money, a percentage or a split ──────────
 * Every figure arrives as integer cents and goes through the one shared
 * `usd()`; every ratio arrives already composed. The reference does both of its
 * ratios in the browser with `Math.round(a / b * 100)`, which is arithmetic
 * with no `prior_value` to audit against (§33.8.13). A figure the panel has not
 * composed renders its own absence and never a zero (§1.4).
 *
 * ── One word this screen carries by explicit product direction ─────────────
 * The third KPI reads `Founder goal`, verbatim from the reference. §3.2 lists
 * that word among the universally banned terms and
 * `frontend/src/features/qa/bundle.test.ts` scans the built bundle for it, so
 * this is a recorded departure rather than an oversight — reversing it needs
 * the same kind of instruction that created it.
 *
 * ── Load-bearing CSS this file must not "tidy" ──────────────────────────────
 * - `.post-preview-media`'s outer/inner rectangles and `.post-avatar`'s inner
 *   square are `::before`/`::after`. There is NO DOM node for either.
 * - The `image` / `video` class on `.post-preview-media` selects the 4:5 vs
 *   9:16 ratio through `:has()`. It is content, not decoration.
 * - `.live-post-heading > strong` carries no class and is dressed by an element
 *   selector; adding `status-tag` would apply the treatment twice.
 * - `.live-controls > div:last-child > button:nth-child(4)` cuts the two
 *   campaign-stopping controls away from the routine three, so that row holds
 *   buttons and nothing else.
 * - `.attention-line`'s trailing arrow is a `::after` mark, not copy.
 */

import { useEffect, useRef, useState } from 'react';
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
import { Overlay } from '../dialogs/Overlay.js';
import { absoluteTime } from '../format.js';

/* ── The panel supplement, read optimistically ────────────────────────────── */

/**
 * Every field is optional on purpose: this is a statement of what the screen
 * renders if the route composes it, not a claim that it does. A key that has
 * not arrived renders its own absence with a reason, never a plausible default.
 */
interface LiveRequestRow {
  id: string;
  /** The category locator above the subject — "Page update", "Refund", … */
  type?: string | null;
  title?: string | null;
  detail?: string | null;
  status?: string | null;
  tone?: 'action' | 'waiting' | null;
  createdAt?: string | null;
  reference?: string | null;
  /** `Approve and publish` on a page update, `Approve` otherwise. */
  approveLabel?: string | null;
}

interface CreatorPostRow {
  id: string;
  creator?: string | null;
  handle?: string | null;
  platform?: string | null;
  /** A label map only: `submitted` to Needs review, `passed` to Live (§17). */
  status?: string | null;
  needsReview?: boolean | null;
  submitted?: string | null;
  /** Composed — there is no per-submission tracking-validity column. */
  tracking?: string | null;
  /** The observed disclosure text, not the stored pass/fail boolean. */
  disclosure?: string | null;
  url?: string | null;
  /** Load-bearing: it selects the platform's real aspect ratio. */
  media?: 'image' | 'video' | null;
  format?: string | null;
  previewLabel?: string | null;
  previewTitle?: string | null;
  caption?: string | null;
  /** The §17 seven-check record, sent back verbatim when approving. */
  checklist?: Record<string, boolean> | null;
}

interface CreatorPerformanceRow {
  id: string;
  name?: string | null;
  handle?: string | null;
  /** Composed, e.g. `30%`. Never derived here from basis points. */
  percentage?: string | null;
  percentageNote?: string | null;
  backers?: number | null;
  reservedCents?: string | number | null;
  clicks?: string | null;
  posts?: string | null;
}

interface LiveSlice {
  attention?: string | null;
  campaignState?: string | null;
  publicVersion?: number | null;
  publicCampaignUrl?: string | null;
  activeBackers?: number | null;
  reservedBeforeTaxCents?: string | number | null;
  /** The reference's third KPI. Integer cents; the ratio beside it is composed. */
  goalCents?: string | number | null;
  /** `${pct}% reserved`, composed server-side — never divided in the browser. */
  goalNote?: string | null;
  campaignLimitCents?: string | number | null;
  campaignLimitNote?: string | null;
  /** The disclosed success rule, composed. */
  successRule?: string | null;
  refundsUrl?: string | null;
  cancellations?: number | null;
  /** The ISO instant behind `campaigns.campaign_close_at`. */
  closeAt?: string | null;
  requests?: readonly LiveRequestRow[] | null;
  openRequests?: string | null;
  posts?: readonly CreatorPostRow[] | null;
  postsSummary?: string | null;
  creatorPerformance?: readonly CreatorPerformanceRow[] | null;
}

function liveSliceOf(panel: unknown): LiveSlice {
  return (panel as { live?: LiveSlice | null } | null | undefined)?.live ?? {};
}

/* ── The routes this stage calls ──────────────────────────────────────────── */

/**
 * §29's campaign enforcement. `action` is a Postgres enum with exactly two
 * values, and `reasonCategory` is the eight-value register the GET returns —
 * which is why the Pause sheet renders a real select rather than this file
 * choosing a category on an Admin's behalf (§1 rule 6).
 */
interface EnforcementRead {
  reasonCategories?: readonly { id: string; label: string }[] | null;
}

const readEnforcement = (campaignId: string): Promise<EnforcementRead> =>
  call(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/enforcement`);

const recordEnforcement = (
  campaignId: string,
  body: {
    action: string;
    reasonCategory: string;
    reasonDetail: string;
    customerExplanation: string;
  },
): Promise<unknown> =>
  call(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/enforcement`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/** Re-runs the close batch. Refuses until the recorded close time has passed. */
const runClose = (campaignId: string): Promise<unknown> =>
  call(`/api/admin/close/${encodeURIComponent(campaignId)}/resume`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

/** §20's live-editing decision. `applied` publishes; anything else declines. */
const decideChangeRequest = (
  requestId: string,
  body: { decision: string; decisionReason: string },
): Promise<unknown> =>
  call(`/api/admin/live/change-requests/${encodeURIComponent(requestId)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/** §17's first-post verification. A `passed` needs every check true. */
const verifyPost = (
  submissionId: string,
  body: { outcome: string; checklist: Record<string, boolean>; correctionDetail?: string },
): Promise<unknown> =>
  call(`/api/admin/post-submissions/${encodeURIComponent(submissionId)}/verify`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/* ── Why the two drawn-and-inert controls are inert ───────────────────────── */

const WHY = {
  requestChanges:
    'Request changes — campaign_change_requests.status is pinned to open, applied or declined, and the decide route turns anything that is not applied into a decline with no error. Sending this would deny the Founder’s request while telling you it asked for changes.',
  founderIssue:
    'Founder reported an issue — founder_post_acknowledgements is acknowledge-only: seven columns, no free text, no UPDATE or DELETE grant. Nothing stores an Admin-recorded Founder issue, and the post verify route would record a rejection, which is a different decision.',
} as const;

/* ── Time ─────────────────────────────────────────────────────────────────── */

/**
 * The close moment, local primary with UTC secondary (§27.1).
 *
 * A bare ISO instant on a deadline is a §27.1 violation because the trailing Z
 * spells nothing out to a reader. Where only the workspace's UTC-rendered
 * string is available the tile says UTC rather than pretending the reader's
 * zone was applied; where nothing is recorded it says that, rather than showing
 * a date nobody set.
 */
function closeMoment(
  iso: string | null | undefined,
  recorded: string | null | undefined,
): { day: string; time: string } {
  if (iso) {
    const at = new Date(iso);
    if (!Number.isNaN(at.getTime())) {
      const local = at.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      });
      const utc = at.toLocaleTimeString(undefined, {
        timeZone: 'UTC',
        hour: 'numeric',
        minute: '2-digit',
      });
      return {
        day: at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        time: `${local} · ${utc} UTC`,
      };
    }
  }
  if (recorded) {
    const [day, ...rest] = recorded.split(' · ');
    return { day, time: rest.join(' · ') || 'Recorded in UTC' };
  }
  return { day: 'Not scheduled', time: 'No close time is recorded on this campaign' };
}

/* ── What is open ─────────────────────────────────────────────────────────── */

type Sheet =
  | { kind: 'view'; label: string; lines: string[] }
  | { kind: 'stop'; action: 'suspend' | 'resume' }
  | { kind: 'end_early' }
  | { kind: 'request'; row: LiveRequestRow; decision: 'applied' | 'declined' }
  | { kind: 'post_changes'; row: CreatorPostRow };

/* ── The screen ───────────────────────────────────────────────────────────── */

export function LiveStage({ detail, panel, onSaved }: StageProps) {
  const { header, campaigns } = detail;
  const live = liveSliceOf(panel);
  const campaignId = campaigns.current?.campaignId ?? '';
  const requestCenter = useRef<HTMLElement>(null);

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [categories, setCategories] = useState<readonly { id: string; label: string }[]>([]);
  const [category, setCategory] = useState('');

  /* The eight §29 reason categories come from the route that enforces them, so
     the select can never offer a value the server would refuse. */
  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    readEnforcement(campaignId)
      .then((r) => {
        if (!cancelled) setCategories(r.reasonCategories ?? []);
      })
      .catch(() => {
        /* The sheet renders with no options and the server's refusal is what
           the Admin reads — nothing is invented to fill the select. */
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const closes = closeMoment(live.closeAt, campaigns.current?.closesAt);
  const backers = live.activeBackers;
  const state = live.campaignState ?? campaigns.current?.status ?? header.lifecycle;
  const posts = live.posts ?? [];
  const requests = live.requests ?? [];
  const performance = live.creatorPerformance ?? [];

  /* The reference's own conditionals on the campaign rail, read off our own
     state words: Resume replaces Pause while paused, Pause disappears once the
     campaign is closing, and End early disappears at either terminus. */
  const paused = /paus|suspend/i.test(state);
  const closing = /clos/i.test(state);
  const limitReached = /limit reached/i.test(state);

  const reserved = usd(live.reservedBeforeTaxCents);
  const limit = usd(live.campaignLimitCents);
  const goal = usd(live.goalCents);

  const close = () => {
    setSheet(null);
    setRefusal(null);
    setCategory('');
  };

  /** One place where a write is attempted, so one place decides what a failure
      means: the server's own words render, and nothing reports a save. */
  async function submit(run: () => Promise<unknown>) {
    setBusy(true);
    setRefusal(null);
    try {
      await run();
      setBusy(false);
      close();
      onSaved();
    } catch (e: unknown) {
      setBusy(false);
      setRefusal(refusalLine(asRequestError(e)) ?? 'The request did not complete.');
    }
  }

  const view = (label: string, lines: string[]) => setSheet({ kind: 'view', label, lines });

  const openPublicCampaign = () =>
    view('Public campaign', [
      `${campaigns.current?.name ?? 'Campaign'} · ${
        live.publicVersion ? `Public version ${live.publicVersion}` : 'public version not recorded'
      }`,
      live.publicCampaignUrl ??
        (campaignId
          ? `${window.location.origin}/campaign/${campaignId}`
          : 'No public address is recorded on this campaign.'),
      detail.overview.vetting.answers.find((a) => a.key === 'solution')?.text ??
        'No solution answer is saved on this campaign.',
    ]);

  const previewAsBacker = () =>
    view('Backer preview', [
      `Goal: ${goal ?? 'not composed'}`,
      `Success rule: ${live.successRule ?? 'not composed'}`,
      `Refunds: ${live.refundsUrl ?? 'not recorded'}`,
      `Campaign closes: ${closes.day} · ${closes.time}`,
    ]);

  const exportAdminReport = () =>
    downloadFile(
      `${campaignId || header.prospectId}-live-report.json`,
      JSON.stringify(
        {
          campaign: campaigns.current?.name ?? null,
          activeBackers: backers ?? null,
          reserved,
          creators: performance,
          requests,
        },
        null,
        2,
      ),
      'application/json',
    );

  return (
    <>
      <StageFrame
        stage="Live"
        heading={
          backers === null || backers === undefined
            ? 'Active Backers not composed'
            : `${backers} active Backers`
        }
        lead="Current campaign totals, Founder requests and Creator post decisions are directly actionable below."
      >
        <StateStrip
          status={state}
          lastChange="Refreshed moments ago"
          next="Resolve applicable campaign work"
        />

        {live.attention ? (
          <button
            className="attention-line"
            type="button"
            onClick={() => requestCenter.current?.scrollIntoView({ block: 'start' })}
          >
            <span>
              <strong>Needs attention</strong>
              {live.attention}
            </span>
            {/* The downward arrow after this word is a ::after mark. */}
            <span>Open below</span>
          </button>
        ) : null}

        <div className="live-control-center">
          {/* ── the six numbers, one hero ────────────────────────────────── */}
          <section className="live-kpis">
            <article className="primary">
              <span>Active Backers</span>
              <strong>{backers ?? 'Not composed'}</strong>
              <small>Current total · not a since-last-visit delta</small>
            </article>
            <article>
              <span>Reserved before tax</span>
              <strong>{reserved ?? 'Not composed'}</strong>
              <small>Not captured until successful close</small>
            </article>
            <article>
              {/* The reference divides these two in the browser. The ratio is
                  composed by the route instead — an amount or a percentage the
                  browser worked out is a second answer (§33.8.13). */}
              <span>Founder goal</span>
              <strong>{goal ?? 'Not composed'}</strong>
              <small>{live.goalNote ?? 'Share reserved not composed'}</small>
            </article>
            <article>
              <span>Campaign limit</span>
              <strong>
                {reserved && limit ? `${reserved} / ${limit}` : (limit ?? 'Not composed')}
              </strong>
              <small>{live.campaignLimitNote ?? 'Share of the cap not composed'}</small>
            </article>
            <article>
              <span>Cancellations</span>
              <strong>{live.cancellations ?? 'Not composed'}</strong>
              <small>Recorded per Backer</small>
            </article>
            <article>
              <span>Campaign closes</span>
              <strong>{closes.day}</strong>
              <small>{closes.time}</small>
            </article>
          </section>

          {/* ── the campaign rail ────────────────────────────────────────── */}
          <section className="live-controls">
            <div>
              <strong>Campaign: {state}</strong>
              <span>
                {live.publicVersion
                  ? `Public version ${live.publicVersion} · refreshed moments ago`
                  : 'Public version not recorded · refreshed moments ago'}
              </span>
            </div>
            <div>
              <button type="button" onClick={openPublicCampaign}>
                Open public campaign
              </button>
              <button type="button" onClick={previewAsBacker}>
                Preview as Backer
              </button>
              <button type="button" onClick={exportAdminReport}>
                Export Admin report
              </button>
              {paused ? (
                <button
                  className="primary"
                  type="button"
                  onClick={() => setSheet({ kind: 'stop', action: 'resume' })}
                >
                  Resume
                </button>
              ) : closing ? null : (
                <button type="button" onClick={() => setSheet({ kind: 'stop', action: 'suspend' })}>
                  Pause
                </button>
              )}
              {closing || limitReached ? null : (
                <button type="button" onClick={() => setSheet({ kind: 'end_early' })}>
                  End early
                </button>
              )}
            </div>
          </section>

          {/* ── the Founder-request queue ────────────────────────────────── */}
          <section className="request-center" ref={requestCenter}>
            <header>
              <div>
                <h2>Founder requests needing Admin action</h2>
                <p>Only requests applicable to the Live campaign appear here.</p>
              </div>
              <span>{live.openRequests ?? 'Open count not composed'}</span>
            </header>
            {requests.length === 0 ? (
              <article>
                <div>
                  <span>Requests</span>
                  <h3>Nothing is waiting on Admin</h3>
                  <p>
                    No Founder request against this campaign is open. This queue composes from the
                    change-request record itself, so an empty list means the record is empty rather
                    than that something failed to load.
                  </p>
                </div>
                <strong className="status-tag done">Caught up</strong>
              </article>
            ) : (
              requests.map((row) => (
                <article key={row.id}>
                  <div>
                    <span>{row.type ?? 'Request'}</span>
                    <h3>{row.title ?? 'Untitled request'}</h3>
                    <p>{row.detail ?? 'No detail was recorded with this request.'}</p>
                    <small>
                      {absoluteTime(row.createdAt)} · {row.reference ?? row.id}
                    </small>
                  </div>
                  <strong className={`status-tag ${row.tone ?? 'waiting'}`}>
                    {row.status ?? 'State not composed'}
                  </strong>
                  <div className="inline-actions">
                    <button
                      type="button"
                      onClick={() =>
                        view(row.title ?? 'Founder request', [
                          row.type ? `Type: ${row.type}` : 'Type: not recorded',
                          row.detail ?? 'No detail was recorded with this request.',
                          `Recorded: ${absoluteTime(row.createdAt)}`,
                          `Reference: ${row.reference ?? row.id}`,
                          `State: ${row.status ?? 'not composed'}`,
                        ])
                      }
                    >
                      Open
                    </button>
                    <button type="button" disabled aria-describedby={`req-why-${row.id}`}>
                      Request changes
                    </button>
                    {/* Its own handler, deliberately: the reference gives Deny
                        and Request changes one action id, which makes rejection
                        unreachable. */}
                    <button
                      type="button"
                      onClick={() => setSheet({ kind: 'request', row, decision: 'declined' })}
                    >
                      Deny
                    </button>
                    <button
                      className="primary"
                      type="button"
                      onClick={() => setSheet({ kind: 'request', row, decision: 'applied' })}
                    >
                      {row.approveLabel ?? 'Approve'}
                    </button>
                    <small id={`req-why-${row.id}`}>{WHY.requestChanges}</small>
                  </div>
                </article>
              ))
            )}
          </section>

          {/* ── the captured Creator posts ───────────────────────────────── */}
          <section className="creator-post-section" id="creator-post">
            <header>
              <div>
                <h2>Creator posts</h2>
                <p>Review the captured post itself, then open the original post when needed.</p>
              </div>
              <span>{live.postsSummary ?? 'Post counts not composed'}</span>
            </header>
            <div className="creator-post-grid">
              {posts.map((post) => {
                const needsReview = post.needsReview ?? post.status === 'Needs review';
                const creator = post.creator ?? 'Creator';
                const handle = post.handle ?? 'Handle not recorded';
                const platform = post.platform ?? 'Channel not recorded';
                return (
                  <article
                    key={post.id}
                    className={`creator-post-card ${needsReview ? 'needs-review' : ''}`}
                  >
                    {/* `role` is added and no copy is: an aria-label on a
                        generic element is not exposed to a reader at all. */}
                    <div
                      className="post-preview"
                      role="group"
                      aria-label={`${platform} post preview from ${creator}`}
                    >
                      <div className="post-preview-account">
                        {/* The initial stays in the DOM for assistive tech and
                            is made transparent by CSS; the nested square is an
                            ::after and has no node. */}
                        <span className="post-avatar">{creator.charAt(0)}</span>
                        <div>
                          <strong>{creator}</strong>
                          <small>
                            {handle} · {platform}
                          </small>
                        </div>
                        <b>•••</b>
                      </div>
                      {/* The two rectangles are ::before / ::after; the class is
                          what picks 4:5 against 9:16. */}
                      <div className={`post-preview-media ${post.media ?? 'image'}`}>
                        <small>{post.format ?? 'Format not captured'}</small>
                        <strong>{post.previewLabel ?? 'No capture'}</strong>
                        <p>
                          {post.previewTitle ??
                            'Nothing captures the post itself — the submission stores its URL, channel, checklist and evidence, and no bucket is configured to hold a copy.'}
                        </p>
                        {post.media === 'video' ? <span aria-hidden="true">▶</span> : null}
                      </div>
                      <div className="post-preview-copy">
                        <strong>{handle}</strong>
                        <p>{post.caption ?? 'The caption is not stored on the submission.'}</p>
                        <small>{post.disclosure ?? 'Disclosure text not composed'}</small>
                      </div>
                    </div>

                    <div className="post-review-panel">
                      <div className="live-post-heading">
                        <div>
                          <span>Creator content</span>
                          <h3>
                            {creator} · {platform}
                          </h3>
                        </div>
                        {/* No class here: the element selector dresses it. */}
                        <strong>{post.status ?? 'State not composed'}</strong>
                      </div>
                      <div className="post-review-facts">
                        <div>
                          <span>Submitted</span>
                          <strong>{absoluteTime(post.submitted)}</strong>
                        </div>
                        <div>
                          <span>Tracking</span>
                          <strong>{post.tracking ?? 'Not composed'}</strong>
                        </div>
                        <div>
                          <span>Disclosure</span>
                          <strong>{post.disclosure ?? 'Not composed'}</strong>
                        </div>
                      </div>
                      {post.url ? (
                        <a className="post-link" href={post.url} target="_blank" rel="noreferrer">
                          Open post ↗
                        </a>
                      ) : (
                        <button
                          className="post-link"
                          type="button"
                          disabled
                          aria-describedby={`post-why-${post.id}`}
                        >
                          Open post ↗
                        </button>
                      )}
                      {needsReview ? (
                        <div className="inline-actions">
                          <button type="button" disabled aria-describedby={`post-why-${post.id}`}>
                            Founder reported an issue
                          </button>
                          <button
                            type="button"
                            onClick={() => setSheet({ kind: 'post_changes', row: post })}
                          >
                            Request changes
                          </button>
                          <button
                            className="primary"
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              submit(() =>
                                verifyPost(post.id, {
                                  outcome: 'passed',
                                  /* The recorded checks, sent back as recorded.
                                     A missing one is refused by the server and
                                     named in its refusal — nothing is asserted
                                     true here on an Admin's behalf. */
                                  checklist: post.checklist ?? {},
                                }),
                              )
                            }
                          >
                            Approve and mark live
                          </button>
                          <small id={`post-why-${post.id}`}>
                            {[
                              WHY.founderIssue,
                              post.url ? null : 'Open post ↗ — no post URL is recorded.',
                              refusal,
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          </small>
                        </div>
                      ) : (
                        <div className="inline-actions">
                          <button
                            type="button"
                            onClick={() =>
                              view(`${creator} post record`, [
                                `Status: ${post.status ?? 'not composed'}`,
                                `Platform: ${platform}`,
                                `Submitted: ${absoluteTime(post.submitted)}`,
                                `Tracking: ${post.tracking ?? 'not composed'}`,
                                `Disclosure: ${post.disclosure ?? 'not composed'}`,
                              ])
                            }
                          >
                            Open review record
                          </button>
                          {post.url ? null : (
                            <small id={`post-why-${post.id}`}>
                              Open post ↗ — no post URL is recorded.
                            </small>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* ── attribution ─────────────────────────────────────────────── */}
          <section className="compact-table-section">
            <header>
              <h2>Creator performance</h2>
              <span>Attribution and Admin-set percentages</span>
            </header>
            <div className="compact-table creator-performance">
              <div className="compact-table-head" aria-hidden="true">
                <span>Creator</span>
                <span>Percentage</span>
                <span>Backers</span>
                <span>Reserved</span>
                <span>Clicks</span>
                <span>Posts</span>
                <span>Action</span>
              </div>
              {/* Rendered in the route's order and never re-sorted here: §30
                  bans a ranking, and a sorted list is a ranking because the
                  order is the claim. */}
              {performance.map((row) => (
                <div className="compact-table-row" key={row.id}>
                  <span>
                    <strong>{row.name ?? 'Creator'}</strong>
                    <small>{row.handle ?? 'Handle not recorded'}</small>
                  </span>
                  <span>
                    <strong>{row.percentage ?? 'Not composed'}</strong>
                    <small>{row.percentageNote ?? 'Not composed'}</small>
                  </span>
                  <span>{row.backers ?? 'Not composed'}</span>
                  <span>{usd(row.reservedCents) ?? 'Not composed'}</span>
                  <span>{row.clicks ?? 'Not composed'}</span>
                  <span>{row.posts ?? 'Not composed'}</span>
                  <span>
                    <button
                      type="button"
                      onClick={() =>
                        view(row.name ?? 'Creator', [
                          `Handle: ${row.handle ?? 'not recorded'}`,
                          `Admin-set percentage: ${row.percentage ?? 'not composed'}`,
                          row.percentageNote ?? 'Founder response not composed',
                          `Backers: ${row.backers ?? 'not composed'}`,
                          `Reserved: ${usd(row.reservedCents) ?? 'not composed'}`,
                          `Clicks: ${row.clicks ?? 'not composed'}`,
                          `Posts: ${row.posts ?? 'not composed'}`,
                        ])
                      }
                    >
                      Open
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </StageFrame>

      {sheet?.kind === 'view' ? (
        <ValueDialog label={sheet.label} lines={sheet.lines} onClose={close} />
      ) : null}

      {/* Pause and Resume both post to §29's enforcement route. The category is
          chosen from the register the route itself returns, so the sheet cannot
          offer a value the server would refuse — and this file never picks one.
          Resume has no enum value behind it, so what the Admin sees is the
          server saying so, not a control that quietly did nothing. */}
      {sheet?.kind === 'stop' ? (
        <Overlay
          label={sheet.action === 'resume' ? 'Resume campaign' : 'Pause campaign'}
          onClose={close}
        >
          <form
            className="decision-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const reasonDetail = String(form.get('reason') ?? '');
              const customerExplanation = String(form.get('explanation') ?? '');
              const action = sheet.action;
              void submit(() =>
                recordEnforcement(campaignId, {
                  action,
                  reasonCategory: category,
                  reasonDetail,
                  customerExplanation,
                }),
              );
            }}
          >
            <p className="dialog-kicker">Campaign enforcement</p>
            <h2>{sheet.action === 'resume' ? 'Resume campaign' : 'Pause campaign'}</h2>
            <p className="dialog-lead">
              Explain why new pre-orders must stop and who must be notified.
            </p>
            <label>
              <span>Reason category</span>
              <select
                className="manual-edit-input"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">Select one</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Required reason</span>
              <textarea name="reason" />
            </label>
            <label>
              <span>Explanation for the Founder</span>
              <textarea name="explanation" />
            </label>
            {refusal ? <p className="form-note">{refusal}</p> : null}
            <div className="dialog-actions">
              <button type="button" onClick={close}>
                Cancel
              </button>
              <button className="primary" type="submit" disabled={busy}>
                {sheet.action === 'resume' ? 'Resume campaign' : 'Pause campaign'}
              </button>
            </div>
          </form>
        </Overlay>
      ) : null}

      {/* The close batch is the only thing that ends a campaign, and it refuses
          until the recorded close time arrives. `kill` was not used: it is
          terminal and skips the success-rule check this dialog promises. */}
      {sheet?.kind === 'end_early' ? (
        <DecisionDialog
          kicker="Campaign close"
          heading="End campaign early"
          lead="Record why the campaign should close before its scheduled time and how the success rule will be checked."
          submitLabel="Begin early close"
          busy={busy}
          refusal={refusal}
          onDecide={() => void submit(() => runClose(campaignId))}
          onClose={close}
        />
      ) : null}

      {sheet?.kind === 'request' ? (
        <DecisionDialog
          kicker="Founder request"
          heading={sheet.decision === 'applied' ? 'Approve and publish' : 'Deny this request'}
          lead={sheet.row.detail ?? 'No detail was recorded with this request.'}
          submitLabel={sheet.decision === 'applied' ? 'Approve' : 'Deny'}
          busy={busy}
          refusal={refusal}
          onDecide={(internalReason) =>
            void submit(() =>
              decideChangeRequest(sheet.row.id, {
                decision: sheet.decision,
                decisionReason: internalReason,
              }),
            )
          }
          onClose={close}
        />
      ) : null}

      {sheet?.kind === 'post_changes' ? (
        <DecisionDialog
          kicker="Creator post"
          heading="Request changes"
          lead="Describe the exact correction this post needs. The record requires the detail."
          submitLabel="Request changes"
          busy={busy}
          refusal={refusal}
          onDecide={(internalReason) =>
            void submit(() =>
              verifyPost(sheet.row.id, {
                outcome: 'correction_needed',
                checklist: sheet.row.checklist ?? {},
                correctionDetail: internalReason,
              }),
            )
          }
          onClose={close}
        />
      ) : null}
    </>
  );
}
