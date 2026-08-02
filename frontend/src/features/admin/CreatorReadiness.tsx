/**
 * Admin — the §16 Creator-readiness checklist, the funding deadline, and the one
 * `campaign_live_at` — Spec §16, §26.
 *
 * §16: "Admin verifies every checklist item, the funding object, the amount, the
 * accepted proposal version, and the draft/launch plan. Admin schedules ONE
 * exact `campaign_live_at` only after the campaign and every scheduled Creator
 * are ready." §26 licenses dashboard density here — every item is shown, not a
 * summary.
 *
 * Nothing here computes money: amounts arrive as integer cents and render with
 * `shared/money`'s USD formatter.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { formatUsd } from '@proovd/shared';
import { Button, Card, Field, Input, Tag } from '../../components/index.js';
import {
  fetchAdminCreatorReadiness,
  confirmCreatorDeliverables,
  setFundingDeadline,
  cancelFundingLapse,
  scheduleCampaignLive,
  AdminRequestError,
  type AdminReadiness,
  type AdminReadinessCreator,
} from './api.js';

const usd = (cents: string) => formatUsd(BigInt(cents));
const isoDay = (iso: string | null | undefined): string =>
  iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : '—';

export function CreatorReadinessPanel() {
  const [params] = useSearchParams();
  const campaignId = params.get('campaign') ?? '';
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; readiness: AdminReadiness }
  >({ status: 'idle' });
  const [liveAt, setLiveAt] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!campaignId) {
      setState({ status: 'idle' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const { readiness } = await fetchAdminCreatorReadiness(campaignId);
      setState({ status: 'ready', readiness });
    } catch (caught) {
      setState({
        status: 'error',
        message:
          caught instanceof AdminRequestError
            ? (caught.detail.whatHappened ?? caught.detail.title)
            : 'Creator readiness could not be loaded.',
      });
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const schedule = async (): Promise<void> => {
    setScheduleError(null);
    try {
      await scheduleCampaignLive(campaignId, new Date(liveAt).toISOString());
      setLiveAt('');
      await load();
    } catch (caught) {
      const detail = caught instanceof AdminRequestError ? caught.detail : null;
      const blockers = (detail as { blockers?: string[] } | null)?.blockers;
      setScheduleError(
        (detail?.whatHappened ?? 'The launch time could not be scheduled.') +
          (blockers && blockers.length ? ` (${blockers.join('; ')})` : ''),
      );
    }
  };

  if (!campaignId) {
    return (
      <div className="admin-workspace">
        <h1>Creator readiness</h1>
        <p>Add a campaign to the address — <code>?campaign=&lt;id&gt;</code> — to verify its Creators.</p>
      </div>
    );
  }

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="admin-workspace">
        <h1>Creator readiness</h1>
        <p>Loading…</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="admin-workspace">
        <h1>Creator readiness</h1>
        <p className="field-error" role="alert">{state.message}</p>
      </div>
    );
  }

  const { readiness } = state;

  return (
    <div className="admin-workspace">
      <h1>Creator readiness</h1>
      <p className="field-hint">
        Campaign {readiness.campaignId} — {readiness.campaignStatus}.{' '}
        {readiness.campaignLiveAt ? `Launch scheduled for ${isoDay(readiness.campaignLiveAt)}.` : 'No launch time scheduled.'}
      </p>

      {readiness.creators.map((creator) => (
        <CreatorRow key={creator.associationId} campaignId={campaignId} creator={creator} onChanged={load} />
      ))}

      {/* §16: schedule ONE exact campaign_live_at, only when everything is ready. */}
      <Card>
        <h2>Schedule launch</h2>
        {readiness.campaignLiveAt ? (
          <p>A launch time is already scheduled: {isoDay(readiness.campaignLiveAt)}.</p>
        ) : readiness.scheduleBlockers.length > 0 ? (
          <>
            <p>Not everything is ready yet:</p>
            <ul>
              {readiness.scheduleBlockers.map((blocker, i) => (
                <li key={i}>{blocker}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <Field label="Launch time (your local time)">
              <Input type="datetime-local" value={liveAt} onChange={(e) => setLiveAt(e.target.value)} />
            </Field>
            {scheduleError ? <p className="field-error" role="alert">{scheduleError}</p> : null}
            <Button tier="primary" disabled={!liveAt} onClick={() => void schedule()}>
              Schedule campaign_live_at
            </Button>
            <p className="field-hint">This sets the launch time only. The launch itself runs later (Phase 14).</p>
          </>
        )}
      </Card>
    </div>
  );
}

function CreatorRow({
  campaignId,
  creator,
  onChanged,
}: {
  campaignId: string;
  creator: AdminReadinessCreator;
  onChanged: () => Promise<void>;
}) {
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof AdminRequestError
          ? (caught.detail.whatHappened ?? caught.detail.title)
          : 'That did not complete.',
      );
    } finally {
      setBusy(false);
    }
  };

  const { fixedPayment } = creator;

  return (
    <Card>
      <Tag variant={creator.canBeginWork ? 'mint' : 'sage'}>
        {creator.canBeginWork ? 'Ready to begin' : creator.status}
      </Tag>
      <h2>{creator.publicHandle ?? creator.legalName ?? 'Creator'}</h2>

      <ul>
        {creator.items.map((item) => (
          <li key={item.key}>
            {item.applicable ? (item.complete ? '✓' : '○') : '—'} {item.label}
            <span className="field-hint"> · {item.owner} · {item.specRef}</span>
          </li>
        ))}
      </ul>

      {fixedPayment.applicable ? (
        <div className="kv">
          <div className="kv__row">
            <dt>Fixed Creator payment</dt>
            <dd>
              {fixedPayment.label}
              {fixedPayment.amountCents ? ` — ${usd(fixedPayment.amountCents)}` : ''}
            </dd>
          </div>
          <div className="kv__row">
            <dt>Accepted version</dt>
            <dd>{fixedPayment.proposalVersionId ?? '—'}</dd>
          </div>
          <div className="kv__row">
            <dt>Funding deadline</dt>
            <dd>{isoDay(fixedPayment.fundingDeadlineAt)}</dd>
          </div>
          <div className="kv__row">
            <dt>Funded</dt>
            <dd>{isoDay(fixedPayment.fundedAt)}</dd>
          </div>
        </div>
      ) : null}

      {error ? <p className="field-error" role="alert">{error}</p> : null}

      <div className="claim__actions">
        <Button tier="secondary" disabled={busy} onClick={() => void run(() => confirmCreatorDeliverables(campaignId, creator.associationId, true))}>
          Confirm deliverable plan
        </Button>
      </div>

      {fixedPayment.applicable && fixedPayment.status !== 'funded' && fixedPayment.status !== 'paid' && !fixedPayment.canceledAt ? (
        <>
          <Field label="Funding deadline (your local time)">
            <Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
          <div className="claim__actions">
            <Button
              tier="secondary"
              disabled={busy || !deadline}
              onClick={() => void run(() => setFundingDeadline(campaignId, creator.associationId, new Date(deadline).toISOString()))}
            >
              Set funding deadline
            </Button>
            <Button
              tier="tertiary"
              disabled={busy}
              onClick={() => void run(() => cancelFundingLapse(campaignId, creator.associationId, 'funding deadline missed'))}
            >
              Cancel for missed funding deadline
            </Button>
          </div>
          <p className="field-hint">
            Canceling removes this Creator and lets replacement recruitment proceed; the reduced base no
            longer applies.
          </p>
        </>
      ) : null}
    </Card>
  );
}
