/**
 * Admin → Campaigns → one campaign — Spec §26.1, §23.1, §18, DNA §5.14.
 *
 * Where this campaign stands, in four views of one record, and a link into
 * every workspace that owns a piece of it.
 *
 * ── Two controls, and neither changes anything ──────────────────────────────
 * `Copy public link` and `Open public campaign`. That is the whole interactive
 * surface, because that is the whole reference: its prototype has no mutation
 * at all and its own copy says five times that the work stays in the page that
 * owns it. Every campaign decision already has a router — §15's review, §16's
 * readiness, §17's launch, §20's live edits, §21's close, §22.1's earnings,
 * §24.8's refunds, §26.7's suspend/kill — and a duplicate control here would be
 * a second door into rules those encode.
 *
 * ── An unpublished campaign has no public address ───────────────────────────
 * Not a disabled button: `header.publicUrl` is null for every campaign that has
 * never gone live, so there is nothing for either control to open or copy, and
 * the header says why instead. §18 gives those campaigns no public page at all
 * — `/api/campaign/:id` answers 404 — so a link would be both a leak and a
 * broken promise.
 *
 * ── The tab is in the URL ───────────────────────────────────────────────────
 * Four views of ONE record, so a bookmark to the Close tab should still be that
 * campaign (DNA §5.12). `?tab=` carries it, exactly as the Support case and the
 * Creator relationship do.
 *
 * ── The rail is hand-built, not `components/Tabs.tsx` ───────────────────────
 * Same reason the Support and Creator rails are: §26.1's stylesheet uses
 * different markup. Roving `tabindex` with Arrow/Home/End, `role="tab"`, and
 * the panel labelled by its tab — §28.5's keyboard contract, met explicitly.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router';
import {
  CAMPAIGNS_IS_READ_ONLY,
  CAMPAIGN_COPY,
  CAMPAIGN_RECORD_TABS,
  CAMPAIGN_RECORD_TAB_LABELS,
  FRESHNESS_PREFIX,
  OPEN_THE_PAGE_THAT_OWNS_IT,
  type CampaignRecordTab,
} from '@proovd/shared';
import { Button, StatePanel, useToast } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import { fetchCampaign, AdminRequestError, type CampaignRecordView } from './api.js';
import {
  AdminLinkList,
  BlockerBand,
  CampaignSection,
  FactList,
  StatePill,
  localStamp,
} from './shared.js';

function isTab(value: string): value is CampaignRecordTab {
  return (CAMPAIGN_RECORD_TABS as readonly string[]).includes(value);
}

export function CampaignRecord() {
  const { campaignId = '' } = useParams();
  const [view, setView] = useState<CampaignRecordView | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [params, setParams] = useSearchParams();
  const surface = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);

  const raw = params.get('tab') ?? 'overview';
  const tab: CampaignRecordTab = isTab(raw) ? raw : 'overview';

  const load = useCallback(() => {
    setLoadError(null);
    fetchCampaign(campaignId)
      .then(setView)
      .catch((error: unknown) => {
        setLoadError(
          error instanceof AdminRequestError
            ? error
            : new AdminRequestError({
                error: 'unreachable',
                status: 0,
                title: 'Proovd could not be reached',
                whatHappened:
                  'The campaign record could not be read, and the failure carried no explanation.',
                next: 'Try the read again. Nothing was changed by the attempt.',
              }),
        );
      });
  }, [campaignId]);

  useEffect(load, [load]);
  useProovdMotion(surface, [view, tab]);

  function chooseTab(next: CampaignRecordTab) {
    const updated = new URLSearchParams(params);
    if (next === 'overview') updated.delete('tab');
    else updated.set('tab', next);
    setParams(updated, { replace: true });
  }

  /**
   * Arrow keys move between tabs; Home and End jump to the ends.
   *
   * Roving `tabindex` means Tab enters the rail once and leaves it once, which
   * is what a tablist is supposed to do — without it a keyboard user tabs
   * through four controls to reach the panel (§28.5, §33.11.2).
   */
  function onRailKey(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = CAMPAIGN_RECORD_TABS.indexOf(tab);
    const last = CAMPAIGN_RECORD_TABS.length - 1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowLeft'
            ? (index - 1 + CAMPAIGN_RECORD_TABS.length) % CAMPAIGN_RECORD_TABS.length
            : (index + 1) % CAMPAIGN_RECORD_TABS.length;
    chooseTab(CAMPAIGN_RECORD_TABS[next]!);
    requestAnimationFrame(() => {
      rail.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    });
  }

  if (loadError) {
    return (
      <div>
        <BackLink />
        <StatePanel
          state={loadError.detail.title}
          whatHappened={
            loadError.detail.whatHappened ??
            'The campaign record could not be read, so nothing on this page is current.'
          }
          next={loadError.detail.next ?? 'Try the read again. Nothing was changed by the attempt.'}
          owner="Proovd"
          nextUpdate="When you try again"
          action={
            <Button tier="primary" onClick={load}>
              Try the read again
            </Button>
          }
          reference="Admin · Campaigns"
          ring
        />
      </div>
    );
  }

  if (!view) {
    return (
      <div>
        <BackLink />
        <StatePanel
          state="Reading the campaign"
          whatHappened="Proovd is reading this campaign's state, its roster, its money, and its history."
          next="The record appears as soon as that comes back."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action="No action needed"
          reference="Admin · Campaigns"
        />
      </div>
    );
  }

  const { header } = view;

  return (
    <div ref={surface}>
      <BackLink />

      <header className="cmp-head">
        <div className="cmp-head__top">
          <div className="cmp-head__what">
            <p className="kicker">
              {[header.typeLabel ?? 'Type not set', header.displayId].join(' · ')}
            </p>
            <h1 className="cmp-head__title">{header.name}</h1>
            <p className="cmp-head__who">
              {[header.company, header.founderName ? `Founder ${header.founderName}` : null]
                .filter(Boolean)
                .join(' · ') || 'No Founder record is linked to this campaign'}
            </p>
            <p className="cmp-head__posture">{CAMPAIGNS_IS_READ_ONLY}</p>
          </div>
          <PublicActions
            url={header.publicUrl}
            unavailableBecause={header.publicUrlUnavailableBecause}
            name={header.name}
          />
        </div>

        <dl className="cmp-head__facts">
          <div>
            <dt>Status</dt>
            <dd>
              <StatePill label={header.stateLabel} kind={header.stateKind} small />
            </dd>
          </div>
          <div>
            <dt>Waiting on</dt>
            <dd>{header.waitingOnLabel}</dd>
          </div>
          <div>
            <dt>Launch</dt>
            <dd>{header.launch}</dd>
          </div>
          <div>
            <dt>Close</dt>
            <dd>{header.close}</dd>
          </div>
          <div>
            <dt>Public page</dt>
            <dd>{header.publicStateLabel}</dd>
          </div>
        </dl>
      </header>

      <div ref={rail} className="cmp-tabs" role="tablist" aria-label="Campaign sections" onKeyDown={onRailKey}>
        {CAMPAIGN_RECORD_TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            id={`cmp-tab-${entry}`}
            aria-selected={tab === entry}
            aria-controls={`cmp-panel-${entry}`}
            tabIndex={tab === entry ? 0 : -1}
            className={cn('cmp-tab', tab === entry && 'is-active')}
            onClick={() => chooseTab(entry)}
          >
            {CAMPAIGN_RECORD_TAB_LABELS[entry]}
          </button>
        ))}
      </div>

      <div
        className="cmp-panel"
        role="tabpanel"
        id={`cmp-panel-${tab}`}
        aria-labelledby={`cmp-tab-${tab}`}
        tabIndex={-1}
      >
        {tab === 'overview' ? <Overview view={view} /> : null}
        {tab === 'live' ? <Live view={view} /> : null}
        {tab === 'close' ? <Close view={view} /> : null}
        {tab === 'history' ? <History view={view} /> : null}
      </div>

      <p className="helper cmp-checked">
        {FRESHNESS_PREFIX} {localStamp(view.checkedAt)}
      </p>
    </div>
  );
}

function BackLink() {
  return (
    <p className="cmp-crumb">
      <RouterLink to="/admin/campaigns">← All campaigns</RouterLink>
    </p>
  );
}

/* ── The two controls ──────────────────────────────────────────────────────*/

/**
 * Copy and open the public campaign page — or say why there is neither.
 *
 * The absence is structural: with no `url` there is nothing to copy and nothing
 * to open, so a campaign that has never been public cannot be made publicly
 * reachable from this tab however the component is edited.
 */
function PublicActions({
  url,
  unavailableBecause,
  name,
}: {
  url: string | null;
  unavailableBecause: string | null;
  name: string;
}) {
  const toast = useToast();

  if (!url) {
    return (
      <p className="helper cmp-head__nopublic">
        {unavailableBecause ?? 'This campaign has no public address.'}
      </p>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard?.writeText(url!);
      toast('Public link copied', { sub: name });
    } catch {
      toast('Copy failed — select and copy the link', { accent: 'yellow' });
    }
  }

  return (
    <div className="cmp-head__actions">
      <Button tier="secondary" small onClick={() => void copy()}>
        Copy public link
      </Button>
      {/* A real anchor, not a router link: the public campaign page is outside
          the Admin shell, and opening it in a new tab keeps the Admin's
          position (DNA §5.12). */}
      <a className="btn btn--primary btn--sm" href={url} target="_blank" rel="noreferrer">
        <span className="btn__label">Open public campaign</span>
      </a>
    </div>
  );
}

/* ── Overview ──────────────────────────────────────────────────────────────*/

function Overview({ view }: { view: CampaignRecordView }) {
  const { overview, header } = view;
  return (
    <>
      <div className="cmp-glance">
        <BlockerBand
          blocker={overview.blocker}
          kind={header.stateKind}
          detail={CAMPAIGN_COPY.blockerDetail}
        />
        <aside className="cmp-quick">
          <h3>Campaign</h3>
          <FactList facts={overview.quickFacts} />
        </aside>
      </div>

      <CampaignSection eyebrow="Campaign steps" title="Where it stands">
        <ol className="cmp-steps">
          {overview.stages.map((stage) => (
            <li key={stage.key} className={cn('cmp-step', `cmp-step--${stage.state}`)}>
              <span className="cmp-step__bar" aria-hidden="true" />
              <strong>{stage.label}</strong>
              <small>{stage.caption}</small>
              {/* The state is a word as well as a shape — never colour or fill
                  alone (§33.11, DNA). Screen-reader only, because the visual
                  treatment already carries it for a sighted reader. */}
              <span className="sr-only">
                {stage.state === 'done'
                  ? 'Complete'
                  : stage.state === 'current'
                    ? 'In progress'
                    : 'Not started'}
              </span>
            </li>
          ))}
        </ol>
      </CampaignSection>

      <div className="cmp-two">
        <CampaignSection eyebrow="Dates" title="Launch and close">
          <FactList facts={overview.dates} />
        </CampaignSection>
        <CampaignSection eyebrow="Other admin pages" title="Open the right page">
          <AdminLinkList links={overview.links} />
        </CampaignSection>
      </div>
    </>
  );
}

/* ── Live ──────────────────────────────────────────────────────────────────*/

/**
 * The live totals, or the reason there are none.
 *
 * The metric hero renders only when the campaign actually went live. A hero
 * reading three zeros for a campaign that never launched is §16a's
 * zero-that-means-two-things on the most quotable panel in the section.
 */
function Live({ view }: { view: CampaignRecordView }) {
  const { liveTab } = view;

  if (!liveTab.live || !liveTab.metrics) {
    return (
      <div className="cmp-glance">
        <div className="cmp-band">
          <StatePill label="Not live" kind="waiting" />
          <h2 className="cmp-band__title">{CAMPAIGN_COPY.notLiveTitle}</h2>
          <p className="cmp-band__body">{CAMPAIGN_COPY.notLiveBody}</p>
        </div>
        <aside className="cmp-quick">
          <h3>Dates</h3>
          <FactList facts={liveTab.dates} />
        </aside>
      </div>
    );
  }

  const { active, canceled, third } = liveTab.metrics;

  return (
    <>
      <CampaignSection
        eyebrow="Live totals"
        title="What is happening now"
        lede={CAMPAIGN_COPY.liveTotalsLede}
        aside={<StatePill label={liveTab.publicStateLabel} kind="live" />}
      >
        <div className="cmp-metrics">
          <div className="cmp-metric">
            <strong>{active}</strong>
            <span>Active pre-orders</span>
          </div>
          <div className="cmp-metric">
            <strong>{canceled}</strong>
            <span>Canceled</span>
          </div>
          <div className="cmp-metric">
            <strong>{third.value}</strong>
            <span>{third.label}</span>
            {third.progress ? (
              third.progress.percent === null ? (
                /* §14.4 makes the threshold the Founder's own build value. An
                   unset one is a fact to state, never a default to invent — the
                   prototype's hardcoded 120 would measure every Idea campaign
                   against a number nobody agreed to. */
                <small className="cmp-metric__note">{third.progress.note}</small>
              ) : (
                <div
                  className="cmp-progress"
                  role="progressbar"
                  aria-valuenow={third.progress.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${third.progress.percent}% of the ${third.progress.threshold}-Backer order threshold`}
                >
                  <i style={{ width: `${third.progress.percent}%` }} />
                </div>
              )
            ) : null}
          </div>
        </div>
      </CampaignSection>

      <div className="cmp-two">
        <CampaignSection eyebrow="Dates" title="Live period">
          <FactList facts={liveTab.dates} />
        </CampaignSection>
        <CampaignSection eyebrow="Other admin pages" title="Open the right page">
          <AdminLinkList links={liveTab.links} />
        </CampaignSection>
      </div>
    </>
  );
}

/* ── Close ─────────────────────────────────────────────────────────────────*/

function Close({ view }: { view: CampaignRecordView }) {
  const { close } = view;
  return (
    <div className="cmp-two">
      <CampaignSection eyebrow="Close" title={close.heading} lede={CAMPAIGN_COPY.closeLede}>
        <FactList facts={close.facts} />
      </CampaignSection>
      <div>
        <div className="cmp-route-note">
          <h3>{CAMPAIGN_COPY.routeNoteTitle}</h3>
          <p>{OPEN_THE_PAGE_THAT_OWNS_IT}</p>
        </div>
        <AdminLinkList links={close.links} />
      </div>
    </div>
  );
}

/* ── History ───────────────────────────────────────────────────────────────*/

/**
 * The major moments, composed across ten tables and stored in none.
 *
 * §26.8's trap: a second event store that drifts from the first is worse than
 * no timeline. Every entry names the admin page it came from — the reference's
 * own source tag — which is the question a hub exists to answer.
 */
function History({ view }: { view: CampaignRecordView }) {
  if (view.history.length === 0) {
    return (
      <CampaignSection eyebrow="History" title="Major campaign changes" lede={CAMPAIGN_COPY.historyLede}>
        <p className="grey">
          Nothing has been recorded against this campaign yet. Entries appear as the campaign moves
          through setup, review, launch, and close.
        </p>
      </CampaignSection>
    );
  }

  return (
    <CampaignSection eyebrow="History" title="Major campaign changes" lede={CAMPAIGN_COPY.historyLede}>
      <ol className="cmp-events">
        {view.history.map((event) => (
          <li key={event.id} className="cmp-event">
            <time dateTime={event.at}>{event.atLabel}</time>
            <div className="cmp-event__what">
              <strong>{event.headline}</strong>
              <p>{event.detail}</p>
            </div>
            <span className="cmp-tag">{event.tag}</span>
          </li>
        ))}
      </ol>
    </CampaignSection>
  );
}
