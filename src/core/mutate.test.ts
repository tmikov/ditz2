/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { createIssue, setStatus, closeIssue, addComment, setField } from './mutate.js';
import type { Config, Issue } from './types.js';

const AUTHOR = 'T <t@example.com>';
const AT = '2026-08-22T11:02:55.010Z';
const CONFIG: Config = { name: 'ditz2', components: ['core', 'cli'] };

function base(over: Partial<Issue> = {}): Issue {
  return {
    id: '0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12',
    title: 'A title', type: 'bug', status: 'open', resolution: null,
    component: 'core', assignee: null,
    created: '2026-08-22T09:14:03.221Z', creator: AUTHOR,
    body: '', log: [], unknown: {},
    ...over,
  };
}

describe('createIssue', () => {
  it('opens the issue and logs a single created entry', () => {
    const issue = createIssue(
      { id: base().id, title: 'New bug', type: 'bug', component: 'core', body: 'details' },
      AUTHOR, AT,
    );
    expect(issue.status).toBe('open');
    expect(issue.resolution).toBeNull();
    expect(issue.created).toBe(AT);
    expect(issue.creator).toBe(AUTHOR);
    expect(issue.body).toBe('details');
    expect(issue.log).toEqual([
      { timestamp: AT, author: AUTHOR, verb: 'created', detail: null, text: null },
    ]);
  });
});

describe('setStatus', () => {
  it('records the transition as one status entry', () => {
    const next = setStatus(base(), 'in-progress', AUTHOR, AT);
    expect(next.status).toBe('in-progress');
    expect(next.log.at(-1)).toEqual({
      timestamp: AT, author: AUTHOR, verb: 'status', detail: 'open -> in-progress', text: null,
    });
  });

  it('clears the resolution when reopening a closed issue', () => {
    const closed = base({ status: 'closed', resolution: 'fixed' });
    const next = setStatus(closed, 'open', AUTHOR, AT);
    expect(next.status).toBe('open');
    expect(next.resolution).toBeNull();
    expect(next.log.at(-1)?.detail).toBe('closed -> open');
  });

  it('refuses to close, naming the close command', () => {
    expect(() => setStatus(base(), 'closed' as 'open', AUTHOR, AT)).toThrow(/dz close/);
  });

  it('does not mutate the input issue', () => {
    const original = base();
    setStatus(original, 'in-progress', AUTHOR, AT);
    expect(original.status).toBe('open');
    expect(original.log).toHaveLength(0);
  });
});

describe('closeIssue', () => {
  it('names the resolution in a single status entry', () => {
    const next = closeIssue(base({ status: 'in-progress' }), 'fixed', null, AUTHOR, AT);
    expect(next.status).toBe('closed');
    expect(next.resolution).toBe('fixed');
    expect(next.log.at(-1)).toEqual({
      timestamp: AT, author: AUTHOR, verb: 'status',
      detail: 'in-progress -> closed (fixed)', text: null,
    });
  });

  it('attaches an optional closing comment to the same entry', () => {
    const next = closeIssue(base(), 'wontfix', 'Not worth it.', AUTHOR, AT);
    expect(next.log.at(-1)?.text).toBe('Not worth it.');
  });

  it('rejects an unknown resolution', () => {
    expect(() => closeIssue(base(), 'bogus' as 'fixed', null, AUTHOR, AT))
      .toThrow(/not a valid resolution/);
  });
});

describe('addComment', () => {
  it('appends a comment entry carrying the text', () => {
    const next = addComment(base(), 'Turns out it is the tokenizer.', AUTHOR, AT);
    expect(next.log.at(-1)).toEqual({
      timestamp: AT, author: AUTHOR, verb: 'comment', detail: null,
      text: 'Turns out it is the tokenizer.',
    });
  });

  it('rejects an empty comment', () => {
    expect(() => addComment(base(), '   ', AUTHOR, AT)).toThrow(/empty comment/);
  });
});

describe('setField', () => {
  it('changes the title and logs old -> new', () => {
    const next = setField(base(), 'title', 'Better title', CONFIG, AUTHOR, AT);
    expect(next.title).toBe('Better title');
    expect(next.log.at(-1)?.detail).toBe('A title -> Better title');
  });

  it('validates the component against the config', () => {
    expect(() => setField(base(), 'component', 'nope', CONFIG, AUTHOR, AT))
      .toThrow(/not a configured component/);
  });

  it('validates the type against the vocabulary', () => {
    expect(() => setField(base(), 'type', 'epic', CONFIG, AUTHOR, AT))
      .toThrow(/not a valid type/);
  });

  it('accepts clearing assignee to null and logs it readably', () => {
    const assigned = base({ assignee: 'a@example.com' });
    const next = setField(assigned, 'assignee', null, CONFIG, AUTHOR, AT);
    expect(next.assignee).toBeNull();
    expect(next.log.at(-1)?.detail).toBe('a@example.com -> (none)');
  });
});
