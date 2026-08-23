import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createSecurityHeaders } from './security-headers.js';
import { createR2Storage, unconfiguredStorage } from './storage/object-storage.js';

function appWithStorage(storage: Parameters<typeof createSecurityHeaders>[0]) {
  const app = express();
  app.use(createSecurityHeaders(storage));
  app.get('/', (_req, res) => res.sendStatus(204));
  return app;
}

describe('security headers for browser uploads', () => {
  it('allows only self and the configured R2 origin for connections', async () => {
    const storage = createR2Storage({
      accountId: 'account-id',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      bucket: 'campaign-assets',
      endpointHost: 'r2.example.test',
    });

    const response = await request(appWithStorage(storage)).get('/');
    const policy = response.headers['content-security-policy'];

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("connect-src 'self' https://r2.example.test");
    expect(policy).toContain("object-src 'none'");
  });

  it('keeps the default same-origin connection policy without R2', async () => {
    const response = await request(appWithStorage(unconfiguredStorage)).get('/');

    expect(response.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(response.headers['content-security-policy']).not.toContain('r2.cloudflarestorage.com');
  });
});
