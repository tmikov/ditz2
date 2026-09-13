/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Why `string-width` is held below 8, and what happens when it is not.
 *
 * Ink 6.5.0 bumped `string-width` from 7 to 8, and `string-width@8` matches
 * graphemes with `/^\p{RGI_Emoji}$/v`. `RGI_Emoji` is a property of *strings*,
 * which only the ES2024 `v` flag can express, so — unlike the other `/v`
 * regexes in that dependency tree — it cannot be rewritten to `/u`. Hermes
 * does not implement `v`, and this is a parse error rather than a runtime one,
 * so the whole bundle fails to compile before a line of it runs:
 *
 *     SyntaxError: Invalid regular expression: Invalid flags
 *
 * That matters because `dz` ships as a single hermes-node binary, and `dz ui`
 * hands over to this package inside it. Nothing in *this* suite would notice:
 * under node, `string-width@8` is fine, and the UI renders identically either
 * way — measured, on a frame of ZWJ family, skin-tone and CJK text, as
 * byte-identical output between the two majors. So the pin has no local
 * symptom at all, which is exactly why it needs a test: a routine dependency
 * refresh that dropped it would go green here and break the binary.
 *
 * Two independent things hold it, and both are checked, because either one
 * failing alone is silent. The `overrides` entry in the root `package.json`
 * decides a fresh resolution; the lockfile decides `npm ci`. Drop the override
 * and `npm ci` keeps working from the lock until someone regenerates it.
 */
describe('the string-width pin that keeps Ink bundleable by hermes-node', () => {
  const require = createRequire(import.meta.url);

  /** A package's own manifest, found without depending on `exports` to expose it. */
  function manifestOf(name: string, from: string): { name?: string; version?: string } {
    const entry = createRequire(from).resolve(name);
    let dir = path.dirname(entry);
    for (;;) {
      const file = path.join(dir, 'package.json');
      if (fs.existsSync(file)) {
        const meta = JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: string };
        if (meta.name === name) return meta;
      }
      const up = path.dirname(dir);
      if (up === dir) throw new Error(`no manifest for ${name} above ${entry}`);
      dir = up;
    }
  }

  it('resolves string-width below 8 for Ink itself', () => {
    // Resolved from Ink's own entry, not from this test file: what the bundler
    // walks is Ink's view of the tree, and a hoisted copy beside the tests
    // would say nothing about a nested one beside Ink.
    const version = manifestOf('string-width', require.resolve('ink')).version ?? '';
    expect(version).toMatch(/^\d+\./);
    expect(Number(version.split('.')[0])).toBeLessThan(8);
  });

  it('declares the override that survives a lockfile regeneration', () => {
    const root = JSON.parse(
      fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { overrides?: Record<string, string> };
    expect(root.overrides?.['string-width']).toBe('^7.2.0');
  });
});
