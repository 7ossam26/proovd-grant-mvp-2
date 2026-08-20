/**
 * One pitch: the reveal, the recap, and §14.2's three decisions —
 * Creator Flow v2, Session E, 2026-08-20.
 *
 * This replaces `surfaces/creator/FormalOpportunity.tsx` at the same address.
 * The decision panels are carried over unchanged in behaviour: four separate
 * confirmations (§28.4), a decline with an optional reason and the no-penalty
 * promise, and a propose panel that offers only what the server's §14.3 cell
 * allows. No decision service was touched by this session — §33.2.6–§33.2.13
 * drive them directly and pass unchanged.
 *
 * ── The walk is optional, and that is the accessibility decision ───────────
 * The reference advances a five-step reveal by tapping anywhere on the screen.
 * §28.5 names "Affiliate decisions" among the five flows that must be
 * completely operable from a keyboard, and §14.2 forbids hiding any of the
 * three outcomes. A walkthrough that must be completed before the decisions
 * appear hides all three behind four gestures, so:
 *
 *   * every step advances with a real, named control;
 *   * `Read the whole pitch` is present from the FIRST step;
 *   * `?view=recap` is in the address, so a reload, a bookmark and the back
 *     button all land on the recap rather than restarting the walk;
 *   * a pitch with no decisions open — accepted, declined, expired — opens on
 *     the recap, because there is nothing left to introduce.
 *
 * ── §14.1's list is the recap's structure ──────────────────────────────────
 * `PITCH_RECAP_SECTIONS` carries §14.1's own bullets beside the payload field
 * or the register constant that answers each, and the suite resolves every one.
 * A section that quietly stopped being served fails the walk rather than
 * rendering an empty heading (§33.11.3).
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import {
  DECLINING_COSTS_YOU_NOTHING,
  PENDING_PROPOSAL_NOTE,
  PITCH_IP_SUMMARY,
  PITCH_MONEY_EXPLANATION,
  PITCH_NO_COUNTER_ADVICE,
  PITCH_PROMOTION_RULES,
  PITCH_PROOF_INSTRUCTIONS,
  PITCH_REVEAL_STEPS,
  PITCH_SKIP_LABEL,
  PITCH_WALK_IS_OPTIONAL,
  formatUsd,
} from '@proovd/shared';
import {
  Button,
  Card,
  Field,
  Input,
  NO_ACTION,
  Option,
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
  type PitchContent,
  type DecisionConfirmations,
} from '../creator/api.js';

function localDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * A deadline, local with UTC beside it — §27.1's rule.
 *
 * Used for the two instants on this page that are deadlines rather than dates:
 * §14.6's response deadline, after which an unfinished proposal expires, and
 * the campaign's close, which is when every saved card is charged.
 */
function deadline(iso: string): string {
  const at = new Date(iso);
  return (
    `${at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} ` +
    `(${at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC)`
  );
}

/** §14.1 asks for copy confirmation on the link and the disclosure. */
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

type Panel = 'decide' | 'accept' | 'decline' | 'propose';

export function CreatorPitch() {
  const { associationId = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'refused'; whatHappened: string; next: string }
    | { status: 'ready'; opportunity: Opportunity; content: PitchContent }
  >({ status: 'loading' });
  const [panel, setPanel] = useState<Panel>('decide');
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { opportunity, content } = await fetchFormalOpportunity(associationId);
      setState({ status: 'ready', opportunity, content });
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

  const openRecap = () => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        updated.set('view', 'recap');
        return updated;
      },
      { replace: true },
    );
  };

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
      <div className="cra-page">
        <StatePanel
          state="Opening the pitch"
          whatHappened="Proovd is checking your access and gathering the campaign."
          next="It appears as soon as that comes back."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference="Formal opportunity"
        />
      </div>
    );
  }

  if (state.status === 'refused') {
    return (
      <div className="cra-page">
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
      </div>
    );
  }

  const o = state.opportunity;
  const c = state.content;
  const name = c.positioning.productName ?? 'this campaign';

  // The recap is the default whenever there is nothing left to decide: a walk
  // that introduces a campaign somebody already accepted is a delay, not a
  // reveal (DNA §5.4).
  const showRecap = params.get('view') === 'recap' || !o.decisionsAvailable;

  if (!showRecap) {
    return (
      <div className="cra-page crp-reveal">
        <RevealStep
          index={step}
          opportunity={o}
          content={c}
          onBack={() => setStep((n) => Math.max(0, n - 1))}
          onNext={() => {
            if (step + 1 < PITCH_REVEAL_STEPS.length) setStep(step + 1);
            else openRecap();
          }}
          onSkip={openRecap}
        />
      </div>
    );
  }

  const openVersion = o.versions.find(
    (v) => v.state === 'awaiting_founder' || v.state === 'awaiting_creator',
  );

  return (
    <div className="cra-page crp-recap">
      <header className="cra-page__head">
        <Tag variant="mint">{o.campaignStateLabel}</Tag>
        <h1>{name}</h1>
        {/* §14.1's opener. */}
        {o.whyThisFitsYourAudience ? (
          <p className="cra-lede">{o.whyThisFitsYourAudience}</p>
        ) : null}
        {o.responseDeadlineAt ? (
          <p className="cra-help">
            A decision is open until {deadline(o.responseDeadlineAt)}. {DECLINING_COSTS_YOU_NOTHING}
          </p>
        ) : null}
      </header>

      {/* §14.1's 60-second brief. */}
      <Card>
        <h2>The 60-second version</h2>
        <dl className="kv">
          <Row label="Campaign type">{c.brief.campaignType}</Row>
          <Row label="What it promises">{c.brief.productPromise ?? 'Not written yet.'}</Row>
          <Row label="Who it is for">
            {c.brief.audience ??
              'The Founder has not written an audience description. What we matched you on is the sentence at the top of this page.'}
          </Row>
          <Row label="What you would do">{c.brief.requiredPromotion}</Row>
          <Row label="What you would earn">{c.brief.compensation}</Row>
          <Row label="Key date">
            {c.brief.keyDate ? deadline(c.brief.keyDate) : 'No close date is set yet.'}
          </Row>
          <Row label="Main risk">
            {c.brief.mainRisk ?? 'The Founder has not written a risks note for this campaign yet.'}
          </Row>
        </dl>
      </Card>

      {/* §14.1: the Founder. */}
      <Card>
        <h2>The Founder</h2>
        <dl className="kv">
          <Row label="Name">{c.founder.displayName}</Row>
          <Row label="Selling as">
            {c.founder.soleProprietor === true
              ? 'A sole proprietor — the Founder personally'
              : c.founder.entity}
          </Row>
          <Row label="Profile">{c.founder.profileUrl ?? 'Not provided.'}</Row>
          <Row label="Prior Proovd campaigns">
            {c.founder.priorCampaigns === 0
              ? 'This is their first campaign with us.'
              : `${c.founder.priorCampaigns} other campaign${c.founder.priorCampaigns === 1 ? '' : 's'} with Proovd.`}
          </Row>
          <Row label="Payout setup">
            {c.founder.payoutReadiness === 'ready'
              ? 'Complete — the Founder can take charges.'
              : c.founder.payoutReadiness === 'in_progress'
                ? 'In progress. The campaign cannot go live until it is complete.'
                : 'Not started. The campaign cannot go live until it is complete.'}
          </Row>
        </dl>
        {/* §30 defers direct Founder–Creator messaging in both directions, and
            the meeting scheduler with it. There is no contact control here. */}
        <p className="cra-help">
          Questions about the campaign go through Proovd rather than directly to the Founder.
        </p>
      </Card>

      {/* §14.1: product category, Problem, Solution, Competition. */}
      <Card>
        <h2>The product</h2>
        <dl className="kv">
          <Row label="Category">
            {c.positioning.category ?? 'Not recorded for this campaign.'}
          </Row>
          <Row label="Problem">{c.positioning.problem ?? 'Not written yet.'}</Row>
          <Row label="Solution">{c.positioning.solution ?? 'Not written yet.'}</Row>
          <Row label="Competition">
            {c.positioning.competition ?? 'Not collected on this campaign.'}
          </Row>
        </dl>
      </Card>

      {/* §14.1: campaign type and charge rule. */}
      <Card>
        <h2>How Backers are charged</h2>
        <p>{c.chargeRule.rule}</p>
        <dl className="kv">
          <Row label={c.threshold.label}>
            {c.threshold.value === null ? 'Not set yet.' : c.threshold.value}
          </Row>
        </dl>
        <p className="cra-help">{c.threshold.note}</p>
      </Card>

      {/* §14.1: compensation, bid eligibility, fixed availability, high effort. */}
      <Card>
        <h2>What you earn</h2>
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
        {/* Where the reference advises what to counter with. */}
        <p className="cra-help">{PITCH_NO_COUNTER_ADVICE}</p>
      </Card>

      {/* §14.1: rewards. */}
      <Card>
        <h2>What Backers get</h2>
        {c.rewards.length === 0 ? (
          <p className="cra-help">
            The Founder has not built the reward packages yet. They are part of the campaign
            Proovd reviews before it can go live.
          </p>
        ) : (
          <ul className="doc-list">
            {c.rewards.map((reward) => (
              <li key={reward.title}>
                <strong>{reward.title}</strong> — {formatUsd(BigInt(reward.priceCents))}
                <br />
                {reward.contents.join(' · ')}
                <br />
                Delivery: {reward.delivery}. {reward.fulfillment}
                {reward.limitedQuantity !== null ? (
                  <>
                    <br />
                    Limited to {reward.limitedQuantity}.
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* §14.1: dates. */}
      <Card>
        <h2>Dates</h2>
        <dl className="kv">
          <Row label="Opens">
            {c.dates.opensAt ? localDate(c.dates.opensAt) : 'Not scheduled yet.'}
          </Row>
          <Row label="Closes">
            {c.dates.closesAt ? deadline(c.dates.closesAt) : 'Not scheduled yet.'}
          </Row>
          <Row label="Duration">
            {c.dates.durationDays === null
              ? 'Both dates are needed to work this out.'
              : `${c.dates.durationDays} days`}
          </Row>
        </dl>
      </Card>

      {/* §14.1: visuals, branding, story, socials, interview. */}
      <Card>
        <h2>Material</h2>
        <dl className="kv">
          <Row label="Story">{c.materials.story ?? 'Not written yet.'}</Row>
          <Row label="Visuals">
            {c.materials.visuals.available
              ? `${c.materials.visuals.count} stored, in the Campaign kit.`
              : c.materials.visuals.unavailableBecause}
          </Row>
          <Row label="Founder interview">{c.materials.interview.unavailableBecause}</Row>
          <Row label="Socials">
            {c.materials.socials.length === 0
              ? 'None recorded.'
              : c.materials.socials.map((s) => s.url).join(' · ')}
          </Row>
        </dl>
      </Card>

      {/* §14.1: brand voice, permitted and prohibited claims. */}
      <Card>
        <h2>How the Founder wants this talked about</h2>
        <dl className="kv">
          <Row label="Brand voice">{c.brandNotes.brandVoice ?? 'Not written yet.'}</Row>
          <Row label="Brand perception">
            {c.brandNotes.brandPerception ?? 'Not written yet.'}
          </Row>
          <Row label="Say this">{c.claims.requiredWording ?? 'Nothing specific is required.'}</Row>
          <Row label="Never say this">
            {c.claims.prohibitedClaims ?? 'Nothing specific is prohibited.'}
          </Row>
        </dl>
        <p className="cra-help">{c.claims.unconfirmedClaimWarning}</p>
      </Card>

      {/* §14.1: refund policy (Product only). */}
      <Card>
        <h2>Refunds</h2>
        {c.refundPolicy.applicable ? (
          <dl className="kv">
            <Row label="Policy">{c.refundPolicy.title ?? 'Not written yet.'}</Row>
            <Row label="Text">{c.refundPolicy.text ?? 'Not written yet.'}</Row>
          </dl>
        ) : null}
        <p className="cra-help">{c.refundPolicy.note}</p>
      </Card>

      {/* §14.1: required posts, deliverables and availability periods. */}
      <Card>
        <h2>What you would owe</h2>
        <dl className="kv">
          <Row label="Delivery window">
            {c.deliverables.deliveryWindow ?? 'Not set yet.'}
          </Row>
        </dl>
        <ul className="doc-list">
          {c.deliverables.obligations.map((item) => (
            <li key={item.key}>
              <strong>{item.statement}</strong>
              <br />
              {item.enforcement}
            </li>
          ))}
        </ul>
      </Card>

      {/* §14.1: the rules, and the proof instructions. */}
      <Card>
        <h2>The rules you would be promoting under</h2>
        <ul className="doc-list">
          {PITCH_PROMOTION_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <h3>Proving the work</h3>
        <ul className="doc-list">
          {PITCH_PROOF_INSTRUCTIONS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>

      {/* §14.1: the plain-language IP/confidentiality summary. */}
      <Card>
        <h2>Confidentiality</h2>
        <p>{PITCH_IP_SUMMARY}</p>
      </Card>

      {/* §14.1: finalization, adjustment, Transfer/payout, and support. */}
      <Card>
        <h2>How you get paid</h2>
        <ul className="doc-list">
          {PITCH_MONEY_EXPLANATION.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>

      {/* §14.1: for a live-campaign invite. Absent for an initial-roster
          Creator, which is an answer rather than a gap. */}
      {c.midCampaign ? (
        <Card>
          <h2>Joining a campaign that is already running</h2>
          <dl className="kv">
            <Row label="Time left when you were asked">
              {c.midCampaign.joinedWithHoursRemaining} hours
            </Row>
            <Row label="Your deliverables">{c.midCampaign.adjustedDeliverables}</Row>
          </dl>
          <p className="cra-help">{c.midCampaign.activationRule}</p>
        </Card>
      ) : null}

      {/* The accepted state: the link, inactive, with copy confirmation. */}
      {o.agreement ? (
        <Card>
          <h2>Your locked terms</h2>
          <dl className="kv">
            <Row label="Percentage">{o.agreement.totalPercent}% per attributed captured charge</Row>
            {o.agreement.fixedPaymentCents ? (
              <Row label="Fixed payment">
                Agreed — funded before launch, outside the percentage.
              </Row>
            ) : null}
          </dl>
          {o.trackingLink ? (
            <>
              <p className="cra-help">
                Your unique tracking link. It is{' '}
                {o.trackingLink.active
                  ? 'active'
                  : 'inactive until the campaign is approved and you are marked ready'}
                . Posting before activation earns nothing.
              </p>
              <dl className="kv">
                <Row label="Tracking link">{o.trackingLink.url}</Row>
                <Row label="Disclosure">{o.trackingLink.disclosureText}</Row>
              </dl>
              <div className="cra-acts">
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
                {formatUsd(BigInt(openVersion.fixedPaymentRequestCents))}
              </Row>
            ) : null}
            <Row label="Waiting on">
              {openVersion.state === 'awaiting_founder' ? 'The Founder' : 'You'}
            </Row>
          </dl>
          <p className="cra-help">{PENDING_PROPOSAL_NOTE}</p>
          {openVersion.state === 'awaiting_creator' && o.decisionsAvailable ? (
            <div className="cra-acts">
              <Button tier="primary" disabled={busy} onClick={() => setPanel('accept')}>
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
          <p className="cra-help">
            Three outcomes are open to you, and no one of them is required: accept the standard
            terms, decline, or propose different terms.
          </p>
          <div className="cra-acts">
            <Button tier="primary" onClick={() => setPanel('accept')}>
              Accept standard terms
            </Button>
            <Button tier="secondary" onClick={() => setPanel('decline')}>
              Decline this campaign
            </Button>
            <Button tier="tertiary" onClick={() => setPanel('propose')}>
              Propose different terms
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

      <Button tier="tertiary" onClick={() => void navigate('/creator/campaigns')}>
        Back to your campaigns
      </Button>
    </div>
  );
}

/* ── The reveal ───────────────────────────────────────────────────────────── */

function RevealStep(props: {
  index: number;
  opportunity: Opportunity;
  content: PitchContent;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const { index, opportunity: o, content: c } = props;
  const step = PITCH_REVEAL_STEPS[index];
  if (!step) return null;

  const total = PITCH_REVEAL_STEPS.length;
  const name = c.positioning.productName ?? 'This campaign';

  return (
    <section className="crp-step" aria-labelledby="crp-step-title">
      <p className="crp-step__count">
        Step {index + 1} of {total}
      </p>
      <ol className="crp-step__segments" aria-hidden="true">
        {PITCH_REVEAL_STEPS.map((entry, n) => (
          <li key={entry.id} className={n <= index ? 'is-done' : ''} />
        ))}
      </ol>

      <p className="crp-step__eyebrow">{step.eyebrow}</p>

      {step.id === 'product' ? (
        <>
          <h1 id="crp-step-title">{name}</h1>
          <p className="crp-step__body">
            {c.brief.productPromise ?? 'The Founder has not written a promise line yet.'}
          </p>
          <p className="cra-help">
            {o.highEffort.result ? 'High effort' : 'Light lift'} · {c.brief.campaignType}
          </p>
        </>
      ) : null}

      {step.id === 'problem' ? (
        <>
          <h1 id="crp-step-title">The problem</h1>
          <p className="crp-step__body">
            {c.positioning.problem ?? 'The Founder has not written this yet.'}
          </p>
        </>
      ) : null}

      {step.id === 'solution' ? (
        <>
          <h1 id="crp-step-title">What it does</h1>
          <p className="crp-step__body">
            {c.positioning.solution ?? 'The Founder has not written this yet.'}
          </p>
        </>
      ) : null}

      {step.id === 'earn' ? (
        <>
          <h1 id="crp-step-title">You earn {o.compensation.basePercent}%</h1>
          <p className="crp-step__body">
            Of every captured, validly attributed pre-order — pre-tax, and only on charges that
            actually go through.
          </p>
        </>
      ) : null}

      <div className="cra-acts crp-step__acts">
        {index > 0 ? (
          <Button tier="tertiary" onClick={props.onBack}>
            {`Back to ${PITCH_REVEAL_STEPS[index - 1]?.navName ?? 'the previous step'}`}
          </Button>
        ) : null}
        <Button tier="primary" onClick={props.onNext}>
          {index + 1 < total
            ? `Continue to ${PITCH_REVEAL_STEPS[index + 1]?.navName ?? 'the next step'}`
            : PITCH_SKIP_LABEL}
        </Button>
        {index + 1 < total ? (
          <Button tier="secondary" onClick={props.onSkip}>
            {PITCH_SKIP_LABEL}
          </Button>
        ) : null}
      </div>

      <p className="cra-help">{PITCH_WALK_IS_OPTIONAL}</p>
    </section>
  );
}

/* ── Accept: the four §14.2 confirmations, separately (§28.4) ─────────────── */

const CONFIRMATIONS: Array<{ key: keyof DecisionConfirmations; label: string }> = [
  { key: 'compensationTerms', label: 'I accept the compensation terms shown above.' },
  {
    key: 'ipAgreement',
    label: 'I accept the Creator-only IP and confidentiality agreement for this campaign.',
  },
  {
    key: 'ftcDisclosure',
    label: 'I will include the required FTC disclosure in every promotion for this campaign.',
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
        <Option
          key={c.key}
          label={c.label}
          checked={checked[c.key]}
          onCheckedChange={(next) => setChecked({ ...checked, [c.key]: next })}
        />
      ))}
      {props.error ? (
        <p className="field-error" role="alert">
          {props.error}
        </p>
      ) : null}
      <div className="cra-acts">
        <Button
          tier="primary"
          disabled={props.busy || !all}
          onClick={() => props.onAccept(checked, props.openVersionId)}
        >
          {props.busy ? 'Recording…' : 'Confirm acceptance'}
        </Button>
        <Button tier="tertiary" disabled={props.busy} onClick={props.onCancel}>
          Go back to your decision
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
      <p className="cra-help">{DECLINING_COSTS_YOU_NOTHING} A reason is optional.</p>
      <Field label="Reason (optional)">
        <Input value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {props.error ? (
        <p className="field-error" role="alert">
          {props.error}
        </p>
      ) : null}
      <div className="cra-acts">
        <Button tier="secondary" disabled={props.busy} onClick={() => props.onDecline(reason)}>
          {props.busy ? 'Recording…' : 'Decline this opportunity'}
        </Button>
        <Button tier="tertiary" disabled={props.busy} onClick={props.onCancel}>
          Go back to your decision
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
      {/* §14.2's two proposals are gated on DIFFERENT axes: a percentage bid is
          high-effort only, a fixed Creator payment request is Product-only and
          not gated on high effort at all. Both come from the server's cell. */}
      {props.cell.bidAllowed ? (
        <Field
          label={`Total percentage (above ${props.cell.basePercent}%, at most ${props.cell.ceilingPercent}%)`}
        >
          <Input inputMode="numeric" value={bid} onChange={(event) => setBid(event.target.value)} />
        </Field>
      ) : (
        <p className="cra-help">
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
        <p className="cra-help">A fixed Creator payment is not available on an Idea Campaign.</p>
      )}
      <p className="cra-help">{PITCH_NO_COUNTER_ADVICE}</p>
      {props.error ? (
        <p className="field-error" role="alert">
          {props.error}
        </p>
      ) : null}
      <div className="cra-acts">
        <Button
          tier="secondary"
          disabled={props.busy || !hasSomething}
          onClick={() => props.onPropose(proposal)}
        >
          {props.busy ? 'Sending…' : 'Send proposal'}
        </Button>
        <Button tier="tertiary" disabled={props.busy} onClick={props.onCancel}>
          Go back to your decision
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
