/**
 * The Creator's Earnings address — Creator Flow v2 **deviation 5**, Session F.
 *
 * A list, not a dashboard. One row per campaign, each row the Appendix B.7
 * block that campaign's own close view renders — the same resolver, the same
 * record, so the two cannot disagree (§33.8.13).
 *
 * ── There is no withdrawal, and the absence is the point ──────────────────
 * §22.1, verbatim: *"The Affiliate never requests a Proovd withdrawal and never
 * receives Backer funds before Transfer creation."* The reference draws
 * `Withdraw` twice and `Ready to withdraw` above it. There is no control here
 * to disable — the sentence stands where they were, and the suite walks every
 * button and link on the page for `withdraw`, `cash out`, and `request payout`.
 *
 * ── Nothing on this page is arithmetic ────────────────────────────────────
 * Every figure is `formatUsd` over a cents value the server computed. The
 * reference's `earned * 0.8` / `earned * 0.2` split is browser arithmetic with
 * invented weights, and §24.4's real split is three separate stored numbers.
 */

import { useEffect, useState } from 'react';
import {
  CREATOR_EARNINGS_ESTIMATE_IS_NOT_FINAL,
  CREATOR_EARNINGS_IS_NOT_A_RANKING,
  CREATOR_EARNINGS_LIFETIME_LABEL,
  CREATOR_EARNINGS_NOTHING_RECORDED,
  CREATOR_EARNINGS_PAYOUT_IS_STRIPES,
  CREATOR_EARNINGS_TITLE,
  EARNINGS_ARE_NOT_WITHDRAWN,
  TAX_DOCUMENTS_ARE_STRIPES,
  formatUsd,
} from '@proovd/shared';
import { Button, Card, NO_ACTION, StatePanel } from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import {
  CreatorRequestError,
  fetchCreatorEarnings,
  type CreatorEarningsRow,
  type CreatorEarningsView,
} from '../creator/api.js';

export function CreatorEarnings() {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; title: string; message: string }
    | { status: 'ready'; earnings: CreatorEarningsView }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { earnings } = await fetchCreatorEarnings();
        if (!cancelled) setState({ status: 'ready', earnings });
      } catch (caught) {
        if (cancelled) return;
        const detail = caught instanceof CreatorRequestError ? caught.detail : null;
        setState({
          status: 'error',
          title: detail?.title ?? 'This could not be loaded',
          message: detail?.whatHappened ?? 'Your earnings could not be loaded.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="cra-page">
        <StatePanel
          state="Loading your earnings"
          whatHappened="Proovd is gathering what each of your campaigns has recorded."
          next="It appears in a moment."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference="Your earnings"
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
          next="Try again, or ask us and we will read it out to you."
          owner="Proovd"
          nextUpdate="No update pending"
          action={
            <Button tier="secondary" href="/creator/home">
              Back to your home
            </Button>
          }
          reference="Your earnings"
          getHelp={{ href: supportMailto('My earnings') }}
        />
      </div>
    );
  }

  const e = state.earnings;
  const nothing = e.recordedCampaigns === 0;

  return (
    <div className="cra-page">
      <header className="cra-page__head">
        <h1>{CREATOR_EARNINGS_TITLE}</h1>
        {nothing ? (
          <p className="cra-lede">{CREATOR_EARNINGS_NOTHING_RECORDED}</p>
        ) : (
          <>
            <p className="cra-amount">{formatUsd(BigInt(e.lifetimeRecordedCents))}</p>
            <p className="cra-lede">
              {CREATOR_EARNINGS_LIFETIME_LABEL} · {e.recordedCampaigns}{' '}
              {e.recordedCampaigns === 1 ? 'campaign' : 'campaigns'}
            </p>
          </>
        )}
        <p className="cra-help">{CREATOR_EARNINGS_IS_NOT_A_RANKING}</p>
      </header>

      {/* §22.1: where the reference put `Withdraw`. */}
      <Card>
        <h2>How the money reaches you</h2>
        <p>{EARNINGS_ARE_NOT_WITHDRAWN}</p>
        <p className="cra-help">{CREATOR_EARNINGS_PAYOUT_IS_STRIPES}</p>
        <p className="cra-help">{TAX_DOCUMENTS_ARE_STRIPES}</p>
        <Button tier="secondary" href="/creator/payouts">
          Your payout account
        </Button>
      </Card>

      {e.rows.length === 0 ? (
        <Card>
          <h2>No campaigns yet</h2>
          <p className="cra-help">
            When you accept a campaign and it closes, what it earned appears here.
          </p>
        </Card>
      ) : (
        e.rows.map((row) => <EarningsRow key={row.associationId} row={row} />)
      )}
    </div>
  );
}

function EarningsRow({ row }: { row: CreatorEarningsRow }) {
  return (
    <Card>
      <h2>{row.campaignTitle}</h2>
      {row.close ? (
        <>
          {/* Appendix B.7, resolved server-side — the same block the campaign's
              own close view and the §27.4 email carry. */}
          <pre className="cra-b7">{row.close.earnings.statusBlock}</pre>
          {row.close.earnings.finalization === 'pending' ? (
            <p className="cra-help">{CREATOR_EARNINGS_ESTIMATE_IS_NOT_FINAL}</p>
          ) : null}
          {row.close.earnings.final ? (
            <dl className="kv">
              <div className="kv__row">
                <dt>Commission</dt>
                <dd>{formatUsd(BigInt(row.close.earnings.final.commissionCents))}</dd>
              </div>
              <div className="kv__row">
                <dt>Bonus</dt>
                <dd>{formatUsd(BigInt(row.close.earnings.final.bonusCents))}</dd>
              </div>
              <div className="kv__row">
                <dt>Fixed Creator payment</dt>
                <dd>{formatUsd(BigInt(row.close.earnings.final.eligibleFixedCents))}</dd>
              </div>
            </dl>
          ) : null}
          <p className="cra-help">{row.close.nextReviewLine}</p>
        </>
      ) : (
        <p className="cra-help">{row.waitingOn}</p>
      )}
      <Button
        tier="tertiary"
        href={`/creator/campaigns/${encodeURIComponent(row.associationId)}/partnership`}
      >
        Open {row.campaignTitle}
      </Button>
    </Card>
  );
}
