/**
 * Admin — the §12 optional items, their evidence, and the fee.
 *
 * §12: "Admin sees every item, evidence, status, discount line, high-effort
 * inputs, fee preview, interview state, invalidation history, and override. A
 * manual override requires prior value, new value, reason, actor, time, and
 * evidence."
 *
 * Every clause is on this page. §26 licenses dashboard density here and nowhere
 * else, so the evidence snapshot is rendered raw rather than summarised — an
 * Admin deciding whether to invalidate an item needs to see what the rule
 * actually saw, not a paraphrase of it.
 *
 * ── The two acts are kept apart on purpose ──────────────────────────────────
 * `Invalidate` takes a completion away and hands the Founder a correction.
 * `Override` grants or removes one on Proovd's authority and is recorded as
 * `admin_override` for the rest of the campaign's life. Presenting them as one
 * control with a checkbox would blur the difference §12 is careful about — the
 * first is a judgement about evidence, the second is a decision without it.
 *
 * ── Nothing here computes money ─────────────────────────────────────────────
 * The fee lines come from the server, as they do on the Founder's surface. Two
 * implementations of §12's arithmetic is exactly how the preview and the charge
 * come to disagree.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { formatUsd, OPTIONAL_ITEMS, EVIDENCE_REJECTIONS } from '@proovd/shared';
import { Button, Card, Field, Input, Tag, Textarea } from '../../components/index.js';
import {
  fetchAdminWorkspace,
  recheckWorkspace,
  invalidateOptionalItem,
  reinstateOptionalItem,
  overrideOptionalItem,
  AdminRequestError,
  type AdminWorkspace,
  type AdminOptionalItem,
  type AdminOptionalItemKey,
} from './api.js';

const LABEL = new Map(OPTIONAL_ITEMS.map((i) => [i.key, i.label]));
const usd = (cents: string) => formatUsd(BigInt(cents));
const rejection = (code: string) =>
  (EVIDENCE_REJECTIONS as Record<string, string>)[code] ?? code;

function ItemPanel({
  campaignId,
  item,
  onChanged,
}: {
  campaignId: string;
  item: AdminOptionalItem;
  onChanged: (workspace: AdminWorkspace | null) => void;
  }) {
  const [reason, setReason] = useState('');
  const [explanation, setExplanation] = useState('');
  const [evidence, setEvidence] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function run(action: () => Promise<{ workspace: AdminWorkspace | null }>) {
    setFailure(null);
    try {
      const { workspace } = await action();
      onChanged(workspace);
      setReason('');
      setExplanation('');
      setEvidence('');
      setOpen(false);
    } catch (error) {
      setFailure(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'That could not be recorded.',
      );
    }
  }

  return (
    <Card>
      <div className="admin-item__head">
        <h3 className="section-title">{LABEL.get(item.item) ?? item.item}</h3>
        <Tag variant={item.complete ? 'moss' : 'default'}>
          {item.complete ? 'Complete' : 'Not complete'}
        </Tag>
        {item.decisionSource ? <Tag variant="sage">{item.decisionSource}</Tag> : null}
        {item.locked ? <Tag variant="mint">Locked at payment</Tag> : null}
      </div>

      {item.rejections.length > 0 ? (
        <ul className="admin-item__reasons">
          {item.rejections.map((code) => (
            <li key={code}>{rejection(code)}</li>
          ))}
        </ul>
      ) : null}

      {item.invalidated.at ? (
        <p className="fine">
          Invalidated {new Date(item.invalidated.at).toLocaleString()} by {item.invalidatedBy}.
          Internal reason: {item.invalidatedReason}. Founder sees: {item.invalidated.explanation}
        </p>
      ) : null}

      {/* §12: "evidence". Raw, because §26's density belongs here and a
          summarised snapshot is not the thing the rule decided on. */}
      <details className="admin-item__evidence">
        <summary>Evidence snapshot</summary>
        <pre>{JSON.stringify(item.evidence, null, 2)}</pre>
      </details>

      {item.locked ? (
        <p className="fine">
          The listing fee has been paid, so this item and its evidence are fixed (§12).
        </p>
      ) : !open ? (
        <Button tier="tertiary" small onClick={() => setOpen(true)}>
          Record a decision
        </Button>
      ) : (
        <div className="admin-item__form">
          <Field label="Internal reason" hint="Stored with the change. Never shown to the Founder.">
            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <Field
            label="What the Founder will read"
            hint="Required for an invalidation — they cannot correct what they cannot read."
          >
            <Textarea
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
            />
          </Field>
          <Field
            label="Evidence"
            hint="Required for an override. A ticket, a call, a file received out of band."
          >
            <Input value={evidence} onChange={(event) => setEvidence(event.target.value)} />
          </Field>

          <div className="admin-item__actions">
            {item.invalidated.at ? (
              <Button
                tier="secondary"
                small
                disabled={!reason.trim()}
                onClick={() =>
                  void run(() => reinstateOptionalItem(campaignId, item.item, reason.trim()))
                }
              >
                Lift the invalidation
              </Button>
            ) : (
              <Button
                tier="secondary"
                small
                disabled={!reason.trim() || !explanation.trim()}
                onClick={() =>
                  void run(() =>
                    invalidateOptionalItem(campaignId, item.item, {
                      reason: reason.trim(),
                      explanation: explanation.trim(),
                    }),
                  )
                }
              >
                Invalidate
              </Button>
            )}

            <Button
              tier="tertiary"
              small
              disabled={!reason.trim() || !explanation.trim() || !evidence.trim()}
              onClick={() =>
                void run(() =>
                  overrideOptionalItem(campaignId, item.item, {
                    complete: !item.complete,
                    reason: reason.trim(),
                    explanation: explanation.trim(),
                    evidence: evidence.trim(),
                  }),
                )
              }
            >
              {item.complete ? 'Override to not complete' : 'Override to complete'}
            </Button>
          </div>

          {failure ? <p className="field__error">{failure}</p> : null}
        </div>
      )}
    </Card>
  );
}

export function CampaignWorkspacePanel() {
  const [params] = useSearchParams();
  const campaignId = params.get('campaign') ?? '';
  const [workspace, setWorkspace] = useState<AdminWorkspace | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!campaignId) return;
    const response = await fetchAdminWorkspace(campaignId);
    setWorkspace(response.workspace);
    setNote(response.whatHappened ?? null);
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!campaignId) {
    return (
      <Card>
        <p className="lede">Open this from a campaign to see its optional items.</p>
      </Card>
    );
  }

  if (!workspace) {
    return (
      <Card>
        <p className="lede">{note ?? 'Loading.'}</p>
      </Card>
    );
  }

  return (
    <div className="admin-workspace">
      <header className="admin-workspace__head">
        <h1 className="page-title">Optional items and listing fee</h1>
        <Button
          tier="tertiary"
          small
          onClick={() => void recheckWorkspace(campaignId).then((r) => setWorkspace(r.workspace))}
        >
          Re-run the checks
        </Button>
      </header>

      {workspace.fee ? (
        <Card>
          <h2 className="section-title">Fee preview</h2>
          <dl className="fee-preview">
            <div className="fee-preview__row">
              <dt>Base</dt>
              <dd>{usd(workspace.fee.baseCents)}</dd>
            </div>
            {workspace.fee.discountLines.map((line) => (
              <div className="fee-preview__row fee-preview__row--saving" key={line.item}>
                <dt>{LABEL.get(line.item) ?? line.item}</dt>
                <dd>−{usd(line.discountCents)}</dd>
              </div>
            ))}
            <div className="fee-preview__row fee-preview__row--total">
              <dt>Subtotal</dt>
              <dd>{usd(workspace.fee.subtotalCents)}</dd>
            </div>
          </dl>
          <p className="fine">{workspace.fee.separateStreamNote}</p>
          <p className="fine">
            Tax is calculated at Checkout. {workspace.fee.locked ? 'This calculation is locked.' : ''}
          </p>
        </Card>
      ) : null}

      {workspace.highEffort ? (
        <Card>
          <h2 className="section-title">High effort</h2>
          <p className="lede">{workspace.highEffort.highEffort ? 'true' : 'false'}</p>
          <ul className="admin-item__reasons">
            <li>Visuals complete: {String(workspace.highEffort.visualsCompleted)}</li>
            <li>Branding complete: {String(workspace.highEffort.brandingCompleted)}</li>
            <li>
              Interview scheduled or confirmed:{' '}
              {String(workspace.highEffort.interviewScheduledOrConfirmed)}
            </li>
          </ul>
          <p className="fine">
            Calculated{' '}
            {workspace.highEffort.calculatedAt
              ? new Date(workspace.highEffort.calculatedAt).toLocaleString()
              : '—'}
            . Controls whether a Creator may bid above the base percentage. It does not control
            fixed-payment availability (§12).
          </p>
        </Card>
      ) : null}

      {workspace.items.map((item) => (
        <ItemPanel
          key={item.item}
          campaignId={campaignId}
          item={item}
          onChanged={(next) => setWorkspace(next)}
        />
      ))}

      <Card>
        <h2 className="section-title">Interview</h2>
        {workspace.interview.configuration.bookable ? (
          <p className="lede">
            Bookable. Interviewers: {workspace.interview.configuration.interviewers.join(', ')}
          </p>
        ) : (
          <p className="lede">
            Not bookable — these §6 settings have no value:{' '}
            {workspace.interview.configuration.missingSettings.join(', ')}
          </p>
        )}
        <details>
          <summary>Booking history</summary>
          <pre>{JSON.stringify(workspace.interview.history, null, 2)}</pre>
        </details>
      </Card>

      {/* §12: "invalidation history". Append-only, written by trigger. */}
      <Card>
        <h2 className="section-title">Decision history</h2>
        <ul className="admin-history">
          {workspace.itemHistory.map((entry) => (
            <li key={entry.id}>
              <strong>{LABEL.get(entry.item as AdminOptionalItemKey) ?? entry.item}</strong>{' '}
              {entry.event} — {entry.actor} — {new Date(entry.occurredAt).toLocaleString()}
              {entry.reason ? <span className="fine"> · {entry.reason}</span> : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
