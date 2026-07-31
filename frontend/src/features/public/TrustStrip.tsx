/**
 * Renders Appendix A.1. See `trust-strip.ts` for why the text is derived
 * rather than transcribed, and for the one sentence that differs from the
 * Appendix while Stripe underwriting is open.
 */

import { Link as RouterLink } from 'react-router';
import {
  TRUST_STRIP_HEADING,
  TRUST_STRIP_LINKS,
  TRUST_STRIP_PARAGRAPHS,
} from './trust-strip.js';

export function TrustStrip() {
  return (
    <section className="trust-strip" aria-labelledby="trust-strip-heading">
      <h2 className="h2" id="trust-strip-heading">
        {TRUST_STRIP_HEADING}
      </h2>
      {TRUST_STRIP_PARAGRAPHS.map((paragraph) => (
        <p key={paragraph.slice(0, 40)}>{paragraph}</p>
      ))}
      <ul className="trust-strip__links">
        {TRUST_STRIP_LINKS.map((link) => (
          <li key={link.href}>
            {link.prefix}
            <RouterLink to={link.href}>{link.url}</RouterLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
