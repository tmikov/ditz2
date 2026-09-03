/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dz } from '../helpers.js';

/**
 * Every other integration test builds its project under os.tmpdir(), so the
 * whole suite only ever exercises whatever filesystem backs /tmp. That hid a
 * total failure: the lock was once acquired with link(2), and some virtual
 * filesystems -- the FUSE-backed checkouts large repositories are sometimes
 * served from -- reject link(2) with EPERM. Every mutating command failed in
 * the repository itself while all 291 tests passed.
 *
 * These run against the checkout's own filesystem, whatever that is on the
 * machine running them. On a normal clone that is the same filesystem as /tmp
 * and this adds nothing; on such a filesystem it is the case that broke.
 *
 * The scratch directory sits inside this repository, which is itself a dz
 * project, so every init here needs --nested. Without it the commands resolve
 * upward and operate on ditz2's own tracker.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const scratch = path.resolve(here, '..', '..', '.dz-fstest');

afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function inCheckout<T>(name: string, fn: (dir: string) => T): T {
  const dir = path.join(scratch, name);
  fs.mkdirSync(dir, { recursive: true });
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('dz on the filesystem the repository itself lives on', () => {
  it('initialises a project', () => {
    inCheckout('init', (dir) => {
      const r = dz(['init', '--name', 'onrepo', '--nested'], { cwd: dir });
      expect(r.stderr).toBe('');
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(dir, 'dz', 'config.yaml'))).toBe(true);
    });
  });

  it('takes and releases the project lock, which link(2) could not do here', () => {
    inCheckout('lock', (dir) => {
      dz(['init', '--name', 'onrepo', '--nested'], { cwd: dir });

      const added = dz(['add', 'written on the checkout filesystem', '--json'], { cwd: dir });
      expect(added.stderr).toBe('');
      expect(added.code).toBe(0);

      // Released, not merely acquired: a leaked lock blocks every later command.
      expect(fs.existsSync(path.join(dir, 'dz', '.lock'))).toBe(false);

      const id = JSON.parse(added.stdout).id.slice(0, 13);
      const commented = dz(['comment', id, '-m', 'second mutation'], { cwd: dir });
      expect(commented.code).toBe(0);
    });
  });

  it('reports a healthy project, so init wrote everything doctor wants', () => {
    inCheckout('doctor', (dir) => {
      dz(['init', '--name', 'onrepo', '--nested'], { cwd: dir });
      const r = dz(['doctor', '--json'], { cwd: dir });
      expect(JSON.parse(r.stdout).problems).toEqual([]);
      expect(r.code).toBe(0);
    });
  });
});
