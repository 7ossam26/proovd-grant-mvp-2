/**
 * Admin — the §31.9 first-cohort scoreboard (Phase 23b).
 *
 * ── A baseline is a state before it is a number ─────────────────────────────
 * §33.12.6: "First 10 invited Founders establish the explicitly labeled
 * baseline for the four Founder scoreboard metrics; no invented baseline
 * exists." So the four cards render `not measured` — the Spec's own words,
 * unparaphrased, read from the server rather than composed here — until ten
 * Founders have been invited, with the reason and the count beside it so the
 * reader can see how far off the baseline is.
 *
 * There is no bar, no sparkline, and no arrow. A trend needs two baselines and
 * there is not yet one; drawing a line through four points would be inventing
 * the thing §33.12.6 forbids, in a nicer typeface.
 *
 * ── The two kinds of nothing are kept apart ─────────────────────────────────
 * `cohort_incomplete` says it is too early to know. `no_observations` says the
 * cohort is whole and nobody has done this yet. §16a's "not yet populated is
 * not zero", one surface later — and the reason a rate over an empty
 * denominator is never rendered as 0%.
 *
 * ── Every number carries its definition ─────────────────────────────────────
 * §20's last Explore bullet, applied here for the same reason: two people
 * reading "completion" differently is the ordinary failure of a metrics screen.
 * The definition, the numerator, and the denominator ride each card.
 *
 * ── There is nothing to press ───────────────────────────────────────────────
 * No route writes here and no control on this page submits anything. §33.12.6's
 * "no invented baseline exists" is strongest as an absence: not a rule a service
 * enforces, but a surface with nowhere to record one.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { FOUNDER_SCOREBOARD, NEVER_EXCLUDED } from '@proovd/shared';
import { Card } from '../../components/index.js';
import {
  AdminRequestError,
  fetchScoreboard,
  type MetricValue,
  type Scoreboard,
} from './api.js';

/** How a value reads. Nothing here rounds a rate into a story. */
function renderValue(value: MetricValue, notMeasuredLabel: string): ReactNode {
  if (value.state === 'not_measured') {
    return (
      <>
        <p className="ops-value ops-value--muted">{notMeasuredLabel}</p>
        <p className="field-hint">
          {value.reason === 'cohort_incomplete'
            ? `${value.invitedFounders} of ${value.cohortSize} invited Founders so far. The baseline is set once the first cohort is complete.`
            : value.reason === 'no_observations'
              ? 'The first cohort is complete and nothing has been observed for this metric yet.'
              : `This metric has no recorded input${value.missingInput ? `: ${value.missingInput}` : ''}.`}
        </p>
      </>
    );
  }

  if (value.unit === 'median_hours') {
    const shown =
      value.value < 48 ? `${value.value.toFixed(1)} hours` : `${(value.value / 24).toFixed(1)} days`;
    return (
      <>
        <p className="ops-value">{shown}</p>
        <p className="field-hint">
          Median across {value.observations} observation{value.observations === 1 ? '' : 's'}.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="ops-value">{`${Math.round(value.value * 1000) / 10}%`}</p>
      <p className="field-hint">
        {value.numerator} of {value.denominator}.
      </p>
    </>
  );
}

export function MeasurementPage() {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; board: Scoreboard }
  >({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', board: await fetchScoreboard() });
    } catch (error) {
      setState({
        status: 'error',
        message:
          error instanceof AdminRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'The scoreboard could not be read.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="admin-workspace">
      <header className="ops-block">
        <h1>First-cohort measurement</h1>
        <p className="field-hint">
          The four §31.9 Founder metrics, computed on this request from records other parts of the
          product already keep. Nothing is stored here and there is no way to record a baseline by
          hand.
        </p>
      </header>

      {state.status === 'loading' && <Card>Computing the metrics…</Card>}

      {state.status === 'error' && (
        <Card>
          <h2>The scoreboard could not be read</h2>
          <p>{state.message}</p>
          <p className="field-hint">
            Nothing was changed. Every number here is derived on read, so nothing was lost.
          </p>
        </Card>
      )}

      {state.status === 'ready' && (
        <>
          <Card>
            <h2>
              {state.board.baselineEstablished
                ? 'Baseline established'
                : `Baseline: ${state.board.notMeasuredLabel}`}
            </h2>
            <p>
              {state.board.invitedFounders} of {state.board.cohortSize} invited Founders.
            </p>
            <p className="field-hint">
              §33.12.6: the first {state.board.cohortSize} invited Founders establish the baseline.
              Until then the four metrics below read “{state.board.notMeasuredLabel}”, because a
              number computed over four Founders is indistinguishable from a cohort that completed
              and failed.
            </p>
          </Card>

          {state.board.metrics.map((entry) => {
            const definition = FOUNDER_SCOREBOARD.find((metric) => metric.key === entry.key);
            return (
              <Card key={entry.key}>
                <div className="ops-head">
                  <h2>{definition?.label ?? entry.key}</h2>
                </div>
                {renderValue(entry.value, state.board.notMeasuredLabel)}
                <p className="field-hint">{definition?.definition}</p>
                {definition?.unit === 'rate' && (
                  <dl className="kv">
                    <dt>Counted</dt>
                    <dd>{definition.numerator}</dd>
                    <dt>Out of</dt>
                    <dd>{definition.denominator}</dd>
                  </dl>
                )}
              </Card>
            );
          })}

          <Card>
            <h2>What these numbers never leave out</h2>
            <p className="field-hint">
              §33.12.7. Every denominator above keeps all three in — a journey that needed support is
              still a journey, and a campaign that ended without a charge is still a campaign.
            </p>
            <dl className="kv">
              {NEVER_EXCLUDED.map((entry) => (
                <div key={entry.key}>
                  <dt>{entry.key.replace(/_/g, ' ')}</dt>
                  <dd>{entry.definition}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <h2>Also tracked</h2>
            <p className="field-hint">
              §31.9’s secondary set, as observed counts rather than as a baseline. An entry with no
              recorded input says so rather than showing a zero.
            </p>
            <dl className="kv">
              {state.board.secondary.map((entry) => (
                <div key={entry.key}>
                  <dt>{entry.label}</dt>
                  <dd>
                    {entry.count === null ? 'Not recorded' : entry.count}
                    {entry.absentBecause ? (
                      <span className="field-hint"> — {entry.absentBecause}</span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </>
      )}
    </section>
  );
}
