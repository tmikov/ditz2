/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';

/**
 * What ditz2's exports map actually does when the importer is ditz2-ui.
 *
 * Resolution passing says nothing about the declarations existing: this repo
 * has already shipped a packed-tarball check that verified imports worked and
 * private paths were blocked while the .d.ts files it existed to check were
 * absent. Hence the third test.
 *
 * The second and third tests resolve through `createRequire(...).resolve`
 * rather than `import.meta.resolve`/dynamic `import()`. Vitest runs test
 * files through its own module runner, whose `import.meta` has no `.resolve`
 * and whose dynamic `import()` re-implements exports-map resolution with its
 * own error text instead of Node's `ERR_PACKAGE_PATH_NOT_EXPORTED`. `require`
 * from `createRequire` is Node's real resolver, called directly, so these
 * checks reflect what Node actually does rather than vitest's approximation.
 */
describe('the ditz2 package boundary', () => {
  const require = createRequire(import.meta.url);

  it('resolves the public entry', async () => {
    const api = await import('ditz2');
    expect(typeof api.openProject).toBe('function');
    expect(typeof api.shortId).toBe('function');
    expect(typeof api.applyFilter).toBe('function');
    expect(typeof api.matchIssues).toBe('function');
  });

  it('ships the type declarations the entry advertises', () => {
    const entry = require.resolve('ditz2');
    expect(entry.endsWith('.js')).toBe(true);
    expect(fs.existsSync(entry.replace(/\.js$/, '.d.ts'))).toBe(true);
  });

  it('refuses the private internals', () => {
    // Asserted on `.code`, not a `.message` regex: Node's message text for
    // this error does not contain the code string, only `.code` and
    // `.toString()` do.
    const blocked = 'ditz2/dist/store/lock.js';
    let error: NodeJS.ErrnoException | undefined;
    try {
      require.resolve(blocked);
    } catch (e) {
      error = e as NodeJS.ErrnoException;
    }
    expect(error?.code).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });
});
