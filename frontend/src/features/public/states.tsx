/**
 * The public site's loading, empty, and failure states — Spec §27.1, §33.11.7.
 *
 * §33.11.7 is not "have a spinner and a 404". Every one of these answers the
 * same six questions, which is why they are all `StatePanel`s rather than
 * hand-written lines: what happened, what next, who owns it, when the next
 * update comes, what you can do now, and how to get help without losing
 * context.
 *
 * "Without losing context" is the one that is easy to fake. No support form
 * exists yet — it arrives with the Backer support surface — so `Get help`
 * opens an email to the address §27.8 publishes, pre-filled with the reference
 * the panel is showing. A support link that drops the user on a blank page is
 * the failure §27.1 names, and a form that does not exist is worse.
 */

import { Mode, Section, Measure, StatePanel, Button } from '../../components/index.js';
import { SUPPORT_EMAIL } from './site.js';

/** A context-preserving support link: the reference travels in the subject. */
export function supportMailto(subject: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

/**
 * The route-transition fallback. Space is reserved before content arrives
 * (DNA §5.5) so the page does not reflow under a finger already in flight.
 */
export function PageLoading() {
  return (
    <Section>
      <Measure>
        <StatePanel
          state="Loading this page"
          whatHappened="We're fetching the page you asked for. Nothing has been submitted and nothing has been charged."
          next="The page appears here as soon as it arrives."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action="No action needed"
          reference="No account details are involved on a public page."
        />
      </Measure>
    </Section>
  );
}

/**
 * The waiting state for a surface that is fetching its own record — Spec
 * §33.11.7, §27.1 (Phase 23a).
 *
 * `PageLoading` covers a route transition, where there is no record and no
 * reference yet. This covers the other case: a Founder's results, a Creator's
 * close view, a Backer's own page. Five of them rendered a single sentence,
 * which answers one question of six, and the sweep in `features/qa` is what
 * found them.
 *
 * `Get help` is deliberately absent here, as it is on `PageLoading`. §27.1's
 * sixth question is "how do I get help *without losing context*", and the
 * context is the thing that has not arrived — a support route offered a
 * fraction of a second into a read carries nothing to preserve, and DNA §5.6
 * counts a control nobody needs as noise. The moment the read fails, the
 * failure state replaces this one and owes all six; that is what the sweep
 * asserts separately, on the same routes.
 */
export function SurfaceLoading({
  subject,
  reference,
}: {
  /** What is being fetched, in the reader's words: "your results". */
  subject: string;
  /** The campaign, association, or case this page is about. */
  reference: string;
}) {
  return (
    <Section>
      <Measure>
        <StatePanel
          state={`Loading ${subject}`}
          whatHappened={`We're reading ${subject} from your record. Nothing has been submitted and nothing has been charged.`}
          next="It appears here as soon as it arrives."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action="No action needed"
          reference={reference}
        />
      </Measure>
    </Section>
  );
}

/**
 * An unknown public path. §30 forbids a generic error without a data status
 * and a recovery path, so this one states both and offers the way back.
 */
export function NotFoundSurface() {
  return (
    <Mode kind="light">
      <Section breathe>
        <Measure>
          <h1>We don&rsquo;t have a page at this address</h1>
          <StatePanel
            state="This address doesn&rsquo;t match a page on Proovd"
            whatHappened={
              <>
                The link may be mistyped, or it may point at something that was
                never published here. <strong>Nothing has been submitted and
                nothing has been charged.</strong>
              </>
            }
            next="Start from the homepage, or use the links in the footer to go straight to what you were looking for."
            owner="You"
            nextUpdate="No update is pending"
            action={
              <Button tier="primary" href="/">
                Go to the Proovd homepage
              </Button>
            }
            reference="No campaign or account is identified by this address."
            getHelp={{ href: supportMailto('Broken link on app.proovd.co') }}
          />
        </Measure>
      </Section>
    </Mode>
  );
}

interface EmptyPanelProps {
  /** What is empty, in plain language. */
  state: string;
  whatHappened: string;
  next: string;
  reference: string;
  helpSubject: string;
}

/** A section with nothing in it yet — §33.11.7's `empty`, answered in full. */
export function EmptyPanel({ state, whatHappened, next, reference, helpSubject }: EmptyPanelProps) {
  return (
    <StatePanel
      state={state}
      whatHappened={whatHappened}
      next={next}
      owner="Founder"
      nextUpdate="When the Founder posts"
      action="No action needed"
      reference={reference}
      getHelp={{ href: supportMailto(helpSubject) }}
    />
  );
}
