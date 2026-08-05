/**
 * "Already pre-ordered? Send me my link." — Spec §5.5, §27.5, §33.5.13.
 *
 * ── Why this lives on the campaign page and not on /link-unavailable ────────
 * `/link-unavailable` is where a dead link lands, so it looks like the obvious
 * home. It is not: that page is shared by Founder drafts, Creator invitations,
 * and Backer magic links, and it deliberately varies on nothing — anything it
 * could branch on is something a caller could measure. A reissue form there
 * would also have to ask for a campaign id, which is precisely what someone
 * holding a dead link does not have.
 *
 * Here, the campaign is the URL. A Backer who lost their link goes back to the
 * campaign they pre-ordered, which is the one thing they can always find, and
 * the only thing they have to supply is the address they used.
 *
 * ── The answer never changes, and neither does the copy ─────────────────────
 * §5.5: an address with a pre-order and an address without one must be
 * indistinguishable. The server sends one frozen acknowledgement for both; this
 * renders that acknowledgement and nothing derived from it, so the page cannot
 * become the oracle the route refuses to be. There is deliberately no
 * "we found your pre-order" state to build.
 *
 * ── And it says nothing about money ─────────────────────────────────────────
 * §30: this is the one Backer flow that is purely about access. Asking for a
 * link must not read as starting, changing, or confirming a charge.
 */

import { useId, useState } from 'react';
import { Button, StatePanel, Field, Input, NO_ACTION } from '../../../components/index.js';

export interface MagicLinkRequestProps {
  campaignId: string;
}

type State = 'idle' | 'sending' | 'asked';

export function MagicLinkRequest({ campaignId }: MagicLinkRequestProps) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');
  const fieldId = useId();

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!email.trim() || state === 'sending') return;
    setState('sending');
    try {
      await fetch('/api/link/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), campaignId }),
      });
    } catch {
      // Deliberately swallowed. A network failure and a miss must look the
      // same, and the route answers 202 for every outcome anyway — surfacing
      // a difference here would reintroduce the oracle from the client side.
    }
    setState('asked');
  }

  if (state === 'asked') {
    return (
      <StatePanel
        state="Check your email"
        whatHappened="If that address has a pre-order on this campaign, we have sent it a fresh link."
        next="The link works once and expires. If nothing arrives, check your spam folder, then contact support."
        owner="You"
        nextUpdate="Within a few minutes"
        // §1.4: there is genuinely nothing to do here but open the email, and a
        // button that re-asked would invite a person to hammer the one route
        // that must answer identically however often it is called.
        action={NO_ACTION}
        reference="Nothing has been charged and nothing has changed."
      />
    );
  }

  return (
    <form onSubmit={submit}>
      <h3>Already pre-ordered?</h3>
      <p>
        Your pre-order page opens from a link we email you. If you can&rsquo;t
        find it, we&rsquo;ll send a new one. Nothing here charges anything.
      </p>
      <Field id={fieldId} label="The email you used">
        <Input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      {/* §27.2 / §30: one action, and it names what it does. */}
      <Button tier="secondary" type="submit" disabled={state === 'sending' || !email.trim()}>
        {state === 'sending' ? 'Sending…' : 'Send me my link'}
      </Button>
    </form>
  );
}

export default MagicLinkRequest;
