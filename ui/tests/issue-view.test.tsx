/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { App } from '../src/app.js';
import { initialState } from '../src/state.js';
import type { Project } from 'ditz2';
import { IssueView, maxIssueOffset } from '../src/components/IssueView.js';
import { issueLines } from '../src/format.js';
import { footerOf, KEY, lines, press, settle } from './helpers.js';
import { issue } from './fixtures.js';

const short = issue({
  id: '01a00000-0001-7000-8000-000000000001',
  title: 'a short issue',
  type: 'task',
});

const full = issue({
  id: '01a00000-0002-7000-8000-000000000002',
  title: 'a long issue only the full view can show',
  type: 'bug',
  component: 'cli',
  body: Array.from({ length: 50 }, (_, n) => `body line ${n}`).join('\n'),
  log: [
    { timestamp: '2026-08-24 17:12', author: 'tmikov', verb: 'created', detail: null, text: null },
    {
      timestamp: '2026-08-25 09:01', author: 'jane', verb: 'commented',
      detail: null, text: 'the very last log line',
    },
  ],
});

describe('<IssueView>', () => {
  it('shows body text a short pane would clip', async () => {
    const { lastFrame } = render(
      <IssueView issue={full} offset={0} rows={6} width={80} />,
    );
    await settle();
    expect(lastFrame()).toContain('body line 0');
  });

  it('scrolls to reveal later lines', async () => {
    const { lastFrame } = render(
      <IssueView issue={full} offset={20} rows={6} width={80} />,
    );
    await settle();
    expect(lastFrame()).toContain('body line 20');
  });

  it('says how much is above once scrolled past the top', async () => {
    const { lastFrame } = render(
      <IssueView issue={full} offset={5} rows={6} width={80} />,
    );
    await settle();
    expect(lastFrame()).toContain('more');
  });

  it('reaches the last log line at the very end', async () => {
    const total = issueLines(full, 80).length;
    const { lastFrame } = render(
      <IssueView issue={full} offset={maxIssueOffset(total, 6)} rows={6} width={80} />,
    );
    await settle();
    expect(lastFrame()).toContain('the very last log line');
  });

  it('shows every word of a long paragraph, not just its first line', async () => {
    const para = Array.from({ length: 40 }, (_, n) => `w${n}`).join(' ');
    const wide = issue({
      id: '01a00000-0003-7000-8000-000000000003',
      title: 'a wrapped issue',
      body: para,
    });
    const total = issueLines(wide, 40).length;
    const { lastFrame } = render(
      <IssueView issue={wide} offset={0} rows={total} width={40} />,
    );
    await settle();
    const shown = lines(lastFrame()).join(' ');
    for (const w of para.split(' ')) expect(shown).toContain(w);
  });
});

describe('maxIssueOffset', () => {
  it('is zero when everything fits', () => {
    expect(maxIssueOffset(5, 10)).toBe(0);
  });

  it('leaves the last row for the scroll indicator otherwise', () => {
    expect(maxIssueOffset(100, 10)).toBe(91);
  });
});

function stubProject(): Project {
  const reject = (): never => { throw new Error('unexpected project call'); };
  return {
    root: '/tmp/demo', name: 'demo',
    whoami: () => 'Jane Roe <jane@example.com>',
    list: () => ({ issues: [short, full], failures: [] }),
    show: reject, grep: reject, add: reject, set: reject, comment: reject,
    close: reject, doctor: reject, repair: reject, readForEdit: reject,
    parseEdit: reject,
    saveEdited: reject,
    components: { list: reject, add: reject, remove: reject },
    lock: { state: reject, break: reject },
  } as Project;
}

function mount(rows = 12) {
  return render(
    <App project={stubProject()} initial={initialState([short, full], [])}
      rows={rows} width={80} onExit={vi.fn()} />,
  );
}

describe('reading an issue from the list', () => {
  it('opens on enter and shows what the detail pane clipped', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.down);
    expect(lastFrame()).not.toContain('body line 0');
    await press(stdin, KEY.enter);
    expect(lastFrame()).toContain('body line 0');
    expect(lastFrame()).toContain('a long issue only the full view can show');
  });

  it('scrolls with j', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.down, KEY.enter);
    const before = lastFrame();
    await press(stdin, 'j');
    expect(lastFrame()).not.toBe(before);
  });

  it('scrolls with the down arrow, not the list selection behind it', async () => {
    // `full` is the last visible issue, so if the down arrow fell through to
    // the shared move handler instead of scrollIssue, 'move' would be a
    // no-op (already at the end) and the frame would not change at all.
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.down, KEY.enter);
    expect(lastFrame()).not.toContain('body line 5');
    await press(stdin, KEY.down, KEY.down, KEY.down, KEY.down, KEY.down);
    expect(lastFrame()).toContain('body line 5');
  });

  it('reaches the last log line with G', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.down, KEY.enter, 'G');
    expect(lastFrame()).toContain('the very last log line');
  });

  it('returns to the list on Esc, with the previous selection still marked', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.down, KEY.enter, KEY.escape);
    expect(lines(lastFrame()).find((l) => l.startsWith('>')))
      .toContain('a long issue only the full view can show');
  });

  it('returns to the list on a second enter, with the previous selection still marked', async () => {
    // enter opens the view and, per the footer, also closes it — a second
    // press must not be swallowed as a no-op or misread as reopening.
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.down, KEY.enter, KEY.enter);
    expect(lines(lastFrame()).find((l) => l.startsWith('>')))
      .toContain('a long issue only the full view can show');
  });

  it('returns to the list on q instead of quitting', async () => {
    const onExit = vi.fn();
    const { lastFrame, stdin } = render(
      <App project={stubProject()} initial={initialState([short, full], [])}
        rows={12} width={80} onExit={onExit} />,
    );
    await press(stdin, KEY.enter, 'q');
    expect(onExit).not.toHaveBeenCalled();
    expect(lines(lastFrame()).find((l) => l.startsWith('>'))).toContain('a short issue');
  });

  it('does nothing on enter when the list is empty', async () => {
    const { lastFrame, stdin } = render(
      <App project={stubProject()} initial={initialState([], [])}
        rows={12} width={80} onExit={vi.fn()} />,
    );
    await settle();
    const before = lastFrame();
    await press(stdin, KEY.enter);
    expect(lastFrame()).toBe(before);
  });
});

describe('the issue screen footer', () => {
  it('advertises enter as the way back, alongside esc and q', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.down, KEY.enter);
    const footer = footerOf(lastFrame());
    expect(footer).toContain('enter/esc back');
    expect(footer).toContain('q back');
  });

  it('does not advertise the list screen bindings that do nothing here', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.down, KEY.enter);
    const footer = footerOf(lastFrame());
    expect(footer).not.toContain('/ filter');
    expect(footer).not.toContain('r reload');
    expect(footer).not.toContain('q quit');
  });
});
