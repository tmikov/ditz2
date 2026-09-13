/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Four of the five transformations over Ink, all at build time, none touching
// ditz2's own sources. Adapted from examples/ink/build.mjs in the hermes-node
// tree. The fifth -- row 1 of the table in
// docs/superpowers/specs/2026-09-13-hermes-node-design.md, the `yoga-layout`
// alias -- is not a source rewrite and lives in build.mjs's esbuild options;
// the numbering below is that table's, so the two can be read side by side.
//
// Rows 2-4 here are syntax: esbuild refuses to emit top-level await for a
// CommonJS target at all, so the build cannot be produced with them in place.
// They are NOT justified by the branch being dead, because it is not dead —
// isDev() really reads process.env.DEV. Row 5 is what makes it unreachable,
// and it is an Ink-specific patch rather than a build-wide `define` of
// process.env.DEV because a define applies to the entire bundled graph and
// turns every such read into the string "false", which is truthy.
//
// Two guards, because there are two ways an Ink bump can silently defeat this.
// Every replacement asserts its needle, so a file that changed *shape* fails
// the build instead of emitting something that compiles and misbehaves. And
// every rule set counts the loads it patched, so a file that moved or was
// renamed — which the needle guard cannot see, because esbuild simply never
// hands an unmatched path to onLoad — fails it too. Without the second, an
// Ink that relocates build/utils.js would ship a bundle with the DEV branch
// live and nothing would say so.

import fs from 'node:fs';

/** Rows 2-4 of the design's table: top-level awaits CJS cannot express. */
const RECONCILER = [
  { from: "await import('./devtools.js')", to: "import('./devtools.js')" },
  { from: 'await loadPackageJson()', to: 'loadPackageJson()' },
  { from: "const fs = await import('node:fs');", to: 'const fs = { readFileSync: () => \'{}\' };' },
];

/** Row 5: what makes the branch rows 2-4 de-await unreachable. */
const UTILS = [
  { from: "const isDev = () => process.env['DEV'] === 'true';", to: 'const isDev = () => false;' },
];

/**
 * The rule sets, each keyed by the Ink file it expects to be handed.
 *
 * `name` is what the failure messages print, so it is the path as a reader of
 * Ink would write it rather than the regex, which is escaped for both
 * separators and reads badly in an error.
 */
const RULES = [
  {
    name: 'ink/build/reconciler.js',
    filter: /ink[\\/]build[\\/]reconciler\.js$/,
    edits: RECONCILER,
  },
  {
    name: 'ink/build/utils.js',
    filter: /ink[\\/]build[\\/]utils\.js$/,
    edits: UTILS,
  },
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
    // replaceAll, not replace: a future Ink that says the same thing twice
    // would otherwise have one of the two left un-patched, and the needle
    // guard above -- which only asks whether the text is present -- would be
    // satisfied by the copy that was rewritten. The function replacement is
    // what keeps `$&`, `$1` and friends out of it: String.replace* gives `$`
    // special meaning in a string replacement but none in a returned one.
    out = out.replaceAll(from, () => to);
  }
  return out;
}

export default {
  name: 'ink-patches',
  setup(build) {
    // Per build, not per module load: esbuild calls setup once for each build,
    // and a process that builds twice must not have the second inherit the
    // first's counts and pass on them.
    const applied = new Map(RULES.map((r) => [r.name, 0]));
    for (const rule of RULES) {
      build.onLoad({ filter: rule.filter }, (args) => {
        applied.set(rule.name, applied.get(rule.name) + 1);
        return {
          contents: patch(args.path, fs.readFileSync(args.path, 'utf8'), rule.edits),
          loader: 'js',
        };
      });
    }
    build.onEnd(() => {
      for (const [name, count] of applied) {
        if (count > 0) continue;
        throw new Error(
          `hermes build: nothing matched ${name}, so its patches never ran.\n` +
          'Ink changed shape — the file moved or was renamed, so esbuild never ' +
          'handed it to the plugin and the needle guards had nothing to check. ' +
          'Update the filters in scripts/hermes/ink-patches.mjs to the new ' +
          'location before bundling this version.',
        );
      }
    });
  },
};
