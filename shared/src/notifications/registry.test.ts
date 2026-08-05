/**
 * Notification registry skeleton (§27.3–27.6) — the key set exists, is
 * well-formed, and covers all four audiences, so Phase 22's coverage sweep
 * can assert against keys instead of grepping templates.
 */

import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_KEYS,
  deliveryDedupTuple,
} from './registry.js';

describe('notification event registry (§27.3–27.6)', () => {
  it('covers the §27.3–27.6 event set (~70 bullets, bundles split per message)', () => {
    expect(NOTIFICATION_EVENT_KEYS.length).toBeGreaterThanOrEqual(69);
  });

  it('every key is snake_case and prefixed with its audience', () => {
    for (const key of NOTIFICATION_EVENT_KEYS) {
      expect(key).toMatch(/^(founder|affiliate|backer|internal)_[a-z0-9_]+$/);
      const def = NOTIFICATION_EVENTS[key];
      expect(key.startsWith(`${def.audience}_`)).toBe(true);
      // §27.3–27.6 are the four transactional inventories. §27.7 is admitted
      // for exactly one reason: it states a message the inventories do not
      // list, because that message is not transactional — the optional digest.
      // A key claiming §27.7 is claiming to be opt-out-able, which is why
      // `NON_TRANSACTIONAL_KEYS` names the whole set rather than leaving it to
      // whatever a `specRef` happens to say.
      expect(def.specRef).toMatch(/^§27\.[3-7]$/);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it('all four audiences are represented', () => {
    const audiences = new Set(NOTIFICATION_EVENT_KEYS.map((k) => NOTIFICATION_EVENTS[k].audience));
    expect(audiences).toEqual(new Set(['founder', 'affiliate', 'backer', 'internal']));
  });

  it('uses no banned vocabulary in keys or descriptions (§3.1)', () => {
    const banned = /pledge|donate|mbp|tranche|escrow|custody/i;
    for (const key of NOTIFICATION_EVENT_KEYS) {
      expect(key).not.toMatch(banned);
      expect(NOTIFICATION_EVENTS[key].description).not.toMatch(banned);
    }
  });

  it('builds the dedup tuple that mirrors the notification_deliveries unique constraint', () => {
    expect(
      deliveryDedupTuple('backer_charge_receipt', 'backer@example.com', 'reservation', 'res-1'),
    ).toEqual({
      eventKey: 'backer_charge_receipt',
      target: 'backer@example.com',
      entityType: 'reservation',
      entityId: 'res-1',
    });
  });
});
