/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DZ_BIN = path.resolve(here, '..', 'dist', 'cli', 'main.js');

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Runs the BUILT binary. Unit tests cannot catch runtime-only faults; this can.
 *
 * spawnSync rather than execFileSync because the latter only hands back stdout.
 * This used to report `stderr: ''` for every command that exited 0, which made
 * each `expect(r.stderr).toBe('')` on a successful run assert nothing at all.
 */
export function dz(args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; input?: string }): RunResult {
  const r = spawnSync(process.execPath, [DZ_BIN, ...args], {
    cwd: opts.cwd,
    encoding: 'utf8',
    input: opts.input ?? '',
    env: { ...process.env, DZ_AUTHOR: 'Test User <test@example.com>', ...opts.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? 1 };
}

export function withTempProject<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-cli-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
