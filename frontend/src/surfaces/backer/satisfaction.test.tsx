/**
 * Phase 21b's two surfaces — §33.10.9 and §33.10.10.
 *
 * The backend suite proves the records; what only a surface can show is that
 * the answer takes one interaction, that nothing is asked alongside it, and
 * that the Founder sees TWO gates rather than one summary.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Satisfaction } from './Satisfaction.js';
import { NextCampaign } from '../founder/NextCampaign.js';

const PROGRESSION = [
  { key: 'reserved', label: 'Reserved', state: 'done' as const },
  { key: 'captured', label: 'Captured', state: 'done' as const },
  { key: 'delivered', label: 'Delivered', state: 'current' as const },
];

describe('§33.10.10 — satisfaction takes one interaction', () => {
  it('records the answer on the first click, with nothing required first', async () => {
    const onAnswer = vi.fn().mockResolvedValue({ followUp: 'Thank you — that is all we needed.' });
    render(
      <Satisfaction
        reservationId="r1"
        progression={PROGRESSION}
        askable
        answered={false}
        onAnswer={onAnswer}
        onReason={vi.fn()}
      />,
    );

    // Nothing to fill in, nothing to tick, nothing to expand.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /what i expected/i }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(await screen.findByText(/that is all we needed/i)).toBeInTheDocument();
  });

  it('never asks for a newsletter, a subscription, or any other consent (§31.8)', () => {
    const { container } = render(
      <Satisfaction
        reservationId="r1"
        progression={PROGRESSION}
        askable
        answered={false}
        onAnswer={vi.fn()}
        onReason={vi.fn()}
      />,
    );
    // No control to precheck, and no copy inviting one.
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    const text = container.textContent?.toLowerCase() ?? '';
    for (const banned of ['newsletter', 'subscribe', 'marketing', 'updates from us', 'mailing']) {
      expect(text).not.toContain(banned);
    }
  });

  it('makes the reason genuinely optional — it appears after, and is skippable', async () => {
    const onReason = vi.fn().mockResolvedValue(undefined);
    render(
      <Satisfaction
        reservationId="r1"
        progression={PROGRESSION}
        askable
        answered={false}
        onAnswer={vi.fn().mockResolvedValue({ followUp: 'Thank you.' })}
        onReason={onReason}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /what i expected/i }));
    // It exists now, and the answer is already recorded without it.
    expect(await screen.findByRole('textbox')).toBeInTheDocument();
    expect(onReason).not.toHaveBeenCalled();
  });

  it('routes a negative answer to a person, and says so', async () => {
    render(
      <Satisfaction
        reservationId="r1"
        progression={PROGRESSION}
        askable
        answered={false}
        onAnswer={vi
          .fn()
          .mockResolvedValue({ followUp: 'Someone at Proovd will follow this up with you.' })}
        onReason={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /something was wrong/i }));
    expect(await screen.findByText(/someone at proovd will follow this up/i)).toBeInTheDocument();
  });

  it('asks nothing at all once answered, or before a delivery (§30)', () => {
    const { rerender, container } = render(
      <Satisfaction
        reservationId="r1"
        progression={PROGRESSION}
        askable={false}
        answered={false}
        onAnswer={vi.fn()}
        onReason={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(
      <Satisfaction
        reservationId="r1"
        progression={PROGRESSION}
        askable={false}
        answered
        onAnswer={vi.fn()}
        onReason={vi.fn()}
      />,
    );
    expect(container.textContent).not.toMatch(/how did it go/i);
  });

  it('renders only the steps it is given, and marks the current one', () => {
    render(
      <Satisfaction
        reservationId="r1"
        progression={PROGRESSION}
        askable={false}
        answered
        onAnswer={vi.fn()}
        onReason={vi.fn()}
      />,
    );
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    // §31.8: nothing is shown ahead of where things actually are.
    expect(within(list).queryByText('Refunded')).not.toBeInTheDocument();
    expect(within(list).getByText('Now')).toBeInTheDocument();
  });
});

describe('§33.10.9 — the Founder sees two gates, not one', () => {
  const BASE = {
    cooldown: {
      months: 3,
      closedAt: '2026-05-01T00:00:00.000Z',
      earliestAt: '2026-08-01T00:00:00.000Z',
      elapsed: false,
      blocker: null,
    },
    adminReadiness: { decision: null, decidedAt: null, explanation: null },
    readyForNextCampaign: false,
    prepareNote: 'You can prepare updates and evidence now. Nothing here opens a new campaign.',
  } as const;

  it('shows the exact date rather than an approximation', () => {
    render(<NextCampaign view={{ ...BASE }} />);
    // The day, not "in about three months". A Founder plans against this.
    expect(screen.getAllByText(/2026-08-01 00:00 UTC/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/about (a|three)/i)).not.toBeInTheDocument();
  });

  it('renders the readiness decision as its own separate thing', () => {
    render(<NextCampaign view={{ ...BASE }} />);
    expect(screen.getByText(/three-month wait/i)).toBeInTheDocument();
    expect(screen.getByText(/readiness decision/i)).toBeInTheDocument();
    expect(screen.getByText(/decided separately from the wait/i)).toBeInTheDocument();
  });

  it('does not say ready when only the cooldown has passed', () => {
    render(
      <NextCampaign
        view={{ ...BASE, cooldown: { ...BASE.cooldown, elapsed: true } }}
      />,
    );
    expect(screen.getByText(/both parts above have to be done/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Ready for next campaign$/)).not.toBeInTheDocument();
  });

  it('does not say ready when only the Admin has approved', () => {
    render(
      <NextCampaign
        view={{
          ...BASE,
          adminReadiness: {
            decision: 'ready',
            decidedAt: '2026-06-01T00:00:00.000Z',
            explanation: 'You delivered on time.',
          },
        }}
      />,
    );
    expect(screen.getByText(/both parts above have to be done/i)).toBeInTheDocument();
  });

  it('says ready only with both, and still names what this page is not', () => {
    render(
      <NextCampaign
        view={{
          ...BASE,
          cooldown: { ...BASE.cooldown, elapsed: true },
          adminReadiness: {
            decision: 'ready',
            decidedAt: '2026-06-01T00:00:00.000Z',
            explanation: 'You delivered on time.',
          },
          readyForNextCampaign: true,
        }}
      />,
    );
    expect(screen.getByText('Ready for next campaign')).toBeInTheDocument();
    // §22.10's promise stays on the page even once both gates are open.
    expect(screen.getByText(/nothing here opens a new campaign/i)).toBeInTheDocument();
  });

  it('names why the date is missing rather than showing nothing (§1.4)', () => {
    render(
      <NextCampaign
        view={{
          ...BASE,
          cooldown: {
            months: 3,
            closedAt: null,
            earliestAt: null,
            elapsed: false,
            blocker: 'This campaign has not closed yet, so the cooldown has not started counting.',
          },
        }}
      />,
    );
    expect(screen.getByText(/has not started counting/i)).toBeInTheDocument();
  });
});
