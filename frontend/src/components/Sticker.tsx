/**
 * Sticker / placeholder (DNA §1) — the rectangle-in-rectangle motif. `sk-1`…
 * `sk-14` resolve to a valid colour pair for whatever background they sit on,
 * so callers pick a number, never a colour. Decorative only (aria-hidden) —
 * this colour system is for placeholders and stickers, never UI (DNA §1).
 */
import { cn } from './cn.js';

interface StickerProps {
  /** 1–14; wraps to a valid pair on any background. */
  n: number;
  /** 16:10 instead of square. */
  wide?: boolean;
  /** Fill the container width. */
  fill?: boolean;
  /** Explicit size as a rem/other responsive value → `--sk-size`. */
  size?: string;
  className?: string;
}

export function Sticker({ n, wide, fill, size, className }: StickerProps) {
  const idx = ((Math.trunc(n) - 1 + 14) % 14) + 1; // clamp into 1..14, wrapping
  return (
    <span
      className={cn(
        'sticker',
        `sk-${idx}`,
        wide && 'sticker--wide',
        fill && 'sticker--fill',
        className,
      )}
      style={size ? ({ ['--sk-size']: size } as React.CSSProperties) : undefined}
      aria-hidden="true"
    />
  );
}
