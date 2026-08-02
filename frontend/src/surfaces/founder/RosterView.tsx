/**
 * The Founder's roster view during the 72-hour clock — Spec §14.5, §14.2.
 *
 * Recruited campaign-specific Creator cards only: handle, channel type,
 * audience metric, niche, short bio, status in §14.5's vocabulary, the exact
 * deadline with remaining time, the full-refund outcome, and the explicit note
 * that a pending proposal is interest, not acceptance.
 *
 * Proovd owns recruitment follow-up. There is no browse control, no contact
 * control, and no pool — the server never sends an email address or anything
 * else §11 withholds, so there is nothing here to build one from.
 *
 * The remaining time is computed from the exact stored deadline on render —
 * a stated fact, not a live countdown (§30 forbids countdown pressure).
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { AFFILIATE_SUBTYPE_DEFINITIONS } from '@proovd/shared';
import {
  Button,
  Card,
  Field,
  Input,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Tag,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import {
  fetchRoster,
  respondToProposal,
  FounderRequestError,
  type RosterView as Roster,
  type RosterCreator,
} from './api.js';

const SUBTYPE_LABELS = new Map(AFFILIATE_SUBTYPE_DEFINITIONS.map((s) => [s.id, s.label]));

function remainingText(deadlineIso: string): string {
  const remainingMs = new Date(deadlineIso).getTime() - Date.now();
  if (remainingMs <= 0) return 'The response window has closed.';
  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m remaining as of when this page loaded.`;
}

export function FounderRoster() {
  const { campaignId = '' } = useParams();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'refused'; whatHappened: string }
    | { status: 'ready'; roster: Roster }
  >({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const { roster } = await fetchRoster(campaignId);
      setState({ status: 'ready', roster });
    } catch (caught) {
      setState({
        status: 'refused',
        whatHappened:
          caught instanceof FounderRequestError
            ? (caught.detail.whatHappened ?? 'The roster could not be opened.')
            : 'The roster could not be opened.',
      });
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <Measure>
        <StatePanel
          state="Loading your Creator roster"
          whatHappened="Proovd is fetching the Creators recruited for this campaign."
          next="They appear as soon as that comes back."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference={campaignId}
        />
      </Measure>
    );
  }

  if (state.status === 'refused') {
    return (
      <Measure>
        <StatePanel
          state="The roster is not available"
          whatHappened={state.whatHappened}
          next="Reload to try again. If it keeps happening, contact support."
          owner="Proovd"
          nextUpdate="When you contact us"
          action={NO_ACTION}
          reference={campaignId}
          getHelp={{ href: supportMailto(`Roster — ${campaignId}`) }}
          ring
        />
      </Measure>
    );
  }

  const { roster } = state;

  return (
    <Measure>
      <Section>
        <h1>Your Creator roster</h1>
        <p>
          Proovd recruited these Creators for your campaign and owns every follow-up. You cannot
          browse a general pool or contact a Creator directly — questions go through us.
        </p>
        {roster.responseDeadlineAt ? (
          <p className="field-hint">
            Decisions are open until{' '}
            {roster.responseDeadlineAt.replace('T', ' ').slice(0, 16)} UTC.{' '}
            {remainingText(roster.responseDeadlineAt)}
          </p>
        ) : null}
      </Section>

      {/* §14.5: the full-refund outcome — A.5's own promise, verbatim. */}
      <Card>
        <h2>If no Creator accepts</h2>
        <p>{roster.fullRefundOutcome}</p>
        <p className="field-hint">{roster.pendingProposalNote}</p>
      </Card>

      {roster.creators.length === 0 ? (
        <StatePanel
          state="No Creators recruited yet"
          whatHappened="Proovd is still recruiting for this campaign."
          next="Recruitment is our work, not yours. We will email you as the roster changes."
          owner="Proovd"
          nextUpdate="As recruitment progresses"
          action={NO_ACTION}
          reference={campaignId}
        />
      ) : (
        roster.creators.map((creator) => (
          <CreatorCard key={creator.associationId} creator={creator} onChanged={load} />
        ))
      )}
    </Measure>
  );
}

function CreatorCard({ creator, onChanged }: { creator: RosterCreator; onChanged: () => void }) {
  const [panel, setPanel] = useState<'view' | 'revise'>('view');
  const [bid, setBid] = useState('');
  const [fixed, setFixed] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const respond = async (
    body: Parameters<typeof respondToProposal>[1],
  ): Promise<void> => {
    if (!creator.openProposal) return;
    setBusy(true);
    setError(null);
    try {
      await respondToProposal(creator.openProposal.versionId, body);
      setPanel('view');
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof FounderRequestError
          ? (caught.detail.whatHappened ?? 'That was not accepted.')
          : 'The request did not complete. Nothing was changed.',
      );
    } finally {
      setBusy(false);
    }
  };

  const open = creator.openProposal;

  return (
    <Card>
      <Tag variant="mint">{creator.statusLabel}</Tag>
      <h2>{creator.handle ?? 'A recruited Creator'}</h2>
      <dl className="kv">
        <Row label="Channel">
          {creator.channelType
            ? (SUBTYPE_LABELS.get(creator.channelType as (typeof AFFILIATE_SUBTYPE_DEFINITIONS)[number]['id']) ?? creator.channelType)
            : 'Not recorded'}
        </Row>
        <Row label="Audience">{creator.audienceMetric ?? 'Not recorded'}</Row>
        <Row label="Niche">{creator.niche ?? 'Not recorded'}</Row>
        {creator.bio ? <Row label="About">{creator.bio}</Row> : null}
        {creator.lockedTerms ? (
          <Row label="Locked terms">
            {creator.lockedTerms.totalPercent}% per attributed captured charge
            {creator.lockedTerms.fixedPaymentCents
              ? `, plus an agreed fixed payment of US$${(
                  Number(creator.lockedTerms.fixedPaymentCents) / 100
                ).toFixed(2)}`
              : ''}
          </Row>
        ) : null}
      </dl>

      {open ? (
        <>
          <h3>Proposal — version {open.versionNumber}</h3>
          <dl className="kv">
            {open.bidTotalPercent !== null ? (
              <Row label="Proposed percentage">{open.bidTotalPercent}% total</Row>
            ) : null}
            {open.fixedPaymentRequestCents !== null ? (
              <Row label="Fixed payment request">
                US${(Number(open.fixedPaymentRequestCents) / 100).toFixed(2)}
              </Row>
            ) : null}
          </dl>
          {/* §14.5: interest, not acceptance — beside every pending proposal. */}
          <p className="field-hint">{open.note}</p>

          {open.awaitingYou ? (
            panel === 'view' ? (
              <>
                {error ? <p className="field-error" role="alert">{error}</p> : null}
                <div className="claim__actions">
                  <Button tier="primary" disabled={busy} onClick={() => void respond({ action: 'accept' })}>
                    Accept this version
                  </Button>
                  <Button tier="secondary" disabled={busy} onClick={() => void respond({ action: 'decline' })}>
                    Decline
                  </Button>
                  <Button tier="tertiary" disabled={busy} onClick={() => setPanel('revise')}>
                    Propose a revision
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* §14.2: a revision is a new version awaiting the Creator —
                    it is not acceptance, and the button says what it does. */}
                <Field label="Total percentage">
                  <Input inputMode="numeric" value={bid} onChange={(e) => setBid(e.target.value)} />
                </Field>
                <Field label="Fixed payment (US$)">
                  <Input inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} />
                </Field>
                {error ? <p className="field-error" role="alert">{error}</p> : null}
                <div className="claim__actions">
                  <Button
                    tier="secondary"
                    disabled={busy || (!bid.trim() && !fixed.trim())}
                    onClick={() => {
                      const body: { action: 'revise'; bidTotalPercent?: number; fixedPaymentRequestCents?: string } = {
                        action: 'revise',
                      };
                      if (bid.trim()) body.bidTotalPercent = Number(bid.trim());
                      if (fixed.trim()) {
                        const dollars = Number(fixed.trim());
                        if (Number.isFinite(dollars) && dollars > 0) {
                          body.fixedPaymentRequestCents = String(Math.round(dollars * 100));
                        }
                      }
                      void respond(body);
                    }}
                  >
                    {busy ? 'Sending…' : 'Send revision (not an acceptance)'}
                  </Button>
                  <Button tier="tertiary" disabled={busy} onClick={() => setPanel('view')}>
                    Go back
                  </Button>
                </div>
              </>
            )
          ) : (
            <p className="field-hint">Waiting on the Creator. No action needed from you.</p>
          )}
        </>
      ) : null}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kv__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
