/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { DzError } from '../core/errors.js';
import type { CliContext } from './context.js';
import { handOverToUi } from './ui.js';

function ctx(): CliContext {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd: '/tmp', env: {},
    stdout: { write: (s: string) => { out.push(s); return true; } } as never,
    stderr: { write: (s: string) => { err.push(s); return true; } } as never,
    json: false, exitCode: 0,
  };
}

/** The failure Node raises for a package that is not installed. */
function notFound(specifier: string): Error {
  const err = new Error(`Cannot find package '${specifier}' imported from /x/y.js`);
  (err as NodeJS.ErrnoException).code = 'ERR_MODULE_NOT_FOUND';
  return err;
}

describe('dz ui handover', () => {
  it('runs the UI and returns its exit code', async () => {
    const code = await handOverToUi(ctx(), true, async () => ({
      runUi: async () => 7,
    }));
    expect(code).toBe(7);
  });

  it('prints an install hint when ditz2-ui is absent', async () => {
    try {
      await handOverToUi(ctx(), true, () => Promise.reject(notFound('ditz2-ui')));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('NOT_FOUND');
      expect((err as DzError).message).toContain('npm i -g ditz2-ui');
      // Until ditz2 is published that command fails on its dependency, so the
      // hint has to say where the working instructions are.
      expect((err as DzError).message).toContain('ui/README.md');
    }
  });

  it('does not claim ditz2-ui is missing when one of its deps is', async () => {
    // Same errno, different package. Reporting "npm i -g ditz2-ui" here sends
    // the operator to reinstall something that is already installed.
    try {
      await handOverToUi(ctx(), true, () => Promise.reject(notFound('ink')));
      expect.unreachable('should have thrown');
    } catch (err) {
      // Positively, not just by absence. `expect.unreachable` throws an
      // ordinary Error whose message satisfies a bare `.not.toContain(...)`,
      // so the negative assertion alone passes even when handOverToUi
      // swallows the error and returns — proven by breaking it exactly that
      // way. Naming 'ink' is what makes this a real check.
      expect((err as Error).message).toContain("'ink'");
      expect((err as DzError | Error).message).not.toContain('npm i -g ditz2-ui');
    }
  });

  it('refuses without a terminal, before importing anything', async () => {
    let imported = false;
    try {
      await handOverToUi(ctx(), false, async () => { imported = true; return {}; });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
      expect((err as DzError).message).toContain('terminal');
    }
    // Not merely an ordering preference: importing Ink pulls 38 packages and
    // ~23 MB off disk to then refuse.
    expect(imported).toBe(false);
  });

  it('rejects a ditz2-ui that does not export runUi', async () => {
    await expect(handOverToUi(ctx(), true, async () => ({ nope: 1 })))
      .rejects.toThrow(DzError);
  });
});
