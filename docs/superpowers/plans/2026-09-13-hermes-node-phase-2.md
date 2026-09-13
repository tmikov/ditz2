# hermes-node Phase 2 Implementation Plan

**Goal:** `npm run hermes:dist` produces a single-file `dz` executable with the terminal UI inside it, needing no Node, no `node_modules`, and no hermes-node on the machine that runs it.

**Architecture:** Phase 1's staging tree is already the bundler's input. Phase 2 adds three steps on top: make the UI reachable to a static scanner, record and bake yoga's WebAssembly, and link the container into an executable.

**Spec:** `docs/superpowers/specs/2026-09-13-hermes-node-design.md`, "Phase 2, fixed in shape only".

**Prerequisite, already met:** phase 1 on `master` — `9b61896`, `d580c66`, `167ebc6`.

## Global Constraints

- `npm ci && npm test` stays Node-and-npm-only. New checks skip without their environment variable.
- `$HERMES_NODE` has no default. `$HERMES_KIT` defaults to `<dirname $HERMES_NODE>/../kit` and is overridable.
- Artifacts go to `build-hermes/dist/`, already gitignored via `build-hermes/`.
- Every check is made to fail on purpose before it is trusted (`CLAUDE.md`).
- Never write `sed -i` or `script` in a test; import from `tests/pty.ts`.

## Two spec assumptions this plan overrides, both measured

1. **Wasm recording does not need a pty.** The spec says recording needs "a real pty and a keypress to quit", copying `examples/ink`. It does not: the yoga shim starts `loadYoga()` at module load, so `require`-ing the staged bundle and waiting compiles the module. Measured — `--record-wasm` over a headless `require` produced `WASM (1) 257200 bytes sha256:31d7f3c29a1c86fb`. This matters beyond convenience: the build script cannot spell `script` itself without breaking `CLAUDE.md`'s rule that `tests/pty.ts` is the only place that decides it.

2. **`--include` is not needed.** Phase 1 deferred the literal-specifier change to here, and with it the scanner finds `ditz2-ui` unaided. Confirmed from the other side: a bundle built today, before Task 1, contains 144 modules and **none of them is `ditz2-ui`**, and the bundler warns that a computed specifier "resolves at run time only if the container already holds it".

---

### Task 1: spell the UI's name so the bundler can see it

**Files:**
- Modify: `src/cli/ui.ts` (one line)
- Create: `src/cli/ditz2-ui.d.ts`

`tsc` lowers `import(UI_PACKAGE)` to `require(s)` — a computed specifier no scanner can follow. Spelling it literally keeps the import dynamic, lazy and optional, and changes nothing on Node.

- [ ] **Step 1: make the change**

In `src/cli/ui.ts`, the call site becomes:

```ts
ctx.exitCode = await handOverToUi(ctx, isTty, () => import('ditz2-ui'));
```

`UI_PACKAGE` stays where it is — the error messages and the command description still use it. Update the comment above the call: it currently says the dynamic import is there so the package "is not a dependency and must not be bundled". That is still true of `ditz2`'s own published surface (`src/api/` never reaches `src/cli/ui.ts`), but the specifier is now visible to a bundler, so say what is actually true: it stays dynamic so the UI is optional and loads only on `dz ui`, and it is spelled literally so hermes-node's bundler can package it.

Create `src/cli/ditz2-ui.d.ts`:

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ditz2-ui` is an optional peer, not a dependency, so TypeScript cannot
 * resolve the literal specifier in ui.ts on a fresh clone — `ui/dist` does not
 * exist until ditz2 has been built, and ditz2's own typecheck would then
 * depend on a sibling workspace it does not depend on.
 *
 * Declaring it untyped costs nothing: `handOverToUi` takes
 * `() => Promise<unknown>` and `isUiModule` narrows the result at run time, so
 * the module's types were never used even when they resolved.
 */
declare module 'ditz2-ui';
```

- [ ] **Step 2: verify the typecheck both ways**

```bash
npm run typecheck                      # with ui/dist present
mv ui/dist /tmp/uidist.bak && npm run typecheck; echo "fresh-clone exit=$?"
mv /tmp/uidist.bak ui/dist
```

Expected: clean both times. Without the ambient declaration the second fails with `TS2307: Cannot find module 'ditz2-ui'` — that is the reason the file exists.

- [ ] **Step 3: confirm nothing on Node changed**

```bash
npx vitest run src/cli/ui.test.ts
env -u HERMES_NODE npm test; echo "exit=$?"
```

Expected: pass. `ui.test.ts` injects `importUi`, so the package-absent and wrong-shape paths are still covered.

- [ ] **Step 4: confirm the bundler can now see it, and watch the check fail**

```bash
export HERMES_NODE=…            # the release binary
npm run hermes
"$HERMES_NODE" --build-bundle=/tmp/probe.hbb build-hermes/node_modules/ditz2/cli/main.js
"$HERMES_NODE" --bundle=/tmp/probe.hbb --dump | grep -c ditz2-ui
```

Expected: at least 1, and no "computed specifier" warning during the build. Then revert `src/cli/ui.ts` to `import(UI_PACKAGE)`, rebuild, and confirm the count is 0 and the warning returns. Restore.

- [ ] **Step 5: commit**

```bash
git add src/cli/ui.ts src/cli/ditz2-ui.d.ts
git commit -m "spell ditz2-ui's name where the bundler can see it"
```

---

### Task 2: bundle, bake, link

**Files:**
- Modify: `scripts/hermes/build.mjs`
- Modify: `package.json` (add `hermes:dist`)

**Interfaces:** `build.mjs` already exports nothing and defines `REPO`, `STAGING`, `NM`, `write(file, data)`, `run(file, args)`. Phase 1's flow is: guard `$HERMES_NODE` → build `dist/` → wipe `STAGING` → `stageDitz2()` → `stageDitz2Ui()` → run `tests/hermes`.

- [ ] **Step 1: add the three steps behind a flag**

`npm run hermes` keeps its current meaning: stage and verify. `npm run hermes:dist` does that and then produces the artifacts. Gate on `process.argv.includes('--dist')`.

```js
/** The link kit that --build-exe needs, beside the binary in a cmake build. */
function kitDir() {
  if (process.env.HERMES_KIT) return process.env.HERMES_KIT;
  return path.join(path.dirname(path.dirname(process.env.HERMES_NODE)), 'kit');
}

/**
 * Record yoga's WebAssembly, bake it into the container, then link.
 *
 * Recording needs no terminal, contrary to what the design assumed. The yoga
 * shim starts loadYoga() at module load, so requiring the staged bundle and
 * waiting for the microtask queue compiles the module — which is also exactly
 * what tests/hermes/ui-bundle.test.ts already does. Without baking, Ink loads
 * the Wasm as its module graph loads, so every launch pays the whole compile.
 */
function buildDist() {
  const out = path.join(STAGING, 'dist');
  fs.mkdirSync(out, { recursive: true });
  const rec = path.join(STAGING, 'wasm-record.bin');
  const bundleEntry = path.join(NM, 'ditz2-ui', 'index.js');

  run(process.env.HERMES_NODE, [
    `--record-wasm=${rec}`, '--no-compile-cache',
    '-e', `require(${JSON.stringify(bundleEntry)}); setTimeout(function () {}, 2000);`,
  ]);

  run(process.env.HERMES_NODE, [
    `--build-bundle=${path.join(out, 'dz.hbb')}`,
    `--bake-wasm=${rec}`,
    path.join(NM, 'ditz2', 'cli', 'main.js'),
  ]);

  const kit = kitDir();
  if (!fs.existsSync(path.join(kit, 'kit.manifest'))) {
    throw new Error(
      `hermes build: no link kit at ${kit}. Set $HERMES_KIT, or build the ` +
      'hermes-node-kit target in the hermes-node checkout.',
    );
  }
  run(process.env.HERMES_NODE, [
    `--build-exe=${path.join(out, 'dz')}`, `--kit=${kit}`, path.join(out, 'dz.hbb'),
  ]);
}
```

Call it after `stageDitz2Ui()` and before the verification run, so the dist tests see the artifacts.

In `package.json`:

```json
"hermes:dist": "node scripts/hermes/build.mjs --dist"
```

- [ ] **Step 2: build it**

```bash
npm run hermes:dist
ls -l build-hermes/dist/
```

Expected: `dz.hbb` and an executable `dz`.

- [ ] **Step 3: commit**

```bash
git add scripts/hermes/build.mjs package.json
git commit -m "bundle the staged tree and link it into a standalone dz"
```

---

### Task 3: prove the binary is standalone

**Files:**
- Create: `tests/hermes/dist.test.ts`
- Modify: `scripts/hermes/build.mjs` (pass `DZ_DIST` when running the dist checks)

The failure to fear is a binary that builds, runs `dz list`, and prints "the terminal UI is a separate package" on `dz ui` — or one that works only because the checkout it was built in is still there.

Gate on `process.env.DZ_DIST`, set by `hermes:dist` to the built binary's path. That is honest: these checks run exactly when there is a binary to check, and `npm test` never needs one.

- [ ] **Step 1: write the failing test**

`tests/hermes/dist.test.ts`, with suites `describe.skipIf(!process.env.DZ_DIST)`:

```ts
const DZ = process.env.DZ_DIST ?? '';
const HBB = path.join(path.dirname(DZ), 'dz.hbb');
```

Assertions:

1. **The container holds the UI.** Run `$HERMES_NODE --bundle=<HBB> --dump`, assert the output matches `/ditz2-ui/`. This is the one that catches the whole class; nothing else would.
2. **The WebAssembly is baked.** Same dump, assert `/^WASM \((\d+)\)/m` captures a count `> 0`. Without `--bake-wasm` it is 0 and every launch recompiles.
3. **It runs with nothing around it.** Copy the binary to a fresh temp directory, run `dz init --name demo`, `dz add 'a packaged issue' --type task`, `dz list`, `dz show <id>` there, and assert the title round-trips. Run with `cwd` inside that directory and `env` stripped of `HERMES_NODE`.
4. **It does not need the checkout.** Rename `build-hermes/` aside for the duration of one run of the copied binary, confirm it still works, then restore. That is the difference between a bundle and a binary, and nothing else tests it.
5. **`dz ui` works inside it,** through a pty, reusing the shape phase 1 settled on: wait for the frame, send `?`, wait for the help marker, send Esc then `q`, assert exit 0 and that the exit follows the frame within a measured bound. Import `ptySpawn`/`shq` from `../pty.js`.

- [ ] **Step 2: run them and watch them fail**

Before Task 2's code exists, `DZ_DIST` is unset and they skip. Set it to a path that does not exist and confirm they fail rather than skip.

- [ ] **Step 3: wire the dist checks into the build**

In `build.mjs`, when `--dist` was passed, run vitest with `DZ_DIST` in the environment so building and verifying stay one command.

- [ ] **Step 4: make each check fail on purpose**

| sabotage | must fail |
|---|---|
| revert `src/cli/ui.ts` to `import(UI_PACKAGE)`, rebuild | assertion 1, and `dz ui` in assertion 5 prints the install hint |
| drop `--bake-wasm` from the bundle step | assertion 2 (`WASM (0)`) |
| delete `build-hermes/node_modules`, run the copied binary | assertion 4 must still pass — if it fails, the binary is not standalone |

Record what each did, restore between them, and confirm the suite passes afterwards.

- [ ] **Step 5: commit**

```bash
git add tests/hermes/dist.test.ts scripts/hermes/build.mjs
git commit -m "prove the linked dz runs with nothing around it"
```

---

## After

Update `HANDOFF.md`: phase 2 done, and the spec's two superseded assumptions (the pty for recording, `--include`) noted so nobody re-derives them.

Not in scope: shipping the binary anywhere, cross-compiling, or a `dzui` executable.
