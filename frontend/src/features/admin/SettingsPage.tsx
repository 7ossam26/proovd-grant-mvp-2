/**
 * Global configuration — Spec §6.
 *
 * Every operating constant the system will ever read, in one place, persisted,
 * versioned, and audited. Phase 06's rule for everything downstream: "constants
 * live in configuration, not in code — a hardcoded duration is a bug even when
 * the number is right."
 *
 * ── The register is imported, not fetched ───────────────────────────────────
 * Labels, help text, grouping, and the §6 citation come from
 * `@proovd/shared`'s `SETTING_DEFINITIONS`, which this app imports directly.
 * The API serves *state* — value, version, who changed it and when. One
 * register rendered once; a copy travelling over the wire is a second version
 * of the same sentence waiting to disagree with the first.
 *
 * ── Density is licensed here, staging is not repealed ───────────────────────
 * §26 permits dashboard density in the Admin panel and nowhere else. DNA §5.14
 * still applies, so a setting shows its value and its state at a Glance, its
 * controls on Act, and its change history behind one gesture in Explore —
 * thirty-six rows of everything-at-once would be the wall §5.14 forbids.
 *
 * ── Three things this surface refuses to do ─────────────────────────────────
 *  1. Invent a value. A setting §6 names without fixing a number renders
 *     empty and says so; there is no placeholder standing in for a decision.
 *  2. Edit a derived value. The calendar version and its timezone follow a
 *     committed artifact — §29.6 forbids an edit silently resetting a deadline
 *     that has already been computed and promised — so they render with their
 *     provenance and no input.
 *  3. Accept a change with no reason. §25.6 wants the reason on the record, and
 *     the database rejects a blank one, so the control is disabled until one is
 *     typed rather than saving and failing.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SETTING_DEFINITIONS,
  SETTING_GROUPS,
  parseSettingValue,
  type SettingDefinition,
} from '@proovd/shared';
import {
  Button,
  Card,
  Field,
  Input,
  StatePanel,
  Tag,
  Textarea,
  useProovdMotion,
} from '../../components/index.js';
import {
  fetchSettings,
  fetchSettingHistory,
  saveSetting,
  AdminRequestError,
  type SettingState,
  type SettingHistoryEntry,
} from './api.js';
import {
  describeSaveState,
  isRetryable,
  retryDelayMs,
  MAX_SAVE_ATTEMPTS,
  type SaveState,
} from '../../lib/autosave.js';

export function SettingsPage() {
  const [states, setStates] = useState<Record<string, SettingState> | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const scope = useRef<HTMLDivElement>(null);

  useProovdMotion(scope, [states === null]);

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then(({ settings }) => {
        if (cancelled) return;
        setStates(Object.fromEntries(settings.map((s) => [s.key, s])));
      })
      .catch((error: unknown) => {
        if (!cancelled && error instanceof AdminRequestError) setLoadError(error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const unsetKeys = useMemo(
    () =>
      states
        ? SETTING_DEFINITIONS.filter((d) => {
            const value = states[d.key]?.value;
            return value === null || value === undefined || value.trim() === '';
          }).map((d) => d.key)
        : [],
    [states],
  );

  if (loadError) {
    return (
      <StatePanel
        state={loadError.detail.title}
        whatHappened={loadError.detail.whatHappened ?? 'The configuration could not be read.'}
        next={loadError.detail.next ?? 'Reload the page to try again.'}
        owner="Proovd"
        nextUpdate="When you reload"
        action={
          <Button tier="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
        reference="Admin · Global configuration"
        ring
      />
    );
  }

  if (!states) {
    return (
      <StatePanel
        state="Loading the configuration"
        whatHappened="Proovd is reading the stored value of every operating constant."
        next="The settings appear as soon as they arrive. Nothing has been changed."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Global configuration"
      />
    );
  }

  return (
    <div className="admin-page" ref={scope}>
      <header className="admin-page__head">
        <h1>Global configuration</h1>
        <p className="admin-page__lede">
          Every operating constant Spec §6 names. These are read by the rest of the
          system — a change here changes the fee, deadline, or schedule that every
          later campaign is run against, and each one is recorded with who changed it
          and why.
        </p>

        {unsetKeys.length > 0 ? (
          <Card className="admin-alert">
            <p className="admin-alert__head">
              {unsetKeys.length} setting{unsetKeys.length === 1 ? '' : 's'} still
              {unsetKeys.length === 1 ? ' has' : ' have'} no value
            </p>
            <p>
              §6 names these and fixes no number, so Proovd ships them unset rather than
              inventing one. Until each has a value, the production prerequisites panel
              blocks and any action that would read one is unavailable.
            </p>
            <ul className="admin-alert__list">
              {unsetKeys.map((key) => (
                <li key={key}>
                  <a href={`#setting-${key}`}>
                    {SETTING_DEFINITIONS.find((d) => d.key === key)?.label ?? key}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </header>

      {SETTING_GROUPS.map(({ group, heading }) => {
        const definitions = SETTING_DEFINITIONS.filter((d) => d.group === group);
        if (definitions.length === 0) return null;
        return (
          <section className="admin-group" key={group} aria-labelledby={`group-${group}`}>
            <h2 className="admin-group__heading" id={`group-${group}`}>
              {heading}
            </h2>
            <div className="admin-group__rows">
              {definitions.map((definition) => (
                <SettingRow
                  key={definition.key}
                  definition={definition}
                  state={states[definition.key]}
                  onSaved={(next) =>
                    setStates((current) =>
                      current ? { ...current, [next.key]: next } : current,
                    )
                  }
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ── One setting ──────────────────────────────────────────────────────────── */

interface SettingRowProps {
  definition: SettingDefinition;
  state: SettingState | undefined;
  onSaved: (next: SettingState) => void;
}

function SettingRow({ definition, state, onSaved }: SettingRowProps) {
  const [draft, setDraft] = useState(state?.value ?? '');
  const [reason, setReason] = useState('');
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setDraft(state?.value ?? '');
  }, [state?.value]);

  if (!state) return null;

  const isUnset = state.value === null || state.value.trim() === '';
  const derived = state.provenance === 'derived';
  const dirty = draft !== (state.value ?? '');

  // Immediate feedback only. The server decides — `values.ts` re-validates
  // against the bounds on the row itself, so a bypassed fetch changes nothing.
  const parsed = draft.trim() === '' ? null : parseSettingValue(definition, draft);
  const clientError = parsed && !parsed.ok ? parsed.message : null;

  const canSave = dirty && !clientError && reason.trim().length > 0 && !derived;

  async function attemptSave(attempt: number): Promise<void> {
    setSave(attempt === 1 ? { status: 'saving' } : { status: 'retrying', attempt });
    try {
      const next = await saveSetting(definition.key, draft, reason);
      onSaved(next);
      setReason('');
      setSave({ status: 'saved', at: new Date() });
    } catch (error) {
      const detail =
        error instanceof AdminRequestError
          ? error.detail
          : { status: 0, title: 'Proovd could not be reached', whatHappened: undefined };

      if (isRetryable(detail.status) && attempt < MAX_SAVE_ATTEMPTS) {
        setSave({ status: 'retrying', attempt: attempt + 1 });
        // §1.4: the line says "retrying" only because one is genuinely
        // scheduled. When they run out it becomes an honest stop, below.
        window.setTimeout(() => void attemptSave(attempt + 1), retryDelayMs(attempt));
        return;
      }

      setSave({
        status: 'failed',
        title: detail.title,
        detail: detail.whatHappened,
      });
    }
  }

  const statusLine = describeSaveState(save);

  return (
    <Card className="setting" id={`setting-${definition.key}`}>
      <div className="setting__glance">
        <h3 className="setting__label">{definition.label}</h3>
        <p className="setting__value">
          {isUnset ? (
            <span className="setting__unset">No value stated</span>
          ) : (
            <code>{state.value}</code>
          )}
        </p>
        <p className="setting__tags">
          {derived ? (
            <Tag variant="sage">From the committed calendar</Tag>
          ) : definition.provenance === 'operator' ? (
            <Tag variant="moss">You state this</Tag>
          ) : (
            <Tag variant="mint">§6 states this</Tag>
          )}
          <Tag variant="default">v{state.version}</Tag>
        </p>
      </div>

      <p className="setting__help">{definition.help}</p>
      <p className="setting__spec">{definition.specRef}</p>

      {derived ? (
        <p className="setting__locked">
          This value follows the committed business-day calendar. A new calendar ships
          as a new committed version and a deployment — changing it here would move
          deadlines that have already been computed and promised.
        </p>
      ) : (
        <div className="setting__act">
          <Field
            label={`Value${unitOf(definition)}`}
            error={clientError ?? undefined}
            id={`value-${definition.key}`}
          >
            {definition.kind === 'text_list' || definition.kind === 'text' ? (
              <Textarea
                rows={definition.kind === 'text_list' ? 4 : 2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            ) : (
              <Input
                type="text"
                inputMode={definition.kind === 'boolean' ? 'text' : 'numeric'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Why is this changing?"
            hint="Stored with the change, and read by whoever audits it later."
            id={`reason-${definition.key}`}
          >
            <Input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          <div className="setting__actions">
            <Button
              small
              disabled={!canSave || save.status === 'saving' || save.status === 'retrying'}
              onClick={() => void attemptSave(1)}
            >
              Save
            </Button>
            {statusLine ? (
              <span
                className="setting__status"
                role="status"
                aria-live="polite"
                data-state={save.status}
              >
                {statusLine}
              </span>
            ) : null}
          </div>

          {save.status === 'failed' ? (
            <p className="field-error" role="alert">
              {save.detail ?? save.title} Nothing has been changed — the stored value is
              still {isUnset ? 'unset' : state.value}.
            </p>
          ) : null}
        </div>
      )}

      <div className="setting__explore">
        <Button
          tier="tertiary"
          small
          aria-expanded={showHistory}
          onClick={() => setShowHistory((open) => !open)}
        >
          {showHistory ? 'Hide change history' : 'Change history'}
        </Button>
        {showHistory ? <SettingHistory settingKey={definition.key} /> : null}
      </div>
    </Card>
  );
}

function unitOf(definition: SettingDefinition): string {
  switch (definition.kind) {
    case 'money_cents':
      return ' (whole cents)';
    case 'percent':
      return ' (%)';
    case 'calendar_days':
      return ' (calendar days)';
    case 'business_days':
      return ' (US business days)';
    case 'hours':
      return ' (hours)';
    case 'seconds':
      return ' (seconds)';
    case 'months':
      return ' (months)';
    case 'boolean':
      return ' (true or false)';
    case 'text_list':
      return ' (one per line)';
    default:
      return '';
  }
}

function SettingHistory({ settingKey }: { settingKey: string }) {
  const [entries, setEntries] = useState<SettingHistoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSettingHistory(settingKey)
      .then(({ history }) => {
        if (!cancelled) setEntries(history);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [settingKey]);

  if (!entries) return <p className="setting__history-empty">Loading history…</p>;
  if (entries.length === 0) {
    return <p className="setting__history-empty">No recorded changes yet.</p>;
  }

  return (
    <ol className="setting__history">
      {entries.map((entry) => {
        const when = new Date(entry.occurredAt);
        return (
          <li key={entry.version}>
            <p className="setting__history-change">
              <strong>v{entry.version}</strong>{' '}
              {entry.priorValue === null ? (
                <>set to <code>{entry.newValue}</code></>
              ) : (
                <>
                  <code>{entry.priorValue}</code> → <code>{entry.newValue}</code>
                </>
              )}
            </p>
            <p className="setting__history-meta">
              {entry.changedBy} ·{' '}
              <time dateTime={entry.occurredAt}>
                {when.toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}{' '}
                <span className="utc">
                  (
                  {when.toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'UTC',
                  })}{' '}
                  UTC)
                </span>
              </time>
            </p>
            <p className="setting__history-reason">{entry.reason}</p>
          </li>
        );
      })}
    </ol>
  );
}
