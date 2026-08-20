/**
 * The Creator's two lists — Creator Flow v2, Session E, 2026-08-20.
 *
 * `Active` and `Pitches` over one address, replacing Phase 08c's single list at
 * `/creator/campaigns`. The address does not move: the rail points at it, Home
 * points at it, §27.3's emails point at it, and renaming it would have been a
 * rename with no benefit — the same reasoning Session F used for the work
 * surface.
 *
 * ── It is a list of invitations, not a marketplace ─────────────────────────
 * §5.3 admits a Creator only through a private invitation to a specific
 * campaign. The reference's `browse` framing, its `Trending in your niche`, its
 * predicted earnings, its `Upfront offered` badge and its commission and price
 * sort keys are all in `CREATOR_FLOW_ABSENCES`. What survives is the shape: a
 * card per pitch, the real §14.3 term on it, and two sorts over stored columns.
 *
 * ── One derivation for the count ───────────────────────────────────────────
 * `PITCH_DECISION_OPEN_STATES` and `pitchKindFor` live in one backend module
 * that Home's read imports, so the hero's "N pitches waiting" and this tab's
 * count are the same answer rather than two that agree today.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  ACTIVE_LIST_MONEY_LIVES_ON_EARNINGS,
  DEFAULT_PITCH_SORT,
  DECLINING_COSTS_YOU_NOTHING,
  PITCHES_ARE_YOUR_OWN_INVITATIONS,
  PITCH_NO_PREDICTED_EARNINGS,
  PITCH_SORTS,
  PITCH_TABS,
} from '@proovd/shared';
import { Button, Card, NO_ACTION, StatePanel, Tabs, Tag } from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import {
  CreatorRequestError,
  fetchCreatorPitches,
  type CreatorActiveRow,
  type CreatorPitchRow,
  type CreatorPitchesView,
} from '../creator/api.js';

/**
 * A deadline, local with UTC beside it — §27.1's rule.
 *
 * `toLocaleString()` alone renders the machine's locale and names no zone at
 * all, and this is §14.6's own instant: after it an unfinished proposal expires
 * and the opportunity closes. The Founder flow's fee screen renders the same
 * pair for the same reason.
 */
function deadline(iso: string): string {
  const at = new Date(iso);
  return (
    `${at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} ` +
    `(${at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC)`
  );
}

export function CreatorPitches() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'pitches' ? 'pitches' : 'active';
  const sort = params.get('sort') === 'newest' ? 'newest' : DEFAULT_PITCH_SORT;

  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; title: string; message: string }
    | { status: 'ready'; view: CreatorPitchesView }
  >({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const { pitches } = await fetchCreatorPitches(sort);
      setState({ status: 'ready', view: pitches });
    } catch (caught) {
      const detail = caught instanceof CreatorRequestError ? caught.detail : null;
      setState({
        status: 'error',
        title: detail?.title ?? 'We could not load your campaigns',
        message:
          detail?.whatHappened ??
          'The request did not complete. Nothing about your campaigns or your invitations has changed.',
      });
    }
  }, [sort]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The tab and the sort live in the address (DNA §5.12): a reload, a
     bookmark, and the back button all get the same view back. Both are written
     in ONE `setParams` call — two sequential writes each rebuild from the same
     closed-over snapshot and the second undoes the first, which is the defect
     `CreatorsDirectory` recorded on 2026-08-15. */
  const move = (next: { tab?: string; sort?: string }) => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next.tab !== undefined) updated.set('tab', next.tab);
        if (next.sort !== undefined) updated.set('sort', next.sort);
        return updated;
      },
      { replace: true },
    );
  };

  const view = state.status === 'ready' ? state.view : null;

  const items = useMemo(
    () =>
      PITCH_TABS.map((entry) => ({
        value: entry.id,
        label: (
          <>
            {entry.label}
            {view ? (
              <span className="crp-tab__count">
                {entry.id === 'active' ? view.active.length : view.pitches.length}
              </span>
            ) : null}
          </>
        ),
        content:
          entry.id === 'active' ? (
            <ActiveList rows={view?.active ?? []} emptyLine={entry.emptyLine} />
          ) : (
            <PitchList
              rows={view?.pitches ?? []}
              emptyLine={entry.emptyLine}
              sort={sort}
              onSort={(next) => move({ sort: next })}
            />
          ),
      })),
    [view, sort],
  );

  if (state.status === 'loading') {
    return (
      <div className="cra-page">
        <StatePanel
          state="Loading your campaigns"
          whatHappened="Proovd is gathering what you are part of and what is still open to you."
          next="They appear in a moment."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference="Your campaigns"
        />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="cra-page">
        <StatePanel
          state={state.title}
          whatHappened={state.message}
          next="Reload the page. This was a read that did not complete — no invitation expired and no campaign changed."
          owner="Proovd"
          nextUpdate="As soon as you reload"
          action={NO_ACTION}
          reference="Your campaigns"
          getHelp={{ href: supportMailto('Creator campaigns') }}
        />
      </div>
    );
  }

  return (
    <div className="cra-page crp">
      <header className="cra-page__head">
        <h1>Your campaigns</h1>
        <p className="cra-lede">
          What you are working on, and what is still open to you.
        </p>
      </header>

      <Tabs
        label="Your campaigns"
        items={items}
        value={tab}
        onValueChange={(next) => move({ tab: next })}
      />
    </div>
  );
}

/* ── Active ───────────────────────────────────────────────────────────────── */

function ActiveList({ rows, emptyLine }: { rows: CreatorActiveRow[]; emptyLine: string }) {
  const navigate = useNavigate();

  if (rows.length === 0) {
    return (
      <StatePanel
        state="No campaign is running yet"
        whatHappened={emptyLine}
        next="Open the Pitches tab to see anything still waiting on you."
        owner="You"
        nextUpdate="When you accept a pitch"
        action={NO_ACTION}
        reference="Active campaigns"
      />
    );
  }

  return (
    <>
      {rows.map((row) => (
        <Card key={row.associationId}>
          <div className="crp-row__top">
            <Tag variant={row.ready ? 'moss' : 'sage'}>{row.label}</Tag>
            {row.firstPostStatus === 'passed' ? <Tag variant="sage">First post verified</Tag> : null}
          </div>
          <h2>{row.productName ?? 'A campaign'}</h2>
          {/* A closed campaign's link is inactive because the campaign ended,
              not because it has not started — saying "not active YET" there
              would be a promise about a campaign that is over (§1.4). */}
          <p className="crp-row__link">
            {row.trackingLinkUrl === null
              ? 'Your tracking link is created when your terms are accepted.'
              : row.trackingLinkActive
                ? 'Your tracking link is live.'
                : row.destination === 'close'
                  ? 'This campaign has ended, so your link no longer counts clicks.'
                  : 'Your tracking link exists and is not active yet. Posting before it activates earns nothing.'}
          </p>
          <div className="cra-acts">
            {/* The visible label is short and the accessible name carries the
                campaign, which two identical buttons on one list would
                otherwise be missing (§33.11.4). The visible text is a PREFIX of
                the accessible name, so voice control still reaches it. */}
            <Button
              tier="primary"
              aria-label={
                row.destination === 'close'
                  ? `Open the close summary for ${row.productName ?? 'this campaign'}`
                  : `Open your work on ${row.productName ?? 'this campaign'}`
              }
              onClick={() =>
                void navigate(
                  row.destination === 'close'
                    ? `/creator/campaigns/${row.associationId}/close`
                    : `/creator/campaigns/${row.associationId}/partnership`,
                )
              }
            >
              {row.destination === 'close' ? 'Open the close summary' : 'Open your work'}
            </Button>
          </div>
        </Card>
      ))}

      {/* §33.8.13: one source, many renderers — and a third rendering of an
          amount on a list row is a third chance for them to disagree. */}
      <p className="cra-help">{ACTIVE_LIST_MONEY_LIVES_ON_EARNINGS}</p>
    </>
  );
}

/* ── Pitches ──────────────────────────────────────────────────────────────── */

function PitchList({
  rows,
  emptyLine,
  sort,
  onSort,
}: {
  rows: CreatorPitchRow[];
  emptyLine: string;
  sort: string;
  onSort: (next: string) => void;
}) {
  const navigate = useNavigate();

  return (
    <>
      <p className="cra-help">{PITCHES_ARE_YOUR_OWN_INVITATIONS}</p>

      {rows.length === 0 ? (
        <StatePanel
          state="No open invitations"
          whatHappened={emptyLine}
          next="There is nothing for you to do. We email you when a campaign is matched to you."
          owner="Proovd"
          nextUpdate="When Proovd matches you to a campaign"
          action={NO_ACTION}
          reference="Your invitations"
        />
      ) : (
        <>
          <div className="crp-sorts" role="group" aria-label="Sort your invitations">
            {PITCH_SORTS.map((entry) => (
              <Button
                key={entry.id}
                tier={entry.id === sort ? 'secondary' : 'tertiary'}
                aria-pressed={entry.id === sort}
                onClick={() => onSort(entry.id)}
              >
                {entry.label}
              </Button>
            ))}
          </div>

          {rows.map((row) => (
            <Card key={row.associationId}>
              <div className="crp-row__top">
                {/* `moss` is the darker fill and `mint` the paler one, so the
                    thing that asks for a decision takes the prominent tone and
                    the §12 classification beside it takes the quiet one —
                    Session D's own finding, applied the right way round. */}
                <Tag variant="sage">{row.highEffort ? 'High effort' : 'Light lift'}</Tag>
                {row.kind === 'proposal' ? <Tag variant="moss">Your turn to answer</Tag> : null}
              </div>
              <h2>{row.productName ?? 'A campaign'}</h2>
              {row.whyThisFitsYourAudience ? (
                <p className="crp-row__why">{row.whyThisFitsYourAudience}</p>
              ) : null}

              <dl className="kv">
                <div className="kv__row">
                  <dt>You earn</dt>
                  <dd>
                    {row.basePercent}% of every captured, validly attributed pre-order
                    {row.bidAllowed
                      ? `, and you may propose more — up to ${row.ceilingPercent}% in total`
                      : ''}
                    .
                  </dd>
                </div>
                <div className="kv__row">
                  <dt>Decide by</dt>
                  <dd>
                    {row.responseDeadlineAt
                      ? deadline(row.responseDeadlineAt)
                      : 'No deadline is recorded on this invitation yet.'}
                  </dd>
                </div>
              </dl>

              {/* Where the reference puts `predicted: '$450 to $1,200'`. */}
              <p className="cra-help">{PITCH_NO_PREDICTED_EARNINGS}</p>

              <div className="cra-acts">
                <Button
                  tier="primary"
                  aria-label={`Read the pitch for ${row.productName ?? 'this campaign'}`}
                  onClick={() =>
                    void navigate(`/creator/campaigns/${row.associationId}/opportunity`)
                  }
                >
                  Read the pitch
                </Button>
              </div>
            </Card>
          ))}

          <p className="cra-help">{DECLINING_COSTS_YOU_NOTHING}</p>
        </>
      )}
    </>
  );
}
