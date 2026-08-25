/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DzError } from '../core/errors.js';
import { initProject } from './config.js';
import { acquireLock, breakLock, lockPath, lockState, readLockInfo, releaseLock } from './lock.js';

let tmp: string;
const NO_WAIT = { DZ_LOCK_TIMEOUT_MS: '0' };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-lock-'));
  initProject(tmp, 'demo');
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('acquireLock', () => {
  it('creates the lock file with ownership metadata', () => {
    const handle = acquireLock(tmp, 'comment', NO_WAIT);
    const info = readLockInfo(tmp);
    expect(info?.token).toBe(handle.token);
    expect(info?.pid).toBe(process.pid);
    expect(info?.command).toBe('comment');
    expect(info?.hostname).toBe(os.hostname());
    expect(info?.version).toBe(1);
    releaseLock(handle);
  });

  it('is exclusive: a second acquire fails while the first is held', () => {
    const first = acquireLock(tmp, 'set', NO_WAIT);
    try {
      acquireLock(tmp, 'comment', NO_WAIT);
      expect.unreachable('second acquire should have failed');
    } catch (err) {
      expect((err as DzError).code).toBe('LOCKED');
      // The error has to say who holds it, or the user has nothing to act on.
      expect((err as DzError).message).toContain('set');
      expect((err as DzError).message).toContain(String(process.pid));
    }
    releaseLock(first);
  });

  it('succeeds again once released', () => {
    releaseLock(acquireLock(tmp, 'add', NO_WAIT));
    const second = acquireLock(tmp, 'add', NO_WAIT);
    expect(readLockInfo(tmp)).not.toBeNull();
    releaseLock(second);
  });

  it('creates a lock file readable only by its owner', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    expect(fs.statSync(lockPath(tmp)).mode & 0o777).toBe(0o600);
    releaseLock(handle);
  });

  it('retries until the timeout before giving up', () => {
    const first = acquireLock(tmp, 'set', NO_WAIT);
    const started = Date.now();
    expect(() => acquireLock(tmp, 'comment', { DZ_LOCK_TIMEOUT_MS: '300' })).toThrow(/LOCKED|held/);
    const waited = Date.now() - started;
    // It must actually have waited, not just failed instantly.
    expect(waited).toBeGreaterThanOrEqual(250);
    releaseLock(first);
  });

  it('has written the metadata by the time acquisition returns', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    expect(readLockInfo(tmp)).not.toBeNull();
    expect(lockState(tmp).kind).toBe('active');
    releaseLock(handle);
  });

  it('adds nothing to dz/ but the lock itself', () => {
    const before = fs.readdirSync(path.join(tmp, 'dz')).sort();
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    expect(fs.readdirSync(path.join(tmp, 'dz')).sort())
      .toEqual([...before, '.lock'].sort());
    releaseLock(handle);
    expect(fs.readdirSync(path.join(tmp, 'dz')).sort()).toEqual(before);
  });

  it('adds nothing to dz/ when acquisition fails either', () => {
    const first = acquireLock(tmp, 'set', NO_WAIT);
    const during = fs.readdirSync(path.join(tmp, 'dz')).sort();
    expect(() => acquireLock(tmp, 'comment', NO_WAIT)).toThrow();
    expect(fs.readdirSync(path.join(tmp, 'dz')).sort()).toEqual(during);
    releaseLock(first);
  });

  it('refuses to break a malformed lock that has since become readable', () => {
    // The window O_EXCL opens: a lock caught between create and write reads as
    // malformed. Removing it then would release a live lock.
    fs.writeFileSync(path.join(tmp, 'dz', '.lock'), '');
    expect(lockState(tmp).kind).toBe('malformed');

    // The holder finishes filling it in before unlock gets round to acting.
    fs.writeFileSync(path.join(tmp, 'dz', '.lock'), JSON.stringify({
      version: 1,
      token: 'live',
      pid: process.pid,
      hostname: os.hostname(),
      created: new Date().toISOString(),
      command: 'add',
    }));

    expect(breakLock(tmp, null)).toBe(false);
    expect(readLockInfo(tmp)?.token).toBe('live');
  });

  it('does not delete a live lock that replaced the one unlock diagnosed', () => {
    // The race the review found: unlock holds token A, A is released, B wins
    // O_EXCL and has not written its metadata yet, so the re-read comes back
    // unreadable. Treating that as "close enough" deleted B's live lock.
    const first = acquireLock(tmp, 'set', NO_WAIT);
    const tokenA = first.token;
    releaseLock(first);

    // B, caught between its create and its write.
    fs.writeFileSync(path.join(tmp, 'dz', '.lock'), '');

    expect(breakLock(tmp, tokenA)).toBe(false);
    expect(fs.existsSync(lockPath(tmp))).toBe(true);
  });

  it('does not delete a lock that a different holder has already filled in', () => {
    const first = acquireLock(tmp, 'set', NO_WAIT);
    const tokenA = first.token;
    releaseLock(first);
    const second = acquireLock(tmp, 'comment', NO_WAIT);

    expect(breakLock(tmp, tokenA)).toBe(false);
    expect(readLockInfo(tmp)?.token).toBe(second.token);
    releaseLock(second);
  });

  it('still breaks a lock that is malformed for good', () => {
    fs.writeFileSync(path.join(tmp, 'dz', '.lock'), 'not json at all');
    expect(lockState(tmp).kind).toBe('malformed');
    expect(breakLock(tmp, null)).toBe(true);
    expect(lockState(tmp).kind).toBe('none');
  });

  it('fails immediately when the timeout is zero', () => {
    const first = acquireLock(tmp, 'set', NO_WAIT);
    const started = Date.now();
    expect(() => acquireLock(tmp, 'comment', NO_WAIT)).toThrow();
    expect(Date.now() - started).toBeLessThan(150);
    releaseLock(first);
  });
});

describe('releaseLock', () => {
  it('removes the lock file', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    releaseLock(handle);
    expect(fs.existsSync(lockPath(tmp))).toBe(false);
  });

  it('does not delete a lock that belongs to someone else', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    // Simulate our lock having been broken and re-taken by another process.
    const stolen = { ...readLockInfo(tmp), token: 'a-different-token' };
    fs.writeFileSync(lockPath(tmp), JSON.stringify(stolen));

    releaseLock(handle);

    expect(fs.existsSync(lockPath(tmp))).toBe(true);
    expect(readLockInfo(tmp)?.token).toBe('a-different-token');
  });

  it('is safe to call when the lock file is already gone', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    fs.rmSync(lockPath(tmp));
    expect(() => releaseLock(handle)).not.toThrow();
  });
});

describe('lockState', () => {
  it('reports none when there is no lock', () => {
    expect(lockState(tmp).kind).toBe('none');
  });

  it('reports active for a lock held by a live process on this host', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    expect(lockState(tmp).kind).toBe('active');
    releaseLock(handle);
  });

  it('reports abandoned for a dead pid on this host', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    const info = { ...readLockInfo(tmp), pid: 2147483000 };
    fs.writeFileSync(lockPath(tmp), JSON.stringify(info));
    const state = lockState(tmp);
    expect(state.kind).toBe('abandoned');
    releaseLock(handle);
  });

  it('reports active for another host, since liveness is unknowable there', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    const info = { ...readLockInfo(tmp), hostname: 'some-other-box', pid: 2147483000 };
    fs.writeFileSync(lockPath(tmp), JSON.stringify(info));
    // A dead-looking pid on a different machine means nothing: that pid number
    // refers to a process on that host, not this one.
    expect(lockState(tmp).kind).toBe('active');
    releaseLock(handle);
  });

  it('reports malformed for unparseable contents', () => {
    fs.writeFileSync(lockPath(tmp), 'not json at all');
    const state = lockState(tmp);
    expect(state.kind).toBe('malformed');
  });

  it('reports malformed for json missing required fields', () => {
    fs.writeFileSync(lockPath(tmp), JSON.stringify({ version: 1 }));
    expect(lockState(tmp).kind).toBe('malformed');
  });

  // Values, not just types. Each of these is well-typed JSON that would once
  // have been trusted, and each feeds a decision that matters.
  describe('rejects well-typed but impossible metadata', () => {
    const base = {
      version: 1,
      token: 'tok',
      pid: 4242,
      hostname: 'somewhere',
      created: '2026-08-24T10:00:00.000Z',
      command: 'set',
    };
    const cases: Array<[string, Record<string, unknown>]> = [
      ['a version this dz does not know', { version: 2 }],
      ['an empty token', { token: '' }],
      ['an empty hostname', { hostname: '   ' }],
      ['an empty command', { command: '' }],
      ['a fractional pid', { pid: 3.5 }],
      ['pid zero', { pid: 0 }],
      // A negative pid is the dangerous one: process.kill(-1, 0) addresses a
      // whole process group, so this used to read as a live lock.
      ['a negative pid', { pid: -1 }],
      ['an unparseable created', { created: 'yesterday' }],
      ['a created that rolls over', { created: '2026-02-31T00:00:00.000Z' }],
    ];

    for (const [what, override] of cases) {
      it(what, () => {
        fs.writeFileSync(lockPath(tmp), JSON.stringify({ ...base, ...override }));
        expect(readLockInfo(tmp)).toBeNull();
        // Malformed, not abandoned: unlock must require --force for these.
        expect(lockState(tmp).kind).toBe('malformed');
      });
    }

    it('accepts the baseline the cases are derived from', () => {
      fs.writeFileSync(lockPath(tmp), JSON.stringify(base));
      expect(readLockInfo(tmp)).not.toBeNull();
    });

    it('accepts a non-UTC offset, which is a valid RFC 3339 time', () => {
      fs.writeFileSync(
        lockPath(tmp),
        JSON.stringify({ ...base, created: '2026-08-24T02:00:00+05:00' }),
      );
      expect(readLockInfo(tmp)).not.toBeNull();
    });
  });
});
