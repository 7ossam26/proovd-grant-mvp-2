/**
 * Admin — the §31.7 risk-control inventory.
 *
 * Ten signals, computed live on every read. §31.7's opening words are "Before
 * close and throughout live operations", so this is not a close-time report.
 *
 * ── Three states, not two ───────────────────────────────────────────────────
 * A signal is **found** (a count with instances), **clear** (evaluated, found
 * nothing), or **not yet observable** (the phase that produces its input has not
 * run). The third is the one that matters: rendering "no risk found" for a Radar
 * check that cannot run until Phase 18 creates PaymentIntents would be §1.4's
 * failure — implying an answer the system does not have.
 *
 * ── The zero that is not a clean result ─────────────────────────────────────
 * §31.7: "zero tax caused by missing collection configuration is not treated as
 * proof that no tax is due." `not_collecting` renders as a blocking risk with
 * that sentence beside it, and there is no view in which it reads as clear.
 *
 * Nothing here is scored or summed. §1 rule 6 forbids inventing an eligibility
 * condition, and a risk index is exactly that with arithmetic in front of it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { RISK_SIGNALS, SELLER_TAX_READINESS_FACTS } from '@proovd/shared';
import { Button, Card, Field, Input, Tag } from '../../components/index.js';
import {
  fetchRiskPanel,
  recordSellerTaxReadiness,
  AdminRequestError,
  type RiskPanelState,
} from './api.js';

/** Severity is about what a signal blocks, never about how alarming it sounds. */
const TONE: Record<string, 'live' | 'sage' | 'default'> = {
  blocking: 'live',
  review: 'sage',
  monitor: 'default',
};

export function RiskPanelPage() {
  const [params] = useSearchParams();
  const campaignId = params.get('campaign') ?? '';
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; panel: RiskPanelState }
  >({ status: 'loading' });

  const [facts, setFacts] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState('');
  const [saveState, setSaveState] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', panel: await fetchRiskPanel(campaignId || undefined) });
    } catch (error) {
      setState({
        status: 'error',
        message:
          error instanceof AdminRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'The risk inventory could not be read.',
      });
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const record = async () => {
    setSaveState(null);
    try {
      const result = await recordSellerTaxReadiness(campaignId, {
        headOfficeLocationDetail: facts['head_office_location'] ?? '',
        productTaxCodeDetail: facts['product_tax_code'] ?? '',
        registrationDetail: facts['registration'] ?? '',
        providerTaxSettingsDetail: facts['provider_tax_settings'] ?? '',
        evidenceReference: evidence,
      });
      setSaveState(
        result.ready
          ? 'Recorded. All four §31.7 facts are present.'
          : `Recorded. Still outstanding: ${result.missingFacts.join(', ')}.`,
      );
      await load();
    } catch (error) {
      setSaveState(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'That could not be recorded. Nothing has changed.',
      );
    }
  };

  return (
    <section className="admin-workspace">
      <header className="ops-block">
        <h1>Risk controls</h1>
        <p className="field-hint">
          The ten signals §31.7 names, recomputed on every read.
          {campaignId ? ' Scoped to one campaign.' : ' Across every campaign.'}
        </p>
      </header>

      {state.status === 'loading' && <Card>Computing the signals…</Card>}

      {state.status === 'error' && (
        <Card>
          <h2>The risk inventory could not be read</h2>
          <p>{state.message}</p>
          <p className="field-hint">Nothing was changed.</p>
        </Card>
      )}

      {state.status === 'ready' && (
        <>
          {state.panel.blockingKeys.length > 0 && (
            <Card>
              <h2>Blocking signals</h2>
              <p>
                {state.panel.blockingKeys.length} signal
                {state.panel.blockingKeys.length === 1 ? '' : 's'} must be resolved before this
                proceeds.
              </p>
              <ul>
                {state.panel.blockingKeys.map((key) => (
                  <li key={key}>{RISK_SIGNALS.find((s) => s.key === key)?.label ?? key}</li>
                ))}
              </ul>
            </Card>
          )}

          {state.panel.signals.map((signal) => {
            const definition = RISK_SIGNALS.find((s) => s.key === signal.key);
            return (
              <Card key={signal.key}>
                <div className="ops-head">
                  <h2>{definition?.label ?? signal.key}</h2>
                  <div className="ops-tags">
                    <Tag variant={TONE[signal.severity] ?? 'default'}>{signal.severity}</Tag>
                    <Tag>{definition?.specRef ?? '§31.7'}</Tag>
                  </div>
                </div>

                {/* Three states, and the third is why this is not a boolean. */}
                {signal.notYetObservable ? (
                  <p>
                    <strong>Not yet observable.</strong>{' '}
                    <span className="field-hint">
                      The records this reads do not exist yet, so nothing has been checked. This is
                      not the same as finding nothing.
                    </span>
                  </p>
                ) : signal.count === 0 ? (
                  <p>
                    <strong>Checked — nothing found.</strong>
                  </p>
                ) : (
                  <div className="ops-block">
                    <p>
                      <strong>
                        {signal.count} found
                      </strong>
                    </p>
                    <ul>
                      {signal.instances.map((instance) => (
                        <li key={instance.id}>
                          <code>{instance.id}</code> — {instance.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="field-hint">{definition?.detects}</p>
                <p className="field-hint">
                  <strong>What to do:</strong> {definition?.action}
                </p>
              </Card>
            );
          })}

          {/* §31.7's closing paragraph — a gate, not a signal. Four facts, all four. */}
          {campaignId && (
            <Card>
              <div className="ops-head">
                <h2>Founder seller tax readiness</h2>
                <Tag variant={state.panel.sellerTaxReadiness.ready ? 'mint' : 'live'}>
                  {state.panel.sellerTaxReadiness.ready ? 'Ready' : 'Not ready'}
                </Tag>
              </div>

              <p className="field-hint">
                §31.7 requires all four before live tax collection. Three of four does not make a
                campaign ready.
              </p>

              {state.panel.sellerTaxReadiness.recorded && (
                <p className="field-hint">
                  Recorded by {state.panel.sellerTaxReadiness.recordedBy} on{' '}
                  {state.panel.sellerTaxReadiness.recordedAt?.slice(0, 10)}. Evidence:{' '}
                  {state.panel.sellerTaxReadiness.evidenceReference}
                </p>
              )}

              <div className="admin-workspace">
                {SELLER_TAX_READINESS_FACTS.map((fact) => {
                  const outstanding = state.panel.sellerTaxReadiness.missingFacts.includes(fact.key);
                  return (
                    <Field
                      key={fact.key}
                      label={`${fact.label}${outstanding ? ' — outstanding' : ''}`}
                      hint={fact.requirement}
                    >
                      <Input
                        value={facts[fact.key] ?? ''}
                        onChange={(e) =>
                          setFacts((current) => ({ ...current, [fact.key]: e.target.value }))
                        }
                        placeholder="What was verified"
                      />
                    </Field>
                  );
                })}

                <Field
                  label="Evidence reference"
                  hint="§34's 'recorded as complete' — where the verification lives."
                >
                  <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="https://…" />
                </Field>

                <div className="claim__actions">
                  <Button onClick={() => void record()}>Record readiness</Button>
                </div>

                {saveState && <p>{saveState}</p>}

                <p className="field-hint">
                  Recording supersedes the previous record rather than editing it — the earlier one
                  is the basis on which anything relying on it acted, so it stays as history.
                </p>
              </div>
            </Card>
          )}
        </>
      )}
    </section>
  );
}
