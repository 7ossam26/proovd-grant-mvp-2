import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createResendTransport } from './resend-transport.js';

const send = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ data: { id: 'email-test' }, error: null });
});

describe('Resend sender identity', () => {
  it('identifies Proovd while preserving the sending address, reply route and message parts', async () => {
    const result = await createResendTransport('not-a-real-key').send({
      from: 'hello@mail.example.com',
      to: 'founder@example.com',
      replyTo: 'support@example.com',
      subject: 'Your invitation',
      html: '<p>Your invitation</p>',
      text: 'Your invitation',
    });

    expect(send).toHaveBeenCalledExactlyOnceWith({
      from: 'Proovd <hello@mail.example.com>',
      to: 'founder@example.com',
      replyTo: 'support@example.com',
      subject: 'Your invitation',
      html: '<p>Your invitation</p>',
      text: 'Your invitation',
    });
    expect(result).toEqual({ providerId: 'email-test' });
  });

  it('preserves an explicit sender name', async () => {
    await createResendTransport('not-a-real-key').send({
      from: 'Seif at Proovd <hello@mail.example.com>',
      to: 'founder@example.com',
      subject: 'Your invitation',
      html: '<p>Your invitation</p>',
      text: 'Your invitation',
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Seif at Proovd <hello@mail.example.com>',
      replyTo: 'support@proovd.co',
    }));
  });
});
