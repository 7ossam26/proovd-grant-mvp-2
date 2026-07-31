/**
 * Card (DNA §4.2, §7.1) — a brand-ringed container, never grey, used only when
 * content genuinely needs a boundary (a metric, a distinct state, a grouped set
 * of controls). Not a default wrapper for plain copy — that's what negative
 * space is for.
 */
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn.js';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Solid white fill inside the brand ring. */
  white?: boolean;
  children: ReactNode;
}

export function Card({ white, className, children, ...rest }: CardProps) {
  return (
    <div className={cn('card', white && 'card--white', className)} {...rest}>
      {children}
    </div>
  );
}
