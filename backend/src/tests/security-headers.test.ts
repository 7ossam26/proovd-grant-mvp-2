import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createSecurityHeaders } from '../security-headers.js';
import { unconfiguredStorage } from '../storage/object-storage.js';

function appWithSecurityHeaders() {
  const app = express();
  app.use(createSecurityHeaders(unconfiguredStorage));
  app.get('*path', (_req, res) => res.send('ok'));
  return app;
}

describe('security headers', () => {
  it('allows the supplied final dashboard to execute its embedded code', async () => {
    const response = await request(appWithSecurityHeaders()).get('/founder-dashboard-final.html');

    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy']).toContain("script-src 'self' 'unsafe-inline'");
    expect(response.headers['content-security-policy']).toContain("script-src-attr 'unsafe-inline'");
    expect(response.headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('does not weaken the policy for the rest of the application', async () => {
    const response = await request(appWithSecurityHeaders()).get('/campaigns/example/home');

    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers['content-security-policy']).toContain("script-src-attr 'none'");
    expect(response.headers['content-security-policy']).not.toContain(
      "script-src 'self' 'unsafe-inline'",
    );
  });
});
