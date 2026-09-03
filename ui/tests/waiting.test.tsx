/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DzError } from 'ditz2';
import type { LockInfo, Project } from 'ditz2';
import { holderLine, elapsedLine } from '../src/components/WaitingOverlay.js';
import { footerOf, KEY, lines, mount, press } from './helpers.js';
import { three } from './fixtures.js';

const HOLDER: LockInfo = {
  version: 1,
  token: '0f2c4e1a-0000-4000-8000-000000000001',
  pid: 4821,
  hostname: 'build-42',
  created: '2026-08-30T09:00:00Z',
  command: 'dz close',
};

/** A project whose lock reports `holder`, or reports nothing readable. */
function held(holder: LockInfo | null): Partial<Project> {
  return {
    lock: {
      state: () => (holder === null ? { kind: 'none' } : { kind: 'active', info: holder }),
      break: () => false,
    },
  };
}

const refuse = (): never => { throw new DzError('LOCKED', 'locked'); };

/**
 * Every mount that is left sitting on the waiting overlay is unmounted here.
 *
 * The overlay runs a one-second interval, and an interval whose component is
 * never unmounted outlives the test that created it — it keeps the event loop
 * alive and keeps dispatching into a React tree nothing is watching.
 */
const open: Array<() => void> = [];
afterEach(() => {
  for (const unmount of open.splice(0)) unmount();
  vi.useRealTimers();
});

/** `mount`, registered for the unmount above. */
function waiting(over: Partial<Project>): ReturnType<typeof mount> {
  const r = mount(over);
  open.push(r.unmount);
  return r;
}

describe('the holder line', () => {
  it('names the holder and its pid', () => {
    expect(holderLine(HOLDER)).toBe('held by dz close (pid 4821) on build-42');
  });

  it('says so when the holder cannot be read', () => {
    // Rendering "held by undefined (pid undefined)" is worse than admitting it.
    const line = holderLine(null);
    expect(line).not.toContain('undefined');
    expect(line).toContain('does not describe');
  });
});

describe('the elapsed line', () => {
  it('floors to whole seconds', () => {
    expect(elapsedLine(1000, 1400)).toBe('waiting 0s');
    expect(elapsedLine(1000, 4000)).toBe('waiting 3s');
  });

  it('never counts backwards when the clock moves the wrong way', () => {
    // Not hypothetical on a laptop that resumed from suspend or had its time
    // corrected under the running process. "waiting -3s" reads as a bug.
    expect(elapsedLine(4000, 1000)).toBe('waiting 0s');
  });
});

describe('waiting for the lock', () => {
  it('names the holder and its pid on screen', async () => {
    const { lastFrame, stdin } = waiting({ comment: refuse, ...held(HOLDER) });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    const shown = lines(lastFrame()).join('\n');
    expect(shown).toContain('waiting for the lock to run comment');
    expect(shown).toContain('held by dz close (pid 4821) on build-42');
    expect(shown).toContain('1 attempt');
  });

  it('says so on screen when the holder cannot be read', async () => {
    const { lastFrame, stdin } = waiting({ comment: refuse, ...held(null) });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    const shown = lines(lastFrame()).join('\n');
    expect(shown).toContain('waiting for the lock to run comment');
    expect(shown).not.toContain('undefined');
  });

  it('counts the wait from the first refusal, not the latest retry', async () => {
    // Two refusals 3s apart must show ~3s, not ~0s. A timer that restarts on
    // every retry tells the operator nothing about how long they have waited.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    const { lastFrame, stdin } = waiting({ comment: refuse, ...held(HOLDER) });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(lines(lastFrame()).join('\n')).toContain('waiting 0s, 1 attempt');
    vi.setSystemTime(4000);
    await press(stdin, 'r');
    expect(lines(lastFrame()).join('\n')).toContain('waiting 3s, 2 attempts');
  });

  it('keeps counting while nothing is typed', async () => {
    // The elapsed line is the only thing on this screen that changes on its
    // own. Without the interval behind `retryTick` it freezes at the second
    // the refusal happened and quietly lies for as long as the operator
    // leaves it up.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    const { lastFrame, stdin } = waiting({ comment: refuse, ...held(HOLDER) });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(lines(lastFrame()).join('\n')).toContain('waiting 0s');
    // Real time, faked clock: the interval is a genuine one-second timer, and
    // only Date is under the test's control.
    vi.setSystemTime(6000);
    await new Promise((r) => { setTimeout(r, 1300); });
    expect(lines(lastFrame()).join('\n')).toContain('waiting 5s');
    // Still one attempt: the clock ticking is not a retry.
    expect(lines(lastFrame()).join('\n')).toContain('1 attempt');
  });

  it('stops its clock when it closes', async () => {
    // A repaint timer left running after the overlay goes is invisible to
    // every other assertion here: retryTick on a null waitingFor returns the
    // state unchanged, so nothing redraws and nothing looks wrong. Only the
    // timer count can see it.
    //
    // setInterval and clearInterval are the only globals faked, so `press`
    // and `settle` keep their real setTimeout and the count belongs to the
    // overlay alone.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { lastFrame, stdin } = waiting({ comment: refuse, ...held(HOLDER) });
    const idle = vi.getTimerCount();
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(lastFrame()).toContain('waiting for the lock');
    expect(vi.getTimerCount()).toBe(idle + 1);
    await press(stdin, KEY.escape);
    expect(lastFrame()).not.toContain('waiting for the lock');
    expect(vi.getTimerCount()).toBe(idle);
  });

  it('retries on r, calling the same operation again', async () => {
    let attempts = 0;
    const { stdin } = waiting({
      comment: () => { attempts += 1; throw new DzError('LOCKED', 'locked'); },
      ...held(HOLDER),
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(attempts).toBe(1);
    await press(stdin, 'r');
    expect(attempts).toBe(2);
  });

  it('does not let r fall through to the list refresh', async () => {
    // refresh() dispatches closeOverlay, which nulls waitingFor as well as
    // overlay. If `r` reached the list binding it would cancel the very wait
    // it was pressed to repeat, and the cancellation would look exactly like
    // giving up.
    let listCalls = 0;
    const { lastFrame, stdin } = waiting({
      comment: refuse,
      list: () => { listCalls += 1; return { issues: three(), failures: [] }; },
      ...held(HOLDER),
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    await press(stdin, 'r');
    expect(listCalls).toBe(0);
    expect(lastFrame()).toContain('waiting for the lock');
    expect(lines(lastFrame()).join('\n')).toContain('2 attempts');
  });

  it('advertises the keys it answers to, and no others', async () => {
    const { lastFrame, stdin } = waiting({ comment: refuse, ...held(HOLDER) });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    const footer = footerOf(lastFrame());
    expect(footer).toContain('r retry');
    expect(footer).toContain('esc/q give up');
    // Every one of these does nothing while the wait is up.
    expect(footer).not.toContain('r reload');
    expect(footer).not.toContain('/ filter');
    expect(footer).not.toContain('? help');
    expect(footer).not.toContain('q quit');
  });

  it('gives up on Esc, leaving the list usable', async () => {
    const { lastFrame, stdin } = waiting({ comment: refuse, ...held(HOLDER) });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS, KEY.escape);
    expect(lastFrame()).not.toContain('waiting for the lock');
    // Back on the list: j moves again rather than typing.
    await press(stdin, 'j');
    expect(lines(lastFrame()).find((l) => l.startsWith('>'))).toContain('beta');
  });

  it('gives up on q without quitting the UI', async () => {
    // q is the give-up key here, not the quit key. Exiting the whole program
    // because a lock was busy would throw away the comment as well.
    const onExit = vi.fn();
    const r = mount({ comment: refuse, ...held(HOLDER) }, undefined, onExit);
    open.push(r.unmount);
    await press(r.stdin, 'c', 'h', 'i', KEY.ctrlS, 'q');
    expect(r.lastFrame()).not.toContain('waiting for the lock');
    expect(onExit).not.toHaveBeenCalled();
    await press(r.stdin, 'q');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('closes itself when a retry succeeds', async () => {
    let attempts = 0;
    const { lastFrame, stdin } = waiting({
      comment: () => {
        attempts += 1;
        if (attempts === 1) throw new DzError('LOCKED', 'locked');
        return three()[0]!;
      },
      ...held(HOLDER),
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(lastFrame()).toContain('waiting for the lock');
    await press(stdin, 'r');
    expect(lastFrame()).not.toContain('waiting for the lock');
    // And the comment entry is gone too — the write it belonged to happened.
    expect(lastFrame()).not.toContain('^S save');
  });

  it('does not offer the text again once a retry wrote it', async () => {
    // The draft is only kept so a failure the operator can fix does not lose
    // it. A retry that succeeded is not a failure, and reopening the entry on
    // the same issue must start blank rather than inviting a duplicate.
    let attempts = 0;
    const { lastFrame, stdin } = waiting({
      comment: () => {
        attempts += 1;
        if (attempts === 1) throw new DzError('LOCKED', 'locked');
        return three()[0]!;
      },
      ...held(HOLDER),
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS, 'r');
    expect(lastFrame()).not.toContain('waiting for the lock');
    await press(stdin, 'c');
    expect(lastFrame()).toContain('^S save');
    expect(lines(lastFrame()).join('\n')).not.toContain('hi');
  });
});
