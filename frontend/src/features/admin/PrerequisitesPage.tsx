/**
 * Production prerequisites — Spec §6, feeding Spec §34.
 *
 * §6: "Admin can also verify that required public routes, policies, support
 * details, sample campaigns, transactional email configuration, Stripe
 * test/live separation, webhook endpoints, tax configuration gates, and pilot
 * feature flags are present. Incomplete prerequisites fail closed."
 *
 * ── Fail closed is a disabled control, not a yellow banner ──────────────────
 * Phase 06's trap says it exactly: "an incomplete prerequisite disables the
 * dependent action. It does not render a yellow warning next to an enabled
 * button." So while anything is unsatisfied, this surface states plainly that
 * live card collection is unavailable and offers no control that would start
 * it. There is no override here and there is no place to add one — §34 is
 * released by satisfying the conditions, never by routing around them.
 *
 * ── Automatic and recorded are labelled apart ───────────────────────────────
 * Some items the app can check itself on every load. Others are a named person
 * verifying something the app has no way to observe, recorded with who, when,
 * what, and the evidence. Showing the second as though the system had verified
 * it would be §1.4's failure — implying automation that does not exist — so
 * each item says which it is, and a recorded one names the person.
 */

import { useCallback, useEffect, useState } from 'react';
import { SETTING_DEFINITIONS } from '@proovd/shared';
import { Button, Card, Field, StatePanel, Tag, Textarea } from '../../components/index.js';
import {
  fetchPrerequisites,
  recordPrerequisite,
  AdminRequestError,
  type PrerequisiteItem,
  type PrerequisitePanel,
} from './api.js';

export function PrerequisitesPage() {
  const [panel, setPanel] = useState<PrerequisitePanel | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);

  const load = useCallback(() => {
    fetchPrerequisites()
      .then(setPanel)
      .catch((error: unknown) => {
        if (error instanceof AdminRequestError) setLoadError(error);
      });
  }, []);

  useEffect(load, [load]);

  if (loadError) {
    return (
      <StatePanel
        state={loadError.detail.title}
        whatHappened={
          loadError.detail.whatHappened ?? 'The prerequisites panel could not be read.'
        }
        next={
          loadError.detail.next ??
          'Reload the page. While this cannot be read, treat the gate as blocking.'
        }
        owner="Proovd"
        nextUpdate="When you reload"
        action={
          <Button tier="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
        reference="Admin · Production prerequisites"
        ring
      />
    );
  }

  if (!panel) {
    return (
      <StatePanel
        state="Checking production prerequisites"
        whatHappened="Proovd is re-running every automatic check and reading the recorded verifications."
        next="The panel appears as soon as they come back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Production prerequisites"
      />
    );
  }

  const satisfiedCount = panel.items.filter((i) => i.satisfied).length;

  return (
    <div className="admin-page">
      <header className="admin-page__head">
        <h1>Production prerequisites</h1>
        <p className="admin-page__lede">
          {satisfiedCount} of {panel.items.length} satisfied. Every item has to hold
          before Proovd may collect a live card.
        </p>
      </header>

      {panel.blocking ? (
        <StatePanel
          state="Live card collection is unavailable"
          whatHappened={
            <>
              {panel.unsatisfiedKeys.length} prerequisite
              {panel.unsatisfiedKeys.length === 1 ? '' : 's'} {' '}
              {panel.unsatisfiedKeys.length === 1 ? 'is' : 'are'} not satisfied. Proovd is
              in Stripe test mode and no real card details can be collected, no live
              SetupIntent or PaymentIntent can be created, and no Creator transfer or
              payout can be made.
            </>
          }
          next="Work through the unsatisfied items below. There is no override — this gate is released by satisfying it."
          owner="Proovd"
          nextUpdate="When the last item is satisfied"
          action="No action needed"
          reference="Spec §34 · live-mode readiness gate"
          ring
        />
      ) : (
        <StatePanel
          state="Every §6 prerequisite is satisfied"
          whatHappened="All ten items hold. This is Spec §6's part of the live-mode gate, not the whole of Spec §34 — the remaining conditions are decided at release."
          next="Spec §34's remaining conditions are reviewed and recorded before the first live campaign."
          owner="Proovd"
          nextUpdate="At the §34 release review"
          action="No action needed"
          reference="Spec §34 · live-mode readiness gate"
        />
      )}

      <ul className="prereq-list">
        {panel.items.map((item) => (
          <PrerequisiteRow key={item.key} item={item} onRecorded={load} />
        ))}
      </ul>
    </div>
  );
}

function PrerequisiteRow({
  item,
  onRecorded,
}: {
  item: PrerequisiteItem;
  onRecorded: () => void;
}) {
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function record(status: 'satisfied' | 'not_satisfied') {
    setBusy(true);
    setError(null);
    try {
      await recordPrerequisite(
        item.key,
        status,
        note,
        evidence
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      );
      setNote('');
      setEvidence('');
      setOpen(false);
      onRecorded();
    } catch (caught) {
      setError(
        caught instanceof AdminRequestError
          ? (caught.detail.whatHappened ?? caught.detail.title)
          : 'That could not be recorded. Nothing has changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <Card className={item.satisfied ? 'prereq' : 'prereq prereq--blocking'}>
        <div className="prereq__glance">
          <h2 className="prereq__label">{item.label}</h2>
          <p className="prereq__tags">
            {item.satisfied ? (
              <Tag variant="mint">Satisfied</Tag>
            ) : (
              <Tag variant="live">Blocking</Tag>
            )}
            <Tag variant="sage">
              {item.verification === 'automatic' ? 'Checked by Proovd' : 'Verified by a person'}
            </Tag>
          </p>
        </div>

        <p className="prereq__detail">{item.detail}</p>
        <p className="prereq__requirement">{item.requirement}</p>
        <p className="prereq__spec">{item.specRef}</p>

        {item.subjectKeys.length > 0 ? (
          <ul className="prereq__subjects">
            {item.subjectKeys.map((key) => (
              <li key={key}>
                {SETTING_DEFINITIONS.find((d) => d.key === key)?.label ?? key}
              </li>
            ))}
          </ul>
        ) : null}

        {item.attestation ? (
          <dl className="kv kv--tight prereq__attestation">
            <div className="kv__row">
              <dt>Recorded by</dt>
              <dd>{item.attestation.recordedBy}</dd>
            </div>
            <div className="kv__row">
              <dt>When</dt>
              <dd>
                <time dateTime={item.attestation.recordedAt}>
                  {new Date(item.attestation.recordedAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
              </dd>
            </div>
            <div className="kv__row">
              <dt>What was checked</dt>
              <dd>{item.attestation.note}</dd>
            </div>
          </dl>
        ) : null}

        {item.verification === 'recorded' ? (
          <div className="prereq__act">
            <Button
              tier="tertiary"
              small
              aria-expanded={open}
              onClick={() => setOpen((was) => !was)}
            >
              {open ? 'Cancel' : item.attestation ? 'Re-check this' : 'Record a check'}
            </Button>

            {open ? (
              <div className="prereq__form">
                <Field
                  label="What did you check?"
                  hint="Enough detail that someone else can run the same check next quarter."
                >
                  <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <Field label="Evidence links" hint="One URL per line. Optional.">
                  <Textarea
                    rows={2}
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                  />
                </Field>

                {error ? (
                  <p className="field-error" role="alert">
                    {error}
                  </p>
                ) : null}

                <div className="prereq__buttons">
                  <Button
                    small
                    disabled={busy || note.trim().length === 0}
                    onClick={() => void record('satisfied')}
                  >
                    Record as satisfied
                  </Button>
                  <Button
                    tier="secondary"
                    small
                    disabled={busy || note.trim().length === 0}
                    onClick={() => void record('not_satisfied')}
                  >
                    Record as not satisfied
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="prereq__automatic">
            Re-checked every time this page loads. There is nothing to record — if this
            stops holding, it stops being satisfied on the next load.
          </p>
        )}
      </Card>
    </li>
  );
}
