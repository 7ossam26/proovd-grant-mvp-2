/**
 * Users → Founders — Spec §26.1, §7.
 *
 * The list, and the form that creates a prospect with its campaign container.
 *
 * ── Density is licensed, staging is not repealed ────────────────────────────
 * §26 permits a dashboard here and nowhere else, so this is a table. DNA §5.14
 * still applies: the row shows who, what, where it stands, and when the
 * retention window closes — the rest of §26.1 lives on the detail surface one
 * gesture away, rather than in forty columns nobody reads.
 *
 * ── What Admin may record, and what it may not ──────────────────────────────
 * §7 lets Admin record the product, launch frame, US/18+ fit, delivery
 * feasibility, early compensation expectations, and the Creator-sourcing
 * hypothesis. It forbids promising acceptance, results, reward pricing, or a
 * named Creator's participation — so there is no field for any of those, and
 * the labels below say "hypothesis" and "expectations" rather than anything
 * that reads as a commitment.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link as RouterLink } from 'react-router';
import { Button, Card, Field, Input, StatePanel, Tag, Textarea } from '../../components/index.js';
import {
  fetchFounders,
  createProspect,
  AdminRequestError,
  type FounderRow,
} from './api.js';

const STATUS_LABEL: Record<FounderRow['status'], string> = {
  draft: 'Not sent',
  sent: 'Invitation sent',
  revoked: 'Revoked',
  claimed: 'Claimed',
  expired: 'Anonymised',
};

export function FoundersPage() {
  const [founders, setFounders] = useState<FounderRow[] | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    fetchFounders()
      .then(({ founders: rows }) => setFounders(rows))
      .catch((error: unknown) => {
        if (error instanceof AdminRequestError) setLoadError(error);
      });
  }, []);

  useEffect(load, [load]);

  if (loadError) {
    return (
      <StatePanel
        state={loadError.detail.title}
        whatHappened={loadError.detail.whatHappened ?? 'The Founders list could not be read.'}
        next={loadError.detail.next ?? 'Reload the page to try again.'}
        owner="Proovd"
        nextUpdate="When you reload"
        action={
          <Button tier="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
        reference="Admin · Founders"
        ring
      />
    );
  }

  if (!founders) {
    return (
      <StatePanel
        state="Loading Founders"
        whatHappened="Proovd is reading every prospect and invited draft."
        next="The list appears as soon as it arrives."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Founders"
      />
    );
  }

  return (
    <div className="admin-page">
      <header className="admin-page__head">
        <h1>Founders</h1>
        <p className="admin-page__lede">
          Every Founder prospect discovered off-platform, the invitation they were sent,
          and where it stands. There is no public signup — an account exists only because
          someone here invited it.
        </p>
        <Button
          tier={creating ? 'tertiary' : 'primary'}
          aria-expanded={creating}
          onClick={() => setCreating((was) => !was)}
        >
          {creating ? 'Cancel' : 'Create a prospect'}
        </Button>
      </header>

      {creating ? (
        <NewProspectForm
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      ) : null}

      {founders.length === 0 ? (
        <StatePanel
          state="No Founder prospects yet"
          whatHappened="Nobody has been recorded from off-platform discovery."
          next="Create a prospect when you have someone to invite. Nothing is sent until you compose the invitation and send it."
          owner="You"
          nextUpdate="No update is pending"
          action="No action needed"
          reference="Admin · Founders"
        />
      ) : (
        <div className="admin-table-scroll">
          <table className="admin-table">
            <caption className="admin-table__caption">
              {founders.length} Founder prospect{founders.length === 1 ? '' : 's'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Founder</th>
                <th scope="col">Product</th>
                <th scope="col">Invitation</th>
                <th scope="col">Last sent</th>
                <th scope="col">Anonymised on</th>
                <th scope="col">Source</th>
                <th scope="col">Owner</th>
              </tr>
            </thead>
            <tbody>
              {founders.map((row) => (
                <tr key={row.draftId}>
                  <th scope="row">
                    <RouterLink to={`/admin/founders/${row.draftId}`}>
                      {row.legalName ?? 'Anonymised'}
                    </RouterLink>
                    <span className="admin-table__sub">{row.email ?? '—'}</span>
                  </th>
                  <td>{row.productName ?? '—'}</td>
                  <td>
                    <Tag variant={row.status === 'sent' ? 'live' : 'sage'}>
                      {STATUS_LABEL[row.status]}
                    </Tag>
                  </td>
                  <td>
                    <When value={row.lastSentAt} />
                  </td>
                  <td>
                    {/* §25.8's clock, shown as a date rather than a countdown —
                        §30 forbids countdown pressure, and this is Admin's
                        deadline to act, not a customer's. */}
                    {row.anonymisedAt ? (
                      <span className="admin-table__sub">Already anonymised</span>
                    ) : (
                      <When value={row.retentionDueAt} />
                    )}
                  </td>
                  <td>{row.invitationSource ?? '—'}</td>
                  <td>{row.internalOwner ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Local time primary, UTC secondary (§27.1). */
export function When({ value }: { value: string | null }) {
  if (!value) return <>—</>;
  const at = new Date(value);
  return (
    <time dateTime={value}>
      {at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}{' '}
      <span className="utc">
        ({at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })}{' '}
        UTC)
      </span>
    </time>
  );
}

function NewProspectForm({ onCreated }: { onCreated: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: string) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  const required = ['legalName', 'email', 'productName', 'invitationSource', 'internalOwner'];
  const complete = required.every((key) => (values[key] ?? '').trim().length > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createProspect({
        legalName: values['legalName']!.trim(),
        preferredName: values['preferredName']?.trim() || undefined,
        email: values['email']!.trim(),
        phone: values['phone']?.trim() || undefined,
        productName: values['productName']!.trim(),
        productUrl: values['productUrl']?.trim() || undefined,
        launchFrame: values['launchFrame']?.trim() || undefined,
        usAgeFit: values['usAgeFit']?.trim() || undefined,
        deliveryFeasibility: values['deliveryFeasibility']?.trim() || undefined,
        compensationExpectations: values['compensationExpectations']?.trim() || undefined,
        affiliateSourcingHypothesis:
          values['affiliateSourcingHypothesis']?.trim() || undefined,
        adminNotes: values['adminNotes']?.trim() || undefined,
        discoveryEvidence: (values['discoveryEvidence'] ?? '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        invitationSource: values['invitationSource']!.trim(),
        internalOwner: values['internalOwner']!.trim(),
      });
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof AdminRequestError
          ? (caught.detail.whatHappened ?? caught.detail.title)
          : 'That prospect could not be created. Nothing has been saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="admin-form-card">
      <form className="admin-form admin-form--wide" onSubmit={submit} noValidate>
        <h2>New Founder prospect</h2>
        <p className="admin-form__note">
          Creating a prospect also creates the campaign container. Nothing is sent — the
          invitation is composed, previewed, and sent separately.
        </p>

        <Field label="Legal name">
          <Input value={values['legalName'] ?? ''} onChange={set('legalName')} required />
        </Field>
        <Field label="Preferred name" hint="What the invitation will call them.">
          <Input value={values['preferredName'] ?? ''} onChange={set('preferredName')} />
        </Field>
        <Field label="Email address">
          <Input type="email" value={values['email'] ?? ''} onChange={set('email')} required />
        </Field>
        <Field
          label="Phone, if known"
          hint="Stored so support can call. Proovd never verifies a phone number and never sends codes to one."
        >
          <Input type="tel" value={values['phone'] ?? ''} onChange={set('phone')} />
        </Field>
        <Field label="Product or startup name">
          <Input value={values['productName'] ?? ''} onChange={set('productName')} required />
        </Field>
        <Field label="Product URL">
          <Input type="url" value={values['productUrl'] ?? ''} onChange={set('productUrl')} />
        </Field>
        <Field label="Launch frame" hint="Roughly when they are hoping to launch.">
          <Input value={values['launchFrame'] ?? ''} onChange={set('launchFrame')} />
        </Field>
        <Field label="US and 18+ fit" hint="What you established, and how.">
          <Input value={values['usAgeFit'] ?? ''} onChange={set('usAgeFit')} />
        </Field>
        <Field label="Delivery feasibility">
          <Textarea rows={2} value={values['deliveryFeasibility'] ?? ''} onChange={set('deliveryFeasibility')} />
        </Field>
        <Field
          label="Early compensation expectations"
          hint="What they said they expect. Not an agreement, and not a price."
        >
          <Textarea rows={2} value={values['compensationExpectations'] ?? ''} onChange={set('compensationExpectations')} />
        </Field>
        <Field
          label="Creator-sourcing hypothesis"
          hint="Where you think Creators for this campaign would come from. A hypothesis, never a commitment that a named Creator will take it on."
        >
          <Textarea rows={2} value={values['affiliateSourcingHypothesis'] ?? ''} onChange={set('affiliateSourcingHypothesis')} />
        </Field>
        <Field label="Invitation source">
          <Input value={values['invitationSource'] ?? ''} onChange={set('invitationSource')} required />
        </Field>
        <Field label="Internal campaign owner">
          <Input value={values['internalOwner'] ?? ''} onChange={set('internalOwner')} required />
        </Field>
        <Field label="Admin notes">
          <Textarea rows={3} value={values['adminNotes'] ?? ''} onChange={set('adminNotes')} />
        </Field>
        <Field label="Discovery evidence" hint="One link per line.">
          <Textarea rows={2} value={values['discoveryEvidence'] ?? ''} onChange={set('discoveryEvidence')} />
        </Field>

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={!complete || busy}>
          {busy ? 'Creating…' : 'Create prospect and campaign'}
        </Button>
      </form>
    </Card>
  );
}
