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

const HOLDER = {
  version: 1, token: 't', pid: 4821, hostname: 'box',
  created: '2026-08-30 10:00', command: 'comment',
} as const;

describe('the mutation lifecycle', () => {
  it('starts idle', () => {
    const s = start();
    expect(s.pending).toBeNull();
    expect(s.waitingFor).toBeNull();
  });

  it('marks a write in flight and clears it on success', () => {
    let s = run(start(), { type: 'openComment' });
    s = run(s, { type: 'mutationStarted', op: 'comment' });
    expect(s.pending).toEqual({ op: 'comment' });
    s = run(s, { type: 'mutationSucceeded', issues: three(), failures: [] });
    expect(s.pending).toBeNull();
    // The overlay closes on success: leaving it open invites a second write
    // the operator did not intend.
    expect(s.overlay).toBeNull();
  });

  it('turns a refused lock into waitingFor, not an error', () => {
    // LOCKED is the ordinary case for this tool — agents write alongside the
    // operator — so it is a state with a retry, not a dialog with an OK button.
    let s = run(start(), { type: 'mutationStarted', op: 'comment' });
    s = run(s, { type: 'mutationLocked', op: 'comment', holder: HOLDER, at: 1000 });
    expect(s.overlay).toEqual({ kind: 'waiting' });
    expect(s.waitingFor).toMatchObject({ op: 'comment', holder: HOLDER, attempts: 1 });
    expect(s.pending).toBeNull();
  });

  it('counts attempts across retries and keeps the first timestamp', () => {
    // `since` is what the elapsed display is computed from, so a retry must
    // not reset it — otherwise the timer restarts at zero every second and
    // never tells the operator how long they have actually been waiting.
    let s = run(start(), { type: 'mutationLocked', op: 'comment', holder: HOLDER, at: 1000 });
    s = run(s, { type: 'mutationLocked', op: 'comment', holder: HOLDER, at: 4000 });
    expect(s.waitingFor).toMatchObject({ since: 1000, attempts: 2 });
  });

  it('counts them across the mutationStarted a real retry goes through', () => {
    // The sequence above is not the one runMutation produces: every call it
    // makes, retries included, opens with mutationStarted. Clearing waitingFor
    // there made the two adjacent mutationLocked dispatches above the only
    // sequence in which the counter worked, and the UI reset to "waiting 0s,
    // 1 attempt" on every press of r. Each action was right on its own; the
    // composition was not.
    let s = run(start(), { type: 'mutationStarted', op: 'comment' });
    s = run(s, { type: 'mutationLocked', op: 'comment', holder: HOLDER, at: 1000 });
    s = run(s, { type: 'mutationStarted', op: 'comment' });
    s = run(s, { type: 'mutationLocked', op: 'comment', holder: HOLDER, at: 4000 });
    expect(s.waitingFor).toMatchObject({ since: 1000, attempts: 2 });
  });

  it('starts a different op\'s wait from scratch rather than inheriting one', () => {
    // A wait carried over from another operation would tell the operator that
    // this write has been refused twice over four seconds when it has been
    // refused once, just now. Only the retry of the wait still on screen may
    // keep the counters, and the reducer decides that for itself: it does not
    // get to assume the keyboard handler kept every other op out.
    let s = run(start(), { type: 'mutationStarted', op: 'comment' });
    s = run(s, { type: 'mutationLocked', op: 'comment', holder: HOLDER, at: 1000 });
    s = run(s, { type: 'mutationStarted', op: 'close' });
    s = run(s, { type: 'mutationLocked', op: 'close', holder: HOLDER, at: 5000 });
    expect(s.waitingFor).toMatchObject({ op: 'close', since: 5000, attempts: 1 });
  });

  it('starts it from scratch even reached without the mutationStarted between', () => {
    // The same property as the test above, minus the case that was actually
    // enforcing it. That one goes through mutationStarted, which nulls
    // waitingFor for a different op one case earlier in the reducer — so it
    // passed with mutationLocked inheriting whatever it found, and the
    // guarantee lived in the neighbouring case rather than in this one. There
    // is no route here through the UI today; that is the point. A reducer that
    // borrows a safety property from the case beside it has not got one, and
    // plan 2c leans on this hardest.
    let s = run(start(), { type: 'mutationLocked', op: 'comment', holder: HOLDER, at: 1000 });
    s = run(s, { type: 'mutationLocked', op: 'close', holder: HOLDER, at: 5000 });
    expect(s.waitingFor).toMatchObject({ op: 'close', since: 5000, attempts: 1 });
  });

  it('does not treat a wait the operator has left as a retry', () => {
    // The overlay is what makes a wait live. Four actions replace it without
    // clearing waitingFor — openFilter, closeFilter, toggleHelp and openIssue
    // — so "waitingFor is still set" is not on its own evidence that the next
    // write is a retry of it. Reachability today rests on the waiting branch
    // of useInput swallowing those keys, which is a fact about a different
    // file that this one cannot check.
    let s = run(start(), { type: 'mutationStarted', op: 'comment' });
    s = run(s, { type: 'mutationLocked', op: 'comment', holder: HOLDER, at: 1000 });
    s = run(s, { type: 'toggleHelp' });
    s = run(s, { type: 'mutationStarted', op: 'comment' });
    s = run(s, { type: 'mutationLocked', op: 'comment', holder: HOLDER, at: 5000 });
    expect(s.waitingFor).toMatchObject({ since: 5000, attempts: 1 });
  });

  it('reports a holder it could not read', () => {
    // breakLock and lockState both admit a lock they cannot parse. A UI that
    // renders `undefined (pid undefined)` is worse than one that says so.
    const s = run(start(), { type: 'mutationLocked', op: 'comment', holder: null, at: 1000 });
    expect(s.waitingFor?.holder).toBeNull();
  });

  it('turns any other failure into an error overlay carrying its message', () => {
    const s = run(start(), {
      type: 'mutationFailed', op: 'comment',
      message: 'no author identity: set DZ_AUTHOR',
    });
    expect(s.overlay).toEqual({ kind: 'error', message: 'no author identity: set DZ_AUTHOR' });
    expect(s.pending).toBeNull();
    expect(s.waitingFor).toBeNull();
  });

  it('replaces the snapshot on success rather than patching it', () => {
    const s = run(start(),
      { type: 'mutationStarted', op: 'comment' },
      { type: 'mutationSucceeded', issues: three().slice(0, 2), failures: [] });
    expect(visibleIssues(s)).toHaveLength(2);
  });

  it('keeps the selection across a write, by id', () => {
    const s = run(start(), { type: 'move', delta: 2 },
      { type: 'mutationSucceeded', issues: [...three()].reverse(), failures: [] });
    expect(selectedIssue(s)?.title).toBe('gamma');
  });

  it('moves the selection off a stale id when the write filters it out from under the cursor', () => {
    // This is the case reselect exists for: the write itself removed the
    // selected issue, so the cursor must land on something real in the new
    // snapshot rather than dangling on an id that no longer resolves.
    const s = run(start(), { type: 'move', delta: 2 },
      { type: 'mutationSucceeded', issues: three().slice(0, 2), failures: [] });
    expect(s.selectedId).not.toBeNull();
    expect(selectedIssue(s)?.title).toBe('alpha');
  });

  it('clears a stale error when the next write starts', () => {
    // An error line that outlives the thing it described is a UI lying about
    // the state of the project.
    const s = run(start(),
      { type: 'mutationFailed', op: 'comment', message: 'boom' },
      { type: 'mutationStarted', op: 'close' });
    expect(s.overlay).toBeNull();
    expect(s.pending).toEqual({ op: 'close' });
  });

  it('closes the waiting overlay when the operator gives up', () => {
    const s = run(start(),
      { type: 'mutationLocked', op: 'comment', holder: HOLDER, at: 1000 },
      { type: 'closeOverlay' });
    expect(s.overlay).toBeNull();
    expect(s.waitingFor).toBeNull();
  });

  it('opens comment and close only with something selected', () => {
    const empty = initialState([], []);
    expect(run(empty, { type: 'openComment' }).overlay).toBeNull();
    expect(run(empty, { type: 'openClose' }).overlay).toBeNull();
    expect(run(start(), { type: 'openComment' }).overlay).toEqual({ kind: 'comment' });
    expect(run(start(), { type: 'openClose' }).overlay).toEqual({ kind: 'close' });
  });
});

describe('the form overlay', () => {
  it('opens over the selected issue', () => {
    expect(run(start(), { type: 'openForm', mode: 'set' }).overlay)
      .toEqual({ kind: 'form' });
  });

  it('does nothing on an empty list, because there is nothing to change', () => {
    expect(run(initialState([], []), { type: 'openForm', mode: 'set' }).overlay).toBeNull();
  });

  it('opens with nothing selected when the form is a new issue', () => {
    // The one form that needs no selection. `n` on an empty backlog is
    // exactly when somebody most wants it.
    expect(run(initialState([], []), { type: 'openForm', mode: 'add' }).overlay)
      .toEqual({ kind: 'form' });
  });

  it('clears a stale status line when any overlay opens', () => {
    // `the close form needs a taller terminal` used to survive the terminal
    // that caused it, because nothing cleared it and <Notice> draws under
    // every overlay that is not an error. Recorded in HANDOFF.md as reachable
    // with no error at all; this is the fix, in the one place all three
    // openings share.
    for (const action of [
      { type: 'openComment' }, { type: 'openClose' }, { type: 'openForm', mode: 'set' },
    ] as const) {
      const s = run(start(), { type: 'notice', text: 'something older' }, action);
      expect(s.notice, action.type).toBeNull();
    }
  });

  it('moves the cursor to an id it is given', () => {
    const s = run(start(), { type: 'select', id: three()[2]!.id });
    expect(selectedIssue(s)?.title).toBe('gamma');
  });
});
