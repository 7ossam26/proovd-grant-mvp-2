/**
 * Chapter 1, Choose — Founder Dashboard Session C.
 *
 * Everything the Founder does between paying the listing fee and the campaign
 * going live: read the roster Proovd recruited, answer the versions those
 * Creators author, offer a bonus once terms lock, and ask to talk to somebody
 * before deciding.
 *
 * ── It answers; it does not select ─────────────────────────────────────────
 * §14.5: "Proovd owns recruitment follow-up. The Founder cannot browse or
 * contact a general pool." §8 repeats it, §30 defers Founder outreach to
 * unmatched Affiliates, and `rosterMembership` has two writers and both are
 * Admin. So the left column is a READER — it decides which card is open and
 * nothing about who is on the roster — and there is no add control, no remove
 * control, no ordering control, and no "send to my roster" action. The two
 * absences say so where the reference put those controls.
 *
 * ── The three responses go through the one route that already owns them ────
 * `POST /api/founder/proposals/:versionId/respond` with `accept | decline |
 * revise` (§14.2). Nothing here computes a percentage: the revision control
 * bounds itself with the base and ceiling the SERVER resolved from the §6
 * settings, so it cannot offer a number `validateProposalAgainstCell` would
 * refuse — a courtesy over the server's answer (§1.1), never a second rule.
 *
 * ── The panels are inline rather than modal, deliberately ──────────────────
 * The reference opens a dialog for each. Every one of these forms can be
 * refused by the server — a revision at or below base, a bonus that breaches
 * the ceiling, a second meeting ask — and `Modal` closes on its own primary
 * action, which would put the refusal on a card behind a panel that has just
 * vanished. §1.8 gives DNA control of presentation, and DNA §5.14's Act stage
 * is exactly this: the decision opens in place, with its refusal beside the
 * field that caused it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  AFFILIATE_SUBTYPE_DEFINITIONS,
  BASE_CUT_IS_NOT_YOURS_TO_SET,
  BONUS_AFTER_ACCEPTANCE,
  BONUS_COUNTS_TOWARD_THE_CEILING,
  BONUS_IS_THIS_CREATOR_ONLY,
  BONUS_TRIGGER_UNITS,
  CHOOSE_ABSENCES,
  COMMUNITY_IS_YOURS_TO_RUN,
  MEETING_REQUEST_CHANGES_NOTHING,
  MEETING_REQUEST_IS_NOT_A_SCHEDULER,
  MEETING_REQUEST_NO_PENALTY,
  MEETING_REQUEST_ONE_MESSAGE,
  NO_DOWNWARD_BID,
  REFUND_POLICY_IS_READ_BEFORE_PAYING,
  REVISION_IS_NOT_ACCEPTANCE,
  REVISION_ONLY_UPWARDS,
  chooseAbsence,
  revisionOpeningValue,
  revisionRange,
  type BonusTriggerUnitId,
} from '@proovd/shared';
import {
  Button,
  Card,
  Field,
  Input,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Stepper,
  Tag,
  Textarea,
} from '../../../components/index.js';
import { SurfaceLoading, supportMailto } from '../../../features/public/states.js';
import { CreatorReadiness } from '../CreatorReadiness.js';
import {
  fetchBuild,
  fetchRoster,
  offerCreatorBonus,
  requestMeeting,
  respondToProposal,
  saveBuild,
  FounderRequestError,
  type BuildFields,
  type RosterCreator,
  type RosterTerms,
  type RosterView,
} from '../api.js';

const SUBTYPE_LABELS = new Map(AFFILIATE_SUBTYPE_DEFINITIONS.map((s) => [s.id, s.label]));

/** §30 forbids countdown pressure: a stated fact as of load, never a ticker. */
function remainingText(deadlineIso: string): string {
  const ms = new Date(deadlineIso).getTime() - Date.now();
  if (ms <= 0) return 'The response window has closed.';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m left as of when this page loaded.`;
}

/** §27.1: local primary, UTC beside it. */
function deadlineText(iso: string): string {
  const at = new Date(iso);
  return `${at.toLocaleString()} (${at.toISOString().replace('T', ' ').slice(0, 16)} UTC)`;
}

function refusalText(caught: unknown, fallback: string): string {
  return caught instanceof FounderRequestError
    ? (caught.detail.whatHappened ?? fallback)
    : 'The request did not complete. Nothing was changed.';
}

function Absence({ id }: { id: string }) {
  const absence = chooseAbsence(id);
  return <p className="fd-absence">{absence.sentence}</p>;
}

/* ── The chapter ──────────────────────────────────────────────────────────── */

export function ChooseChapter({
  campaignId,
  campaignType,
}: {
  campaignId: string;
  campaignType: string | null;
}) {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; whatHappened: string }
    | { status: 'ready'; roster: RosterView; build: BuildFields | null }
  >({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const [{ roster }, build] = await Promise.all([fetchRoster(campaignId), fetchBuild(campaignId)]);
      setState({ status: 'ready', roster, build: build.build });
    } catch (caught) {
      setState({
        status: 'error',
        whatHappened: refusalText(caught, 'Your roster could not be opened.'),
      });
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') {
    return <SurfaceLoading subject="your roster" reference={campaignId} />;
  }

  if (state.status === 'error') {
    return (
      <Section aria-labelledby="fd-choose-error">
        <Measure>
          <h1 className="h2" id="fd-choose-error">
            We could not open your roster
          </h1>
          <StatePanel
            state="Your roster is not available"
            whatHappened={state.whatHappened}
            next="Reload the page. Nothing about your campaign or anyone's terms changed."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: supportMailto(`Roster — ${campaignId}`) }}
          />
        </Measure>
      </Section>
    );
  }

  const { roster, build } = state;
  const creators = roster.creators;
  const requested = params.get('creator');
  const selected =
    creators.find((c) => c.associationId === requested) ??
    // The one waiting on the Founder first, then whoever is at the top: the
    // card that opens is the one with something to answer.
    creators.find((c) => c.openProposal?.awaitingYou) ??
    creators[0] ??
    null;

  function openCreator(associationId: string) {
    // One write. Two sequential `setParams` calls each rebuild from the same
    // closed-over snapshot and the second restores what the first removed.
    const next = new URLSearchParams(params);
    next.set('creator', associationId);
    setParams(next, { replace: true });
  }

  const waiting = creators.filter((c) => c.openProposal?.awaitingYou).length;
  const anyLocked = creators.some((c) => c.lockedTerms !== null);

  return (
    <Section aria-labelledby="fd-choose">
      <div className="fd-choose">
        <header className="fd-choose__head">
          <p className="kicker">Chapter 1 of 4</p>
          <h1 className="h2" id="fd-choose">
            Choose your launch team
          </h1>
          <p className="lede">
            Proovd recruited these Creators for your campaign. They make the offers; you accept,
            decline, or come back with a different number.
          </p>
        </header>

        <DeadlineBand roster={roster} />
        <BaseCutPanel terms={roster.terms} />

        {creators.length === 0 ? (
          <StatePanel
            state="No Creators recruited yet"
            whatHappened="Proovd is still approaching Creators for your campaign."
            next="Recruitment is our work, not yours. We email you as the roster changes."
            owner="Proovd"
            nextUpdate="As recruitment progresses"
            action={NO_ACTION}
            reference={campaignId}
          />
        ) : (
          <div className="fd-choose__split">
            <nav className="fd-roster" aria-label="Recruited Creators">
              <p className="kicker">Your roster</p>
              <p className="fd-roster__count">
                <strong>{creators.length}</strong>{' '}
                {creators.length === 1 ? 'Creator' : 'Creators'}
              </p>
              <p className="fd-roster__waiting">
                {waiting === 0
                  ? 'Nothing is waiting on you.'
                  : `${waiting} ${waiting === 1 ? 'offer needs' : 'offers need'} your answer.`}
              </p>
              <ul>
                {creators.map((creator) => (
                  <li key={creator.associationId}>
                    <button
                      type="button"
                      className={`fd-roster__row${
                        creator.associationId === selected?.associationId ? ' is-open' : ''
                      }`}
                      aria-current={
                        creator.associationId === selected?.associationId ? 'true' : undefined
                      }
                      onClick={() => openCreator(creator.associationId)}
                    >
                      <span className="fd-roster__who">
                        {creator.handle ?? 'A recruited Creator'}
                      </span>
                      <span className="fd-roster__meta">{creator.statusLabel}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {/* The two controls the reference draws here and this chapter does not. */}
              <Absence id="browse_creators" />
              <Absence id="send_to_roster" />
            </nav>

            {selected ? (
              <CreatorPane
                key={selected.associationId}
                campaignId={campaignId}
                creator={selected}
                terms={roster.terms}
                pendingProposalNote={roster.pendingProposalNote}
                onChanged={load}
              />
            ) : null}
          </div>
        )}

        {/*
          §16's readiness, absorbed rather than linked — the `/creator-readiness`
          address redirects here, so the content has to be here. It renders once
          somebody's terms are LOCKED, which is a fact on the roster rather than
          an invented phase rule: readiness is assessed for accepted Creators,
          and before there are any there is nobody to assess. Phase 13's surface
          is untouched apart from dropping its heading a level (§33.11.2).
        */}
        {anyLocked ? <CreatorReadiness embedded /> : null}

        <CampaignFields
          campaignId={campaignId}
          campaignType={campaignType}
          build={build}
          onSaved={load}
        />
      </div>
    </Section>
  );
}

/* ── §14.5's deadline, remaining time, and the full-refund outcome ────────── */

function DeadlineBand({ roster }: { roster: RosterView }) {
  if (!roster.responseDeadlineAt) {
    return (
      <Card>
        <h2 className="h3">The decision window</h2>
        <p>
          The clock starts when your listing fee is paid. Nothing is waiting on you until then.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <h2 className="h3">The decision window</h2>
      <dl className="kv">
        <div className="kv__row">
          <dt>Closes</dt>
          <dd>{deadlineText(roster.responseDeadlineAt)}</dd>
        </div>
        <div className="kv__row">
          <dt>Left</dt>
          <dd>{remainingText(roster.responseDeadlineAt)}</dd>
        </div>
      </dl>
      {/* §14.5's "full-refund outcome" — Appendix A.5's own promise, verbatim
          from the server. The reference says "a full refund minus the $5
          listing fee", which is wrong twice: §14.6 refunds the ENTIRE listing
          Checkout total, and no US$5 fee exists anywhere in §6. */}
      <p>{roster.fullRefundOutcome}</p>
    </Card>
  );
}

/* ── The base cut, read-only (C3's surviving `effort` step) ───────────────── */

function BaseCutPanel({ terms }: { terms: RosterTerms }) {
  return (
    <Card>
      <p className="kicker">The standard share</p>
      <p className="fd-hero-num">{terms.basePercent}%</p>
      <h2 className="h3">of every pre-order a Creator brings in</h2>
      <p>{BASE_CUT_IS_NOT_YOURS_TO_SET}</p>
      <p className="fd-note">{NO_DOWNWARD_BID}</p>
      {terms.bidAllowed ? (
        <>
          <p className="kicker">What that looks like</p>
          <dl className="kv">
            <div className="kv__row">
              <dt>They ask for</dt>
              <dd>{Math.min(terms.ceilingPercent, terms.basePercent + 20)}%</dd>
            </div>
            <div className="kv__row">
              <dt>You come back with</dt>
              <dd>{Math.min(terms.ceilingPercent, terms.basePercent + 5)}%</dd>
            </div>
            <div className="kv__row">
              <dt>You both accept</dt>
              <dd>{Math.min(terms.ceilingPercent, terms.basePercent + 5)}%</dd>
            </div>
          </dl>
          <p className="fd-note">
            Nothing goes past {terms.ceilingPercent}% — that is the ceiling for everything
            percentage-based put together.
          </p>
        </>
      ) : (
        <p className="fd-note">
          On this campaign the share is the standard one. Nobody can ask for more than{' '}
          {terms.basePercent}%.
        </p>
      )}
    </Card>
  );
}

/* ── One Creator: what §11 permits, and the three responses ───────────────── */

type Panel = 'none' | 'revise' | 'bonus' | 'meeting';

function CreatorPane({
  campaignId,
  creator,
  terms,
  pendingProposalNote,
  onChanged,
}: {
  campaignId: string;
  creator: RosterCreator;
  terms: RosterTerms;
  pendingProposalNote: string;
  onChanged: () => Promise<void> | void;
}) {
  const [panel, setPanel] = useState<Panel>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const open = creator.openProposal;
  const range = revisionRange(terms.basePercent, terms.ceilingPercent, terms.bidAllowed);
  const [revision, setRevision] = useState(() =>
    revisionOpeningValue(range, open?.bidTotalPercent ?? null),
  );

  async function run(work: () => Promise<string>): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const message = await work();
      setPanel('none');
      setDone(message);
      await onChanged();
    } catch (caught) {
      setError(refusalText(caught, 'That was not accepted.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="fd-creator">
      <div className="fd-creator__head">
        <h2 className="h3">{creator.handle ?? 'A recruited Creator'}</h2>
        <Tag variant="mint">{creator.statusLabel}</Tag>
      </div>

      {/* §11's seven columns, and only those. No email, no legal name, no
          quality tier, no verification evidence, no channel URL. */}
      <dl className="kv">
        <Row label="Channel">
          {creator.channelType
            ? (SUBTYPE_LABELS.get(
                creator.channelType as (typeof AFFILIATE_SUBTYPE_DEFINITIONS)[number]['id'],
              ) ?? creator.channelType)
            : 'Not recorded'}
        </Row>
        <Row label="Audience">{creator.audienceMetric ?? 'Not recorded'}</Row>
        <Row label="Niche">{creator.niche ?? 'Not recorded'}</Row>
        {creator.bio ? <Row label="What Proovd found">{creator.bio}</Row> : null}
        {creator.lockedTerms ? (
          <Row label="Locked terms">
            {creator.lockedTerms.totalPercent}% of every attributed pre-order
            {creator.lockedTerms.fixedPaymentCents
              ? `, plus an agreed fixed Creator payment of US$${(
                  Number(creator.lockedTerms.fixedPaymentCents) / 100
                ).toFixed(2)}`
              : ''}
          </Row>
        ) : null}
      </dl>

      <Absence id="creator_posts" />
      <Absence id="creator_contact" />

      {done ? (
        <p className="fd-done" role="status">
          {done}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      {open ? (
        <section className="fd-offer" aria-labelledby={`offer-${creator.associationId}`}>
          <h3 className="h3" id={`offer-${creator.associationId}`}>
            Their offer — version {open.versionNumber}
          </h3>
          <dl className="kv">
            {open.bidTotalPercent !== null ? (
              <Row label="They are asking for">{open.bidTotalPercent}% in total</Row>
            ) : null}
            {open.fixedPaymentRequestCents !== null ? (
              <Row label="Fixed Creator payment requested">
                US${(Number(open.fixedPaymentRequestCents) / 100).toFixed(2)}
              </Row>
            ) : null}
            <Row label="The standard share is">{terms.basePercent}%</Row>
          </dl>
          {/* §14.5: interest, not acceptance — beside every pending proposal. */}
          <p className="fd-note">{pendingProposalNote}</p>

          {open.awaitingYou ? (
            panel === 'revise' ? (
              <div className="fd-act">
                <h4 className="h3">Come back with a different number</h4>
                <p>{REVISION_IS_NOT_ACCEPTANCE}</p>
                <p className="fd-note">{REVISION_ONLY_UPWARDS}</p>
                <Stepper
                  value={revision}
                  onValueChange={setRevision}
                  label="the percentage you are offering"
                  min={range.min}
                  max={range.max}
                  suffix="%"
                />
                <div className="claim__actions">
                  <Button
                    tier="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await respondToProposal(open.versionId, {
                          action: 'revise',
                          bidTotalPercent: revision,
                        });
                        return `Sent at ${revision}%. It is theirs to answer now — nothing is locked.`;
                      })
                    }
                  >
                    {busy ? 'Sending…' : `Send ${revision}% for them to answer`}
                  </Button>
                  <Button tier="tertiary" disabled={busy} onClick={() => setPanel('none')}>
                    Keep their offer open
                  </Button>
                </div>
              </div>
            ) : (
              <div className="claim__actions">
                <Button
                  tier="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await respondToProposal(open.versionId, { action: 'accept' });
                      return 'Accepted. Their terms are locked for this campaign.';
                    })
                  }
                >
                  Accept {open.bidTotalPercent !== null ? `${open.bidTotalPercent}%` : 'their terms'}
                </Button>
                {/* §14.2's third outcome. It answers the VERSION, not the
                    person — the absence below says so, because "Reject match"
                    reads as a removal the Founder cannot make. */}
                <Button
                  tier="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await respondToProposal(open.versionId, { action: 'decline' });
                      return 'Declined. They can still accept the standard terms or come back with a different number.';
                    })
                  }
                >
                  Decline this offer
                </Button>
                {range.available ? (
                  <Button tier="tertiary" disabled={busy} onClick={() => setPanel('revise')}>
                    Offer a different number
                  </Button>
                ) : null}
              </div>
            )
          ) : (
            <p className="fd-note">Waiting on them. No action needed from you.</p>
          )}
          <Absence id="remove_creator" />
        </section>
      ) : null}

      {creator.lockedTerms ? (
        <BonusPanel
          campaignId={campaignId}
          creator={creator}
          terms={terms}
          open={panel === 'bonus'}
          busy={busy}
          onOpen={() => setPanel(panel === 'bonus' ? 'none' : 'bonus')}
          onSubmit={(body) =>
            run(async () => {
              const { bonus } = await offerCreatorBonus(campaignId, creator.associationId, body);
              return `Bonus recorded: +${bonus.additionalPercent}%, with a combined maximum of ${bonus.maxCombinedPercent}%.`;
            })
          }
        />
      ) : (
        <p className="fd-note">{BONUS_AFTER_ACCEPTANCE}</p>
      )}

      <MeetingPanel
        campaignId={campaignId}
        creator={creator}
        open={panel === 'meeting'}
        busy={busy}
        onOpen={() => setPanel(panel === 'meeting' ? 'none' : 'meeting')}
        onSubmit={(message) =>
          run(async () => {
            await requestMeeting(campaignId, creator.associationId, message);
            return 'Sent. Proovd passed it on — they can say yes or no, and nothing about their offer moved.';
          })
        }
      />
    </article>
  );
}

/* ── §14.3's Creator-specific bonus ───────────────────────────────────────── */

function BonusPanel({
  creator,
  terms,
  open,
  busy,
  onOpen,
  onSubmit,
}: {
  campaignId: string;
  creator: RosterCreator;
  terms: RosterTerms;
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onSubmit: (body: {
    triggerUnit: BonusTriggerUnitId;
    threshold: string;
    additionalPercent: number;
  }) => Promise<void>;
}) {
  const locked = creator.lockedTerms?.totalPercent ?? terms.basePercent;
  const largest = Math.max(terms.ceilingPercent - locked, 0);
  const [unit, setUnit] = useState<BonusTriggerUnitId>('unique_attributed_backers');
  const [threshold, setThreshold] = useState('');
  const [percent, setPercent] = useState(() => Math.min(5, largest || 1));

  const chosen = BONUS_TRIGGER_UNITS.find((u) => u.id === unit)!;

  if (!open) {
    return (
      <div className="fd-act__opener">
        <Button tier="tertiary" disabled={busy || largest === 0} onClick={onOpen}>
          Offer a bonus
        </Button>
        {largest === 0 ? (
          <p className="fd-note">
            Their locked terms are already at the {terms.ceilingPercent}% ceiling, so there is no
            bonus left to offer.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section className="fd-act" aria-labelledby={`bonus-${creator.associationId}`}>
      <h3 className="h3" id={`bonus-${creator.associationId}`}>
        Offer a bonus
      </h3>
      {/* The reference says a bonus rewards performance "without changing the
          agreed base cut", which reads as outside the ceiling. §14.3 stores a
          maximum COMBINED percentage and the server refuses one that breaches
          it — only a fixed amount sits outside, and this control offers none. */}
      <p>{BONUS_COUNTS_TOWARD_THE_CEILING}</p>
      <p className="fd-note">
        Their terms are {locked}%, so the largest bonus available is {largest}%.
      </p>

      <fieldset className="fd-fieldset">
        <legend>What should it count?</legend>
        {BONUS_TRIGGER_UNITS.map((entry) => (
          <label key={entry.id} className="fd-radio">
            <input
              type="radio"
              name={`bonus-unit-${creator.associationId}`}
              value={entry.id}
              checked={unit === entry.id}
              onChange={() => setUnit(entry.id)}
            />
            <span>
              <strong>{entry.label}</strong>
              <span className="fd-note">{entry.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="fd-note">{BONUS_IS_THIS_CREATOR_ONLY}</p>
      {/* §14.3 names two trigger units and no time window. The reference's
          "3 days / 1 week / By campaign end" is a third rule with no column. */}
      <Absence id="bonus_period" />

      <Field
        label={
          unit === 'attributed_subtotal_cents'
            ? 'They reach (US$, pre-tax)'
            : 'They reach (pre-orders)'
        }
      >
        <Input
          inputMode="numeric"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value.replace(/[^\d]/g, ''))}
        />
      </Field>
      <Stepper
        value={percent}
        onValueChange={setPercent}
        label="the extra percentage"
        min={1}
        max={Math.max(largest, 1)}
        suffix="%"
      />

      <div className="claim__actions">
        <Button
          tier="secondary"
          disabled={busy || !threshold.trim()}
          onClick={() =>
            void onSubmit({
              triggerUnit: unit,
              // Cents for a money trigger, a plain count for the other — the
              // unit the register names is what decides.
              threshold:
                unit === 'attributed_subtotal_cents'
                  ? String(Number(threshold) * 100)
                  : threshold.trim(),
              additionalPercent: percent,
            })
          }
        >
          {busy ? 'Recording…' : `Offer +${percent}% at ${threshold || '—'} ${chosen.unit}`}
        </Button>
      </div>
    </section>
  );
}

/* ── Deviation 1: the meeting request ─────────────────────────────────────── */

function MeetingPanel({
  creator,
  open,
  busy,
  onOpen,
  onSubmit,
}: {
  campaignId: string;
  creator: RosterCreator;
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onSubmit: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const existing = creator.meetingRequest;

  if (existing) {
    return (
      <section className="fd-act" aria-labelledby={`meeting-${creator.associationId}`}>
        <h3 className="h3" id={`meeting-${creator.associationId}`}>
          You asked to talk
        </h3>
        <dl className="kv">
          <Row label="What you said">{existing.message}</Row>
          <Row label="Their answer">
            {existing.status === 'requested'
              ? 'Not yet — there is no deadline on it.'
              : existing.status === 'accepted'
                ? 'Yes. Proovd is arranging the time.'
                : 'They said no.'}
          </Row>
          {existing.responseNote ? <Row label="They added">{existing.responseNote}</Row> : null}
        </dl>
        {/* §22.9's shape: one message, and there is no second. */}
        <p className="fd-note">{MEETING_REQUEST_ONE_MESSAGE}</p>
        {existing.status === 'requested' ? (
          <p className="fd-note">{MEETING_REQUEST_NO_PENALTY}</p>
        ) : null}
      </section>
    );
  }

  if (!open) {
    return (
      <div className="fd-act__opener">
        <Button tier="tertiary" disabled={busy} onClick={onOpen}>
          Ask to talk first
        </Button>
      </div>
    );
  }

  return (
    <section className="fd-act" aria-labelledby={`meeting-${creator.associationId}`}>
      <h3 className="h3" id={`meeting-${creator.associationId}`}>
        Ask to talk first
      </h3>
      {/* The reference offers three time slots and "Send meeting invite". §30
          defers a Founder–Creator scheduler by name and requires the human
          Founder interview scheduler; §12's Cal.com is that one, and there is
          no column here a time could be written to. */}
      <Absence id="meeting_slots" />
      <p>{MEETING_REQUEST_CHANGES_NOTHING}</p>
      <p className="fd-note">{MEETING_REQUEST_ONE_MESSAGE}</p>
      <Field label="What would you like to talk about?">
        <Textarea
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1000}
        />
      </Field>
      <div className="claim__actions">
        <Button
          tier="secondary"
          disabled={busy || !message.trim()}
          onClick={() => void onSubmit(message.trim())}
        >
          {busy ? 'Sending…' : 'Send this through Proovd'}
        </Button>
        <Button tier="tertiary" disabled={busy} onClick={onOpen}>
          Not now
        </Button>
      </div>
      {/* The scheduler refusal is the `meeting_slots` absence above — its
          sentence IS `MEETING_REQUEST_IS_NOT_A_SCHEDULER`, so repeating it here
          would say the same thing twice on one panel. */}
    </section>
  );
}

/* ── C3's two surviving fields, both on `campaign_build` ──────────────────── */

function CampaignFields({
  campaignId,
  campaignType,
  build,
  onSaved,
}: {
  campaignId: string;
  campaignType: string | null;
  build: BuildFields | null;
  onSaved: () => Promise<void> | void;
}) {
  const [refunds, setRefunds] = useState(build?.refundPolicySourceUrl ?? '');
  const [community, setCommunity] = useState(build?.communityUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // §14.4 puts the refund policy on a Product Campaign only; an Idea one has no
  // such field, so there is nothing to render rather than a disabled box.
  const isProduct = campaignType === 'pre_launch';

  async function save(patch: Partial<BuildFields>): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await saveBuild(campaignId, patch);
      setSaved(true);
      await onSaved();
    } catch (caught) {
      setError(refusalText(caught, 'That did not save.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="fd-fields" aria-labelledby="fd-choose-fields">
      <h2 className="h3" id="fd-choose-fields">
        Two things Backers will look for
      </h2>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="fd-done" role="status">
          Saved.
        </p>
      ) : null}

      {isProduct ? (
        <Card>
          <h3 className="h3">Your refunds page</h3>
          <p>{REFUND_POLICY_IS_READ_BEFORE_PAYING}</p>
          <Field label="Link to your refunds page">
            <Input
              type="url"
              inputMode="url"
              value={refunds}
              onChange={(e) => setRefunds(e.target.value)}
            />
          </Field>
          <Button
            tier="secondary"
            disabled={busy}
            onClick={() => void save({ refundPolicySourceUrl: refunds.trim() || null })}
          >
            {busy ? 'Saving…' : 'Save the refunds link'}
          </Button>
          <p className="fd-note">
            The policy text itself, its title, version and effective date live in your campaign
            build — a Backer's copy is frozen at the moment they pre-order.
          </p>
        </Card>
      ) : null}

      <Card>
        <h3 className="h3">Your community</h3>
        {/* §30 defers a hosted Founder community; §1 rule 6 forbids inventing a
            fee; §24 has three money streams and a fourth has no merchant of
            record, no tax position and no place in the ledger. The reference
            charges US$5 for Proovd to stand one up. */}
        <p>{COMMUNITY_IS_YOURS_TO_RUN}</p>
        <Field label="Link to your community (optional)">
          <Input
            type="url"
            inputMode="url"
            value={community}
            onChange={(e) => setCommunity(e.target.value)}
          />
        </Field>
        <Button
          tier="secondary"
          disabled={busy}
          onClick={() => void save({ communityUrl: community.trim() || null })}
        >
          {busy ? 'Saving…' : 'Save the community link'}
        </Button>
      </Card>
    </section>
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

/** The register, so a test can walk it against what this chapter renders. */
export const CHOOSE_ABSENCE_IDS = CHOOSE_ABSENCES.map((a) => a.id);
