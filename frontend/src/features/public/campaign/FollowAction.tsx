/**
 * The two pages an emailed follow link opens (campaign-page-v2 Session C — a
 * RECORDED DEVIATION from §1 rule 6; see migration 0050).
 *
 * ── Why these are pages with a button, and not one-click links ─────────────
 * A link that acts on being FETCHED records the answers email scanners give.
 * Phase 21b already decided this for §31.8's satisfaction survey, and it binds
 * twice as hard here: a GET confirm would let a scanner complete the double
 * opt-in that exists precisely to require a person, and a GET unfollow would
 * unsubscribe people who never clicked. So the emailed URL opens this page,
 * the page says what is about to happen, and the person's own click is the
 * POST.
 *
 * The failure state is the same for every reason (§5.5's rule): a spent link,
 * one from the other lineage, an expired one, and one that never existed all
 * read the same, because telling the holder which is what lets somebody probe.
 */

import { useState } from 'react';
import { useParams } from 'react-router';
import { Button, NO_ACTION, Section, StatePanel } from '../../../components/index.js';
import { supportMailto } from '../states.js';

type Outcome =
  | { kind: 'asking' }
  | { kind: 'working' }
  | { kind: 'done'; campaignId: string; campaignTitle: string }
  | { kind: 'failed' };

function FollowAction({
  action,
  title,
  lead,
  cta,
  reassurance,
  doneTitle,
  doneBody,
}: {
  action: 'confirm' | 'stop';
  title: string;
  lead: string;
  cta: string;
  reassurance: string;
  doneTitle: string;
  doneBody: (campaignTitle: string) => string;
}) {
  const { token } = useParams();
  const [state, setState] = useState<Outcome>({ kind: 'asking' });

  async function run() {
    if (!token) return setState({ kind: 'failed' });
    setState({ kind: 'working' });
    try {
      const res = await fetch(`/api/follow/${token}/${action}`, { method: 'POST' });
      if (!res.ok) return setState({ kind: 'failed' });
      const body = (await res.json()) as { campaignId: string; campaignTitle: string };
      setState({ kind: 'done', campaignId: body.campaignId, campaignTitle: body.campaignTitle });
    } catch {
      setState({ kind: 'failed' });
    }
  }

  if (state.kind === 'done') {
    return (
      <Section aria-labelledby="follow-done">
        <h1 id="follow-done">{doneTitle}</h1>
        <p>{doneBody(state.campaignTitle)}</p>
        <Button tier="secondary" href={`/campaign/${state.campaignId}`}>
          Back to the campaign
        </Button>
      </Section>
    );
  }

  if (state.kind === 'failed') {
    return (
      <Section>
        <StatePanel
          state="That link is not usable"
          owner="Proovd"
          whatHappened="This link has already been used, has expired, or was never valid. Nothing has changed."
          next="Open the most recent email we sent you and use the link in that one."
          nextUpdate="There is nothing to wait for — the link in your most recent email works."
          action={NO_ACTION}
          reference="Campaign follow link"
          getHelp={{ href: supportMailto('Campaign follow link') }}
        />
      </Section>
    );
  }

  return (
    <Section aria-labelledby="follow-ask">
      <h1 id="follow-ask">{title}</h1>
      <p>{lead}</p>
      <Button tier="primary" onClick={run} disabled={state.kind === 'working'}>
        {cta}
      </Button>
      {/*
        The way OUT of this page. There is no campaign id to link back to until
        the POST answers — the token is all we hold — so the exit is a fact
        rather than a control: closing the page is a complete answer, and
        saying so is what stops the single button reading as the only option
        (§27.1's "what can I do now").
      */}
      <p className="follow-action__reassurance">{reassurance}</p>
    </Section>
  );
}

export function FollowConfirmPage() {
  return (
    <FollowAction
      action="confirm"
      title="Start the summary?"
      lead="We will email you a summary of what happens on this campaign, at the frequency you chose — and only when something actually happened. This is not a pre-order: no card is saved and nothing is charged. Every summary carries a way to change how often you get it, or to stop."
      cta="Yes, start the summary"
      reassurance="If you did not ask for this, close this page. Nothing starts unless you confirm, and no summary is ever sent."
      doneTitle="The summary is on"
      doneBody={(campaignTitle) =>
        `You will hear about ${campaignTitle} when something happens there, and every message carries a way to stop.`
      }
    />
  );
}

export function FollowStopPage() {
  return (
    <FollowAction
      action="stop"
      title="Stop the summary?"
      lead="We will stop emailing you about this campaign. Nothing else changes — if you also placed a pre-order, it is untouched and its own messages keep arriving, because those are not something anybody opts out of."
      cta="Yes, stop the summary"
      reassurance="If you opened this by mistake, close this page and nothing changes — the summary keeps arriving until you stop it here."
      doneTitle="The summary is off"
      doneBody={(campaignTitle) =>
        `We will not email you about ${campaignTitle} again. Any pre-order you placed is unaffected.`
      }
    />
  );
}
