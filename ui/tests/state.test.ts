/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  initialState, reducer, selectedIssue, visibleIssues,
} from '../src/state.js';
import type { UiAction, UiState } from '../src/state.js';
import { issue, three } from './fixtures.js';

const ME = 'jane@example.com';
const start = (): UiState => initialState(three(), []);
const run = (s: UiState, ...actions: UiAction[]): UiState =>
  actions.reduce(reducer, s);
const titles = (s: UiState): string[] => visibleIssues(s).map((i) => i.title);

describe('selection', () => {
  it('starts on the first issue', () => {
    expect(selectedIssue(start())?.title).toBe('alpha');
  });

  it('has nothing selected in an empty project', () => {
    const s = initialState([], []);
    expect(s.selectedId).toBeNull();
    expect(selectedIssue(s)).toBeNull();
  });

  it('moves down and up, and stops at the ends', () => {
    let s = run(start(), { type: 'move', delta: 1 });
    expect(selectedIssue(s)?.title).toBe('beta');
    s = run(s, { type: 'move', delta: -1 }, { type: 'move', delta: -1 });
    expect(selectedIssue(s)?.title).toBe('alpha');
    s = run(s, { type: 'move', delta: 99 });
    expect(selectedIssue(s)?.title).toBe('gamma');
  });

  it('jumps to first and last', () => {
    const s = run(start(), { type: 'jump', to: 'last' });
    expect(selectedIssue(s)?.title).toBe('gamma');
    expect(selectedIssue(run(s, { type: 'jump', to: 'first' }))?.title).toBe('alpha');
  });

  it('keeps the cursor on the same issue when a refresh reorders the list', () => {
    const s = run(start(), { type: 'move', delta: 2 });
    const id = s.selectedId;
    const reordered = [...three()].reverse();
    const after = run(s, { type: 'snapshot', issues: reordered, failures: [] });
    // Index 2 would now be 'alpha'. By id it is still 'gamma'.
    expect(after.selectedId).toBe(id);
    expect(selectedIssue(after)?.title).toBe('gamma');
  });

  it('says so when the selected issue is gone after a refresh', () => {
    const s = run(start(), { type: 'move', delta: 2 });
    const after = run(s, { type: 'snapshot', issues: three().slice(0, 2), failures: [] });
    expect(selectedIssue(after)?.title).toBe('alpha');
    expect(after.notice).toContain('01a00000-0003');
    expect(after.notice).toContain('no longer');
  });

  it('clears a stale notice once a refresh succeeds', () => {
    const s = run(start(),
      { type: 'notice', text: 'refresh failed: disk on fire' },
      { type: 'snapshot', issues: three(), failures: [] });
    expect(s.notice).toBeNull();
  });

  it('still reports a lost selection on the refresh that clears the notice', () => {
    // The clear must not swallow the message reselect is about to set.
    const s = run(start(),
      { type: 'move', delta: 2 },
      { type: 'notice', text: 'refresh failed: disk on fire' },
      { type: 'snapshot', issues: three().slice(0, 2), failures: [] });
    expect(s.notice).toContain('no longer');
    expect(s.notice).not.toContain('disk on fire');
  });

  it('reports the loss even when the refresh empties the list entirely', () => {
    // The partial case is covered above. Total loss went through a separate
    // early return that ignored the report flag.
    const s = run(start(), { type: 'move', delta: 1 },
      { type: 'snapshot', issues: [], failures: [] });
    expect(s.selectedId).toBeNull();
    expect(s.notice).toContain('no longer');
  });

  it('stays quiet when a filter empties the list', () => {
    const s = run(start(), { type: 'setQuery', text: 'type:bug component:store', me: ME });
    expect(visibleIssues(s)).toEqual([]);
    expect(s.selectedId).toBeNull();
    expect(s.notice).toBeNull();
  });

  it('says nothing when a filter, not a refresh, hides the selection', () => {
    // Filtering a row out is what filtering is for; announcing it is noise.
    const s = run(start(), { type: 'move', delta: 2 },
      { type: 'setQuery', text: 'type:bug', me: ME });
    expect(selectedIssue(s)?.title).toBe('alpha');
    expect(s.notice).toBeNull();
  });
});

describe('the filter query', () => {
  it('narrows by key:value', () => {
    expect(titles(run(start(), { type: 'setQuery', text: 'type:bug', me: ME })))
      .toEqual(['alpha']);
  });

  it('narrows by regex', () => {
    expect(titles(run(start(), { type: 'setQuery', text: 'a.pha', me: ME })))
      .toEqual(['alpha']);
  });

  it('applies both at once', () => {
    const s = run(start(), { type: 'setQuery', text: 'component:store beta', me: ME });
    expect(titles(s)).toEqual(['beta']);
  });

  it('hides closed issues until asked, exactly as dz list does', () => {
    const closed = issue({
      id: '01a00000-0004-7000-8000-000000000004', title: 'delta',
      status: 'closed', resolution: 'fixed',
    });
    const s = initialState([...three(), closed], []);
    expect(titles(s)).not.toContain('delta');
    expect(titles(run(s, { type: 'setQuery', text: 'all:true', me: ME })))
      .toContain('delta');
  });

  it('reports a bad value instead of throwing, and keeps the last good list', () => {
    const s = run(start(), { type: 'setQuery', text: 'status:nope', me: ME });
    expect(s.queryError).toContain('nope');
    expect(titles(s)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('survives a half-typed regex', () => {
    // "(" arrives on the way to "(foo)". It must be a message, not a crash.
    const s = run(start(), { type: 'setQuery', text: '(', me: ME });
    expect(s.queryError).not.toBeNull();
    expect(() => visibleIssues(s)).not.toThrow();
  });

  it('clears the error once the text becomes valid again', () => {
    // "(a)" as a final regex is a poor probe here: matchesRe does an
    // unanchored substring test against the title, and "beta" and "gamma"
    // both contain the letter "a" too. "(alpha)" narrows to just one issue
    // while keeping the same unbalanced-paren-while-typing shape.
    const s = run(start(),
      { type: 'setQuery', text: '(', me: ME },
      { type: 'setQuery', text: '(al', me: ME },
      { type: 'setQuery', text: '(alpha)', me: ME });
    expect(s.queryError).toBeNull();
    expect(titles(s)).toEqual(['alpha']);
  });

  it('restores the whole list when cleared', () => {
    const s = run(start(),
      { type: 'setQuery', text: 'type:bug', me: ME },
      { type: 'clearFilter' });
    expect(s.query).toBe('');
    expect(titles(s)).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('overlays', () => {
  it('opens and closes the filter field', () => {
    let s = run(start(), { type: 'openFilter' });
    expect(s.overlay).toEqual({ kind: 'filter' });
    s = run(s, { type: 'closeFilter' });
    expect(s.overlay).toBeNull();
  });

  it('keeps the typed filter when the field is closed', () => {
    // Esc leaves the field; clearing is a separate action. Losing the filter
    // on the way back to the list would make it unusable.
    const s = run(start(), { type: 'openFilter' },
      { type: 'setQuery', text: 'type:bug', me: ME }, { type: 'closeFilter' });
    expect(titles(s)).toEqual(['alpha']);
  });

  it('toggles help', () => {
    const s = run(start(), { type: 'toggleHelp' });
    expect(s.overlay).toEqual({ kind: 'help' });
    expect(run(s, { type: 'toggleHelp' }).overlay).toBeNull();
  });

  it('scrolls help within its bounds', () => {
    let s = run(start(), { type: 'toggleHelp' }, { type: 'scrollHelp', delta: 2, max: 3 });
    expect(s.helpOffset).toBe(2);
    s = run(s, { type: 'scrollHelp', delta: 9, max: 3 });
    expect(s.helpOffset).toBe(3);
    s = run(s, { type: 'scrollHelp', delta: -9, max: 3 });
    expect(s.helpOffset).toBe(0);
  });

  it('reopens help at the top', () => {
    const s = run(start(), { type: 'toggleHelp' }, { type: 'scrollHelp', delta: 3, max: 5 },
      { type: 'toggleHelp' }, { type: 'toggleHelp' });
    expect(s.helpOffset).toBe(0);
  });
});

describe('the issue screen', () => {
  it('opens on the selected issue and starts at the top', () => {
    const s = run(start(),
      { type: 'toggleHelp' }, { type: 'toggleHelp' }, // unrelated churn first
      { type: 'openIssue' });
    expect(s.screen).toBe('issue');
    expect(s.issueOffset).toBe(0);
  });

  it('resets the offset on reopen, even if it was scrolled before', () => {
    const s = run(start(),
      { type: 'openIssue' },
      { type: 'scrollIssue', delta: 5, max: 20 },
      { type: 'closeIssue' },
      { type: 'openIssue' });
    expect(s.issueOffset).toBe(0);
  });

  it('does nothing on an empty list', () => {
    const s = run(initialState([], []), { type: 'openIssue' });
    expect(s.screen).toBe('list');
  });

  it('returns to the list on close, keeping the filter and selection', () => {
    const s = run(start(),
      { type: 'move', delta: 1 },
      { type: 'setQuery', text: 'type:feature', me: ME },
      { type: 'openIssue' },
      { type: 'closeIssue' });
    expect(s.screen).toBe('list');
    expect(s.query).toBe('type:feature');
    expect(selectedIssue(s)?.title).toBe('beta');
  });

  it('clamps scrolling at both ends', () => {
    let s = run(start(), { type: 'openIssue' });
    s = run(s, { type: 'scrollIssue', delta: -5, max: 10 });
    expect(s.issueOffset).toBe(0);
    s = run(s, { type: 'scrollIssue', delta: 99, max: 10 });
    expect(s.issueOffset).toBe(10);
    s = run(s, { type: 'scrollIssue', delta: 99, max: 10 });
    expect(s.issueOffset).toBe(10);
  });
});

describe('load failures', () => {
  it('carries them so the UI can report an unreadable file', () => {
    const failures = [{ file: 'dz/issues/x.md', error: new Error('bad') as never }];
    expect(initialState([], failures).failures).toHaveLength(1);
  });
});
