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
import * as esbuild from 'esbuild';
import inkPatches from './ink-patches.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAGING = path.join(REPO, 'build-hermes');
const NM = path.join(STAGING, 'node_modules');

// Checked before anything else runs, and in particular before
// fs.rmSync(STAGING) below: an unset $HERMES_NODE must fail loud, leaving the
// previous staging tree intact, rather than deleting it and only then
// discovering there is no way to verify -- or use -- what replaces it.
if (process.env.HERMES_NODE === undefined || process.env.HERMES_NODE === '') {
  console.error('ERROR: $HERMES_NODE is not set; it must name a hermes-node binary.');
  process.exit(2);
}

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

/**
 * The staged ditz2-ui: the UI, React and Ink flattened into one CommonJS file.
 *
 * The entry is a generated wrapper rather than ui/src/index.tsx, because
 * runUi() calls render() synchronously and the Yoga proxy throws on any read
 * before initYoga() resolves. Phase 1 changes no source, so the barrier lives
 * here in build output.
 *
 * The wrapper imports the shim through the bare 'yoga-layout' specifier, the
 * same one the alias rewrites for Ink's own imports, so both reach one module
 * identity. Two identities would mean awaiting one proxy while Ink reads
 * another, and the second throws.
 */
async function stageDitz2Ui() {
  const entry = path.join(STAGING, 'ui-entry.mjs');
  const uiSrc = path.join(REPO, 'ui', 'src', 'index.tsx');
  write(entry, [
    "import {initYoga} from 'yoga-layout';",
    `import {runUi as inner} from ${JSON.stringify(uiSrc)};`,
    'export async function runUi(opts) { await initYoga(); return inner(opts); }',
    '',
  ].join('\n'));

  // `write: false` is not an optimisation. esbuild writes the outfile before
  // plugins' onEnd hooks run, so a build failed by the path-drift guard in
  // ink-patches.mjs would still leave a complete, unpatched bundle on disk —
  // and that bundle loads: CommonJS falls back to index.js when a directory
  // has no package.json, so the whole of tests/hermes/ passes against it while
  // the build that produced it exited 1. Holding the bytes in memory and
  // writing them here means nothing lands unless every rule fired.
  const built = await esbuild.build({
    entryPoints: [entry],
    outfile: path.join(NM, 'ditz2-ui', 'index.js'),
    write: false,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // `ditz2` is shared with the CLI half rather than embedded twice; it is
    // resolved at run time from the staged sibling. `react-devtools-core` is
    // never resolved at all: Ink imports it only from the `isDev()` branch
    // that ink-patches.mjs rewrites to `false`, it is not a dependency of this
    // project, and leaving it in the graph would fail the bundle at build time
    // over code that cannot run.
    external: ['ditz2', 'react-devtools-core'],
    alias: { 'yoga-layout': path.join(REPO, 'scripts', 'hermes', 'yoga-shim.mjs') },
    plugins: [inkPatches],
    // Stated rather than left to tsconfig discovery. esbuild looks for the
    // nearest tsconfig to each file, and the entry is a generated wrapper in
    // build-hermes/ rather than under ui/ — close enough to work by accident
    // and to stop working for a reason nobody would look for. ui/tsconfig.json
    // sets "jsx": "react-jsx" with React as the import source, which is what
    // 'automatic' means here.
    jsx: 'automatic',
    jsxImportSource: 'react',
    logLevel: 'warning',
  });

  for (const out of built.outputFiles) write(out.path, out.contents);

  write(
    path.join(NM, 'ditz2-ui', 'package.json'),
    `${JSON.stringify({ name: 'ditz2-ui', version: '0.0.0-staged', main: 'index.js' }, null, 2)}\n`,
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
await stageDitz2Ui();
console.log(`staged ditz2 and ditz2-ui into ${path.relative(REPO, NM)}`);

// Building and verifying are one command on purpose: tests/hermes/ skips
// itself without $HERMES_NODE, and a suite that only ever skips is not a
// check. Running it here means every build exercises it.
run(path.join(REPO, 'node_modules', '.bin', 'vitest'), ['run', 'tests/hermes']);
