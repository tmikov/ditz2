# hermes-node Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `dz` and `dz ui` both run under a `hermes-node` binary, driven from a build directory in this checkout, with ditz2 unchanged on Node.

**Architecture:** A build script stages a CommonJS copy of both packages into a gitignored `build-hermes/` whose fake `node_modules` shadows the real, ESM one. `tsc` handles ditz2's own sources; esbuild handles `ditz2-ui`, flattening Ink's ESM tree and patching its top-level awaits. No file under `src/` or `ui/src/` changes.

**Tech Stack:** TypeScript 5.9, esbuild (new devDependency), vitest 2.1, Ink 6.8 / React 19, hermes-node (external, located by `$HERMES_NODE`).

**Spec:** `docs/superpowers/specs/2026-09-13-hermes-node-design.md` — read it first; this plan argues from it.

## Global Constraints

- **No source changes.** Nothing under `src/` or `ui/src/` is edited by this plan. The literal-specifier change to `src/cli/ui.ts` belongs to phase 2.
- **`npm ci && npm test` stays Node-and-npm-only.** Every check added here skips when `$HERMES_NODE` is unset. A developer without a hermes-node build sees no new failures.
- **`$HERMES_NODE` has no default.** Unset is an error naming the variable, never a guessed path.
- **`string-width` stays below 8** — already enforced by `ui/tests/string-width-pin.test.ts`. Do not touch that pin.
- **Every check is made to fail on purpose before it is trusted** (`CLAUDE.md`). Each task below has an explicit sabotage step; none may be skipped.
- **Never write `sed -i` or `script` in a test.** Import from `tests/pty.ts` (`CLAUDE.md`).
- Node >= 20. Commit after each task.

---

### Task 1: Stage a CommonJS ditz2

Produces `build-hermes/node_modules/ditz2/`, runnable by plain `node` before hermes-node is involved at all.

**Files:**
- Create: `tsconfig.cjs.json`
- Create: `scripts/hermes/build.mjs`
- Create: `tests/hermes/staging.test.ts`
- Modify: `.gitignore`
- Modify: `package.json` (add the `hermes` script)

**Interfaces:**
- Consumes: nothing.
- Produces: `build-hermes/node_modules/ditz2/cli/main.js` (CommonJS CLI entry); `build-hermes/node_modules/ditz2/api/index.js` (CommonJS API entry); `scripts/hermes/build.mjs` exporting nothing, run as `node scripts/hermes/build.mjs`; a `STAGING` path constant re-derived in each test file as `<repo>/build-hermes`.

- [ ] **Step 1: Write the failing test**

Create `tests/hermes/staging.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch every case fail**

```bash
HERMES_NODE=/nonexistent npx vitest run tests/hermes/staging.test.ts
```

Expected: **4 failed, 1 passed**. The staging tree does not exist, so four
cases fail — but `left the ESM build in dist/ alone` reads only `dist/`, which
a built checkout already has, so it passes from the start. That is expected;
Step 7 is where that one is made to fail. Also confirm the gate works:

```bash
env -u HERMES_NODE npx vitest run tests/hermes/staging.test.ts
```

Expected: 5 skipped, exit 0.

- [ ] **Step 3: Add the CommonJS tsconfig**

Create `tsconfig.cjs.json`:

```json
{
  "//": [
    "Emits src/ as CommonJS into the hermes staging tree. hermes-node has no",
    "ES module loader yet and ditz2 is \"type\": \"module\", so its shipped",
    "dist/ cannot be loaded there.",
    "",
    "Five settings differ from tsconfig.json. module and moduleResolution move",
    "together: NodeNext resolution is not allowed with a CommonJS emit. outDir",
    "must move or the emit lands in dist/ and overwrites the Node build.",
    "declaration and sourceMap are off because this tree is an input to a",
    "bundler, not a published artifact.",
    "",
    "No source is patched to make this work: src/ contains no import.meta and",
    "no top-level await, either of which would have made this a rewrite."
  ],
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "build-hermes/node_modules/ditz2",
    "declaration": false,
    "sourceMap": false
  }
}
```

- [ ] **Step 4: Write the build script's first half**

Create `scripts/hermes/build.mjs`:

```js
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
```

- [ ] **Step 5: Ignore the staging tree and add the script**

Append to `.gitignore`, after the `dist/` line:

```
build-hermes/
```

In `package.json`, add to `scripts`:

```json
"hermes": "node scripts/hermes/build.mjs"
```

- [ ] **Step 6: Build and run the tests**

```bash
npm run hermes         # builds dist/ itself, then stages
HERMES_NODE=/nonexistent npx vitest run tests/hermes/staging.test.ts
```

Expected: 5 passed.

- [ ] **Step 7: Prove the outDir check can fail**

This is the check that matters most in this task, and it must be seen failing.

```bash
# Sabotage: drop the outDir override so the emit lands in dist/
python3 - <<'PY'
import json
c = json.load(open('tsconfig.cjs.json'))
del c['compilerOptions']['outDir']
json.dump(c, open('tsconfig.cjs.json','w'), indent=2)
PY
npm run hermes || true
HERMES_NODE=/nonexistent npx vitest run tests/hermes/staging.test.ts
```

Expected: `left the ESM build in dist/ alone` fails — `dist/cli/main.js` now
begins with `"use strict"` and has no top-level `import`.

Restore by hand, and restore **before** rebuilding. `tsconfig.cjs.json` is
untracked at this point in the task, so `git checkout` cannot bring it back,
and a rebuild with the sabotage still in place simply repeats it. Put the
`"outDir"` line from Step 3 back, then:

```bash
npm run hermes
HERMES_NODE=/nonexistent npx vitest run tests/hermes/staging.test.ts
```

Expected: 5 passed.

- [ ] **Step 8: Confirm the full suite is unaffected**

```bash
env -u HERMES_NODE npm test; echo "exit=$?"
```

Expected: exit 0, with `tests/hermes/staging.test.ts` reported as skipped.

- [ ] **Step 9: Commit**

```bash
git add tsconfig.cjs.json scripts/hermes/build.mjs tests/hermes/staging.test.ts .gitignore package.json
git commit -m "stage a CommonJS ditz2 for hermes-node"
```

---

### Task 2: Bundle the UI, with the Yoga barrier

Produces `build-hermes/node_modules/ditz2-ui/index.js`: Ink flattened to CommonJS, its top-level awaits patched out, and a wrapper that awaits Yoga before the first render.

**Files:**
- Create: `scripts/hermes/yoga-shim.mjs`
- Create: `scripts/hermes/ink-patches.mjs`
- Create: `tests/hermes/ui-bundle.test.ts`
- Modify: `scripts/hermes/build.mjs`
- Modify: `package.json` (add `esbuild` to devDependencies)

**Interfaces:**
- Consumes: `build-hermes/node_modules/ditz2/` from Task 1, and the `write`/`run`/`REPO`/`STAGING`/`NM` helpers already in `scripts/hermes/build.mjs`.
- Produces: `build-hermes/node_modules/ditz2-ui/index.js`, a CommonJS module exporting `runUi(opts: { cwd: string; env: Record<string, string | undefined> }): Promise<number>` — the same contract `src/cli/ui.ts`'s `isUiModule` checks for. `scripts/hermes/ink-patches.mjs` default-exports an esbuild plugin object.

- [ ] **Step 1: Write the failing test**

Create `tests/hermes/ui-bundle.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
: "${HERMES_NODE:?set it to a hermes-node binary}"
npx vitest run tests/hermes/ui-bundle.test.ts
```

Expected: 3 failed (the bundle does not exist), 1 passed (the module-scope grep, which reads `node_modules/ink` and is already true).

- [ ] **Step 3: Add esbuild**

```bash
npm install --save-dev --lockfile-version=2 esbuild@^0.28.2
```

Confirm the `string-width` pin survived:

```bash
npx vitest run ui/tests/string-width-pin.test.ts
```

Expected: 2 passed. If not, `npm install` re-resolved the tree — restore `package-lock.json` from git and add esbuild by editing `devDependencies` directly, then `npm install --lockfile-version=2` again.

- [ ] **Step 4: Write the Yoga shim**

Create `scripts/hermes/yoga-shim.mjs`:

```js
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
```

- [ ] **Step 5: Write the Ink patches**

Create `scripts/hermes/ink-patches.mjs`:

```js
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
```

- [ ] **Step 6: Extend the build script**

In `scripts/hermes/build.mjs`, add to the imports:

```js
import * as esbuild from 'esbuild';
import inkPatches from './ink-patches.mjs';
```

Add this function after `stageDitz2`:

```js
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

  await esbuild.build({
    entryPoints: [entry],
    outfile: path.join(NM, 'ditz2-ui', 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // Shared with the CLI half rather than embedded twice; resolved at run
    // time from the staged sibling.
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

  write(
    path.join(NM, 'ditz2-ui', 'package.json'),
    `${JSON.stringify({ name: 'ditz2-ui', version: '0.0.0-staged', main: 'index.js' }, null, 2)}\n`,
  );
}
```

Change the tail of the file from `stageDitz2();` to:

```js
stageDitz2();
await stageDitz2Ui();
console.log(`staged ditz2 and ditz2-ui into ${path.relative(REPO, NM)}`);
```

- [ ] **Step 7: Build and run the tests**

```bash
npm run hermes
: "${HERMES_NODE:?set it to a hermes-node binary}"
npx vitest run tests/hermes/ui-bundle.test.ts
```

Expected: 4 passed.

- [ ] **Step 8: Prove the Yoga barrier check can fail**

The load assertion is the only thing standing between this design and a `dz ui`
that throws at its first frame. Sabotage Ink so a Yoga access runs during module
evaluation, and confirm the check catches it.

```bash
cp node_modules/ink/build/styles.js /tmp/styles.js.bak
printf '\nconst _probe = Yoga.EDGE_ALL;\n' >> node_modules/ink/build/styles.js
npm run hermes
: "${HERMES_NODE:?set it to a hermes-node binary}"
npx vitest run tests/hermes/ui-bundle.test.ts
```

Expected: `evaluates its whole module graph without touching Yoga` fails, with
`yoga-layout accessed before initYoga() resolved` in the error output. The
module-scope grep test should also fail, which is the early warning doing its
job. Restore and re-verify:

```bash
cp /tmp/styles.js.bak node_modules/ink/build/styles.js && rm /tmp/styles.js.bak
npm run hermes
: "${HERMES_NODE:?set it to a hermes-node binary}"
npx vitest run tests/hermes/ui-bundle.test.ts
```

Expected: 4 passed.

- [ ] **Step 9: Prove the needle assertions can fail**

```bash
cp node_modules/ink/build/utils.js /tmp/utils.js.bak
python3 - <<'PY'
p = 'node_modules/ink/build/utils.js'
s = open(p).read().replace("process.env['DEV'] === 'true'", "process.env.DEV === 'true'")
open(p, 'w').write(s)
PY
npm run hermes
```

Expected: the build fails with `hermes build: expected text not found in .../utils.js`, naming the needle. Restore:

```bash
cp /tmp/utils.js.bak node_modules/ink/build/utils.js && rm /tmp/utils.js.bak
npm run hermes
```

Expected: builds cleanly.

- [ ] **Step 10: Confirm the full suite is unaffected**

```bash
env -u HERMES_NODE npm test; echo "test exit=$?"
env -u HERMES_NODE npm run test:ui; echo "test:ui exit=$?"
```

Expected: `npm test` exits 0, `tests/hermes/` skipped. Read both statuses from
`echo`, never through a pipe — `| tail` reports `tail`'s status and would hide
a failed build or typecheck inside `test:ui`.

`test:ui` may exit non-zero. That is acceptable **only** if every failure is in
`ui/tests/e2e.test.ts` on `expect(r.timedOut).toBe(false)`, the pty flake
recorded in `HANDOFF.md`. Establish that by name rather than by count:

```bash
env -u HERMES_NODE npx vitest run --root ui --exclude 'tests/e2e.test.ts'
```

Expected: all pass. A failure outside that one file means this task broke it.

- [ ] **Step 11: Commit**

```bash
git add scripts/hermes/yoga-shim.mjs scripts/hermes/ink-patches.mjs scripts/hermes/build.mjs tests/hermes/ui-bundle.test.ts package.json package-lock.json
git commit -m "bundle ditz2-ui to CommonJS, with a barrier before Yoga is read"
```

---

### Task 3: Run it under hermes-node

Produces the launcher and the checks that `dz` and `dz ui` actually work on the target engine.

**Files:**
- Create: `scripts/hermes/dz`
- Create: `tests/hermes/run.test.ts`
- Modify: `scripts/hermes/build.mjs` (verify after building)
- Modify: `CLAUDE.md` (the toolchain carve-out)

**Interfaces:**
- Consumes: everything from Tasks 1 and 2; `ptySpawn` and `shq` from `tests/pty.ts`.
- Produces: `scripts/hermes/dz`, an executable shell script taking `dz`'s own arguments.

- [ ] **Step 1: Write the failing test**

Create `tests/hermes/run.test.ts`:

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ptySpawn, shq } from '../pty.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DZ = path.join(REPO, 'scripts', 'hermes', 'dz');

let tmp: string;

const ENV = { ...process.env, DZ_AUTHOR: 'Test User <test@example.com>' };

/** `scripts/hermes/dz` in a throwaway directory, which is the whole point. */
function dz(args: string[], cwd: string): string {
  return execFileSync(DZ, args, { cwd, encoding: 'utf8', env: ENV });
}

describe.skipIf(!process.env.HERMES_NODE)('dz under hermes-node', () => {
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-hermes-'));
    dz(['init', '--name', 'demo'], tmp);
  });
  afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // Run from a directory that is not the checkout. A relative entry path in
  // the launcher fails here, and so does a launcher that cd's into the repo —
  // it would act on ditz2's own backlog instead of this project.
  it('initialises a project in the callers directory, not the checkout', () => {
    expect(fs.existsSync(path.join(tmp, 'dz', 'config.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(REPO, 'dz', 'config.yaml'))).toBe(true);
  });

  it('adds an issue that list and show can both find', () => {
    const added = dz(['add', 'a hermes issue', '--type', 'task'], tmp);
    const id = added.trim().split(/\s+/)[1];
    expect(id).toMatch(/^[0-9a-f-]{13}$/);
    expect(dz(['list'], tmp)).toContain('a hermes issue');
    expect(dz(['show', id], tmp)).toContain('a hermes issue');
  });

  it('writes issue files the Node build reads back identically', () => {
    // Adds its own issue rather than leaning on the test above. Run alone
    // this would otherwise compare two empty lists and pass without
    // exercising persistence at all.
    const added = dz(['add', 'compared across engines', '--type', 'task'], tmp);
    const id = added.trim().split(/\s+/)[1];
    const files = fs.readdirSync(path.join(tmp, 'dz', 'issues'));
    expect(files.some((f) => f.startsWith(id))).toBe(true);

    const underNode = execFileSync(
      process.execPath,
      [path.join(REPO, 'dist', 'cli', 'main.js'), 'list', '--json'],
      { cwd: tmp, encoding: 'utf8', env: ENV },
    );
    const hermes = JSON.parse(dz(['list', '--json'], tmp)) as Array<{ title: string }>;
    expect(hermes.map((i) => i.title)).toContain('compared across engines');
    expect(hermes).toEqual(JSON.parse(underNode));
  });
});

interface UiRun {
  out: string;
  code: number | null;
  sawFrame: boolean;
  aliveAtKeypress: boolean;
}

describe.skipIf(!process.env.HERMES_NODE)('dz ui under hermes-node', () => {
  it('renders a frame, is still running, and exits 0 when q is pressed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-hermes-ui-'));
    try {
      execFileSync(DZ, ['init', '--name', 'demo'], { cwd: dir, env: ENV });
      execFileSync(DZ, ['add', 'visible in the ui', '--type', 'task'],
        { cwd: dir, env: ENV });

      const env = { ...ENV, TERM: 'xterm-256color', COLUMNS: '100', LINES: '30' };
      const { file, args } = ptySpawn(`${shq(DZ)} ui`, { cols: '100', rows: '30' });

      const r = await new Promise<UiRun>((resolve) => {
        const child = spawn(file, args, { cwd: dir, env });
        let out = '';
        let sawFrame = false;
        let aliveAtKeypress = false;
        const kill = setTimeout(() => { child.kill('SIGKILL'); }, 25_000);

        child.stdout?.on('data', (d: Buffer) => {
          out += d.toString();
          if (sawFrame || !out.includes('visible in the ui')) return;
          sawFrame = true;
          // Keyed off the frame, not off a fixed delay. A timer either beats
          // a slow start, or lets a UI that exits by itself pass every
          // assertion without ever handling the key.
          aliveAtKeypress = child.exitCode === null;
          child.stdin?.write('q');
          // EOF goes separately, and later. BSD `script` pushes an EOT into
          // the pty when its own input ends, so closing stdin in the same
          // breath can deliver end-of-input ahead of the keystroke and exit
          // the UI down a different path than the one under test — the
          // `a)bort: ^Df` shape `CLAUDE.md` describes. The close is still
          // needed: on macOS `ptySpawn` interposes a `cat` whose pipeline
          // outlives the command otherwise.
          setTimeout(() => { child.stdin?.end(); }, 500);
        });
        child.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
        child.on('exit', (code) => {
          clearTimeout(kill);
          resolve({ out, code, sawFrame, aliveAtKeypress });
        });
      });

      expect(r.sawFrame).toBe(true);
      // Without this, a UI that drew one frame and fell over would pass.
      expect(r.aliveAtKeypress).toBe(true);
      expect(r.out).not.toContain('initYoga');
      expect(r.code).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
: "${HERMES_NODE:?set it to a hermes-node binary}"
npx vitest run tests/hermes/run.test.ts
```

Expected: every case fails — `scripts/hermes/dz` does not exist (ENOENT).

- [ ] **Step 3: Write the launcher**

Create `scripts/hermes/dz`:

```bash
#!/bin/bash
# Copyright (c) 2026 Tzvetan Mikov
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.
#
# Runs the staged CommonJS ditz2 under hermes-node.
#
# The entry path is absolute and derived from this script's own location, and
# this script deliberately does not cd: every dz command acts on the caller's
# working directory, so changing it would point dz at the wrong project, and a
# relative entry path would not be found from anywhere but the checkout.

set -e

if [ -z "$HERMES_NODE" ]; then
  echo "ERROR: \$HERMES_NODE is not set." 1>&2
  echo "  It must name a hermes-node binary; there is no default, because a" 1>&2
  echo "  path into one developer's checkout is worse than an error." 1>&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ENTRY="$REPO/build-hermes/node_modules/ditz2/cli/main.js"

if [ ! -f "$ENTRY" ]; then
  echo "ERROR: no staging tree at $ENTRY -- run 'npm run hermes' first." 1>&2
  exit 2
fi

exec "$HERMES_NODE" "$ENTRY" "$@"
```

Make it executable:

```bash
chmod +x scripts/hermes/dz
```

- [ ] **Step 4: Run the tests**

```bash
npm run hermes
: "${HERMES_NODE:?set it to a hermes-node binary}"
npx vitest run tests/hermes/run.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Prove the launcher checks can fail**

Two sabotages, because two different mistakes are being guarded against.

Note what these two do **not** establish. Both break `dz init` in `beforeAll`,
so the whole suite goes red — and a setup failure is not evidence that the
`add`, `list`, `show` or cross-engine assertions can fail. Those get their own
targeted mutations in Step 6.

```bash
# (a) relative entry path
cp scripts/hermes/dz /tmp/dz.bak
sed -i 's|^ENTRY=.*|ENTRY="build-hermes/node_modules/ditz2/cli/main.js"|' scripts/hermes/dz
: "${HERMES_NODE:?set it to a hermes-node binary}"
npx vitest run tests/hermes/run.test.ts
```

Expected: failures — the entry is not found from the throwaway directory.

```bash
# (b) the cd that points dz at the wrong project
cp /tmp/dz.bak scripts/hermes/dz
sed -i 's|^exec "\$HERMES_NODE"|cd "$REPO"\nexec "$HERMES_NODE"|' scripts/hermes/dz
: "${HERMES_NODE:?set it to a hermes-node binary}"
# Read-only, and deliberately NOT the test suite. With the cd in place every
# dz command acts on this checkout's own tracked backlog, and the suite's
# commands write: pointing it here would add issues to dz/issues/, and a
# cleanup step that follows the same wrong path can delete them. Proving the
# bug needs one read.
DZ_ABS="$PWD/scripts/hermes/dz"
SCRATCH="$(mktemp -d)"
( cd "$SCRATCH" && "$DZ_ABS" list --json ) | head -c 400; echo
rmdir "$SCRATCH"
```

Expected: the listing shows **this repository's** issues rather than the empty
scratch project — that is the `cd` bug, visible without writing anything. The
matching assertion in the suite is `initialises a project in the caller's
directory`, which fails for the same reason when the suite is run; do not run
it with this sabotage in place.

Restore and re-verify:

```bash
cp /tmp/dz.bak scripts/hermes/dz && chmod +x scripts/hermes/dz && rm /tmp/dz.bak
: "${HERMES_NODE:?set it to a hermes-node binary}"
npx vitest run tests/hermes/run.test.ts
```

Expected: 4 passed.

Note: `sed -i` is used here on a working file, not from a generated `$EDITOR`
script or a pty runner, so the portability rule in `CLAUDE.md` does not apply.
On macOS use `sed -i ''` instead.

- [ ] **Step 6: Prove the individual assertions can fail**

Step 5 only proved that a broken launcher breaks everything. Each assertion
that carries its own claim needs its own mutation, or it is a check nobody has
seen fail. Run these one at a time, restoring between each.

**(a) `show` against an id that was never added.** Temporarily change the
`show` line in `tests/hermes/run.test.ts` to an id that does not exist:

```ts
    expect(dz(['show', '01a00000-0000'], tmp)).toContain('a hermes issue');
```

Expected: that test fails — `dz show` exits non-zero with `no issue matches id
prefix`, so `execFileSync` throws. Restore the line.

**(b) the cross-engine comparison, against a divergence.** Change the expected
title in the comparison test to one that was never added:

```ts
    expect(hermes.map((i) => i.title)).toContain('never written');
```

Expected: that test fails on the title assertion, not on the deep-equal.
Restore.

**(c) the UI missing entirely — the failure this whole task exists to catch.**
A `dz ui` that prints the install hint instead of rendering is the outcome that
would otherwise look like success:

```bash
mv build-hermes/node_modules/ditz2-ui /tmp/ditz2-ui.bak
: "${HERMES_NODE:?set it to a hermes-node binary}"
npx vitest run tests/hermes/run.test.ts
mv /tmp/ditz2-ui.bak build-hermes/node_modules/ditz2-ui
```

Expected: the pty test fails on `sawFrame` — the transcript carries *the
terminal UI is a separate package* instead of a frame. Restore and re-run:
4 passed.

**(d) the Yoga barrier's await, which no earlier check covers.** Task 2's load
tests never call `runUi`, so deleting the await from the generated wrapper
would sail past them. This is the only check that can catch it:

```bash
cp scripts/hermes/build.mjs /tmp/build.mjs.bak
sed -i 's/await initYoga(); //' scripts/hermes/build.mjs
npm run hermes || true
: "${HERMES_NODE:?set it to a hermes-node binary}"
npx vitest run tests/hermes/run.test.ts
cp /tmp/build.mjs.bak scripts/hermes/build.mjs && rm /tmp/build.mjs.bak
npm run hermes
```

Expected while sabotaged: the pty test fails, with `yoga-layout accessed before
initYoga() resolved` in the captured output — which is also why the test
asserts `out` does not contain `initYoga`. If it instead passes, the barrier is
not being exercised and the wrapper's await is not load-bearing; stop and work
out why before continuing, because that would mean the design's central claim
is wrong. After restoring: 4 passed.

- [ ] **Step 7: Make the build verify itself**

A skipped check is a check that has never failed, so building and verifying
become one command. Append to `scripts/hermes/build.mjs`:

```js
// Building and verifying are one command on purpose: tests/hermes/ skips
// itself without $HERMES_NODE, and a suite that only ever skips is not a
// check. Running it here means every build exercises it.
if (process.env.HERMES_NODE === undefined || process.env.HERMES_NODE === '') {
  console.error('ERROR: $HERMES_NODE is not set; it must name a hermes-node binary.');
  process.exit(2);
}
run(path.join(REPO, 'node_modules', '.bin', 'vitest'), ['run', 'tests/hermes']);
```

Move that `$HERMES_NODE` guard to the **top** of the file, before `fs.rmSync`,
so an unset variable fails before anything is deleted.

- [ ] **Step 8: Verify the build gate**

```bash
env -u HERMES_NODE npm run hermes; echo "exit=$?"
```

Expected: exit 2, the error naming `$HERMES_NODE`, and `build-hermes/` still
intact from the previous build.

```bash
npm run hermes; echo "exit=$?"
```

Expected: exit 0, with the `tests/hermes` suites run and passing.

- [ ] **Step 9: Document the toolchain carve-out**

In `CLAUDE.md`, immediately after the paragraph beginning "Any Node >= 20 and
the public npm registry", add:

```markdown
One exception: `npm run hermes` builds ditz2 to run under
[hermes-node](https://github.com/tmikov/hermes-node-compat), and needs a
`hermes-node` binary named by `$HERMES_NODE`. That is not on npm and cannot be
obtained by `npm ci`. Nothing else in this repository needs it, and
`tests/hermes/` skips itself when the variable is unset, so `npm ci && npm test`
stays Node-and-npm-only. See
`docs/superpowers/specs/2026-09-13-hermes-node-design.md`.
```

- [ ] **Step 10: Confirm the full suite is unaffected**

```bash
env -u HERMES_NODE env -u HERMES_NODE npm test; echo "exit=$?"
```

Expected: exit 0, `tests/hermes/` reported as skipped.

- [ ] **Step 11: Commit**

```bash
git add scripts/hermes/dz scripts/hermes/build.mjs tests/hermes/run.test.ts CLAUDE.md
git commit -m "run dz and dz ui under hermes-node"
```

---

## After the plan

Update `HANDOFF.md`: phase 1 done, phase 2 (bundling plus Wasm baking, which
ship together) still open, and the literal-specifier change to `src/cli/ui.ts`
still deferred to it.

Do not start phase 2 from this plan. It gets its own.
