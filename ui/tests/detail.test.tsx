/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Detail } from '../src/components/Detail.js';
import { detailLines } from '../src/format.js';
import { lines, settle } from './helpers.js';
import { issue } from './fixtures.js';

const full = issue({
  id: '01a00000-0001-7000-8000-000000000001',
  title: 'interactive conflict prompt for dz edit',
  type: 'feature',
  status: 'open',
  component: 'cli',
  body: 'Steps 8-10 of the lock design describe what dz edit should do\nwhen the issue changed underneath the editor.',
  log: [
    { timestamp: '2026-08-24 17:12', author: 'tmikov', verb: 'created', detail: null, text: null },
    { timestamp: '2026-08-25 09:01', author: 'jane', verb: 'commented', detail: null, text: 'agreed' },
  ],
});

describe('detailLines', () => {
  it('leads with the title', () => {
    expect(detailLines(full, 20, 80)[0]).toContain('interactive conflict prompt');
  });

  it('puts status, component and assignee on one line', () => {
    const summary = detailLines(full, 20, 80)[1] ?? '';
    expect(summary).toContain('open');
    expect(summary).toContain('cli');
    expect(summary).toContain('unassigned');
  });

  it('shows the resolution of a closed issue', () => {
    const closed = issue({ ...full, status: 'closed', resolution: 'wontfix' });
    expect(detailLines(closed, 20, 80)[1]).toContain('wontfix');
  });

  it('shows the body', () => {
    expect(detailLines(full, 20, 80).join('\n')).toContain('Steps 8-10');
  });

  it('shows log entries, comment text included', () => {
    const text = detailLines(full, 20, 80).join('\n');
    expect(text).toContain('created');
    expect(text).toContain('agreed');
  });

  it('never exceeds a pane too short to hold its own header', () => {
    // The header is three lines, but App gives the detail pane
    // `rows - 3 - listRows`, which is 2 on a six-row terminal and 1 on a
    // five-row one. Without the final clip the pane renders taller than it was
    // given and pushes the footer off the screen. The other height test uses
    // rows=6, where head + log + clipped body happens to land exactly on the
    // budget, so it never exercises this.
    const short = issue({ ...full, body: 'one\ntwo\nthree' });
    for (const rows of [1, 2, 3, 4, 5, 6]) {
      expect(detailLines(short, rows, 80)).toHaveLength(rows);
    }
  });

  it('never returns more lines than it was given room for', () => {
    // Overflowing pushes the footer off the screen, so this is what keeps the
    // frame the size it claims to be.
    const long = issue({ ...full, body: Array.from({ length: 200 }, (_, n) => `line ${n}`).join('\n') });
    expect(detailLines(long, 6, 80)).toHaveLength(6);
  });

  it('counts wrapped lines toward the row budget, not source lines', () => {
    // A single source line long enough to need several wrapped lines. If
    // wrapping happened after the row budget was applied instead of before,
    // this would still count as one line while the budget was computed and
    // then explode into several once wrapped, overflowing the pane.
    const wrapped = issue({ ...full, body: 'x'.repeat(60) });
    expect(detailLines(wrapped, 10, 20)).toHaveLength(10);
  });

  it('never returns a line wider than it was given room for', () => {
    const wide = issue({ ...full, body: 'x'.repeat(500) });
    for (const line of detailLines(wide, 10, 40)) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  it('says the body is longer than what is shown', () => {
    const long = issue({ ...full, body: Array.from({ length: 200 }, (_, n) => `line ${n}`).join('\n') });
    expect(detailLines(long, 6, 80).join('\n')).toMatch(/more/);
  });

  it('still shows the newest log entry under a body long enough to bury it', () => {
    const long = issue({ ...full, body: Array.from({ length: 200 }, (_, n) => `line ${n}`).join('\n') });
    expect(detailLines(long, 8, 80).join('\n')).toContain('agreed');
  });

  it('pads a nearly empty issue out to its full height', () => {
    expect(detailLines(issue({ id: 'x', title: 't' }), 8, 80)).toHaveLength(8);
  });

  it('never shows comment text without the entry header it belongs to', () => {
    // Five lines of comment into four lines of room. Slicing the flattened log
    // would show "…four / five" with no timestamp, author or verb above it.
    const chatty = issue({
      ...full,
      log: [
        { timestamp: '2026-08-24 17:12', author: 'tmikov', verb: 'created', detail: null, text: null },
        {
          timestamp: '2026-08-25 09:01', author: 'jane', verb: 'commented',
          detail: null, text: 'one\ntwo\nthree\nfour\nfive',
        },
      ],
    });
    const text = detailLines(chatty, 8, 80).join('\n');
    expect(text).toContain('commented');
    expect(text).not.toContain('five');
  });

  it('wraps the title instead of truncating it', () => {
    // The first version of this fix wrapped the body and left the head to be
    // chopped by the trailing truncate, so the pane still showed
    // "A title that is quite long and will certainly not fit insid…".
    const wide = issue({
      ...full,
      title: 'A title that is quite long and will certainly not fit inside a narrow pane at all',
    });
    const text = detailLines(wide, 14, 60).join('\n');
    expect(text).not.toContain('…');
    expect(text).toContain('a narrow pane at all');
  });

  it('wraps a long comment instead of truncating it', () => {
    const chatty = issue({
      ...full,
      log: [
        {
          timestamp: '2026-08-25 09:01', author: 'jane', verb: 'commented', detail: null,
          text: 'This comment is a single long paragraph of prose that goes well past any '
            + 'reasonable terminal width and therefore needs to be reflowed rather than cut.',
        },
      ],
    });
    const text = detailLines(chatty, 14, 60).join('\n');
    expect(text).not.toContain('…');
    expect(text).toContain('therefore needs to be reflowed rather than cut.');
  });

  it('budgets the log by display lines, not source lines', () => {
    // Two entries: budgeted by SOURCE lines, 'created' (1 line) plus
    // 'commented' (also 1 raw source line, however long the comment) both fit
    // easily, so both are admitted whole and the comment is shown as one
    // truncated fragment. Budgeted by DISPLAY lines, the comment alone
    // reflows past LOG_ROOM on its own, so the newest entry is admitted and
    // the older 'created' entry is not — proving the admission decision, not
    // just how much of an over-budget entry's fallback later shows, uses the
    // wrapped size. (Not sensitive to the round-5 fallback's exact line
    // count: verified this still distinguishes the two even reverted to
    // showing only the fallback's first line.)
    const chatty = issue({
      ...full,
      body: '',
      log: [
        { timestamp: '2026-08-24 17:12', author: 'tmikov', verb: 'created', detail: null, text: null },
        {
          timestamp: '2026-08-25 09:01', author: 'jane', verb: 'commented', detail: null,
          text: 'word '.repeat(20).trim(),
        },
      ],
    });
    const text = detailLines(chatty, 10, 50).join('\n');
    expect(text).toContain('commented');
    expect(text).not.toContain('created');
  });

  it('shows the author of an entry too big to fit, not just its date', () => {
    // Real timestamps are ISO 8601 (`log.ts` writes them, `validate.ts`
    // enforces it) and are 24 characters on their own — wide enough that at a
    // narrow pane the header's own first wrapped line is the date alone, with
    // the author pushed to the line after it. Keeping only the fallback's
    // first line would show a date with no indication of who did anything;
    // taking up to `logRoom` lines is what still shows the author.
    const chatty = issue({
      ...full,
      log: [
        {
          timestamp: '2026-08-24T17:12:00.000Z', author: 'tmikov', verb: 'commented', detail: null,
          text: 'word '.repeat(30).trim(),
        },
      ],
    });
    const text = detailLines(chatty, 10, 30).join('\n');
    expect(text).toContain('tmikov');
  });
});

describe('<Detail>', () => {
  it('draws the selected issue', async () => {
    const { lastFrame } = render(<Detail issue={full} rows={10} width={80} />);
    await settle();
    expect(lastFrame()).toContain('interactive conflict prompt');
  });

  it('says nothing is selected rather than drawing an empty box', async () => {
    const { lastFrame } = render(<Detail issue={null} rows={10} width={80} />);
    await settle();
    expect(lines(lastFrame()).join('')).toContain('nothing selected');
  });

  it('draws the nothing-selected pane as exactly rows lines, not one over', async () => {
    // The null branch builds its own array rather than going through
    // detailLines, so its clip is a separate line from that function's. rows=0
    // is the case that catches it: unclipped, the branch still emits its
    // 'nothing selected' line regardless of rows.
    const { lastFrame } = render(<Detail issue={null} rows={0} width={80} />);
    await settle();
    // One line for the pane's top border, none for the body.
    expect(lines(lastFrame())).toHaveLength(1);
  });
});
