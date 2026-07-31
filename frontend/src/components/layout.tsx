/**
 * Section modes and layout primitives (DNA §1, §4, §8).
 *
 * The architecture the whole system rests on: a component never chooses a
 * colour, only a *mode*. `<Mode kind="dark">` cascades the slot values
 * (`--mode-title`, `--btn1-*`, …) so any `.btn`, `.tag`, or heading inside is
 * automatically correct. Layout primitives are thin wrappers over the
 * proovd.css classes so surfaces compose from named pieces, not ad-hoc divs.
 */
import { useEffect, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn.js';

export type SectionMode = 'none' | 'dark' | 'light' | 'drawer';

const MODE_CLASS: Record<SectionMode, string> = {
  none: 'mode-none',
  dark: 'mode-dark',
  light: 'mode-light',
  drawer: 'mode-drawer',
};

interface ModeProps extends HTMLAttributes<HTMLDivElement> {
  kind: SectionMode;
  children: ReactNode;
}

/** Paints a section mode and cascades its slots. Colour comes from here; every
 *  descendant reads slots and stays correct. */
export function Mode({ kind, className, children, ...rest }: ModeProps) {
  return (
    <div className={cn(MODE_CLASS[kind], className)} {...rest}>
      {children}
    </div>
  );
}

interface SectionProps extends HTMLAttributes<HTMLElement> {
  mode?: SectionMode;
  /** Larger block gaps for a major page break (DNA §4.1). */
  breathe?: boolean;
  /** The lightest-grey visual-section background (`--grey-lightest`, DNA §1). */
  visual?: boolean;
  /** Wrap children in `.wrap` (max-width, centred). Default true. */
  wrap?: boolean;
  children: ReactNode;
}

/** An editorial section: block padding + inline gutters, optionally a mode and
 *  a centred wrap. Sections carry the vertical rhythm; modes carry the colour. */
export function Section({
  mode,
  breathe,
  visual,
  wrap = true,
  className,
  children,
  ...rest
}: SectionProps) {
  return (
    <section
      className={cn(
        'section',
        breathe && 'section--breathe',
        visual && 'surface--visual',
        mode && MODE_CLASS[mode],
        className,
      )}
      {...rest}
    >
      {wrap ? <div className="wrap">{children}</div> : children}
    </section>
  );
}

/** Max-width, centred content column. */
export function Wrap({ className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn('wrap', className)} {...rest}>
      {children}
    </div>
  );
}

interface ColsProps extends HTMLAttributes<HTMLDivElement> {
  /** Asymmetric 3:2 / 2:3 split when one side leads (DNA §8.2). */
  lead?: 'left' | 'right';
  children: ReactNode;
}

/** Two-column desktop composition that stacks in reading order on narrow screens. */
export function Cols({ lead, className, children, ...rest }: ColsProps) {
  return (
    <div
      className={cn(
        'cols',
        lead === 'left' && 'cols--lead-left',
        lead === 'right' && 'cols--lead-right',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface GridAutoProps extends HTMLAttributes<HTMLDivElement> {
  /** Minimum track width before wrapping (a rem value; default 16rem). */
  track?: string;
  children: ReactNode;
}

/** Responsive auto-fit grid — galleries, stat rows, sticker walls. */
export function GridAuto({ track, className, style, children, ...rest }: GridAutoProps) {
  return (
    <div
      className={cn('grid-auto', className)}
      style={track ? ({ ['--track']: track, ...style } as React.CSSProperties) : style}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Caps a text column at a comfortable measure (DNA §9). */
export function Measure({ className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn('measure', className)} {...rest}>
      {children}
    </div>
  );
}

interface DockProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** The moment's primary action, docked under the thumb on phones and rendered
 *  as a normal row on desktop (DNA §8.1). Reserves space so it never covers
 *  content. */
export function Dock({ className, children, ...rest }: DockProps) {
  useEffect(() => {
    document.body.classList.add('has-dock');
    return () => document.body.classList.remove('has-dock');
  }, []);
  return (
    <div className={cn('dock', className)} {...rest}>
      {children}
    </div>
  );
}
