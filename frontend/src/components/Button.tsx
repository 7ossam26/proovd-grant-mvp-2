/**
 * Button — three tiers (DNA §7.1). primary: filled per section mode;
 * secondary: brand border-only; tertiary: plain bold text, no box. Hover and
 * press are bound automatically by the runtime from the tier class (variant
 * swap / fill sweep / underline + compress) — no motion code here.
 *
 * Adjacent actions must descend the tiers; that's a composition rule the caller
 * owns (never two of the same tier side by side).
 *
 * Renders a real `<button>`, or an `<a class="btn">` when `href` is given — a
 * link that looks like a button is still a link.
 */
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from 'react';
import { cn } from './cn.js';

export type ButtonTier = 'primary' | 'secondary' | 'tertiary';

const TIER_CLASS: Record<ButtonTier, string> = {
  primary: 'btn--primary',
  secondary: 'btn--secondary',
  tertiary: 'btn--tertiary',
};

interface CommonProps {
  tier?: ButtonTier;
  small?: boolean;
  children: ReactNode;
}

type ButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { href?: undefined };

type LinkButtonProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> & { href: string };

export function Button(props: ButtonProps | LinkButtonProps) {
  const { tier = 'primary', small, className, children } = props;
  const classes = cn('btn', TIER_CLASS[tier], small && 'btn--sm', className);

  if (props.href !== undefined) {
    const { tier: _t, small: _s, className: _c, children: _ch, ...rest } =
      props as LinkButtonProps;
    return (
      <a className={classes} {...rest}>
        <span className="btn__label">{children}</span>
      </a>
    );
  }

  const { tier: _t, small: _s, className: _c, children: _ch, ...rest } =
    props as ButtonProps;
  return (
    <button className={classes} {...rest}>
      <span className="btn__label">{children}</span>
    </button>
  );
}
