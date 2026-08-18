/**
 * `Follow build` — a RECORDED DEVIATION from §1 rule 6 (campaign-page-v2
 * Session C), built by explicit product direction. See migration 0050 and
 * `backend/src/followers/service.ts` for the full statement.
 *
 * ── What this surface is careful about ─────────────────────────────────────
 *
 *  * It asks for the cadence. §27.7's rule is that the preference exists only
 *    because a person chose it, so nothing is preselected and the control is
 *    inert until something is. That is `NotificationSettings`' own posture,
 *    reapplied to the one place a non-account holder can choose.
 *
 *  * It swallows every failure. The route it posts to answers one frozen body
 *    for a hit, a miss, a malformed address, an unknown campaign, and a caller
 *    over the limit — and a client that rendered a network error differently
 *    would become the enumeration oracle the route refuses to be. So the
 *    acknowledgement renders for every outcome, exactly as
 *    `MagicLinkRequest.tsx` does for §5.5.
 *
 *  * It states what this is NOT. §30's saved-card/charge confusion is the
 *    failure to avoid on a page whose other controls all lead to a card, so
 *    the copy says plainly that this is not a pre-order before it asks for
 *    anything.
 */

import { useState } from 'react';
import { Button, Choice, Field, Input } from '../../../components/index.js';

/** §27.7's two cadences. Nothing is preselected — `''` is "not chosen yet". */
const CADENCES = [
  { value: 'weekly', label: 'Weekly', sub: 'One summary a week, when something happened' },
  { value: 'daily', label: 'Daily', sub: 'One a day, when something happened' },
];

/**
 * The one acknowledgement, rendered for every outcome. The server's own frozen
 * body says the same thing; this is here so a failed request cannot render
 * anything different (see the header).
 */
const ACK_TITLE = 'Check your email';
const ACK_BODY =
  'If that address can follow this campaign, we have sent it a link to confirm. Nothing starts until you open that link.';

export function FollowBuild({
  campaignId,
  source = 'campaign_page',
}: {
  campaignId: string;
  source?: 'campaign_page' | 'checkout_success';
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [frequency, setFrequency] = useState('');
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !email.trim() || !frequency) return;
    setBusy(true);
    try {
      await fetch(`/api/campaign/${campaignId}/follow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), frequency, source }),
      });
    } catch {
      // Deliberately ignored. The route answers one body for every outcome;
      // a client that distinguished a network failure would hand back the
      // difference the route exists to hide.
    }
    setAsked(true);
    setBusy(false);
  }

  if (asked) {
    return (
      <div className="pc-follow pc-follow--done" role="status">
        <p className="pc-follow__title">{ACK_TITLE}</p>
        <p>{ACK_BODY}</p>
      </div>
    );
  }

  if (!open) {
    return (
      <Button tier="secondary" onClick={() => setOpen(true)}>
        Follow the build
      </Button>
    );
  }

  return (
    <form className="pc-follow" onSubmit={submit}>
      <p className="pc-follow__title">Get a summary of what happens here</p>
      <p className="pc-follow__note">
        This is not a pre-order. No card is saved and nothing is charged — it is an email summary,
        sent only when something actually happened, with a way to stop in every one.
      </p>
      <Field label="Email">
        <Input
          type="email"
          name="follow-email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          required
        />
      </Field>
      <Choice
        label="How often"
        name="follow-frequency"
        value={frequency}
        onValueChange={setFrequency}
        entries={CADENCES}
      />
      <Button tier="primary" type="submit" disabled={busy || !email.trim() || !frequency}>
        Send me the confirmation link
      </Button>
    </form>
  );
}
