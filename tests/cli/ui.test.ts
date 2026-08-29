/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { dz, withTempProject } from '../helpers.js';

describe('dz ui', () => {
  it('declines without a terminal rather than rendering escape codes', () => {
    withTempProject((dir) => {
      dz(['init', '--name', 'demo'], { cwd: dir });
      // helpers.dz pipes all three stdio streams, so this is the no-tty case.
      const r = dz(['ui'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('needs an interactive terminal');
    });
  });

  it('rejects --json outright rather than painting a UI over it', () => {
    withTempProject((dir) => {
      dz(['init', '--name', 'demo'], { cwd: dir });
      const r = dz(['ui', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      const err = JSON.parse(r.stderr).error;
      expect(err.code).toBe('INVALID_FIELD');
      expect(err.message).toContain('no --json form');
    });
  });

  it('documents itself without ditz2-ui being loaded at all', () => {
    withTempProject((dir) => {
      // No dz init: --help must not need a project, and must not import Ink.
      const r = dz(['ui', '--help'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('Usage: dz ui');
      expect(r.stdout).toContain('ditz2-ui');
    });
  });
});
