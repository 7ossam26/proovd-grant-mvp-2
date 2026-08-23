import { describe, expect, it } from 'vitest';
import { createMemoryStorage, createR2Storage } from './object-storage.js';

describe('browser-safe object-storage presigning', () => {
  it('signs Content-Type without requiring JavaScript to set Content-Length', async () => {
    const storage = createR2Storage({
      accountId: 'account-id',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      bucket: 'campaign-assets',
      endpointHost: 'r2.example.test',
      now: () => new Date('2026-08-23T05:00:00.000Z'),
    });

    const upload = await storage.presignUpload({
      key: 'campaigns/campaign-id/visual/file.jpg',
      contentType: 'image/jpeg',
      contentLength: 123_456,
    });

    expect(upload.requiredHeaders).toEqual({ 'content-type': 'image/jpeg' });
    expect(storage.browserUploadOrigin).toBe('https://r2.example.test');
    expect(new URL(upload.url).searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-type;host',
    );
  });

  it('keeps the in-memory port on the same browser-safe header contract', async () => {
    const upload = await createMemoryStorage().presignUpload({
      key: 'campaigns/campaign-id/logo/file.png',
      contentType: 'image/png',
      contentLength: 1_024,
    });

    expect(upload.requiredHeaders).toEqual({ 'content-type': 'image/png' });
    expect(createMemoryStorage().browserUploadOrigin).toBeNull();
  });
});
