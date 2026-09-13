#!/usr/bin/env node
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Builds the hermes-node staging tree. See
// docs/superpowers/specs/2026-09-13-hermes-node-design.md.
//
// The output is a fake node_modules at the repository root. That location is
// load-bearing twice over: the staged ditz2-ui shadows the real workspace
// symlink (which is ESM, and unloadable here), and resolution walking up from
// the staged files still reaches the checkout's own node_modules for
// commander, uuid and yaml, so no third-party package needs symlinking.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAGING = path.join(REPO, 'build-hermes');
const NM = path.join(STAGING, 'node_modules');

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function run(file, args) {
  execFileSync(file, args, { cwd: REPO, stdio: 'inherit' });
}

/** The staged ditz2: a plain tsc recompile, plus a generated manifest. */
function stageDitz2() {
  run(path.join(REPO, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.cjs.json']);
  // Generated rather than tracked, so it cannot drift from a hand-edited copy.
  write(
    path.join(NM, 'ditz2', 'package.json'),
    `${JSON.stringify({ name: 'ditz2', version: '0.0.0-staged', main: 'api/index.js' }, null, 2)}\n`,
  );
}

// The Node build first. Two checks compare against `dist/` -- one of them
// exists to catch a CJS emit landing there by mistake -- and `dist/` is
// gitignored, so a fresh clone has none. Leaving it to a remembered manual
// step is how that check quietly stops being testable.
run(path.join(REPO, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json']);

fs.rmSync(STAGING, { recursive: true, force: true });
// The nearest package.json walking up from the staged files. Without it they
// would inherit the repository's "type": "module" and fail to load as CJS.
write(
  path.join(STAGING, 'package.json'),
  `${JSON.stringify({ name: 'ditz2-hermes-staging', private: true, type: 'commonjs' }, null, 2)}\n`,
);
stageDitz2();
console.log(`staged ditz2 into ${path.relative(REPO, NM)}`);
