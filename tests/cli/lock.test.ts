/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DZ_BIN, dz, withTempProject } from '../helpers.js';

/**
 * Deletes `file` after `delayMs`, from a detached process.
 *
 * `dz()` below runs the CLI with `execFileSync`, which blocks this process's
 * event loop for the whole call - a `setTimeout` scheduled beforehand would
 * never fire until `dz()` returns, by which point it is too late. A separate
 * process is unaffected by that block.
 */
function deleteAfter(file: string, delayMs: number): void {
  const child = spawn(
    process.execPath,
    ['-e', "setTimeout(() => require('fs').rmSync(process.argv[1], { force: true }), Number(process.argv[2]))", file, String(delayMs)],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
}

function project<T>(fn: (dir: string) => T): T {
  return withTempProject((dir) => {
    dz(['init', '--name', 'demo'], { cwd: dir });
    return fn(dir);
  });
}

/** Writes a lock owned by a live process, so it reads as active. */
function holdLock(dir: string, command = 'set'): string {
  const file = path.join(dir, 'dz', '.lock');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    token: 'held-by-the-test',
    pid: process.pid,
    hostname: require('node:os').hostname(),
    created: new Date().toISOString(),
    command,
  }));
  return file;
}

const NOWAIT = { DZ_LOCK_TIMEOUT_MS: '0' };

describe('mutating commands take the project lock', () => {
  for (const [name, argv] of [
    ['add', ['add', 'x']],
    ['set', ['set', 'PREFIX', '--title', 'y']],
    ['close', ['close', 'PREFIX', '--as', 'fixed']],
    ['comment', ['comment', 'PREFIX', '-m', 'z']],
    ['component add', ['component', 'add', 'core']],
  ] as const) {
    it(`${name} refuses while the lock is held`, () => {
      project((dir) => {
        const id = JSON.parse(dz(['add', 'target', '--json'], { cwd: dir }).stdout)
          .id.slice(0, 13);
        holdLock(dir);
        const args = argv.map((a) => (a === 'PREFIX' ? id : a));

        const r = dz([...args, '--json'], { cwd: dir, env: NOWAIT });
        expect(r.code).toBe(1);
        expect(r.stdout).toBe('');
        const err = JSON.parse(r.stderr).error;
        expect(err.code).toBe('LOCKED');
        expect(err.message).toContain('set'); // names the holding command
      });
    });
  }

  it('releases the lock when the command succeeds', () => {
    project((dir) => {
      dz(['add', 'x'], { cwd: dir });
      expect(fs.existsSync(path.join(dir, 'dz', '.lock'))).toBe(false);
    });
  });

  it('releases the lock when the command fails', () => {
    project((dir) => {
      // An unconfigured component is rejected after the lock is taken.
      expect(dz(['add', 'x', '--component', 'nope'], { cwd: dir }).code).toBe(1);
      expect(fs.existsSync(path.join(dir, 'dz', '.lock'))).toBe(false);
    });
  });

  it('leaves read-only commands unlocked', () => {
    project((dir) => {
      dz(['add', 'readable'], { cwd: dir });
      holdLock(dir);
      for (const argv of [['list'], ['grep', 'read'], ['doctor'], ['schema']]) {
        const r = dz(argv, { cwd: dir, env: NOWAIT });
        expect(r.stderr, `${argv[0]} should not need the lock`).not.toContain('LOCKED');
      }
    });
  });

  it('waits and succeeds when the lock is released in time', () => {
    project((dir) => {
      const file = holdLock(dir);
      deleteAfter(file, 150);
      const r = dz(['add', 'patient'], { cwd: dir, env: { DZ_LOCK_TIMEOUT_MS: '3000' } });
      expect(r.code).toBe(0);
    });
  });

  it('gitignores the lock file', () => {
    project((dir) => {
      const ignore = fs.readFileSync(path.join(dir, 'dz', '.gitignore'), 'utf8');
      expect(ignore).toContain('.lock');
      expect(ignore).toContain('config.local.yaml');
    });
  });

});

describe('reading a message from stdin does not hold the lock', () => {
  // `-m -` blocks until stdin closes. Taking the lock first would pin the whole
  // project for as long as the producer runs, or for as long as a human takes
  // to press Ctrl-D, for something that is not project state at all.
  it('lets another mutation run while -m - waits on a slow pipe', () => {
    project((dir) => {
      const id = JSON.parse(dz(['add', 'target', '--json'], { cwd: dir }).stdout)
        .id.slice(0, 13);
      const probe = path.join(dir, 'probe.txt');
      const script = path.join(dir, 'slow-pipe.sh');
      const node = process.execPath;

      fs.writeFileSync(script,
        `#!/bin/sh\n`
        + `cd "${dir}"\n`
        // A deliberately slow producer: the comment cannot finish before it
        // closes stdin a second from now.
        + `{ sleep 2; echo "from the pipe"; } | "${node}" "${DZ_BIN}" comment ${id} -m - >/dev/null 2>&1 &\n`
        + `piped=$!\n`
        // Long enough that the comment is past node startup and blocked on the
        // read, short enough that the producer has not closed the pipe.
        + `sleep 0.7\n`
        + `[ -e dz/.lock ] && echo "lockfile=present" >> "${probe}" || echo "lockfile=absent" >> "${probe}"\n`
        + `DZ_LOCK_TIMEOUT_MS=0 "${node}" "${DZ_BIN}" add "made while stdin was open" >/dev/null 2>&1\n`
        + `echo "concurrent=$?" >> "${probe}"\n`
        // Proves the two checks above were taken against a command that is
        // genuinely still blocked, not one that had already finished.
        + `kill -0 $piped 2>/dev/null && echo "waiting=yes" >> "${probe}"\n`
        + `wait $piped\n`
        + `echo "piped=$?" >> "${probe}"\n`);
      fs.chmodSync(script, 0o755);

      execFileSync('/bin/sh', [script], {
        env: { ...process.env, DZ_AUTHOR: 'Test User <test@example.com>' },
        stdio: 'ignore',
      });

      const out = fs.readFileSync(probe, 'utf8');
      expect(out, 'the piped comment must still be blocked on stdin').toContain('waiting=yes');
      expect(out).toContain('lockfile=absent');
      expect(out).toContain('concurrent=0');
      expect(out).toContain('piped=0');
      // And the comment still lands once the pipe closes.
      const log = JSON.parse(dz(['show', id, '--json'], { cwd: dir }).stdout).log;
      expect(JSON.stringify(log)).toContain('from the pipe');
    });
  });
});
