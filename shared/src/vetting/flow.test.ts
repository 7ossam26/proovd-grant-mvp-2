import { describe, expect, it } from 'vitest';
import { FOUNDER_FLOW_PAGES, founderFlowPath } from './flow.js';

describe('Founder Flow Stage 5', () => {
  it('keeps launch preparation and going live in its fixed order', () => {
    expect(
      FOUNDER_FLOW_PAGES.filter((page) => page.stage === 5).map((page) => ({
        id: page.id,
        title: page.title,
        path: page.path,
      })),
    ).toEqual([
      { id: 'voice', title: 'Your brand voice', path: '/campaigns/:campaignId/setup/voice' },
      { id: 'threshold', title: 'Your order threshold', path: '/campaigns/:campaignId/setup/threshold' },
      { id: 'faqs', title: 'Your FAQs', path: '/campaigns/:campaignId/setup/faqs' },
      { id: 'rewards', title: 'Your Backer rewards', path: '/campaigns/:campaignId/setup/rewards' },
      { id: 'payouts', title: 'How you get paid', path: '/campaigns/:campaignId/setup/payouts' },
      { id: 'in-review', title: 'Your campaign in review', path: '/campaigns/:campaignId/setup/in-review' },
      { id: 'live', title: 'Your campaign is live', path: '/campaigns/:campaignId/setup/live' },
      { id: 'password', title: 'Secure your account', path: '/campaigns/:campaignId/setup/password' },
    ]);
  });

  it('builds the campaign launch address used by Continue to launch', () => {
    expect(founderFlowPath('live', 'campaign-a')).toBe('/campaigns/campaign-a/setup/live');
  });
});
