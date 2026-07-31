/**
 * Reveal — text-in-motion (DNA §6.4). Renders one element carrying a
 * `data-reveal` recipe (headline / lede / kicker / typewriter) and re-binds it
 * through the runtime whenever its content changes, so a reveal survives
 * re-render. The split is reverted by the runtime, so the DOM stays selectable
 * and reflowable. One text hero per moment — don't wrap every line.
 *
 * The runtime's `init(root)` scans descendants, so the reveal element is a
 * child of the bound wrapper.
 */
import { useRef, type ElementType, type ReactNode } from 'react';
import { cn } from './cn.js';
import { useProovdMotion } from '../motion/MotionProvider.js';

export type RevealKind = 'headline' | 'lede' | 'kicker' | 'typewriter';

interface RevealProps {
  kind: RevealKind;
  /** The element to render (h1/h2/p/span/…). Default div. */
  as?: ElementType;
  /** Reveal on scroll-into-view rather than on mount. */
  scroll?: boolean;
  className?: string;
  children: ReactNode;
}

export function Reveal({ kind, as, scroll, className, children }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  useProovdMotion(ref, [children]);
  const El = (as ?? 'div') as ElementType;
  return (
    <div ref={ref}>
      <El
        className={cn(className)}
        data-reveal={kind}
        {...(scroll ? { 'data-reveal-scroll': '' } : {})}
      >
        {children}
      </El>
    </div>
  );
}
