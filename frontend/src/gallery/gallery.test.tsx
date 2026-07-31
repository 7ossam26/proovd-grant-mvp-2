/**
 * Gallery smoke test — the whole catalog mounts without throwing, so every
 * component composes together (the phase's proof, minus the browser). Full
 * visual/keyboard/screen-reader verification is manual per Spec §33.11.1.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Gallery from './Gallery.js';

describe('Gallery', () => {
  it('renders the full component catalog', () => {
    render(<Gallery />);
    expect(screen.getByText('Design system gallery')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Buttons — three tiers' }),
    ).toBeInTheDocument();
    // a representative control from deep in the catalog
    expect(
      screen.getByRole('button', { name: 'Authorize pre-order' }),
    ).toBeInTheDocument();
    // the two structural primitives are present
    expect(
      screen.getByRole('heading', { name: /the six-question pattern/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /one thing per screen/i }),
    ).toBeInTheDocument();
  });
});
