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
import { initialState, reducer } from '../src/state.js';
import type { Project } from 'ditz2';
import { KEY, lines, press, settle } from './helpers.js';
import { issue, three } from './fixtures.js';

/** A Project that fails loudly if the UI calls anything it should not. */
function stubProject(over: Partial<Project> = {}): Project {
  const reject = (): never => { throw new Error('unexpected project call'); };
  return {
    root: '/tmp/demo',
    name: 'demo',
    whoami: () => 'Jane Roe <jane@example.com>',
    list: () => ({ issues: three(), failures: [] }),
    show: reject, grep: reject, add: reject, set: reject,
    comment: reject, close: reject, doctor: reject,
    readForEdit: reject, parseEdit: reject, saveEdited: reject,
    components: { list: reject, add: reject, remove: reject },
    lock: { state: reject, break: reject },
    ...over,
  } as Project;
}

function mount(over: Partial<Project> = {}, onExit = vi.fn()) {
  const r = render(
    <App
      project={stubProject(over)}
      initial={initialState(three(), [])}
      rows={10}
      width={80}
      onExit={onExit}
    />,
  );
  return { ...r, onExit };
}

/** The row the cursor is on, or undefined. */
function marked(frame: string | undefined): string | undefined {
  return lines(frame).find((l) => l.startsWith('>'));
}

describe('navigation', () => {
  it('starts on the first issue', async () => {
    const { lastFrame } = mount();
    await settle();
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('moves with the arrow keys', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.down);
    expect(marked(lastFrame())).toContain('beta');
    await press(stdin, KEY.up);
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('moves with j and k as well', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'j', 'j');
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, 'k');
    expect(marked(lastFrame())).toContain('beta');
  });

  it('jumps to the ends with G and g', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'G');
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, 'g');
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('jumps to the ends with End and Home', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.end);
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, KEY.home);
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('pages with PgDn and Ctrl-D', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.pageDown);
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, KEY.pageUp);
    expect(marked(lastFrame())).toContain('alpha');
    await press(stdin, KEY.ctrlD);
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, KEY.ctrlU);
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('pages by exactly one screen, not to the end', async () => {
    // The three-issue fixture cannot show this. With rows=20 any delta of 2 or
    // more clamps to the last row, so a page of 10, a page of 999 and a jump
    // to the end are indistinguishable. Paging needs a list longer than a page
    // before the magnitude means anything.
    //
    // rows=21 rather than 10: the page is the list's own share of the screen
    // (listRows), not the whole screen budget, so the fixture has to make that
    // share land on a round number. floor((21 - CHROME_ROWS) * 0.6) = 10,
    // which is what the assertions below pin — issue 10, then issue 20, back
    // to issue 10.
    const many = Array.from({ length: 30 }, (_, n) => issue({
      id: `01a00000-${String(n).padStart(4, '0')}-7000-8000-000000000000`,
      title: `issue ${n}`,
    }));
    const { lastFrame, stdin } = render(
      <App project={stubProject()} initial={initialState(many, [])}
        rows={21} width={80} onExit={vi.fn()} />,
    );
    await settle();
    expect(marked(lastFrame())).toContain('issue 0');
    await press(stdin, KEY.pageDown);
    expect(marked(lastFrame())).toContain('issue 10');
    await press(stdin, KEY.pageDown);
    expect(marked(lastFrame())).toContain('issue 20');
    await press(stdin, KEY.pageUp);
    expect(marked(lastFrame())).toContain('issue 10');
  });

  it('stops at the ends instead of wrapping', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.up, KEY.up);
    expect(marked(lastFrame())).toContain('alpha');
    await press(stdin, 'G', KEY.down, KEY.down);
    expect(marked(lastFrame())).toContain('gamma');
  });
});

describe('chrome', () => {
  it('names the project and counts what is shown', async () => {
    const { lastFrame } = mount();
    await settle();
    expect(lastFrame()).toContain('demo');
    expect(lastFrame()).toContain('3 of 3');
  });

  it('never draws a frame taller than the row budget it was given', async () => {
    // The one check that was missing: every other test asserts on frame
    // *content*. <Detail>'s top border is a chrome row no component returns,
    // so it went unbudgeted and the frame reached exactly the terminal height
    // whenever the status line was showing — at which point Ink clears the
    // whole screen on every render and the UI flickers per keystroke.
    const many = Array.from({ length: 30 }, (_, n) => issue({
      id: `01a00000-${String(n).padStart(4, '0')}-7000-8000-000000000000`,
      title: `issue ${n}`,
    }));
    for (const rows of [12, 20, 23]) {
      for (const notice of [null, 'something happened']) {
        const state = notice === null
          ? initialState(many, [])
          : reducer(initialState(many, []), { type: 'notice', text: notice });
        const { lastFrame } = render(
          <App project={stubProject()} initial={state}
            rows={rows} width={80} onExit={vi.fn()} />,
        );
        await settle();
        expect((lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(rows);
      }
    }
  });

  it('advertises only bindings that work', async () => {
    const { lastFrame } = mount();
    await settle();
    const footer = lines(lastFrame()).at(-1) ?? '';
    expect(footer).toContain('q quit');
    // Plan 2b adds these. A footer that lists a key doing nothing is worse
    // than a footer that is short.
    expect(footer).not.toContain('enter edit');
    expect(footer).not.toContain('c comment');
    expect(footer).not.toContain('x close');
  });

  it('warns about unreadable files rather than showing a short list quietly', async () => {
    const failures = [{ file: 'dz/issues/broken.md', error: new Error('bad') as never }];
    const { lastFrame } = render(
      <App project={stubProject()} initial={initialState(three(), failures)}
        rows={10} width={80} onExit={vi.fn()} />,
    );
    await settle();
    expect(lastFrame()).toContain('1 unreadable');
  });
});

describe('quitting', () => {
  it('calls onExit for q', async () => {
    const { stdin, onExit } = mount();
    await press(stdin, 'q');
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
