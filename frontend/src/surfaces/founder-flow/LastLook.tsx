/**
 * Screen 15 — Last look — Founder Flow v2, Session D.
 *
 * All eight answers in one grid, what the listing fee comes to, and a way into
 * any of the five that can still change. §12 asks for "a complete
 * preview/summary in the secondary surface"; this is it, promoted to its own
 * page because in a sequence OF pages the summary is a place rather than a
 * panel.
 *
 * ── Two registers, two behaviours, and the register says which ──────────────
 * The first three cards are §9's answers and the last five are §12's. That is
 * not a layout distinction: a §9 answer is text, locked at submission, and its
 * route is behind the draft token §10's claim invalidated — so there is no
 * address to send anybody to, and the card offers nothing. A §12 answer is
 * COMPLETE or not, decided server-side, and opens. `FOUNDER_ANSWER_SEQUENCE`
 * carries `editableAfterClaim` so that difference is a fact rather than an
 * index comparison somebody could reorder into a bug.
 *
 * ── The fee is the server's number ─────────────────────────────────────────
 * The reference hardcodes `FEE_BASE=35`, `FEE_PER=2`, `FEE_FLOOR=25`. All four
 * are §6 settings, and Phase 06's rule is that a hardcoded number is a bug even
 * when it is right. Every amount here is a decimal string of integer cents the
 * server computed, formatted and never calculated — there is no arithmetic on a
 * fee anywhere under `frontend/src/surfaces/`.
 *
 * ── Where the money screens are ────────────────────────────────────────────
 * `All good` goes to the Stripe and listing-fee surfaces, which are Session E's
 * screens 25 and 20. Until they land it goes to the address that holds them
 * today, and says what happens next rather than implying the flow ends here.
 */

import { useParams } from 'react-router';
import {
  FLOW_LAST_LOOK_RETURNS,
  FOUNDER_ANSWER_SEQUENCE,
  OPTIONAL_ITEMS,
  formatUsd,
  founderAnswerLabel,
  founderFlowPath,
  type FounderAnswerEntry,
} from '@proovd/shared';
import { Button, StatePanel, Tag, NO_ACTION } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { FlowPage, useFlowNav } from './FlowPage.js';
import { useSetupWorkspace } from './useSetup.js';
import type { WorkspaceState } from '../founder/api.js';

export function LastLook() {
  const { campaignId = '' } = useParams();
  const setup = useSetupWorkspace(campaignId);

  if (setup.failure) {
    return (
      <FlowPage pageId="last-look" param={campaignId}>
        <div className="ff-answer">
          <StatePanel
            state="We could not open your campaign"
            whatHappened={setup.failure}
            next="Reload the page. Nothing you have saved is affected — this is only about reading it back."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
            ring
          />
        </div>
      </FlowPage>
    );
  }

  if (!setup.state) return <SurfaceLoading subject="your answers" reference="Your campaign" />;

  return (
    <FlowPage pageId="last-look" param={campaignId} badge>
      <Body campaignId={campaignId} state={setup.state} />
    </FlowPage>
  );
}

function Body({ campaignId, state }: { campaignId: string; state: WorkspaceState }) {
  const { leave, leaveToPage } = useFlowNav();

  return (
    <div className="ff-look">
      <div className="ff-look__head">
        <h1 className="ff-look__title" data-anim="head">
          Last look.
        </h1>
        <div className="ff-look__fee" data-anim="sub">
          <span className="ff-look__fee-label">Listing fee at checkout</span>
          <span className="ff-look__fee-value">
            {state.fee ? formatUsd(BigInt(state.fee.subtotalCents)) : '—'}
          </span>
          {state.fee ? (
            <span className="ff-look__fee-note">
              {state.fee.completedItems > 0
                ? `Down from ${formatUsd(BigInt(state.fee.baseCents))} — ${formatUsd(BigInt(state.fee.discountCents))} off for ${state.fee.completedItems} of the five optional answers. Sales tax is added at payment.`
                : `${formatUsd(BigInt(state.fee.baseCents))} to list. Each of the five optional answers takes ${formatUsd(BigInt(state.fee.itemDiscountCents))} off. Sales tax is added at payment.`}
            </span>
          ) : null}
        </div>
      </div>

      <p className="ff-look__returns" data-anim="note">
        {FLOW_LAST_LOOK_RETURNS}
      </p>

      <ul className="ff-look__grid" data-anim="field">
        {FOUNDER_ANSWER_SEQUENCE.map((entry) => (
          <AnswerCard
            key={entry.key}
            entry={entry}
            state={state}
            onOpen={() =>
              leave(
                `${founderFlowPath(entry.pageId, campaignId)}?from=review`,
                1,
              )
            }
          />
        ))}
      </ul>

      <div className="ff-nav" data-anim="cta">
        <Button tier="tertiary" onClick={() => leaveToPage('socials', -1)}>
          Back to Your socials
        </Button>
        {/* Session E replaces this with screens 25 and 20. Until it does, the
            address that holds the payout setup and the listing fee today is
            where `All good` goes — a control that named a page which does not
            exist yet would be §1.4's failure with a forward arrow on it. */}
        <Button
          tier="primary"
          onClick={() => leave(`/campaigns/${encodeURIComponent(campaignId)}/workspace`, 1)}
        >
          All good — go to payouts and your listing fee
        </Button>
      </div>
    </div>
  );
}

function AnswerCard({
  entry,
  state,
  onOpen,
}: {
  entry: FounderAnswerEntry;
  state: WorkspaceState;
  onOpen: () => void;
}) {
  const label = founderAnswerLabel(entry);

  if (entry.owner === 'vetting') {
    const answered =
      entry.key === 'problem'
        ? state.vetting.problem
        : entry.key === 'solution'
          ? state.vetting.solution
          : state.vetting.competition;

    return (
      <li className="ff-card ff-card--locked">
        <span className="ff-card__title">{label}</span>
        <span className="ff-card__tag">
          <Tag variant={answered ? 'moss' : 'default'}>{answered ? 'Submitted' : 'Missing'}</Tag>
        </span>
        <p className="ff-card__body">
          {answered
            ? answered.length > 160
              ? `${answered.slice(0, 160).trimEnd()}…`
              : answered
            : 'This one was never filled in.'}
        </p>
        {/* §9 locks these at submission and the route that wrote them is behind
            a token that no longer exists, so there is nothing to open (§1.4). */}
        <p className="ff-card__closed">
          Submitted with your answers. Contact support if this needs changing.
        </p>
      </li>
    );
  }

  const item = state.items.find((row) => row.item === entry.key);
  const record = OPTIONAL_ITEMS.find((row) => row.key === entry.key);
  const complete = item?.complete === true;

  return (
    <li className="ff-card">
      <span className="ff-card__title">{label}</span>
      <span className="ff-card__tag">
        <Tag variant={complete ? 'moss' : 'default'}>{complete ? 'Added' : 'Missing'}</Tag>
      </span>
      {/* The §12 rule is written as the finished state — "Your booking is
          confirmed." — so on a MISSING card it needs the same label the answer
          page gives it, or it reads as a claim that it already happened. */}
      <p className="ff-card__body">
        {complete ? (
          state.fee ? (
            `${formatUsd(BigInt(state.fee.itemDiscountCents))} off your listing fee.`
          ) : (
            'This one is counting.'
          )
        ) : (
          <>
            <span className="ff-answer__rule">Counts when</span>
            {record?.completesWhen ?? 'Not counting yet.'}
          </>
        )}
      </p>
      <Button tier="secondary" small onClick={onOpen}>
        {complete ? `Change ${label}` : `Add ${label}`}
      </Button>
    </li>
  );
}
