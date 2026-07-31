/**
 * Stat (DNA §1 small sections, §7.1) — a statistic or statement chip in one of
 * three treatments: mint, dark, or white-with-brand-ring. On the white variant
 * the value may read brand or dark ink. The value is a display-scale hero; the
 * sub-line is the quiet grey label.
 */
import type { ReactNode } from 'react';
import { cn } from './cn.js';

export type StatVariant = 'mint' | 'dark' | 'white';

const VARIANT_CLASS: Record<StatVariant, string> = {
  mint: 'stat--mint',
  dark: 'stat--dark',
  white: 'stat--white',
};

interface StatProps {
  variant: StatVariant;
  value: ReactNode;
  sub?: ReactNode;
  /** White variant only: render the value in brand ink instead of dark. */
  brandValue?: boolean;
  className?: string;
}

export function Stat({ variant, value, sub, brandValue, className }: StatProps) {
  return (
    <div
      className={cn(
        'stat',
        VARIANT_CLASS[variant],
        variant === 'white' && brandValue && 'stat--brandval',
        className,
      )}
    >
      <div className="stat__value">{value}</div>
      {sub ? <div className="stat__sub">{sub}</div> : null}
    </div>
  );
}
