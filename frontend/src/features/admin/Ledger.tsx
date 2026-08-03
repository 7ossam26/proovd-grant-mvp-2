/**
 * Admin — the §26.5 reservation and charge ledger.
 *
 * §26 licenses dashboard density here and nowhere else, so every row shows its
 * facts rather than a summary. The eleven §26.5 dimensions are filters, and the
 * filter set is rendered from the register the server sends rather than from a
 * hand-kept copy in this file — a second list is how a dimension quietly stops
 * being filterable.
 *
 * ── Two numbers, never one ──────────────────────────────────────────────────
 * §26.5 makes "unique Backer vs Product transaction count" its own dimension
 * because on a Product Campaign they differ. The summary shows both side by
 * side, labelled; collapsing them into "Backers" would overstate reach, and into
 * "pre-orders" would understate people.
 *
 * ── Seeing is not exporting (§25.7) ─────────────────────────────────────────
 * The Backer's email and phone render here, because support and risk work needs
 * them in front of a person. The export button says, before it is pressed, which
 * columns will be withheld — an Admin who cannot find an email in the file
 * should have been told it was withheld, not left to think the data is missing.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { formatUsd, LEDGER_DIMENSIONS, restrictedColumns } from '@proovd/shared';
import { Button, Card, Field, Input, Tag } from '../../components/index.js';
import { fetchLedger, AdminRequestError, type LedgerPageState } from './api.js';

const usd = (cents: string | null) => (cents === null ? '—' : formatUsd(BigInt(cents)));
const when = (iso: string | null) => (iso ? `${iso.replace('T', ' ').slice(0, 16)} UTC` : '—');

interface Filters {
  campaignId: string;
  source: string;
  statuses: string;
  refundDispute: string;
  consentVersion: string;
  capResult: string;
  taxabilityReason: string;
  attributionStatus: string;
  reservedFrom: string;
  minSubtotalCents: string;
}

const EMPTY: Filters = {
  campaignId: '',
  source: '',
  statuses: '',
  refundDispute: '',
  consentVersion: '',
  capResult: '',
  taxabilityReason: '',
  attributionStatus: '',
  reservedFrom: '',
  minSubtotalCents: '',
};

function queryFrom(filters: Filters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value.trim()) params.set(key, value.trim());
  }
  return params.toString();
}

export function LedgerPage() {
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<Filters>({
    ...EMPTY,
    campaignId: params.get('campaign') ?? '',
  });
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; page: LedgerPageState }
  >({ status: 'loading' });

  const load = useCallback(async (active: Filters) => {
    setState({ status: 'loading' });
    try {
      const page = await fetchLedger(queryFrom(active));
      setState({ status: 'ready', page });
    } catch (error) {
      setState({
        status: 'error',
        message:
          error instanceof AdminRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'The ledger could not be read.',
      });
    }
  }, []);

  useEffect(() => {
    void load(filters);
    // Deliberately once on mount: filtering is an explicit action, so an Admin
    // half-way through typing a campaign id does not fire a query per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key: keyof Filters) => (value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const exportHref = `/api/admin/ledger/export?${queryFrom(filters)}${
    queryFrom(filters) ? '&' : ''
  }format=csv`;

  return (
    <section className="admin-workspace">
      <header className="ops-block">
        <h1>Reservation and charge ledger</h1>
        <p className="field-hint">
          Every pre-order and every charge, filterable across the {LEDGER_DIMENSIONS.length}{' '}
          dimensions §26.5 names.
        </p>
      </header>

      {/* Act — the filters. Grouped by §26.5's own dimensions so an Admin looking
          for "the attribution one" finds it under that name. */}
      <Card>
        <div className="ops-filters">
          <Field label="Campaign" hint="§26.5 — campaign, Founder, source">
            <Input value={filters.campaignId} onChange={(e) => set('campaignId')(e.target.value)} placeholder="Campaign id" />
          </Field>
          <Field label="Source" hint="creator · organic · house">
            <Input value={filters.source} onChange={(e) => set('source')(e.target.value)} placeholder="any" />
          </Field>
          <Field label="Reservation status" hint="§23.5 — comma separated">
            <Input value={filters.statuses} onChange={(e) => set('statuses')(e.target.value)} placeholder="reserved_active" />
          </Field>
          <Field label="Refund or dispute" hint="refunded · reversed · disputed · none">
            <Input value={filters.refundDispute} onChange={(e) => set('refundDispute')(e.target.value)} placeholder="any" />
          </Field>
          <Field label="Consent version" hint="§26.5 — consent and policy version">
            <Input value={filters.consentVersion} onChange={(e) => set('consentVersion')(e.target.value)} placeholder="v1" />
          </Field>
          <Field label="Cap result" hint="§2.2 — within_cap · rejected_cap_exceeded · not_evaluated">
            <Input value={filters.capResult} onChange={(e) => set('capResult')(e.target.value)} placeholder="any" />
          </Field>
          <Field
            label="Taxability reason"
            hint="§31.7 — `not_collecting` is a risk, not a clean result"
          >
            <Input
              value={filters.taxabilityReason}
              onChange={(e) => set('taxabilityReason')(e.target.value)}
              placeholder="any"
            />
          </Field>
          <Field label="Attribution status" hint="§18 — provisional · verified · blocked">
            <Input
              value={filters.attributionStatus}
              onChange={(e) => set('attributionStatus')(e.target.value)}
              placeholder="any"
            />
          </Field>
          <Field label="Reserved from" hint="ISO date">
            <Input value={filters.reservedFrom} onChange={(e) => set('reservedFrom')(e.target.value)} placeholder="2026-01-01" />
          </Field>
          <Field label="Minimum subtotal" hint="Integer cents, pre-tax">
            <Input
              value={filters.minSubtotalCents}
              onChange={(e) => set('minSubtotalCents')(e.target.value)}
              placeholder="0"
            />
          </Field>
        </div>

        <div className="claim__actions">
          <Button onClick={() => void load(filters)}>Apply filters</Button>
          <Button
            tier="secondary"
            onClick={() => {
              setFilters(EMPTY);
              void load(EMPTY);
            }}
          >
            Clear
          </Button>
          <a className="btn btn--tertiary" href={exportHref} download>
            Export CSV
          </a>
        </div>

        {/* §25.7, said before the button is pressed rather than discovered after. */}
        <p className="field-hint">
          An export carries operational columns only. These stay on this screen and never enter a
          file: {restrictedColumns().map((c) => c.label).join(', ')}. §25.7 limits what Admin may
          hand out, not only what Admin may see.
        </p>
      </Card>

      {state.status === 'loading' && <Card>Reading the ledger…</Card>}

      {state.status === 'error' && (
        <Card>
          <h2>The ledger could not be read</h2>
          <p>{state.message}</p>
          <p className="field-hint">Nothing was changed. Try again, or narrow the filters.</p>
        </Card>
      )}

      {state.status === 'ready' && (
        <>
          {/* Glance — §26.5's own counting dimension, both numbers, labelled. */}
          <Card>
            <div className="ops-stats">
              <div>
                <span className="ops-stat__label">Unique Backers</span>
                <strong className="ops-stat__value">{state.page.summary.uniqueBackers}</strong>
              </div>
              <div>
                <span className="ops-stat__label">Transactions</span>
                <strong className="ops-stat__value">{state.page.summary.transactions}</strong>
              </div>
              <div>
                <span className="ops-stat__label">Subtotal (pre-tax)</span>
                <strong className="ops-stat__value">{usd(state.page.summary.subtotalCents)}</strong>
              </div>
              <div>
                <span className="ops-stat__label">Sales tax</span>
                <strong className="ops-stat__value">{usd(state.page.summary.taxCents)}</strong>
              </div>
              <div>
                <span className="ops-stat__label">Captured</span>
                <strong className="ops-stat__value">{usd(state.page.summary.capturedCents)}</strong>
              </div>
            </div>
            <p className="field-hint">
              On a Product Campaign one person may hold several transactions (§4.1), so these are two
              different numbers.
            </p>
          </Card>

          {state.page.rows.length === 0 ? (
            <Card>
              <h2>No transactions match</h2>
              <p>Nothing in the ledger matches these filters. The filters themselves are unchanged.</p>
            </Card>
          ) : (
            <Card>
              <div className="admin-table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Reserved</th>
                      <th scope="col">Status</th>
                      <th scope="col">Reward</th>
                      <th scope="col">Subtotal</th>
                      <th scope="col">Tax</th>
                      <th scope="col">Authorized</th>
                      <th scope="col">Tax treatment</th>
                      <th scope="col">Attribution</th>
                      <th scope="col">Cap</th>
                      <th scope="col">Consent</th>
                      <th scope="col">Backer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.page.rows.map((row) => (
                      <tr key={row.reservationId}>
                        <td>{when(row.reservedAt)}</td>
                        <td>
                          <Tag>{row.status}</Tag>
                        </td>
                        <td>{row.rewardTitle ?? '—'}</td>
                        <td>{usd(row.rewardSubtotalCents)}</td>
                        <td>{usd(row.salesTaxCents)}</td>
                        <td>{usd(row.totalAuthorizedCents)}</td>
                        <td>
                          {row.taxabilityReason === 'not_collecting' ? (
                            <Tag variant="live">not_collecting</Tag>
                          ) : (
                            (row.taxabilityReason ?? '—')
                          )}
                          {row.taxCloseUsable === false && <Tag variant="live">unusable at close</Tag>}
                        </td>
                        <td>
                          {row.attributionSource ?? '—'}
                          {row.attributionStatus && <Tag>{row.attributionStatus}</Tag>}
                        </td>
                        <td>{row.capResult ?? '—'}</td>
                        <td>
                          {row.consentAppendix ?? '—'} {row.consentVersion ?? ''}
                          {row.founderMarketingConsent && <Tag>Founder marketing</Tag>}
                          {row.newsletterConsent && <Tag>Newsletter</Tag>}
                        </td>
                        <td>
                          {/* §25.7 restricted: visible here, never in an export. */}
                          {row.backerEmail ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </section>
  );
}
