/**
 * The relationship's Overview — §16, §17, §18, §31.5.
 *
 * What needs doing, the tracking link, §16's readiness checklist, and the
 * Campaign kit's access record. Everything on it is read; the one control that
 * writes is the link pause, and it is gated.
 */

import { useState } from 'react';
import { ATTRIBUTION_FOOTNOTE } from '@proovd/shared';
import { Button, Copylink } from '../../../../components/index.js';
import { cn } from '../../../../components/cn.js';
import type { CreatorRelationshipDetail, RelationshipTask } from '../api.js';
import { Group, Note, OwnerPill, Section } from '../shared.js';
import { useCreatorParked } from '../parked.js';
import { LinkControlsDialog } from '../dialogs/LinkControlsDialog.js';
import type { RelationshipOp } from '../dialogs/RelationshipOpsDialog.js';

export function RelOverview({
  detail,
  tasks,
  onGo,
  onOp,
  onChanged,
}: {
  detail: CreatorRelationshipDetail;
  tasks: RelationshipTask[];
  onGo: (to: 'review' | 'agreement' | 'money' | 'profile') => void;
  onOp: (op: RelationshipOp, trigger: HTMLElement | null) => void;
  onChanged: (detail: CreatorRelationshipDetail) => void;
}) {
  const parked = useCreatorParked();
  const [linkTrigger, setLinkTrigger] = useState<HTMLElement | null>(null);
  const { overview } = detail;

  return (
    <div className="cr-stack">
      {/*
        One card per real task, in the order the server ranked them. A task
        Proovd owns gets a control; one somebody else owns does not, because
        offering a button for another party's work claims a capability the
        product does not have (§1.4).
      */}
      {tasks.length === 0 ? (
        <p className="cr-caught-up">Nothing needs doing on this relationship right now.</p>
      ) : (
        tasks.map((task, index) => (
          <section
            key={`${task.title}-${index}`}
            className={cn('cr-task', task.kind === 'waiting' && 'cr-task--waiting')}
          >
            <div>
              <OwnerPill owner={task.owner} prefix />
              <h3>{task.title}</h3>
              <p>{task.meta}</p>
            </div>
            {task.action && task.owner === 'Admin' ? (
              <Button onClick={() => onGo(task.action!.to)}>{task.action.label}</Button>
            ) : task.action ? (
              <Button tier="secondary" onClick={() => onGo(task.action!.to)}>
                {task.action.label}
              </Button>
            ) : null}
          </section>
        ))
      )}

      {/* ── The tracking link ─────────────────────────────────────────────── */}
      <Section
        eyebrow="Affiliate link"
        title={overview.link?.label ?? 'No Affiliate link yet'}
        actions={
          overview.link ? (
            <Button
              tier="secondary"
              small
              onClick={(event) => setLinkTrigger(event.currentTarget)}
            >
              Affiliate link history &amp; controls
            </Button>
          ) : null
        }
      >
        {overview.link ? (
          <>
            <Copylink url={overview.link.url ?? ''} />
            <Group>
              <div className="frow">
                <dt>Activated</dt>
                <dd>
                  {overview.link.activatedAt ?? (
                    <span className="grey">
                      Not activated yet — a click before activation earns nothing
                    </span>
                  )}
                </dd>
              </div>
              {overview.link.pausedAt ? (
                <div className="frow">
                  <dt>Paused</dt>
                  <dd>
                    {overview.link.pausedAt}
                    {overview.link.pausedReason ? (
                      <p className="helper">{overview.link.pausedReason}</p>
                    ) : null}
                  </dd>
                </div>
              ) : null}
              <div className="frow">
                <dt>Safe test link</dt>
                <dd>
                  <span className="fval">{overview.link.testUrl}</span>
                  {/*
                    §14.1's safe test. The marker is read by its exact name at
                    the ingest, which records the click as ignored and sets no
                    cookie — an Admin checking a link cannot attribute one.
                  */}
                  <p className="helper">
                    Records the click as a test. It sets no attribution cookie and can never
                    replace an existing one.
                  </p>
                </dd>
              </div>
            </Group>
          </>
        ) : (
          <p className="grey">
            A tracking link is minted when the formal terms are accepted, and activated at
            launch (§14.2, §17).
          </p>
        )}
      </Section>

      {/* ── §16's readiness ───────────────────────────────────────────────── */}
      <Section
        eyebrow="Creator readiness"
        title={
          overview.readiness
            ? overview.readiness.canBeginWork
              ? 'Cleared to begin work'
              : 'Readiness incomplete'
            : 'Readiness not yet gathered'
        }
        aside={
          overview.readiness ? (
            <span className="cr-count">
              {overview.readiness.complete} of {overview.readiness.applicable}
            </span>
          ) : null
        }
        actions={
          <>
            <Button
              tier="secondary"
              small
              onClick={(event) => onOp('confirm_deliverables', event.currentTarget)}
            >
              Confirm required posts and deliverables
            </Button>
            <Button
              tier="secondary"
              small
              onClick={(event) => onOp('funding_deadline', event.currentTarget)}
            >
              Set the funding deadline
            </Button>
            <Button
              tier="tertiary"
              small
              onClick={(event) => onOp('evaluate', event.currentTarget)}
            >
              Re-derive readiness
            </Button>
          </>
        }
      >
        {overview.readiness ? (
          <>
            <div className="checklist" role="list">
              {overview.readiness.items.map((item) => (
                <div
                  className="check-line"
                  role="listitem"
                  key={item.key}
                  aria-label={`${item.label} — ${
                    !item.applicable
                      ? 'not applicable'
                      : item.complete
                        ? 'done'
                        : 'not done yet'
                  }`}
                >
                  <span
                    className={cn(
                      'phase__mark',
                      item.complete ? 'phase__mark--done' : 'phase__mark--next',
                    )}
                    aria-hidden="true"
                  >
                    {item.complete ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <polyline points="4 13 10 19 20 6" />
                      </svg>
                    ) : null}
                  </span>
                  <span className={item.complete ? undefined : 'grey'}>
                    {item.label}
                    {!item.applicable ? ' · not applicable' : ''}
                  </span>
                  <span className="cr-owner-note">{item.owner}</span>
                </div>
              ))}
            </div>
            {/*
              §16's rule, stated where somebody would otherwise round up.

              Deliberately not phrased with §3.2's banned term for this shape:
              it is banned EVERYWHERE, including where it would be describing a
              readiness checklist rather than a charge, and §33.11.3 scans the
              shipped bundle for it. Saying what the rule does is clearer anyway.
            */}
            <Note>
              §16 readiness is complete or it is not: twelve of thirteen still blocks.
              Nothing here can be marked complete by hand — every item is derived from the
              record that holds it.
            </Note>
          </>
        ) : (
          <p className="grey">
            The thirteen §16 facts have not been gathered for this relationship yet.
          </p>
        )}
      </Section>

      {/* ── §31.5's Campaign kit access ───────────────────────────────────── */}
      <Section
        eyebrow="Campaign kit"
        title={
          overview.kit.revokedAt
            ? 'Kit access revoked'
            : overview.kit.revealedAt
              ? 'Kit access granted'
              : 'Kit not revealed yet'
        }
        actions={
          <>
            <Button
              tier="secondary"
              small
              onClick={(event) => onOp('access_log', event.currentTarget)}
            >
              View the access log
            </Button>
            {overview.kit.revealedAt === null ? (
              <Button
                tier="secondary"
                small
                onClick={(event) => onOp('reveal', event.currentTarget)}
              >
                Reveal the preparing campaign
              </Button>
            ) : null}
            {overview.kit.revealedAt !== null && overview.kit.revokedAt === null ? (
              <Button
                tier="tertiary"
                small
                onClick={(event) => onOp('revoke_kit', event.currentTarget)}
              >
                Revoke kit access
              </Button>
            ) : null}
            <Button tier="tertiary" small {...parked('kitVisuals')}>
              Open visual Campaign kit
            </Button>
          </>
        }
      >
        <Group>
          <div className="frow">
            <dt>Revealed</dt>
            <dd>{overview.kit.revealedAt ?? <span className="grey">Not revealed yet</span>}</dd>
          </div>
          <div className="frow">
            <dt>Access</dt>
            <dd>Private · campaign-scoped · every read logged</dd>
          </div>
          <div className="frow">
            <dt>Reads recorded</dt>
            <dd>
              {overview.kit.accessCount}
              {overview.kit.lastAccessAt ? (
                <p className="helper">Last read {overview.kit.lastAccessAt}</p>
              ) : null}
            </dd>
          </div>
          {overview.kit.revokedAt ? (
            <div className="frow">
              <dt>Revoked</dt>
              <dd>
                {overview.kit.revokedAt}
                {overview.kit.revokedReason ? (
                  <p className="helper">{overview.kit.revokedReason}</p>
                ) : null}
              </dd>
            </div>
          ) : null}
        </Group>
        <Note>
          §31.5 permits the pre-view only while it stays private, authenticated, logged,
          campaign-scoped, and revocable. The kit grants no work permission and creates no
          commercial terms.
        </Note>
      </Section>

      {/* The footnote §18 requires wherever this surface implies traffic. */}
      <Note>{ATTRIBUTION_FOOTNOTE}</Note>

      {linkTrigger && overview.link ? (
        <LinkControlsDialog
          prospectId={detail.prospectId}
          associationId={detail.associationId}
          link={overview.link}
          trigger={linkTrigger}
          onClose={() => setLinkTrigger(null)}
          onDone={(next) => {
            onChanged(next);
            setLinkTrigger(null);
          }}
        />
      ) : null}
    </div>
  );
}
