/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Shim for yoga-layout's top-level await. Adapted from examples/ink/
// yoga-shim.mjs in the hermes-node tree; that is where this recipe was worked
// out, and a divergence between the two is worth investigating rather than
// papering over.
//
// yoga-layout's "." entry is `const Yoga = wrapAssembly(await loadYoga())`,
// which CommonJS cannot express and esbuild will not emit for a "cjs" target.
// The package also exposes "./load", the same object behind an async function,
// so the alias points here and initialisation becomes explicit.
//
// The import below is by relative path on purpose: esbuild's alias for a
// package name also rewrites that package's subpaths, so importing
// 'yoga-layout/load' here would resolve back to this file and recurse.
import { loadYoga } from '../../node_modules/yoga-layout/dist/src/load.js';

let real = null;
const pending = loadYoga().then((yoga) => {
  real = yoga;
  return yoga;
});

/** Awaited by the generated wrapper before the first render. */
export function initYoga() {
  return pending;
}

// Throwing rather than returning undefined is what makes the barrier
// testable: a bundle that touches Yoga while its module graph is still
// evaluating fails at require() instead of misrendering later.
const proxy = new Proxy({}, {
  get(_target, prop) {
    if (real === null) {
      throw new Error('yoga-layout accessed before initYoga() resolved');
    }
    return real[prop];
  },
});

export default proxy;
