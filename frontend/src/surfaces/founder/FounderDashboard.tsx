/**
 * The Founder's home — Founder Dashboard Session B (B1, B3, B4).
 *
 * `docs/phases/founder-dashboard.md`. Four chapters at ONE address, picking up
 * where the Founder Flow's `You're live` leaves off. This session builds the
 * chrome; the chapters' content is Sessions C–F.
 *
 * ── The first non-Admin authenticated shell in the product ──────────────────
 * All 26 Founder routes were bare top-level pages. This is the first Founder
 * chrome, and it is deliberately neither of the two that already exist:
 *
 *   - not `AdminFrame`. §26 licenses dashboard density in Admin and NOWHERE
 *     else, and sharing that chrome is exactly how the density leaks into a
 *     Founder surface. The rail here is four words, not eight sections.
 *   - not `PublicLayout`. That carries the site header, the §31.4 footer
 *     sitemap and the staffed-hours chat gate — a signed-in Founder reading
 *     their own campaign does not need a marketing nav, and the footer's
 *     fourteen public links are wayfinding for somebody who is not signed in.
 *
 * ── The chapter is in the ADDRESS ───────────────────────────────────────────
 * `?chapter=` rather than component state (DNA §5.12), the reasoning
 * `routes.tsx` already records for the draft flow and the Admin record tabs: a
 * position that vanishes on reload is one nobody can bookmark or send. The
 * path itself does not move — `/campaigns/:campaignId/home` is what the flow's
 * `LiveStep` links to and what §27's emails point at, so the four chapters are
 * a search parameter under an address that keeps working.
 *
 * ── Nothing arrives by query parameter except the chapter (B4) ──────────────
 * The supplied reference reads `?phase=`, `?type=`, `?effort=`, `?upfront=` and
 * `?day=` and drives its whole state from them. Here every one is a column,
 * read on the server: `campaigns.status` decides which chapter a campaign is
 * IN, and `campaign_live_at` decides whether the money chapters may open at
 * all. `?chapter=` is the one parameter this surface reads, it names a POSITION
 * rather than a fact, and a chapter that is not unlocked is not honoured —
 * `founderChapterOrDefault` sends that request to the campaign's real chapter
 * rather than refusing, because a URL somebody kept from last month is not an
 * attack, it is a stale bookmark.
 *
 * ── One h1, and the chapter owns it ─────────────────────────────────────────
 * §33.11.2 requires exactly one. The shell renders none: the band is a
 * `<header>` and the rail is a `<nav>`, and whichever chapter is showing
 * supplies the heading — `CampaignHome` has had its own since Phase 23a.
 */

import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router';
import {
  FOUNDER_CHAPTERS,
  FOUNDER_CHAPTERS_INTRO,
  FOUNDER_CHAPTER_BUILD,
  campaignStatusLabel,
  founderChapterForStatus,
  founderChapterOrDefault,
  founderChapterUnlocked,
  type FounderChapterFacts,
  type FounderChapterId,
} from '@proovd/shared';
import { Drawer, Measure, NO_ACTION, Section, StatePanel, Tag } from '../../components/index.js';
import { SurfaceLoading, supportMailto } from '../../features/public/states.js';
import { CampaignHome } from './CampaignHome.js';
import { ChooseChapter } from './chapters/ChooseChapter.js';
import {
  fetchFounderDashboard,
  FounderRequestError,
  type FounderDashboardView,
} from './api.js';

type State =
  | { status: 'loading' }
  | { status: 'error'; title: string; detail: string }
  | { status: 'ready'; dashboard: FounderDashboardView };

/** The chapter's own content, or an honest account of where that work lives. */
function ChapterBody({
  chapter,
  campaignId,
  campaignType,
}: {
  chapter: FounderChapterId;
  campaignId: string;
  campaignType: string | null;
}) {
  // §20's Glance, ranked Act and Explore have existed since Phase 17a, are
  // swept by §33.11, and are what this chapter is FOR. Rendering a placeholder
  // over a working surface would be a regression dressed as progress; Session D
  // rebuilds it to the reference.
  if (chapter === 'live') return <CampaignHome />;
  // Session C: §14.5's roster, §14.2's three responses, §14.3's bonus, and
  // deviation 1's meeting request.
  if (chapter === 'choose') {
    return <ChooseChapter campaignId={campaignId} campaignType={campaignType} />;
  }

  const build = FOUNDER_CHAPTER_BUILD[chapter];
  const meta = FOUNDER_CHAPTERS.find((c) => c.id === chapter)!;
  const owners = build.ownedForNowBy ?? [];

  /*
    The interim chapter, in the shape the Admin rebuilds established: it names
    the surface that owns this work TODAY with a real route to it, and says
    which session replaces it. It does not apologise and it does not render an
    empty frame — a chapter that offered nothing would be worse than the
    addresses that already work.
  */
  return (
    <Section aria-labelledby={`fd-chapter-${chapter}`}>
      <Measure>
        <p className="kicker">{meta.label}</p>
        <h1 className="h2" id={`fd-chapter-${chapter}`}>
          {meta.title}
        </h1>
        <p className="lede">{meta.note}</p>
        <StatePanel
          state="This chapter is not built yet"
          whatHappened={`Everything it will hold already exists and is reachable — it has not moved here yet. ${build.session} builds this chapter.`}
          next="Open the surface that owns this work today. Nothing about your campaign is waiting on this page."
          owner="Proovd"
          nextUpdate={`When ${build.session} ships`}
          /*
            ONE control (DNA §5.6). The first owner is this chapter's primary
            surface; any others sit below the panel rather than inside this
            slot. A block list here renders beside `getHelp` in the panel's own
            action row, which is what the browser pass caught — jsdom has no
            layout, so nothing else could have.
          */
          action={
            owners[0] ? (
              <RouterLink to={owners[0].path.replace(':campaignId', campaignId)}>
                {owners[0].label}
              </RouterLink>
            ) : (
              NO_ACTION
            )
          }
          reference={campaignId}
          getHelp={{ href: supportMailto(`Campaign ${campaignId} — ${meta.label}`) }}
        />
        {owners.length > 1 ? (
          <>
            <p className="kicker">Also on this campaign</p>
            <ul className="doc-list">
              {owners.slice(1).map((owner) => (
                <li key={owner.path}>
                  <RouterLink to={owner.path.replace(':campaignId', campaignId)}>
                    {owner.label}
                  </RouterLink>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Measure>
    </Section>
  );
}

/** The drawer — every chapter, what it is, and why a locked one is locked. */
function ChaptersDrawer({
  facts,
  viewing,
  campaignId,
}: {
  facts: FounderChapterFacts;
  viewing: FounderChapterId;
  campaignId: string;
}) {
  const now = founderChapterForStatus(facts.status);
  return (
    <Drawer
      trigger={
        <button type="button" className="btn btn--tertiary fd-band__more">
          The whole story
        </button>
      }
      eyebrow="Your campaign"
      title="The whole story."
    >
      <p>{FOUNDER_CHAPTERS_INTRO}</p>
      <ul className="doc-list fd-drawer__list">
        {FOUNDER_CHAPTERS.map((chapter, index) => {
          const unlocked = founderChapterUnlocked(chapter.id, facts);
          const status = !unlocked
            ? 'Not yet'
            : chapter.id === now
              ? 'Now'
              : chapter.id === viewing
                ? 'Open'
                : 'Available';
          return (
            <li key={chapter.id}>
              <span className="fd-drawer__tag">
                {`0${index + 1}`} · {status}
              </span>
              {unlocked ? (
                <RouterLink to={`/campaigns/${campaignId}/home?chapter=${chapter.id}`}>
                  {chapter.title}
                </RouterLink>
              ) : (
                <span className="fd-drawer__title">{chapter.title}</span>
              )}
              {/*
                A locked chapter shows its OWN reason rather than the note about
                what it will contain. "Opens when the campaign closes" is the
                answer to the question somebody clicking a dead tab is asking.
              */}
              <span className="fd-drawer__note">
                {unlocked ? chapter.note : chapter.lockedLine}
              </span>
            </li>
          );
        })}
      </ul>
    </Drawer>
  );
}

export function FounderDashboard() {
  const { campaignId = '' } = useParams<{ campaignId: string }>();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    fetchFounderDashboard(campaignId)
      .then((result) => {
        if (live) setState({ status: 'ready', dashboard: result.dashboard });
      })
      .catch((error: unknown) => {
        if (!live) return;
        const failure =
          error instanceof FounderRequestError
            ? {
                title: error.detail.title,
                detail: `${error.detail.whatHappened ?? ''} ${error.detail.next ?? ''}`.trim(),
              }
            : {
                title: 'We could not load your campaign',
                detail: 'The request did not complete. Nothing about your campaign changed.',
              };
        setState({ status: 'error', ...failure });
      });
    return () => {
      live = false;
    };
  }, [campaignId]);

  if (state.status === 'loading') {
    return <SurfaceLoading subject="your campaign" reference={campaignId} />;
  }

  if (state.status === 'error') {
    // §33.11.7's six questions on the surface a Founder opens to find out what
    // is happening. It is deliberately not a sign-in prompt: only a 401/403
    // means the session is the problem, and asking somebody to retype a
    // password that cannot help is §1.4's failure (`CreatorCampaigns`' rule).
    return (
      <Section aria-labelledby="fd-error">
        <Measure>
          <h1 className="h2" id="fd-error">
            {state.title}
          </h1>
          <StatePanel
            state={state.title}
            whatHappened={state.detail}
            next="Reload the page. Your campaign is read fresh every time this page opens, so nothing was lost."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: supportMailto(`Campaign home — ${campaignId}`) }}
          />
        </Measure>
      </Section>
    );
  }

  const { dashboard } = state;
  const facts: FounderChapterFacts = {
    status: dashboard.status,
    everLive: dashboard.campaignLiveAt !== null,
  };
  const chapter = founderChapterOrDefault(params.get('chapter'), facts);

  function openChapter(next: FounderChapterId) {
    // One write. Two sequential `setParams` calls each rebuild from the same
    // closed-over snapshot and the second restores what the first removed —
    // the defect `CreatorsDirectory` records.
    const updated = new URLSearchParams(params);
    updated.set('chapter', next);
    setParams(updated);
  }

  return (
    <div className="fd">
      <header className="fd-band">
        {/* The wordmark is the way back, as it is in every other shell. */}
        <RouterLink to="/campaigns" className="fd-band__brand">
          Proovd
        </RouterLink>
        <div className="fd-band__name">
          {/* §14.4's title, or nothing. A campaign id is not a name (§1.4). */}
          {dashboard.title ? <span className="fd-band__title">{dashboard.title}</span> : null}
          <Tag>{campaignStatusLabel(dashboard.status)}</Tag>
        </div>
        <ChaptersDrawer facts={facts} viewing={chapter} campaignId={campaignId} />
      </header>

      <nav className="fd-rail" aria-label="Campaign chapters">
        <ul>
          {FOUNDER_CHAPTERS.map((entry) => {
            const unlocked = founderChapterUnlocked(entry.id, facts);
            const current = entry.id === chapter;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className={`fd-chapter${current ? ' is-current' : ''}${unlocked ? '' : ' is-locked'}`}
                  /*
                    `aria-disabled`, never `disabled`: a disabled control is
                    removed from the tab order, so a keyboard user meets silence
                    where a sighted user at least sees a dimmed tab. The reason
                    rides the accessible name, so the announcement is "Get paid,
                    Opens when the campaign closes…" rather than a mystery.
                    (§28.5, and the Support workspace's own rule.)
                  */
                  aria-disabled={unlocked ? undefined : true}
                  aria-current={current ? 'page' : undefined}
                  aria-label={unlocked ? undefined : `${entry.label} — ${entry.lockedLine}`}
                  onClick={unlocked ? () => openChapter(entry.id) : undefined}
                >
                  {entry.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <ChapterBody chapter={chapter} campaignId={campaignId} campaignType={dashboard.type} />
    </div>
  );
}
