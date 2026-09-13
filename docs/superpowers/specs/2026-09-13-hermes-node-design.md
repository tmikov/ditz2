# Design: running ditz2 under hermes-node, and shipping it as one file

**Status:** Draft for review, 2026-09-13.

ditz2 must keep working on Node exactly as it does today. On top of that it
should run under [hermes-node][hn], and eventually ship as a single
distributable executable with the terminal UI inside it.

Everything asserted below was measured against this tree, using the release
`hermes-node` present at `cmake-build-release/bin/hermes-node` on 2026-09-12.
Where something was not measured, it says so.

[hn]: https://github.com/tmikov/hermes-node-compat

## The two phases

**Phase 1 — run under hermes-node.** `dz` and `dz ui` both work when driven by
a `hermes-node` binary, from a build directory in this checkout. No bundle, no
executable.

**Phase 2 — one distributable file.** `--build-bundle` then `--build-exe`, with
yoga-layout's WebAssembly baked into the container. These two land together:
a bundle that still recompiles the Wasm at every launch defeats the point of
bundling, so neither ships alone.

This document specifies phase 1 in full and fixes the shape of phase 2. Phase
2 gets its own plan when phase 1 is done.

## What is actually in the way

Three obstacles, and only the first two matter for phase 1.

**hermes-node has no ES module loader.** `2026-08-25-esm-ast-transform-design.md`
in the hermes-node tree is still a draft, so CommonJS is the only route today.
ditz2 is `"type": "module"`, so its shipped `dist/` cannot be loaded; the
sources must be recompiled with `module: commonjs`.

This is cheap, because **neither `src/` nor `ui/src/` contains a single
`import.meta` or top-level await** — verified by grep over both trees. A plain
`tsc` with two changed settings covers all of ditz2. No source is rewritten.

The three runtime dependencies all expose CommonJS through a `require`
condition (`commander` 14, `uuid` 11, `yaml` 2), so they need nothing.

**Ink is ESM and its tree has top-level awaits.** `ditz2-ui` depends on Ink,
which `require()` cannot load, and whose dependency `yoga-layout` uses a
top-level await that CommonJS cannot express. This is the one place a build
step rewrites third-party code, and it is confined to `scripts/hermes/`.

**The `dz ui` handover is invisible to a static scanner.** `src/cli/ui.ts`
loads the UI through `import(UI_PACKAGE)`, a variable, which `tsc` lowers to
`require(s)`. A bundler cannot follow that. **This matters only in phase 2**;
at run time hermes-node resolves it like any other require.

## Phase 1

### The staging tree

The build writes a gitignored `build-hermes/` at the repository root:

```
build-hermes/
  package.json                     {"type": "commonjs", "private": true}
  node_modules/
    ditz2/
      package.json                 {"name": "ditz2", "main": "api/index.js"}
      api/ cli/ core/ render/ store/      ← tsc, module: commonjs
    ditz2-ui/
      package.json                 {"name": "ditz2-ui", "main": "index.js"}
      index.js                     ← esbuild: ui/src + Ink, ditz2 external
```

**Why a fake `node_modules` rather than a plain output directory.** The UI must
be reachable under the literal name `ditz2-ui`, because that is the name
`src/cli/ui.ts` asks for. The real `node_modules/ditz2-ui` is a workspace
symlink to `ui/`, whose `package.json` is `"type": "module"` with `main`
pointing at the ESM build — the one thing hermes-node cannot load. Staging a
CommonJS `ditz2-ui` closer to the entry point shadows it by ordinary Node
resolution.

**Why at the repository root specifically.** Resolution walks upward from the
importing file, so from
`build-hermes/node_modules/ditz2/core/id.js` it reaches
`build-hermes/node_modules` (finding the staged `ditz2-ui`) and then the
checkout's own `node_modules` (finding `commander`, `uuid` and `yaml`). No
symlinking of third-party packages is needed, and the staged packages win
because they are nearer.

### Steps

1. `tsc -p tsconfig.cjs.json` emits `src/` into
   `build-hermes/node_modules/ditz2/`. That config `extends` the root
   `tsconfig.json` and overrides five settings: `module: commonjs` and
   `moduleResolution: node`, which must move together because NodeNext
   resolution is not allowed with a CommonJS emit; `outDir`, because the root
   config points at `dist/` and inheriting it would emit CommonJS **over the
   Node build**; and `declaration: false` with `sourceMap: false`, since the
   staged tree is a bundler input and not a published artifact.
2. The script writes the two staged `package.json` files. They are generated,
   never tracked, so they cannot drift from a hand-edited copy.
3. esbuild bundles a **generated wrapper** (see "The Yoga barrier" below) to
   `build-hermes/node_modules/ditz2-ui/index.js` — `--format=cjs
   --platform=node`, with `ditz2` marked external so both halves of the
   program share one copy of it rather than embedding a second. The wrapper,
   not `ui/src/index.tsx`, is the entry point.
4. `scripts/hermes/dz` derives the checkout root from its own location
   (`BASH_SOURCE`) and runs `"$HERMES_NODE" <abs>/build-hermes/node_modules/ditz2/cli/main.js "$@"`.
   The path must be absolute and the script must **not** `cd`: every `dz`
   command acts on `process.cwd()`, so changing directory would point it at
   the wrong project, and a relative entry path would simply not be found —
   the verification below runs from a throwaway directory, which is exactly
   the case that catches both mistakes.

### The Yoga barrier

`yoga-layout`'s entry is a top-level await, so the build aliases the package to
a shim that starts initialisation once and hands back a lazy proxy. **That
proxy throws on any property read before initialisation resolves**, so
something must await it before the first render — and `runUi` in
`ui/src/index.tsx` calls `render()` synchronously, awaiting only
`waitUntilExit()` afterwards.

Phase 1 changes no source, so the barrier goes in generated build output. The
esbuild entry is a wrapper written into `build-hermes/`:

```js
import {initYoga} from 'yoga-layout';          // aliased to the shim
import {runUi as inner} from '<repo>/ui/src/index.tsx';
export async function runUi(opts) { await initYoga(); return inner(opts); }
```

Two things make this correct, and both must hold:

- **One shim instance.** Both imports must resolve to the same module
  identity; two identities mean `initYoga()` initialises one proxy while Ink
  reads another, and the second throws. The bare `yoga-layout` specifier is
  the reliable way to get that, being exactly what esbuild rewrites for Ink's
  own imports. A file path *may* resolve to the same module and dedupe — the
  hazard is distinct resolved identities, not file paths as such — but the
  shim already imports `yoga-layout/dist/src/load.js` by relative path
  precisely because the alias also rewrites subpaths, so the neighbourhood is
  one where specifiers and identities come apart easily. Prescribe the bare
  specifier and do not rely on dedupe.
- **No Yoga access during module evaluation.** Static imports run before the
  wrapper's body, so anything touching Yoga while Ink's module graph loads
  beats the barrier.

  A grep is **not** sufficient to establish this, and the design does not
  claim it is. Every `Yoga.` reference in Ink 6.8.0's build output is inside a
  function body and none at module scope — checked, because the shim's comment
  claims it only for 6.4.0 — but a function *containing* a Yoga access can
  still be called during evaluation:

  ```js
  function initialize() { return Yoga.Config.create(); }
  initialize();          // passes the grep, beats the barrier
  ```

  So the grep is kept only as a cheap early warning on an Ink bump. The
  guarantee comes from evaluation-time behaviour: the build `require()`s the
  staged bundle and asserts it loads without throwing, which is decisive
  because the shim's proxy throws on any read before `initYoga()` resolves.
  The pty check then covers first render. Per `CLAUDE.md`, neither is trusted
  until made to fail on purpose — by adding a module-scope Yoga call to a
  scratch copy of Ink and confirming the load assertion catches it.

### The Ink patches

**Five transformations**, all inside the esbuild step, all on third-party
code: one module alias, three syntax rewrites, and one behavioural patch.

| # | what | kind | why |
| --- | --- | --- | --- |
| 1 | alias `yoga-layout` to a local shim | alias | its entry is `await loadYoga()`, which CommonJS cannot express; the package also exports `yoga-layout/load`, so a lazily-initialised proxy works. Unrelated to the `DEV` branch — see "The Yoga barrier". |
| 2 | drop the `await` on `import('./devtools.js')` | syntax | top-level await in `ink/build/reconciler.js`, inside a branch gated on `isDev()` |
| 3 | drop the `await` on `loadPackageJson()` | syntax | same file, same branch, present from Ink 6.5 |
| 4 | replace `await import('node:fs')` inside `loadPackageJson` | syntax | a dynamic import Hermes cannot parse, in that same branch |
| 5 | rewrite `isDev` in `ink/build/utils.js` to `() => false` | behaviour | makes rows 2–4's branch unreachable |

Rows 2–4 are needed whatever the branch does: esbuild refuses to emit
top-level await for a CommonJS target at all, so the build cannot even be
produced with those awaits in place. They are **not** justified by the branch
being dead, because it is not dead — `isDev` is really
`() => process.env['DEV'] === 'true'`, so `DEV=true` reaches it, and there the
de-awaited `loadPackageJson()` hands back a Promise where an object is
expected. Row 5 is what makes it unreachable. *Unreachable*, not *eliminated*:
nothing here proves esbuild drops a branch guarded by a function call, and the
design does not depend on it doing so.

This is deliberately an Ink-specific patch rather than a build-wide
`define` of `process.env.DEV`. A define applies to the entire bundled graph,
turning every such read into the string `"false"` — which is truthy, so any
consumer writing `if (process.env.DEV)` would take the wrong branch. Nothing
in `src/` or `ui/src/` reads it today, but the blast radius of a define is the
whole dependency tree and it is not worth the reach.

**Every patch asserts its needle is present and throws if it is not.** This is
the whole defence against a future Ink bump silently changing shape: the build
fails loudly instead of emitting something that compiles and misbehaves. The
recipe is adapted from `examples/ink/build.mjs` in the hermes-node tree, and
the file says so, because a second copy of a rule that can drift from the first
is a known hazard in this repository.

`queueMicrotask`, which `react-reconciler` 0.33 calls, was missing from
hermes-node and stopped Ink at load. It is present as of the 2026-09-12 build
and needs no stub.

### `string-width` is already pinned

`string-width` 8 matches graphemes with `/^\p{RGI_Emoji}$/v`. `RGI_Emoji` is a
property of strings, so the `v` flag cannot be rewritten to `u`, and Hermes
rejects it at parse time — the whole program fails to compile before a line of
it runs. An `overrides` entry in the root `package.json` holds it at `^7.2.0`,
and `ui/tests/string-width-pin.test.ts` guards both that entry and the resolved
version. That work is already done; it is recorded here because it is a
precondition for everything above.

### New dependency

`esbuild` is added to the root `package.json` `devDependencies`. It is the only
new package, it is a build-time tool that nothing at runtime imports, and
`npm ci` must install it — relying on it arriving transitively through some
other dependency would put the build's availability outside this project's
control.

### Finding hermes-node

`$HERMES_NODE` must name the binary. There is no default path: a default that
silently points at one developer's checkout is worse than an error, and this
repository is public. Unset, the script fails with the variable name and one
line on what it wants.

This is the one part of ditz2 that cannot be built with Node and npm alone.
`CLAUDE.md`'s toolchain promise gets an explicit carve-out saying so, naming
`scripts/hermes/` as the only thing affected.

### Verification

The failure this must not have is a green build whose `dz ui` prints *"the
terminal UI is a separate package"* — working software by every check except
the one that matters.

The checks live in `tests/hermes/`, as vitest files whose every suite is
`describe.skipIf(!process.env.HERMES_NODE)`. They assert, driving the real
`$HERMES_NODE` binary against the staged tree:

- `dz init`, `dz add`, `dz list`, `dz show` in a throwaway directory. Output
  is **not** diffed against a Node run — ids and timestamps make that
  meaningless. Each command is asserted on what is stable: that `add` writes a
  file under `dz/issues/`, that `list` contains the title it was given, and
  that `show` on the id `add` returned reads that title back.
- `dz ui` driven through a pty, asserting a rendered frame appears and that
  `q` exits 0. `tests/pty.ts` already decides the GNU/BSD spelling of
  `script`, and is imported rather than duplicated — which is the reason these
  are vitest files rather than shell in `scripts/hermes/`.

**They are skipped, not absent, when `$HERMES_NODE` is unset**, so
`npm ci && npm test` stays Node-and-npm-only on every platform and a developer
without a hermes-node build sees no new failures. A skipped check is a check
that has never failed, so `scripts/hermes/build` ends by running vitest over
`tests/hermes/` with `$HERMES_NODE` already in the environment: building and
verifying are one command, and the skip cannot quietly become permanent.

Before any of these is trusted it is made to fail on purpose — the `dz ui`
check against a staging tree with `ditz2-ui` removed, the `show` check against
an id that was never added.

## Phase 2, fixed in shape only

Bundling makes the computed `require` a problem, because `--build-bundle`
collects what it can see and the variable hides the UI. Two remedies were
measured, and both work:

- `--include=ditz2-ui` names it explicitly. It packages the module and its
  whole transitive require graph, and resolves with `node_modules` deleted.
- Spelling the specifier literally — `import('ditz2-ui')` — lets the scanner
  find it unaided. Still dynamic, still lazy, still optional; identical
  behaviour on Node.

**The literal is chosen**, with a one-line `declare module 'ditz2-ui';` so that
a fresh clone can typecheck before `ui/` has been built. Without that
declaration `tsc` resolves the literal specifier, fails to find `ui/dist`, and
errors — measured. The published `exports` map reaches only `src/api/`, which
never imports `src/cli/ui.ts`, so nothing a consumer can legitimately import is
made heavier by the change.

That change belongs to phase 2 rather than phase 1 because the check that
proves it works — asserting `--dump` lists `ditz2-ui` — is a phase 2 artifact,
and a change whose verification does not yet exist should not be made.

Phase 2 also bakes yoga's WebAssembly with `--record-wasm` and `--bake-wasm`.
Ink loads the Wasm as its module graph loads, so an unbaked bundle pays the
whole compile at every launch. Recording needs a real pty and a keypress to
quit, the same shape the `dz ui` check in phase 1 already needs.

## What is deliberately not done

- **No dual publish.** The published package stays ESM-only and its `exports`
  map is untouched. CommonJS exists only inside `build-hermes/`.
- **No second copy of ditz2 in the UI bundle.** `ditz2` stays external to the
  esbuild step.
- **No conditional compilation in `src/`.** A second code path selected at
  build time would be exercised only by the binary, which is precisely where
  it could rot unseen.
- **Nothing is written to `hermes-node-compat`.** Its `examples/ditz2` builds
  from a submodule pin and is not this.

## When the ESM loader lands

All of `scripts/hermes/` and `tsconfig.cjs.json` are deletable that day, and
the entry point becomes the shipped `dist/`. The Ink patches go too, being
workarounds for a CommonJS emit rather than for Hermes itself. Only the
`string-width` pin outlives it, because the `v` flag is an engine gap and not
a module-format one.
