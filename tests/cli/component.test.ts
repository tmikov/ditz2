/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { dz, withTempProject } from '../helpers.js';

function project<T>(fn: (dir: string) => T): T {
  return withTempProject((dir) => {
    dz(['init', '--name', 'demo'], { cwd: dir });
    return fn(dir);
  });
}
const listed = (dir: string): string[] =>
  JSON.parse(dz(['component', 'list', '--json'], { cwd: dir }).stdout).components;

describe('dz component', () => {
  it('starts empty, which is what made --component unusable before', () => {
    project((dir) => {
      expect(listed(dir)).toEqual([]);
      expect(dz(['component', 'list'], { cwd: dir }).stdout).toContain('no components');
    });
  });

  it('adds components and keeps them sorted', () => {
    project((dir) => {
      dz(['component', 'add', 'store'], { cwd: dir });
      dz(['component', 'add', 'cli'], { cwd: dir });
      expect(listed(dir)).toEqual(['cli', 'store']);
    });
  });

  it('makes --component usable without hand-editing yaml', () => {
    project((dir) => {
      // This is the whole point: before, this rejected every value.
      expect(dz(['add', 'x', '--component', 'cli'], { cwd: dir }).code).toBe(1);
      dz(['component', 'add', 'cli'], { cwd: dir });
      expect(dz(['add', 'x', '--component', 'cli'], { cwd: dir }).code).toBe(0);
    });
  });

  it('is idempotent on add, so a rerun is not an error', () => {
    project((dir) => {
      dz(['component', 'add', 'cli'], { cwd: dir });
      const r = dz(['component', 'add', 'cli'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(listed(dir)).toEqual(['cli']);
    });
  });

  it('rejects an empty name', () => {
    project((dir) => {
      expect(dz(['component', 'add', '   ', '--json'], { cwd: dir }).code).toBe(1);
    });
  });

  it('refuses to remove a component still in use, naming the issues', () => {
    project((dir) => {
      dz(['component', 'add', 'cli'], { cwd: dir });
      dz(['add', 'uses cli', '--component', 'cli'], { cwd: dir });

      const r = dz(['component', 'rm', 'cli', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      const err = JSON.parse(r.stderr).error;
      expect(err.code).toBe('INVALID_FIELD');
      expect(err.message).toContain('uses cli');
      expect(err.message).toContain('--force');
      expect(listed(dir)).toEqual(['cli']);
    });
  });

  it('removes it anyway with --force, which doctor then reports', () => {
    project((dir) => {
      dz(['component', 'add', 'cli'], { cwd: dir });
      dz(['add', 'uses cli', '--component', 'cli'], { cwd: dir });

      expect(dz(['component', 'rm', 'cli', '--force'], { cwd: dir }).code).toBe(0);
      expect(listed(dir)).toEqual([]);
      const problems = JSON.parse(dz(['doctor', '--json'], { cwd: dir }).stdout).problems;
      expect(problems.some((p: { code: string }) => p.code === 'UNKNOWN_COMPONENT')).toBe(true);
    });
  });

  it('removes an unused component without complaint', () => {
    project((dir) => {
      dz(['component', 'add', 'cli'], { cwd: dir });
      expect(dz(['component', 'rm', 'cli'], { cwd: dir }).code).toBe(0);
      expect(listed(dir)).toEqual([]);
    });
  });

  it('errors on removing one that does not exist, since that is a typo', () => {
    project((dir) => {
      dz(['component', 'add', 'cli'], { cwd: dir });
      const r = dz(['component', 'rm', 'nope', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('NOT_FOUND');
    });
  });

  it('leaves the rest of config.yaml alone', () => {
    project((dir) => {
      dz(['component', 'add', 'cli'], { cwd: dir });
      const cfg = fs.readFileSync(path.join(dir, 'dz', 'config.yaml'), 'utf8');
      expect(cfg).toContain('name: demo');
    });
  });
});
