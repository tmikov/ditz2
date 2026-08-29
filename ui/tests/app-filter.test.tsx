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
import { initialState, SNAPSHOT_FILTER } from '../src/state.js';
import type { Filter, Project } from 'ditz2';
import { KEY, lines, press } from './helpers.js';
import { issue, three } from './fixtures.js';

function stub(list: Project['list']): Project {
  const reject = (): never => { throw new Error('unexpected project call'); };
  return {
    root: '/tmp/demo', name: 'demo',
    whoami: () => 'Jane Roe <jane@example.com>',
    list,
    show: reject, grep: reject, add: reject, set: reject, comment: reject,
    close: reject, doctor: reject, repair: reject, readForEdit: reject,
    parseEdit: reject,
    saveEdited: reject,
    components: { list: reject, add: reject, remove: reject },
    lock: { state: reject, break: reject },
  } as Project;
}

function mount(project = stub(() => ({ issues: three(), failures: [] })), rows = 14) {
  return render(
    <App project={project} initial={initialState(three(), [])}
      rows={rows} width={80} onExit={vi.fn()} />,
  );
}

const marked = (f: string | undefined): string | undefined =>
  lines(f).find((l) => l.startsWith('>'));
const rows = (f: string | undefined): string[] =>
  lines(f).filter((l) => /^[ >] 01a00000/.test(l));

describe('the / filter field', () => {
  it('narrows the list as it is typed', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', 'b', 'e', 't', 'a');
    expect(rows(lastFrame())).toHaveLength(1);
    expect(lastFrame()).toContain('beta');
  });

  it('shows what has been typed', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', 't', 'y', 'p', 'e', ':', 'b', 'u', 'g');
    expect(lastFrame()).toContain('type:bug');
    expect(rows(lastFrame())).toHaveLength(1);
  });

  it('keeps the arrow keys moving the selection while the field is open', async () => {
    // The whole reason arrows are the documented bindings: j and k are text
    // in here by definition.
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', KEY.down);
    expect(marked(lastFrame())).toContain('beta');
  });

  it('types j and k as text rather than moving', async () => {
    // Neither fixture title contains "j" or "k", so if the keys were captured
    // as query text (correct) the live regex filters the list to nothing. Had
    // they instead been consumed as move commands (the bug this guards
    // against), the query would stay empty, the list would stay unfiltered at
    // three rows, and the selection would have walked down to gamma.
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', 'j', 'k');
    expect(lastFrame()).toContain('jk');
    expect(rows(lastFrame())).toHaveLength(0);
  });

  it('jumps to the ends with Home and End while the field is open', async () => {
    // Home/End are keys, not text — the same reason arrows keep navigating
    // here rather than landing in the query.
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', KEY.end);
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, KEY.home);
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('deletes with backspace', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', 'b', 'e', 'z', KEY.backspace);
    expect(rows(lastFrame())).toHaveLength(1);
    expect(lastFrame()).toContain('beta');
  });

  it('leaves the field on enter, keeping the filter', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', 'b', 'e', 't', 'a', KEY.enter);
    expect(rows(lastFrame())).toHaveLength(1);
    // Back on the list: j moves again instead of typing.
    await press(stdin, 'j');
    expect(lastFrame()).not.toContain('betaj');
  });

  it('clears the filter on escape', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', 'b', 'e', 't', 'a', KEY.escape);
    expect(rows(lastFrame())).toHaveLength(3);
  });

  it('reports a rejected filter without emptying the list', async () => {
    // Not toContain('status') or toContain('filter:') — the field always echoes
    // the literal text typed, and the header shows "filter: <query>" for any
    // non-empty query regardless of validity. Only validateEnum's DzError
    // produces this exact phrase, so this is the one string that proves
    // validation actually ran and rejected the value.
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', 's', 't', 'a', 't', 'u', 's', ':', 'x');
    expect(lastFrame()).toContain('is not a valid status');
    expect(rows(lastFrame())).toHaveLength(3);
  });

  it('does not quit on q while the field is open', async () => {
    const onExit = vi.fn();
    const { stdin } = render(
      <App project={stub(() => ({ issues: three(), failures: [] }))}
        initial={initialState(three(), [])} rows={14} width={80} onExit={onExit} />,
    );
    await press(stdin, '/', 'q');
    expect(onExit).not.toHaveBeenCalled();
  });
});

describe('r refresh', () => {
  it('replaces the snapshot', async () => {
    const extra = issue({ id: '01a00000-0009-7000-8000-000000000009', title: 'delta' });
    // Always the longer list. App does not load on mount — its initial state is
    // injected — so pressing r is the FIRST call to list(), and a fixture that
    // returns three() on call 1 would test nothing.
    const project = stub(() => ({ issues: [...three(), extra], failures: [] }));
    const { lastFrame, stdin } = mount(project);
    await press(stdin, 'r');
    expect(rows(lastFrame())).toHaveLength(4);
    expect(lastFrame()).toContain('delta');
  });

  it('asks for everything, so that all:true can reveal closed issues', async () => {
    // A snapshot loaded with the default filter has no closed issues in it, so
    // no amount of in-memory filtering can show them.
    const seen: (Filter | undefined)[] = [];
    const project = stub((f) => { seen.push(f); return { issues: three(), failures: [] }; });
    const { stdin } = mount(project);
    await press(stdin, 'r');
    expect(seen).toEqual([SNAPSHOT_FILTER]);
    expect(SNAPSHOT_FILTER).toEqual({ all: true });
  });

  it('keeps the filter across a refresh', async () => {
    const project = stub(() => ({ issues: three(), failures: [] }));
    const { lastFrame, stdin } = mount(project);
    await press(stdin, '/', 'b', 'e', 't', 'a', KEY.enter, 'r');
    expect(rows(lastFrame())).toHaveLength(1);
  });

  it('reports a failed reload instead of crashing out of the UI', async () => {
    const project = stub(() => { throw new Error('disk on fire'); });
    const { lastFrame, stdin } = mount(project);
    await press(stdin, 'r');
    expect(lastFrame()).toContain('disk on fire');
    expect(rows(lastFrame())).toHaveLength(3);
  });

  it('stops reporting the failure once a later refresh works', async () => {
    // A status line that keeps showing the last error is a UI that lies about
    // the state of the disk for the rest of the session.
    let fail = true;
    const project = stub(() => {
      if (fail) throw new Error('disk on fire');
      return { issues: three(), failures: [] };
    });
    const { lastFrame, stdin } = mount(project);
    await press(stdin, 'r');
    expect(lastFrame()).toContain('disk on fire');
    fail = false;
    await press(stdin, 'r');
    expect(lastFrame()).not.toContain('disk on fire');
  });
});

describe('? help', () => {
  it('lists every binding, including the ones the footer has no room for', async () => {
    const { lastFrame, stdin } = mount(undefined, 30);
    await press(stdin, '?');
    const frame = lastFrame() ?? '';
    for (const binding of ['j', 'k', 'g', 'G', '/', 'r', 'q', 'assignee:me', 'all:true']) {
      expect(frame).toContain(binding);
    }
  });

  it('stays inside a short terminal instead of scrolling the chrome away', async () => {
    // The bindings are 14 lines. A 12-row terminal cannot show them, and an
    // overlay that overflows pushes the header and footer off the screen —
    // which loses the operator more than a scrollable help does.
    const { lastFrame, stdin } = mount(undefined, 12);
    await press(stdin, '?');
    const frame = lines(lastFrame());
    expect(frame.length).toBeLessThanOrEqual(12);
    expect(frame.join('\n')).toContain('more');
    expect(frame.at(-1)).toContain('q quit');
  });

  it('reaches the bindings it had no room for', async () => {
    // A "… 5 more" that nothing can reveal names a number and withholds the
    // answer. Scrolling is what makes the truncation acceptable.
    //
    // Nine downs, not seven: Task 12 added two lines to HELP (enter, and the
    // issue view's esc/q), which pushed maxHelpOffset at rows=12 from 7 to 9.
    const { lastFrame, stdin } = mount(undefined, 12);
    await press(stdin, '?');
    expect(lastFrame()).not.toContain('all:true');
    await press(
      stdin,
      KEY.down, KEY.down, KEY.down, KEY.down, KEY.down,
      KEY.down, KEY.down, KEY.down, KEY.down,
    );
    expect(lastFrame()).toContain('all:true');
  });

  it('scrolls with Ctrl-D and Ctrl-U as well as PgUp/PgDn', async () => {
    // The HELP table itself advertises "^U / ^D" alongside PgUp/PgDn as one
    // binding — a footer that lists a key doing nothing is a lie this plan
    // will not tolerate for the footer, and help owes the same promise.
    //
    // Two Ctrl-Ds, not one: a single page (8 rows at this terminal height) no
    // longer clears the two lines Task 12 added to HELP.
    const { lastFrame, stdin } = mount(undefined, 12);
    await press(stdin, '?');
    expect(lastFrame()).not.toContain('all:true');
    await press(stdin, KEY.ctrlD, KEY.ctrlD);
    expect(lastFrame()).toContain('all:true');
    await press(stdin, KEY.ctrlU);
    expect(lastFrame()).not.toContain('all:true');
  });

  it('jumps to the ends with Home and End', async () => {
    // The HELP table lists "Home / End, g / G — first / last" as a binding;
    // a help screen that ignores its own entry is the same defect as the
    // Ctrl-D/Ctrl-U gap above.
    const { lastFrame, stdin } = mount(undefined, 12);
    await press(stdin, '?');
    expect(lastFrame()).not.toContain('all:true');
    await press(stdin, KEY.end);
    expect(lastFrame()).toContain('all:true');
    await press(stdin, KEY.home);
    expect(lastFrame()).not.toContain('all:true');
  });

  it('does not move the issue selection while help is open', async () => {
    const { lastFrame, stdin } = mount(undefined, 12);
    await press(stdin, '?', KEY.down, KEY.down, '?');
    // Back on the list, still on the first issue: the arrows scrolled help.
    expect(lines(lastFrame()).find((l) => l.startsWith('>'))).toContain('alpha');
  });

  it('closes again', async () => {
    const { lastFrame, stdin } = mount(undefined, 30);
    await press(stdin, '?', '?');
    expect(lastFrame()).not.toContain('assignee:me');
  });
});
