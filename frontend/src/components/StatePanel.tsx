/**
 * StatePanel — the six-question pattern every waiting / review / payment /
 * recovery / exception state must answer (Spec §27.1, Appendix B.1). Build once,
 * used from Phase 05 on; nobody hand-rolls a waiting state.
 *
 *   what happened · what next · who owns it · next update by · your action ·
 *   reference · get help
 *
 * `owner` is customer-facing (Creator, never the internal "affiliate" — §3).
 * `action` is a single control or the literal "No action needed". `getHelp`
 * must preserve context — the caller wires it to a support action that carries
 * the reference, never a blank form.
 */
import { useId, type ReactNode } from 'react';
import { Tag, type TagVariant } from './Tag.js';
import { Button } from './Button.js';
import { HelpIcon } from './icons.js';

export type StateOwner = 'Proovd' | 'Founder' | 'Creator' | 'Stripe' | 'You';

const OWNER_TAG: Record<StateOwner, TagVariant> = {
  You: 'live',
  Proovd: 'default',
  Founder: 'moss',
  Creator: 'sage',
  Stripe: 'mint',
};

/**
 * §27.1's "what can I do now" when the honest answer is nothing, and §11's
 * exact words for the Creator waiting state — which §33.2.3 tests for.
 *
 * Exported so the surfaces and the emails that must say it verbatim read it
 * from here rather than each carrying their own copy. A paraphrase is a softer
 * promise that leaves the reader wondering whether something is expected of
 * them, and two copies of a sentence are two sentences waiting to disagree.
 */
export const NO_ACTION = 'No action needed' as const;

interface StatePanelProps {
  /** The state in plain language — the hero line. */
  state: ReactNode;
  whatHappened: ReactNode;
  next: ReactNode;
  owner: StateOwner;
  /** A Date (rendered local + UTC secondary) or a plain phrase when there is
   *  no fixed time (§27.1). */
  nextUpdate: Date | ReactNode;
  /** A single control, or the literal "No action needed". */
  action: ReactNode | typeof NO_ACTION;
  /** Campaign / association / case identifier. */
  reference: ReactNode;
  /** Context-preserving support action. */
  getHelp?: { onClick: () => void } | { href: string };
  /** Brand-ringed emphasis for a "needs you" state. */
  ring?: boolean;
}

function When({ value }: { value: Date | ReactNode }) {
  if (value instanceof Date) {
    const local = value.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const utc =
      value.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }) + ' UTC';
    return (
      <time dateTime={value.toISOString()}>
        {local} <span className="utc">({utc})</span>
      </time>
    );
  }
  return <>{value}</>;
}

export function StatePanel({
  state,
  whatHappened,
  next,
  owner,
  nextUpdate,
  action,
  reference,
  getHelp,
  ring,
}: StatePanelProps) {
  const headId = useId();
  const isNoAction = action === NO_ACTION;

  return (
    <section
      className={ring ? 'state-panel state-panel--ring' : 'state-panel'}
      aria-labelledby={headId}
    >
      <p className="state-panel__head" id={headId}>
        {state}
      </p>
      <dl className="state-panel__rows">
        <div className="state-panel__row">
          <dt className="state-panel__key">What happened</dt>
          <dd className="state-panel__val">{whatHappened}</dd>
        </div>
        <div className="state-panel__row">
          <dt className="state-panel__key">Next</dt>
          <dd className="state-panel__val">{next}</dd>
        </div>
        <div className="state-panel__row">
          <dt className="state-panel__key">Owner</dt>
          <dd className="state-panel__val">
            <Tag variant={OWNER_TAG[owner]}>{owner}</Tag>
          </dd>
        </div>
        <div className="state-panel__row">
          <dt className="state-panel__key">Next update by</dt>
          <dd className="state-panel__val">
            <When value={nextUpdate} />
          </dd>
        </div>
        <div className="state-panel__row">
          <dt className="state-panel__key">Reference</dt>
          <dd className="state-panel__val">{reference}</dd>
        </div>
      </dl>
      <div className="state-panel__actions">
        {isNoAction ? (
          <span className="state-panel__noaction">{NO_ACTION}</span>
        ) : (
          action
        )}
        {getHelp ? (
          'href' in getHelp ? (
            <Button tier="tertiary" href={getHelp.href}>
              <HelpIcon />
              Get help
            </Button>
          ) : (
            <Button tier="tertiary" onClick={getHelp.onClick}>
              <HelpIcon />
              Get help
            </Button>
          )
        ) : null}
      </div>
    </section>
  );
}
