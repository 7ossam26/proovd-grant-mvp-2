/**
 * Today, the composed read — Spec §26, §1.4, §30.
 *
 * The counts themselves are the four queues' own and are proved where those
 * live. What is only checkable HERE is that Today composes rather than
 * duplicates: that it owns no table, writes nothing, queries no domain table of
 * its own, and has no write route at all.
 *
 * That last one is the §30 guarantee in its strongest form. A prohibition on
 * manufactured engagement enforced by a service is one a later service can
 * forget; enforced by there being nowhere to record that anybody looked, it
 * cannot be.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { TODAY_SOURCES } from '@proovd/shared';
import { startHarness, type Harness } from './app-harness.js';
import { createAdmin, type AdminSession } from './admin-session.js';
import { TODAY_SOURCE_KEYS, readToday } from '../admin/today.js';

let h: Harness;
let admin: AdminSession;

beforeAll(async () => {
  h = await startHarness({}, 'today');
  admin = await createAdmin(h, 'today-admin');
}, 180_000);

afterAll(async () => {
  await h.stop();
});

describe('the register does not drift from @proovd/shared', () => {
  it('restates the six keys, in the register’s own order', () => {
    expect([...TODAY_SOURCE_KEYS]).toEqual(TODAY_SOURCES.map((source) => source.key));
  });

  it('every source names the record it is derived from, and where the work lives', () => {
    for (const source of TODAY_SOURCES) {
      /*
        §33.6.11's rule on an Admin surface: there is no line whose source is a
        duration, a date, or an absence. Every one names a stored record with a
        deadline somebody agreed to.
      */
      expect(source.record.length).toBeGreaterThan(20);
      expect(source.href.startsWith('/admin/')).toBe(true);
      expect(source.specRef).toMatch(/§/);
    }
  });
});

describe('§26, §30 — Today composes and owns nothing', () => {
  it('created no table of its own', async () => {
    const { rows } = await h.db.execute(
      sql`select table_name from information_schema.tables
          where table_schema = 'public'
            and (table_name like '%today%' or table_name like '%overview%'
                 or table_name like '%dashboard%' or table_name like '%digest_count%')`,
    );
    expect(rows).toEqual([]);
  });

  it('writes nothing, anywhere in the module', () => {
    const source = readFileSync(new URL('../admin/today.ts', import.meta.url), 'utf8')
      // The header explains at length what this module refuses to do, so a scan
      // that could not tell an explanation from a usage would force the
      // explanation out — and the reasoning is the more valuable of the two.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const forbidden of ['.insert(', '.update(', '.delete(', 'INSERT', 'UPDATE ']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('queries no domain table directly — it calls the reads that already exist', () => {
    const source = readFileSync(new URL('../admin/today.ts', import.meta.url), 'utf8');
    // No `db.select` at all: every number comes from a queue function whose own
    // workspace renders the same list, so a count and its list cannot disagree.
    expect(source).not.toContain('db.select');
    expect(source).not.toContain('.from(');
  });

  it('has no write route, so there is nowhere to record that anybody looked', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      await request(h.app)[method]('/api/admin/today')
        .set('cookie', admin.cookie)
        .send({})
        .expect(404);
    }
  });

  it('serves the board to an Admin and to nobody else', async () => {
    await request(h.app).get('/api/admin/today').expect(401);

    const res = await request(h.app)
      .get('/api/admin/today')
      .set('cookie', admin.cookie)
      .expect(200);

    expect(res.body.sourceKeys).toEqual([...TODAY_SOURCE_KEYS]);
    expect(res.body.counts.map((c: { key: string }) => c.key)).toEqual([...TODAY_SOURCE_KEYS]);
  });
});

describe('§30 — a lapsed deadline and open work stay two facts', () => {
  it('reports every source on an empty system, and calls it clear', async () => {
    const view = await readToday(h.db);

    // All six, always — a source that vanished when its count was zero would
    // make "checked and clear" indistinguishable from "not checked" (§1.4).
    expect(view.counts).toHaveLength(TODAY_SOURCE_KEYS.length);
    expect(view.counts.every((entry) => entry.count === 0)).toBe(true);
    expect(view.clear).toBe(true);
    expect(view.overdueTotal).toBe(0);
  });

  it('counts only the overdue kinds in the total', async () => {
    const view = await readToday(h.db);
    const kinds = new Map(view.counts.map((entry) => [entry.key, entry.kind]));

    /*
      A card still inside its 48-hour window and a campaign awaiting
      reconciliation are outstanding work that nobody is late for. Counting them
      as overdue would report urgency the records do not carry.
    */
    expect(kinds.get('retry_window')).toBe('waiting');
    expect(kinds.get('reconciling')).toBe('waiting');
    expect(kinds.get('support_overdue')).toBe('overdue');
    expect(kinds.get('dispute_tasks')).toBe('overdue');
  });
});
