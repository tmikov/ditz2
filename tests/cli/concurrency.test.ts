/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import YAML from 'yaml';
import { DZ_BIN, dz } from '../helpers.js';

/**
 * Real concurrent processes, which is the only way to test the lock end to end.
 * Everything else in the suite runs commands one at a time, so it can show that
 * the lock is taken but never that it prevents a lost update.
 */

const execFileAsync = promisify(execFile);

interface Run { stdout: string; stderr: string; code: number }

function spawnDz(args: string[], cwd: string): Promise<Run> {
  return execFileAsync(process.execPath, [DZ_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      DZ_AUTHOR: 'Test User <test@example.com>',
      // Generous: these deliberately contend, and a timeout here would be a
      // slow machine rather than a bug.
      DZ_LOCK_TIMEOUT_MS: '30000',
    },
  }).then(
    (r) => ({ stdout: r.stdout, stderr: r.stderr, code: 0 }),
    (e: { stdout?: string; stderr?: string; code?: number }) =>
      ({ stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }),
  );
}

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-conc-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('concurrent writers', () => {
  it('keeps every comment when eight processes write the same issue at once', async () => {
    await withDir(async (dir) => {
      dz(['init', '--name', 'race'], { cwd: dir });
      const id = JSON.parse(dz(['add', 'contended', '--json'], { cwd: dir }).stdout)
        .id.slice(0, 13);

      const writers = Array.from({ length: 8 }, (_, i) =>
        spawnDz(['comment', id, '-m', `writer-${i}`], dir));
      const results = await Promise.all(writers);

      // Without the lock these interleave and later writers overwrite earlier
      // ones, so the count is the whole point of the test.
      for (const r of results) expect(r.code).toBe(0);

      const shown = JSON.parse(dz(['show', id, '--json'], { cwd: dir }).stdout);
      const bodies = JSON.stringify(shown.log);
      for (let i = 0; i < 8; i += 1) {
        expect(bodies).toContain(`writer-${i}`);
      }
    });
  }, 60_000);

  it('leaves a valid config when two processes first-init the same directory', async () => {
    await withDir(async (dir) => {
      const [a, b] = await Promise.all([
        spawnDz(['init', '--name', 'alpha'], dir),
        spawnDz(['init', '--name', 'bravo'], dir),
      ]);

      // Both are legitimate: init is idempotent, and the loser of the race
      // simply finds the config already written.
      expect(a.code).toBe(0);
      expect(b.code).toBe(0);

      // The failure this guards against is a truncated or interleaved file,
      // not which name won.
      const raw = fs.readFileSync(path.join(dir, 'dz', 'config.yaml'), 'utf8');
      const parsed = YAML.parse(raw) as { name: string; components: unknown[] };
      expect(['alpha', 'bravo']).toContain(parsed.name);
      expect(parsed.components).toEqual([]);

      expect(dz(['doctor', '--json'], { cwd: dir }).code).toBe(0);
    });
  }, 60_000);

});
