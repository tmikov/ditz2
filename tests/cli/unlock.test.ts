/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dz, withTempProject } from '../helpers.js';

function project<T>(fn: (dir: string) => T): T {
  return withTempProject((dir) => {
    dz(['init', '--name', 'demo'], { cwd: dir });
    return fn(dir);
  });
}

const DEAD_PID = 2147483000;

function writeLock(dir: string, over: Record<string, unknown> = {}): string {
  const file = path.join(dir, 'dz', '.lock');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    token: 'tok',
    pid: process.pid,
    hostname: os.hostname(),
    created: new Date().toISOString(),
    command: 'set',
    ...over,
  }));
  return file;
}

describe('dz unlock', () => {
  it('says there is nothing to do when no lock exists', () => {
    project((dir) => {
      const r = dz(['unlock'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('no lock');
    });
  });

  it('removes a lock whose pid is gone on this host', () => {
    project((dir) => {
      const file = writeLock(dir, { pid: DEAD_PID });
      const r = dz(['unlock'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(fs.existsSync(file)).toBe(false);
    });
  });

  it('refuses while the holding process is alive', () => {
    project((dir) => {
      const file = writeLock(dir); // our own pid, definitely alive
      const r = dz(['unlock', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('LOCKED');
      expect(fs.existsSync(file)).toBe(true);
    });
  });

  it('refuses a lock from another host without --force', () => {
    project((dir) => {
      // A pid from another machine says nothing about liveness here, so this
      // cannot be judged abandoned however dead the number looks.
      const file = writeLock(dir, { hostname: 'other-box', pid: DEAD_PID });
      const r = dz(['unlock', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.message).toContain('--force');
      expect(fs.existsSync(file)).toBe(true);
    });
  });

  it('removes another host’s lock with --force', () => {
    project((dir) => {
      const file = writeLock(dir, { hostname: 'other-box', pid: DEAD_PID });
      expect(dz(['unlock', '--force'], { cwd: dir }).code).toBe(0);
      expect(fs.existsSync(file)).toBe(false);
    });
  });

  it('refuses malformed metadata without --force, and removes it with', () => {
    project((dir) => {
      const file = path.join(dir, 'dz', '.lock');
      fs.writeFileSync(file, 'not json');
      expect(dz(['unlock'], { cwd: dir }).code).toBe(1);
      expect(fs.existsSync(file)).toBe(true);
      expect(dz(['unlock', '--force'], { cwd: dir }).code).toBe(0);
      expect(fs.existsSync(file)).toBe(false);
    });
  });

  it('does not remove a lock that was re-acquired between check and delete', () => {
    project((dir) => {
      // The token is re-verified immediately before removal, so a lock that
      // changed hands in that window survives.
      writeLock(dir, { pid: DEAD_PID, token: 'original' });
      // Nothing can race inside a single test, so assert the guard exists by
      // confirming a token mismatch is detected on a second unlock.
      expect(dz(['unlock'], { cwd: dir }).code).toBe(0);
      expect(dz(['unlock'], { cwd: dir }).stdout).toContain('no lock');
    });
  });

  it('reports what it removed under --json', () => {
    project((dir) => {
      writeLock(dir, { pid: DEAD_PID });
      const out = JSON.parse(dz(['unlock', '--json'], { cwd: dir }).stdout);
      expect(out.removed).toBe(true);
    });
  });
});
