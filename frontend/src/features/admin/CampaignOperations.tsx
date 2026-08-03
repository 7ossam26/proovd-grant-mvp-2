/**
 * Admin — the §26.8 chronological timeline, §26.7 suspend/kill, and §26.8's
 * one-time relationship touches, for one campaign.
 *
 * ── The timeline is read-only and says where each entry came from ───────────
 * §26.8 composes existing events rather than logging new ones, so every row
 * names the table it was read out of. That is not debug output — it is what
 * makes the "composes, does not duplicate" claim checkable by the person reading
 * it, and during a dispute it is how you know the timeline and the ledger cannot
 * have drifted.
 *
 * ── Suspend and kill demand both halves of the reason ───────────────────────
 * §26.7: reason category **and** free text. The form refuses to submit without
 * both, and the server refuses independently — a disabled button is not
 * authorization (§1.1). The customer explanation is its own field because §18
 * forbids one generic `Campaign ended` message and §25.6 keeps internal wording
 * out of customer copy.
 *
 * ── A relationship touch cannot be scheduled ────────────────────────────────
 * §26.8 makes these one-time personal service events and the brief says they
 * "must never become a scheduled sequence". There is no date field, no
 * recurrence control, and no way to queue one — logging is the only affordance,
 * and each kind greys out once used.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  ENFORCEMENT_REASON_LABELS,
  RELATIONSHIP_TOUCH_LABELS,
  TIMELINE_SOURCES,
} from '@proovd/shared';
import { Button, Card, Field, Input, Tag, Textarea } from '../../components/index.js';
import {
  fetchTimeline,
  fetchEnforcement,
  enforceCampaign,
  fetchRelationshipTouches,
  recordRelationshipTouch,
  AdminRequestError,
  type TimelineState,
  type EnforcementState,
} from './api.js';

const when = (iso: string) => `${iso.replace('T', ' ').slice(0, 16)} UTC`;

export function CampaignOperationsPage() {
  const [params] = useSearchParams();
  const campaignId = params.get('campaign') ?? '';

  const [timeline, setTimeline] = useState<TimelineState | null>(null);
  const [enforcement, setEnforcement] = useState<EnforcementState | null>(null);
  const [touches, setTouches] = useState<{
    touches: Array<{ id: string; kind: string; note: string; recordedBy: string; occurredAt: string }>;
    kinds: string[];
    note: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!campaignId) return;
    setError(null);
    try {
      const [t, e, r] = await Promise.all([
        fetchTimeline('campaign', campaignId),
        fetchEnforcement(campaignId),
        fetchRelationshipTouches(campaignId),
      ]);
      setTimeline(t);
      setEnforcement(e);
      setTouches(r);
    } catch (err) {
      setError(
        err instanceof AdminRequestError
          ? (err.detail.whatHappened ?? err.detail.title)
          : 'This campaign could not be read.',
      );
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!campaignId) {
    return (
      <section className="admin-workspace">
        <h1>Campaign operations</h1>
        <Card>
          <h2>Choose a campaign</h2>
          <p>
            Add <code>?campaign=&lt;id&gt;</code> to this address, or open it from the ledger.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section className="admin-workspace">
      <header className="ops-block">
        <h1>Campaign operations</h1>
        <p className="field-hint">
          The chronological record, the enforcement decisions, and the personal touches logged for
          this campaign.
        </p>
      </header>

      {error && (
        <Card>
          <h2>Could not be read</h2>
          <p>{error}</p>
          <p className="field-hint">Nothing was changed.</p>
        </Card>
      )}

      <EnforcementPanel
        campaignId={campaignId}
        state={enforcement}
        onDone={() => void load()}
      />

      <TouchPanel campaignId={campaignId} state={touches} onDone={() => void load()} />

      {timeline && (
        <Card>
          <div className="ops-head">
            <h2>Timeline</h2>
            <Tag>§26.8</Tag>
          </div>
          <p className="field-hint">
            Read-only, oldest first. Every entry is composed from the record that already owns it —
            there is no timeline event store, so this cannot drift from the ledger.
          </p>

          {timeline.entries.length === 0 ? (
            <p>Nothing has happened on this campaign yet.</p>
          ) : (
            <ol className="ops-timeline">
              {timeline.entries.map((entry, i) => {
                const source = TIMELINE_SOURCES.find((s) => s.kind === entry.kind);
                return (
                  <li key={`${entry.occurredAt}-${i}`}>
                    <div className="ops-tags">
                      <Tag>{source?.label ?? entry.kind}</Tag>
                      <span className="field-hint">{when(entry.occurredAt)}</span>
                    </div>
                    <p className="ops-timeline__summary">{entry.summary}</p>
                    <p className="field-hint">
                      {entry.actor ? `${entry.actor} · ` : ''}from <code>{entry.composedFrom}</code>
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      )}
    </section>
  );
}

function EnforcementPanel({
  campaignId,
  state,
  onDone,
}: {
  campaignId: string;
  state: EnforcementState | null;
  onDone: () => void;
}) {
  const [action, setAction] = useState('suspend');
  const [category, setCategory] = useState('');
  const [detail, setDetail] = useState('');
  const [explanation, setExplanation] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  // §26.7: both halves. The server refuses independently — this only stops the
  // Admin submitting something it will refuse.
  const ready = Boolean(category && detail.trim() && explanation.trim());

  const submit = async () => {
    setNotice(null);
    try {
      const result = await enforceCampaign(campaignId, {
        action,
        reasonCategory: category,
        reasonDetail: detail,
        customerExplanation: explanation,
      });
      setNotice(
        `${action === 'kill' ? 'Killed' : 'Suspended'} (${result.phase}). ${result.reservationsClosed} pre-order${
          result.reservationsClosed === 1 ? '' : 's'
        } closed without charge. Effects applied: ${result.effectsApplied.join(', ')}.`,
      );
      setDetail('');
      setExplanation('');
      onDone();
    } catch (error) {
      setNotice(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'That campaign was not changed.',
      );
    }
  };

  return (
    <Card>
      <div className="ops-head">
        <h2>Suspend or kill</h2>
        <Tag>§26.7</Tag>
      </div>

      {state && state.actions.length > 0 && (
        <dl className="kv">
          {state.actions.map((a) => (
            <div className="kv__row" key={a.id}>
              <dt>
                {a.action} · {a.phase}
              </dt>
              <dd>
                {ENFORCEMENT_REASON_LABELS[
                  a.reasonCategory as keyof typeof ENFORCEMENT_REASON_LABELS
                ] ?? a.reasonCategory}
                {' — '}
                {a.reasonDetail} · {a.reservationsClosed} pre-orders closed · {when(a.occurredAt)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <Field label="Action" hint="Suspension pauses; a kill ends the campaign.">
        <Input value={action} onChange={(e) => setAction(e.target.value)} />
      </Field>

      <Field
        label="Reason category"
        hint={`§26.7's eight: ${Object.keys(ENFORCEMENT_REASON_LABELS).join(', ')}`}
      >
        <Input value={category} onChange={(e) => setCategory(e.target.value)} />
      </Field>

      <Field
        label="Reason detail"
        hint="§26.7 requires free text alongside the category. A category alone is a classification nobody can review."
      >
        <Textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} />
      </Field>

      <Field
        label="What the campaign page will say"
        hint="§18 forbids one generic `Campaign ended`. Say why it ended, whether this reader was charged, and where existing Backers get help. No provider or fraud codes."
      >
        <Textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={4} />
      </Field>

      <p className="field-hint">
        Before capture this closes every active pre-order without charge, blocks any future
        PaymentIntent, detaches cards only where reference-safe, notifies affected roles, and keeps
        the page up with the banner. After capture it records the decision — refunds, reversals, and
        recovery are Phase 20.
      </p>

      {notice && <p className="field-hint">{notice}</p>}

      <div className="claim__actions">
        <Button tier="secondary" disabled={!ready} onClick={() => void submit()}>
          Record and apply
        </Button>
      </div>
    </Card>
  );
}

function TouchPanel({
  campaignId,
  state,
  onDone,
}: {
  campaignId: string;
  state: {
    touches: Array<{ id: string; kind: string; note: string; recordedBy: string; occurredAt: string }>;
    kinds: string[];
    note: string;
  } | null;
  onDone: () => void;
}) {
  const [kind, setKind] = useState('');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const logged = new Set((state?.touches ?? []).map((t) => t.kind));

  const submit = async () => {
    setNotice(null);
    try {
      await recordRelationshipTouch(campaignId, { kind, note });
      setKind('');
      setNote('');
      onDone();
    } catch (error) {
      setNotice(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'That touch was not logged.',
      );
    }
  };

  return (
    <Card>
      <div className="ops-head">
        <h2>Human relationship touches</h2>
        <Tag>§26.8</Tag>
      </div>

      <p className="field-hint">
        {state?.note ??
          'One-time personal service events. Each may be logged once per campaign, and there is no way to schedule one.'}
      </p>

      {state && state.touches.length > 0 && (
        <dl className="kv">
          {state.touches.map((t) => (
            <div className="kv__row" key={t.id}>
              <dt>
                {RELATIONSHIP_TOUCH_LABELS[t.kind as keyof typeof RELATIONSHIP_TOUCH_LABELS] ??
                  t.kind}
              </dt>
              <dd>
                {t.note} · {t.recordedBy} · {when(t.occurredAt)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="claim__actions">
        {Object.entries(RELATIONSHIP_TOUCH_LABELS).map(([key, text]) => (
          <Button
            key={key}
            tier="tertiary"
            small
            disabled={logged.has(key)}
            onClick={() => setKind(key)}
          >
            {logged.has(key) ? `${text} — logged` : text}
          </Button>
        ))}
      </div>

      {kind && (
        <>
          <Field
            label={`What happened — ${
              RELATIONSHIP_TOUCH_LABELS[kind as keyof typeof RELATIONSHIP_TOUCH_LABELS] ?? kind
            }`}
            hint="What was actually said or done. Manual work counts when the app records it (§1.3)."
          >
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </Field>
          <div className="claim__actions">
            <Button tier="secondary" disabled={!note.trim()} onClick={() => void submit()}>
              Log it
            </Button>
          </div>
        </>
      )}

      {notice && (
        <p className="field-error" role="alert">
          {notice}
        </p>
      )}
    </Card>
  );
}
