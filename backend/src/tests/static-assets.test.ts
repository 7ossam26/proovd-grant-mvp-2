/**
 * The SPA fallback, and the one thing it must not do.
 *
 * `app.use(express.static(publicDir))` answers every file that exists. What
 * follows it used to answer index.html for everything else — including a
 * request for a file that is simply absent. That is how the production font
 * failure of 2026-08-20 presented:
 *
 *     GET /fonts/Satoshi-Variable.woff2  ->  200  <!doctype html>...
 *     OTS parsing error: invalid sfntVersion: 1008821359
 *
 * 1008821359 is 0x3C21646F, the ASCII for `<!do`. The browser was decoding
 * index.html as a font and reporting it as corruption, which points the
 * investigation at the font binary instead of at the deploy that never
 * shipped it. §1.4: a failure presents as what it is.
 *
 * The same disguise applies to a missing JS chunk — the browser refuses it on
 * MIME type rather than saying it is not there — so both are asserted.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './app-harness';

const INDEX_HTML = '<!doctype html>\n<html lang="en"><body><div id="root"></div></body></html>';
const FONT_BYTES = Buffer.from('wOF2-not-really-a-font', 'utf8');

let publicDir: string;
let harness: Harness;

beforeAll(async () => {
  publicDir = mkdtempSync(path.join(tmpdir(), 'proovd-static-'));
  writeFileSync(path.join(publicDir, 'index.html'), INDEX_HTML);
  mkdirSync(path.join(publicDir, 'fonts'));
  writeFileSync(path.join(publicDir, 'fonts', 'Present.woff2'), FONT_BYTES);

  harness = await startHarness({ publicDir }, 'static');
}, 120_000);

afterAll(async () => {
  await harness?.stop();
  if (publicDir) rmSync(publicDir, { recursive: true, force: true });
});

describe('static assets and the SPA fallback', () => {
  it('serves a file that exists, as its own bytes', async () => {
    const res = await request(harness.app).get('/fonts/Present.woff2');

    expect(res.status).toBe(200);
    expect(Buffer.from(res.body)).toEqual(FONT_BYTES);
  });

  it('answers 404 for a missing font rather than handing back index.html', async () => {
    const res = await request(harness.app).get('/fonts/Satoshi-Variable.woff2');

    expect(res.status).toBe(404);
    // The regression this file exists for: the body must not begin `<!do`.
    expect(res.text ?? '').not.toContain('<!doctype');
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('answers 404 for a missing script, so a MIME refusal is never the symptom', async () => {
    const res = await request(harness.app).get('/vendor/gsap/gsap.min.js');

    expect(res.status).toBe(404);
    expect(res.text ?? '').not.toContain('<!doctype');
  });

  it('still hands SPA routes to index.html, which is what the fallback is for', async () => {
    for (const route of ['/login', '/campaign/2f8c1e34-0000-4000-8000-000000000001', '/']) {
      const res = await request(harness.app).get(route);

      expect(res.status, route).toBe(200);
      expect(res.text, route).toContain('<div id="root">');
    }
  });

  it('does not mistake a query string for a file extension', async () => {
    const res = await request(harness.app).get('/admin/creators?q=example.com');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
  });
});
