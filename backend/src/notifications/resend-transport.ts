/**
 * The Resend transport, and the honest absence of one.
 *
 * Two implementations, and which one is wired is decided by whether the
 * environment actually has a provider configured:
 *
 *  `createResendTransport`   sends.
 *  `unconfiguredTransport`   throws, loudly, naming what is missing.
 *
 * The second is not a stub or a no-op. §1.4 forbids implying automation that
 * does not exist, and a transport that silently swallowed a message would make
 * the Admin surface report an invitation as sent when nothing left the
 * building. It throws, `createNotifier` records the failure, and the delivery
 * row stays unconfirmed — which is what an unconfigured deployment should look
 * like, and exactly what the §6 prerequisites panel is already blocking on.
 */

import { Resend } from 'resend';
import type { EmailTransport, OutgoingEmail } from './send.js';

export function createResendTransport(apiKey: string): EmailTransport {
  const resend = new Resend(apiKey);

  return {
    async send(message: OutgoingEmail) {
      const result = await resend.emails.send({
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      });

      if (result.error) {
        // The provider's own words. This reaches the audit log, never a
        // customer — §26.8: raw provider codes are never pasted into customer
        // messages.
        throw new Error(`Resend refused the message: ${result.error.message}`);
      }
      if (!result.data?.id) {
        throw new Error('Resend accepted the message but returned no id to record.');
      }

      return { providerId: result.data.id };
    },
  };
}

export const unconfiguredTransport: EmailTransport = {
  async send() {
    throw new Error(
      'No transactional email provider is configured: set RESEND_API_KEY and EMAIL_FROM. ' +
        'Nothing was sent.',
    );
  },
};
