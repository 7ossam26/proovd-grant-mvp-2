/**
 * Admin → Founders — Spec §26.1, §7, DNA §5.2, §5.14.
 *
 * Every Founder Proovd has ever invited, one row each, and one gesture into the
 * workspace that holds the rest.
 *
 * ── A row is a PERSON, not a draft ──────────────────────────────────────────
 * The previous list keyed on `campaign_drafts.id`, so a Founder whose campaign
 * was archived-and-restarted (§9's wrong-type path) appeared twice with no
 * relationship between the rows. `founder_prospects` survives a restart, so the
 * row is the prospect and the address is `/admin/founders/:prospectId`.
 *
 * ── Density is licensed, staging is not repealed ────────────────────────────
 * §26 permits a dashboard here and nowhere else, so this is a table. DNA §5.14
 * still applies: eight columns answer who they are, how far they have got,
 * whether they can be paid, what they are running, and whether anything needs
 * doing — and everything else is one gesture away rather than in a fortieth
 * column nobody reads.
 *
 * ── The server resolved every cell, and this file resolves none ─────────────
 * `setup`, `account`, `paymentSetup`, and `attention` arrive as the words they
 * render. §26.2's override machinery needs a `prior_value` to compare against,
 * and a value the browser derived has none — so nothing here maps a status to a
 * label or decides whether a Founder needs attention.
 *
 * ── The row is clickable; the NAME is the control ───────────────────────────
 * A `<tr>` carrying `role="button"` breaks the table's required children and
 * fails axe, and a bare `tabindex` on a row is focusable without being
 * announced as anything. So the Founder's name is a real link — keyboard
 * reachable, announced, and Enter opens it — and the row's own click handler is
 * mouse convenience layered on top, which ignores presses that landed on a
 * control of their own.
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import {
  ATTENTION_CHIP_LABEL,
  NO_ACTIVE_CAMPAIGN_LABEL,
  NO_ATTENTION_ROW_LABEL,
} from '@proovd/shared';
import { Button, StatePanel } from '../../../components/index.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import { fetchFounders, AdminRequestError, type FounderListRow } from '../api.js';
import { AddFounderDialog } from './dialogs/AddFounderDialog.js';
import { useParkedControl } from './parked.js';

export function FoundersList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<FounderListRow[] | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  /**
   * The element the add panel grows from (DNA §6.5), and the fact that it is
   * open. One piece of state rather than two, because a dialog with no trigger
   * has nowhere to grow from and a trigger with no dialog is not a state.
   */
  const [addTrigger, setAddTrigger] = useState<HTMLElement | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setLoadError(null);
    fetchFounders()
      .then(({ founders }) => setRows(founders))
      .catch((error: unknown) => {
        setLoadError(
          error instanceof AdminRequestError
            ? error
            : new AdminRequestError({
                error: 'unreachable',
                status: 0,
                title: 'Proovd could not be reached',
                whatHappened:
                  'The Founders list could not be read, and the failure carried no explanation.',
                next: 'Try the read again. Nothing was changed by the attempt.',
              }),
        );
      });
  }, []);

  useEffect(load, [load]);

  // The headline reveal and the row rise are declarative recipes; this re-binds
  // them when the list arrives, because the runtime attaches to the nodes that
  // existed when it last ran and React has replaced them by then.
  useProovdMotion(surface, [rows]);

  return (
    <div ref={surface}>
      <div className="people-head">
        <div>
          <p className="kicker">Founders</p>
          <h1 className="h2" data-reveal="headline">
            Invited by hand. Managed from here.
          </h1>
          {rows ? (
            <p className="grey">
              {rows.length} {rows.length === 1 ? 'Founder' : 'Founders'}. Open one for the full
              workspace — invitation, identity, campaigns, money, and history.
            </p>
          ) : null}
        </div>
        <Button onClick={(event) => setAddTrigger(event.currentTarget)}>Add founder</Button>
      </div>

      {addTrigger ? (
        <AddFounderDialog
          trigger={addTrigger}
          onClose={() => setAddTrigger(null)}
          onCreated={(prospectId) => {
            // The done-moment is their workspace, not a row appearing in a
            // table (DNA §5.4): the next thing an Admin does is compose the
            // invitation. The list is refreshed behind it so a Back lands on a
            // current page.
            load();
            void navigate(`/admin/founders/${prospectId}`);
          }}
        />
      ) : null}

      {loadError ? (
        <StatePanel
          state={loadError.detail.title}
          whatHappened={
            loadError.detail.whatHappened ??
            'The Founders list could not be read, so nothing on this page is current.'
          }
          next={loadError.detail.next ?? 'Try the read again. Nothing was changed by the attempt.'}
          owner="Proovd"
          nextUpdate="When you try again"
          action={
            <Button tier="secondary" onClick={load}>
              Try the read again
            </Button>
          }
          reference="Admin · Founders"
          ring
        />
      ) : !rows ? (
        <StatePanel
          state="Reading the Founders list"
          whatHappened="Proovd is reading every Founder, their setup stage, and what needs attention."
          next="The table appears as soon as that comes back."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action="No action needed"
          reference="Admin · Founders"
        />
      ) : rows.length === 0 ? (
        <StatePanel
          state="No Founders yet"
          whatHappened="Nobody has been recorded from off-platform discovery, so there is nobody to invite."
          next="Add a Founder when you have met one. Nothing is sent until you compose the invitation and send it."
          owner="You"
          nextUpdate="No update is pending"
          action={
            <Button
              tier="secondary"
              onClick={(event) => setAddTrigger(event.currentTarget)}
            >
              Add founder
            </Button>
          }
          reference="Admin · Founders"
        />
      ) : (
        <FoundersTable rows={rows} />
      )}
    </div>
  );
}

/* ── The table ─────────────────────────────────────────────────────────────── */

function FoundersTable({ rows }: { rows: FounderListRow[] }) {
  const navigate = useNavigate();
  const parked = useParkedControl();

  /**
   * Mouse convenience only. A press that landed on the name link, or on the
   * parked campaign control, has already been answered — opening the workspace
   * on top of it would be two answers to one click.
   */
  function openRow(event: MouseEvent<HTMLTableRowElement>, prospectId: string) {
    if ((event.target as HTMLElement).closest('a, button')) return;
    void navigate(`/admin/founders/${prospectId}`);
  }

  return (
    <div className="tablewrap">
      <table className="table fdr-table">
        <caption className="admin-table__caption">
          Setup stage, account standing, payment setup, current campaign, and what needs attention.
        </caption>
        <thead>
          <tr>
            <th scope="col">Founder</th>
            <th scope="col">Email</th>
            <th scope="col">Setup</th>
            <th scope="col">Account</th>
            <th scope="col">Payment setup</th>
            <th scope="col">Current campaign</th>
            <th scope="col">Campaign status</th>
            <th scope="col">Attention</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.prospectId}
              className="fdr-row"
              data-scroll="rise"
              onClick={(event) => openRow(event, row.prospectId)}
            >
              <td>
                <RouterLink className="fdr-name" to={`/admin/founders/${row.prospectId}`}>
                  <b>{row.legalName}</b>
                </RouterLink>
                <span className="fdr-sub">{row.productName}</span>
              </td>
              <td className="grey">{row.email}</td>
              <td>
                {row.setup.stage}
                {row.setup.detail ? <span className="fdr-sub">{row.setup.detail}</span> : null}
              </td>
              <td>{row.account}</td>
              <td>{row.paymentSetup}</td>
              <td>
                {row.currentCampaign ? (
                  <button type="button" className="camp-link" {...parked('campaign')}>
                    {row.currentCampaign.name}
                  </button>
                ) : (
                  <span className="grey">{NO_ACTIVE_CAMPAIGN_LABEL}</span>
                )}
              </td>
              <td className="grey">
                {row.currentCampaign ? row.currentCampaign.status : 'Not running a campaign'}
              </td>
              <td>
                {row.attention.needed ? (
                  <>
                    <span className="att-chip">{ATTENTION_CHIP_LABEL}</span>
                    <span className="fdr-sub att-note">{row.attention.text}</span>
                  </>
                ) : (
                  <span className="grey">{NO_ATTENTION_ROW_LABEL}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
