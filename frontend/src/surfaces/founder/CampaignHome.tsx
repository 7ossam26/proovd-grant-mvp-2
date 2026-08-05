/**
 * The Founder's live campaign home — Spec §20, DNA §5.2, §5.3, §5.6 (Phase 17a).
 *
 * Three altitudes in one page, in one order: Glance (what is happening), Act
 * (the one thing to do), Explore (everything else). DNA §5.3 — the loop, not the
 * map. There is no grid of widgets and no dashboard: §26 licenses density in
 * Admin and nowhere else, and this is a Founder surface.
 *
 * ── The acknowledgement is why this component has an effect at all ──────────
 * §20: last-seen advances "only after the rendered state is successfully
 * delivered", and §33.6.6 tests it. So the render commits first and the
 * acknowledgement is sent from an effect that runs *after* React has committed
 * this tree — if the render throws, the effect never runs, the receipt stays
 * open, and the delta survives to be read again. Acknowledging inside the fetch
 * would advance last-seen for a render that never happened.
 *
 * ── One hero, and no manufactured CTA ───────────────────────────────────────
 * DNA §5.6 and §20 both give Act one primary action. When the server says
 * `caught_up` this surface renders the done-moment sentence and no button —
 * there is no branch here that invents one, because DNA §5.4 makes "all caught
 * up" a designed ending rather than an empty state to be filled.
 *
 * ── Never "real time" ───────────────────────────────────────────────────────
 * Freshness reads `Updated 3:40 PM` and the page says it refreshes when loaded.
 * §30 bans the immediacy claim; a test scans this file for the vocabulary.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  ACT_CAUGHT_UP,
  resolveCaughtUp,
  resolveDelta,
  resolveFreshness,
  resolveProgress,
} from '@proovd/shared';
import {
  Accordion,
  Button,
  Card,
  Link,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Stat,
  Tag,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import {
  acknowledgeHomeDelivery,
  acknowledgeMilestone,
  fetchCampaignHome,
  FounderRequestError,
  type ActCandidate,
  type CampaignHomeView,
  type ExploreSection,
} from './api.js';

/** §27.1: local time, with UTC beside it where the moment is a deadline. */
function localMoment(iso: string | null): string {
  if (!iso) return 'the scheduled close';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
}

function localDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function CampaignHome() {
  const { campaignId = '' } = useParams();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; view: CampaignHomeView }
  >({ status: 'loading' });

  /** Receipts already acknowledged in this session — an ack happens once. */
  const acknowledged = useRef<Set<string>>(new Set());

  async function load() {
    try {
      const { home } = await fetchCampaignHome(campaignId);
      setState({ status: 'ready', view: home });
    } catch (caught) {
      setState({
        status: 'error',
        message:
          caught instanceof FounderRequestError
            ? (caught.detail.whatHappened ?? 'Your campaign home could not be loaded.')
            : 'Your campaign home could not be loaded.',
      });
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  /**
   * §33.6.6. Runs only after React committed a successful render of this tree.
   *
   * A render that threw never reaches here, so the receipt stays open and the
   * next visit computes the same delta from the same unmoved position. The
   * acknowledgement failing is deliberately silent to the Founder: it costs them
   * one repeated delta, which is the safe direction, and there is nothing they
   * could do about it.
   */
  useEffect(() => {
    if (state.status !== 'ready') return;
    const deliveryId = state.view.glance.deliveryId;
    if (acknowledged.current.has(deliveryId)) return;
    acknowledged.current.add(deliveryId);
    void acknowledgeHomeDelivery(campaignId, deliveryId).catch(() => {
      /* The delta survives. See above. */
    });
  }, [state, campaignId]);

  if (state.status === 'loading') {
    return (
      <Measure>
        <StatePanel
          state="Loading your campaign"
          whatHappened="Proovd is reading your pre-orders, your Creators, and anything waiting on you."
          next="It appears in a moment."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference={campaignId}
        />
      </Measure>
    );
  }

  if (state.status === 'error') {
    return (
      <Measure>
        <StatePanel
          state="We could not load your campaign"
          whatHappened={state.message}
          next="Reload the page. Nothing about your campaign has changed."
          owner="Proovd"
          nextUpdate="As soon as you reload"
          action={<Link href={supportMailto(campaignId)}>Contact support</Link>}
          reference={campaignId}
        />
      </Measure>
    );
  }

  const { glance, act, explore, milestoneHistory } = state.view;

  return (
    <Measure>
      <Section>
        {/* §33.11.2: every principal surface names itself once, at level one.
            The Glance number is the hero (DNA §5.1) but a hero is not a title —
            a Founder arriving from a bookmark, and every screen reader, needs
            to be told which page this is before the count means anything. */}
        <h1 className="h2">Your campaign today</h1>
        <GlancePanel view={state.view} />
        <ActPanel act={act} campaignId={campaignId} onChanged={load} />
        <ExplorePanel sections={explore.sections} readAt={explore.readAt} />
        {milestoneHistory.length > 0 ? (
          <MilestoneHistory entries={milestoneHistory} />
        ) : null}
        <p className="quiet">
          {resolveFreshness(clockTime(glance.readAt))} · This page reads your record when you load
          it.
        </p>
      </Section>
    </Measure>
  );
}

/* ── Glance ────────────────────────────────────────────────────────────────── */

function GlancePanel({ view }: { view: CampaignHomeView }) {
  const { glance } = view;

  // §20's two progress lines. The shared resolver throws on an unfilled marker,
  // and refuses a Product campaign carrying a threshold remainder (§14.4's "no
  // public funding gate") — so a wrong shape is a loud failure, not a wrong page.
  const progress = resolveProgress({
    model: glance.model,
    localCloseLabel: localMoment(glance.closesAt),
    ...(glance.model === 'idea' && glance.remainingToThreshold !== null
      ? { remainingToThreshold: glance.remainingToThreshold }
      : {}),
  });

  return (
    <Card>
      <Stat
        variant="white"
        brandValue
        value={glance.activePreorderCount}
        sub="active pre-orders"
      />

      <p>
        {glance.delta
          ? resolveDelta(glance.delta.count, localDate(glance.delta.since))
          : 'This is your first visit to this page.'}
      </p>

      <p>{progress}</p>

      {/* §20: the permanent clarification. Not dismissible, not a tooltip, and
          not below a fold — §30 forbids anything that confuses a saved card
          with a charge, and a large number with no qualifier is that. */}
      <p className="notice">{glance.notYetChargedNotice}</p>

      {/* §20: "Current Creator liveness only when true." Null renders nothing —
          a zero would be a stated fact about an empty roster (§1.4). */}
      {glance.activeCreators !== null ? (
        <p>
          <Tag variant="mint">
            {glance.activeCreators} Creator{glance.activeCreators === 1 ? '' : 's'} currently active
          </Tag>
        </p>
      ) : null}
    </Card>
  );
}

/* ── Act ───────────────────────────────────────────────────────────────────── */

function ActPanel({
  act,
  campaignId,
  onChanged,
}: {
  act: CampaignHomeView['act'];
  campaignId: string;
  onChanged: () => Promise<void>;
}) {
  if (act.state === 'caught_up') {
    // DNA §5.4's done-moment. One sentence, no button, nothing to fill it with.
    return (
      <Card>
        <p className="lede">{resolveCaughtUp(localMoment(act.closesAt))}</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2>{act.action.label}</h2>
      <p>{act.action.detail}</p>

      {act.overridden && act.override ? (
        <p className="quiet">
          Shown first by a recorded safety decision: {act.override.reason}
        </p>
      ) : null}

      {/* DNA §5.6: one hero. Everything else is deferred, not competing. */}
      <Button tier="primary" href={act.action.href}>
        {act.action.label}
      </Button>

      {act.deferred.length > 0 ? (
        <DeferredActions actions={act.deferred} campaignId={campaignId} onChanged={onChanged} />
      ) : null}
    </Card>
  );
}

function DeferredActions({
  actions,
  campaignId,
  onChanged,
}: {
  actions: ActCandidate[];
  campaignId: string;
  onChanged: () => Promise<void>;
}) {
  void campaignId;
  void onChanged;
  return (
    <Accordion
      items={[
        {
          value: 'deferred',
          head: `${actions.length} other thing${actions.length === 1 ? '' : 's'} waiting`,
          body: (
            <ul>
              {actions.map((action) => (
                <li key={`${action.sourceTable}:${action.sourceId}`}>
                  <Link href={action.href}>{action.label}</Link> — {action.detail}
                </li>
              ))}
            </ul>
          ),
        },
      ]}
    />
  );
}

/* ── Explore ───────────────────────────────────────────────────────────────── */

/**
 * DNA §5.2: Explore is a first-class space, not a bin. Every section states what
 * its numbers count, and a section whose phase has not run says what it is
 * waiting for instead of showing a zero (§1.4).
 */
function ExplorePanel({ sections, readAt }: { sections: ExploreSection[]; readAt: string }) {
  return (
    <Accordion
      items={sections.map((section) => ({
        value: section.key,
        head: section.title,
        body: (
          <div>
            <p className="quiet">{section.definition}</p>
            {section.awaiting ? <p className="notice">{section.awaiting}</p> : null}
            {section.data ? <ExploreData data={section.data} /> : null}
            <p className="quiet">{resolveFreshness(clockTime(readAt))}</p>
          </div>
        ),
      }))}
    />
  );
}

function ExploreData({ data }: { data: Record<string, unknown> }) {
  return (
    <dl>
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{renderValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not yet available';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/* ── Milestone history (§20: "then move to history") ───────────────────────── */

function MilestoneHistory({
  entries,
}: {
  entries: CampaignHomeView['milestoneHistory'];
}) {
  return (
    <Accordion
      items={[
        {
          value: 'milestones',
          head: 'Milestones',
          body: (
            <ul>
              {entries.map((entry) => (
                <li key={entry.kind}>
                  {entry.kind} — {localDate(entry.occurredAt)}
                  {entry.acknowledgedAt ? ' (in history)' : ''}
                </li>
              ))}
            </ul>
          ),
        },
      ]}
    />
  );
}

/* Re-exported so the acceptance suite can assert the exact §20 sentence without
   reaching into the shared package from a surface test. */
export { ACT_CAUGHT_UP, acknowledgeMilestone };
