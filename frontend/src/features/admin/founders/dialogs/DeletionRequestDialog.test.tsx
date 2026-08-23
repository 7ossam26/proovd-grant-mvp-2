import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeletionRequestDialog } from './DeletionRequestDialog.js';

describe('Founder account-closure request dialog', () => {
  it('requires and submits the request, provenance, and requested time', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onRefuse = vi.fn();
    render(
      <DeletionRequestDialog
        founderName="Rowan"
        onConfirm={onConfirm}
        onClose={() => undefined}
        onRefuse={onRefuse}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Record request' }));
    expect(onRefuse).toHaveBeenCalledWith(
      'The request, how it was received, and when the Founder asked are required',
    );

    await user.type(screen.getByLabelText('What the Founder asked'), 'Please close my account.');
    await user.type(screen.getByLabelText('How the request was received'), 'support case PVD-123');
    await user.type(screen.getByLabelText('When the Founder asked'), '2026-08-23T09:30');
    await user.click(screen.getByRole('button', { name: 'Record request' }));

    expect(onConfirm).toHaveBeenCalledWith({
      detail: 'Please close my account.',
      receivedVia: 'support case PVD-123',
      requestedAt: expect.stringMatching(/^2026-08-23T/),
    });
  });
});
