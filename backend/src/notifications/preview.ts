/**
 * Message preview and the §27.2 contract report (Phase 22a).
 *
 * §27.2: "High-impact messages can be previewed with final variables before
 * manual send."
 *
 * The product already honoured that rule at the two places a human actually
 * composes and sends: §7's Founder invitation and §8's Creator invitation both
 * gate Send on a scan of the *rendered* message, and §26.8's support reply is a
 * filled draft an Admin edits with no one-click send anywhere. What was missing
 * was a way to look at any message at all, and a machine-checkable statement of
 * what "correct" means for one.
 *
 * This is that. `previewNotification` renders through the same catalog entry
 * the sender uses — never a second copy of the copy — and returns the message
 * beside a report of every §27.2 rule that can be decided from the rendered
 * output. The report is the same set of checks the coverage suite runs, which
 * is the point: an Admin previewing a message and the suite guarding it are
 * asking the identical question.
 *
 * It reports rather than refuses. A refusal here would be a second gate beside
 * the two that already exist, and those two refuse on the thing that actually
 * matters — an unfilled variable reaching a real person. A preview that blocked
 * on a heuristic would train an Admin to work around it.
 */

import {
  actionUrlsIn,
  audienceOf,
  carriesDeadline,
  isTransactionalMessage,
  missingMoneyFacts,
  moneyClassFor,
  namingViolations,
  TIMEZONE_TOKENS,
  type MessageAudience,
  type MoneyFactKey,
  type NamingViolation,
} from './contract-logic.js';
import type { NotificationEventKey } from './events.js';
import { NOTIFICATION_CATALOG, type RenderedMessage } from './catalog.js';

export interface ContractReport {
  /** Distinct navigable actions. §27.2 permits at most one. */
  actionUrls: string[];
  oneActionAtMost: boolean;
  /** §27.2: a plain-text support route. */
  hasSupportRoute: boolean;
  /** §27.2: a stable campaign, reservation, or case reference. */
  hasStableReference: boolean;
  /**
   * §27.2 vs §27.7. Transactional email is never opt-out-able; the digest is
   * the one message that is, and therefore the one that owes a route to its own
   * preference. `optOutRule` says which way the rule runs for this key.
   */
  optOutRule: 'forbidden' | 'required';
  hasOptOutPath: boolean;
  optOutRuleSatisfied: boolean;
  /** §27.2/§3.3, by money class. Empty when the message is not about money. */
  moneyFactsMissing: MoneyFactKey[];
  /** §27.1: a deadline email spells out its timezone. */
  deadlineNamesTimezone: boolean | null;
  /** §3.1/§3.2, scanned for this message's own audience. */
  namingViolations: NamingViolation[];
  /** True when nothing above is in violation. */
  satisfiesContract: boolean;
}

export interface NotificationPreview extends RenderedMessage {
  eventKey: NotificationEventKey;
  audience: MessageAudience;
  report: ContractReport;
}

/**
 * A family of honest phrasings rather than one pinned sentence — 22a's rule for
 * every detector here. `change how often` earns its place because that is what
 * the digest's own control says, and a detector that knew only `unsubscribe`
 * would report the digest as carrying no way out while it carried one.
 */
const OPT_OUT =
  /unsubscribe|opt[- ]out|manage\s+(your\s+)?(email\s+)?preferences|stop\s+receiving|change\s+how\s+often|turn\s+(this|these)\s+off/i;
const SUPPORT_ROUTE = /support@|questions:|contact|reply to/i;
const REFERENCE = /Reference:\s*\S+/;

/** Decide §27.2 and §27.1 from a rendered message. */
export function checkTransactionalContract(
  eventKey: NotificationEventKey,
  message: RenderedMessage,
): ContractReport {
  const audience = audienceOf(eventKey);
  const actionUrls = actionUrlsIn(message.html);
  const moneyClass = moneyClassFor(eventKey);

  const moneyFactsMissing = moneyClass ? missingMoneyFacts(message.text, moneyClass) : [];
  const deadlineNamesTimezone = carriesDeadline(eventKey)
    ? TIMEZONE_TOKENS.some((token) => message.text.includes(token))
    : null;
  const violations = [
    ...namingViolations(message.subject, audience),
    ...namingViolations(message.text, audience),
  ];

  const optOutRule = isTransactionalMessage(eventKey) ? 'forbidden' : 'required';
  const hasOptOutPath = OPT_OUT.test(message.html) || OPT_OUT.test(message.text);

  const report: ContractReport = {
    actionUrls,
    oneActionAtMost: actionUrls.length <= 1,
    hasSupportRoute: SUPPORT_ROUTE.test(message.text),
    hasStableReference: REFERENCE.test(message.text),
    optOutRule,
    hasOptOutPath,
    optOutRuleSatisfied: optOutRule === 'forbidden' ? !hasOptOutPath : hasOptOutPath,
    moneyFactsMissing,
    deadlineNamesTimezone,
    namingViolations: violations,
    satisfiesContract: false,
  };

  report.satisfiesContract =
    report.oneActionAtMost &&
    report.hasSupportRoute &&
    report.hasStableReference &&
    report.optOutRuleSatisfied &&
    moneyFactsMissing.length === 0 &&
    deadlineNamesTimezone !== false &&
    violations.length === 0;

  return report;
}

/**
 * Render one message and report on it. `variables` are the catalog's
 * representative set; a caller with the real ones renders through the sender's
 * own template function and passes the result to `checkTransactionalContract`
 * directly — which is what the §7 and §8 preview gates already do.
 */
export async function previewNotification(
  eventKey: NotificationEventKey,
): Promise<NotificationPreview> {
  const message = await NOTIFICATION_CATALOG[eventKey]();
  return {
    eventKey,
    audience: audienceOf(eventKey),
    ...message,
    report: checkTransactionalContract(eventKey, message),
  };
}
