/**
 * The `/` search palette — Spec §26.1, §28.5, DNA §5.2.
 *
 * ── Why it exists at all, given the directory has a search box ──────────────
 * The directory's box narrows a list you are already looking at. This finds a
 * person from anywhere in the section — from a relationship's Money pane, from
 * a history page — which is the move an Admin makes most and the one that
 * otherwise costs two navigations.
 *
 * ── It searches the same text the directory does ────────────────────────────
 * `searchText` is composed server-side across the name, handle, email,
 * platform, niche, channel reference, subtype, and every campaign the person is
 * on. One source, so the palette and the directory can never disagree about
 * what "matches" means — and the campaign names being in it is why typing a
 * campaign finds the Creators on it.
 *
 * ── Keyboard first, because that is the whole point ─────────────────────────
 * `/` opens it, and is suppressed inside inputs and textareas so typing a slash
 * into a reason field does not open a palette over it. Escape closes. Arrow
 * keys move; Enter opens. A palette you have to reach for with a mouse is a
 * second directory.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog } from 'radix-ui';
import { cn } from '../../../components/cn.js';
import { fetchCreators, type CreatorDirectoryRow } from './api.js';

/** The reference's own cap. A palette that lists everything is the list. */
const MAX_RESULTS = 12;

export function CreatorSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CreatorDirectoryRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * `/` opens it — except while somebody is typing.
   *
   * Without the guard, a slash inside an enforcement reason opens a search
   * overlay on top of the form and eats the keystroke. The reference guards the
   * same way, and it is the difference between a shortcut and a trap.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /*
   * Read once, on first open. The directory is a hand-recruited roster rather
   * than an unbounded table, and re-reading on every keystroke would be a
   * request per character for a list that has not changed.
   */
  const load = useCallback(() => {
    if (rows) return;
    fetchCreators()
      .then(({ creators }) => setRows(creators))
      .catch(() => setRows([]));
  }, [rows]);

  useEffect(() => {
    if (open) {
      load();
      setActive(0);
    }
  }, [open, load]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!rows || needle === '') return [];
    return rows.filter((row) => row.searchText.includes(needle)).slice(0, MAX_RESULTS);
  }, [rows, query]);

  function choose(row: CreatorDirectoryRow) {
    setOpen(false);
    setQuery('');
    void navigate(`/admin/creators/${row.prospectId}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = results[active];
      if (row) choose(row);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="cr-searchbtn" aria-label="Find an Affiliate">
          Find an Affiliate…
          <kbd>/</kbd>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content
          className="cr-palette"
          onOpenAutoFocus={(event) => {
            // Focus the box rather than the panel: the whole interaction is
            // typing, and landing on a container costs a Tab first.
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Dialog.Title className="sr-only">Find an Affiliate</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search every Affiliate by name, username, email, channel, or campaign.
          </Dialog.Description>

          <input
            ref={inputRef}
            className="input cr-palette__input"
            type="search"
            value={query}
            placeholder="Find an Affiliate, channel, or campaign…"
            aria-label="Find an Affiliate"
            aria-controls="cr-palette-results"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />

          <div id="cr-palette-results" role="listbox" aria-label="Search results">
            {query.trim() === '' ? (
              <p className="helper">
                Type to search across names, usernames, emails, channels, and campaigns.
              </p>
            ) : results.length === 0 ? (
              <p className="grey">No matching Affiliate.</p>
            ) : (
              results.map((row, index) => (
                <button
                  key={row.prospectId}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={cn('cr-palette__row', index === active && 'is-active')}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(row)}
                >
                  <span>
                    <strong>{row.name}</strong>
                    <small>
                      {[row.handle, row.platform].filter(Boolean).join(' · ') ||
                        'No channel recorded'}
                    </small>
                  </span>
                  <small>
                    {row.campaigns.total}{' '}
                    {row.campaigns.total === 1 ? 'campaign' : 'campaigns'}
                  </small>
                </button>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
