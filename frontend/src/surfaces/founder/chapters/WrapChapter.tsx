/**
 * Chapter 4, Wrap — Founder Dashboard Session F.
 *
 * The campaign is over. What is left is who worked on it (§22.8's recorded
 * completion), whether the Founder wants any of them again (§22.9), whether
 * Proovd has closed the money out (§22.11), and when a next campaign may be
 * asked for (§22.10). The people who backed it are their own page.
 *
 * ── The reference ranks Creators four ways at once, and none of them ships ──
 * A numbered badge, a first-place tile, a heading reading "Who you'd work with
 * again", and a sort by backer count. §30 defers public leaderboards and the
 * Creator close view has shipped with no rank on that basis since Phase 18b —
 * and removing the crown while keeping the sort is still a ranking, because the
 * order IS the claim. The list is ordered by handle, the server says so, and
 * the §22.9 ask is offered on §22.8's recorded status rather than on a revenue
 * figure (§33.10.6: §22.8's five criteria contain no sales term at all).
 *
 * ── §22.11's item keys stay on the server ───────────────────────────────────
 * `readResolution` knows which of §21's nine reconciliation items is still
 * outstanding. Those keys are Admin vocabulary and a Founder cannot act on any
 * of them, so this renders whether the campaign is resolved and who owns the
 * next step (§27.1), and never `provisional_vs_earned`.
 *
 * ── `NextCampaign` is rendered, not rewritten ───────────────────────────────
 * Phase 21b built §22.10's two-gate panel and it has been routed nowhere ever
 * since. It is imported whole: two gates as two panels, with no combined status
 * line above them, because summarising both into one tick is exactly the trap
 * §33.10.9 names.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  RESOLUTION_IS_NOT_FULFILLMENT,
  RESOLUTION_IS_PROOVDS_WORK,
  WORK_AGAIN_NO_PENALTY,
  formatUsd,
  founderBackersPath,
  wrapAbsence,
  type WrapAbsenceId,
} from '@proovd/shared';
import {
  Button,
  Card,
  Field,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Stat,
  Tag,
  Textarea,
} from '../../../components/index.js';
import { SurfaceLoading, supportMailto } from '../../../features/public/states.js';
import { NextCampaign } from '../NextCampaign.js';
import {
  fetchCampaignResults,
  fetchFounderWrap,
  requestWorkAgain,
  FounderRequestError,
  type FounderResultsView,
  type FounderWrapView,
  type WrapCreatorRow,
} from '../api.js';

/** Formats. Never combines two amounts — the chapter does no arithmetic. */
const usd = (cents: string): string => formatUsd(BigInt(cents));

function localDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
}

function refusalText(caught: unknown, fallback: string): string {
  return caught instanceof FounderRequestError
    ? (caught.detail.whatHappened ?? fallback)
    : 'The request did not complete. Nothing was changed.';
}

/** The register's own sentence, rendered where the reference put a control. */
function Absence({ id }: { id: WrapAbsenceId }) {
  return <p className="fd-absence">{wrapAbsence(id).absentBecause}</p>;
}

/* ── The Creator recap ────────────────────────────────────────────────────── */

function CreatorRecap({
  campaignId,
  creators,
  onChanged,
}: {
  campaignId: string;
  creators: WrapCreatorRow[];
  onChanged: () => void;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [granted, setGranted] = useState<readonly string[] | null>(null);

  async function send(associationId: string) {
    setBusy(true);
    setFailure(null);
    try {
      const result = await requestWorkAgain(campaignId, associationId, message);
      setGranted(result.grantsNothing);
      setAsking(null);
      setMessage('');
      onChanged();
    } catch (error: unknown) {
      setFailure(refusalText(error, 'We could not send that request.'));
    } finally {
      setBusy(false);
    }
  }

  if (creators.length === 0) {
    return (
      <section aria-labelledby="wrap-creators">
        <h2 className="h3" id="wrap-creators">
          Your creators
        </h2>
        <p>No creator was recruited to this campaign.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="wrap-creators">
      <h2 className="h3" id="wrap-creators">
        Your creators
      </h2>
      <p className="fd-note">
        Listed by handle. There is no order of merit here and no position — what each of them
        did is on your Explore page, with the definition of every number beside it.
      </p>
      <Absence id="creator_podium" />

      {failure ? <p role="alert">{failure}</p> : null}
      {granted ? (
        <div className="fd-wrap__granted">
          <p>Your request is with them. Accepting it does not create anything:</p>
          <ul className="doc-list">
            {granted.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="fd-wrap__creators">
        {creators.map((creator) => {
          const ask = creator.workAgain.request;
          return (
            <li key={creator.associationId}>
              <Card>
                <p className="fd-wrap__handle">{creator.publicHandle ?? 'Handle not set'}</p>
                {creator.audienceNiche ? (
                  <p className="fd-wrap__niche">{creator.audienceNiche}</p>
                ) : null}
                {creator.adminBio ? <p>{creator.adminBio}</p> : null}

                {/* §22.8's recorded decision, or the honest absence of one. */}
                {creator.completion === null ? (
                  <p className="fd-note">
                    Proovd has not made a completion decision on this partnership yet. Nothing
                    here is waiting on you.
                  </p>
                ) : creator.completion.status === 'successfully_completed' ? (
                  <p>
                    <Tag variant="moss">Completed</Tag>{' '}
                    <span className="fd-wrap__decided">
                      Recorded {localDate(creator.completion.decidedAt)}
                    </span>
                  </p>
                ) : (
                  <p>
                    <Tag>Not completed</Tag>{' '}
                    <span className="fd-wrap__decided">
                      {creator.completion.reason ?? 'Proovd recorded a reason on this decision.'}
                    </span>
                  </p>
                )}

                {ask ? (
                  <p className="fd-note">
                    You asked them to work again on {localDate(ask.requestedAt)} — {ask.status}.
                    {ask.responseNote ? ` “${ask.responseNote}”` : ''}
                  </p>
                ) : creator.workAgain.eligible ? (
                  asking === creator.associationId ? (
                    <>
                      <Field
                        label="What you want to say"
                        hint={WORK_AGAIN_NO_PENALTY}
                        id={`wa-${creator.associationId}`}
                      >
                        <Textarea
                          rows={3}
                          value={message}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setMessage(value);
                          }}
                        />
                      </Field>
                      <Button
                        onClick={() => void send(creator.associationId)}
                        disabled={busy || message.trim() === ''}
                      >
                        Send the request
                      </Button>
                      <Button
                        tier="tertiary"
                        onClick={() => {
                          setAsking(null);
                          setMessage('');
                        }}
                      >
                        Leave it
                      </Button>
                    </>
                  ) : (
                    <Button
                      tier="secondary"
                      onClick={() => {
                        setAsking(creator.associationId);
                        setMessage('');
                      }}
                    >
                      Ask them to work again
                    </Button>
                  )
                ) : (
                  <p className="fd-note">
                    §22.9’s ask opens once Proovd records this partnership as completed.
                  </p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
      <Absence id="work_again_top_three" />
    </section>
  );
}

/* ── The chapter ──────────────────────────────────────────────────────────── */

export function WrapChapter({ campaignId }: { campaignId: string }) {
  const [wrap, setWrap] = useState<FounderWrapView | null>(null);
  const [results, setResults] = useState<FounderResultsView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /*
    Two reads. `wrap` must succeed — it names the campaign's own state and is
    the chapter. `results` carries §21's numbers and answers 404 on a campaign
    that never reached a close batch (a §31.6 cancellation, a §14.6 no-Creator
    failure), which is a state rather than a failure: those campaigns land in
    this chapter with nothing to count, and saying so is not the page breaking.
  */
  const load = useCallback(async () => {
    try {
      const [wrapResult, resultsResult] = await Promise.all([
        fetchFounderWrap(campaignId),
        fetchCampaignResults(campaignId).catch(() => null),
      ]);
      setWrap(wrapResult.wrap);
      setResults(resultsResult?.results ?? null);
    } catch (error: unknown) {
      setFailure(refusalText(error, 'We could not load this campaign.'));
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failure) {
    return (
      <Section aria-labelledby="wrap-error">
        <Measure>
          <h1 className="h2" id="wrap-error">
            We could not load your campaign
          </h1>
          <StatePanel
            state="This page did not load"
            whatHappened={failure}
            next="Reload the page. Everything here is read fresh, so nothing was lost."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: supportMailto(`Campaign wrap — ${campaignId}`) }}
          />
        </Measure>
      </Section>
    );
  }

  if (!wrap) return <SurfaceLoading subject="how the campaign finished" reference={campaignId} />;

  const backers = results?.uniqueBackers ?? null;
  const threshold = results?.threshold ?? null;

  return (
    <Section aria-labelledby="wrap-heading">
      <Measure>
        <p className="kicker">Campaign complete</p>
        <h1 className="h2" id="wrap-heading">
          {backers === null
            ? 'Your campaign is over.'
            : `${String(backers)} ${backers === 1 ? 'person' : 'people'} backed this campaign.`}
        </h1>

        {/* The hero is the count. The money is §21's own figure, read from the
            same payload Chapter 3 renders — one source, two renderers — and it
            links there rather than restating the breakdown. */}
        <div className="fd-wrap__figures">
          {backers !== null ? (
            <Stat
              variant="mint"
              value={String(backers)}
              sub={`${backers === 1 ? 'Backer' : 'Backers'} — people whose pre-order was charged or is still being counted.`}
            />
          ) : null}
          {results ? (
            <Stat
              variant="white"
              value={usd(results.money.totalCapturedCents)}
              sub="Charged — everything captured on this campaign, tax included."
            />
          ) : null}
        </div>

        {/* §4.1: an Idea threshold is a number of Backers, not a dollar amount. */}
        {threshold ? (
          <p className="fd-wrap__threshold">
            {threshold.met
              ? `Threshold met — ${String(threshold.uniqueActiveBackers)} of the ${String(threshold.required)} pre-orders this campaign needed.`
              : `Threshold not met — ${String(threshold.uniqueActiveBackers)} of the ${String(threshold.required)} pre-orders this campaign needed. Nobody was charged.`}
          </p>
        ) : null}
        <Absence id="threshold_in_dollars" />

        {results ? (
          <p>
            <RouterLink to={`/campaigns/${campaignId}/home?chapter=payouts`}>
              The full money breakdown is in Get paid
            </RouterLink>
          </p>
        ) : null}

        {/* §22.11, without an item key in sight. */}
        <section aria-labelledby="wrap-resolution">
          <h2 className="h3" id="wrap-resolution">
            Closing the campaign out
          </h2>
          <StatePanel
            state={wrap.resolution.resolved ? 'Closed out' : 'Proovd is still checking the money'}
            whatHappened={
              wrap.resolution.resolved
                ? `Proovd finished checking this campaign's money on ${localDate(wrap.resolution.resolvedAt)}.`
                : RESOLUTION_IS_PROOVDS_WORK
            }
            next={
              wrap.resolution.resolved
                ? 'Nothing further is needed from you on the money.'
                : 'We will tell you when it is done. Nothing is waiting on you.'
            }
            owner="Proovd"
            nextUpdate={
              wrap.resolution.resolved ? localDate(wrap.resolution.resolvedAt) : 'When Proovd finishes'
            }
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: supportMailto(`Campaign wrap — ${campaignId}`) }}
          />
          {/* §22.11's own sentence: money reconciled is not a reward shipped. */}
          <p className="fd-note">{RESOLUTION_IS_NOT_FULFILLMENT}</p>
          <p>
            {wrap.resolution.fulfilledAt
              ? `You recorded delivery on ${localDate(wrap.resolution.fulfilledAt)}.`
              : wrap.resolution.fulfillmentActive
                ? 'You still owe your backers a delivery. What that means is in Get paid.'
                : 'There is no delivery record on this campaign.'}
          </p>
        </section>

        <CreatorRecap
          campaignId={campaignId}
          creators={wrap.creators}
          onChanged={() => void load()}
        />

        {/* §19's people. Their own page, linked rather than inlined: this is a
            list of individuals with an email each, and it is where the export
            and the §25.7 ask live. */}
        <section aria-labelledby="wrap-backers">
          <h2 className="h3" id="wrap-backers">
            Your backers
          </h2>
          <p>
            Everyone who pre-ordered, what they chose, and what you owe them. The download and
            the withheld columns are on that page.
          </p>
          <p>
            <RouterLink to={founderBackersPath(campaignId)}>Open your backers</RouterLink>
          </p>
        </section>

        {/* §22.10, exactly as Phase 21b built it: two gates, two panels. */}
        <NextCampaign view={wrap.nextCampaign} />

        <Absence id="delete_account_destructive" />
        <Absence id="auto_wrap_advance" />
      </Measure>
    </Section>
  );
}

export default WrapChapter;
