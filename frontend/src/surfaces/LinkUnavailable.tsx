/**
 * The one surface every token failure renders (§5.5, §28.1).
 *
 * Invalid, expired, revoked, claimed, malformed, rate-limited, and
 * never-existed all arrive here and all look identical. That is the point: a
 * page that said "this link expired" for one and "no such link" for another
 * would let anyone with a list of guesses learn which addresses and drafts are
 * real. §5.5 forbids exposing account existence, so the page tells the holder
 * what to do and tells them nothing about what went wrong.
 *
 * It also answers the six questions §27.1 requires of any exception state,
 * which is why it is a `StatePanel` and not a bare error line — including the
 * one §30 keeps calling for: how do I get help without losing context.
 */

import { Mode, Section, Measure, StatePanel, Button } from '../components/index.js';

export interface LinkUnavailableProps {
  /**
   * Where "Get help" goes. Defaults to the support route the API names in its
   * rejection body, so the page and the server agree without the page having to
   * read anything per-request — nothing here varies by failure mode.
   */
  supportHref?: string;
}

export function LinkUnavailable({ supportHref = '/support/link' }: LinkUnavailableProps) {
  return (
    <Mode kind="light">
      <Section breathe>
        <Measure>
          <h1>We can&rsquo;t open this link</h1>
          <p>
            This link is no longer usable. Links stop working for a few different
            reasons, and we can&rsquo;t tell which one from here.
          </p>
          <StatePanel
            state="This link can&rsquo;t be used"
            whatHappened={
              <>
                Nothing is wrong with your details, and <strong>nothing has been
                charged</strong>. Links are single-purpose and time-limited by
                design.
              </>
            }
            next="Ask whoever sent the link for a fresh one — it takes them a moment to send."
            owner="You"
            nextUpdate="As soon as a new link is sent"
            action={
              <Button tier="primary" href={supportHref}>
                Ask us for a new link
              </Button>
            }
            reference="No account details are shown on this page."
            getHelp={{ href: supportHref }}
          />
        </Measure>
      </Section>
    </Mode>
  );
}

export default LinkUnavailable;
