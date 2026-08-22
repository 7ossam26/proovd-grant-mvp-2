/**
 * Support cases on this record — Spec §31.
 *
 * The lead is the reference's own and states the rule that matters: a case does
 * not belong to a campaign stage, so it stays visible from every one of them. A
 * case that disappeared when a campaign moved on is a person who stopped
 * getting answers.
 *
 * ── "Open" is decided once ──────────────────────────────────────────────────
 * `openCaseCount` is the single derivation of what counts as open, and both the
 * record bar's `Support (n)` and this sheet's heading render it. Two counts
 * computed in two places is two numbers that eventually disagree in front of
 * somebody on a support call.
 *
 * ── Opening a case from here is not built ───────────────────────────────────
 * `POST /api/admin/support/cases` exists, but it requires a topic and an owner
 * from §31's enumerations and the account id of whoever asked. This sheet is
 * handed none of the three, and choosing them on a person's behalf would file a
 * case whose topic and owner nobody decided (§1 rule 6). The reason stands where
 * the action would be, and it names the surface that does own the act.
 */

import type { FounderOperationsView } from '../api.js';
import { Overlay } from './Overlay.js';

type SupportCase = FounderOperationsView['supportCases'][number];

/** Everything the server did not label `Resolved`. One derivation, two readers. */
export function openCaseCount(cases: readonly SupportCase[] | undefined): number {
  return (cases ?? []).filter((supportCase) => supportCase.status !== 'Resolved').length;
}

interface Props {
  cases: readonly SupportCase[];
  onOpenDetail: (title: string, body: string) => void;
  onClose: () => void;
}

export function SupportDialog({ cases, onOpenDetail, onClose }: Props) {
  const open = openCaseCount(cases);

  return (
    <Overlay label="Support" onClose={onClose}>
      <p className="dialog-kicker">Support</p>
      <h2>
        {open} open case{open === 1 ? '' : 's'}
      </h2>
      <p className="dialog-lead">Cases remain visible regardless of the campaign stage.</p>
      <div className="support-list">
        {cases.map((supportCase) => (
          <button
            key={supportCase.caseId}
            type="button"
            onClick={() =>
              onOpenDetail(
                `${supportCase.reference} · ${supportCase.subject ?? 'No subject recorded'}`,
                [
                  `Status: ${supportCase.status}`,
                  `Owner: ${supportCase.owner}`,
                  `Human response due: ${supportCase.due ?? 'Not recorded'}`,
                ].join('\n'),
              )
            }
          >
            <span>{supportCase.reference}</span>
            <strong>{supportCase.subject ?? 'No subject recorded'}</strong>
            <small>
              {supportCase.status} · {supportCase.owner}
            </small>
          </button>
        ))}
        {cases.length === 0 ? <p className="empty">No cases on this record.</p> : null}
      </div>
      <div className="dialog-actions">
        <small>
          Opening a case needs a topic and an owner, which this sheet does not ask for. Open it in
          the Support section, where the newest eight cases here also live in full.
        </small>
      </div>
    </Overlay>
  );
}
