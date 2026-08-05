/**
 * The §27 coverage guarantee — Spec §27.1, §27.2, §27.3–27.6, §3, §30
 * (Phase 22a).
 *
 * Phase 22's own brief: "Because the registry is typed and keyed, coverage is a
 * **test that enumerates the key set**, not a manual checklist. Build that test
 * — it's the artifact that keeps coverage true as the product changes."
 *
 * This is that test. It renders every message the product can send and asserts
 * the contract against the rendered output rather than against the sender's
 * intention, for the same reason §7's invitation preview scans rendered subject
 * and body rather than the record behind them: what reaches a person is the
 * only thing worth checking.
 *
 * It needs no database and no harness. Every check is pure over the registry,
 * the sender list, the deliberate-absence register, and the catalog — which is
 * what makes it cheap enough to stay true.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_KEYS,
  MONEY_MESSAGE_CLASS,
  DEADLINE_MESSAGE_KEYS,
  TIMEZONE_TOKENS,
  TRANSACTIONAL_RULE_KEYS,
  MONEY_MESSAGE_FACTS as MONEY_MESSAGE_FACTS_SHARED,
  UNIVERSALLY_BANNED_TERMS as UNIVERSALLY_BANNED_TERMS_SHARED,
  CUSTOMER_ONLY_BANNED_TERMS as CUSTOMER_ONLY_BANNED_TERMS_SHARED,
  missingMoneyFacts,
  namingViolations,
  actionUrlsIn,
  type NotificationEventKey as SharedKey,
} from '@proovd/shared';
import * as restated from '../notifications/contract-logic.js';
import { BACKEND_NOTIFICATION_EVENTS } from '../notifications/events.js';
import {
  UNSENT_NOTIFICATION_EVENTS,
  UNSENT_NOTIFICATION_KEYS,
} from '../notifications/unsent.js';
import { NOTIFICATION_CATALOG, CATALOG_KEYS } from '../notifications/catalog.js';
import { previewNotification, checkTransactionalContract } from '../notifications/preview.js';

const SENT = BACKEND_NOTIFICATION_EVENTS as readonly string[];
const UNSENT = UNSENT_NOTIFICATION_KEYS as readonly string[];

/**
 * These files explain, at length, what they refuse to say. A source scan that
 * could not tell an explanation from a usage would force the explanations out,
 * and the reasoning is the more valuable of the two.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Render every message once; the shape checks all read these. */
const rendered = new Map<string, { subject: string; html: string; text: string }>();
for (const key of CATALOG_KEYS) {
  rendered.set(key, await NOTIFICATION_CATALOG[key]());
}

describe('§27 coverage — the registry partitions into sent and deliberately unsent', () => {
  it('every registry key is either sent or recorded as unsent, and never both', () => {
    const both = NOTIFICATION_EVENT_KEYS.filter((k) => SENT.includes(k) && UNSENT.includes(k));
    const neither = NOTIFICATION_EVENT_KEYS.filter((k) => !SENT.includes(k) && !UNSENT.includes(k));

    // The failure message names the keys, because "coverage is broken" without
    // saying which key is the kind of test that gets skipped.
    expect({ both, neither }).toEqual({ both: [], neither: [] });
    expect(SENT.length + UNSENT.length).toBe(NOTIFICATION_EVENT_KEYS.length);
  });

  it('neither list carries a key the §27 register does not name', () => {
    const strayS = SENT.filter((k) => !(NOTIFICATION_EVENT_KEYS as string[]).includes(k));
    const strayU = UNSENT.filter((k) => !(NOTIFICATION_EVENT_KEYS as string[]).includes(k));
    expect({ strayS, strayU }).toEqual({ strayS: [], strayU: [] });
  });

  it('all four §27 inventories are covered', () => {
    const byAudience = { founder: 0, affiliate: 0, backer: 0, internal: 0 };
    for (const key of NOTIFICATION_EVENT_KEYS) byAudience[NOTIFICATION_EVENTS[key].audience] += 1;
    // §27.3 ~23 bullets, §27.4 ~20, §27.5 ~13, §27.6 ~17 — bundles split per
    // distinct message, so each count is at or above its inventory.
    expect(byAudience.founder).toBeGreaterThanOrEqual(23);
    expect(byAudience.affiliate).toBeGreaterThanOrEqual(20);
    expect(byAudience.backer).toBeGreaterThanOrEqual(13);
    expect(byAudience.internal).toBeGreaterThanOrEqual(17);
  });

  it('every unsent key names a reason and an owner, and a `never` owns nothing', () => {
    for (const key of UNSENT_NOTIFICATION_KEYS) {
      const entry = UNSENT_NOTIFICATION_EVENTS[key];
      expect(entry.reason.length, key).toBeGreaterThan(40);
      if (entry.kind === 'never') {
        // A decision is not somebody's backlog.
        expect(entry.owner, key).toBe('none');
      } else {
        expect(entry.owner, key).not.toBe('none');
      }
      // A `message` absence claims the behaviour already exists, so it has to
      // name the record that holds it — otherwise it is a `capability` absence
      // wearing the cheaper label.
      if (entry.kind === 'message') expect(entry.record, key).toBeTruthy();
    }
  });
});

describe('§27 coverage — every sent event has a template', () => {
  it('the catalog covers exactly the sent set', () => {
    const missing = SENT.filter((k) => !(CATALOG_KEYS as string[]).includes(k));
    const extra = CATALOG_KEYS.filter((k) => !SENT.includes(k));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it('every template renders a subject, an HTML part, and a plain-text part', () => {
    for (const key of CATALOG_KEYS) {
      const message = rendered.get(key)!;
      expect(message.subject.trim().length, key).toBeGreaterThan(0);
      expect(message.html.length, key).toBeGreaterThan(200);
      expect(message.text.trim().length, key).toBeGreaterThan(40);
      // A rendered message is a document, not a fragment. `<p>${summary}</p>`
      // passed every other check and was not an email.
      expect(message.html.toLowerCase(), key).toContain('<html');
    }
  });
});

describe('§27.2 — the transactional rules, against the rendered message', () => {
  it('every rule in the register is checked here', () => {
    // The register is the list; this asserts the list did not grow a rule
    // nothing enforces. `not_opt_out_able` and `no_duplicate_delivery` are
    // asserted below and in `send.ts`'s own suite respectively.
    expect(TRANSACTIONAL_RULE_KEYS.length).toBe(8);
  });

  it('at most one primary action per message', () => {
    for (const key of CATALOG_KEYS) {
      const actions = actionUrlsIn(rendered.get(key)!.html);
      expect({ key, actions }, key).toEqual({ key, actions: actions.slice(0, 1) });
    }
  });

  it('every message carries a plain-text support route', () => {
    for (const key of CATALOG_KEYS) {
      expect(rendered.get(key)!.text, key).toContain('@');
      expect(rendered.get(key)!.text.toLowerCase(), key).toMatch(
        /support@|questions:|contact|reply to/,
      );
    }
  });

  it('every message carries a stable campaign, reservation, or case reference', () => {
    for (const key of CATALOG_KEYS) {
      expect(rendered.get(key)!.text, key).toMatch(/Reference:\s*\S+/);
    }
  });

  it('no message offers an unsubscribe or opt-out path (§27.2: not opt-out-able)', () => {
    const optOut = /unsubscribe|opt[- ]out|manage (your )?(email )?preferences|stop receiving/i;
    for (const key of CATALOG_KEYS) {
      const message = rendered.get(key)!;
      expect(optOut.test(message.html), key).toBe(false);
      expect(optOut.test(message.text), key).toBe(false);
    }
  });

  it('the sender has no unsubscribe path either', () => {
    const send = readFileSync(join(import.meta.dirname, '../notifications/send.ts'), 'utf8');
    // Comments stripped: the module's header documents that there is no
    // unsubscribe path, and the word has to be sayable in the explanation of
    // why it is absent.
    expect(stripComments(send)).not.toMatch(/unsubscribe|List-Unsubscribe/i);
  });
});

describe('§27.2 + §3.3 — the money facts', () => {
  it('every classified money message carries the facts its class owes', () => {
    for (const [key, moneyClass] of Object.entries(MONEY_MESSAGE_CLASS)) {
      const message = rendered.get(key);
      // A classified key with no sender is 22b's; it has no rendering yet.
      if (!message) continue;
      const missing = missingMoneyFacts(message.text, moneyClass!);
      expect({ key, missing }, key).toEqual({ key, missing: [] });
    }
  });

  it('a classified money key is a real registry key', () => {
    for (const key of Object.keys(MONEY_MESSAGE_CLASS)) {
      expect(NOTIFICATION_EVENT_KEYS as string[], key).toContain(key);
    }
  });
});

describe('§27.1 — deadline emails spell out the timezone', () => {
  it('every message carrying a deadline names a zone', () => {
    for (const key of DEADLINE_MESSAGE_KEYS) {
      const message = rendered.get(key);
      if (!message) continue; // 22b's, once it has a sender.
      const named = TIMEZONE_TOKENS.some((token) => message.text.includes(token));
      expect({ key, named }, key).toEqual({ key, named: true });
    }
  });

  it('no message renders a bare ISO instant as its only time (§27.1)', () => {
    // `2026-09-16T17:00:00.000Z` is canonical UTC and spells nothing out. The
    // Day 14, dispute, and batch notices all rendered exactly that before this
    // phase.
    for (const key of CATALOG_KEYS) {
      expect(rendered.get(key)!.text, key).not.toMatch(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/);
    }
  });
});

describe('§3 — the naming contract, against the rendered message', () => {
  it('no message uses a banned term for its audience', () => {
    for (const key of CATALOG_KEYS) {
      const audience = NOTIFICATION_EVENTS[key as SharedKey].audience;
      const message = rendered.get(key)!;
      const violations = [
        ...namingViolations(message.subject, audience),
        ...namingViolations(message.text, audience),
      ].map((v) => v.term);
      expect({ key, violations }, key).toEqual({ key, violations: [] });
    }
  });

  it('every template file is scanned too, not only the sampled render', () => {
    // A branch a sample does not reach can still ship the wrong word. §3.2's
    // terms are audience-independent, so they are checkable against source.
    const dir = join(import.meta.dirname, '../notifications/templates');
    const banned = /\b(pledge[ds]?|donat(e|ed|ion)|all[- ]or[- ]nothing|escrow|custod(y|ial))\b/i;
    for (const file of readdirSync(dir)) {
      const body = stripComments(readFileSync(join(dir, file), 'utf8'));
      expect({ file, banned: banned.test(body) }, file).toEqual({ file, banned: false });
    }
  });
});

describe('the backend restatement does not drift from the shared contract', () => {
  it('restates the money facts, their classes, and their detectors exactly', () => {
    expect(Object.keys(restated.MONEY_MESSAGE_FACTS).sort()).toEqual(
      Object.keys(MONEY_MESSAGE_FACTS_SHARED).sort(),
    );
    for (const key of Object.keys(MONEY_MESSAGE_FACTS_SHARED) as (keyof typeof MONEY_MESSAGE_FACTS_SHARED)[]) {
      const mine = restated.MONEY_MESSAGE_FACTS[key as keyof typeof restated.MONEY_MESSAGE_FACTS];
      const theirs = MONEY_MESSAGE_FACTS_SHARED[key];
      expect(mine.detect.source, key).toBe(theirs.detect.source);
      expect(mine.detect.flags, key).toBe(theirs.detect.flags);
      expect([...mine.appliesTo], key).toEqual([...theirs.appliesTo]);
      expect(mine.specRef, key).toBe(theirs.specRef);
    }
  });

  it('restates both banned-term registers exactly', () => {
    for (const [name, shared, mine] of [
      ['universal', UNIVERSALLY_BANNED_TERMS_SHARED, restated.UNIVERSALLY_BANNED_TERMS],
      ['customer-only', CUSTOMER_ONLY_BANNED_TERMS_SHARED, restated.CUSTOMER_ONLY_BANNED_TERMS],
    ] as const) {
      expect(Object.keys(mine).sort(), name).toEqual(Object.keys(shared).sort());
      for (const key of Object.keys(shared)) {
        const a = (mine as Record<string, { pattern: RegExp; replacement: string }>)[key]!;
        const b = (shared as Record<string, { pattern: RegExp; replacement: string }>)[key]!;
        expect(a.pattern.source, `${name}/${key}`).toBe(b.pattern.source);
        expect(a.pattern.flags, `${name}/${key}`).toBe(b.pattern.flags);
        expect(a.replacement, `${name}/${key}`).toBe(b.replacement);
      }
    }
  });

  it('restates the money and deadline classification exactly', () => {
    expect(restated.MONEY_MESSAGE_CLASS).toEqual(MONEY_MESSAGE_CLASS);
    expect([...restated.DEADLINE_MESSAGE_KEYS]).toEqual([...DEADLINE_MESSAGE_KEYS]);
    expect([...restated.TIMEZONE_TOKENS]).toEqual([...TIMEZONE_TOKENS]);
  });

  it('derives the audience from the key prefix, and it agrees with the register', () => {
    // Deriving rather than restating is what makes this un-driftable; the
    // register's own guarantee — every key is prefixed with its audience — is
    // what makes deriving correct.
    for (const key of NOTIFICATION_EVENT_KEYS) {
      expect(restated.audienceOf(key), key).toBe(NOTIFICATION_EVENTS[key].audience);
    }
  });
});

describe('§27.2 — high-impact messages can be previewed before manual send', () => {
  it('every message previews, and the preview agrees with the contract', async () => {
    for (const key of CATALOG_KEYS) {
      const preview = await previewNotification(key);
      expect(preview.eventKey, key).toBe(key);
      expect(preview.audience, key).toBe(NOTIFICATION_EVENTS[key as SharedKey].audience);
      // The preview renders through the SAME catalog entry, so an Admin looking
      // at a message and the suite guarding it see the same bytes.
      expect(preview.subject, key).toBe(rendered.get(key)!.subject);
      expect(preview.text, key).toBe(rendered.get(key)!.text);
      expect({ key, satisfies: preview.report.satisfiesContract }, key).toEqual({
        key,
        satisfies: true,
      });
    }
  });

  it('the report names what is wrong rather than only that something is', () => {
    // A message with two actions, no reference, and an opt-out line: the
    // report has to be specific enough to fix from.
    const report = checkTransactionalContract('founder_invitation', {
      subject: 'Hello',
      html: '<html><a href="https://a.example">One</a><a href="https://b.example">Two</a></html>',
      text: 'Unsubscribe any time.',
    });
    expect(report.satisfiesContract).toBe(false);
    expect(report.oneActionAtMost).toBe(false);
    expect(report.actionUrls).toEqual(['https://a.example', 'https://b.example']);
    expect(report.hasStableReference).toBe(false);
    expect(report.hasNoOptOut).toBe(false);
  });
});

describe('§30 / §33.6.11 — what must not send', () => {
  it('no scheduled generic check-in event exists in the registry', () => {
    const checkIn = /check_in|checkin|day_?[0-9]+_reminder|nudge|re_?engage|streak|digest_drip/i;
    for (const key of NOTIFICATION_EVENT_KEYS) {
      expect(checkIn.test(key), key).toBe(false);
    }
  });

  it('no sender, job, or template mentions an engagement sequence (§30, DNA §5.10)', () => {
    const banned = /re-?engagement|drip campaign|streak reminder|nudge email|winback|win-back/i;
    const roots = ['../notifications', '../jobs'];
    for (const root of roots) {
      const dir = join(import.meta.dirname, root);
      for (const file of readdirSync(dir, { recursive: true, withFileTypes: true })) {
        if (!file.isFile()) continue;
        if (!/\.tsx?$/.test(file.name)) continue;
        const source = stripComments(readFileSync(join(file.parentPath ?? dir, file.name), 'utf8'));
        expect({ file: file.name, banned: banned.test(source) }, file.name).toEqual({
          file: file.name,
          banned: false,
        });
      }
    }
  });

  it('the deliberately-never events stay never', () => {
    // §27.3's own conditional and §1 rule 6's refusal to invent a threshold.
    // If a later phase gives either a sender, this fails and the reason has to
    // be revisited rather than quietly overwritten.
    expect(UNSENT_NOTIFICATION_EVENTS.founder_email_verification.kind).toBe('never');
    expect(UNSENT_NOTIFICATION_EVENTS.internal_failed_payment_spike.kind).toBe('never');
    expect(SENT).not.toContain('founder_email_verification');
    expect(SENT).not.toContain('internal_failed_payment_spike');
  });

  it('no message manufactures urgency or scarcity (§30)', () => {
    const pressure =
      /only \d+ (left|remaining|spots)|hurry|act now|last chance|don'?t miss out|running out|\d+ people are viewing/i;
    for (const key of CATALOG_KEYS) {
      expect(pressure.test(rendered.get(key)!.text), key).toBe(false);
    }
  });

  it('no message claims to be real time (§30)', () => {
    for (const key of CATALOG_KEYS) {
      expect(rendered.get(key)!.text.toLowerCase(), key).not.toMatch(/real[- ]time|live count/);
    }
  });
});
