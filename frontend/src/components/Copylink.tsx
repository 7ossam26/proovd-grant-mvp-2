/**
 * Copylink (DNA §1) — a brand-ringed row showing a URL with a border-only copy
 * button and one-click confirmation. The URL truncates with an ellipsis rather
 * than wrapping (DNA §9). Confirmation is a toast (role="status"), so the copy
 * is announced, plus a brief button label change.
 */
import { useRef, useState } from 'react';
import { cn } from './cn.js';
import { CopyIcon } from './icons.js';
import { useToast } from '../motion/MotionProvider.js';

interface CopylinkProps {
  url: string;
  /** Shorter display text; the full `url` is still what gets copied. */
  display?: string;
  className?: string;
}

export function Copylink({ url, display, className }: CopylinkProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(url);
      toast('Link copied', { sub: display ?? url });
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      toast('Copy failed — select and copy the link', { accent: 'yellow' });
    }
  }

  return (
    <div className={cn('copylink', className)}>
      <span className="copylink__url" title={url}>
        {display ?? url}
      </span>
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        onClick={copy}
        aria-label={`Copy link: ${display ?? url}`}
      >
        <span className="btn__label">
          <CopyIcon />
          {copied ? 'Copied' : 'Copy'}
        </span>
      </button>
    </div>
  );
}
