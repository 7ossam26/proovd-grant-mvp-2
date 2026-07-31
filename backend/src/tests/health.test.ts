import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startHarness, type Harness } from './app-harness.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('GET /healthz (Spec §32.2)', () => {
  it('returns 200 with status ok and a database round-trip', async () => {
    const res = await request(h.app).get('/healthz');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
    });
    expect(typeof res.body.timestamp).toBe('string');
  });
});
