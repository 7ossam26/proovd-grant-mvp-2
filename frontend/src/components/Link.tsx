/**
 * Link (DNA §7.1) — section-mode ink with the underline-draw hover, bound
 * automatically by the runtime for `a:not(.btn)`. External links get the safe
 * rel and an accessible hint that they open in a new tab.
 */
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn.js';

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  external?: boolean;
  children: ReactNode;
}

export function Link({ external, className, children, ...rest }: LinkProps) {
  const externalProps = external
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {};
  return (
    <a className={cn(className)} {...externalProps} {...rest}>
      {children}
      {external ? <span className="pv-sr"> (opens in a new tab)</span> : null}
    </a>
  );
}
