/**
 * The Founder's Creator-readiness and fixed-payment funding — Spec §16, §11.
 *
 * §16: the Founder sees each Creator's readiness status, fixed-payment funding
 * status, the exact blockers, the owner, and the next date — and funds the
 * secured Creator payment where one was accepted. There is deliberately no "ask
 * a Creator to begin" affordance: §16 makes that a product constraint, so this
 * page has no such button, and it says so plainly.
 *
 * Nothing here computes money: the amount arrives as integer cents and is
 * rendered with `shared/money`'s USD formatter (Phase 09's rule).
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { formatUsd } from '@proovd/shared';
import {
  Button,
  Card,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Tag,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import {
  fetchCreatorReadiness,
  fundSecuredPayment,
  FounderRequestError,
  type FounderReadiness,
  type FounderReadinessCreator,
} from './api.js';

function isoDay(iso: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : '—';
}

export function CreatorReadiness() {
  const { campaignId = '' } = useParams();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'refused'; whatHappened: string }
    | { status: 'ready'; readiness: FounderReadiness }
  >({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const { readiness } = await fetchCreatorReadiness(campaignId);
      setState({ status: 'ready', readiness });
    } catch (caught) {
      setState({
        status: 'refused',
        whatHappened:
          caught instanceof FounderRequestError
            ? (caught.detail.whatHappened ?? 'Creator readiness could not be opened.')
            : 'Creator readiness could not be opened.',
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
          state="Loading Creator readiness"
          whatHappened="Proovd is checking where each of your Creators stands."
          next="It appears as soon as that comes back."
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
          state="Creator readiness is not available"
          whatHappened={state.whatHappened}
          next="Reload to try again. If it keeps happening, contact support."
          owner="Proovd"
          nextUpdate="When you contact us"
          action={NO_ACTION}
          reference={campaignId}
          getHelp={{ href: supportMailto(`Creator readiness — ${campaignId}`) }}
          ring
        />
      </Measure>
    );
  }

  const { readiness } = state;

  return (
    <Measure>
      <Section>
        <h1>Creator readiness</h1>
        <p>
          Each Creator can begin work only when every item on their checklist is complete. This is a
          safety control, not a formality — you cannot ask a Creator to start early, and there is no
          button here that would.
        </p>
      </Section>

      {readiness.campaignLiveAt ? (
        <Card>
          <Tag variant="mint">Launch scheduled</Tag>
          <h2>Your launch time is set</h2>
          <p>
            Proovd scheduled this campaign to go live at {isoDay(readiness.campaignLiveAt)}. You will
            receive a launch confirmation when it does.
          </p>
        </Card>
      ) : null}

      {readiness.creators.length === 0 ? (
        <StatePanel
          state="No Creators to prepare yet"
          whatHappened="No recruited Creator has reached the preparation stage for this campaign."
          next="Proovd will email you as your roster changes."
          owner="Proovd"
          nextUpdate="As readiness progresses"
          action={NO_ACTION}
          reference={campaignId}
        />
      ) : (
        readiness.creators.map((creator) => (
          <CreatorCard
            key={creator.associationId}
            campaignId={campaignId}
            creator={creator}
            onChanged={load}
          />
        ))
      )}
    </Measure>
  );
}

function CreatorCard({
  campaignId,
  creator,
  onChanged,
}: {
  campaignId: string;
  creator: FounderReadinessCreator;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fund = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { funding } = await fundSecuredPayment(campaignId, creator.associationId);
      // §13's redirect pattern: send the Founder to the hosted Checkout.
      window.location.assign(funding.url);
    } catch (caught) {
      setError(
        caught instanceof FounderRequestError
          ? (caught.detail.whatHappened ?? 'Funding could not be opened.')
          : 'Funding could not be opened. Nothing has been charged.',
      );
      setBusy(false);
    }
  };

  const { fixedPayment } = creator;
  const fundable =
    fixedPayment.applicable &&
    fixedPayment.status !== 'funded' &&
    fixedPayment.status !== 'paid' &&
    !fixedPayment.canceledAt;

  return (
    <Card>
      <Tag variant={creator.canBeginWork ? 'mint' : 'sage'}>
        {creator.canBeginWork ? 'Ready to begin' : 'Preparing'}
      </Tag>
      <h2>{creator.publicHandle ?? 'A recruited Creator'}</h2>

      {/* §33.11.2: a `dt`/`dd` pair needs a `dl` above it — a `div` with the
          same class leaves a screen reader announcing an orphaned term. */}
      {fixedPayment.applicable ? (
        <dl className="kv">
          <div className="kv__row">
            <dt>Fixed Creator payment</dt>
            <dd>
              {fixedPayment.label}
              {fixedPayment.amountCents
                ? ` — ${formatUsd(BigInt(fixedPayment.amountCents))}`
                : ''}
            </dd>
          </div>
          {fixedPayment.fundingDeadlineAt ? (
            <div className="kv__row">
              <dt>Funding due by</dt>
              <dd>{isoDay(fixedPayment.fundingDeadlineAt)}</dd>
            </div>
          ) : null}
          {fixedPayment.fundedAt ? (
            <div className="kv__row">
              <dt>Funded</dt>
              <dd>{isoDay(fixedPayment.fundedAt)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {creator.canBeginWork ? (
        <p className="field-hint">
          Everything is in place. Proovd will bring this Creator into the campaign at launch.
        </p>
      ) : (
        <>
          <h3>What is still needed</h3>
          <ul>
            {creator.blockers.map((blocker) => (
              <li key={blocker.key}>
                {blocker.label}{' '}
                <span className="field-hint">— {ownerLabel(blocker.owner)}</span>
              </li>
            ))}
          </ul>
          {creator.nextDate ? (
            <p className="field-hint">Next date: {isoDay(creator.nextDate)}.</p>
          ) : null}
        </>
      )}

      {fundable ? (
        <>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="claim__actions">
            <Button tier="primary" disabled={busy} onClick={() => void fund()}>
              {busy ? 'Opening…' : 'Fund the secured Creator payment'}
            </Button>
          </div>
          <p className="field-hint">
            You fund this in full before work begins. It is charged separately from your campaign and
            appears on your statement as PROOVD CREATOR PAY. No sales tax applies to it.
          </p>
        </>
      ) : null}
    </Card>
  );
}

function ownerLabel(owner: string): string {
  switch (owner) {
    case 'founder':
      return 'yours to complete';
    case 'admin':
      return 'Proovd is completing this';
    case 'proovd':
      return 'Proovd is completing this';
    case 'creator':
      return 'the Creator is completing this';
    default:
      return owner;
  }
}
