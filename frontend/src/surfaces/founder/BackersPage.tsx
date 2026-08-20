/**
 * The Founder's backers — Founder Dashboard Session F (F2, F3, F4).
 *
 * §19's operational share, finally on a Founder surface. The share is written
 * at pre-order by five services and has been readable by nobody since Phase
 * 15a; §19 calls it MANDATORY and disclosed before consent, so this is a
 * compliance gap closed rather than a feature.
 *
 * ── A page rather than a chapter, which is the reference's own architecture ──
 * "A chapter's home is a HUB… everything that manages detail — the backers, the
 * numbers behind the numbers — is its own PAGE, reached by a link and left by a
 * back control that always sits in the upper left." It is linked from Chapter 2
 * (a live campaign has people to support) and from Chapter 4 (a finished one has
 * rewards to deliver), so it belongs to neither and sits at its own address.
 *
 * ── A withdrawn share renders as what it is ─────────────────────────────────
 * `do_not_fulfill` rows are shown, not filtered. The failure mode is silent: a
 * row presented as deliverable when the money never moved is a Founder shipping
 * to somebody who was never charged, and neither side finds out until it
 * arrives. The pinned sentence replaces the enum value, because "do_not_fulfill"
 * is an internal name and the Founder is being told a fact about somebody's
 * money (§3.1).
 *
 * ── The export names what it withholds before the button is pressed ─────────
 * §20's Explore section 10, and 16a's rule about the Admin ledger export
 * applied to the Founder side. The column list and the withheld list both come
 * from the SERVER's register — this file has no column names in it — so a limit
 * the browser could widen does not exist.
 *
 * ── §25.7's two purposes, and two refusals with their reasons on screen ─────
 * The reference offers marketing follow-up, adding backers to a community, and
 * customer support. §25.7 permits the third and, with fulfillment, only that.
 * Both refusals render where the option would have been.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import {
  BACKER_DATA_PURPOSES,
  BACKER_DATA_REQUEST_GRANTS_NO_ACCESS,
  DO_NOT_FULFILL_NOTE,
  EXPORT_CANNOT_CARRY_A_CONSENT_CONDITION,
  EXPORT_IS_FOR_FULFILLMENT,
  REFUSED_BACKER_DATA_PURPOSES,
  founderDashboardPath,
  wrapAbsence,
} from '@proovd/shared';
import {
  Button,
  Choice,
  Field,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Stat,
  Tag,
  Textarea,
} from '../../components/index.js';
import { SurfaceLoading, supportMailto } from '../../features/public/states.js';
import {
  fetchFounderBackers,
  founderBackerExportPath,
  requestBackerData,
  FounderRequestError,
  type FounderBackersView,
} from './api.js';

function localDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
}

function refusalText(caught: unknown, fallback: string): string {
  return caught instanceof FounderRequestError
    ? (caught.detail.whatHappened ?? fallback)
    : 'The request did not complete. Nothing was changed.';
}

/* ── §25.7's ask ──────────────────────────────────────────────────────────── */

function DataRequest({
  campaignId,
  view,
  onChanged,
}: {
  campaignId: string;
  view: FounderBackersView;
  onChanged: () => void;
}) {
  const [purpose, setPurpose] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const open = view.dataRequests.find((request) => request.status === 'open') ?? null;

  async function send() {
    setBusy(true);
    setFailure(null);
    try {
      await requestBackerData(campaignId, purpose, detail);
      setPurpose('');
      setDetail('');
      onChanged();
    } catch (error: unknown) {
      setFailure(refusalText(error, 'We could not record that request.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="backers-request" className="fd-backers__ask">
      <h2 className="h3" id="backers-request">
        Ask for more than this
      </h2>
      <p>{BACKER_DATA_REQUEST_GRANTS_NO_ACCESS}</p>

      {open ? (
        <StatePanel
          state="Your request is with Proovd"
          whatHappened={`You asked on ${localDate(open.requestedAt)} — “${open.detail}”`}
          next="A person reads it and answers you. There is nothing else to do here."
          owner="Proovd"
          nextUpdate="When Proovd answers"
          action={NO_ACTION}
          reference={open.id}
          getHelp={{ href: supportMailto(`Backer data request — ${campaignId}`) }}
        />
      ) : (
        <>
          {failure ? <p role="alert">{failure}</p> : null}
          <Choice
            name="backer-data-purpose"
            label="What do you need it for?"
            value={purpose}
            onValueChange={setPurpose}
            entries={BACKER_DATA_PURPOSES.map((entry) => ({
              value: entry.key as string,
              label: entry.label,
              sub: entry.basis,
            }))}
          />
          {/* §25.7's two refusals, where the reference put two more options. */}
          <p className="fd-absence">{wrapAbsence('marketing_purpose').absentBecause}</p>
          <ul className="fd-backers__refused">
            {REFUSED_BACKER_DATA_PURPOSES.map((entry) => (
              <li key={entry.key}>
                <span className="fd-backers__refused-label">{entry.label}</span>
                <span className="fd-absence">{entry.refusedBecause}</span>
              </li>
            ))}
          </ul>
          <Field label="What do you need, exactly?" id="backer-data-detail">
            <Textarea
              rows={3}
              value={detail}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDetail(value);
              }}
            />
          </Field>
          <Button onClick={() => void send()} disabled={busy || purpose === '' || detail.trim() === ''}>
            Send this to Proovd
          </Button>
        </>
      )}

      {view.dataRequests.filter((request) => request.status !== 'open').length > 0 ? (
        <>
          <p className="kicker">Answered</p>
          <ul className="doc-list">
            {view.dataRequests
              .filter((request) => request.status !== 'open')
              .map((request) => (
                <li key={request.id}>
                  <strong>{request.status === 'approved' ? 'Approved' : 'Declined'}</strong>{' '}
                  {localDate(request.decidedAt)} — {request.decisionNote}
                </li>
              ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/* ── The page ─────────────────────────────────────────────────────────────── */

export function BackersPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>();
  const [view, setView] = useState<FounderBackersView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchFounderBackers(campaignId);
      setView(result.backers);
    } catch (error: unknown) {
      setFailure(refusalText(error, 'We could not load your backers.'));
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failure) {
    return (
      <Section aria-labelledby="backers-error">
        <Measure>
          <h1 className="h2" id="backers-error">
            We could not load your backers
          </h1>
          <StatePanel
            state="This page did not load"
            whatHappened={failure}
            next="Reload the page. Nothing about your campaign changed."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: supportMailto(`Backers — ${campaignId}`) }}
          />
        </Measure>
      </Section>
    );
  }

  if (!view) return <SurfaceLoading subject="your backers" reference={campaignId} />;

  return (
    <Section aria-labelledby="backers-heading">
      <Measure>
        {/* The back control, upper left — the reference's own page shape. */}
        <p className="fd-backers__back">
          <RouterLink to={founderDashboardPath(campaignId)}>Back to your campaign</RouterLink>
        </p>

        <p className="kicker">Backers</p>
        <h1 className="h2" id="backers-heading">
          {view.sharedCount === 1
            ? '1 person, with what they chose.'
            : `${String(view.sharedCount)} people, with what they chose.`}
        </h1>
        <p className="lede">{EXPORT_IS_FOR_FULFILLMENT}</p>

        <div className="fd-backers__figures">
          <Stat
            variant="mint"
            value={String(view.activeCount)}
            sub="Pre-orders you owe a reward for right now."
          />
          {view.doNotFulfillCount > 0 ? (
            <Stat
              variant="white"
              value={String(view.doNotFulfillCount)}
              sub={DO_NOT_FULFILL_NOTE}
            />
          ) : null}
        </div>

        {/* §20 Explore 10 — the withheld columns before the button. */}
        <section aria-labelledby="backers-export">
          <h2 className="h3" id="backers-export">
            Download the list
          </h2>
          <p className="kicker">What the file carries</p>
          <ul className="doc-list">
            {view.exportColumns.map((column) => (
              <li key={column.key}>
                <strong>{column.header}</strong> — {column.definition}
              </li>
            ))}
          </ul>
          <p className="kicker">What it does not</p>
          <ul className="doc-list">
            {view.exportWithheld.map((column) => (
              <li key={column.header}>
                <strong>{column.header}</strong> — {column.reason}
              </li>
            ))}
          </ul>
          <p className="fd-note">{EXPORT_CANNOT_CARRY_A_CONSENT_CONDITION}</p>
          <p className="fd-absence">{wrapAbsence('export_names_and_comments').absentBecause}</p>
          {/*
            A plain link, so the browser downloads what the SERVER composed.
            Nothing here assembles a row or chooses a column — the register is
            read server-side, which is what makes it a limit.
          */}
          <p>
            <a className="btn btn--secondary" href={founderBackerExportPath(campaignId)} download>
              Download the pre-order list
            </a>
          </p>
        </section>

        {/* §19's own rows. §31.8's step comes from the same rule the Backer's
            own page uses, so the two can never disagree about where somebody is. */}
        <section aria-labelledby="backers-list">
          <h2 className="h3" id="backers-list">
            Everyone who pre-ordered
          </h2>
          {view.rows.length === 0 ? (
            <p>Nobody has pre-ordered yet. This fills in as people check out.</p>
          ) : (
            <ul className="fd-backers__rows">
              {view.rows.map((row) => (
                <li key={row.preorderReference}>
                  <span className="fd-backers__email">{row.backerEmail}</span>
                  <span className="fd-backers__reward">{row.rewardTitle}</span>
                  <span className="fd-backers__step">
                    {row.doNotFulfillLabel ? (
                      <Tag>{row.doNotFulfillLabel}</Tag>
                    ) : (
                      <Tag variant="moss">{row.progressionLabel}</Tag>
                    )}
                  </span>
                  <span className="fd-backers__ref">{row.preorderReference}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <DataRequest campaignId={campaignId} view={view} onChanged={() => void load()} />
      </Measure>
    </Section>
  );
}

export default BackersPage;
