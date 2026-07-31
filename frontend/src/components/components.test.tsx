/**
 * Design-system acceptance tests (Spec §33.11.2): every control has a role and
 * an accessible name, errors are programmatically associated, and the principal
 * interactions are reachable by keyboard. Motion is absent in jsdom, so these
 * assert semantics and behaviour, not animation.
 *
 * axe runs with color-contrast disabled: jsdom can't measure rendered colour,
 * and the one sub-AA pair (brand fill / mint text, the --btn1 pair) is a recorded, dated DNA
 * exception (tech-stack §3.6), not a bug to catch here.
 */
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import {
  Accordion,
  Button,
  Field,
  Input,
  Menu,
  Modal,
  Option,
  Progress,
  StatePanel,
  Stepper,
  Tabs,
  Toggle,
} from './index.js';

const axeOptions = { rules: { 'color-contrast': { enabled: false } } };

describe('Button', () => {
  it('renders each tier as a real button, and href as a link', () => {
    render(
      <>
        <Button tier="primary">Save</Button>
        <Button tier="tertiary">Cancel</Button>
        <Button href="/x">Go</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go' })).toHaveAttribute('href', '/x');
  });
});

describe('Field + Input', () => {
  it('associates the label with the control', () => {
    render(
      <Field label="Legal name">
        <Input placeholder="Ada" />
      </Field>,
    );
    expect(screen.getByLabelText('Legal name')).toBeInTheDocument();
  });

  it('associates an error programmatically and marks the control invalid', () => {
    render(
      <Field label="Email" error="Enter a valid email.">
        <Input defaultValue="nope" />
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Enter a valid email.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Field label="Email" hint="We only use it for receipts.">
        <Input defaultValue="a@b.com" />
      </Field>,
    );
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });
});

describe('Toggle (Radix Switch)', () => {
  it('is a switch with an accessible name and toggles by click and keyboard', async () => {
    const user = userEvent.setup();
    render(<Toggle label="Email me before every charge" />);
    const sw = screen.getByRole('switch', { name: 'Email me before every charge' });
    expect(sw).toHaveAttribute('aria-checked', 'false');

    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');

    sw.focus();
    await user.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });
});

describe('Option (Radix Checkbox)', () => {
  it('is a checkbox with an accessible name and toggles', async () => {
    const user = userEvent.setup();
    render(<Option label="Charge at the close date" />);
    const box = screen.getByRole('checkbox', { name: 'Charge at the close date' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    await user.click(box);
    expect(box).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Stepper', () => {
  function Harness() {
    const [v, setV] = useState(2);
    return <Stepper value={v} onValueChange={setV} label="quantity" min={1} max={3} />;
  }

  it('is a labelled group with named +/- actions that change the value', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'quantity' })).toBeInTheDocument();
    const inc = screen.getByRole('button', { name: 'Increase quantity' });
    const dec = screen.getByRole('button', { name: 'Decrease quantity' });

    await user.click(inc); // 2 -> 3 (max)
    expect(inc).toBeDisabled();
    await user.click(dec); // 3 -> 2
    expect(inc).toBeEnabled();
  });
});

describe('Tabs (Radix)', () => {
  it('exposes tablist/tab/tabpanel and moves selection with arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <Tabs
        label="Views"
        items={[
          { value: 'a', label: 'Glance', content: <p>Glance body</p> },
          { value: 'b', label: 'Backers', content: <p>Backers body</p> },
        ]}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument();
    const first = screen.getByRole('tab', { name: 'Glance' });
    expect(first).toHaveAttribute('aria-selected', 'true');

    first.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Backers' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
  });
});

describe('Accordion (Radix)', () => {
  it('toggles aria-expanded and reveals its panel', async () => {
    const user = userEvent.setup();
    render(
      <Accordion
        items={[{ value: 'q1', head: 'When am I charged?', body: <p>Only when proven.</p> }]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'When am I charged?' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Only when proven.')).toBeInTheDocument();
  });
});

describe('Menu (Radix DropdownMenu)', () => {
  it('opens to menu items from a named trigger', async () => {
    const user = userEvent.setup();
    render(
      <Menu
        label="Actions"
        trigger={<Button tier="secondary">Actions</Button>}
        items={[
          { label: 'Share', onSelect: () => {} },
          { label: 'Edit', onSelect: () => {} },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menuitem', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
  });
});

describe('Modal (Radix Dialog)', () => {
  it('opens a named dialog from its trigger and closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Modal
        title="Cancel this pre-order?"
        description="You won’t be charged."
        trigger={<Button tier="secondary">Open</Button>}
      >
        <p>Body</p>
      </Modal>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this pre-order?' });
    expect(dialog).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('dialog', { name: 'Cancel this pre-order?' }),
    ).not.toBeInTheDocument();
  });
});

describe('Progress', () => {
  it('is a progressbar with a name and value', () => {
    render(<Progress value={0.4} label="Reserved so far" />);
    const bar = screen.getByRole('progressbar', { name: 'Reserved so far' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
  });
});

describe('StatePanel (six questions)', () => {
  it('answers all six and names its region', async () => {
    const { container } = render(
      <StatePanel
        state="We’re reviewing your campaign."
        whatHappened="You submitted it for review."
        next="A human checks the rules."
        owner="Proovd"
        nextUpdate="Within two business days"
        action="No action needed"
        reference="CMP-4821"
        getHelp={{ onClick: () => {} }}
      />,
    );
    const region = screen.getByRole('region', {
      name: 'We’re reviewing your campaign.',
    });
    const scoped = within(region);
    expect(scoped.getByText('What happened')).toBeInTheDocument();
    expect(scoped.getByText('Next')).toBeInTheDocument();
    expect(scoped.getByText('Owner')).toBeInTheDocument();
    expect(scoped.getByText('Next update by')).toBeInTheDocument();
    expect(scoped.getByText('Reference')).toBeInTheDocument();
    expect(scoped.getByText('No action needed')).toBeInTheDocument();
    expect(scoped.getByRole('button', { name: /get help/i })).toBeInTheDocument();
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });
});
