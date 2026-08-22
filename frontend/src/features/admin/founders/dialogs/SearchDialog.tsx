/**
 * ⌘K — one index over everything the panel has already loaded.
 *
 * ── Why there is no search route ────────────────────────────────────────────
 * The corpus is built from the two payloads this panel already holds: the
 * directory list and, when a record is open, its workspace detail. That is not
 * a shortcut around a missing endpoint — it is the only arrangement in which
 * the palette and the screen cannot disagree. A server-side search would answer
 * about rows the surface has not loaded and, worse, could answer about rows the
 * surface deliberately does not show.
 *
 * ── Five of the seven types are campaign-scoped, and degrade to empty ───────
 * `operations` is null when a person has no campaign, and the whole detail is
 * absent while the directory is open. Creator, Backer, Request and Support all
 * come from `operations`; History comes from the detail. None of them
 * substitutes a placeholder row or a zero — an absent section contributes
 * nothing to the index, which is the truthful answer to "what is there to find"
 * (§16a: "not yet populated" is not zero).
 *
 * ── An empty query renders the WHOLE corpus ─────────────────────────────────
 * The reference's own behaviour, and the right one: this sheet is an index
 * first and a filter second, so opening it shows what there is rather than an
 * empty field asking a person to guess the vocabulary.
 */

import { useMemo, useState, type ChangeEvent } from 'react';
import type { FounderListRow, FounderWorkspaceDetail } from '../api.js';
import { Overlay } from './Overlay.js';

export interface SearchItem {
  type: string;
  title: string;
  body: string;
}

/** Joins the parts that actually exist. A `·` with nothing after it is noise. */
function line(...parts: (string | number | null | undefined)[]): string {
  return parts
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== '')
    .join(' · ');
}

export function buildSearchCorpus(
  founders: FounderListRow[],
  detail: FounderWorkspaceDetail | null,
): SearchItem[] {
  const items: SearchItem[] = [];

  for (const row of founders) {
    items.push({
      type: 'Founder',
      title: row.legalName,
      body: line(row.businessName ?? row.productName, row.account, row.email),
    });
  }

  for (const row of founders) {
    if (!row.currentCampaign) continue;
    items.push({
      type: 'Campaign',
      title: row.currentCampaign.name,
      body: line(row.typeLabel, row.currentCampaign.status),
    });
  }

  const operations = detail?.operations ?? null;

  for (const creator of operations?.roster ?? []) {
    items.push({
      type: 'Creator',
      title: creator.name,
      body: line(creator.handle, creator.terms, creator.statusLabel),
    });
  }

  for (const backer of operations?.backerRows.rows ?? []) {
    items.push({
      type: 'Backer',
      title: backer.backer,
      body: line(backer.reward, backer.status, backer.attribution),
    });
  }

  for (const request of operations?.workAgain ?? []) {
    items.push({
      type: 'Request',
      title: request.creatorName,
      body: line('Work again', request.status, request.message),
    });
  }
  if (operations?.cancellation) {
    const cancellation = operations.cancellation;
    items.push({
      type: 'Request',
      title: 'Cancellation',
      body: line(cancellation.state, cancellation.kind, cancellation.customerExplanation),
    });
  }

  for (const supportCase of operations?.supportCases ?? []) {
    items.push({
      type: 'Support',
      title: supportCase.reference,
      body: line(supportCase.subject, supportCase.status, supportCase.owner),
    });
  }

  for (const entry of detail?.history ?? []) {
    items.push({ type: 'History', title: entry.title, body: line(entry.at, entry.body) });
  }

  return items;
}

interface Props {
  corpus: SearchItem[];
  /** Held by the caller, so it survives closing and reopening the sheet. */
  query: string;
  onQuery: (query: string) => void;
  onOpen: (item: SearchItem) => void;
  onClose: () => void;
}

export function SearchDialog({ corpus, query, onQuery, onOpen, onClose }: Props) {
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return corpus;
    return corpus.filter((item) =>
      `${item.type} ${item.title} ${item.body}`.toLowerCase().includes(needle),
    );
  }, [corpus, query]);

  return (
    <Overlay label="Search anything" onClose={onClose}>
      <h2>Search anything</h2>
      <input
        autoFocus
        className="search-input"
        placeholder="Founder, campaign, Creator, Backer, request, payment…"
        value={query}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onQuery(event.target.value)}
      />
      <div className="search-results">
        {results.map((item, index) => (
          <button
            key={`${item.type}-${item.title}-${index}`}
            type="button"
            onClick={() => onOpen(item)}
          >
            <small>{item.type}</small>
            <strong>{item.title}</strong>
            <span>{item.body}</span>
          </button>
        ))}
        {results.length === 0 ? <p className="empty">Nothing found.</p> : null}
      </div>
    </Overlay>
  );
}
