/**
 * The Proovd design-system vocabulary (Phase 02). Every later surface is built
 * from these pieces — none of them chooses a colour, only a mode; none writes
 * its own motion outside the runtime; every one is keyboard- and
 * screen-reader-operable at the narrowest supported width.
 */

// Section modes + layout
export {
  Mode,
  Section,
  Wrap,
  Cols,
  GridAuto,
  Measure,
  Dock,
  type SectionMode,
} from './layout.js';

// Identity table (DNA §7.1)
export { Button, type ButtonTier } from './Button.js';
export { Input, Textarea, Field } from './Input.js';
export { Toggle } from './Toggle.js';
export { Option } from './Option.js';
export { Choice, type ChoiceEntry } from './Choice.js';
export { Stepper } from './Stepper.js';
export { Tag, type TagVariant } from './Tag.js';
export { Card } from './Card.js';
export { Link } from './Link.js';
export { Progress } from './Progress.js';
export { Copylink } from './Copylink.js';
export { Sticker } from './Sticker.js';
export { Stat, type StatVariant } from './Stat.js';

// Overlays + navigation (Radix behaviour, proovd.css looks, GSAP motion)
export { Modal } from './Modal.js';
export { Drawer } from './Drawer.js';
export { Menu, type MenuItem } from './Menu.js';
export { Accordion, type AccordionEntry } from './Accordion.js';
export { Tabs, type TabEntry } from './Tabs.js';

// Structural primitives
export { StatePanel, NO_ACTION, type StateOwner } from './StatePanel.js';
export { Flow, type FlowStep } from './Flow.js';
export { Scaffold } from './Scaffold.js';
export { Reveal, type RevealKind } from './Reveal.js';

// Icons
export * from './icons.js';

// Motion hooks (imperative surfaces — toasts, number rolls, button progress)
export {
  useToast,
  useButtonProgress,
  useNumberRoll,
  useProovdMotion,
  useProovdRuntime,
} from '../motion/MotionProvider.js';
