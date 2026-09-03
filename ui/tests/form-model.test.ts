/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import type { Key } from 'ink';
import { ISSUE_TYPES, SETTABLE_STATUSES } from 'ditz2';
import {
  ADD_FIELDS, EMPTY_VALUES, SET_FIELDS, changedFields, choicesFor, componentLabel,
  fieldsFor, indexOf, isUnchanged, moveFocus, newIssueFrom, optionsFor, pick,
  textOf, typeInto, valuesOf,
} from '../src/form.js';
import { handleLineKey } from '../src/components/TextEntry.js';
import { issue } from './fixtures.js';

const ID = '01a00000-0001-7000-8000-000000000001';
const ALPHA = issue({ id: ID, title: 'alpha', type: 'bug', component: 'cli' });
const CONFIGURED = ['cli', 'store'];
const CHOICES = choicesFor(ALPHA, CONFIGURED);

describe('the form model', () => {
  it('can send every field it offers', () => {
    // Ties the field list to the patch `set` takes. A field the form draws
    // and `changedFields` cannot produce is one the operator can edit and
    // then watch not be saved.
    const before = valuesOf(ALPHA);
    const after = {
      title: 'renamed', type: 'task', status: 'in-progress',
      component: 'store', assignee: 'jane',
    };
    expect(Object.keys(changedFields(before, after)).sort())
      .toEqual([...SET_FIELDS].sort());
  });

  it('sends only what changed', () => {
    const before = valuesOf(ALPHA);
    expect(changedFields(before, { ...before, title: 'renamed' }))
      .toEqual({ title: 'renamed' });
  });

  it('sends nothing at all when nothing changed', () => {
    const before = valuesOf(ALPHA);
    expect(changedFields(before, { ...before })).toEqual({});
    expect(isUnchanged(changedFields(before, { ...before }))).toBe(true);
  });

  it('clears an assignee with null rather than an empty string', () => {
    // '' is how a text field spells nothing; null is how the facade does.
    // setField('assignee', '') would write an empty assignee, which is not
    // the same as unassigned and shows up as one in every filter.
    const before = valuesOf(issue({ id: ID, title: 'alpha', assignee: 'jane' }));
    expect(changedFields(before, { ...before, assignee: '' })).toEqual({ assignee: null });
  });

  it('clears a component with null', () => {
    const before = valuesOf(ALPHA);
    expect(changedFields(before, { ...before, component: null })).toEqual({ component: null });
  });

  it('offers no component as the first choice', () => {
    const choices = choicesFor(ALPHA, CONFIGURED);
    expect(choices.component[0]).toBeNull();
    expect(componentLabel(choices.component[0] ?? null)).toBe('(none)');
    expect(optionsFor(choices, 'component')).toEqual(['(none)', 'cli', 'store']);
  });

  it('can show a component the config no longer lists', () => {
    // `component rm --force` leaves issues behind holding a component nobody
    // configures. Leaving it out of the picker marks the first option, so the
    // form would read `(none)` over an issue that has one — and a save of any
    // other field would then post that as a change nobody made.
    const orphan = issue({ id: ID, title: 'alpha', component: 'legacy' });
    const choices = choicesFor(orphan, CONFIGURED);
    expect(choices.component).toContain('legacy');
    expect(indexOf(valuesOf(orphan), choices, 'component')).toBeGreaterThanOrEqual(0);
  });

  it('can show a closed status without offering to set one', () => {
    // Same shape as the orphaned component, and the reason `set` refuses is
    // in the facade: closing needs a resolution.
    const closed = issue({ id: ID, title: 'alpha', status: 'closed', resolution: 'fixed' });
    const choices = choicesFor(closed, CONFIGURED);
    expect(choices.status).toContain('closed');
    expect(SETTABLE_STATUSES).not.toContain('closed');
    expect(indexOf(valuesOf(closed), choices, 'status')).toBeGreaterThanOrEqual(0);
  });

  it('moves a picker to the next option and stops at the ends', () => {
    const values = valuesOf(ALPHA);
    const choices = choicesFor(ALPHA, CONFIGURED);
    expect(pick(values, choices, 'type', 1).type).toBe(ISSUE_TYPES[1]);
    // Clamped, not wrapped: Picker's moveSelection decides that and this
    // reads it rather than repeating the rule.
    expect(pick(values, choices, 'type', -1).type).toBe(ISSUE_TYPES[0]);
  });

  it('leaves a typed field alone', () => {
    const values = valuesOf(ALPHA);
    const choices = choicesFor(ALPHA, CONFIGURED);
    expect(pick(values, choices, 'title', 1)).toBe(values);
    expect(optionsFor(choices, 'title')).toBeNull();
    expect(optionsFor(choices, 'assignee')).toBeNull();
  });

  it('sorts every field into exactly one of picked and typed', () => {
    // The keyboard handler asks `textOf`; the layout and the row budget ask
    // `optionsFor`. If they ever disagree about a field, that field either
    // cannot be edited or is edited two ways at once — and both are switches
    // over the same union, so nothing but this notices them drifting apart.
    for (const field of SET_FIELDS) {
      const picked = optionsFor(CHOICES, field) !== null;
      const typed = textOf(valuesOf(ALPHA), field) !== null;
      expect(picked, field).not.toBe(typed);
    }
  });

  it('puts typed text back where it came from, and nowhere else', () => {
    const values = valuesOf(ALPHA);
    expect(typeInto(values, 'title', 'x').title).toBe('x');
    expect(typeInto(values, 'assignee', 'jane').assignee).toBe('jane');
    // A picker field is not typed into: the handler never reaches here for
    // one, and if it did, silently rewriting a picked value would be worse.
    expect(typeInto(values, 'type', 'x')).toBe(values);
  });

  it('wraps focus in both directions', () => {
    // A ring, unlike the picker. Five fields with a dead end at each one
    // means reversing all the way back to reach the title.
    expect(moveFocus(SET_FIELDS, 'title', 1)).toBe('type');
    expect(moveFocus(SET_FIELDS, 'assignee', 1)).toBe('title');
    expect(moveFocus(SET_FIELDS, 'title', -1)).toBe('assignee');
  });

  it('omits from the new-issue form what add cannot carry', () => {
    expect(fieldsFor('add')).not.toContain('status');
    expect(fieldsFor('add')).not.toContain('assignee');
    expect(fieldsFor('add')).toContain('title');
    // Spelled out rather than derived. Comparing against
    // `SET_FIELDS.filter(f => ADD_FIELDS.includes(f))` looks like it pins the
    // order, but `ADD_FIELDS` is itself a filter of `SET_FIELDS` and
    // `SET_FIELDS` has no duplicates, so that comparison is an identity for
    // every possible `NOT_AT_CREATION` — it passes with `component` dropped
    // from the new-issue form altogether. The literal is what fails on both a
    // wrong membership and a reordering.
    expect([...ADD_FIELDS]).toEqual(['title', 'type', 'component']);
  });

  it('builds a new issue with exactly the members add takes', () => {
    const fields = newIssueFrom({ ...EMPTY_VALUES, title: 'a new one' });
    expect(Object.keys(fields).sort()).toEqual(['component', 'title', 'type']);
    expect(fields.type).toBe(EMPTY_VALUES.type);
    expect(ISSUE_TYPES).toContain(fields.type);
  });
});

/** Only the members the handler reads; the rest of `Key` is not consulted. */
const key = (over: Partial<Key>): Key => over as Key;

describe('handleLineKey', () => {
  it('refuses the newline a multi-line entry takes', () => {
    // A title is written into the frontmatter. A newline in it is not a
    // longer title, it is a broken file.
    expect(handleLineKey('a', '', key({ return: true }))).toBeNull();
  });

  it('appends and backspaces exactly as the multi-line entry does', () => {
    expect(handleLineKey('a', 'b', key({}))).toBe('ab');
    expect(handleLineKey('ab', '', key({ backspace: true }))).toBe('a');
    expect(handleLineKey('', '', key({ backspace: true }))).toBe('');
  });

  it('takes no control characters', () => {
    expect(handleLineKey('a', 's', key({ ctrl: true }))).toBeNull();
  });
});
