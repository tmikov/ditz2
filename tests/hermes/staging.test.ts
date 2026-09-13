/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAGED = path.join(REPO, 'build-hermes', 'node_modules', 'ditz2');

/**
 * The staged CommonJS tree, checked with plain `node` rather than hermes-node.
 *
 * Everything here is about the module format and the emit target, which are
 * decided by `tsc` and are the same whichever engine runs the result. Testing
 * it under node means these fail for an engineer who has not built hermes-node
 * yet, and fail on the actual mistake rather than on a missing binary.
 *
 * Gated on `$HERMES_NODE` all the same, because the staging tree only exists
 * once `scripts/hermes/build.mjs` has run, and that script is for people
 * building the hermes artifact. Absent staging with the variable set is a
 * failure, not a skip: a silently skipped check is one that has never failed.
 */
describe.skipIf(!process.env.HERMES_NODE)('the staged CommonJS ditz2', () => {
  it('was built at all', () => {
    expect(fs.existsSync(path.join(STAGED, 'cli', 'main.js'))).toBe(true);
  });

  it('is CommonJS, not ESM', () => {
    const text = fs.readFileSync(path.join(STAGED, 'cli', 'main.js'), 'utf8');
    expect(text).toContain('require(');
    expect(text).not.toMatch(/^import /m);
  });

  it('runs under plain node and reports the version', () => {
    const out = execFileSync(process.execPath, [path.join(STAGED, 'cli', 'main.js'), '--version'], {
      encoding: 'utf8',
    });
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // The regression this exists for: the root tsconfig sets "outDir": "dist",
  // so a CJS config that inherits it emits CommonJS over the Node build and
  // breaks `dz` for everyone. Asserting dist/ is still ESM catches that, and
  // nothing else in either suite would.
  it('left the ESM build in dist/ alone', () => {
    const text = fs.readFileSync(path.join(REPO, 'dist', 'cli', 'main.js'), 'utf8');
    expect(text).toMatch(/^import /m);
  });

  it('declares itself commonjs so node does not read the root package type', () => {
    const own = JSON.parse(fs.readFileSync(path.join(STAGED, 'package.json'), 'utf8')) as
      { name?: string; main?: string };
    expect(own.name).toBe('ditz2');
    expect(own.main).toBe('api/index.js');
    const root = JSON.parse(
      fs.readFileSync(path.join(REPO, 'build-hermes', 'package.json'), 'utf8'),
    ) as { type?: string };
    expect(root.type).toBe('commonjs');
  });
});
