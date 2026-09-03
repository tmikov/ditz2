/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { DzError } from 'ditz2';
import type { Project, UiAction } from '../src/mutate.js';
import { runMutation } from '../src/mutate.js';
import { SNAPSHOT_FILTER } from '../src/state.js';
import { three } from './fixtures.js';

function harness(over: Partial<Project> = {}) {
  const seen: UiAction[] = [];
  const listed: unknown[] = [];
  const project = {
    list: (f?: unknown) => { listed.push(f); return { issues: three(), failures: [] }; },
    ...over,
  } as unknown as Project;
  return { project, seen, listed, dispatch: (a: UiAction) => { seen.push(a); } };
}
const types = (seen: UiAction[]): string[] => seen.map((a) => a.type);

describe('runMutation', () => {
  it('announces the start, then the success, and reloads', () => {
    const h = harness();
    runMutation(h.project, h.dispatch, 'comment', () => {}, () => 0);
    expect(types(h.seen)).toEqual(['mutationStarted', 'mutationSucceeded']);
  });

  it('reloads with SNAPSHOT_FILTER, or all:true can never reveal anything', () => {
    // Same trap as the initial load: applyFilter hides closed issues unless
    // asked, and `x` closes issues. Reloading with the default filter makes
    // the issue you just closed vanish with no way to see it again.
    const h = harness();
    runMutation(h.project, h.dispatch, 'close', () => {}, () => 0);
    expect(h.listed).toEqual([SNAPSHOT_FILTER]);
  });

  it('routes LOCKED to the waiting state, carrying the holder', () => {
    const holder = {
      version: 1, token: 't', pid: 4821, hostname: 'box',
      created: '2026-08-30 10:00', command: 'comment',
    };
    const h = harness({
      lock: { state: () => ({ kind: 'active', info: holder }), break: () => false },
    } as Partial<Project>);
    runMutation(h.project, h.dispatch, 'comment', () => {
      throw new DzError('LOCKED', 'the project is locked');
    }, () => 1000);
    expect(types(h.seen)).toEqual(['mutationStarted', 'mutationLocked']);
    expect(h.seen[1]).toMatchObject({ holder, at: 1000 });
  });

  it('reports a null holder when the lock cannot be read', () => {
    const h = harness({
      lock: { state: () => ({ kind: 'malformed', why: 'bad json' }), break: () => false },
    } as Partial<Project>);
    runMutation(h.project, h.dispatch, 'comment', () => {
      throw new DzError('LOCKED', 'locked');
    }, () => 0);
    expect(h.seen[1]).toMatchObject({ holder: null });
  });

  it('does not let a failing lock.state() mask the LOCKED it is describing', () => {
    // The lock can vanish between the refusal and the question. That must
    // still be a wait, not an unrelated error about reading the lock.
    const h = harness({
      lock: { state: () => { throw new Error('gone'); }, break: () => false },
    } as Partial<Project>);
    runMutation(h.project, h.dispatch, 'comment', () => {
      throw new DzError('LOCKED', 'locked');
    }, () => 0);
    expect(types(h.seen)).toEqual(['mutationStarted', 'mutationLocked']);
  });

  it('turns any other DzError into a failure carrying its message', () => {
    const h = harness();
    runMutation(h.project, h.dispatch, 'comment', () => {
      throw new DzError('INVALID_FIELD', 'no author identity: set DZ_AUTHOR');
    }, () => 0);
    expect(types(h.seen)).toEqual(['mutationStarted', 'mutationFailed']);
    expect(h.seen[1]).toMatchObject({ message: 'no author identity: set DZ_AUTHOR' });
  });

  it('does not swallow a non-DzError', () => {
    // A TypeError here is a bug in this package, not something the operator
    // can act on. Reporting it as a user-facing failure would bury it.
    const h = harness();
    expect(() => runMutation(h.project, h.dispatch, 'comment', () => {
      throw new TypeError('undefined is not a function');
    }, () => 0)).toThrow(TypeError);
  });

  it('does not reload after a failure', () => {
    const h = harness();
    runMutation(h.project, h.dispatch, 'comment', () => {
      throw new DzError('NOT_FOUND', 'no such issue');
    }, () => 0);
    expect(h.listed).toEqual([]);
  });

  it('reports a failure to reload rather than claiming the write failed', () => {
    // The write succeeded. Saying otherwise would send the operator to redo a
    // thing that already happened.
    const h = harness({ list: () => { throw new DzError('PARSE_ERROR', 'unreadable'); } });
    runMutation(h.project, h.dispatch, 'comment', () => {}, () => 0);
    expect(types(h.seen)).toEqual(['mutationStarted', 'mutationFailed']);
    expect((h.seen[1] as { message: string }).message).toContain('written');
  });
});
