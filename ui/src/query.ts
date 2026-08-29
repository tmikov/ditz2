/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Filter } from 'ditz2';

export interface Query {
  filter: Filter;
  /** The bare words, rejoined. null when only key:value terms were typed. */
  pattern: string | null;
}

/**
 * Every key the field understands. `all` is here with the rest, not on a
 * branch of its own, so that one empty-value rule covers all five.
 */
const KEYS = ['status', 'component', 'assignee', 'type', 'all'] as const;
type Key = (typeof KEYS)[number];

function isKnownKey(key: string): key is Key {
  return (KEYS as readonly string[]).includes(key);
}

/**
 * What `assignee:me` should match.
 *
 * The author is stored as "Name <email>" but assignees are written by hand and
 * are usually the bare email, so the email is the higher-probability match.
 * Returns null when no identity is configured, which leaves "me" literal.
 */
export function meAs(author: string | null): string | null {
  if (author === null) return null;
  return /<([^>]+)>/.exec(author)?.[1]?.trim() ?? author;
}

/**
 * Parses the `/` field into the two halves the snapshot is narrowed by.
 *
 * Never throws, and never validates a value. Half-typed text arrives here on
 * every keystroke, and the vocabulary rules live in ditz2's applyFilter — a
 * copy of them here would be free to drift from the one the CLI enforces.
 */
export function parseQuery(text: string, me: string | null): Query {
  const filter: Filter = {};
  const words: string[] = [];

  for (const term of text.trim().split(/\s+/).filter((t) => t !== '')) {
    const m = /^([a-z]+):(.*)$/.exec(term);
    const key = m?.[1];
    const value = m?.[2];

    // Anything that is not a known key:value term is part of the regex —
    // "http://example.com" is a bare word, not a filter on a key named "http".
    if (key === undefined || value === undefined || !isKnownKey(key)) {
      words.push(term);
      continue;
    }

    // An empty value un-sets the key rather than filtering on "", so that
    // "status:" on the way to "status:open" is not a transient error. This
    // has to cover `all` too: handling it on a separate path let "all:" fall
    // through to the regex mid-word, emptying the list exactly when the
    // operator was halfway to typing "all:true".
    if (value === '') {
      delete filter[key];
      continue;
    }

    if (key === 'all') {
      filter.all = value === 'true' || value === 'yes' || value === '1';
      continue;
    }

    filter[key] = key === 'assignee' && value === 'me' ? (me ?? 'me') : value;
  }

  return { filter, pattern: words.length === 0 ? null : words.join(' ') };
}
