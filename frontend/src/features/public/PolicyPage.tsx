/**
 * The eight policy routes — Spec §18, §31.4, §29.8, §34; DNA §5.12.
 *
 * ── Why these pages do not contain policy text yet ─────────────────────────
 * §18 and §31.4 require the complete canonical approved text at launch: no
 * placeholder, no "coming soon", no summary-only. That text is Track A2 —
 * eight documents in legal review — and §1 rule 6 forbids this repository
 * inventing it. Writing a plausible Terms of Service would not be a
 * placeholder; it would be a legal document nobody approved, presented as one
 * that was.
 *
 * So each route renders the versioned record it actually has, and says exactly
 * what state that record is in. A `draft` document:
 *
 *   - renders normally, with its version identifier visible;
 *   - never presents itself as final, and carries no text that could be
 *     mistaken for the policy;
 *   - lists what §31.4 requires the document to cover, labelled as the
 *     required contents of a document in review — not as the document;
 *   - blocks §34's fourth condition, which Phase 24 releases by publishing.
 *
 * ── DNA §5.12, for the published case ──────────────────────────────────────
 * "Any long or dense document opens with a plain-language overview at Glance:
 * the short version first, the complete text one gesture below, honestly
 * formatted." Nothing is cut — the whole document is on the page, staged.
 */

import type { PolicyDocument } from '@proovd/shared';
import {
  Accordion,
  Button,
  Measure,
  Mode,
  Section,
  StatePanel,
  Tag,
} from '../../components/index.js';
import { supportMailto } from './states.js';

function formatEffectiveDate(isoDate: string): string {
  // Parsed as UTC midnight and rendered in UTC: an effective date is a calendar
  // date, and shifting it by the reader's timezone would move when a policy
  // took effect (§27.1 renders instants locally — this is not an instant).
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    dateStyle: 'long',
    timeZone: 'UTC',
  });
}

function PolicyMeta({ document }: { document: PolicyDocument }) {
  return (
    <dl className="policy-meta">
      <div className="policy-meta__row">
        <dt>Version</dt>
        <dd>{document.version}</dd>
      </div>
      <div className="policy-meta__row">
        <dt>Effective date</dt>
        <dd>
          {document.effectiveDate
            ? formatEffectiveDate(document.effectiveDate)
            : 'Not yet in effect'}
        </dd>
      </div>
      <div className="policy-meta__row">
        <dt>Status</dt>
        <dd>
          {document.status === 'published' ? (
            <Tag variant="live">In effect</Tag>
          ) : (
            <Tag variant="moss">In legal review</Tag>
          )}
        </dd>
      </div>
    </dl>
  );
}

function DraftBody({ document }: { document: PolicyDocument }) {
  return (
    <>
      <StatePanel
        ring
        state="This policy is in legal review"
        whatHappened={
          <>
            The complete text of the {document.title} is with our lawyers and has
            not been published. Version {document.version} is recorded, but it is
            not in effect and nothing on Proovd relies on it yet.{' '}
            <strong>There is no text on this page that is the policy.</strong>
          </>
        }
        next={
          <>
            The approved text is published here in full — with a version number
            and an effective date — before any campaign on Proovd collects card
            details. Until every one of these eight documents is published, live
            payments stay switched off.
          </>
        }
        owner="Proovd"
        nextUpdate="Before the first campaign accepts a card"
        action="No action needed"
        reference={`${document.title} — version ${document.version}`}
        getHelp={{ href: supportMailto(`Question about the ${document.title}`) }}
      />

      <h2 className="h2">What this policy will cover</h2>
      <p>
        This is the required contents of the document, not the document. It is
        here so you can see what is being drafted and ask about anything on it
        before it is final.
      </p>
      <ul className="doc-list">
        {document.coverage.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

function PublishedBody({ document }: { document: PolicyDocument }) {
  const sections = document.body ?? [];
  return (
    <>
      <h2 className="h2">In short</h2>
      <p className="lede">{document.overview}</p>
      <p>
        The complete text is below, in full. The summary above is a reading aid
        and has no legal effect; the text is what applies.
      </p>

      <h2 className="h2">The complete text</h2>
      <Accordion
        defaultValue={sections[0]?.heading ?? ''}
        items={sections.map((section) => ({
          value: section.heading,
          head: section.heading,
          body: (
            <>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 40)}>{paragraph}</p>
              ))}
            </>
          ),
        }))}
      />
    </>
  );
}

export function PolicyPage({ document }: { document: PolicyDocument }) {
  return (
    <>
      <Section breathe>
        <Measure>
          <p className="kicker">Proovd policy</p>
          <h1>{document.title}</h1>
          <PolicyMeta document={document} />
        </Measure>
      </Section>

      <Section>
        <Measure>
          {document.status === 'published' ? (
            <PublishedBody document={document} />
          ) : (
            <DraftBody document={document} />
          )}
        </Measure>
      </Section>

      <Mode kind="light">
        <Section>
          <Measure>
            <h2 className="h2">Questions about this policy</h2>
            <p>
              Email us and a person replies within one business day. Quote the
              version above so we know which text you are asking about.
            </p>
            <Button
              tier="secondary"
              href={supportMailto(
                `${document.title} (version ${document.version}) — question`,
              )}
            >
              Email us about the {document.title}
            </Button>
          </Measure>
        </Section>
      </Mode>
    </>
  );
}
