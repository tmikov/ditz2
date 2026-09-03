/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { FormOverlay, formRows } from '../src/components/FormOverlay.js';
import { EMPTY_VALUES, choicesFor, fieldsFor, valuesOf } from '../src/form.js';
import type { FormField, FormMode } from '../src/form.js';
import { lines } from './helpers.js';
import { issue } from './fixtures.js';

const ID = '01a00000-0001-7000-8000-000000000001';
const ALPHA = issue({
  id: ID, title: 'alpha', type: 'bug', component: 'cli',
  body: 'one\ntwo\nthree',
});
/**
 * Four, so the component picker is strictly the tallest thing on the form.
 *
 * Not decoration. With two configured components the picker has three options
 * — `(none)` plus two — which is exactly `ISSUE_TYPES.length`, and at that tie
 * `formRows` passes the height test below with its `Math.max` over every
 * picker replaced by a hardcoded `choices.type.length`. The one structural
 * claim `formRows` exists to make is that the floor grows with the *component*
 * count, and two components is precisely the number that hides it.
 */
const CONFIGURED = ['cli', 'store', 'render', 'api'];

function draw(over: {
  mode?: FormMode; issue?: ReturnType<typeof issue> | null;
  values?: ReturnType<typeof valuesOf>; focus?: FormField;
} = {}): string[] {
  const mode = over.mode ?? 'set';
  const subject = over.issue === undefined ? ALPHA : over.issue;
  const rest = {
    values: over.values ?? (subject === null ? EMPTY_VALUES : valuesOf(subject)),
    choices: choicesFor(subject, CONFIGURED),
    focus: over.focus ?? 'title',
    width: 80,
  };
  // `mode` and `issue` are one choice, not two props, so the helper has to
  // commit to a side rather than forward a pair. It throws on a mismatched
  // one instead of quietly rendering the other mode — a test that asked for
  // `set` and silently measured `add` would be measuring the wrong layout.
  if (mode === 'add') {
    if (subject !== null) throw new Error('add mode renders no issue');
    return lines(render(<FormOverlay mode="add" issue={null} {...rest} />).lastFrame());
  }
  if (subject === null) throw new Error('set mode needs an issue');
  return lines(render(<FormOverlay mode="set" issue={subject} {...rest} />).lastFrame());
}

describe('the form, rendered', () => {
  it('names the issue it will change', () => {
    const frame = draw().join('\n');
    expect(frame).toContain('alpha');
    // The short id, as every other heading in this UI prints it.
    expect(frame).toContain('01a00000');
  });

  it('says when it is a new issue instead', () => {
    // No paired `not.toContain('01a00000')`: this render is handed
    // `issue={null}`, so the id is not in scope and no implementation
    // reachable from these props could print it. It would be a check with no
    // failure mode.
    expect(draw({ mode: 'add', issue: null }).join('\n')).toContain('new issue');
  });

  it('draws every field it offers and no others', () => {
    const set = draw().join('\n');
    for (const label of ['Title', 'Type', 'Status', 'Component', 'Assignee']) {
      expect(set).toContain(label);
    }
    const add = draw({ mode: 'add', issue: null }).join('\n');
    expect(add).toContain('Title');
    expect(add).not.toContain('Status');
    expect(add).not.toContain('Assignee');
  });

  it('expands the focused picker and only that one', () => {
    const frame = draw({ focus: 'type' });
    const joined = frame.join('\n');
    expect(joined).toContain('(*) bug');
    expect(joined).toContain('( ) feature');
    // Status is a picker too and must still be one line showing its value.
    expect(frame.filter((l) => l.includes('(*)'))).toHaveLength(1);
    expect(frame.some((l) => l.includes('Status') && l.includes('open'))).toBe(true);
  });

  it('marks the field the next keystroke goes to', () => {
    const onTitle = draw({ focus: 'title' });
    expect(onTitle.find((l) => l.includes('Title'))?.startsWith('>')).toBe(true);
    // A typed field also shows the block cursor, because that is where the
    // characters will land — the same cursor <TextEntry> draws everywhere.
    expect(onTitle.find((l) => l.includes('Title'))).toContain('█');
    const onStatus = draw({ focus: 'status' });
    expect(onStatus.find((l) => l.includes('Status'))?.startsWith('>')).toBe(true);
    expect(onStatus.find((l) => l.includes('Title'))?.startsWith('>')).toBe(false);
  });

  it('keeps the cursor on screen when the title is wider than its column', () => {
    // Not an edge case: two of this repository's own 26 issues have titles of
    // 68 and 70 characters, and the value column is 67 wide at this width. The
    // head is what `truncate` keeps, so before <TextEntry> scrolled its cursor
    // line this drew the start of the title, an ellipsis, and no cursor at
    // all — and every further keystroke was invisible.
    const long = `head-${'x'.repeat(60)}-tail`;
    const values = { ...valuesOf(ALPHA), title: long };
    const row = draw({ values, focus: 'title' }).find((l) => l.includes('Title')) ?? '';
    expect(row).toContain('-tail█');
    expect(row).not.toContain('head-');
    // The row still has to fit: scrolling that overflowed the frame would
    // trade an invisible cursor for a wrapped line, which is worse.
    expect(row.length).toBeLessThanOrEqual(80);
  });

  it('shows an empty assignee as unassigned when it is not being typed into', () => {
    const values = { ...valuesOf(ALPHA), assignee: '' };
    expect(draw({ values }).join('\n')).toContain('unassigned');
    // …and as an empty field with a cursor when it is, so the word is not
    // something the operator has to delete before typing a name.
    const focused = draw({ values, focus: 'assignee' }).join('\n');
    expect(focused).not.toContain('unassigned');
  });

  it('reports the body without offering to edit it', () => {
    // Plan 2d opens $EDITOR. Until then the count is there so the operator
    // can see that a save will not touch it, and no key is advertised.
    const frame = draw().join('\n');
    expect(frame).toContain('Body');
    expect(frame).toContain('3 lines');
    expect(frame).not.toContain('enter');
  });

  it('can show a component the config no longer lists', () => {
    const orphan = issue({ id: ID, title: 'alpha', component: 'legacy' });
    expect(draw({ issue: orphan, focus: 'component' }).join('\n')).toContain('legacy');
  });

  it('is exactly as tall as formRows says, at its tallest, and never taller', () => {
    // Both directions on purpose. An upper bound alone would pass for a
    // floor set far too high, which would refuse the form on terminals it
    // fits in; the equality is what pins it to the layout. This is the test
    // that has to fail if either the layout or the arithmetic moves.
    for (const mode of ['set', 'add'] as FormMode[]) {
      const subject = mode === 'add' ? null : ALPHA;
      const choices = choicesFor(subject, CONFIGURED);
      const heights = fieldsFor(mode).map(
        (focus) => draw({ mode, issue: subject, focus }).length,
      );
      for (const height of heights) {
        expect(height, `${mode} at most`).toBeLessThanOrEqual(formRows(mode, choices));
      }
      expect(Math.max(...heights), `${mode} at least once`)
        .toBe(formRows(mode, choices));
    }
  });
});
