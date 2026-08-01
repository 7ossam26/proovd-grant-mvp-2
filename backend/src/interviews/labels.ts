/**
 * Customer-facing names for §12's three conferencing providers.
 *
 * `shared/src/workspace/interview.ts` holds the same map for the surfaces,
 * which import it through Vite. The backend cannot import `@proovd/shared` at
 * runtime, and an email is a customer-facing surface — §3 forbids an internal
 * name reaching one, and `microsoft_teams` in a Founder's inbox is exactly that
 * leak. Restated here, drift-tested in `interview-webhook.test.ts`.
 */

import type { MeetingProvider } from '../workspace/registry.js';

export const MEETING_PROVIDER_LABELS: Record<MeetingProvider, string> = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  microsoft_teams: 'Microsoft Teams',
};
