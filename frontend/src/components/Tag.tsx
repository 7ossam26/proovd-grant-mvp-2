/**
 * Tag (DNA §7.1). Two families, never mixed:
 *  - `live` — an action/live status: brand border + 5% fill + brand text, with
 *    a leading dot for live verbs.
 *  - quiet info — a filled chip (dark / sage / moss / mint) with mint ink.
 */
import type { ReactNode } from 'react';
import { cn } from './cn.js';

export type TagVariant = 'default' | 'sage' | 'moss' | 'mint' | 'live';

const VARIANT_CLASS: Record<TagVariant, string> = {
  default: '',
  sage: 'tag--sage',
  moss: 'tag--moss',
  mint: 'tag--mint',
  live: 'tag--live',
};

interface TagProps {
  variant?: TagVariant;
  children: ReactNode;
  className?: string;
}

export function Tag({ variant = 'default', children, className }: TagProps) {
  return (
    <span className={cn('tag', VARIANT_CLASS[variant], className)}>{children}</span>
  );
}
