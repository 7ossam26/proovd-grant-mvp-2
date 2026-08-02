/**
 * The formal opportunity and the three decisions — Spec §14.1, §14.2, §14.3,
 * §33.2.6, §33.2.8.
 *
 * ── None of the three outcomes is hidden ────────────────────────────────────
 * §14.2 allows one primary and one secondary control under the DNA, "but none
 * of the outcomes may be hidden." Accept is the primary, decline the
 * secondary, and propose is a plainly visible tertiary control on the same
 * screen — never behind a menu, a scroll trap, or a second page.
 *
 * ── The matrix is the server's answer, rendered ─────────────────────────────
 * Whether a bid is allowed and whether a fixed payment is available come from
 * the server's §14.3 cell. The surface never derives them: hiding the fixed
 * request on an Idea Campaign is presentation, but *refusing* it is the
 * server's (§33.2.8), and this surface shows the server's refusal verbatim
 * when it disagrees.
 *
 * ── The four confirmations are four controls (§28.4) ────────────────────────
 * Compensation terms, the per-campaign IP/confidentiality agreement, the FTC
 * disclosure acknowledgment, and the campaign terms/AUP state. No "accept
 * all", and nothing prechecked.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { PENDING_PROPOSAL_NOTE } from '@proovd/shared';
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
  fetchFormalOpportunity,
  acceptStandardTerms,
  declineOpportunity,
  submitProposal,
  respondToVersion,
  CreatorRequestError,
  type FormalOpportunity as Opportunity,
  type DecisionConfirmations,
} from './api.js';

/* ── Copy with confirmation (§14.1) ───────────────────────────────────────── */

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      tier="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

/* ── The surface ──────────────────────────────────────────────────────────── */

type Panel = 'decide' | 'accept' | 'decline' | 'propose';

export function FormalOpportunity() {
  const { associationId = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'refused'; whatHappened: string; next: string }
    | { status: 'ready'; opportunity: Opportunity }
  >({ status: 'loading' });
  const [panel, setPanel] = useState<Panel>('decide');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { opportunity } = await fetchFormalOpportunity(associationId);
      setState({ status: 'ready', opportunity });
    } catch (caught) {
      if (caught instanceof CreatorRequestError) {
        setState({
          status: 'refused',
          whatHappened: caught.detail.whatHappened ?? 'This opportunity is not available.',
          next: caught.detail.next ?? 'Go back to your campaigns.',
        });
      } else {
        setState({
          status: 'refused',
          whatHappened: 'Proovd could not open the opportunity.',
          next: 'Go back to your campaigns and try again.',
        });
      }
    }
  }, [associationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setPanel('decide');
      await load();
    } catch (caught) {
      setError(
        caught instanceof CreatorRequestError
          ? (caught.detail.whatHappened ?? 'That was not accepted.')
          : 'The request did not complete. Nothing was changed.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (state.status === 'loading') {
    return (
      <Measure>
        <StatePanel
          state="Opening the opportunity"
          whatHappened="Proovd is checking your access."
          next="It appears as soon as that comes back."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference="Formal opportunity"
        />
      </Measure>
    );
  }

  if (state.status === 'refused') {
    return (
      <Measure>
        <StatePanel
          state="Not available"
          whatHappened={state.whatHappened}
          next={state.next}
          owner="Proovd"
          nextUpdate="When you contact us"
          action={
            <Button tier="secondary" onClick={() => void navigate('/creator/campaigns')}>
              Back to your campaigns
            </Button>
          }
          reference={associationId}
          getHelp={{ href: supportMailto('Formal opportunity') }}
          ring
        />
      </Measure>
    );
  }

  const o = state.opportunity;
  const deadline = o.responseDeadlineAt
    ? `${o.responseDeadlineAt.replace('T', ' ').slice(0, 16)} UTC`
    : null;
  const openVersion = o.versions.find(
    (v) => v.state === 'awaiting_founder' || v.state === 'awaiting_creator',
  );

  return (
    <Measure>
      <Section>
        <Tag variant="mint">{o.campaignStateLabel}</Tag>
        <h1>The formal opportunity</h1>
        {/* §14.1: opens with `Why this fits your audience`. */}
        {o.whyThisFitsYourAudience ? <p>{o.whyThisFitsYourAudience}</p> : null}
        {deadline ? (
          <p className="field-hint">
            A decision is open until {deadline}. Declining, then or at any time, does not affect
            your standing.
          </p>
        ) : null}
      </Section>

      {/* §14.1: compensation, bid eligibility, fixed availability, high effort. */}
      <Card>
        <h2>Compensation</h2>
        <dl className="kv">
          <Row label="Base percentage">
            {o.compensation.basePercent}% of each successfully captured, validly attributed,
            pre-tax charge
          </Row>
          {o.compensation.fixedPaymentAvailable && o.compensation.basePercentWithFixed !== null ? (
            <Row label="Fixed Creator payment">
              Available on this campaign by request. Where one is agreed, the base percentage is{' '}
              {o.compensation.basePercentWithFixed}%.
            </Row>
          ) : (
            <Row label="Fixed Creator payment">Not available on this campaign.</Row>
          )}
          <Row label="Proposing a higher percentage">
            {o.compensation.bidAllowed
              ? `Available: this is a high-effort campaign. Base plus bid plus any bonus never exceeds ${o.compensation.ceilingPercent}%.`
              : 'Not available: this is not a high-effort campaign.'}
          </Row>
          <Row label="High effort">
            {o.highEffort.result
              ? 'Yes — the Founder completed the qualifying preparation.'
              : 'No.'}
          </Row>
        </dl>
      </Card>

      {/* The accepted state: the link, inactive, with copy confirmation. */}
      {o.agreement ? (
        <Card>
          <h2>Your locked terms</h2>
          <dl className="kv">
            <Row label="Percentage">{o.agreement.totalPercent}% per attributed captured charge</Row>
            {o.agreement.fixedPaymentCents ? (
              <Row label="Fixed payment">Agreed — funded before launch, outside the percentage.</Row>
            ) : null}
          </dl>
          {o.trackingLink ? (
            <>
              <p className="field-hint">
                Your unique tracking link. It is{' '}
                {o.trackingLink.active ? 'active' : 'inactive until the campaign is approved and you are marked ready'}
                . Posting before activation earns nothing.
              </p>
              <dl className="kv">
                <Row label="Tracking link">{o.trackingLink.url}</Row>
                <Row label="Disclosure">{o.trackingLink.disclosureText}</Row>
              </dl>
              <div className="claim__actions">
                <CopyButton value={o.trackingLink.url} label="Copy tracking link" />
                <CopyButton value={o.trackingLink.disclosureText} label="Copy disclosure" />
                {/* §14.1: the safe test — carries the marker attribution excludes. */}
                <a
                  className="btn btn--tertiary"
                  href={o.trackingLink.testUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Test this link safely
                </a>
              </div>
            </>
          ) : null}
        </Card>
      ) : null}

      {/* The open proposal, whoever is due to answer it. */}
      {openVersion ? (
        <Card>
          <h2>Open proposal — version {openVersion.versionNumber}</h2>
          <dl className="kv">
            {openVersion.bidTotalPercent !== null ? (
              <Row label="Proposed percentage">{openVersion.bidTotalPercent}% total</Row>
            ) : null}
            {openVersion.fixedPaymentRequestCents !== null ? (
              <Row label="Fixed payment request">
                US${(Number(openVersion.fixedPaymentRequestCents) / 100).toFixed(2)}
              </Row>
            ) : null}
            <Row label="Waiting on">
              {openVersion.state === 'awaiting_founder' ? 'The Founder' : 'You'}
            </Row>
          </dl>
          <p className="field-hint">{PENDING_PROPOSAL_NOTE}</p>
          {openVersion.state === 'awaiting_creator' && o.decisionsAvailable ? (
            <div className="claim__actions">
              <Button
                tier="primary"
                disabled={busy}
                onClick={() => setPanel('accept')}
              >
                Accept this version
              </Button>
              <Button
                tier="secondary"
                disabled={busy}
                onClick={() =>
                  void act(() => respondToVersion(openVersion.id, { action: 'decline' }))
                }
              >
                Decline this version
              </Button>
              <Button tier="tertiary" disabled={busy} onClick={() => setPanel('propose')}>
                Counter with different terms
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* §14.2: the three decisions, none hidden. */}
      {o.decisionsAvailable && panel === 'decide' ? (
        <Card>
          <h2>Your decision</h2>
          <p className="field-hint">
            Three outcomes are open to you, and no one of them is required: accept the standard
            terms, decline, or propose different terms.
          </p>
          <div className="claim__actions">
            <Button tier="primary" onClick={() => setPanel('accept')}>
              Accept standard terms
            </Button>
            <Button tier="secondary" onClick={() => setPanel('decline')}>
              Decline
            </Button>
            <Button tier="tertiary" onClick={() => setPanel('propose')}>
              Propose terms
            </Button>
          </div>
        </Card>
      ) : null}

      {o.decisionsAvailable && panel === 'accept' ? (
        <AcceptPanel
          busy={busy}
          error={error}
          openVersionId={openVersion?.state === 'awaiting_creator' ? openVersion.id : null}
          onCancel={() => {
            setPanel('decide');
            setError(null);
          }}
          onAccept={(confirmations, versionId) =>
            void act(() =>
              versionId
                ? respondToVersion(versionId, { action: 'accept', ...confirmations })
                : acceptStandardTerms(associationId, confirmations),
            )
          }
        />
      ) : null}

      {o.decisionsAvailable && panel === 'decline' ? (
        <DeclinePanel
          busy={busy}
          error={error}
          onCancel={() => {
            setPanel('decide');
            setError(null);
          }}
          onDecline={(reason) => void act(() => declineOpportunity(associationId, reason))}
        />
      ) : null}

      {o.decisionsAvailable && panel === 'propose' ? (
        <ProposePanel
          busy={busy}
          error={error}
          cell={o.compensation}
          onCancel={() => {
            setPanel('decide');
            setError(null);
          }}
          onPropose={(proposal) =>
            void act(() =>
              openVersion?.state === 'awaiting_creator'
                ? respondToVersion(openVersion.id, { action: 'counter', ...proposal })
                : submitProposal(associationId, proposal),
            )
          }
        />
      ) : null}

      <Button tier="tertiary" onClick={() => void navigate(`/creator/campaigns/${associationId}`)}>
        Read the Campaign kit
      </Button>
    </Measure>
  );
}

/* ── Accept: the four §14.2 confirmations, separately (§28.4) ─────────────── */

const CONFIRMATIONS: Array<{ key: keyof DecisionConfirmations; label: string }> = [
  { key: 'compensationTerms', label: 'I accept the compensation terms shown above.' },
  {
    key: 'ipAgreement',
    label:
      'I accept the Creator-only IP and confidentiality agreement for this campaign.',
  },
  {
    key: 'ftcDisclosure',
    label:
      'I will include the required FTC disclosure in every promotion for this campaign.',
  },
  { key: 'termsAup', label: 'I accept the campaign terms and acceptable-use rules as they stand.' },
];

function AcceptPanel(props: {
  busy: boolean;
  error: string | null;
  openVersionId: string | null;
  onCancel: () => void;
  onAccept: (confirmations: DecisionConfirmations, versionId: string | null) => void;
}) {
  const [checked, setChecked] = useState<DecisionConfirmations>({
    compensationTerms: false,
    ipAgreement: false,
    ftcDisclosure: false,
    termsAup: false,
  });
  const all = CONFIRMATIONS.every((c) => checked[c.key]);

  return (
    <Card>
      <h2>{props.openVersionId ? 'Accept the open version' : 'Accept standard terms'}</h2>
      {CONFIRMATIONS.map((c) => (
        <label key={c.key} className="checkbox-row">
          <input
            type="checkbox"
            checked={checked[c.key]}
            onChange={(event) => setChecked({ ...checked, [c.key]: event.target.checked })}
          />{' '}
          {c.label}
        </label>
      ))}
      {props.error ? <p className="field-error" role="alert">{props.error}</p> : null}
      <div className="claim__actions">
        <Button
          tier="primary"
          disabled={props.busy || !all}
          onClick={() => props.onAccept(checked, props.openVersionId)}
        >
          {props.busy ? 'Recording…' : 'Confirm acceptance'}
        </Button>
        <Button tier="tertiary" disabled={props.busy} onClick={props.onCancel}>
          Go back
        </Button>
      </div>
    </Card>
  );
}

/* ── Decline: optional reason, and the promise (§14.2) ────────────────────── */

function DeclinePanel(props: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onDecline: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Card>
      <h2>Decline</h2>
      <p className="field-hint">
        Declining does not harm your standing with Proovd in any way. A reason is optional.
      </p>
      <Field label="Reason (optional)">
        <Input value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {props.error ? <p className="field-error" role="alert">{props.error}</p> : null}
      <div className="claim__actions">
        <Button tier="secondary" disabled={props.busy} onClick={() => props.onDecline(reason)}>
          {props.busy ? 'Recording…' : 'Decline this opportunity'}
        </Button>
        <Button tier="tertiary" disabled={props.busy} onClick={props.onCancel}>
          Go back
        </Button>
      </div>
    </Card>
  );
}

/* ── Propose: only what the §14.3 cell allows is offered (§33.2.8) ────────── */

function ProposePanel(props: {
  busy: boolean;
  error: string | null;
  cell: Opportunity['compensation'];
  onCancel: () => void;
  onPropose: (proposal: { bidTotalPercent?: number; fixedPaymentRequestCents?: string }) => void;
}) {
  const [bid, setBid] = useState('');
  const [fixed, setFixed] = useState('');

  const proposal: { bidTotalPercent?: number; fixedPaymentRequestCents?: string } = {};
  if (props.cell.bidAllowed && bid.trim()) proposal.bidTotalPercent = Number(bid.trim());
  if (props.cell.fixedPaymentAvailable && fixed.trim()) {
    const dollars = Number(fixed.trim());
    if (Number.isFinite(dollars) && dollars > 0) {
      proposal.fixedPaymentRequestCents = String(Math.round(dollars * 100));
    }
  }
  const hasSomething =
    proposal.bidTotalPercent !== undefined || proposal.fixedPaymentRequestCents !== undefined;

  return (
    <Card>
      <h2>Propose terms</h2>
      {props.cell.bidAllowed ? (
        <Field
          label={`Total percentage (above ${props.cell.basePercent}%, at most ${props.cell.ceilingPercent}%)`}
        >
          <Input
            inputMode="numeric"
            value={bid}
            onChange={(event) => setBid(event.target.value)}
          />
        </Field>
      ) : (
        <p className="field-hint">
          A percentage above the base is only available on a high-effort campaign, so it is not
          part of what you can propose here.
        </p>
      )}
      {props.cell.fixedPaymentAvailable ? (
        <Field label="Fixed Creator payment request (US$)">
          <Input
            inputMode="decimal"
            value={fixed}
            onChange={(event) => setFixed(event.target.value)}
          />
        </Field>
      ) : (
        <p className="field-hint">A fixed Creator payment is not available on an Idea Campaign.</p>
      )}
      {props.error ? <p className="field-error" role="alert">{props.error}</p> : null}
      <div className="claim__actions">
        <Button
          tier="secondary"
          disabled={props.busy || !hasSomething}
          onClick={() => props.onPropose(proposal)}
        >
          {props.busy ? 'Sending…' : 'Send proposal'}
        </Button>
        <Button tier="tertiary" disabled={props.busy} onClick={props.onCancel}>
          Go back
        </Button>
      </div>
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
