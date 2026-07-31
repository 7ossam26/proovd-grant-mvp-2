/**
 * Glance / Act / Explore scaffold (DNA §5.2). Glance (what changed + state)
 * and Act (the single next-best action, pre-chosen by the product) are the
 * landing view; Explore (the full control surface) is always one gesture away
 * behind the drawer, and never the landing state.
 */
import type { ReactNode } from 'react';
import { Drawer } from './Drawer.js';
import { Button } from './Button.js';

interface ScaffoldProps {
  /** What changed and what state things are in — the hero + a quiet line. */
  glance: ReactNode;
  /** The single next-best action, attached to the copy that explains it. */
  act: ReactNode;
  /** The full control surface, staged in the Explore drawer. */
  explore: ReactNode;
  exploreTitle?: ReactNode;
  exploreLabel?: string;
}

export function Scaffold({
  glance,
  act,
  explore,
  exploreTitle = 'Explore',
  exploreLabel = 'Explore everything',
}: ScaffoldProps) {
  return (
    <div className="scaffold">
      <div className="scaffold__glance">{glance}</div>
      <div className="scaffold__act">{act}</div>
      <div className="scaffold__explore-open">
        <Drawer
          title={exploreTitle}
          trigger={
            <Button tier="secondary">{exploreLabel}</Button>
          }
        >
          {explore}
        </Drawer>
      </div>
    </div>
  );
}
