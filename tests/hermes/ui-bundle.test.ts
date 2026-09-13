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
const BUNDLE = path.join(REPO, 'build-hermes', 'node_modules', 'ditz2-ui', 'index.js');
const HERMES = process.env.HERMES_NODE ?? '';

describe.skipIf(!process.env.HERMES_NODE)('the staged ditz2-ui bundle', () => {
  it('exports the runUi that dz ui looks for', () => {
    // Loaded under hermes-node, not node: this asserts the bundle parses and
    // evaluates on the engine that actually has to run it.
    const out = execFileSync(HERMES, [
      '-e',
      `const m = require(${JSON.stringify(BUNDLE)}); console.log(typeof m.runUi);`,
    ], { encoding: 'utf8' });
    expect(out.trim()).toBe('function');
  });

  /**
   * The decisive check for the Yoga barrier, and the reason it is a load and
   * not a grep.
   *
   * yoga-layout's entry is a top-level await, so the build aliases it to a
   * shim that returns a lazy proxy — and that proxy throws on any property
   * read before initYoga() resolves. So if anything in Ink's module graph
   * touches Yoga while the graph is still evaluating, requiring the bundle
   * throws right here. A grep for `Yoga.` cannot see that: a function holding
   * a Yoga access can be called during evaluation and still sit inside a
   * function body.
   */
  it('evaluates its whole module graph without touching Yoga', () => {
    const out = execFileSync(HERMES, [
      '-e',
      `require(${JSON.stringify(BUNDLE)}); console.log('LOADED');`,
    ], { encoding: 'utf8' });
    expect(out.trim()).toBe('LOADED');
  });

  it('resolves ditz2 to the staged CommonJS copy rather than embedding a second', () => {
    const text = fs.readFileSync(BUNDLE, 'utf8');
    expect(text).toContain('require("ditz2")');
  });

  // A cheap early warning, explicitly not the guarantee — that is the load
  // test above. Worth keeping because it names the failure on an Ink bump
  // instead of leaving a proxy throw to be diagnosed.
  it('has no Yoga access at module scope in the Ink it bundled', () => {
    const ink = path.join(REPO, 'node_modules', 'ink', 'build');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.js')) {
          for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
            if (/^(?:const|let|var|export|[A-Za-z])/.test(line) && line.includes('Yoga.')) {
              offenders.push(`${path.relative(ink, full)}: ${line.trim()}`);
            }
          }
        }
      }
    };
    walk(ink);
    expect(offenders).toEqual([]);
  });
});
