/**
 * Admin → Backers — Spec §26.1, §26.5, §25.7, §28.4, §18, DNA §5.2, §5.14.
 *
 * Two readings of one filtered set: what every Creator brought in, and every
 * Backer behind those totals.
 *
 * ── This is a read, and there is nowhere to add a control ───────────────────
 * No cancel, refund, charge, resend, contact, or export control, and the API
 * behind it is one GET. Every pre-order operation already has a router that
 * owns its rules — §20's cancellation, §21's close batch and retry window,
 * §24.8's refund cases, §24.11's disputes, §26.7's suspend/kill — and a
 * duplicate control here would be a second door into them. The reference's own
 * prototype contains no mutation at all, and `backers.test.tsx` asserts nothing
 * on this surface submits.
 *
 * ── The filters are the QUERY, not a browser predicate ──────────────────────
 * Every other Admin workspace filters in the browser over a server-composed
 * `searchText`. This one must not: a row here carries a Backer's email and
 * their own free-text answer, so a set filtered in the browser is a set that
 * was transmitted in full first, and every Backer's identity would be in
 * devtools for anyone who opened the page regardless of what the table showed.
 * So the filter state goes up and only the rendered page comes back.
 *
 * That is also why the search is debounced rather than fired per keystroke —
 * it is a database query over a free-text column, not an array filter.
 *
 * ── The whole position is in the URL ────────────────────────────────────────
 * View, campaign, Creator, window, both searches, and the page. A filtered
 * Backer list is a position, and one that vanishes on reload is one an Admin
 * cannot send to a colleague (DNA §5.12) — which matters most for the
 * drill-through, whose entire job is "show me the Backers behind this total".
 * `?view=backers&campaignId=…&affiliate=…` is a real address, so it survives
 * the back button and pastes into a support case.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  BACKERS_IS_READ_ONLY,
  BACKER_TIME_WINDOWS,
  CONSENT_ABSENT_IS_NOT_GRANTED,
  CONSENT_GOVERNS,
  NO_AFFILIATE_RESULTS,
  NO_BACKERS_MATCH,
  PREORDER_VALUE_IS_PRE_TAX,
  UNATTRIBUTED_FILTER_VALUE,
} from '@proovd/shared';
import { Button, Input, StatePanel } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import { fetchBackers, AdminRequestError, type BackersDirectoryView } from './api.js';
import {
  AnswersCell,
  AttributionCell,
  BackerCell,
  ConsentBadge,
  FilterField,
  StatCell,
} from './shared.js';

type View = 'affiliates' | 'backers';

/** How long the surface waits before turning a keystroke into a query. */
const SEARCH_DEBOUNCE_MS = 300;

export function BackersWorkspace() {
  const [params, setParams] = useSearchParams();
  const [view, setViewState] = useState<BackersDirectoryView | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [loading, setLoading] = useState(true);
  const surface = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);

  const active: View = params.get('view') === 'backers' ? 'backers' : 'affiliates';
  const campaignId = params.get('campaignId') ?? '';
  const affiliate = params.get('affiliate') ?? '';
  const windowKey = params.get('window') ?? 'lifetime';
  const affiliateSearch = params.get('affiliateSearch') ?? '';
  const backerSearch = params.get('backerSearch') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  /* The two search boxes are local so typing is not a round trip; the URL (and
     therefore the query) follows after the debounce. Without this the address
     bar would rewrite on every keystroke and the back button would walk
     backwards through half-typed words. */
  const [affiliateDraft, setAffiliateDraft] = useState(affiliateSearch);
  const [backerDraft, setBackerDraft] = useState(backerSearch);

  const load = useCallback(() => {
    setLoadError(null);
    setLoading(true);
    fetchBackers({
      campaignId: campaignId || undefined,
      affiliate: affiliate || undefined,
      window: windowKey,
      affiliateSearch: affiliateSearch || undefined,
      backerSearch: backerSearch || undefined,
      page,
    })
      .then((next) => {
        setViewState(next);
        setLoading(false);
      })
      .catch((error: unknown) => {
        setLoading(false);
        setLoadError(
          error instanceof AdminRequestError
            ? error
            : new AdminRequestError({
                error: 'unreachable',
                status: 0,
                title: 'Proovd could not be reached',
                whatHappened:
                  'The Backers list could not be read, and the failure carried no explanation.',
                next: 'Try the read again. Nothing was changed by the attempt.',
              }),
        );
      });
  }, [campaignId, affiliate, windowKey, affiliateSearch, backerSearch, page]);

  useEffect(load, [load]);

  /* Debounce each box into the URL. Resetting to page 1 is deliberate: a new
     search on page 3 of the old one would show an empty page and read as "no
     results" when there are results on page 1. */
  useEffect(() => {
    if (affiliateDraft === affiliateSearch) return;
    const timer = setTimeout(() => update({ affiliateSearch: affiliateDraft, page: '' }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affiliateDraft]);

  useEffect(() => {
    if (backerDraft === backerSearch) return;
    const timer = setTimeout(() => update({ backerSearch: backerDraft, page: '' }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backerDraft]);

  useProovdMotion(surface, [view, active]);

  /**
   * One writer for the address.
   *
   * Every change goes through here in ONE `setParams` call. Two sequential
   * writes would each rebuild from the same closed-over snapshot and the second
   * would restore what the first removed — the bug the Creators directory hit
   * when its empty-state reset cleared two keys separately.
   */
  function update(next: Record<string, string>) {
    const updated = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) updated.set(key, value);
      else updated.delete(key);
    }
    setParams(updated, { replace: true });
  }

  /**
   * The drill-through: an Affiliate row opens the Backers behind its total.
   *
   * Filters set, searches cleared, page reset, view switched — all in one URL
   * write, so it is a single history entry an Admin can back out of and a link
   * they can send. The reference scrolled to the view tabs; the same move here
   * lands the reader on the tabs rather than mid-table.
   */
  function drillThrough(target: { campaignId: string; associationId: string }) {
    setBackerDraft('');
    setAffiliateDraft(affiliateDraft);
    const updated = new URLSearchParams(params);
    updated.set('view', 'backers');
    updated.set('campaignId', target.campaignId);
    updated.set('affiliate', target.associationId);
    updated.delete('backerSearch');
    updated.delete('page');
    setParams(updated, { replace: false });
    requestAnimationFrame(() => {
      tabs.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
  }

  if (loadError) {
    return (
      <StatePanel
        state={loadError.detail.title}
        whatHappened={
          loadError.detail.whatHappened ??
          'The Backers list could not be read, so nothing on this page is current.'
        }
        next={loadError.detail.next ?? 'Try the read again. Nothing was changed by the attempt.'}
        owner="Proovd"
        nextUpdate="When you try again"
        action={
          <Button tier="primary" onClick={load}>
            Try the read again
          </Button>
        }
        reference="Admin · Backers"
        ring
      />
    );
  }

  if (!view) {
    return (
      <StatePanel
        state="Reading Backers and pre-orders"
        whatHappened="Proovd is reading every pre-order, what each Creator brought in, and the checkout answers behind those totals."
        next="The page appears as soon as that comes back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Backers"
      />
    );
  }

  const windowDefinition = BACKER_TIME_WINDOWS.find((w) => w.key === windowKey);

  return (
    <div ref={surface} className={cn('bkr', loading && 'is-loading')}>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <header className="bkr-hero">
        <div>
          <p className="kicker">Backers</p>
          <h1 className="h2" data-reveal="headline">
            Backers and pre-orders
          </h1>
          <p className="grey bkr-hero__lede">
            See what every Affiliate brought in, then see each Backer, pre-order, email, and
            checkout answer.
          </p>
          <p className="helper bkr-hero__posture">{BACKERS_IS_READ_ONLY}</p>
        </div>

        {/* The reference's three figures. The labels say "Affiliate", because
            the totals count Creator-attributed pre-orders only — the note below
            says what they leave out, so the two views cannot look wrong. */}
        <div className="bkr-totals" aria-label="Totals">
          <div className="bkr-total">
            <strong>{view.totals.attributedBackers.value}</strong>
            <span>{view.totals.attributedBackers.label}</span>
          </div>
          <div className="bkr-total">
            <strong>{view.totals.attributedValue.value}</strong>
            <span>{view.totals.attributedValue.label}</span>
          </div>
          <div className="bkr-total">
            <strong>{view.totals.affiliates.value}</strong>
            <span>{view.totals.affiliates.label}</span>
          </div>
        </div>
      </header>

      <p className="helper bkr-note">{view.totals.excludesNote}</p>

      {/* ── View tabs ───────────────────────────────────────────────────── */}
      <div ref={tabs}>
        <nav className="bkr-views" aria-label="Backer views">
          <button
            type="button"
            className={cn('bkr-view', active === 'affiliates' && 'is-active')}
            aria-current={active === 'affiliates' ? 'page' : undefined}
            onClick={() => update({ view: '' })}
          >
            Affiliate results
          </button>
          <button
            type="button"
            className={cn('bkr-view', active === 'backers' && 'is-active')}
            aria-current={active === 'backers' ? 'page' : undefined}
            onClick={() => update({ view: 'backers' })}
          >
            Every Backer
          </button>
        </nav>
      </div>

      {active === 'affiliates' ? (
        <section aria-label="Affiliate results">
          <header className="bkr-head">
            <div>
              <p className="kicker">Affiliate results</p>
              <h2 className="h3">Who brought in what</h2>
              <p className="grey">Click an Affiliate to see the Backers behind the total.</p>
            </div>
            <span className="bkr-shown">{view.affiliateResults.shown}</span>
          </header>

          <div className="bkr-filters">
            <FilterField id="bkr-a-campaign" label="Campaign">
              <select
                id="bkr-a-campaign"
                className="input"
                value={campaignId}
                onChange={(event) => update({ campaignId: event.target.value, page: '' })}
              >
                <option value="">All campaigns</option>
                {view.campaigns.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FilterField>

            {/* The window is a real bound on the pre-order date, anchored on the
                campaign's launch — never the reference's prorated arithmetic.
                It needs one campaign to anchor on, so it is disabled until one
                is chosen and says why rather than silently doing nothing. */}
            <FilterField
              id="bkr-a-window"
              label="Time"
              hint={
                campaignId
                  ? (view.affiliateResults.anchorNote ?? windowDefinition?.anchorNote ?? null)
                  : 'Choose one campaign first — two campaigns launched months apart share no "first 7 days".'
              }
            >
              <select
                id="bkr-a-window"
                className="input"
                aria-describedby="bkr-a-window-hint"
                value={windowKey}
                disabled={!campaignId}
                onChange={(event) => update({ window: event.target.value, page: '' })}
              >
                {BACKER_TIME_WINDOWS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField id="bkr-a-search" label="Find Affiliate">
              <Input
                id="bkr-a-search"
                placeholder="Name or campaign"
                value={affiliateDraft}
                onChange={(event) => setAffiliateDraft(event.target.value)}
              />
            </FilterField>
          </div>

          <div className="bkr-table bkr-table--aff">
            {/*
              The column strip is decorative, and `aria-hidden` is the honest
              marking rather than a shortcut.

              A `role="row"` with no `role="table"` above it is an ARIA parent
              violation, and adding the full table roles would be a lie: the
              Affiliate rows are `<button>`s, and a button cannot be a row. What
              makes that safe is that every cell already carries its own label —
              the value+label numeric pairs, the handle under the name — which
              is the same property the ≤700px card layout relies on when it
              hides this strip entirely.
            */}
            <div className="bkr-thead" aria-hidden="true">
              <span>Affiliate</span>
              <span>Campaign</span>
              <span>Backers</span>
              <span>Pre-order value</span>
              <span>Time active</span>
              <span>Average</span>
              <span aria-hidden="true" />
            </div>

            {view.affiliateResults.rows.map((row) => (
              <button
                key={row.associationId}
                type="button"
                className="bkr-row bkr-row--aff"
                onClick={() => drillThrough(row.drillThrough)}
              >
                <span className="bkr-person">
                  <strong>{row.name}</strong>
                  <small>{row.handle}</small>
                </span>
                <span className="bkr-person">
                  <strong>{row.campaignName}</strong>
                  <small>Campaign results</small>
                </span>
                <StatCell value={String(row.backers)} label={row.backersLabel} />
                <StatCell value={row.preorderValue} label="in pre-orders" />
                <StatCell
                  value={row.timeActive}
                  label="active"
                  waitingOn={row.timeActiveWaitingOn}
                />
                <StatCell value={row.average} label="average" waitingOn="No Backers yet" />
                <span className="bkr-arrow" aria-hidden="true">
                  →
                </span>
              </button>
            ))}

            {view.affiliateResults.rows.length === 0 ? (
              <p className="bkr-empty">
                {/* Three distinct states, not one. A campaign with real Backers
                    and no Creator attribution at all is not "no match" — an
                    Admin reading that would go looking for a broken filter. */}
                {view.affiliateResults.noAttributionNote ?? NO_AFFILIATE_RESULTS}
              </p>
            ) : null}
          </div>

          <p className="helper bkr-note">{PREORDER_VALUE_IS_PRE_TAX}</p>
        </section>
      ) : (
        <section aria-label="Every Backer">
          <header className="bkr-head">
            <div>
              <p className="kicker">Every Backer</p>
              <h2 className="h3">Pre-orders and checkout answers</h2>
              <p className="grey">{view.noRecordPage}</p>
            </div>
            <span className="bkr-shown">{view.backers.shown}</span>
          </header>

          <div className="bkr-filters">
            <FilterField id="bkr-b-campaign" label="Campaign">
              <select
                id="bkr-b-campaign"
                className="input"
                value={campaignId}
                onChange={(event) => update({ campaignId: event.target.value, page: '' })}
              >
                <option value="">All campaigns</option>
                {view.campaigns.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField id="bkr-b-affiliate" label="Affiliate">
              <select
                id="bkr-b-affiliate"
                className="input"
                value={affiliate}
                onChange={(event) => update({ affiliate: event.target.value, page: '' })}
              >
                <option value="">All Affiliates</option>
                {/* `organic` is a sentinel for absent attribution and is sent as
                    a lowercase key, never as the display word — so no Creator
                    handle can collide with it. */}
                <option value={UNATTRIBUTED_FILTER_VALUE}>Organic</option>
                {view.affiliates
                  .filter((option) => option.value !== UNATTRIBUTED_FILTER_VALUE)
                  .map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
              </select>
            </FilterField>

            <FilterField id="bkr-b-search" label="Find Backer">
              <Input
                id="bkr-b-search"
                placeholder="Name, email, or answer"
                value={backerDraft}
                onChange={(event) => setBackerDraft(event.target.value)}
              />
            </FilterField>
          </div>

          {/* §25.7's line, stated where the answers are, not in a footer. */}
          <p className="helper bkr-note">{view.answersNotExportable}</p>

          <div className="bkr-table bkr-table--bkr">
            {/* Decorative, as above: each cell self-labels, which is what lets
                the ≤700px card layout drop this strip and stay readable. */}
            <div className="bkr-thead" aria-hidden="true">
              <span>Backer and email</span>
              <span>Pre-order</span>
              <span>Campaign</span>
              <span>Affiliate</span>
              <span>Checkout answers</span>
              <span>Date</span>
            </div>

            {view.backers.rows.map((row) => (
              <div className="bkr-row bkr-row--bkr" key={row.reservationId}>
                <BackerCell
                  email={row.email}
                  backerNumber={row.backerNumber}
                  status={row.statusLabel}
                />
                <StatCell value={row.orderAmount} label="pre-order" />
                <span className="bkr-person">
                  {/* The column strip is decorative, so a bare campaign name
                      would reach a screen reader with nothing saying what it
                      is. The same absence is what the ≤700px card shows. */}
                  <span className="sr-only">Campaign: </span>
                  <strong>{row.campaignName}</strong>
                </span>
                <AttributionCell
                  name={row.affiliateName}
                  handle={row.affiliateHandle}
                  status={row.attributionStatus}
                />
                <span className="bkr-answers">
                  {/* The consent rides WITH the answers, because it governs what
                      may be done with them — not with the identity, which §19
                      shares with the Founder mandatorily and cannot retract. */}
                  <ConsentBadge
                    state={row.consentState}
                    label={row.consentLabel}
                    permits={row.consentPermits}
                  />
                  <AnswersCell answers={row.answers} />
                  <small className="bkr-consent__permits">{row.consentPermits}</small>
                </span>
                <span className="bkr-date">
                  <span className="sr-only">Pre-ordered: </span>
                  {row.date}
                </span>
              </div>
            ))}

            {view.backers.rows.length === 0 ? <p className="bkr-empty">{NO_BACKERS_MATCH}</p> : null}
          </div>

          {view.backers.total > view.backers.pageSize ? (
            <nav className="bkr-pager" aria-label="Backer pages">
              <Button
                tier="secondary"
                small
                disabled={page <= 1}
                onClick={() => update({ page: page > 2 ? String(page - 1) : '' })}
              >
                Previous
              </Button>
              <span className="bkr-pager__at">
                Page {view.backers.page} of{' '}
                {Math.max(1, Math.ceil(view.backers.total / view.backers.pageSize))}
              </span>
              <Button
                tier="secondary"
                small
                disabled={!view.backers.hasMore}
                onClick={() => update({ page: String(page + 1) })}
              >
                Next
              </Button>
            </nav>
          ) : null}

          {/* Both consent sentences, where the decision is made. The first says
              what the badge governs; the second is why an absent answer is
              never read as a granted one. */}
          <div className="bkr-consent-note">
            <p className="helper">
              <b>What this consent governs.</b> {CONSENT_GOVERNS}
            </p>
            <p className="helper">{CONSENT_ABSENT_IS_NOT_GRANTED}</p>
            <p className="helper">{PREORDER_VALUE_IS_PRE_TAX}</p>
          </div>
        </section>
      )}
    </div>
  );
}
