/**
 * The §34 live-mode gate, as a surface — Spec §34, §2.1, §6, Appendix C.
 *
 * Phase 24 built the gate, the pilot, the preflight and the Appendix C walks,
 * and recorded that it had built no page for them: "the API exists and is
 * tested; there is no React page for it yet… §1.1 does [name one], so this is a
 * real gap rather than a decision." This is that page.
 *
 * ── There is no override on it, and nowhere to add one ──────────────────────
 * The `/admin/prerequisites` posture since Phase 06a, and Phase 24's own. No
 * control here sets a condition satisfied without an answer, no control skips
 * one, and — the one that matters — **the enable form does not exist while the
 * gate is shut**. Not disabled: absent, with the blocking conditions rendered
 * where it would be. §34 is released by satisfying it, so the only way to reach
 * the enable form is to satisfy the eleven.
 *
 * ── Every list is the register's, never a second copy ───────────────────────
 * The eleven conditions, the three preflight checks, the five rollback-plan
 * fields and Appendix C's forty-nine steps all render from `@proovd/shared`.
 * The server sends the STATE and the registers supply the definitions, so a
 * condition added to §34 appears here without this file being edited — and one
 * removed cannot linger.
 *
 * ── Which kind of verification, said on every row ───────────────────────────
 * §1.4. `automatic` is a fact this process decides on every read; `suite` is a
 * fact about a CI run, filed with what was run; `recorded` is a human
 * judgement. Presenting a recorded answer as system-verified is the failure
 * this distinction exists to prevent, so the row says which it is and, where
 * the process cannot answer, why it cannot.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  APPENDIX_C_STATEMENTS,
  LIVE_MODE_BLOCKED_MESSAGE,
  LIVE_MODE_CONDITIONS,
  PILOT_OWNER_ROLES,
  PILOT_PREFLIGHT_CHECKS,
  ROLLBACK_PLAN_FIELDS,
  type ConditionVerification,
  type PilotOwnerRole,
  type RollbackPlan,
} from '@proovd/shared';
import {
  Button,
  Card,
  Field,
  Input,
  Measure,
  Section,
  StatePanel,
  Tag,
  Textarea,
  NO_ACTION,
} from '../../../components/index.js';
import { PageLoading } from '../../public/states.js';
import { AdminRequestError } from '../api.js';
import {
  confirmPreflight,
  enablePilot,
  fetchLiveMode,
  fileCondition,
  recordWalkthrough,
  rollBack,
  type ConditionStateView,
  type LiveModeView,
} from './api.js';

/** §1.4: which kind of evidence this row rests on, in the reader's words. */
const VERIFICATION_LABEL: Record<ConditionVerification, string> = {
  automatic: 'Checked now',
  suite: 'A recorded test run',
  recorded: 'A recorded judgement',
};

export function LiveModePage() {
  const [view, setView] = useState<LiveModeView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setView(await fetchLiveMode());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLiveMode()
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          error instanceof AdminRequestError
            ? (error.detail.whatHappened ?? error.detail.title)
            : 'We could not read the live-mode gate.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failure) {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="We could not read the live-mode gate"
            whatHappened={failure}
            next="Reload the page. A gate that cannot be read is shut, so no live money can move while this is failing."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference="Live mode"
            getHelp={{ href: '/support' }}
          />
        </Measure>
      </Section>
    );
  }

  if (!view) return <PageLoading />;

  return (
    <Section>
      <Measure>
        {/* The scope for this surface's own type rules: a `.section-title`
            inside it is the second level, not a rival to the page's own. */}
        <div className="lm">
        <header className="lm__head">
          <h1 className="page-title">Live mode</h1>
          <p className="lede">
            §34&apos;s eleven conditions, the one named pilot campaign, and Appendix C&apos;s four
            walks. Nothing on this page opens the gate — it opens when every condition holds.
          </p>
        </header>

        <Glance view={view} />
        <Conditions view={view} onFiled={reload} />
        <Pilot view={view} onChanged={reload} />
        <AppendixC view={view} onWalked={reload} />
        </div>
      </Measure>
    </Section>
  );
}

/* ── Glance — is the gate open, and what is it waiting on ─────────────────── */

function Glance({ view }: { view: LiveModeView }) {
  const { gate } = view;
  const blocking = gate.blockingKeys.length;

  return (
    <Card>
      <div className="lm__glance">
        <Tag variant={gate.open ? 'mint' : 'default'}>{gate.open ? 'Open' : 'Shut'}</Tag>
        <p className="lm__glance-count">
          {gate.open
            ? 'All eleven conditions hold.'
            : `${blocking} of ${gate.conditions.length} conditions do not hold yet.`}
        </p>
      </div>
      {/* The frozen refusal, verbatim, so an Admin reads exactly what a refused
          operation reads. A softer paraphrase here would be the first place
          somebody learned the gate was negotiable. */}
      {gate.open ? null : <p className="lm__frozen">{LIVE_MODE_BLOCKED_MESSAGE}</p>}
      <dl className="lm__facts">
        <div className="lm__fact">
          <dt>Stripe mode</dt>
          <dd>{view.stripeMode}</dd>
        </div>
        <div className="lm__fact">
          {/* §2.1, both directions, derived from condition 1 rather than
              stored — so "the conditional sentence is correct" and "it is now
              stale" can never disagree with whether approval exists. */}
          <dt>Architecture wording</dt>
          <dd>
            {view.approvalCopyState === 'conditional_copy_is_correct'
              ? 'The conditional wording on the public site is correct — approval does not exist yet.'
              : 'Approval exists, so the conditional wording is now stale and must be replaced.'}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/* ── The eleven ───────────────────────────────────────────────────────────── */

function Conditions({ view, onFiled }: { view: LiveModeView; onFiled: () => Promise<void> }) {
  return (
    <Card>
      <h2 className="section-title">The eleven conditions</h2>
      <ul className="lm__conditions">
        {LIVE_MODE_CONDITIONS.map((condition) => {
          const state = view.gate.conditions.find((c) => c.key === condition.key);
          return (
            <ConditionRow
              key={condition.key}
              ordinal={condition.ordinal}
              requirement={condition.requirement}
              specRef={condition.specRef}
              verification={condition.verification}
              cannotBeAutomatedBecause={condition.cannotBeAutomatedBecause}
              provedBy={condition.provedBy}
              trackAItem={condition.trackAItem ?? null}
              state={state}
              onFiled={onFiled}
            />
          );
        })}
      </ul>
    </Card>
  );
}

function ConditionRow({
  ordinal,
  requirement,
  specRef,
  verification,
  cannotBeAutomatedBecause,
  provedBy,
  trackAItem,
  state,
  onFiled,
}: {
  ordinal: number;
  requirement: string;
  specRef: string;
  verification: ConditionVerification;
  cannotBeAutomatedBecause?: string | undefined;
  provedBy?: readonly string[] | undefined;
  trackAItem: string | null;
  state: ConditionStateView | undefined;
  onFiled: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const satisfied = state?.satisfied === true;

  return (
    <li className={satisfied ? 'lm__condition is-satisfied' : 'lm__condition'}>
      <div className="lm__condition-head">
        <span className="lm__ordinal">{ordinal}</span>
        <p className="lm__requirement">{requirement}</p>
        <Tag variant={satisfied ? 'mint' : 'default'}>{satisfied ? 'Holds' : 'Blocking'}</Tag>
      </div>

      <dl className="lm__condition-facts">
        <div className="lm__fact">
          <dt>How it is decided</dt>
          <dd>{VERIFICATION_LABEL[verification]}</dd>
        </div>
        <div className="lm__fact">
          <dt>Where it comes from</dt>
          <dd>{specRef}</dd>
        </div>
        {/* §1.4 again: an unsatisfied condition says why, never "not met". */}
        <div className="lm__fact">
          <dt>Where it stands</dt>
          <dd>{state?.detail ?? 'No answer was produced for this condition.'}</dd>
        </div>
        {cannotBeAutomatedBecause ? (
          <div className="lm__fact">
            <dt>Why this process cannot answer it</dt>
            <dd>{cannotBeAutomatedBecause}</dd>
          </div>
        ) : null}
        {provedBy && provedBy.length > 0 ? (
          <div className="lm__fact">
            <dt>Which run decides it</dt>
            <dd>{provedBy.join(', ')}</dd>
          </div>
        ) : null}
        {trackAItem ? (
          <div className="lm__fact">
            <dt>What closes it</dt>
            <dd>{trackAItem}</dd>
          </div>
        ) : null}
        {state?.filedAnswer ? (
          <div className="lm__fact">
            <dt>Filed answer</dt>
            <dd>
              {state.filedAnswer.status === 'satisfied' ? 'Satisfied' : 'Not satisfied'} — by{' '}
              {state.filedAnswer.verifiedBy}. {state.filedAnswer.findings}
              {state.filedAnswer.evidenceReference
                ? ` Evidence: ${state.filedAnswer.evidenceReference}`
                : ''}
            </dd>
          </div>
        ) : null}
      </dl>

      {/* An `automatic` condition has no row shape at all — an attestation
          cannot outlive the fact it describes, so there is nothing to file. */}
      {verification === 'automatic' ? (
        <p className="lm__note">
          This one is decided on every read, so there is nothing to file. It changes when the fact
          behind it changes.
        </p>
      ) : (
        <>
          <Button tier="secondary" small onClick={() => setOpen((v) => !v)}>
            {open ? 'Close this answer' : state?.filedAnswer ? 'File a new answer' : 'File an answer'}
          </Button>
          {open ? (
            <FileAnswerForm
              conditionKey={state?.key ?? ''}
              onDone={async () => {
                setOpen(false);
                await onFiled();
              }}
            />
          ) : null}
        </>
      )}
    </li>
  );
}

function FileAnswerForm({
  conditionKey,
  onDone,
}: {
  conditionKey: string;
  onDone: () => Promise<void>;
}) {
  const [status, setStatus] = useState<'satisfied' | 'not_satisfied'>('not_satisfied');
  const [verifiedBy, setVerifiedBy] = useState('');
  const [findings, setFindings] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await fileCondition({
        conditionKey,
        status,
        verifiedBy: verifiedBy.trim(),
        findings: findings.trim(),
        ...(evidence.trim() ? { evidenceReference: evidence.trim() } : {}),
      });
      await onDone();
    } catch (e: unknown) {
      setBusy(false);
      setError(
        e instanceof AdminRequestError
          ? (e.detail.whatHappened ?? e.detail.title)
          : 'That answer was refused. Nothing has changed.',
      );
    }
  }, [conditionKey, evidence, findings, onDone, status, verifiedBy]);

  return (
    <div className="lm__form">
      <fieldset className="lm__radio">
        <legend>What did you find?</legend>
        {(['satisfied', 'not_satisfied'] as const).map((value) => (
          <label className="lm__radio-row" key={value}>
            <input
              type="radio"
              name={`status-${conditionKey}`}
              checked={status === value}
              onChange={() => setStatus(value)}
            />
            <span>{value === 'satisfied' ? 'It holds' : 'It does not hold'}</span>
          </label>
        ))}
      </fieldset>
      <Field label="Who verified it" id={`by-${conditionKey}`}>
        <Input value={verifiedBy} onChange={(e) => setVerifiedBy(e.currentTarget.value)} />
      </Field>
      <Field
        label="What you found"
        id={`findings-${conditionKey}`}
        hint="What was checked and what it showed. This is the justification the enablement will be recorded against."
      >
        <Textarea rows={3} value={findings} onChange={(e) => setFindings(e.currentTarget.value)} />
      </Field>
      <Field
        label="Evidence reference"
        id={`evidence-${conditionKey}`}
        hint="Where the output lives — a CI run, a document, a ticket. Optional."
      >
        <Input value={evidence} onChange={(e) => setEvidence(e.currentTarget.value)} />
      </Field>
      <Button
        tier="primary"
        small
        onClick={() => void submit()}
        disabled={busy || !verifiedBy.trim() || !findings.trim()}
      >
        {busy ? 'Filing…' : 'File this answer'}
      </Button>
      {error ? (
        <div className="notice notice--warn" role="alert">
          <p>{error}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ── The one pilot ────────────────────────────────────────────────────────── */

function Pilot({ view, onChanged }: { view: LiveModeView; onChanged: () => Promise<void> }) {
  if (view.pilot) return <EnabledPilot view={view} onChanged={onChanged} />;

  return (
    <Card>
      <h2 className="section-title">The pilot campaign</h2>
      {view.gate.open ? (
        <EnableForm onDone={onChanged} />
      ) : (
        /*
          The enable form is ABSENT while the gate is shut, not disabled.
          §34 is released by satisfying it, and a disabled control is a control
          somebody looks for a way around. What renders instead is what is
          actually in the way.
        */
        <StatePanel
          state="Live mode cannot be enabled yet"
          whatHappened={`${view.gate.blockingKeys.length} of §34's conditions do not hold, so there is nothing to enable. The list above says which, and what closes each one.`}
          next="Satisfy the conditions. There is no way to enable live mode from this page while any of them is outstanding, and there is nowhere to add one."
          owner="Proovd"
          nextUpdate="When the last condition holds"
          action={NO_ACTION}
          reference="Live mode"
        />
      )}
    </Card>
  );
}

function EnabledPilot({
  view,
  onChanged,
}: {
  view: LiveModeView;
  onChanged: () => Promise<void>;
}) {
  const pilot = view.pilot!;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roll = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await rollBack(reason.trim());
      setReason('');
      await onChanged();
    } catch (e: unknown) {
      setError(
        e instanceof AdminRequestError
          ? (e.detail.whatHappened ?? e.detail.title)
          : 'The rollback was refused. Nothing has changed.',
      );
    } finally {
      setBusy(false);
    }
  }, [onChanged, reason]);

  return (
    <Card>
      <h2 className="section-title">The pilot campaign</h2>
      <dl className="lm__facts">
        <div className="lm__fact">
          <dt>Campaign</dt>
          <dd>{pilot.campaignId}</dd>
        </div>
        <div className="lm__fact">
          <dt>Enabled</dt>
          <dd>
            {new Date(pilot.enabledAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}{' '}
            by {pilot.enabledBy}
          </dd>
        </div>
        {pilot.owners.map((owner) => (
          <div className="lm__fact" key={owner.role}>
            <dt>{owner.role === 'rollback' ? 'Rollback owner' : 'Monitoring owner'}</dt>
            <dd>
              {owner.name} — {owner.contact}. Acknowledged by {owner.acknowledgedBy}.
            </dd>
          </div>
        ))}
      </dl>

      <h3 className="lm__sub">Before the first live reservation</h3>
      <ul className="lm__preflight">
        {PILOT_PREFLIGHT_CHECKS.map((check) => (
          <PreflightRow
            key={check.key}
            checkKey={check.key}
            requirement={check.requirement}
            specRef={check.specRef}
            done={pilot.preflightConfirmed.includes(check.key)}
            onDone={onChanged}
          />
        ))}
      </ul>
      {pilot.preflightComplete ? null : (
        <p className="lm__note">
          The first live reservation waits on all three. Each is a fact about the world outside this
          system, so none of them can be checked from here.
        </p>
      )}

      <h3 className="lm__sub">Roll back</h3>
      <p className="lm__note">
        One statement, effective on the next call — the gate is never cached, so a rollback takes
        effect immediately rather than at the next deployment.
      </p>
      <Field
        label="Why live money is stopping"
        id="lm-rollback-reason"
        hint="Recorded permanently. Re-enabling is a new record with its own gate snapshot, so this is not erased."
      >
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
      </Field>
      <Button
        tier="secondary"
        onClick={() => void roll()}
        disabled={busy || reason.trim().length === 0}
      >
        {busy ? 'Rolling back…' : 'Roll back live mode'}
      </Button>
      {error ? (
        <div className="notice notice--warn" role="alert">
          <p>{error}</p>
        </div>
      ) : null}
    </Card>
  );
}

function PreflightRow({
  checkKey,
  requirement,
  specRef,
  done,
  onDone,
}: {
  checkKey: string;
  requirement: string;
  specRef: string;
  done: boolean;
  onDone: () => Promise<void>;
}) {
  const [findings, setFindings] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <li className={done ? 'lm__preflight-row is-done' : 'lm__preflight-row'}>
      <div className="lm__condition-head">
        <p className="lm__requirement">{requirement}</p>
        <Tag variant={done ? 'mint' : 'default'}>{done ? 'Confirmed' : 'Outstanding'}</Tag>
      </div>
      <p className="lm__note">{specRef}</p>
      {done ? null : (
        <>
          <Field label="What you saw" id={`pf-${checkKey}`}>
            <Textarea
              rows={2}
              value={findings}
              onChange={(e) => setFindings(e.currentTarget.value)}
            />
          </Field>
          <Button
            tier="secondary"
            small
            disabled={busy || findings.trim().length === 0}
            onClick={() => {
              setBusy(true);
              void confirmPreflight({ checkKey, findings: findings.trim() })
                .then(onDone)
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Recording…' : 'Confirm this check'}
          </Button>
        </>
      )}
    </li>
  );
}

function EnableForm({ onDone }: { onDone: () => Promise<void> }) {
  const [campaignId, setCampaignId] = useState('');
  const [owners, setOwners] = useState<Record<PilotOwnerRole, { name: string; contact: string; acknowledgedBy: string }>>({
    monitoring: { name: '', contact: '', acknowledgedBy: '' },
    rollback: { name: '', contact: '', acknowledgedBy: '' },
  });
  const [plan, setPlan] = useState<RollbackPlan>({
    triggers: '',
    decisionMaker: '',
    mechanism: '',
    inFlightReservations: '',
    partyCommunication: '',
  });
  const [busy, setBusy] = useState(false);
  const [violations, setViolations] = useState<string[]>([]);

  const submit = useCallback(async () => {
    setBusy(true);
    setViolations([]);
    try {
      await enablePilot({
        campaignId: campaignId.trim(),
        owners: PILOT_OWNER_ROLES.map((role) => ({ role, ...owners[role] })),
        rollbackPlan: plan,
      });
      await onDone();
    } catch (e: unknown) {
      setBusy(false);
      // The server's own named refusals, one line each — never collapsed into
      // "could not enable", because each one names a different missing thing.
      const detail = e instanceof AdminRequestError ? e.detail : null;
      const listed = (detail as unknown as { violations?: string[] } | null)?.violations;
      setViolations(
        listed && listed.length > 0
          ? listed
          : [detail?.whatHappened ?? 'That enablement was refused. Nothing has changed.'],
      );
    }
  }, [campaignId, onDone, owners, plan]);

  return (
    <div className="lm__form">
      <p className="lm__note">
        One live enablement exists in the whole system, for one named campaign. A second is refused
        by the database rather than by a check somebody could reorder.
      </p>
      <Field label="Campaign" id="lm-campaign">
        <Input value={campaignId} onChange={(e) => setCampaignId(e.currentTarget.value)} />
      </Field>

      <h3 className="lm__sub">The two owners</h3>
      {PILOT_OWNER_ROLES.map((role) => (
        <div className="lm__owner" key={role}>
          <h4 className="lm__owner-role">
            {role === 'rollback' ? 'Rollback owner' : 'Monitoring owner'}
          </h4>
          <Field label="Name" id={`owner-name-${role}`} hint="A person. A team alias is refused.">
            <Input
              value={owners[role].name}
              onChange={(e) =>
                setOwners((o) => ({ ...o, [role]: { ...o[role], name: e.currentTarget.value } }))
              }
            />
          </Field>
          <Field label="How they are reached" id={`owner-contact-${role}`}>
            <Input
              value={owners[role].contact}
              onChange={(e) =>
                setOwners((o) => ({ ...o, [role]: { ...o[role], contact: e.currentTarget.value } }))
              }
            />
          </Field>
          <Field
            label="Who confirmed they know"
            id={`owner-ack-${role}`}
            hint="Whether the named person actually knows is its own recorded judgement, which is why this is its own field."
          >
            <Input
              value={owners[role].acknowledgedBy}
              onChange={(e) =>
                setOwners((o) => ({
                  ...o,
                  [role]: { ...o[role], acknowledgedBy: e.currentTarget.value },
                }))
              }
            />
          </Field>
        </div>
      ))}

      <h3 className="lm__sub">The rollback plan</h3>
      <p className="lm__note">
        Written before cutover, not after a problem — which is why the enablement cannot exist
        without all five.
      </p>
      {ROLLBACK_PLAN_FIELDS.map((field) => (
        <Field
          key={field.key}
          label={field.label}
          id={`plan-${field.key}`}
          hint={field.requirement}
        >
          <Textarea
            rows={2}
            value={plan[field.key]}
            onChange={(e) => setPlan((p) => ({ ...p, [field.key]: e.currentTarget.value }))}
          />
        </Field>
      ))}

      <Button tier="primary" onClick={() => void submit()} disabled={busy}>
        {busy ? 'Enabling…' : 'Enable live mode for this campaign'}
      </Button>
      {violations.length > 0 ? (
        <div className="notice notice--warn" role="alert">
          <p>This enablement was refused, and nothing was recorded:</p>
          <ul className="lm__violations">
            {violations.map((violation) => (
              <li key={violation}>{violation}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* ── Appendix C — four statements, walked ─────────────────────────────────── */

function AppendixC({ view, onWalked }: { view: LiveModeView; onWalked: () => Promise<void> }) {
  return (
    <Card>
      <h2 className="section-title">Appendix C — the four walks</h2>
      <p className="lm__note">
        Verified by walking the flow, never by reading the code. A walk that only succeeded because
        the walker knew a trick is a failed walk — Appendix C&apos;s own condition is &ldquo;without
        undocumented operator knowledge&rdquo;.
      </p>
      {APPENDIX_C_STATEMENTS.map((statement) => (
        <div className="lm__statement" key={statement.actor}>
          <h3 className="lm__sub">{statement.actor}</h3>
          <p className="lm__note">{statement.constraint}</p>
          <ul className="lm__steps">
            {statement.steps.map((step) => {
              const key = `${statement.actor}:${step.key}`;
              const passed = view.appendixC.passed.includes(key);
              const failed = view.appendixC.failed.includes(key);
              return (
                <WalkRow
                  key={key}
                  actor={statement.actor}
                  stepKey={step.key}
                  clause={step.clause}
                  surface={step.surface}
                  /* `unwalked` is its own answer: "nobody has tried this" and
                     "somebody tried and it did not work" are different facts. */
                  state={passed ? 'passed' : failed ? 'failed' : 'unwalked'}
                  onWalked={onWalked}
                />
              );
            })}
          </ul>
        </div>
      ))}
    </Card>
  );
}

const WALK_LABEL = { passed: 'Walked', failed: 'Failed', unwalked: 'Not walked' } as const;

function WalkRow({
  actor,
  stepKey,
  clause,
  surface,
  state,
  onWalked,
}: {
  actor: string;
  stepKey: string;
  clause: string;
  surface: string;
  state: 'passed' | 'failed' | 'unwalked';
  onWalked: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [findings, setFindings] = useState('');
  const [knowledge, setKnowledge] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <li className="lm__step">
      <div className="lm__condition-head">
        <p className="lm__requirement">{clause}</p>
        <Tag variant={state === 'passed' ? 'mint' : 'default'}>{WALK_LABEL[state]}</Tag>
      </div>
      <p className="lm__note">{surface}</p>
      <Button tier="secondary" small onClick={() => setOpen((v) => !v)}>
        {open ? 'Close' : 'Record a walk'}
      </Button>
      {open ? (
        <div className="lm__form">
          <Field label="What happened" id={`walk-${actor}-${stepKey}`}>
            <Textarea
              rows={2}
              value={findings}
              onChange={(e) => setFindings(e.currentTarget.value)}
            />
          </Field>
          {/* Not a checkbox tacked onto a pass. Appendix C's condition is
              "without undocumented operator knowledge", so filling this in
              makes the walk a FAILURE — the service refuses the other
              combination and a CHECK makes it unrepresentable. */}
          <Field
            label="Anything you had to know that is not written down"
            id={`walk-knowledge-${actor}-${stepKey}`}
            hint="Leave this empty if the flow carried you. Filling it in records the walk as failed, because that is what it was."
          >
            <Textarea
              rows={2}
              value={knowledge}
              onChange={(e) => setKnowledge(e.currentTarget.value)}
            />
          </Field>
          <div className="lm__walk-actions">
            <Button
              tier="secondary"
              small
              disabled={busy || findings.trim().length === 0 || knowledge.trim().length > 0}
              onClick={() => {
                setBusy(true);
                void recordWalkthrough({
                  actor,
                  stepKey,
                  result: 'passed',
                  findings: findings.trim(),
                })
                  .then(async () => {
                    setOpen(false);
                    await onWalked();
                  })
                  .finally(() => setBusy(false));
              }}
            >
              It worked
            </Button>
            <Button
              tier="tertiary"
              small
              disabled={busy || findings.trim().length === 0}
              onClick={() => {
                setBusy(true);
                void recordWalkthrough({
                  actor,
                  stepKey,
                  result: 'failed',
                  findings: findings.trim(),
                  ...(knowledge.trim()
                    ? { undocumentedKnowledgeRequired: knowledge.trim() }
                    : {}),
                })
                  .then(async () => {
                    setOpen(false);
                    await onWalked();
                  })
                  .finally(() => setBusy(false));
              }}
            >
              It did not
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
