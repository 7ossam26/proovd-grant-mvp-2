/**
 * Admin → Money & Fulfillment → one campaign. Spec §21, §22.1–§22.7, §24.8,
 * §24.11, §26.6.
 *
 * The console every money decision in the product is made from, and the only
 * one — §22.1's four acts, §22.3's W-9 and release, §24.8's classified refund,
 * §24.11's dispute, and §22.4's Day 14 all have exactly one door, and it is
 * here. A second control anywhere else would be a second path into rules whose
 * whole safety is that there is one.
 *
 * ── Six tabs, in the order the lifecycle runs ───────────────────────────────
 * Close → reconciliation → Creator earnings → Founder payment → refunds →
 * fulfillment. That order is the DEPENDENCY: reconciliation waits on the retry
 * window, and §22.3's eligible share subtracts the finalized Creator
 * compensation, so a Founder payment refuses until every provisioned cent has
 * resolved. An Admin working left to right never meets a refusal they could
 * have avoided.
 *
 * ── Every pane reloads the whole record after it acts ───────────────────────
 * Not an optimistic update, and not a local patch of one row. These services
 * are idempotent and several of them cascade — finalizing earnings changes what
 * the Founder is owed, a refund changes it again — so the honest thing after a
 * money act is to ask the server what is true now. A surface that patched one
 * number would be showing an Admin an amount nothing computed.
 *
 * ── The rail is hand-built ──────────────────────────────────────────────────
 * The same reason the Campaigns, Support, and Creator rails are: §26.1's
 * stylesheet uses different markup from `components/Tabs.tsx`. Roving
 * `tabindex` with Arrow/Home/End, `role="tab"`, and the panel labelled by its
 * tab — §28.5's keyboard contract, met explicitly.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router';
import {
  MONEY_RECORD_TABS,
  MONEY_RECORD_TAB_BLURBS,
  MONEY_RECORD_TAB_LABELS,
  campaignStatusLabel,
  type MoneyRecordTab,
} from '@proovd/shared';
import { Button, StatePanel } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import { supportMailto } from '../../public/states.js';
import {
  AdminRequestError,
  fetchCloseRecord,
  fetchCreatorEarnings,
  fetchDisputes,
  fetchFounderPayments,
  fetchFulfillment,
  fetchRefunds,
  type CloseRecordView,
  type CreatorEarningsView,
  type DisputeQueueView,
  type FounderPaymentView,
  type FulfillmentView,
  type RefundQueueView,
} from './api.js';
import { Pill } from './shared.js';
import { ClosePane, ReconciliationPane } from './panes/close.js';
import { CreatorsPane, FounderPane } from './panes/money.js';
import { CasesPane, FulfillmentPane } from './panes/cases.js';

export interface MoneyRecord {
  close: CloseRecordView;
  earnings: CreatorEarningsView | null;
  founder: FounderPaymentView | null;
  refunds: RefundQueueView;
  disputes: DisputeQueueView;
  fulfillment: FulfillmentView | null;
}

function isTab(value: string): value is MoneyRecordTab {
  return (MONEY_RECORD_TABS as readonly string[]).includes(value);
}

/**
 * A read that is allowed to be absent.
 *
 * Four of the six reads 404 on a campaign that has not reached their stage —
 * there are no earnings before finalization, no Founder payment status before a
 * type is locked, no fulfillment record before delivery is set up. That is a
 * STATE, not a failure, so it resolves to null and the pane says which stage it
 * is waiting for (§16a). A genuine failure still throws, and the record's own
 * error state renders.
 */
async function optional<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof AdminRequestError && error.detail.status === 404) return null;
    throw error;
  }
}

export function MoneyRecord() {
  const { campaignId = '' } = useParams();
  const [record, setRecord] = useState<MoneyRecord | null>(null);
  const [failure, setFailure] = useState<AdminRequestError | null>(null);
  const [params, setParams] = useSearchParams();
  const surface = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);

  const raw = params.get('tab') ?? 'close';
  const tab: MoneyRecordTab = isTab(raw) ? raw : 'close';

  const load = useCallback(() => {
    setFailure(null);
    Promise.all([
      fetchCloseRecord(campaignId),
      optional(fetchCreatorEarnings(campaignId)),
      optional(fetchFounderPayments(campaignId)),
      fetchRefunds(campaignId),
      fetchDisputes(campaignId),
      optional(fetchFulfillment(campaignId)),
    ])
      .then(([close, earnings, founder, refunds, disputes, fulfillment]) =>
        setRecord({ close, earnings, founder, refunds, disputes, fulfillment }),
      )
      .catch((error: unknown) =>
        setFailure(
          error instanceof AdminRequestError
            ? error
            : new AdminRequestError({
                error: 'unreachable',
                status: 0,
                title: 'Proovd could not be reached',
                whatHappened:
                  'This campaign’s money record could not be read, and the failure carried no explanation. Nothing was changed.',
                next: 'Try the read again before acting on anything.',
              }),
        ),
      );
  }, [campaignId]);

  useEffect(load, [load]);
  useProovdMotion(surface, [record, tab]);

  function chooseTab(next: MoneyRecordTab) {
    const updated = new URLSearchParams(params);
    if (next === 'close') updated.delete('tab');
    else updated.set('tab', next);
    setParams(updated, { replace: true });
  }

  function onRailKey(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = MONEY_RECORD_TABS.indexOf(tab);
    const last = MONEY_RECORD_TABS.length - 1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowLeft'
            ? (index - 1 + MONEY_RECORD_TABS.length) % MONEY_RECORD_TABS.length
            : (index + 1) % MONEY_RECORD_TABS.length;
    chooseTab(MONEY_RECORD_TABS[next]!);
    requestAnimationFrame(() => {
      rail.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    });
  }

  if (failure) {
    return (
      <div>
        <BackLink />
        <StatePanel
          state={failure.detail.title}
          whatHappened={
            failure.detail.whatHappened ??
            'This campaign’s money record could not be read, so no amount on this page is current.'
          }
          next={
            failure.detail.next ?? 'Try the read again before acting on anything. Nothing changed.'
          }
          owner="Proovd"
          nextUpdate="When you try again"
          action={
            <Button tier="primary" onClick={load}>
              Try the read again
            </Button>
          }
          reference="Admin · Money"
          getHelp={{ href: supportMailto('A campaign money record will not load') }}
          ring
        />
      </div>
    );
  }

  if (!record) {
    return (
      <div>
        <BackLink />
        <StatePanel
          state="Reading this campaign’s money"
          whatHappened="Proovd is reading the close batch, the reconciliation, Creator earnings, the Founder payment, refunds, and fulfillment."
          next="The record appears as soon as all of that comes back."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action="No action needed"
          reference="Admin · Money"
        />
      </div>
    );
  }

  const { detail } = record.close;
  const batch = detail.batch;

  return (
    <div ref={surface} className="mny">
      <BackLink />

      <header className="mny-head">
        <p className="kicker">Admin · Money &amp; Fulfillment</p>
        <h1 className="mny-head__title">{campaignId}</h1>
        <div className="mny-head__state">
          {/*
            §23.1's own human label, from the register the Campaigns hub uses.
            It is typed as a TOTAL map over the 27 lifecycle values, so a 28th
            state without a label fails the build rather than rendering
            `banned_founder` at somebody on a support call. The machine value is
            below, under Technical details — the hub's own arrangement.
          */}
          <Pill
            label={campaignStatusLabel(detail.campaignStatus)}
            tone={
              detail.campaignStatus === 'capture_retry_window'
                ? 'wait'
                : detail.campaignStatus === 'closed_pending_capture'
                  ? 'risk'
                  : 'ok'
            }
          />
          {batch ? (
            <Pill
              label={batch.completedAt ? 'Batch completed' : 'Batch running'}
              tone={batch.completedAt ? 'ok' : 'risk'}
              small
            />
          ) : null}
        </div>
        <p className="mny-head__technical">
          Technical details: <code>{detail.campaignStatus}</code>
          {batch ? (
            <>
              {' · batch '}
              <code>{batch.status}</code>
            </>
          ) : null}
        </p>
        {/*
          The link back into the record that owns the campaign itself. This
          console reports money; the campaign's own state, roster, and page
          belong to the Campaigns hub.
        */}
        <RouterLink className="mny-head__cross" to={`/admin/campaigns/${campaignId}`}>
          Open the campaign record →
        </RouterLink>
      </header>

      <div
        ref={rail}
        className="mny-tabs"
        role="tablist"
        aria-label="Money sections"
        onKeyDown={onRailKey}
      >
        {MONEY_RECORD_TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            id={`mny-tab-${entry}`}
            aria-selected={tab === entry}
            aria-controls={`mny-panel-${entry}`}
            tabIndex={tab === entry ? 0 : -1}
            className={cn('mny-tab', tab === entry && 'is-active')}
            onClick={() => chooseTab(entry)}
          >
            {MONEY_RECORD_TAB_LABELS[entry]}
          </button>
        ))}
      </div>

      <div
        className="mny-panel"
        role="tabpanel"
        id={`mny-panel-${tab}`}
        aria-labelledby={`mny-tab-${tab}`}
        tabIndex={-1}
      >
        <p className="mny-panel__blurb">{MONEY_RECORD_TAB_BLURBS[tab]}</p>

        {tab === 'close' ? (
          <ClosePane campaignId={campaignId} record={record} reload={load} />
        ) : null}
        {tab === 'reconciliation' ? (
          <ReconciliationPane campaignId={campaignId} record={record} reload={load} />
        ) : null}
        {tab === 'creators' ? (
          <CreatorsPane campaignId={campaignId} record={record} reload={load} />
        ) : null}
        {tab === 'founder' ? (
          <FounderPane campaignId={campaignId} record={record} reload={load} />
        ) : null}
        {tab === 'refunds' ? (
          <CasesPane campaignId={campaignId} record={record} reload={load} />
        ) : null}
        {tab === 'fulfillment' ? (
          <FulfillmentPane campaignId={campaignId} record={record} reload={load} />
        ) : null}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <RouterLink className="mny-back" to="/admin/money">
      ← Close operations
    </RouterLink>
  );
}

/** What every pane receives. No pane fetches on its own. */
export interface PaneProps {
  campaignId: string;
  record: MoneyRecord;
  reload: () => void;
}
