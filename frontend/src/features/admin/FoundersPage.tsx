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
 * ── Two acts, two surfaces ──────────────────────────────────────────────────
 * §7 describes creating a prospect after off-platform discovery, and then
 * separately lists what "the invitation-creation surface contains". This form
 * is the first act: what a discovery conversation actually produces — who they
 * are, their company, and the problem and solution they described. The rest of
 * §7's list — the invitation source, the internal campaign owner, the launch
 * frame, notes, evidence — lives on the draft surface beside the message it
 * feeds, and Send stays closed until it is there.
 *
 * ── Problem and Solution are §9 prefills, not fields of this record ──────────
 * §9 has Proovd draft those two from discovery for the Founder to review and
 * edit, so they are written through `prefillVetting` with its provenance
 * intact: they land in the Founder's own boxes only while untouched, and a
 * later Admin edit never overwrites words the Founder has since typed.
 *
 * ── The two boxes this form will keep being asked for, and must not grow ────
 * **Competition.** §9 Step 4 is three sentences: "Always blank. Written by the
 * Founder. Must never be prefilled or represented as AI-generated." §33.1.5
 * tests it, `campaign_vetting` has no `competition_prefilled_*` column to write
 * into, and a CHECK pins `competition_supplier` to `founder` so even a
 * hand-written UPDATE cannot record it as ours. It is the one answer that
 * proves the Founder did their own thinking.
 *
 * **The campaign Story.** §12 makes it one of five optional items, and each
 * objective completion takes US$2 off the listing fee — so an Admin-written
 * story here would be Proovd's content earning the Founder a discount. §12 also
 * says a "transcript, generated summary, or unapproved draft does not count":
 * the Founder's approval IS the completing act, and there is nobody else who
 * can perform it.
 *
 * Both are real things to learn on a discovery call, so both belong in the
 * notes — internal, never rendered to the Founder, never read by the §9 prefill
 * or the §12 evaluation. That is the difference between recording what we heard
 * and answering on their behalf.
 *
 * That gate is real rather than a convention. An empty product name renders as
 * `[PRODUCT NAME]` and the marker check refuses the send; the invitation source
 * and campaign owner never reach the Founder, so `missingInvitationFields`
 * checks those two by name. Demanding all of it here did not make the record
 * more complete — it made an Admin type something into `invitationSource` to
 * get past a form, which is a worse record than an honestly incomplete one.
 *
 * ── What Admin may record, and what it may not ──────────────────────────────
 * §7 lets Admin record the product, launch frame, US/18+ fit, delivery
 * feasibility, early compensation expectations, and the Creator-sourcing
 * hypothesis. It forbids promising acceptance, results, reward pricing, or a
 * named Creator's participation — so there is no field for any of those on
 * either surface, and the labels say "hypothesis" and "expectations" rather
 * than anything that reads as a commitment.
 *
 * ── The last-contact date is not a follow-up ────────────────────────────────
 * It records a conversation that happened. There is no next-contact field, no
 * recurrence, and no job that reads it — §30 forbids automated engagement
 * sequences, and having nowhere to put a cadence is what keeps it that way.
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

  const required = ['legalName', 'email'];
  const complete = required.every((key) => (values[key] ?? '').trim().length > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createProspect({
        legalName: values['legalName']!.trim(),
        email: values['email']!.trim(),
        // A date input gives `YYYY-MM-DD` with no zone. Sent as-is; the server
        // reads it as an instant. It records a day somebody spoke to someone,
        // which is what §7's discovery record is for — not a deadline, so
        // there is nothing here for §29.6's calendar rules to govern.
        lastContactAt: values['lastContactAt']?.trim() || undefined,
        productName: values['productName']?.trim() || undefined,
        problem: values['problem']?.trim() || undefined,
        solution: values['solution']?.trim() || undefined,
        adminNotes: values['adminNotes']?.trim() || undefined,
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
          What you learned from the conversation. Creating a prospect also creates the
          campaign container. Nothing is sent — the invitation source, the campaign owner,
          and the message itself are filled in on the draft, where you compose and preview
          before sending.
        </p>

        <Field label="Founder name">
          <Input value={values['legalName'] ?? ''} onChange={set('legalName')} required />
        </Field>
        <Field label="Founder email">
          <Input type="email" value={values['email'] ?? ''} onChange={set('email')} required />
        </Field>
        <Field label="Company or product name">
          <Input value={values['productName'] ?? ''} onChange={set('productName')} />
        </Field>
        <Field
          label="Last time we spoke"
          hint="The day of the last conversation, if there was one. A record, not a reminder — Proovd never follows up on its own."
        >
          <Input type="date" value={values['lastContactAt'] ?? ''} onChange={set('lastContactAt')} />
        </Field>

        <p className="admin-form__note">
          §9 has Proovd draft the Problem and the Solution from what we learned; the Founder
          reviews and edits them in their own words. Once they have edited a field, a later
          edit here only updates our original — their words are never overwritten.
        </p>
        <Field label="Problem">
          <Textarea rows={4} value={values['problem'] ?? ''} onChange={set('problem')} />
        </Field>
        <Field label="Solution">
          <Textarea rows={4} value={values['solution'] ?? ''} onChange={set('solution')} />
        </Field>
        {/* No Competition box, and no campaign Story box. §9 Step 4, §12. */}
        <p className="field-hint">
          There is no box for Competition, and none for the campaign Story. §9 keeps
          Competition always blank and written by the Founder — it is the one answer that
          proves they did their own thinking — and §12 makes the Story theirs to write and
          approve, because approving it is what earns the discount. What you learned about
          either belongs in the notes below, which they never see.
        </p>

        <Field
          label="Notes from the conversation"
          hint="Anything you learned — how they see the competition, why they are building it, anything worth knowing later. Internal only: it never reaches the Founder, never becomes one of their answers, and never completes a campaign item."
        >
          <Textarea rows={4} value={values['adminNotes'] ?? ''} onChange={set('adminNotes')} />
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
