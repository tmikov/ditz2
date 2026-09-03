/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { DEFAULT_ISSUE_TYPE, DzError, ISSUE_TYPES, shortId } from 'ditz2';
import type { EditableFields, Issue, NewIssue, Project } from 'ditz2';
import { App, FORM_TOO_SHORT, NO_CHANGES } from '../src/app.js';
import { NO_COMPONENT } from '../src/form.js';
import { initialState } from '../src/state.js';
import { KEY, footerOf, lines, noticeOf, press, stubProject } from './helpers.js';
import { issue, three } from './fixtures.js';

/**
 * Twenty rows, not the fourteen `helpers.tsx` uses.
 *
 * App keeps five back before an overlay sees a budget — two chrome rows, the
 * two-line footer and <Detail>'s border — and the form needs twelve over the
 * two-component stub, so at fourteen every test here would be measuring a
 * refusal instead of a form. The refusal has its own test, at twelve.
 */
const ROWS = 20;

function mount(over: Partial<Project> = {}, issues: Issue[] = three(), rows = ROWS) {
  const onExit = vi.fn();
  const r = render(
    <App project={stubProject(over)} initial={initialState(issues, [])}
      rows={rows} width={80} onExit={onExit} />,
  );
  return { ...r, onExit };
}

/** A `set` that records, and returns something shaped like an issue. */
function recorder() {
  const calls: [string, EditableFields][] = [];
  const set = (prefix: string, fields: EditableFields): Issue => {
    calls.push([prefix, fields]);
    return three()[0]!;
  };
  return { calls, set };
}

const CREATED = issue({ id: '01a00000-0004-7000-8000-000000000004', title: 'shiny' });

/** An `add` that records, and a `list` that then reports what it made. */
function creator() {
  const calls: NewIssue[] = [];
  return {
    calls,
    add: (fields: NewIssue): Issue => { calls.push(fields); return CREATED; },
    list: () => ({ issues: [...three(), CREATED], failures: [] }),
  };
}

describe('the form', () => {
  it('opens on Tab over the selected issue', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.tab);
    expect(lines(lastFrame()).join('\n')).toContain('alpha');
    expect(footerOf(lastFrame())).toContain('up/down pick');
  });

  it('does not open on Enter, which still opens the reader', async () => {
    // The spec said Enter; the reader took it, and `?` and the footer both
    // say Tab. A regression here is the operator pressing Enter and getting
    // a form they cannot leave with Enter.
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.enter);
    const footer = footerOf(lastFrame());
    expect(footer).toContain('enter/esc back');
    expect(footer).not.toContain('up/down pick');
  });

  it('does nothing on Tab when the list is empty', async () => {
    const { lastFrame, stdin } = mount({}, []);
    await press(stdin, KEY.tab);
    expect(lastFrame()).not.toContain('up/down pick');
  });

  it('does not reopen on Shift-Tab after Esc, which is why the list ignores it', async () => {
    // The one assertion holding that comment on the list's Tab binding true.
    // Shift-Tab is the form's *back*, so a stray one — a hand still on the
    // key when Esc lands — must not bring back the form Esc just abandoned.
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.tab, KEY.escape, KEY.shiftTab);
    const footer = footerOf(lastFrame());
    expect(footer).not.toContain('up/down pick');
    expect(footer).toContain('tab edit');
  });

  it('moves focus with Tab and back with Shift-Tab', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.tab);
    expect(lines(lastFrame()).find((l) => l.includes('Title'))?.startsWith('>')).toBe(true);
    await press(stdin, KEY.tab);
    expect(lines(lastFrame()).find((l) => l.includes('Type'))?.startsWith('>')).toBe(true);
    await press(stdin, KEY.shiftTab);
    expect(lines(lastFrame()).find((l) => l.includes('Title'))?.startsWith('>')).toBe(true);
  });

  it('moves a picker with the arrows, not the list behind it', async () => {
    const { lastFrame, stdin } = mount();
    // alpha is a bug, which is ISSUE_TYPES[0].
    await press(stdin, KEY.tab, KEY.tab, KEY.down);
    expect(lastFrame()).toContain(`(*) ${ISSUE_TYPES[1]}`);
    await press(stdin, KEY.escape);
    expect(lines(lastFrame()).find((l) => l.startsWith('>'))).toContain('alpha');
  });

  it('ignores the arrows on a typed field, and does not let them reach the list', async () => {
    // Two halves, and they are held by different things. That the type does
    // not move is held by `pick` being exhaustive over the field union and
    // returning its input for a typed one — the type system, not this test.
    // That the *list* does not move is held by where the branch sits, and is
    // what this test can actually catch.
    const { calls, set } = recorder();
    const { lastFrame, stdin } = mount({ set });
    await press(stdin, KEY.tab, KEY.down, KEY.down, 'z', KEY.ctrlS);
    expect(calls[0]![1]).toEqual({ title: 'alphaz' });
    expect(lines(lastFrame()).find((l) => l.startsWith('>'))).toContain('alpha');
  });

  it('types into the title, and q is a letter there', async () => {
    const { calls, set } = recorder();
    const { onExit, stdin } = mount({ set });
    await press(stdin, KEY.tab, 'q', KEY.ctrlS);
    expect(onExit).not.toHaveBeenCalled();
    expect(calls[0]![1]).toEqual({ title: 'alphaq' });
  });

  it('sends only the fields that changed', async () => {
    const { calls, set } = recorder();
    const { stdin } = mount({ set });
    await press(stdin, KEY.tab, '!', KEY.ctrlS);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(three()[0]!.id);
    // Not `toMatchObject`: the point is the absence of the other four.
    // `set` writes a log entry for every field it is given, changed or not.
    expect(Object.keys(calls[0]![1])).toEqual(['title']);
  });

  it('does not write at all when nothing changed', async () => {
    const { calls, set } = recorder();
    const { lastFrame, stdin } = mount({ set });
    await press(stdin, KEY.tab, KEY.ctrlS);
    expect(calls).toHaveLength(0);
    expect(lastFrame()).toContain(NO_CHANGES);
    expect(lastFrame()).not.toContain('up/down pick');
  });

  it('clears the last thing it said when it reopens', async () => {
    // The family of the never-cleared refusal recorded in HANDOFF.md: a
    // status line describing the previous keystroke must not sit under the
    // form this one opened.
    const { calls, set } = recorder();
    const { lastFrame, stdin } = mount({ set });
    await press(stdin, KEY.tab, KEY.ctrlS);
    expect(lastFrame()).toContain(NO_CHANGES);
    await press(stdin, KEY.tab);
    expect(lastFrame()).not.toContain(NO_CHANGES);
    expect(calls).toHaveLength(0);
  });

  it('offers the components the project reports, and no component first', async () => {
    // A different list from the fixture's own on purpose: `docs` and `ui`
    // appear nowhere else, so a picker built from a literal cannot pass this.
    // gamma has no component, so nothing is added to the vocabulary for it.
    const { lastFrame, stdin } = mount({
      components: { list: () => ['docs', 'ui'], add: () => { throw new Error('no'); },
        remove: () => { throw new Error('no'); } },
    });
    await press(stdin, 'G', KEY.tab, KEY.tab, KEY.tab, KEY.tab);
    const frame = lines(lastFrame()).join('\n');
    expect(frame).toContain(`(*) ${NO_COMPONENT}`);
    expect(frame).toContain('( ) docs');
    expect(frame).toContain('( ) ui');
    expect(frame).not.toContain('( ) cli');
  });

  it('sends a chosen component, and null for none', async () => {
    const { calls, set } = recorder();
    const { stdin } = mount({ set });
    // alpha's component is cli, the second option after (none).
    await press(stdin, KEY.tab, KEY.tab, KEY.tab, KEY.tab, KEY.up, KEY.ctrlS);
    expect(calls[0]![1]).toEqual({ component: null });
  });

  it('sends null, not an empty string, for an emptied assignee', async () => {
    const { calls, set } = recorder();
    const assigned = [issue({
      id: '01a00000-0009-7000-8000-000000000009', title: 'assigned', assignee: 'jane',
    })];
    const { stdin } = mount({ set }, assigned);
    await press(stdin, KEY.tab, KEY.tab, KEY.tab, KEY.tab, KEY.tab,
      KEY.backspace, KEY.backspace, KEY.backspace, KEY.backspace);
    await press(stdin, KEY.ctrlS);
    expect(calls[0]![1]).toEqual({ assignee: null });
  });

  it('leaves an emptied title to the facade rather than keeping a copy of its rule', async () => {
    // The decision the reviewer asked for, made in favour of one owner.
    // `title cannot be empty` lives in `setField`; a second spelling of it
    // here would be `dz doctor`'s IGNORE_LINE defect at UI scale — two copies
    // of one rule, free to drift, with the nearer one certifying or refusing
    // on its own authority. `isUnchanged` is not the same case: an empty
    // patch is a no-op, not a refusal, so there is no facade message to
    // relay and nothing for the UI to duplicate.
    //
    // What it costs is one lock acquisition on a mistake nobody makes twice.
    // What it buys is the facade's own wording and, because a refused write
    // keeps the form, an edit the operator can correct rather than retype.
    const { calls, set } = recorder();
    const refusing = (prefix: string, fields: EditableFields): Issue => {
      set(prefix, fields);
      throw new DzError('INVALID_FIELD', 'title cannot be empty');
    };
    const { lastFrame, stdin } = mount({ set: refusing });
    await press(stdin, KEY.tab, KEY.backspace, KEY.backspace, KEY.backspace,
      KEY.backspace, KEY.backspace);
    await press(stdin, KEY.ctrlS);
    // Length first, so a UI that pre-empted the rule fails saying the write
    // never happened rather than indexing off the end of an empty array.
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toEqual({ title: '' });
    expect(lastFrame()).toContain('title cannot be empty');
  });

  it('abandons on Esc without writing', async () => {
    const { calls, set } = recorder();
    const { lastFrame, stdin } = mount({ set });
    await press(stdin, KEY.tab, 'z', KEY.escape);
    expect(calls).toHaveLength(0);
    expect(lastFrame()).not.toContain('up/down pick');
    // Discarded, not hidden: reopening shows the issue, not the edit.
    await press(stdin, KEY.tab);
    expect(lines(lastFrame()).find((l) => l.includes('Title'))).not.toContain('alphaz');
  });

  it('keeps the edits when the facade refuses, and says why', async () => {
    // The same rule as the comment draft: the worst moment to throw away
    // what somebody typed is the moment they are told it did not save.
    const { lastFrame, stdin } = mount({
      set: () => { throw new DzError('INVALID_FIELD', 'no author identity: set DZ_AUTHOR'); },
    });
    await press(stdin, KEY.tab, 'z', KEY.ctrlS);
    expect(lastFrame()).toContain('no author identity');
    await press(stdin, KEY.tab);
    expect(lines(lastFrame()).find((l) => l.includes('Title'))).toContain('alphaz');
  });

  it('reopens a refused form even after the component list grows', async () => {
    // The height that matters is the height of the form about to be DRAWN.
    // A kept form keeps the choices it opened with, so measuring a freshly
    // read `components.list()` against it can refuse a form that would have
    // fitted — and this is the reachable direction, not overflow: the refusal
    // never opens the form, so `esc` cannot reach it either and the operator's
    // retained edits become permanently unreachable.
    let components = ['cli', 'store'];
    const { lastFrame, stdin } = mount({
      set: () => { throw new DzError('INVALID_FIELD', 'no author identity'); },
      components: {
        list: () => [...components],
        add: () => { throw new Error('no'); },
        remove: () => { throw new Error('no'); },
      },
    });
    await press(stdin, KEY.tab, 'z', KEY.ctrlS);
    expect(lastFrame()).toContain('no author identity');
    // Eight components need 18 rows and this terminal has 15 to give, so a
    // form built from these would be refused — while the one being kept,
    // built from two, needs 12.
    components = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    await press(stdin, KEY.tab);
    expect(lastFrame()).not.toContain(FORM_TOO_SHORT);
    expect(lines(lastFrame()).find((l) => l.includes('Title'))).toContain('alphaz');
  });

  it('starts over on a different issue', async () => {
    // The error overlay leaves the list interactive, so the selection can
    // move before the form is reopened — and the edit must not follow it.
    const { lastFrame, stdin } = mount({
      set: () => { throw new DzError('INVALID_FIELD', 'no author identity'); },
    });
    await press(stdin, KEY.tab, 'z', KEY.ctrlS, 'j', KEY.tab);
    const title = lines(lastFrame()).find((l) => l.includes('Title')) ?? '';
    expect(title).toContain('beta');
    expect(title).not.toContain('alphaz');
  });

  it('closes and reloads on success', async () => {
    let listCalls = 0;
    const { stdin, lastFrame } = mount({
      set: () => three()[0]!,
      list: () => { listCalls += 1; return { issues: three(), failures: [] }; },
    });
    await press(stdin, KEY.tab, 'z', KEY.ctrlS);
    expect(listCalls).toBe(1);
    expect(lastFrame()).not.toContain('up/down pick');
  });

  it('refuses to open in a terminal it would overflow', async () => {
    const { lastFrame, stdin } = mount({}, three(), 12);
    await press(stdin, KEY.tab);
    expect(lastFrame()).toContain(FORM_TOO_SHORT);
    expect(lastFrame()).not.toContain('up/down pick');
  });

  it('advertises the keys the form answers, and only those', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.tab);
    const footer = footerOf(lastFrame());
    for (const key of ['tab/shift-tab field', 'up/down pick', '^S save', 'esc cancel']) {
      expect(footer).toContain(key);
    }
    expect(footer).not.toContain('q quit');
    expect(footer).not.toContain('/ filter');
  });
});

describe('a new issue', () => {
  it('opens an empty form on n', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'n');
    const frame = lines(lastFrame()).join('\n');
    expect(frame).toContain('new issue');
    // The three fields `add` can carry, and not the two it cannot.
    expect(frame).toContain('Title');
    expect(frame).toContain('Component');
    expect(frame).not.toContain('Status');
    expect(frame).not.toContain('Assignee');
  });

  it('opens on an empty backlog, which is when it is most wanted', async () => {
    const { lastFrame, stdin } = mount({}, []);
    await press(stdin, 'n');
    expect(lastFrame()).toContain('new issue');
  });

  it('starts on the type dz add would have chosen', async () => {
    // One default, imported. Two front-ends quietly disagreeing about what an
    // unspecified type means is the drift this constant exists to stop.
    const { lastFrame, stdin } = mount();
    await press(stdin, 'n', KEY.tab);
    expect(lastFrame()).toContain(`(*) ${DEFAULT_ISSUE_TYPE}`);
  });

  it('creates exactly what was typed', async () => {
    const c = creator();
    const { stdin } = mount({ add: c.add, list: c.list });
    await press(stdin, 'n', 's', 'h', 'i', 'n', 'y', KEY.ctrlS);
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toEqual({
      title: 'shiny', type: DEFAULT_ISSUE_TYPE, component: null,
    });
    // The key set as well as the values. `toEqual` ignores a key whose value
    // is undefined, so `{...fields, body: undefined}` — or a fourth field the
    // form has no row for — would satisfy the line above; `NewIssue` has two
    // optional members and this is what says only one of them is sent.
    expect(Object.keys(c.calls[0]!).sort()).toEqual(['component', 'title', 'type']);
  });

  it('puts the cursor on the issue it just created', async () => {
    const c = creator();
    const { lastFrame, stdin } = mount({ add: c.add, list: c.list });
    await press(stdin, 'n', 's', 'h', 'i', 'n', 'y', KEY.ctrlS);
    expect(lines(lastFrame()).find((l) => l.startsWith('>'))).toContain('shiny');
  });

  it('says so when the active filter hides what was just created', async () => {
    // Creating something you then cannot see is the one confusing outcome
    // here, and the existing reselect already reports a selection it lost.
    const c = creator();
    const { lastFrame, stdin } = mount({ add: c.add, list: c.list });
    await press(stdin, '/', 'a', 'l', 'p', 'h', 'a', KEY.enter);
    await press(stdin, 'n', 's', 'h', 'i', 'n', 'y', KEY.ctrlS);
    // The id rather than the sentence: what is pinned is that the operator is
    // told which issue, not the wording, which ruling 2 leaves revisitable.
    expect(noticeOf(lastFrame())).toContain(shortId(CREATED.id));
  });

  it('keeps a refused new issue for the next n', async () => {
    // `add` mode has no issue id, so the form is keyed by its mode alone —
    // there is one new-issue form, and reopening it is reopening the same one.
    // That is the same rule as a refused `set`: the worst moment to throw away
    // what somebody typed is the moment they are told it did not save.
    const { lastFrame, stdin } = mount({
      add: () => { throw new DzError('INVALID_FIELD', 'no author identity'); },
    });
    await press(stdin, 'n', 'd', 'r', 'a', 'f', 't', KEY.ctrlS);
    expect(lastFrame()).toContain('no author identity');
    await press(stdin, 'n');
    expect(lines(lastFrame()).find((l) => l.includes('Title'))).toContain('draft');
  });

  it('does not carry a new issue into an edit of an existing one', async () => {
    // The mode half of the same rule `draftFor`'s kind enforces for the
    // comment draft: a refused write keeps its text on purpose, and the very
    // next Tab must not write that text over the selected issue's title.
    const { lastFrame, stdin } = mount({
      add: () => { throw new DzError('INVALID_FIELD', 'no author identity'); },
    });
    await press(stdin, 'n', 'd', 'r', 'a', 'f', 't', KEY.ctrlS);
    expect(lastFrame()).toContain('no author identity');
    await press(stdin, KEY.tab);
    const title = lines(lastFrame()).find((l) => l.includes('Title')) ?? '';
    expect(title).toContain('alpha');
    expect(title).not.toContain('draft');
  });
});
