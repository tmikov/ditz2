/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  detailLines, issueLines, rowFor, truncate, windowOf, wrapLine,
} from '../src/format.js';
import { issue } from './fixtures.js';

describe('rowFor', () => {
  const one = issue({
    id: '01a00000-0001-7000-8000-000000000001',
    title: 'sqlite cache for list and grep',
    type: 'feature',
    component: 'store',
  });

  it('lays out id, type, component and title', () => {
    const row = rowFor(one, false, 80);
    expect(row).toContain('01a00000-0001');
    expect(row).toContain('feature');
    expect(row).toContain('store');
    expect(row).toContain('sqlite cache for list and grep');
  });

  it('marks the selected row and only the selected row', () => {
    expect(rowFor(one, true, 80).startsWith('>')).toBe(true);
    expect(rowFor(one, false, 80).startsWith('>')).toBe(false);
  });

  it('keeps the columns aligned when a component name overruns its width', () => {
    // Component names are arbitrary: `dz component add documentation` is legal.
    const long = issue({ ...one, component: 'documentation' });
    const short = issue({ ...one, component: 'cli' });
    expect(rowFor(long, false, 200).indexOf(one.title))
      .toBe(rowFor(short, false, 200).indexOf(one.title));
  });

  it('keeps titles aligned regardless of type length', () => {
    const short = rowFor(issue({ ...one, type: 'bug' }), false, 80);
    const long = rowFor(issue({ ...one, type: 'feature' }), false, 80);
    expect(short.indexOf('sqlite')).toBe(long.indexOf('sqlite'));
  });

  it('shows a dash in the component column for an issue with no component', () => {
    // `toContain('-')` is vacuous here: shortId is the first 13 characters of
    // a UUIDv7 — "01a00000-0001" — so the row already contains a hyphen no
    // matter what the component column holds. Locate the column and look at
    // the character actually in it.
    const at = rowFor(one, false, 80).indexOf('store');
    const row = rowFor(issue({ ...one, component: null }), false, 80);
    expect(at).toBeGreaterThan(0);
    expect(row[at]).toBe('-');
    expect(row).not.toContain('store');
  });

  it('never exceeds the terminal width', () => {
    // A row that wraps pushes every row below it down and the frame stops
    // matching the list, so this is a layout invariant and not cosmetic.
    const wide = issue({ ...one, title: 'x'.repeat(500) });
    expect(rowFor(wide, true, 60).length).toBeLessThanOrEqual(60);
  });
});

describe('truncate', () => {
  it('leaves short values alone', () => {
    expect(truncate('abc', 10)).toBe('abc');
  });

  it('marks that it cut something', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate('abcdefghij', 5)).toHaveLength(5);
  });
});

describe('wrapLine', () => {
  it('leaves a short line alone', () => {
    expect(wrapLine('short', 20)).toEqual(['short']);
  });

  it('breaks at spaces, never mid-word', () => {
    expect(wrapLine('alpha beta gamma delta', 12)).toEqual(['alpha beta', 'gamma delta']);
  });

  it('conserves every non-whitespace character, even when it must hard-break', () => {
    // The guarantee that holds at ANY width, including widths too narrow to
    // keep a token whole. Token-level conservation does not hold there, and
    // claiming it did was the second wrong version of this contract.
    const text = '10. findIssue no longer parses every file,  but list and grep must.';
    const bare = text.replace(/\s+/g, '');
    for (const w of [1, 2, 3, 5, 12, 40]) {
      expect(wrapLine(text, w).join('').replace(/\s+/g, '')).toBe(bare);
    }
  });

  it('conserves every token, in order, at every width wide enough to keep one', () => {
    // The property that matters, and stated as a property rather than as one
    // round-trip: an earlier version passed a single-spaced round-trip while
    // dropping leading indents and collapsing doubled spaces.
    const text = '  findIssue no longer parses every file,  but list and grep still '
      + 'must, because a filter has to look at each one before it can decide.';
    const want = text.trim().split(/\s+/);
    // 12, not 8: 'findIssue' is 9 characters, and the leading 2-space indent
    // is carried onto every line, so a width under 11 forces a hard break of
    // that word — which the character-conservation test above covers instead,
    // deliberately at widths where a token is not guaranteed to survive whole.
    for (const w of [12, 13, 20, 31, 60, 200]) {
      const out = wrapLine(text, w);
      expect(out.join(' ').trim().split(/\s+/)).toEqual(want);
      // `Math.max(w, text.length)` would resolve to text.length at every width
      // tested here and constrain nothing. The real guarantee is the width.
      expect(out.every((l) => l.length <= w)).toBe(true);
    }
  });

  it('terminates on a list marker wider than the width', () => {
    // Regression: the hanging indent was re-added faster than characters were
    // consumed, so this grew without bound. A synchronous spin here freezes
    // the UI and Ink cannot service Ctrl-C while it runs.
    const out = wrapLine(`10. ${'x'.repeat(30)}`, 2);
    expect(out.length).toBeLessThan(40);
    expect(out.every((l) => l.length <= 2)).toBe(true);
    expect(out.join('')).toContain('x'.repeat(30));
  }, 2000);

  it('keeps the leading indent of the line it wrapped', () => {
    expect(wrapLine('  hello world foo bar baz', 10)[0]).toBe('  hello');
  });

  it('handles a plain indent at a width that forces a hard break', () => {
    // The bullet path covers indent + hard break; this covers the plain
    // leading-whitespace path, which shares the mechanism but had no test at
    // a width narrow enough to exercise it.
    const out = wrapLine(`    ${'y'.repeat(20)}`, 6);
    expect(out.every((l) => l.length <= 6)).toBe(true);
    expect(out.join('').replace(/\s+/g, '')).toBe('y'.repeat(20));
  });

  it('handles an indent exactly as wide as the width', () => {
    // The boundary the guard turns on: raw.length < width keeps the indent,
    // raw.length === width drops it. Neither may lose a character or hang.
    const out = wrapLine(`10. ${'z'.repeat(12)}`, 4);
    expect(out.every((l) => l.length <= 4)).toBe(true);
    expect(out.join('').replace(/\s+/g, '')).toBe(`10.${'z'.repeat(12)}`);
  });

  it('leaves a whitespace-only line alone', () => {
    // It is a paragraph separator; collapsing it closes the gap it exists for.
    expect(wrapLine('   ', 2)).toEqual(['   ']);
  });

  it('hard-breaks a word longer than the width', () => {
    // A URL or a path has no space to break at, and dropping its tail is the
    // bug this task exists to fix.
    const long = 'x'.repeat(25);
    const out = wrapLine(long, 10);
    expect(out.every((l) => l.length <= 10)).toBe(true);
    expect(out.join('')).toBe(long);
  });

  it('keeps a blank line blank', () => {
    expect(wrapLine('', 10)).toEqual(['']);
  });

  it('indents continuations of a bullet under its text', () => {
    // Flush-left continuations make a wrapped list unreadable — the second
    // line of one bullet looks like a new one.
    expect(wrapLine('- alpha beta gamma', 12)).toEqual(['- alpha beta', '  gamma']);
  });

  it('survives a zero or negative width', () => {
    expect(() => wrapLine('anything', 0)).not.toThrow();
  });

  it('reflows a long paragraph instead of cutting it off', () => {
    const para = 'word '.repeat(60).trim();
    const out = issueLines(issue({
      id: '01a00000-0003-7000-8000-000000000003',
      title: 'a wrapped issue',
      body: para,
    }), 40);
    expect(out.every((l) => l.length <= 40)).toBe(true);
    expect(out.some((l) => l.includes('…'))).toBe(false);
    // Every word survives, in order.
    const body = out.slice(3).join(' ').trim();
    expect(body.split(/\s+/).filter((w) => w === 'word')).toHaveLength(60);
  });
});

describe('issueLines', () => {
  const clipped = issue({
    id: '01a00000-0002-7000-8000-000000000002',
    title: 'a long issue',
    type: 'bug',
    component: 'cli',
    body: Array.from({ length: 200 }, (_, n) => `line ${n}`).join('\n'),
    // Six lines of flattened log, more than LOG_ROOM (4): detailLines keeps
    // only the newest entries that fit, which drops 'created' below. A test
    // that used a log this short would pass even if issueLines applied the
    // same budget by mistake.
    log: [
      { timestamp: '2026-08-24 17:12', author: 'tmikov', verb: 'created', detail: null, text: null },
      { timestamp: '2026-08-24 18:00', author: 'tmikov', verb: 'started', detail: null, text: null },
      {
        timestamp: '2026-08-25 08:00', author: 'jane', verb: 'commented',
        detail: 'looked into it', text: null,
      },
      {
        timestamp: '2026-08-25 08:30', author: 'jane', verb: 'commented',
        detail: 'still investigating', text: null,
      },
      { timestamp: '2026-08-25 09:01', author: 'jane', verb: 'commented', detail: null, text: 'agreed' },
    ],
  });

  it('shows every body line detailLines had to clip away', () => {
    // The direct expression of the bug this task fixes: detailLines(20) drops
    // most of a 200-line body behind "… N more lines".
    expect(detailLines(clipped, 20, 80).join('\n')).not.toContain('line 199');
    const text = issueLines(clipped, 80).join('\n');
    for (let n = 0; n < 200; n += 1) expect(text).toContain(`line ${n}`);
  });

  it('shows every log entry, not just the newest LOG_ROOM lines', () => {
    const text = issueLines(clipped, 80).join('\n');
    expect(text).toContain('created');
    expect(text).toContain('agreed');
  });

  it('agrees with detailLines on the head', () => {
    const wide = issueLines(clipped, 80).slice(0, 2);
    const narrow = detailLines(clipped, 30, 80).slice(0, 2);
    expect(wide).toEqual(narrow);
  });
});

describe('windowOf', () => {
  it('shows everything when it fits', () => {
    expect(windowOf(3, 0, 10)).toEqual({ from: 0, to: 3 });
  });

  it('scrolls to keep the selection visible at the bottom', () => {
    expect(windowOf(100, 12, 10)).toEqual({ from: 3, to: 13 });
  });

  it('scrolls to keep the selection visible at the top', () => {
    expect(windowOf(100, 0, 10)).toEqual({ from: 0, to: 10 });
  });

  it('does not scroll past the end', () => {
    expect(windowOf(100, 99, 10)).toEqual({ from: 90, to: 100 });
  });

  it('survives an empty list', () => {
    expect(windowOf(0, -1, 10)).toEqual({ from: 0, to: 0 });
  });
});
