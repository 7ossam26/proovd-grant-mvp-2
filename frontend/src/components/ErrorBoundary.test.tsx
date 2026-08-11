/**
 * The boundary that turns a blank page into a sentence. §1.1, §27.1, §30.
 *
 * Before this existed a single throw unmounted the whole app and left the
 * viewer nothing at all — which on an Admin surface is indistinguishable from a
 * slow load, and on a portal surface leaves `#root` marked `aria-hidden` with
 * focus stranded behind it.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { ErrorBoundary } from './ErrorBoundary.js';

function Throws(): never {
  throw new Error('the registry payload had no subtypes');
}

afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>the surface</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('the surface')).toBeTruthy();
  });

  it('answers §27.1 six questions and names the error as technical detail', () => {
    // React logs the caught error itself; the boundary logs its own line. Both
    // are noise here and neither is what the test is about.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary area="the Creators workspace">
        <Throws />
      </ErrorBoundary>,
    );

    expect(screen.getByText('This screen could not be displayed')).toBeTruthy();
    // What happened, named where — not a generic apology (§30).
    expect(screen.getByText(/on the Creators workspace/)).toBeTruthy();
    // Money/data status, which §30 requires an error state to carry.
    expect(screen.getByText(/Nothing you had already saved was changed/)).toBeTruthy();
    // Who owns it, when the next update is, what to do, and how to get help.
    expect(screen.getByText('Proovd')).toBeTruthy();
    expect(screen.getByText(/No update is pending/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload this page' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Get help/i })).toBeTruthy();
    // The thrower's own words appear, but as the reference — never as the
    // explanation, because whoever threw wrote them for a developer.
    expect(screen.getByText(/the registry payload had no subtypes/)).toBeTruthy();
  });

  it('has no axe violations in the failure state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundary>
        <Throws />
      </ErrorBoundary>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
