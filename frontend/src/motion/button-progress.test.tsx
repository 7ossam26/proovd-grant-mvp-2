/**
 * The one thing `useButtonProgress` has to do: run the work.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * `window.Proovd` is never defined under jsdom — `proovd-motion.js` is a static
 * file the browser loads from `index.html`, not a module anything imports — so
 * every existing suite takes the hook's no-runtime fallback, which calls `work`
 * directly. The runtime path was therefore never executed by a test, and it was
 * the broken one: it handed `buttonProgress` the callback where the runtime
 * expects the in-flight promise, so the morph played against a 1.2-second timer
 * and the work never ran. Every submit behind the hook animated to a tick and
 * sent nothing.
 *
 * Asserting on a real morph would mean asserting on GSAP. What matters is the
 * contract between the hook and the runtime, so the double makes the same
 * decision the real one makes — `typeof work.then === 'function'`, copied from
 * `proovd-motion.js` — and records what it was handed.
 */

import { useRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MotionProvider, useButtonProgress } from './MotionProvider.js';
import type { ProovdAPI } from './proovd-motion.js';

type ProgressButton = HTMLButtonElement & { __pvBusy?: boolean };

/** What the real `buttonProgress` does with its second argument, verbatim. */
function thenable(work: unknown): boolean {
  return Boolean(work) && typeof (work as PromiseLike<unknown>).then === 'function';
}

/** True once `buttonProgress` was handed something it will actually await. */
function installRuntime(): () => boolean {
  let awaited = false;
  const api = {
    buttonProgress: async (btn: HTMLElement, work?: Promise<unknown> | number) => {
      const marked = btn as ProgressButton;
      if (marked.__pvBusy) return;
      marked.__pvBusy = true;
      marked.disabled = true;
      // The substitution that hid the defect: anything not thenable becomes a
      // timer, and the caller's work is dropped on the floor.
      if (thenable(work)) {
        awaited = true;
        try {
          await work;
        } catch {
          /* the real runtime restores and resolves — see ConfirmDialog */
        }
      }
      marked.__pvBusy = false;
      marked.disabled = false;
    },
    init: () => {},
    toast: () => {},
  } as unknown as ProovdAPI;

  (window as unknown as { Proovd?: ProovdAPI }).Proovd = api;
  return () => awaited;
}

function Submit({ work }: { work: () => Promise<unknown> }) {
  const withProgress = useButtonProgress();
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      className="btn btn--primary"
      onClick={() => void withProgress(ref, work)}
    >
      <span className="btn__label">Add founder</span>
    </button>
  );
}

function mount(work: () => Promise<unknown>) {
  return render(
    <MemoryRouter>
      <MotionProvider initOnNavigate={false}>
        <Submit work={work} />
      </MotionProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  delete (window as unknown as { Proovd?: ProovdAPI }).Proovd;
});

describe('useButtonProgress — the morph never replaces the work', () => {
  it('runs the work when the runtime is loaded, and hands it the promise', async () => {
    const awaited = installRuntime();
    const work = vi.fn(async () => 'created');

    mount(work);
    await userEvent.click(screen.getByRole('button', { name: 'Add founder' }));

    await waitFor(() => expect(work).toHaveBeenCalledTimes(1));
    // The half that regressed: called is not enough — the runtime has to be
    // awaiting that same promise, or the morph finishes before the request
    // does and the caller closes its dialog on a request still in flight.
    expect(awaited()).toBe(true);
  });

  it('runs the work when the runtime never loaded', async () => {
    const work = vi.fn(async () => 'created');

    mount(work);
    await userEvent.click(screen.getByRole('button', { name: 'Add founder' }));

    await waitFor(() => expect(work).toHaveBeenCalledTimes(1));
  });

  it('starts no work the runtime would drop', async () => {
    installRuntime();
    const work = vi.fn(async () => 'created');

    mount(work);
    const button = screen.getByRole('button', { name: 'Add founder' }) as ProgressButton;
    // A morph already in flight: the runtime ignores the second call, so
    // starting the request anyway would send it and discard the answer.
    button.__pvBusy = true;
    await userEvent.click(button);

    expect(work).not.toHaveBeenCalled();
  });
});
