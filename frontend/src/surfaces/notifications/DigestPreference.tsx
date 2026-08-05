/**
 * The §27.7 digest preference control — one component, three surfaces.
 *
 * The Founder settings page, the Creator settings page, and the Backer's
 * magic-link page all render this. The three differ only in where they are
 * mounted and how they save; the question, the options, and the sentence about
 * what turning it off does NOT do are the server's, resolved once, so the three
 * cannot drift into three vocabularies.
 *
 * ── Nothing is preselected, and that is §30 ────────────────────────────────
 * While `chosen` is false no option is marked. The obvious implementation —
 * default the radio to "off" so something is always selected — would be a
 * prechecked optional consent wearing the safe answer, and it would also
 * destroy the distinction the record exists to keep: "has not chosen" and
 * "chose no" are different facts (§1.4), and only the first should be asked
 * again.
 *
 * ── The transactional sentence is not fine print ───────────────────────────
 * §27.2 makes every other message not opt-out-able. Someone reaching a control
 * that says "no summary emails" will read it as "stop emailing me" unless we
 * say otherwise, and the next message they get is a charge receipt they believe
 * they unsubscribed from. So the sentence sits with the control, not under it.
 */

import { useCallback, useState } from 'react';
import { Button, Card, Choice } from '../../components/index.js';

export type DigestFrequency = 'off' | 'daily' | 'weekly';

export interface DigestPreferenceView {
  chosen: boolean;
  frequency: DigestFrequency | null;
  chosenAt: string | null;
  question: string;
  options: { value: DigestFrequency; label: string }[];
  transactionalNotice: string;
}

export interface DigestPreferenceProps {
  preference: DigestPreferenceView;
  onSave: (frequency: DigestFrequency) => Promise<void>;
  /** The Backer's magic-link page frames it as a first-visit question. */
  compact?: boolean;
}

export function DigestPreference({ preference, onSave, compact }: DigestPreferenceProps) {
  const [picked, setPicked] = useState<DigestFrequency | undefined>(
    preference.frequency ?? undefined,
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (!picked || busy) return;
    setBusy(true);
    setFailure(null);
    setSaved(false);
    try {
      await onSave(picked);
      setSaved(true);
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : 'We could not save that. Nothing changed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }, [picked, busy, onSave]);

  const body = (
    <div className="choice-block">
      <p className="notification-history__when">
        {preference.chosen
          ? 'You can change this whenever you like.'
          : 'You have not chosen yet, so we are not sending one.'}
      </p>
      <Choice
        label={preference.question}
        entries={preference.options.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        {...(picked !== undefined ? { value: picked } : {})}
        onValueChange={setPicked}
        disabled={busy}
      />
      <p className="notification-history__when">{preference.transactionalNotice}</p>
      {/* One primary action, and it is disabled until something is picked —
          §28.4's no-bundling rule read forward: a save with nothing selected
          would have to invent which answer it recorded. */}
      <Button onClick={save} disabled={!picked || busy}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
      {saved ? <p className="notification-history__when">Saved.</p> : null}
      {failure ? <p role="alert">{failure}</p> : null}
    </div>
  );

  // `h2` on both surfaces: it sits directly under the page `h1` on the settings
  // page, and beside the Backer page's own `h2` support and comment sections.
  // `className="h3"` carries the smaller visual size without inventing a level
  // — §33.11's heading order is about structure, not size.
  return (
    <section aria-labelledby="digest-preference-heading" className="backer__support">
      <h2 className="h3" id="digest-preference-heading">
        {preference.question}
      </h2>
      {compact ? body : <Card>{body}</Card>}
    </section>
  );
}
