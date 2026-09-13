/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Five transformations over Ink, all at build time, none touching ditz2's own
// sources. Adapted from examples/ink/build.mjs in the hermes-node tree.
//
// Rows 1-3 here are syntax: esbuild refuses to emit top-level await for a
// CommonJS target at all, so the build cannot be produced with them in place.
// They are NOT justified by the branch being dead, because it is not dead —
// isDev() really reads process.env.DEV. Row 4 is what makes it unreachable,
// and it is an Ink-specific patch rather than a build-wide `define` of
// process.env.DEV because a define applies to the entire bundled graph and
// turns every such read into the string "false", which is truthy.
//
// Every replacement asserts its needle first. An Ink bump that changes shape
// then fails the build loudly instead of emitting something that compiles and
// misbehaves.

import fs from 'node:fs';

const RECONCILER = [
  { from: "await import('./devtools.js')", to: "import('./devtools.js')" },
  { from: 'await loadPackageJson()', to: 'loadPackageJson()' },
  { from: "const fs = await import('node:fs');", to: 'const fs = { readFileSync: () => \'{}\' };' },
];

const UTILS = [
  { from: "const isDev = () => process.env['DEV'] === 'true';", to: 'const isDev = () => false;' },
];

function patch(file, contents, edits) {
  let out = contents;
  for (const { from, to } of edits) {
    if (!out.includes(from)) {
      throw new Error(
        `hermes build: expected text not found in ${file}:\n  ${from}\n` +
        'Ink changed shape. Update scripts/hermes/ink-patches.mjs — and check ' +
        'for new top-level awaits — before bundling this version.',
      );
    }
    out = out.replace(from, to);
  }
  return out;
}

export default {
  name: 'ink-patches',
  setup(build) {
    build.onLoad({ filter: /ink[\\/]build[\\/]reconciler\.js$/ }, (args) => ({
      contents: patch(args.path, fs.readFileSync(args.path, 'utf8'), RECONCILER),
      loader: 'js',
    }));
    build.onLoad({ filter: /ink[\\/]build[\\/]utils\.js$/ }, (args) => ({
      contents: patch(args.path, fs.readFileSync(args.path, 'utf8'), UTILS),
      loader: 'js',
    }));
  },
};
