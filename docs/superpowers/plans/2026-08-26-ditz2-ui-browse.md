# ditz2-ui, plan 2a: browsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only full-screen terminal UI for ditz2 — browse, filter,
read and refresh a backlog — as a separate `ditz2-ui` package that the core CLI
hands over to via `dz ui`.

**Architecture:** A new npm workspace at `ui/`, depending on `ink`, `react` and
the already-published `ditz2` public entry. All state lives in one pure reducer
(`ui/src/state.ts`) driven by one `useInput` handler; rendering is a handful of
Ink components that build their lines as plain strings so tests can assert on
them. The filter field is parsed by a pure function into a `Filter` plus a regex
and applied **in memory** against the snapshot, never by re-reading the disk.
`dz ui` in the core CLI is a tty check plus a dynamic `import('ditz2-ui')` and
is the only place core mentions the UI package.

**Tech Stack:** TypeScript (NodeNext, strict), Ink 6.8.0, React 19.2.8,
`ink-testing-library` 4.0.0, vitest 2.1.9, npm workspaces.

## Global Constraints

Copied from `docs/superpowers/specs/2026-08-25-ditz2-tui-design.md` and
`CLAUDE.md`. Every task's requirements implicitly include this section.

- **The core CLI keeps its dependencies.** `ditz2`'s `dependencies` stay exactly
  `commander`, `uuid`, `yaml`. `ink` and `react` are dependencies of `ditz2-ui`
  only, and `ditz2` must never depend on `ditz2-ui`.
- **`ditz2-ui` imports only `'ditz2'`.** `ditz2/dist/core/...`,
  `ditz2/dist/store/...` and `ditz2/dist/render/...` are private and blocked by
  the `exports` map. If the UI needs something from them, re-export it from
  `src/api/index.ts` — never reach past the map, and never copy the code.
- **Anything the TUI can do, `dz` can already do.** A TUI feature needing a new
  *operation* means the operation belongs in ditz2 with a CLI verb. (Task 1 adds
  no operations: it exposes pure functions over data the facade already returns,
  plus two facts it already resolves internally.)
- **The facade is synchronous.** Do not wrap it in promises.
- **`lockTimeoutMs: 0`, always.** The UI opens its project with
  `openProject(cwd, { env, lockTimeoutMs: 0 })`. A synchronous lock wait blocks
  Ink's event loop completely — no repaint, no keystrokes, no Ctrl-C. Plan 2a
  performs no writes, so nothing should ever raise `LOCKED`; the setting is here
  so that it is already right when plan 2b adds mutations.
- **Selection is tracked by issue id, never by list index.**
- **No filesystem watching.** The snapshot refreshes at startup and on `r`.
- **Node toolchain:** any Node >= 20 and the public npm registry.
- **Commit messages are `ditz2: <what changed>`**, or `ditz2-ui:` for a change
  under `ui/`. Every commit in this repository's history uses the package-name
  prefix; conventional-commits `feat(...)` would be a new style introduced by
  this plan alone.
- **Lint must be clean:** `the formatter and linter` before every commit.
- **New files get the MIT copyright header** (copy the 6-line block from any
  existing `src/*.ts`) and a trailing newline. Unix line endings only.
- **Comment only non-obvious invariants.** Do not restate what the code does and
  do not explain the change being made.
- **Make every check fail on purpose before you trust it.** Every task below has
  a "Step: prove the test can fail" — do not skip it, and do not substitute
  reasoning about why it would fail.

## Deviations from the spec

Two of the spec's stated facts do not hold on this machine. Both were checked
against the registry on 2026-08-26, and neither is worked around silently.

**Ink 7.1.1 cannot run here.** The spec measured `ink@7.1.1`, but that release
declares `engines: { node: ">=22" }`, this development host runs Node 21.4.0, and
`ditz2` promises `>=20`. `npm install` would warn `EBADENGINE` and install it
anyway, which is the shape of failure this project has already been bitten by
twice — a green install that cannot run in the deployment environment. The plan
uses `ink@6.8.0`, which declares `>=20` and takes the same React 19 peer.

This also puts an asterisk on the spec's spike results, which were recorded
against Ink 7: "suspend to `$EDITOR` works without unmount" and "unmount then
rerender does not resume" are load-bearing for **plan 2b**, not for this plan,
and should be re-run on Ink 6 before 2b is written. Nothing in plan 2a depends
on them.

**`npm i -g ditz2-ui` cannot work yet.** `ditz2` is unpublished — the registry
returns `E404 'ditz2@latest' is not in this registry` — so a global install of
`ditz2-ui` cannot resolve its `ditz2@^0.1.0` dependency. Inside this repository
the npm workspace symlinks it and everything works, which is what every test
here exercises.

Task 3 keeps the spec's two lines of hint text verbatim and appends one more
pointing at `ui/README.md`, because a hint whose only advice is a command that
cannot succeed is worse than no hint. Task 10's READMEs document the
build-from-clone flow. **Publishing both packages is out of scope for this
plan** and is the gate on both the hint's third line and the READMEs' second
half going away.

## Assumption to confirm during review

`assignee:me` in the filter field expands to the **email part** of the resolved
author when the author is in `Name <email>` form, and to the whole string
otherwise. This is a guess: `applyFilter` compares `issue.assignee` exactly, the
author is stored as `Name <email>`, and the tutorial's example
(`dz set --assignee jane@example.com`) shows a bare email — so matching the full
author string would almost never hit. Task 4 implements the email-part rule and
tests both forms. If it is wrong, it is a two-line change in `ui/src/query.ts`.

---

## What already exists

Read these before starting; the plan assumes them.

| | |
| --- | --- |
| The approved design | `docs/superpowers/specs/2026-08-25-ditz2-tui-design.md` |
| The facade this builds on | `src/api/index.ts`, `read.ts`, `write.ts`, `filter.ts` |
| The rules this project's defects earned | `CLAUDE.md` |
| Current state | `HANDOFF.md` |

`ditz2` is at the repo root and today exports exactly one path (`.` →
`dist/api/index.js`). `Project` has `root`, `list`, `show`, `grep`, `add`, `set`,
`comment`, `close`, `components`, `doctor`, `lock`, `readForEdit`, `parseEdit`,
`saveEdited`. Plan one shipped it; 366 tests pass.

## File structure

**Modified in `ditz2` (the root package):**

| File | Responsibility |
| --- | --- |
| `src/api/filter.ts` | gains `matchIssues`, `compilePattern`, `matchesRe` — the single copy of the grep match rule |
| `src/api/read.ts` | `grepIssues` stops carrying its own copy of that rule |
| `src/api/session.ts` | unchanged |
| `src/api/index.ts` | re-exports `shortId`, `applyFilter`, `matchIssues`; `Project` gains `name` and `whoami()` |
| `src/api/api.test.ts` | tests for the above |
| `src/cli/ui.ts` | **new** — `dz ui`: tty check, dynamic import, handover |
| `src/cli/main.ts` | registers `registerUi` |
| `src/cli/help.ts` | a `dz ui` tutorial step (**required** — `help.test.ts` fails without it) |
| `tests/cli/ui.test.ts` | **new** — `dz ui` integration tests |
| `package.json` | `workspaces: ["ui", "."]`, plus `test:ui` and `test:all` scripts |

**Created in `ui/` (the `ditz2-ui` package):**

| File | Responsibility |
| --- | --- |
| `ui/package.json` | the package: deps, bin `dzui`, scripts |
| `ui/tsconfig.json` | NodeNext + `jsx: react-jsx`, `rootDir: src`, `outDir: dist` |
| `ui/tsconfig.test.json` | typechecks `ui/tests/` the way the root one does |
| `ui/vitest.config.ts` | esbuild JSX settings, includes `tests/**` |
| `ui/src/query.ts` | pure: filter-field text → `{ filter, pattern }` |
| `ui/src/state.ts` | pure: `UiState`, `UiAction`, `reducer`, `visibleIssues` |
| `ui/src/format.ts` | pure: the list row and detail line strings |
| `ui/src/components/IssueList.tsx` | the scrolling list |
| `ui/src/components/Detail.tsx` | the detail pane |
| `ui/src/components/Chrome.tsx` | header, footer, notice line |
| `ui/src/components/HelpOverlay.tsx` | `?` |
| `ui/src/components/FilterField.tsx` | `/` |
| `ui/src/app.tsx` | wires reducer + `useInput` + components; takes `Project` as a prop |
| `ui/src/index.ts` | the package entry: `runUi()`, what `dz ui` calls |
| `ui/src/main.ts` | the `dzui` bin |
| `ui/tests/helpers.tsx` | temp projects via the **built** `dz`, plus `press`/`settle` |
| `ui/tests/*.test.ts(x)` | one file per task |

Every `ui/src/*.tsx` component builds its output line as a template string and
renders `<Text>{line}</Text>`. JSX collapses whitespace between expressions in
ways that are easy to get wrong and painful to assert on; a single string is
both the thing tested and the thing displayed.

---

### Task 1: Widen the facade with what a UI reads

The UI needs four things the facade does not expose: the 13-character short id,
in-memory filtering, in-memory grep matching, and the project name and author to
put in the header. Reimplementing any of them in `ui/` would be `doctor`'s
`IGNORE_LINE` bug again — two copies of one rule, free to drift. None of them is
a new *operation*, so no CLI verb is needed.

**Files:**
- Modify: `src/api/filter.ts` (add `compilePattern`, `matchesRe`, `matchIssues`)
- Modify: `src/api/read.ts:33-55` (delete the private `matches`, use `filter.ts`)
- Modify: `src/api/index.ts` (re-exports; `Project.name`, `Project.whoami`)
- Test: `src/api/api.test.ts`

**Interfaces:**
- Consumes: `Issue`, `Filter`, `LoadResult` from the existing facade.
- Produces, all importable from `'ditz2'`:
  - `shortId(id: string): string`
  - `applyFilter(issues: Issue[], f: Filter): Issue[]`
  - `matchIssues(issues: Issue[], pattern: string): Issue[]`
  - `Project.name: string` (readonly, re-read on each access)
  - `Project.whoami(): string | null`

- [ ] **Step 1: Write the failing tests**

Append to `src/api/api.test.ts`:

```ts
import { shortId as renderShortId } from '../render/human.js';
import { applyFilter as filterApplyFilter, matchIssues } from './filter.js';
import * as api from './index.js';

describe('the surface a UI reads', () => {
  it('exports the very same shortId the CLI renders with', () => {
    // Not "produces the same output" — the same function. Two copies of the
    // 13-char rule would drift, and dz doctor already paid for that lesson.
    expect(api.shortId).toBe(renderShortId);
    expect(api.applyFilter).toBe(filterApplyFilter);
  });

  it('matches issues in memory by the same rule grep uses', () => {
    addIssue(s, { title: 'tokenizer drops a newline', type: 'bug' });
    addIssue(s, { title: 'unrelated', type: 'task' });
    const { issues } = listIssues(s);
    expect(matchIssues(issues, 'tokeni').map((i) => i.title))
      .toEqual(['tokenizer drops a newline']);
  });

  it('searches log text in memory, not just titles and bodies', () => {
    const issue = addIssue(s, { title: 'quiet', type: 'task' });
    commentOn(s, issue.id, 'the culprit is the lexer');
    const { issues } = listIssues(s);
    expect(matchIssues(issues, 'lexer')).toHaveLength(1);
  });

  it('agrees with grepIssues on the same project', () => {
    addIssue(s, { title: 'tokenizer drops a newline', type: 'bug' });
    addIssue(s, { title: 'unrelated', type: 'task' });
    const viaDisk = grepIssues(s, 'tokeni').issues.map((i) => i.id);
    const viaMemory = matchIssues(listIssues(s).issues, 'tokeni').map((i) => i.id);
    expect(viaMemory).toEqual(viaDisk);
  });

  it('reports an invalid regex the same way grep does', () => {
    expect(() => matchIssues([], '(')).toThrow(DzError);
  });

  it('names the project without a second read of config.yaml by the caller', () => {
    expect(openProject(tmp, { env: ENV }).name).toBe('demo');
  });

  it('reports who the author is, and null when there is none', () => {
    expect(openProject(tmp, { env: ENV }).whoami())
      .toBe('Test User <test@example.com>');
    // Browsing must work in a project with no identity configured, so this is
    // null rather than the throw resolveAuthor raises for a write.
    expect(openProject(tmp, { env: {} }).whoami()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run src/api
```

Expected: FAIL. `api.shortId`, `matchIssues`, `.name` and `.whoami` are all
undefined.

- [ ] **Step 3: Move the match rule into `filter.ts`**

Add to `src/api/filter.ts` (it already imports `Issue` and `validateEnum`; add
`import { DzError } from '../core/errors.js';`):

```ts
export function compilePattern(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (err) {
    throw new DzError('INVALID_FIELD', `invalid regex: ${(err as Error).message}`);
  }
}

export function matchesRe(issue: Issue, re: RegExp): boolean {
  if (re.test(issue.title) || re.test(issue.body)) return true;
  // Everything the log displays is searchable, not just comment bodies: the
  // author who made a change, the verb, and the detail carrying status
  // transitions, old titles, and component and assignee changes.
  return issue.log.some(
    (e) => re.test(e.author)
      || re.test(e.verb)
      || (e.detail !== null && re.test(e.detail))
      || (e.text !== null && re.test(e.text)),
  );
}

/**
 * The in-memory half of grep, over issues the caller already holds.
 *
 * A UI filters a snapshot it loaded once; routing each keystroke through
 * grepIssues would re-read every file on disk. This shares matchesRe with
 * grepIssues so the two can never disagree about what "matches" means.
 */
export function matchIssues(issues: Issue[], pattern: string): Issue[] {
  const re = compilePattern(pattern);
  return issues.filter((i) => matchesRe(i, re));
}
```

- [ ] **Step 4: Make `grepIssues` use it**

In `src/api/read.ts`, delete the private `matches` function entirely and replace
`grepIssues`:

```ts
import { applyFilter, compilePattern, matchesRe } from './filter.js';

export function grepIssues(s: Session, pattern: string, f: Filter = {}): LoadResult {
  // Compiled before the load, not after: an invalid regex is a usage error and
  // must not cost a full read of every issue first.
  const re = compilePattern(pattern);
  const { issues, failures } = loadAllIssues(s.root);
  return { issues: applyFilter(issues, f).filter((i) => matchesRe(i, re)), failures };
}
```

Remove the now-unused `DzError` import from `read.ts` if nothing else uses it.

- [ ] **Step 5: Widen the public entry**

In `src/api/index.ts`, add to the export block:

```ts
export { applyFilter, matchIssues } from './filter.js';
export { shortId } from '../render/human.js';
```

Add to the `Project` interface, after `readonly root: string;`:

```ts
  /** From dz/config.yaml, re-read on access so a refresh sees a rename. */
  readonly name: string;
  /**
   * The author mutations would be recorded under, or null when none is
   * configured. Null rather than a throw: reading a backlog must not require
   * an identity, and only writes do.
   */
  whoami(): string | null;
```

Add the imports `loadConfig` from `'../store/config.js'` and `resolveAuthor`
from `'../store/identity.js'`, then add to the object `openProject` returns:

```ts
    get name() { return loadConfig(s.root).name; },
    whoami: () => {
      try {
        return resolveAuthor(s.root, s.env);
      } catch {
        return null;
      }
    },
```

- [ ] **Step 6: Run the tests and watch them pass**

```bash
npx vitest run src/api
```

Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 7: Prove the new checks can fail**

Three deliberate breakages, one at a time, each reverted immediately:

1. In `index.ts` change the re-export to
   `export const shortId = (id: string) => id.slice(0, 13);` — the identity test
   must fail. (Same output, different function. If it passes, the test is
   asserting nothing.)
2. In `filter.ts` change `matchesRe` to drop the `issue.log.some(...)` clause —
   "searches log text" and "agrees with grepIssues" must both fail.
3. In `index.ts` make `whoami` rethrow instead of returning null — the
   no-identity case must fail.

- [ ] **Step 8: Full suite, lint, commit**

```bash
npm run typecheck && npm run build && npx vitest run
rm -rf .dz-fstest
the formatter and linter
git commit src/api tests -m "ditz2: expose the read surface a UI needs from the public API"
```

All 366 pre-existing tests must still pass untouched. If any needed editing, the
change altered behaviour — stop and report rather than editing the test.

---

### Task 2: The `ui/` workspace, and proof the package boundary is real

Nothing to render yet. The deliverable is a second package that builds, and a
test that the `exports` map does what plan one claimed: the public entry
resolves from inside `ui/`, its type declarations exist, and the private paths
are refused.

That last part matters more than it looks. This repository has already shipped a
packed-tarball check that confirmed imports resolved and private paths were
blocked — and passed while the `.d.ts` files it existed to verify were absent.

**Files:**
- Create: `ui/package.json`, `ui/tsconfig.json`, `ui/tsconfig.test.json`,
  `ui/vitest.config.ts`, `ui/src/index.ts`
- Modify: `package.json` (root: `workspaces`, two scripts)
- Modify: `CLAUDE.md` (the toolchain block gains the ui commands)
- Test: `ui/tests/boundary.test.ts`

**Interfaces:**
- Produces: the `ditz2-ui` package name, resolvable from the repo; and a
  placeholder `export function runUi(opts: RunUiOptions): Promise<number>` that
  Task 10 fills in. `RunUiOptions` is
  `{ cwd: string; env: Record<string, string | undefined> }`.

- [ ] **Step 1: Root `package.json`**

Add after `"files"`:

```json
  "workspaces": [
    "ui",
    "."
  ],
```

and to `"scripts"`:

```json
    "test:ui": "npm run build && tsc -p ui/tsconfig.json && chmod +x ui/dist/main.js && tsc -p ui/tsconfig.test.json && vitest run --root ui",
    "test:all": "npm test && npm run test:ui",
```

`test:ui` builds `ditz2` first on purpose: `ui/` imports `'ditz2'`, npm links
that to this directory, and the `exports` map points at `dist/`. Testing the UI
against a stale `dist/` is the same class of mistake as testing the TypeScript
sources instead of the built binary.

It typechecks `ui/tests/` explicitly, and that is not redundant with `build`.
`ui/tsconfig.json` *excludes* the test files so they stay out of `dist/`, and
vitest transpiles without typechecking — so `build && vitest` is green on a
test file full of type errors. `tsconfig.test.json` is the only thing that
reads `ui/tests/`, and it runs nowhere else.

**It invokes `tsc` and `vitest` directly rather than delegating to the
workspace's own scripts, and that is not a style preference.** The npm on this
machine is 8.19.4 — a shim points a vendored Node at the *system* npm rather
than the 11.x bundled beside it — and npm 8 **silently
discards the exit code of any script run in a workspace member**, whether
invoked as `npm run x --workspace y` or from inside the member directory.
Verified in an isolated project: a member script exiting 7 reports 0 three
different ways, while root scripts propagate correctly. So
`npm run test --workspace ditz2-ui` prints its failures and then exits 0, which
would make this whole gate incapable of failing. Root scripts and direct tool
invocations are unaffected, hence this form.

- [ ] **Step 2: `ui/package.json`**

```json
{
  "name": "ditz2-ui",
  "version": "0.1.0",
  "description": "A full-screen terminal UI for ditz2",
  "license": "MIT",
  "author": "Tzvetan Mikov",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "bin": {
    "dzui": "./dist/main.js"
  },
  "engines": {
    "node": ">=20"
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.json && chmod +x dist/main.js",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json",
    "test": "npm run build && vitest run"
  },
  "dependencies": {
    "ditz2": "^0.1.0",
    "ink": "^6.8.0",
    "react": "^19.2.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^19.2.18",
    "ink-testing-library": "^4.0.0",
    "typescript": "^5.9.3",
    "vitest": "^2.1.9"
  }
}
```

**Ink 6, not the 7.1.1 the spec measured.** `ink@7.1.1` declares
`engines: { node: ">=22" }`, this development host runs Node 21.4.0, and `ditz2`
promises `>=20`. `ink@6.8.0` declares `>=20` and takes the same React 19 peer,
so it is the version that can actually run here. See "Deviations from the spec".

`@types/react` and `react-devtools-core` are *optional* peers of Ink 6, so only
`react` is pulled in on top of Ink's own 25 dependencies.

**`"."` in `workspaces` is load-bearing, and the reason is not obvious.** npm
links a dependency to a local directory only when that directory is a *listed*
workspace. The root package is the workspace **root**, which is not implicitly
a **member** — so with `workspaces: ["ui"]` alone, `ui`'s `"ditz2": "^0.1.0"`
is resolved from the registry, where `ditz2` has never been published, and
`npm install` fails with a 404. Listing `"."` makes the root a member too, and
npm then symlinks `node_modules/ditz2` to it. Verified both ways on npm 8.19.4
under Node 21.4.0: `["ui"]` 404s, `["ui", "."]` installs 92 packages.

The dependency in `ui/package.json` stays `"ditz2": "^0.1.0"` — a real semver
range, correct for the day both packages are published. Only the root declares
the local linkage, so nothing in the shipped `ditz2-ui` manifest has to be
edited before publishing. (`"ditz2": "file:.."` would also link, but it would
put a path that only works in this checkout into the published manifest.)

Publishing is still the prerequisite for the global install the README
advertises — see "Deviations from the spec".

`chmod +x dist/main.js` in `build` will fail until Task 10 creates `main.ts`.
Until then use `"build": "tsc -p tsconfig.json"` and restore the `chmod` in
Task 10. (Noted here because a reader running Task 2 alone will hit it.)

- [ ] **Step 3: `ui/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "declaration": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]
}
```

`ui/tsconfig.test.json`:

```json
{
  "//": "Typechecks the test files, which tsconfig.json excludes so they stay out of dist/. Vitest transpiles without typechecking, so without this a type error in a test is invisible.",
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx"],
  "exclude": []
}
```

- [ ] **Step 4: `ui/vitest.config.ts`**

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest transpiles with esbuild rather than tsc, so the JSX settings in
  // tsconfig.json do not reach it and have to be repeated here.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
  },
});
```

- [ ] **Step 5: The placeholder entry, `ui/src/index.ts`**

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export interface RunUiOptions {
  cwd: string;
  env: Record<string, string | undefined>;
}

/** Filled in by Task 10. Present now so `dz ui`'s handover has a target. */
export async function runUi(_opts: RunUiOptions): Promise<number> {
  return 0;
}
```

- [ ] **Step 6: Install, and write the boundary test**

```bash
npm install
```

`ui/tests/boundary.test.ts`:

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';

/**
 * What ditz2's exports map actually does when the importer is ditz2-ui.
 *
 * Resolution passing says nothing about the declarations existing: this repo
 * has already shipped a packed-tarball check that verified imports worked and
 * private paths were blocked while the .d.ts files it existed to check were
 * absent. Hence the third test.
 *
 * The second and third tests go through `createRequire(...).resolve` rather
 * than `import.meta.resolve` or a dynamic `import()`. Vitest runs test files
 * through its own module runner: `import.meta` there has no `.resolve`, and
 * its dynamic `import()` reimplements exports-map resolution with its own
 * error text. `createRequire` gives Node's real resolver, so these assert what
 * Node does rather than what vitest approximates.
 */
describe('the ditz2 package boundary', () => {
  const require = createRequire(import.meta.url);

  it('resolves the public entry', async () => {
    const api = await import('ditz2');
    expect(typeof api.openProject).toBe('function');
    expect(typeof api.shortId).toBe('function');
    expect(typeof api.applyFilter).toBe('function');
    expect(typeof api.matchIssues).toBe('function');
  });

  it('ships the type declarations the entry advertises', () => {
    const entry = require.resolve('ditz2');
    expect(entry.endsWith('.js')).toBe(true);
    expect(fs.existsSync(entry.replace(/\.js$/, '.d.ts'))).toBe(true);
  });

  it('refuses the private internals', () => {
    // Asserted on `.code`, never a `.message` regex. Node's message here reads
    // "Package subpath './dist/store/lock.js' is not defined by \"exports\"" and
    // does not contain the code string at all, so a regex on the message can
    // only ever fail. Verified.
    const blocked = 'ditz2/dist/store/lock.js';
    let error: NodeJS.ErrnoException | undefined;
    try {
      require.resolve(blocked);
    } catch (e) {
      error = e as NodeJS.ErrnoException;
    }
    expect(error?.code).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });
});
```

- [ ] **Step 7: Run it**

```bash
npm run test:ui
```

Expected: PASS, 3 tests.

- [ ] **Step 8: Prove each of the three can fail**

One at a time, reverted immediately:

1. Delete `dist/api/index.d.ts` from the root package — the declarations test
   must fail. Restore with `npm run build`.
2. Add `"./dist/store/lock.js": "./dist/store/lock.js"` to the root
   `exports` map — the private-internals test must fail.
3. Rename `openProject` in `src/api/index.ts` — the entry test must fail.

- [ ] **Step 9: Document the two-package commands in `CLAUDE.md`**

In the Toolchain section, after the existing command block, add:

````markdown
The UI lives in a second workspace, `ui/` (package `ditz2-ui`). It imports
`ditz2` through the published `exports` map, so `dist/` must be current:

```bash
npm run test:ui     # builds ditz2, then typechecks, builds and tests ditz2-ui
npm run test:all    # both packages, both test suites, both typechecks
```

`test:ui` typechecks `ui/tests/` as well as `ui/src/`. `ui/tsconfig.json`
excludes the tests and vitest does not typecheck, so without that step a type
error in a UI test is invisible.

Both run `tsc` and `vitest` directly instead of calling `ui/`'s own npm
scripts. npm 8.19.4 — which this machine's `npm` resolves to — throws away the
exit code of any script run in a workspace member, so
`npm run test --workspace ditz2-ui` prints its failures and exits 0. If you run
the scripts inside `ui/` by hand, **read the output rather than trusting `$?`**
until the toolchain moves to the npm 11 bundled with the vendored Node.
````

- [ ] **Step 10: Lint and commit**

```bash
the formatter and linter
git add ui package-lock.json
git commit ui package.json package-lock.json CLAUDE.md \
  -m "ditz2: add the ditz2-ui workspace and a package-boundary test"
```

`package-lock.json` will have grown by roughly 39 packages. That is expected and
is why `ditz2-ui` is a separate package.

---

### Task 3: `dz ui` in the core CLI

The handover: a tty check, a dynamic `import('ditz2-ui')`, and an install hint
when it is absent. This is the only place core mentions the UI package, and it
must not become a dependency.

The importer is a parameter rather than an inline `import()` inside the action.
With `ui/` installed as a workspace, `'ditz2-ui'` **does** resolve in this
repository, so a test cannot exercise the absent case by simply not installing
it. Injecting the importer is how the install-hint path stays testable at all.

**Files:**
- Create: `src/cli/ui.ts`
- Modify: `src/cli/main.ts` (import and register)
- Modify: `src/cli/help.ts` (a tutorial step — see Step 4)
- Test: `src/cli/ui.test.ts` (unit, the injected importer)
- Test: `tests/cli/ui.test.ts` (integration, the built binary)

**Interfaces:**
- Consumes: `RunUiOptions`/`runUi` from Task 2; `CliContext` from
  `src/cli/context.ts`.
- Produces: `handOverToUi(ctx: CliContext, isTty: boolean, importUi: () =>
  Promise<unknown>): Promise<number>` and
  `registerUi(program: Command, ctx: CliContext): void`.

- [ ] **Step 1: Write the failing unit tests**

Create `src/cli/ui.test.ts`:

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { DzError } from '../core/errors.js';
import type { CliContext } from './context.js';
import { handOverToUi } from './ui.js';

function ctx(): CliContext {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd: '/tmp', env: {},
    stdout: { write: (s: string) => { out.push(s); return true; } } as never,
    stderr: { write: (s: string) => { err.push(s); return true; } } as never,
    json: false, exitCode: 0,
  };
}

/** The failure Node raises for a package that is not installed. */
function notFound(specifier: string): Error {
  const err = new Error(`Cannot find package '${specifier}' imported from /x/y.js`);
  (err as NodeJS.ErrnoException).code = 'ERR_MODULE_NOT_FOUND';
  return err;
}

describe('dz ui handover', () => {
  it('runs the UI and returns its exit code', async () => {
    const code = await handOverToUi(ctx(), true, async () => ({
      runUi: async () => 7,
    }));
    expect(code).toBe(7);
  });

  it('prints an install hint when ditz2-ui is absent', async () => {
    try {
      await handOverToUi(ctx(), true, () => Promise.reject(notFound('ditz2-ui')));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('NOT_FOUND');
      expect((err as DzError).message).toContain('npm i -g ditz2-ui');
      // Until ditz2 is published that command fails on its dependency, so the
      // hint has to say where the working instructions are.
      expect((err as DzError).message).toContain('ui/README.md');
    }
  });

  it('does not claim ditz2-ui is missing when one of its deps is', async () => {
    // Same errno, different package. Reporting "npm i -g ditz2-ui" here sends
    // the operator to reinstall something that is already installed.
    try {
      await handOverToUi(ctx(), true, () => Promise.reject(notFound('ink')));
      expect.unreachable('should have thrown');
    } catch (err) {
      // Positively, not just by absence. `expect.unreachable` throws an
      // ordinary Error whose message satisfies a bare `.not.toContain(...)`,
      // so the negative assertion alone passes even when handOverToUi
      // swallows the error and returns — proven by breaking it exactly that
      // way. Naming 'ink' is what makes this a real check.
      expect((err as Error).message).toContain("'ink'");
      expect((err as Error).message).not.toContain('npm i -g ditz2-ui');
    }
  });

  it('refuses without a terminal, before importing anything', async () => {
    let imported = false;
    try {
      await handOverToUi(ctx(), false, async () => { imported = true; return {}; });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
      expect((err as DzError).message).toContain('terminal');
    }
    // Not merely an ordering preference: importing Ink pulls 38 packages and
    // ~23 MB off disk to then refuse.
    expect(imported).toBe(false);
  });

  it('rejects a ditz2-ui that does not export runUi', async () => {
    await expect(handOverToUi(ctx(), true, async () => ({ nope: 1 })))
      .rejects.toThrow(DzError);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/cli
```

Expected: FAIL — `src/cli/ui.ts` does not exist.

- [ ] **Step 3: Write `src/cli/ui.ts`**

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { DzError } from '../core/errors.js';
import type { Env } from '../core/types.js';
import type { CliContext } from './context.js';

/** The one thing ditz2-ui must export for dz ui to hand over to it. */
interface UiModule {
  runUi(opts: { cwd: string; env: Env }): Promise<number>;
}

const UI_PACKAGE = 'ditz2-ui';

function isUiModule(mod: unknown): mod is UiModule {
  return typeof mod === 'object' && mod !== null
    && typeof (mod as UiModule).runUi === 'function';
}

/**
 * Loads ditz2-ui and gives it the terminal.
 *
 * `importUi` is a parameter rather than an inline import() so the
 * package-absent path is testable: ui/ is a workspace of this repository, so
 * the specifier resolves here and the failure cannot be produced by omission.
 */
export async function handOverToUi(
  ctx: CliContext,
  isTty: boolean,
  importUi: () => Promise<unknown>,
): Promise<number> {
  // Checked first, and before the import: with no terminal there is nothing to
  // hand over to, and Ink would otherwise be loaded only to be discarded.
  if (!isTty) {
    throw new DzError(
      'INVALID_FIELD',
      'the terminal UI needs an interactive terminal on stdin and stdout. '
      + "Use the commands instead — 'dz list', 'dz show', 'dz grep'",
    );
  }

  let mod: unknown;
  try {
    mod = await importUi();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    // A missing dependency OF ditz2-ui raises the same errno. Telling the
    // operator to install ditz2-ui when ditz2-ui is what failed to load its
    // own dependency sends them to fix the wrong thing.
    const missingUi = e.code === 'ERR_MODULE_NOT_FOUND'
      && typeof e.message === 'string'
      && e.message.includes(`'${UI_PACKAGE}'`);
    if (!missingUi) throw err;
    // The first two lines are the spec's wording, verbatim. The third is here
    // because ditz2 is not published yet, so the install it names currently
    // fails on an unresolvable dependency, and printing only that would send
    // the operator to a command that cannot succeed. Delete the third line
    // when both packages are on a registry.
    throw new DzError(
      'NOT_FOUND',
      `the terminal UI is a separate package\n    npm i -g ${UI_PACKAGE}\n`
      + '    (unpublished for now — see ui/README.md to build it from a clone)',
    );
  }

  if (!isUiModule(mod)) {
    throw new DzError(
      'INVALID_FIELD',
      `${UI_PACKAGE} is installed but exports no runUi(); its version does not `
      + 'match this dz. Reinstall both.',
    );
  }

  return mod.runUi({ cwd: ctx.cwd, env: ctx.env });
}

export function registerUi(program: Command, ctx: CliContext): void {
  program
    .command('ui')
    .description(`open the full-screen terminal UI (needs the ${UI_PACKAGE} package)`)
    .action(async () => {
      // The contract in `dz help agents` is that every command accepts --json
      // and that stdout is then machine-readable. A full-screen UI cannot
      // honour that, so it refuses rather than painting escape codes over a
      // caller that asked for JSON. `dz help` is the only other exception.
      if (ctx.json) {
        throw new DzError(
          'INVALID_FIELD',
          'dz ui is interactive and has no --json form; use dz list --json',
        );
      }
      const isTty = process.stdin.isTTY === true && process.stdout.isTTY === true;
      // The only mention of ditz2-ui anywhere in this package, and deliberately
      // a dynamic import: it is not a dependency and must not be bundled.
      ctx.exitCode = await handOverToUi(ctx, isTty, () => import(UI_PACKAGE));
    });
}
```

`import(UI_PACKAGE)` uses the constant rather than a literal so TypeScript does
not try to resolve `'ditz2-ui'` at compile time — `ditz2` has no dependency on
it and no types for it, and a literal would be a build error.

- [ ] **Step 4: Register it, and add the tutorial step**

In `src/cli/main.ts`, add `import { registerUi } from './ui.js';` and call
`registerUi(program, ctx);` after `registerUnlock(program, ctx);` and before
`registerHelp(program, ctx);`.

In `src/cli/help.ts`, change the contract line in `AGENTS` from

```
  Exception: 'dz help' output is prose, never JSON.
```

to

```
  Exceptions: 'dz help' output is prose, never JSON, and 'dz ui' is
      interactive and rejects --json with INVALID_FIELD.
```

then add to `TUTORIAL`, after the `dz schema` block and before the closing
prose:

```
  dz ui
      Opens a full-screen terminal UI for browsing the backlog, if the separate
      ditz2-ui package is installed. It needs a terminal, and everything it can
      do the commands above can already do.
```

This is **not optional decoration.** `tests/cli/help.test.ts` asserts that every
registered command has a `  dz <name>` tutorial step; without this, adding the
command breaks that test. Two leading spaces exactly — the drift guard is
anchored to `^ {2}dz ui\b`.

- [ ] **Step 5: Write the integration tests**

Create `tests/cli/ui.test.ts`:

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { dz, withTempProject } from '../helpers.js';

describe('dz ui', () => {
  it('declines without a terminal rather than rendering escape codes', () => {
    withTempProject((dir) => {
      dz(['init', '--name', 'demo'], { cwd: dir });
      // helpers.dz pipes all three stdio streams, so this is the no-tty case.
      const r = dz(['ui'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('needs an interactive terminal');
    });
  });

  it('rejects --json outright rather than painting a UI over it', () => {
    withTempProject((dir) => {
      dz(['init', '--name', 'demo'], { cwd: dir });
      const r = dz(['ui', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      const err = JSON.parse(r.stderr).error;
      expect(err.code).toBe('INVALID_FIELD');
      expect(err.message).toContain('no --json form');
    });
  });

  it('documents itself without ditz2-ui being loaded at all', () => {
    withTempProject((dir) => {
      // No dz init: --help must not need a project, and must not import Ink.
      const r = dz(['ui', '--help'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('Usage: dz ui');
      expect(r.stdout).toContain('ditz2-ui');
    });
  });
});
```

- [ ] **Step 6: Build and run everything**

```bash
npm run typecheck && npm run build && npx vitest run
rm -rf .dz-fstest
```

Expected: PASS. `help.test.ts`'s drift guard now covers `ui` too.

- [ ] **Step 7: Prove the checks can fail**

1. Delete the `dz ui` tutorial step — `help.test.ts` "mentions every registered
   command in the tutorial" must fail naming `dz ui`. Restore it.
2. In `handOverToUi`, move the tty check after the import — the "before
   importing anything" assertion must fail. Restore it.
3. Drop the `e.message.includes(...)` guard so any `ERR_MODULE_NOT_FOUND`
   becomes the install hint — the missing-dependency test must fail. Restore it.

- [ ] **Step 8: Lint and commit**

```bash
the formatter and linter
git add src/cli/ui.ts src/cli/ui.test.ts tests/cli/ui.test.ts
git commit src tests -m "ditz2: add dz ui, handing over to the ditz2-ui package"
```

---

### Task 4: The filter field's grammar

One text field doing both jobs the CLI splits across `list` and `grep`:
`key:value` terms become a `Filter`, and whatever is left over is the regex.
Pure, no Ink, no IO.

**Files:**
- Create: `ui/src/query.ts`
- Test: `ui/tests/query.test.ts`

**Interfaces:**
- Consumes: `Filter` from `'ditz2'`.
- Produces:
  - `interface Query { filter: Filter; pattern: string | null }`
  - `parseQuery(text: string, me: string | null): Query`
  - `meAs(author: string | null): string | null`

- [ ] **Step 1: Write the failing tests**

Create `ui/tests/query.test.ts`:

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { meAs, parseQuery } from '../src/query.js';

describe('parseQuery', () => {
  it('is empty for empty text', () => {
    expect(parseQuery('', null)).toEqual({ filter: {}, pattern: null });
    expect(parseQuery('   ', null)).toEqual({ filter: {}, pattern: null });
  });

  it('turns key:value terms into filter fields', () => {
    expect(parseQuery('status:open type:bug component:cli', null).filter)
      .toEqual({ status: 'open', type: 'bug', component: 'cli' });
  });

  it('treats bare words as one regex, in the order typed', () => {
    expect(parseQuery('drops a newline', null))
      .toEqual({ filter: {}, pattern: 'drops a newline' });
  });

  it('mixes the two, in any order', () => {
    expect(parseQuery('tokenizer status:open', null))
      .toEqual({ filter: { status: 'open' }, pattern: 'tokenizer' });
    expect(parseQuery('status:open tokenizer', null))
      .toEqual({ filter: { status: 'open' }, pattern: 'tokenizer' });
  });

  it('expands assignee:me to the author email', () => {
    expect(parseQuery('assignee:me', meAs('Jane Roe <jane@example.com>')).filter)
      .toEqual({ assignee: 'jane@example.com' });
  });

  it('falls back to the whole author when it carries no email', () => {
    expect(parseQuery('assignee:me', meAs('jane')).filter)
      .toEqual({ assignee: 'jane' });
  });

  it('leaves assignee:me alone when there is no identity', () => {
    // Better a filter that matches nothing than one that silently matches the
    // literal string "me" and shows a list the operator will misread.
    expect(parseQuery('assignee:me', meAs(null)).filter)
      .toEqual({ assignee: 'me' });
  });

  it('does not treat "me" as special for other keys', () => {
    expect(parseQuery('component:me', meAs('Jane Roe <jane@example.com>')).filter)
      .toEqual({ component: 'me' });
  });

  it('reads all: as the --all flag', () => {
    expect(parseQuery('all:true', null).filter).toEqual({ all: true });
    expect(parseQuery('all:false', null).filter).toEqual({ all: false });
  });

  it('drops a bare all: instead of leaking it into the regex', () => {
    // "all:" exists for one keystroke on the way to "all:true". Treating it as
    // a bare word puts the literal text "all:" in the pattern, which matches
    // nothing and empties the list mid-word.
    expect(parseQuery('all:', null)).toEqual({ filter: {}, pattern: null });
    expect(parseQuery('all:true all:', null).filter).toEqual({});
  });

  it('lets an empty value clear a key set earlier in the same text', () => {
    expect(parseQuery('status:open status:', null).filter).toEqual({});
  });

  it('drops a key with an empty value instead of failing on it', () => {
    // Typing is incremental: "status:" exists for one keystroke on the way to
    // "status:open", and must not be an error the operator has to read.
    expect(parseQuery('status: tokenizer', null))
      .toEqual({ filter: {}, pattern: 'tokenizer' });
  });

  it('leaves an unknown key as part of the regex', () => {
    // http://example.com is a bare word, not a filter on the key "http".
    expect(parseQuery('http://example.com', null))
      .toEqual({ filter: {}, pattern: 'http://example.com' });
  });

  it('lets the last mention of a key win', () => {
    expect(parseQuery('status:open status:closed', null).filter)
      .toEqual({ status: 'closed' });
  });

  it('does not validate the vocabulary itself', () => {
    // applyFilter owns that rule and raises INVALID_FIELD. A second copy here
    // would be free to drift from it.
    expect(parseQuery('status:nope', null).filter).toEqual({ status: 'nope' });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test --workspace ditz2-ui
```

Expected: FAIL — `../src/query.js` does not exist.

- [ ] **Step 3: Write `ui/src/query.ts`**

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Filter } from 'ditz2';

export interface Query {
  filter: Filter;
  /** The bare words, rejoined. null when only key:value terms were typed. */
  pattern: string | null;
}

/**
 * Every key the field understands. `all` is here with the rest, not on a
 * branch of its own, so that one empty-value rule covers all five.
 */
const KEYS = ['status', 'component', 'assignee', 'type', 'all'] as const;
type Key = (typeof KEYS)[number];

function isKnownKey(key: string): key is Key {
  return (KEYS as readonly string[]).includes(key);
}

/**
 * What `assignee:me` should match.
 *
 * The author is stored as "Name <email>" but assignees are written by hand and
 * are usually the bare email, so the email is the higher-probability match.
 * Returns null when no identity is configured, which leaves "me" literal.
 */
export function meAs(author: string | null): string | null {
  if (author === null) return null;
  return /<([^>]+)>/.exec(author)?.[1]?.trim() ?? author;
}

/**
 * Parses the `/` field into the two halves the snapshot is narrowed by.
 *
 * Never throws, and never validates a value. Half-typed text arrives here on
 * every keystroke, and the vocabulary rules live in ditz2's applyFilter — a
 * copy of them here would be free to drift from the one the CLI enforces.
 */
export function parseQuery(text: string, me: string | null): Query {
  const filter: Filter = {};
  const words: string[] = [];

  for (const term of text.trim().split(/\s+/).filter((t) => t !== '')) {
    const m = /^([a-z]+):(.*)$/.exec(term);
    const key = m?.[1];
    const value = m?.[2];

    // Anything that is not a known key:value term is part of the regex —
    // "http://example.com" is a bare word, not a filter on a key named "http".
    if (key === undefined || value === undefined || !isKnownKey(key)) {
      words.push(term);
      continue;
    }

    // An empty value un-sets the key rather than filtering on "", so that
    // "status:" on the way to "status:open" is not a transient error. This
    // has to cover `all` too: handling it on a separate path let "all:" fall
    // through to the regex mid-word, emptying the list exactly when the
    // operator was halfway to typing "all:true".
    if (value === '') {
      delete filter[key];
      continue;
    }

    if (key === 'all') {
      filter.all = value === 'true' || value === 'yes' || value === '1';
      continue;
    }

    filter[key] = key === 'assignee' && value === 'me' ? (me ?? 'me') : value;
  }

  return { filter, pattern: words.length === 0 ? null : words.join(' ') };
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
npm run test --workspace ditz2-ui
```

Expected: PASS, 13 tests plus Task 2's 3.

- [ ] **Step 5: Prove the tests can fail**

1. Change `meAs` to always return the whole author — the email-expansion test
   must fail.
2. Change the empty-value branch to `filter[key] = value` — the incremental
   typing test must fail.
3. Add `if (!STATUSES.includes(value)) throw ...` — the "does not validate the
   vocabulary" test must fail.

Revert each.

- [ ] **Step 6: Lint and commit**

```bash
the formatter and linter
git add ui/src/query.ts ui/tests/query.test.ts
git commit ui -m "ditz2-ui: parse the filter field into a Filter and a regex"
```

---

### Task 5: The reducer

All UI state in one pure function. No Ink, no IO, no React. Selection is by id
throughout, and the visible list is derived rather than stored, so it can never
disagree with the filter.

**Files:**
- Create: `ui/src/state.ts`
- Create: `ui/tests/fixtures.ts`
- Test: `ui/tests/state.test.ts`

**Interfaces:**
- Consumes: `Issue`, `LoadFailure`, `Filter`, `applyFilter`, `matchIssues`,
  `shortId` from `'ditz2'`; `parseQuery`, `Query` from `./query.js`.
- Produces:
  - `interface UiState` with `snapshot`, `failures`, `query`, `filter`,
    `pattern`, `queryError`, `selectedId`, `screen`, `overlay`, `helpOffset`,
    `notice`
  - `type UiAction` (the ten cases below, `scrollHelp` among them)
  - `initialState(issues: Issue[], failures: LoadFailure[]): UiState`
  - `reducer(state: UiState, action: UiAction): UiState`
  - `visibleIssues(state: UiState): Issue[]`
  - `selectedIssue(state: UiState): Issue | null`

`screen` is `'list'` only and `overlay` covers `'filter'` and `'help'`. Plan 2b
widens both unions (`'form'`; `'status' | 'component' | 'resolution' |
'comment' | 'conflict' | 'error'`) and adds `waitingFor`. Keeping the names the
spec uses is what makes that an addition rather than a rename.

- [ ] **Step 1: Write the fixtures**

Create `ui/tests/fixtures.ts`:

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Issue } from 'ditz2';

/**
 * An Issue literal. Reducer and rendering tests are about issue data, not about
 * files, so they build issues directly rather than through a project on disk.
 * The end-to-end test in Task 10 is what covers real files.
 */
export function issue(over: Partial<Issue> & { id: string; title: string }): Issue {
  return {
    type: 'task',
    status: 'open',
    resolution: null,
    component: null,
    assignee: null,
    created: '2026-08-26 09:00',
    creator: 'Test User <test@example.com>',
    body: '',
    log: [],
    unknown: {},
    ...over,
  };
}

/** Three open issues with distinguishable ids, in list order. */
export function three(): Issue[] {
  return [
    issue({ id: '01a00000-0001-7000-8000-000000000001', title: 'alpha', type: 'bug', component: 'cli' }),
    issue({ id: '01a00000-0002-7000-8000-000000000002', title: 'beta', type: 'feature', component: 'store' }),
    issue({ id: '01a00000-0003-7000-8000-000000000003', title: 'gamma', status: 'in-progress' }),
  ];
}
```

- [ ] **Step 2: Write the failing tests**

Create `ui/tests/state.test.ts`:

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  initialState, reducer, selectedIssue, visibleIssues,
} from '../src/state.js';
import type { UiAction, UiState } from '../src/state.js';
import { issue, three } from './fixtures.js';

const ME = 'jane@example.com';
const start = (): UiState => initialState(three(), []);
const run = (s: UiState, ...actions: UiAction[]): UiState =>
  actions.reduce(reducer, s);
const titles = (s: UiState): string[] => visibleIssues(s).map((i) => i.title);

describe('selection', () => {
  it('starts on the first issue', () => {
    expect(selectedIssue(start())?.title).toBe('alpha');
  });

  it('has nothing selected in an empty project', () => {
    const s = initialState([], []);
    expect(s.selectedId).toBeNull();
    expect(selectedIssue(s)).toBeNull();
  });

  it('moves down and up, and stops at the ends', () => {
    let s = run(start(), { type: 'move', delta: 1 });
    expect(selectedIssue(s)?.title).toBe('beta');
    s = run(s, { type: 'move', delta: -1 }, { type: 'move', delta: -1 });
    expect(selectedIssue(s)?.title).toBe('alpha');
    s = run(s, { type: 'move', delta: 99 });
    expect(selectedIssue(s)?.title).toBe('gamma');
  });

  it('jumps to first and last', () => {
    const s = run(start(), { type: 'jump', to: 'last' });
    expect(selectedIssue(s)?.title).toBe('gamma');
    expect(selectedIssue(run(s, { type: 'jump', to: 'first' }))?.title).toBe('alpha');
  });

  it('keeps the cursor on the same issue when a refresh reorders the list', () => {
    const s = run(start(), { type: 'move', delta: 2 });
    const id = s.selectedId;
    const reordered = [...three()].reverse();
    const after = run(s, { type: 'snapshot', issues: reordered, failures: [] });
    // Index 2 would now be 'alpha'. By id it is still 'gamma'.
    expect(after.selectedId).toBe(id);
    expect(selectedIssue(after)?.title).toBe('gamma');
  });

  it('says so when the selected issue is gone after a refresh', () => {
    const s = run(start(), { type: 'move', delta: 2 });
    const after = run(s, { type: 'snapshot', issues: three().slice(0, 2), failures: [] });
    expect(selectedIssue(after)?.title).toBe('alpha');
    expect(after.notice).toContain('01a00000-0003');
    expect(after.notice).toContain('no longer');
  });

  it('clears a stale notice once a refresh succeeds', () => {
    const s = run(start(),
      { type: 'notice', text: 'refresh failed: disk on fire' },
      { type: 'snapshot', issues: three(), failures: [] });
    expect(s.notice).toBeNull();
  });

  it('still reports a lost selection on the refresh that clears the notice', () => {
    // The clear must not swallow the message reselect is about to set.
    const s = run(start(),
      { type: 'move', delta: 2 },
      { type: 'notice', text: 'refresh failed: disk on fire' },
      { type: 'snapshot', issues: three().slice(0, 2), failures: [] });
    expect(s.notice).toContain('no longer');
    expect(s.notice).not.toContain('disk on fire');
  });

  it('reports the loss even when the refresh empties the list entirely', () => {
    // The partial case is covered above. Total loss went through a separate
    // early return that ignored the report flag.
    const s = run(start(), { type: 'move', delta: 1 },
      { type: 'snapshot', issues: [], failures: [] });
    expect(s.selectedId).toBeNull();
    expect(s.notice).toContain('no longer');
  });

  it('stays quiet when a filter empties the list', () => {
    const s = run(start(), { type: 'setQuery', text: 'type:bug component:store', me: ME });
    expect(visibleIssues(s)).toEqual([]);
    expect(s.selectedId).toBeNull();
    expect(s.notice).toBeNull();
  });

  it('says nothing when a filter, not a refresh, hides the selection', () => {
    // Filtering a row out is what filtering is for; announcing it is noise.
    const s = run(start(), { type: 'move', delta: 2 },
      { type: 'setQuery', text: 'type:bug', me: ME });
    expect(selectedIssue(s)?.title).toBe('alpha');
    expect(s.notice).toBeNull();
  });
});

describe('the filter query', () => {
  it('narrows by key:value', () => {
    expect(titles(run(start(), { type: 'setQuery', text: 'type:bug', me: ME })))
      .toEqual(['alpha']);
  });

  it('narrows by regex', () => {
    expect(titles(run(start(), { type: 'setQuery', text: 'a.pha', me: ME })))
      .toEqual(['alpha']);
  });

  it('applies both at once', () => {
    const s = run(start(), { type: 'setQuery', text: 'component:store beta', me: ME });
    expect(titles(s)).toEqual(['beta']);
  });

  it('hides closed issues until asked, exactly as dz list does', () => {
    const closed = issue({
      id: '01a00000-0004-7000-8000-000000000004', title: 'delta',
      status: 'closed', resolution: 'fixed',
    });
    const s = initialState([...three(), closed], []);
    expect(titles(s)).not.toContain('delta');
    expect(titles(run(s, { type: 'setQuery', text: 'all:true', me: ME })))
      .toContain('delta');
  });

  it('reports a bad value instead of throwing, and keeps the last good list', () => {
    const s = run(start(), { type: 'setQuery', text: 'status:nope', me: ME });
    expect(s.queryError).toContain('nope');
    expect(titles(s)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('survives a half-typed regex', () => {
    // "(" arrives on the way to "(foo)". It must be a message, not a crash.
    const s = run(start(), { type: 'setQuery', text: '(', me: ME });
    expect(s.queryError).not.toBeNull();
    expect(() => visibleIssues(s)).not.toThrow();
  });

  it('clears the error once the text becomes valid again', () => {
    // "(a)" as a final regex is a poor probe here: matchesRe does an
    // unanchored substring test against the title, and "beta" and "gamma"
    // both contain the letter "a" too. "(alpha)" narrows to just one issue
    // while keeping the same unbalanced-paren-while-typing shape.
    const s = run(start(),
      { type: 'setQuery', text: '(', me: ME },
      { type: 'setQuery', text: '(al', me: ME },
      { type: 'setQuery', text: '(alpha)', me: ME });
    expect(s.queryError).toBeNull();
    expect(titles(s)).toEqual(['alpha']);
  });

  it('restores the whole list when cleared', () => {
    const s = run(start(),
      { type: 'setQuery', text: 'type:bug', me: ME },
      { type: 'clearFilter' });
    expect(s.query).toBe('');
    expect(titles(s)).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('overlays', () => {
  it('opens and closes the filter field', () => {
    let s = run(start(), { type: 'openFilter' });
    expect(s.overlay).toEqual({ kind: 'filter' });
    s = run(s, { type: 'closeFilter' });
    expect(s.overlay).toBeNull();
  });

  it('keeps the typed filter when the field is closed', () => {
    // Esc leaves the field; clearing is a separate action. Losing the filter
    // on the way back to the list would make it unusable.
    const s = run(start(), { type: 'openFilter' },
      { type: 'setQuery', text: 'type:bug', me: ME }, { type: 'closeFilter' });
    expect(titles(s)).toEqual(['alpha']);
  });

  it('toggles help', () => {
    const s = run(start(), { type: 'toggleHelp' });
    expect(s.overlay).toEqual({ kind: 'help' });
    expect(run(s, { type: 'toggleHelp' }).overlay).toBeNull();
  });

  it('scrolls help within its bounds', () => {
    let s = run(start(), { type: 'toggleHelp' }, { type: 'scrollHelp', delta: 2, max: 3 });
    expect(s.helpOffset).toBe(2);
    s = run(s, { type: 'scrollHelp', delta: 9, max: 3 });
    expect(s.helpOffset).toBe(3);
    s = run(s, { type: 'scrollHelp', delta: -9, max: 3 });
    expect(s.helpOffset).toBe(0);
  });

  it('reopens help at the top', () => {
    const s = run(start(), { type: 'toggleHelp' }, { type: 'scrollHelp', delta: 3, max: 5 },
      { type: 'toggleHelp' }, { type: 'toggleHelp' });
    expect(s.helpOffset).toBe(0);
  });
});

describe('load failures', () => {
  it('carries them so the UI can report an unreadable file', () => {
    const failures = [{ file: 'dz/issues/x.md', error: new Error('bad') as never }];
    expect(initialState([], failures).failures).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
npm run test --workspace ditz2-ui
```

Expected: FAIL — `../src/state.js` does not exist.

- [ ] **Step 4: Write `ui/src/state.ts`**

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { applyFilter, matchIssues, shortId } from 'ditz2';
import type { Filter, Issue, LoadFailure } from 'ditz2';
import { parseQuery } from './query.js';

export interface UiState {
  /** Replaced wholesale on refresh; never mutated in place. */
  snapshot: Issue[];
  failures: LoadFailure[];
  /** The raw text of the / field. */
  query: string;
  /** The last query text that parsed and validated. */
  filter: Filter;
  pattern: string | null;
  queryError: string | null;
  selectedId: string | null;
  screen: 'list';
  overlay: null | { kind: 'filter' } | { kind: 'help' };
  /** First visible help line. Only meaningful while the help overlay is open. */
  helpOffset: number;
  notice: string | null;
}

export type UiAction =
  | { type: 'snapshot'; issues: Issue[]; failures: LoadFailure[] }
  | { type: 'move'; delta: number }
  | { type: 'jump'; to: 'first' | 'last' }
  | { type: 'openFilter' }
  | { type: 'setQuery'; text: string; me: string | null }
  | { type: 'closeFilter' }
  | { type: 'clearFilter' }
  | { type: 'toggleHelp' }
  | { type: 'scrollHelp'; delta: number; max: number }
  | { type: 'notice'; text: string | null };

/**
 * Derived, never stored. A stored copy would be one more thing that can
 * disagree with the filter that produced it.
 *
 * Total by construction: `filter` and `pattern` are only ever assigned values
 * that already validated, so neither call here can throw.
 */
export function visibleIssues(state: UiState): Issue[] {
  const filtered = applyFilter(state.snapshot, state.filter);
  return state.pattern === null ? filtered : matchIssues(filtered, state.pattern);
}

export function selectedIssue(state: UiState): Issue | null {
  if (state.selectedId === null) return null;
  return visibleIssues(state).find((i) => i.id === state.selectedId) ?? null;
}

/**
 * Puts the cursor back on something real.
 *
 * `report` is true only for a refresh: an issue vanishing under the cursor
 * because someone else closed it is news, whereas one disappearing because the
 * operator narrowed the filter is the filter working.
 */
function reselect(state: UiState, report: boolean): UiState {
  const visible = visibleIssues(state);
  if (state.selectedId !== null && visible.some((i) => i.id === state.selectedId)) {
    return state;
  }
  const lost = state.selectedId;
  // No early return for an empty list. A refresh that empties the list loses
  // the selection just as surely as one that merely reorders it, and it is the
  // same news; an early return here reported the partial case and silently
  // dropped the total one.
  return {
    ...state,
    selectedId: visible[0]?.id ?? null,
    notice: report && lost !== null
      ? `${shortId(lost)} is no longer in the list`
      : state.notice,
  };
}

export function initialState(issues: Issue[], failures: LoadFailure[]): UiState {
  return reselect({
    snapshot: issues,
    failures,
    query: '',
    filter: {},
    pattern: null,
    queryError: null,
    selectedId: null,
    screen: 'list',
    overlay: null,
    helpOffset: 0,
    notice: null,
  }, false);
}

/**
 * Whether ditz2 accepts this filter and pattern, as a message or null.
 *
 * Probed against an empty array: applyFilter checks its vocabulary and
 * matchIssues compiles its regex before either looks at an issue, so this costs
 * nothing and cannot be fooled by a snapshot that happens to be empty.
 */
function rejects(filter: Filter, pattern: string | null): string | null {
  try {
    applyFilter([], filter);
    if (pattern !== null) matchIssues([], pattern);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

export function reducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'snapshot':
      // notice cleared here, not in reselect: a snapshot arriving at all means
      // the load succeeded, so whatever the last one said — "refresh failed",
      // or an issue that has since come back — no longer describes the screen.
      // reselect sets a fresh one if the selection was lost.
      return reselect(
        { ...state, snapshot: action.issues, failures: action.failures, notice: null },
        true,
      );

    case 'move': {
      const visible = visibleIssues(state);
      if (visible.length === 0) return state;
      const at = visible.findIndex((i) => i.id === state.selectedId);
      const next = Math.min(Math.max((at < 0 ? 0 : at) + action.delta, 0), visible.length - 1);
      return { ...state, selectedId: visible[next]!.id };
    }

    case 'jump': {
      const visible = visibleIssues(state);
      if (visible.length === 0) return state;
      const pick = action.to === 'first' ? visible[0]! : visible[visible.length - 1]!;
      return { ...state, selectedId: pick.id };
    }

    case 'setQuery': {
      const { filter, pattern } = parseQuery(action.text, action.me);
      const queryError = rejects(filter, pattern);
      // On a rejected query the text is kept — the operator is mid-word — but
      // the filter is not, so the list stays on the last thing that made sense
      // rather than emptying while they type.
      if (queryError !== null) return { ...state, query: action.text, queryError };
      return reselect({ ...state, query: action.text, filter, pattern, queryError: null }, false);
    }

    case 'clearFilter':
      return reselect(
        { ...state, query: '', filter: {}, pattern: null, queryError: null },
        false,
      );

    case 'openFilter':
      return { ...state, overlay: { kind: 'filter' } };

    case 'closeFilter':
      return { ...state, overlay: null };

    case 'toggleHelp':
      return {
        ...state,
        overlay: state.overlay?.kind === 'help' ? null : { kind: 'help' },
        // Reopening help starts at the top rather than wherever it was left.
        helpOffset: 0,
      };

    case 'scrollHelp':
      return {
        ...state,
        helpOffset: Math.min(Math.max(state.helpOffset + action.delta, 0), Math.max(action.max, 0)),
      };

    case 'notice':
      return { ...state, notice: action.text };
  }
}
```

- [ ] **Step 5: Run and watch it pass**

```bash
npm run test --workspace ditz2-ui && npm run typecheck --workspace ditz2-ui
```

Expected: PASS.

- [ ] **Step 6: Prove the important tests can fail**

The selection-by-id invariant is the one that matters most, and it is the
easiest to write a test for that passes by luck.

1. Change `UiState.selectedId` usage in `move` to store an index instead — the
   reorder test must fail. Revert.
2. In `reselect`, pass `true` for `report` from `setQuery` — the "says nothing
   when a filter hides the selection" test must fail. Revert.
3. Delete the `queryError !== null` early return in `setQuery` so a bad filter
   is stored — the "keeps the last good list" test must fail with a thrown
   `DzError` out of `visibleIssues`. Revert.
4. In `rejects`, return `null` unconditionally — both the bad-value and
   half-typed-regex tests must fail. Revert.

- [ ] **Step 7: Lint and commit**

```bash
the formatter and linter
git add ui/src/state.ts ui/tests/state.test.ts ui/tests/fixtures.ts
git commit ui -m "ditz2-ui: add the reducer, with selection tracked by issue id"
```

---

### Task 6: Row formatting and the list

The first thing that renders. `format.ts` is pure and holds every string the
list draws, including the scroll window; `IssueList.tsx` is a `map` over it.

Columns follow the spec's mock — short id, type padded to 7, component, title —
**not** `renderIssueList` in `src/render/human.ts`, which is short id, *status*,
type, title and carries no component at all. The two differ deliberately: the
CLI's `dz list` has no second pane, so status has to be in the row, while the UI
puts status in the detail pane below and spends the column on component
instead. The shared `pad` width of 7 for type is the one thing they hold in
common. The spec's mock also abbreviates `feature` to `feat`; that is
illustrative and not followed.

**Files:**
- Create: `ui/src/format.ts`
- Create: `ui/src/components/IssueList.tsx`
- Create: `ui/tests/helpers.tsx`
- Test: `ui/tests/format.test.ts`, `ui/tests/list.test.tsx`

**Interfaces:**
- Consumes: `Issue`, `shortId` from `'ditz2'`.
- Produces:
  - `pad(value: string, width: number): string`
  - `truncate(value: string, width: number): string`
  - `rowFor(issue: Issue, selected: boolean, width: number): string`
  - `windowOf(count: number, selected: number, rows: number): { from: number; to: number }`
  - `<IssueList issues={Issue[]} selectedId={string | null} rows={number} width={number} />`

- [ ] **Step 1: Write the test helpers**

Create `ui/tests/helpers.tsx`:

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** Ink applies input and repaints on a later tick, so tests wait one out. */
export const settle = (): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, 25); });

/**
 * The escape sequences a terminal actually sends.
 *
 * Spelled with \u escapes rather than literal control characters: a literal
 * ESC is invisible in an editor and does not survive a copy-paste, and a key
 * test that silently sends nothing is a test that can only pass.
 */
export const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  home: '\u001B[H',
  end: '\u001B[F',
  pageUp: '\u001B[5~',
  pageDown: '\u001B[6~',
  escape: '\u001B',
  enter: '\r',
  ctrlU: '\u0015',
  ctrlD: '\u0004',
  backspace: '\u007F',
} as const;

export interface FakeStdin { write(data: string): void }

export async function press(stdin: FakeStdin, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    stdin.write(key);
    await settle();
  }
}

/**
 * The lines of a frame, stripped of colour and trailing spaces.
 *
 * Ink emits no escapes when chalk detects no colour support, which is the
 * usual case under vitest — but that depends on the environment, and an
 * assertion like `startsWith('>')` fails silently and confusingly the one time
 * it does not hold. Stripping makes the tests independent of it.
 */
export function lines(frame: string | undefined): string[] {
  return (frame ?? '')
    .replace(/\u001B\[[0-9;]*m/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
}
```

- [ ] **Step 2: Write the failing format tests**

Create `ui/tests/format.test.ts`:

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { rowFor, truncate, windowOf } from '../src/format.js';
import { issue } from './fixtures.js';

describe('rowFor', () => {
  const one = issue({
    id: '01a00000-0001-7000-8000-000000000001',
    title: 'sqlite cache for list and grep',
    type: 'feature',
    component: 'store',
  });

  it('lays out id, type, component and title', () => {
    const row = rowFor(one, false, 80);
    expect(row).toContain('01a00000-0001');
    expect(row).toContain('feature');
    expect(row).toContain('store');
    expect(row).toContain('sqlite cache for list and grep');
  });

  it('marks the selected row and only the selected row', () => {
    expect(rowFor(one, true, 80).startsWith('>')).toBe(true);
    expect(rowFor(one, false, 80).startsWith('>')).toBe(false);
  });

  it('keeps the columns aligned when a component name overruns its width', () => {
    // Component names are arbitrary: `dz component add documentation` is legal.
    const long = issue({ ...one, component: 'documentation' });
    const short = issue({ ...one, component: 'cli' });
    expect(rowFor(long, false, 200).indexOf(one.title))
      .toBe(rowFor(short, false, 200).indexOf(one.title));
  });

  it('keeps titles aligned regardless of type length', () => {
    const short = rowFor(issue({ ...one, type: 'bug' }), false, 80);
    const long = rowFor(issue({ ...one, type: 'feature' }), false, 80);
    expect(short.indexOf('sqlite')).toBe(long.indexOf('sqlite'));
  });

  it('shows a dash in the component column for an issue with no component', () => {
    // `toContain('-')` is vacuous here: shortId is the first 13 characters of
    // a UUIDv7 — "01a00000-0001" — so the row already contains a hyphen no
    // matter what the component column holds. Locate the column and look at
    // the character actually in it.
    const at = rowFor(one, false, 80).indexOf('store');
    const row = rowFor(issue({ ...one, component: null }), false, 80);
    expect(at).toBeGreaterThan(0);
    expect(row[at]).toBe('-');
    expect(row).not.toContain('store');
  });

  it('never exceeds the terminal width', () => {
    // A row that wraps pushes every row below it down and the frame stops
    // matching the list, so this is a layout invariant and not cosmetic.
    const wide = issue({ ...one, title: 'x'.repeat(500) });
    expect(rowFor(wide, true, 60).length).toBeLessThanOrEqual(60);
  });
});

describe('truncate', () => {
  it('leaves short values alone', () => {
    expect(truncate('abc', 10)).toBe('abc');
  });

  it('marks that it cut something', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate('abcdefghij', 5)).toHaveLength(5);
  });
});

describe('windowOf', () => {
  it('shows everything when it fits', () => {
    expect(windowOf(3, 0, 10)).toEqual({ from: 0, to: 3 });
  });

  it('scrolls to keep the selection visible at the bottom', () => {
    expect(windowOf(100, 12, 10)).toEqual({ from: 3, to: 13 });
  });

  it('scrolls to keep the selection visible at the top', () => {
    expect(windowOf(100, 0, 10)).toEqual({ from: 0, to: 10 });
  });

  it('does not scroll past the end', () => {
    expect(windowOf(100, 99, 10)).toEqual({ from: 90, to: 100 });
  });

  it('survives an empty list', () => {
    expect(windowOf(0, -1, 10)).toEqual({ from: 0, to: 0 });
  });
});
```

- [ ] **Step 3: Write the failing list test**

Create `ui/tests/list.test.tsx`:

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { IssueList } from '../src/components/IssueList.js';
import { lines, settle } from './helpers.js';
import { three } from './fixtures.js';

describe('<IssueList>', () => {
  it('draws one row per issue, in order', async () => {
    const issues = three();
    const { lastFrame } = render(
      <IssueList issues={issues} selectedId={issues[1]!.id} rows={10} width={80} />,
    );
    await settle();
    const body = lines(lastFrame()).filter((l) => l !== '');
    expect(body).toHaveLength(3);
    expect(body[0]).toContain('alpha');
    expect(body[2]).toContain('gamma');
  });

  it('marks exactly one row', async () => {
    const issues = three();
    const { lastFrame } = render(
      <IssueList issues={issues} selectedId={issues[1]!.id} rows={10} width={80} />,
    );
    await settle();
    const marked = lines(lastFrame()).filter((l) => l.startsWith('>'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('beta');
  });

  it('says so rather than drawing nothing when the list is empty', async () => {
    const { lastFrame } = render(
      <IssueList issues={[]} selectedId={null} rows={10} width={80} />,
    );
    await settle();
    expect(lastFrame()).toContain('no issues');
  });

  it('marks the selected row inside a scrolled window', async () => {
    // The window starts at 36, so the selected issue's absolute index (40) is
    // nothing like its position in the slice (4). Marking by slice position
    // marks nothing at all here.
    const many = Array.from({ length: 50 }, (_, n) => ({
      ...three()[0]!,
      id: `01a00000-${String(n).padStart(4, '0')}-7000-8000-000000000000`,
      title: `issue ${n}`,
    }));
    const { lastFrame } = render(
      <IssueList issues={many} selectedId={many[40]!.id} rows={5} width={80} />,
    );
    await settle();
    const marked = lines(lastFrame()).filter((l) => l.startsWith('>'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('issue 40');
  });

  it('keeps the mark on the issue when the list reorders', async () => {
    // Guards the component's *interface*, not its arithmetic. Marking by
    // `from + n === selected` is algebraically identical to marking by id here
    // (`selected` is an id lookup into the same array), so no fixture can
    // separate those two. What this does catch is a change of contract: an
    // IssueList that took a caller-computed `selectedIndex` prop instead of
    // `selectedId` would mark the wrong row as soon as the order changed, and
    // "selection follows the issue, never the position" is a global constraint
    // of this plan.
    const issues = three();
    const target = issues[2]!;
    const { lastFrame } = render(
      <IssueList issues={[...issues].reverse()} selectedId={target.id} rows={10} width={80} />,
    );
    await settle();
    const marked = lines(lastFrame()).filter((l) => l.startsWith('>'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain(target.title);
  });

  it('shows only a window of a long list, containing the selection', async () => {
    const many = Array.from({ length: 50 }, (_, n) => ({
      ...three()[0]!,
      id: `01a00000-${String(n).padStart(4, '0')}-7000-8000-000000000000`,
      title: `issue ${n}`,
    }));
    const { lastFrame } = render(
      <IssueList issues={many} selectedId={many[40]!.id} rows={5} width={80} />,
    );
    await settle();
    const body = lines(lastFrame()).filter((l) => l !== '');
    expect(body).toHaveLength(5);
    expect(lastFrame()).toContain('issue 40');
    expect(lastFrame()).not.toContain('issue 0\n');
  });
});
```

- [ ] **Step 4: Run and watch both fail**

```bash
npm run test --workspace ditz2-ui
```

Expected: FAIL — neither module exists.

- [ ] **Step 5: Write `ui/src/format.ts`**

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { shortId } from 'ditz2';
import type { Issue } from 'ditz2';

const TYPE_WIDTH = 7;
const COMPONENT_WIDTH = 9;

/**
 * Exactly `width` characters, truncating as well as padding. Component names
 * are arbitrary user strings — `dz component add documentation` is legal — and
 * a value that overruns its column shifts every column after it on that row
 * only, which reads as corruption rather than as a long name.
 */
export function pad(value: string, width: number): string {
  if (value.length > width) return truncate(value, width);
  return value + ' '.repeat(width - value.length);
}

export function truncate(value: string, width: number): string {
  if (width <= 0) return '';
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

/**
 * One list row, as a single string.
 *
 * Built here rather than out of JSX children: Ink follows React's whitespace
 * rules, so the spaces between adjacent expressions are easy to lose and hard
 * to assert on. One string is both what is drawn and what a test reads.
 *
 * Truncated to `width` because a row that wraps pushes every row below it out
 * of place, and the frame then no longer corresponds to the list.
 */
export function rowFor(issue: Issue, selected: boolean, width: number): string {
  const row = `${selected ? '>' : ' '} ${shortId(issue.id)}  `
    + `${pad(issue.type, TYPE_WIDTH)}  ${pad(issue.component ?? '-', COMPONENT_WIDTH)}  `
    + `${issue.title}`;
  return truncate(row, width);
}

/**
 * The slice of a list to draw, as a half-open [from, to).
 *
 * Derived from the selected index every render rather than kept as scroll
 * state: a stored offset is a second thing that can disagree with the
 * selection, and it is the selection that is authoritative.
 */
export function windowOf(
  count: number,
  selected: number,
  rows: number,
): { from: number; to: number } {
  if (count <= 0 || rows <= 0) return { from: 0, to: 0 };
  if (count <= rows) return { from: 0, to: count };
  const at = Math.min(Math.max(selected, 0), count - 1);
  const from = Math.min(Math.max(at - rows + 1, 0), count - rows);
  return { from, to: from + rows };
}
```

- [ ] **Step 6: Write `ui/src/components/IssueList.tsx`**

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import type { Issue } from 'ditz2';
import { rowFor, windowOf } from '../format.js';

export interface IssueListProps {
  issues: Issue[];
  selectedId: string | null;
  rows: number;
  width: number;
}

export function IssueList({ issues, selectedId, rows, width }: IssueListProps): React.ReactElement {
  if (issues.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>no issues</Text>
      </Box>
    );
  }

  const selected = issues.findIndex((i) => i.id === selectedId);
  const { from, to } = windowOf(issues.length, selected, rows);

  return (
    <Box flexDirection="column">
      {issues.slice(from, to).map((issue) => (
        <Text
          key={issue.id}
          inverse={issue.id === selectedId}
          wrap="truncate"
        >
          {rowFor(issue, issue.id === selectedId, width)}
        </Text>
      ))}
    </Box>
  );
}
```

`wrap="truncate"` belts what `rowFor` braces: `rowFor` counts characters, while
the terminal counts display columns, and a CJK title or an emoji in a title is
two columns per character. Ink measures properly, so the two together mean a row
cannot wrap even when `rowFor`'s arithmetic is optimistic.

- [ ] **Step 7: Run and watch both pass**

```bash
npm run test --workspace ditz2-ui && npm run typecheck --workspace ditz2-ui
```

Expected: PASS.

- [ ] **Step 8: Prove the checks can fail**

1. Delete the `truncate(row, width)` call in `rowFor`, returning the raw row —
   the "never exceeds the terminal width" test must fail.
1b. Change `issue.component ?? '-'` to `issue.component ?? ''` — the
   component-column test must fail. It is here because the obvious version of
   that test, `toContain('-')`, passes against every possible implementation:
   the short id supplies a hyphen for free.
2. Change `windowOf` to always return `{ from: 0, to: rows }` — the
   "keep the selection visible at the bottom" test and the list window test must
   both fail.
3. Change `IssueList` to mark by position within the slice
   (`.map((issue, n) => n === selected …)`) — "marks the selected row inside a
   scrolled window" must fail, because the selected absolute index lies outside
   the 0..4 range of the slice.
4. Do **not** expect `.map((issue, n) => from + n === selected …)` to fail
   anything. It is not a wrong implementation: `selected` is itself
   `issues.findIndex(i => i.id === selectedId)`, and `slice(from, to)[n]` is
   `issues[from + n]`, so `from + n === selected` and `issue.id === selectedId`
   are the same predicate for any list with unique ids — including a reordered
   one, and including a `selectedId` that is absent (both are false). Checked
   over 690 row comparisons across reversed order, absent ids and five window
   sizes: zero divergences. An earlier revision of this plan claimed the
   reorder test caught this; it does not, and no test can.

- [ ] **Step 9: Lint and commit**

```bash
the formatter and linter
git add ui/src/format.ts ui/src/components ui/tests/helpers.tsx \
  ui/tests/format.test.ts ui/tests/list.test.tsx
git commit ui -m "ditz2-ui: render the issue list, with a derived scroll window"
```

---

### Task 7: Keys, chrome, and the app shell

`app.tsx` binds the reducer to `useInput` and draws header, list and footer.
Every binding in the footer works; nothing that does not work is advertised.
This is where `q` and the navigation keys land.

The bindings, from the spec: `up`/`down` (also `j`/`k`) move; `Home`/`End` (also
`g`/`G`) jump; `PgUp`/`PgDn` (also `Ctrl-U`/`Ctrl-D`) page. `q` quits.
`/`, `r` and `?` arrive in Task 9.

**Files:**
- Create: `ui/src/components/Chrome.tsx`
- Create: `ui/src/app.tsx`
- Test: `ui/tests/app-keys.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 4–6; `Project` from `'ditz2'`.
- Produces:
  - `<Header name={string} shown={number} total={number} query={string} width={number} />`
  - `<Footer keys={string} width={number} />`
  - `<Notice text={string | null} error={string | null} unreadable={number} width={number} />`
  - `<App project={Project} initial={UiState} rows={number} width={number} onExit={() => void} />`

`App` takes `initial: UiState` rather than loading one itself, so a test can
start from any state without touching the disk. `runUi` in Task 10 builds the
initial state from `project.list()` and passes it in.

- [ ] **Step 1: Write the failing tests**

Create `ui/tests/app-keys.test.tsx`:

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { App } from '../src/app.js';
import { initialState } from '../src/state.js';
import type { Project } from 'ditz2';
import { KEY, lines, press, settle } from './helpers.js';
import { three } from './fixtures.js';

/** A Project that fails loudly if the UI calls anything it should not. */
function stubProject(over: Partial<Project> = {}): Project {
  const reject = (): never => { throw new Error('unexpected project call'); };
  return {
    root: '/tmp/demo',
    name: 'demo',
    whoami: () => 'Jane Roe <jane@example.com>',
    list: () => ({ issues: three(), failures: [] }),
    show: reject, grep: reject, add: reject, set: reject,
    comment: reject, close: reject, doctor: reject,
    readForEdit: reject, parseEdit: reject, saveEdited: reject,
    components: { list: reject, add: reject, remove: reject },
    lock: { state: reject, break: reject },
    ...over,
  } as Project;
}

function mount(over: Partial<Project> = {}, onExit = vi.fn()) {
  const r = render(
    <App
      project={stubProject(over)}
      initial={initialState(three(), [])}
      rows={10}
      width={80}
      onExit={onExit}
    />,
  );
  return { ...r, onExit };
}

/** The row the cursor is on, or undefined. */
function marked(frame: string | undefined): string | undefined {
  return lines(frame).find((l) => l.startsWith('>'));
}

describe('navigation', () => {
  it('starts on the first issue', async () => {
    const { lastFrame } = mount();
    await settle();
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('moves with the arrow keys', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.down);
    expect(marked(lastFrame())).toContain('beta');
    await press(stdin, KEY.up);
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('moves with j and k as well', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'j', 'j');
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, 'k');
    expect(marked(lastFrame())).toContain('beta');
  });

  it('jumps to the ends with G and g', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'G');
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, 'g');
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('jumps to the ends with End and Home', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.end);
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, KEY.home);
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('pages with PgDn and Ctrl-D', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.pageDown);
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, KEY.pageUp);
    expect(marked(lastFrame())).toContain('alpha');
    await press(stdin, KEY.ctrlD);
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, KEY.ctrlU);
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('pages by exactly one screen, not to the end', async () => {
    // The three-issue fixture cannot show this. With rows=10 any delta of 2 or
    // more clamps to the last row, so a page of 10, a page of 999 and a jump
    // to the end are indistinguishable. Paging needs a list longer than a page
    // before the magnitude means anything.
    const many = Array.from({ length: 30 }, (_, n) => issue({
      id: `01a00000-${String(n).padStart(4, '0')}-7000-8000-000000000000`,
      title: `issue ${n}`,
    }));
    // rows=20 so the list's own share is exactly 10: floor((20-3)*0.6) = 10.
    // A page is one screenful of the LIST, not of the whole budget, so the
    // assertions below are in units of listRows.
    const { lastFrame, stdin } = render(
      <App project={stubProject()} initial={initialState(many, [])}
        rows={20} width={80} onExit={vi.fn()} />,
    );
    await settle();
    expect(marked(lastFrame())).toContain('issue 0');
    await press(stdin, KEY.pageDown);
    expect(marked(lastFrame())).toContain('issue 10');
    await press(stdin, KEY.pageDown);
    expect(marked(lastFrame())).toContain('issue 20');
    await press(stdin, KEY.pageUp);
    expect(marked(lastFrame())).toContain('issue 10');
  });

  it('stops at the ends instead of wrapping', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, KEY.up, KEY.up);
    expect(marked(lastFrame())).toContain('alpha');
    await press(stdin, 'G', KEY.down, KEY.down);
    expect(marked(lastFrame())).toContain('gamma');
  });
});

describe('chrome', () => {
  it('names the project and counts what is shown', async () => {
    const { lastFrame } = mount();
    await settle();
    expect(lastFrame()).toContain('demo');
    expect(lastFrame()).toContain('3 of 3');
  });

  it('never draws a frame taller than the row budget it was given', async () => {
    // The one check that was missing: every other test asserts on frame
    // *content*. <Detail>'s top border is a chrome row no component returns,
    // so it went unbudgeted and the frame reached exactly the terminal height
    // whenever the status line was showing — at which point Ink clears the
    // whole screen on every render and the UI flickers per keystroke.
    const many = Array.from({ length: 30 }, (_, n) => issue({
      id: `01a00000-${String(n).padStart(4, '0')}-7000-8000-000000000000`,
      title: `issue ${n}`,
    }));
    for (const rows of [12, 20, 23]) {
      for (const notice of [null, 'something happened']) {
        const state = notice === null
          ? initialState(many, [])
          : reducer(initialState(many, []), { type: 'notice', text: notice });
        const { lastFrame } = render(
          <App project={stubProject()} initial={state}
            rows={rows} width={80} onExit={vi.fn()} />,
        );
        await settle();
        expect((lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(rows);
      }
    }
  });

  it('advertises only bindings that work', async () => {
    const { lastFrame } = mount();
    await settle();
    const footer = lines(lastFrame()).at(-1) ?? '';
    expect(footer).toContain('q quit');
    // Plan 2b adds these. A footer that lists a key doing nothing is worse
    // than a footer that is short.
    expect(footer).not.toContain('enter edit');
    expect(footer).not.toContain('c comment');
    expect(footer).not.toContain('x close');
  });

  it('warns about unreadable files rather than showing a short list quietly', async () => {
    const failures = [{ file: 'dz/issues/broken.md', error: new Error('bad') as never }];
    const { lastFrame } = render(
      <App project={stubProject()} initial={initialState(three(), failures)}
        rows={10} width={80} onExit={vi.fn()} />,
    );
    await settle();
    expect(lastFrame()).toContain('1 unreadable');
  });
});

describe('quitting', () => {
  it('calls onExit for q', async () => {
    const { stdin, onExit } = mount();
    await press(stdin, 'q');
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test --workspace ditz2-ui
```

Expected: FAIL — `../src/app.js` does not exist.

- [ ] **Step 3: Write `ui/src/components/Chrome.tsx`**

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Text } from 'ink';
import React from 'react';
import { truncate } from '../format.js';

export function Header(
  { name, shown, total, query, width }:
  { name: string; shown: number; total: number; query: string; width: number },
): React.ReactElement {
  const filter = query.trim() === '' ? '' : `  filter: ${query}`;
  return (
    <Text bold wrap="truncate">
      {truncate(`ditz2 · ${name} · ${shown} of ${total}${filter}`, width)}
    </Text>
  );
}

export function Footer({ keys, width }: { keys: string; width: number }): React.ReactElement {
  return <Text dimColor wrap="truncate">{truncate(keys, width)}</Text>;
}

/**
 * The one status line. An error outranks a notice: a filter the operator typed
 * that ditz2 rejected is the thing they are waiting to hear about.
 */
export function Notice(
  { text, error, unreadable, width }:
  { text: string | null; error: string | null; unreadable: number; width: number },
): React.ReactElement | null {
  const parts = [
    error === null ? null : `filter: ${error}`,
    text,
    unreadable === 0 ? null : `${unreadable} unreadable file${unreadable === 1 ? '' : 's'}`,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return (
    <Text color={error === null ? undefined : 'red'} wrap="truncate">
      {truncate(parts.join('  ·  '), width)}
    </Text>
  );
}
```

- [ ] **Step 4: Write `ui/src/app.tsx`**

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, useInput } from 'ink';
import React, { useReducer } from 'react';
import type { Project } from 'ditz2';
import { Footer, Header, Notice } from './components/Chrome.js';
import { IssueList } from './components/IssueList.js';
import { initialState, reducer, visibleIssues } from './state.js';
import type { UiState } from './state.js';

export interface AppProps {
  project: Project;
  /** Injected rather than loaded here, so a test can start anywhere. */
  initial: UiState;
  /**
   * The whole screen budget App may draw into, NOT the list's share of it.
   * App keeps `CHROME_ROWS` of it back and splits the remainder between the
   * list and the detail pane. See that constant for what those rows are and
   * why the count is easy to get wrong; do not restate the number here.
   * Task 10 derives this value from the terminal height.
   */
  rows: number;
  width: number;
  onExit: () => void;
}

/**
 * Rows the panes never get: header, status line, footer, and the rule
 * <Detail> draws above itself. That fourth one is easy to miss — it is a
 * border on a Box, not a line any component returns — and leaving it out made
 * the frame exactly the terminal height whenever the status line was showing.
 * Ink clears the whole screen on every render once the frame reaches
 * stdout.rows, so the symptom was a flicker on each keystroke, not an overflow.
 */
const CHROME_ROWS = 4;

const LIST_KEYS = 'up/down move  q quit';

export function App({ project, initial, rows, width, onExit }: AppProps): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initial);
  const visible = visibleIssues(state);

  useInput((input, key) => {
    if (key.downArrow || input === 'j') { dispatch({ type: 'move', delta: 1 }); return; }
    if (key.upArrow || input === 'k') { dispatch({ type: 'move', delta: -1 }); return; }
    // A page is one screenful of the list. Until Task 8 splits the panes the
    // list owns the whole budget, so this is `rows`; Task 8 introduces
    // `listRows` and this must follow it, or paging skips the rows the detail
    // pane took.
    if (key.pageDown || (key.ctrl && input === 'd')) {
      dispatch({ type: 'move', delta: rows }); return;
    }
    if (key.pageUp || (key.ctrl && input === 'u')) {
      dispatch({ type: 'move', delta: -rows }); return;
    }
    if (input === 'G' || key.end) { dispatch({ type: 'jump', to: 'last' }); return; }
    if (input === 'g' || key.home) { dispatch({ type: 'jump', to: 'first' }); return; }
    if (input === 'q') { onExit(); }
  });

  return (
    <Box flexDirection="column">
      <Header
        name={project.name}
        shown={visible.length}
        total={state.snapshot.length}
        query={state.query}
        width={width}
      />
      <IssueList
        issues={visible}
        selectedId={state.selectedId}
        rows={rows}
        width={width}
      />
      <Notice
        text={state.notice}
        error={state.queryError}
        unreadable={state.failures.length}
        width={width}
      />
      <Footer keys={LIST_KEYS} width={width} />
    </Box>
  );
}
```

Ink 6.8.0 exposes dedicated `key.home` and `key.end` booleans, alongside
`key.pageUp`/`key.pageDown`. An earlier revision of this plan guessed that
`Home`/`End` arrived as `key.meta` with input `H`/`F`, reasoning from the raw
`ESC [ H` sequence; that guess was wrong and the probe is recorded in Task 7's
report. Read `node_modules/ink/build/hooks/use-input.d.ts` for the full `Key`
shape before binding anything new — it is the cheapest way to settle this class
of question.

- [ ] **Step 5: Run and watch it pass**

```bash
npm run test --workspace ditz2-ui && npm run typecheck --workspace ditz2-ui
```

Expected: PASS. If the `Home`/`End` test fails, print `key` from inside
`useInput` for those sequences and bind whatever Ink actually reports.

- [ ] **Step 6: Prove the checks can fail**

1. Remove the `input === 'j'` alternative — the j/k test must fail.
2. Change `move` clamping in the reducer to wrap around modulo length — the
   "stops at the ends" test must fail.
2b. Change the page delta from `rows` to a literal `999` — "pages by exactly one
   screen" must fail while "pages with PgDn and Ctrl-D" still passes. That pair
   is the point: the older test pins the direction of the binding, the new one
   pins its magnitude, and neither substitutes for the other.
3. Add `enter edit  c comment` to `LIST_KEYS` — the "advertises only bindings
   that work" test must fail. This one matters: the footer is the UI's only
   claim about itself, and the temptation to paste the spec's mock footer in is
   exactly what the test exists to stop.
4. Drop the `<Notice>` `unreadable` part — the unreadable-files test must fail.
5. Set `CHROME_ROWS` back to 3 — "never draws a frame taller than the row
   budget it was given" must fail for the cases that render a status line, and
   only those. Every content assertion in the suite stays green, which is why
   this went unnoticed: the frame was the right shape and the wrong size.

- [ ] **Step 7: Lint and commit**

```bash
the formatter and linter
git add ui/src/app.tsx ui/src/components/Chrome.tsx ui/tests/app-keys.test.tsx
git commit ui -m "ditz2-ui: add the app shell, navigation keys and chrome"
```

---

### Task 8: The detail pane

The lower half of the list screen: the selected issue's title, its fields on one
line, the start of its body, and its most recent log entries. Read-only.

**Files:**
- Create: `ui/src/components/Detail.tsx`
- Modify: `ui/src/format.ts` (add `detailLines`)
- Modify: `ui/src/app.tsx` (mount it under the list)
- Test: `ui/tests/detail.test.tsx`

**Interfaces:**
- Consumes: `Issue`, `LogEntry` from `'ditz2'`; `truncate` and `logLines`
  from within `ui/src/format.ts` itself, where `detailLines` is added.
  `Detail.tsx` imports `detailLines` from `../format.js`.
- Produces:
  - `detailLines(issue: Issue, rows: number, width: number): string[]`
  - `<Detail issue={Issue | null} rows={number} width={number} />`

- [ ] **Step 1: Write the failing tests**

Create `ui/tests/detail.test.tsx`:

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Detail } from '../src/components/Detail.js';
import { detailLines } from '../src/format.js';
import { lines, settle } from './helpers.js';
import { issue } from './fixtures.js';

const full = issue({
  id: '01a00000-0001-7000-8000-000000000001',
  title: 'interactive conflict prompt for dz edit',
  type: 'feature',
  status: 'open',
  component: 'cli',
  body: 'Steps 8-10 of the lock design describe what dz edit should do\nwhen the issue changed underneath the editor.',
  log: [
    { timestamp: '2026-08-24 17:12', author: 'tmikov', verb: 'created', detail: null, text: null },
    { timestamp: '2026-08-25 09:01', author: 'jane', verb: 'commented', detail: null, text: 'agreed' },
  ],
});

describe('detailLines', () => {
  it('leads with the title', () => {
    expect(detailLines(full, 20, 80)[0]).toContain('interactive conflict prompt');
  });

  it('puts status, component and assignee on one line', () => {
    const summary = detailLines(full, 20, 80)[1] ?? '';
    expect(summary).toContain('open');
    expect(summary).toContain('cli');
    expect(summary).toContain('unassigned');
  });

  it('shows the resolution of a closed issue', () => {
    const closed = issue({ ...full, status: 'closed', resolution: 'wontfix' });
    expect(detailLines(closed, 20, 80)[1]).toContain('wontfix');
  });

  it('shows the body', () => {
    expect(detailLines(full, 20, 80).join('\n')).toContain('Steps 8-10');
  });

  it('shows log entries, comment text included', () => {
    const text = detailLines(full, 20, 80).join('\n');
    expect(text).toContain('created');
    expect(text).toContain('agreed');
  });

  it('wraps the title rather than cutting it off', () => {
    const long = issue({
      ...one,
      title: 'A title that is quite long and will certainly not fit inside a narrow pane',
    });
    const out = detailLines(long, 14, 60);
    expect(out.join('\n').includes('…')).toBe(false);
    expect(out.join(' ')).toContain('narrow pane');
  });

  it('wraps a long comment rather than cutting it off', () => {
    const chatty = issue({
      ...one,
      body: 'Short.',
      log: [{
        timestamp: '2026-08-24 17:12', author: 'tmikov', verb: 'commented', detail: null,
        text: 'This comment is a single long paragraph of prose that goes well past '
          + 'any reasonable terminal width and therefore needs reflowing, not cutting.',
      }],
    });
    const out = detailLines(chatty, 14, 60);
    expect(out.some((l) => l.includes('reflowing, not cutting'))).toBe(true);
  });

  it('shows as much of the newest header as fits when the entry cannot', () => {
    // The fallback used to take exactly one display line. Once headers wrap,
    // that can be the date alone — no author, no verb — which is not what the
    // fallback is for.
    const chatty = issue({
      ...one,
      body: '',
      log: [{
        timestamp: '2026-08-24 17:12', author: 'tmikov', verb: 'commented', detail: null,
        text: 'w '.repeat(200).trim(),
      }],
    });
    const out = detailLines(chatty, 10, 30).join(' ');
    expect(out).toContain('tmikov');
  });

  it('budgets the log by display lines, not source lines', () => {
    // A comment that reflows to more lines than LOG_ROOM must be measured
    // after wrapping. Measuring the source line counts it as one, budgets a
    // single row, and then overflows the pane.
    const chatty = issue({
      ...one,
      body: '',
      log: [{
        timestamp: '2026-08-24 17:12', author: 'tmikov', verb: 'commented', detail: null,
        text: 'w '.repeat(120).trim(),
      }],
    });
    expect(detailLines(chatty, 12, 40)).toHaveLength(12);
  });

  it('never exceeds a pane too short to hold its own header', () => {
    // The header is three lines, but App gives the detail pane
    // `rows - 3 - listRows`, which is 2 on a six-row terminal and 1 on a
    // five-row one. Without the final clip the pane renders taller than it was
    // given and pushes the footer off the screen. The other height test uses
    // rows=6, where head + log + clipped body happens to land exactly on the
    // budget, so it never exercises this.
    const short = issue({ ...full, body: 'one\ntwo\nthree' });
    for (const rows of [1, 2, 3, 4, 5, 6]) {
      expect(detailLines(short, rows, 80)).toHaveLength(rows);
    }
  });

  it('never returns more lines than it was given room for', () => {
    // Overflowing pushes the footer off the screen, so this is what keeps the
    // frame the size it claims to be.
    const long = issue({ ...full, body: Array.from({ length: 200 }, (_, n) => `line ${n}`).join('\n') });
    expect(detailLines(long, 6, 80)).toHaveLength(6);
  });

  it('never returns a line wider than it was given room for', () => {
    const wide = issue({ ...full, body: 'x'.repeat(500) });
    for (const line of detailLines(wide, 10, 40)) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  it('says the body is longer than what is shown', () => {
    const long = issue({ ...full, body: Array.from({ length: 200 }, (_, n) => `line ${n}`).join('\n') });
    expect(detailLines(long, 6, 80).join('\n')).toMatch(/more/);
  });

  it('still shows the newest log entry under a body long enough to bury it', () => {
    const long = issue({ ...full, body: Array.from({ length: 200 }, (_, n) => `line ${n}`).join('\n') });
    expect(detailLines(long, 8, 80).join('\n')).toContain('agreed');
  });

  it('pads a nearly empty issue out to its full height', () => {
    expect(detailLines(issue({ id: 'x', title: 't' }), 8, 80)).toHaveLength(8);
  });

  it('never shows comment text without the entry header it belongs to', () => {
    // Five lines of comment into four lines of room. Slicing the flattened log
    // would show "…four / five" with no timestamp, author or verb above it.
    const chatty = issue({
      ...full,
      log: [
        { timestamp: '2026-08-24 17:12', author: 'tmikov', verb: 'created', detail: null, text: null },
        {
          timestamp: '2026-08-25 09:01', author: 'jane', verb: 'commented',
          detail: null, text: 'one\ntwo\nthree\nfour\nfive',
        },
      ],
    });
    const text = detailLines(chatty, 8, 80).join('\n');
    expect(text).toContain('commented');
    expect(text).not.toContain('five');
  });
});

describe('<Detail>', () => {
  it('draws the selected issue', async () => {
    const { lastFrame } = render(<Detail issue={full} rows={10} width={80} />);
    await settle();
    expect(lastFrame()).toContain('interactive conflict prompt');
  });

  it('says nothing is selected rather than drawing an empty box', async () => {
    const { lastFrame } = render(<Detail issue={null} rows={10} width={80} />);
    await settle();
    expect(lines(lastFrame()).join('')).toContain('nothing selected');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test --workspace ditz2-ui
```

Expected: FAIL — `detailLines` and `Detail` do not exist.

- [ ] **Step 3: Add `detailLines` to `ui/src/format.ts`**

```ts
import type { Issue, LogEntry } from 'ditz2';

function logLines(entry: LogEntry): string[] {
  const detail = entry.detail === null ? '' : `: ${entry.detail}`;
  const head = `${entry.timestamp}  ${entry.author}  ${entry.verb}${detail}`;
  if (entry.text === null) return [head];
  return [head, ...entry.text.split('\n').map((l) => `    ${l}`)];
}

/** Lines kept for the newest log entries, however long the body is. */
const LOG_ROOM = 4;

/**
 * The detail pane, as exactly `rows` lines of at most `width` characters.
 *
 * The log is budgeted before the body, and it is the *newest* entries that are
 * kept. Appending body then log and clipping the tail — the obvious order —
 * lets a body of any length hide every comment on the issue, which is the half
 * most likely to have changed since the operator last looked at it.
 *
 * Padded as well as truncated: a pane that shrinks when an issue has no body
 * makes the footer jump around as the cursor moves down the list.
 */
export function detailLines(issue: Issue, rows: number, width: number): string[] {
  const resolution = issue.resolution === null ? '' : ` (${issue.resolution})`;
  const head = [
    issue.title,
    `${issue.status}${resolution} · ${issue.component ?? 'no component'} · `
    + `${issue.assignee ?? 'unassigned'} · ${issue.type}`,
    '',
  ];
  const entries = issue.log.map(logLines);
  const logHeight = entries.reduce((n, e) => n + e.length, 0);
  const body = issue.body === '' ? [] : issue.body.split('\n');

  const logRoom = Math.min(logHeight, LOG_ROOM, Math.max(rows - head.length - 1, 0));

  // Whole entries, newest first. Slicing the flattened lines instead can leave
  // the tail of a multi-line comment with the timestamp, author and verb it
  // belongs to cut off above it — an unattributed fragment of somebody's text,
  // which is worse than not showing the entry at all.
  const shownLog: string[] = [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    if (shownLog.length + entry.length > logRoom) break;
    shownLog.unshift(...entry);
  }
  // Not even the newest entry fits: show as much of its header as there is
  // room for. Once the header itself wraps, one line of it can be just the
  // date — no time, no author, no verb — so take `logRoom` lines rather than
  // exactly one. At a pane narrow enough that even that is a fragment, this
  // says less than it used to; the alternative is showing nothing at all.
  if (shownLog.length === 0 && logRoom > 0 && entries.length > 0) {
    shownLog.push(...entries[entries.length - 1]!.slice(0, logRoom));
  }

  const bodyRoom = Math.max(rows - head.length - shownLog.length, 0);
  const shownBody = body.length <= bodyRoom
    ? body
    : [
      ...body.slice(0, Math.max(bodyRoom - 1, 0)),
      `… ${body.length - bodyRoom + 1} more lines`,
    ];

  const out = [...head, ...shownBody, ...shownLog];
  const padded = [...out, ...Array.from({ length: Math.max(rows - out.length, 0) }, () => '')];
  return padded.slice(0, rows).map((l) => truncate(l, width));
}
```

- [ ] **Step 4: Write `ui/src/components/Detail.tsx`**

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import type { Issue } from 'ditz2';
import { detailLines } from '../format.js';

export function Detail(
  { issue, rows, width }: { issue: Issue | null; rows: number; width: number },
): React.ReactElement {
  // Sliced on both branches, so the pane is exactly `rows` lines whichever
  // one runs. detailLines already guarantees that for itself; without the
  // slice here the empty branch would be the one place the guarantee lapses.
  const body = (issue === null
    ? ['nothing selected', ...Array.from({ length: Math.max(rows - 1, 0) }, () => '')]
    : detailLines(issue, rows, width)).slice(0, Math.max(rows, 0));

  return (
    <Box flexDirection="column" borderStyle="single" borderBottom={false}
      borderLeft={false} borderRight={false}>
      {body.map((line, n) => (
        // The index is a legitimate key here: these are positional slots in a
        // fixed-height pane, not identified rows, and slot n is always slot n.
        // eslint-disable-next-line react/no-array-index-key
        <Text key={n} wrap="truncate" dimColor={n > 1}>{line === '' ? ' ' : line}</Text>
      ))}
    </Box>
  );
}
```

- [ ] **Step 5: Mount it in `ui/src/app.tsx`**

Split the available rows between the two panes. Add near the top of `App`:

```tsx
  // Two panes plus header, status line and footer. The list gets the larger
  // half because the detail pane reports how much it clipped and the list
  // cannot. The three-row reservation is deliberately unconditional even
  // though <Notice> renders nothing when there is nothing to say: erring one
  // row short wastes a line, while erring one row long makes Ink scroll the
  // frame and the display stops matching the state.
  const listRows = Math.max(Math.floor((rows - CHROME_ROWS) * 0.6), 1);
  const detailRows = Math.max(rows - CHROME_ROWS - listRows, 1);
```

**Paging must follow the split.** The `move` deltas for `PgUp`/`PgDn` and
`Ctrl-U`/`Ctrl-D` were `rows` when the list owned the whole budget; they become
`listRows` here. Leaving them at `rows` makes a page jump further than the list
shows — on a 24-row terminal the list displays 12 and a page would move 24,
skipping 12 issues the operator never saw. Task 7's "pages by exactly one
screen" test pins this and moves to `rows={20}`, where the list's share is
exactly 10 and its assertions still read in units of a page.

Change `<IssueList ... rows={listRows} ... />`, and insert between the list and
`<Notice>`:

```tsx
      <Detail issue={selectedIssue(state)} rows={detailRows} width={width} />
```

importing `Detail` and adding `selectedIssue` to the `./state.js` import.

- [ ] **Step 6: Run and watch it pass**

```bash
npm run test --workspace ditz2-ui && npm run typecheck --workspace ditz2-ui
```

Expected: PASS, including the Task 7 key tests — the pane must not have changed
what `marked()` finds.

- [ ] **Step 7: Prove the checks can fail**

1. Drop the final `.slice(0, rows)` from `detailLines` — the "never more lines"
   test must fail.
2. Drop the padding (`return out.slice(0, rows)`) — the "pads a nearly empty
   issue" test must fail.
2b. Drop the final `.slice(0, rows)` while keeping the padding — the "pane too
   short to hold its own header" test must fail for `rows` of 1, 2 and 3. The
   clip is not redundant with the arithmetic above it: the header is a fixed
   three lines, and a non-empty body always contributes at least the "… N more
   lines" marker even when `bodyRoom` is 0.
3. Drop `truncate` from the final `map` — the "never wider" test must fail.
4. **Budget the body first** — compute `bodyRoom` from `rows - head.length`
   before reserving any room for the log, then give the log whatever survives.
   The "newest log entry under a body long enough to bury it" test must fail.
   Reordering the final concatenation to `[...head, ...shownLog, ...shownBody]`
   does **not** work as a breakage and an earlier revision of this plan wrongly
   said it did: the budgeting happens before the concatenation, so changing
   display order alone leaves every line present and every test green.
5. Replace the whole-entry loop with `log.flatMap(logLines).slice(-logRoom)` —
   the "never shows comment text without the entry header" test must fail. This
   is the other one.

- [ ] **Step 8: Lint and commit**

```bash
the formatter and linter
git add ui/src/components/Detail.tsx ui/tests/detail.test.tsx
git commit ui -m "ditz2-ui: add the detail pane"
```

---

### Task 9: The filter field, refresh, and help

The three remaining list-screen keys. `/` opens a single-line field that keeps
arrow navigation live; `r` reloads the snapshot; `?` lists every binding.

No `ink-text-input` dependency. It is single-line, which is all that is needed,
but it is also another package for something that is twenty lines of `useInput`
— and the field has to keep the arrow keys for navigation anyway, which is not
what a text input does.

**The snapshot is loaded with `{ all: true }`.** `applyFilter` hides closed
issues unless asked, so a snapshot loaded with the default filter physically
does not contain the closed issues that `all:true` in the field is supposed to
reveal. Loading everything once and narrowing in memory is the whole point of
the snapshot model.

**Files:**
- Create: `ui/src/components/FilterField.tsx`, `ui/src/components/HelpOverlay.tsx`
- Modify: `ui/src/app.tsx`
- Test: `ui/tests/app-filter.test.tsx`

**Interfaces:**
- Consumes: the reducer's `openFilter`, `setQuery`, `closeFilter`,
  `clearFilter`, `toggleHelp`, `scrollHelp`, `snapshot` and `notice` actions,
  and `state.helpOffset`.
- Produces:
  - `<FilterField query={string} width={number} />`
  - `<HelpOverlay rows={number} offset={number} width={number} />`
  - `HELP_LINES: number` and `maxHelpOffset(rows: number): number`, both from
    `ui/src/components/HelpOverlay.tsx` — `App` needs them to clamp scrolling
    without holding its own copy of how tall the bindings list is.
  - `SNAPSHOT_FILTER: Filter` exported from `ui/src/state.ts`, the `{ all: true }`
    every load uses.

- [ ] **Step 1: Write the failing tests**

Create `ui/tests/app-filter.test.tsx`:

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { App } from '../src/app.js';
import { initialState, SNAPSHOT_FILTER } from '../src/state.js';
import type { Filter, Project } from 'ditz2';
import { KEY, lines, press, settle } from './helpers.js';
import { issue, three } from './fixtures.js';

function stub(list: Project['list']): Project {
  const reject = (): never => { throw new Error('unexpected project call'); };
  return {
    root: '/tmp/demo', name: 'demo',
    whoami: () => 'Jane Roe <jane@example.com>',
    list,
    show: reject, grep: reject, add: reject, set: reject, comment: reject,
    close: reject, doctor: reject, readForEdit: reject, parseEdit: reject,
    saveEdited: reject,
    components: { list: reject, add: reject, remove: reject },
    lock: { state: reject, break: reject },
  } as Project;
}

function mount(project = stub(() => ({ issues: three(), failures: [] })), rows = 14) {
  return render(
    <App project={project} initial={initialState(three(), [])}
      rows={rows} width={80} onExit={vi.fn()} />,
  );
}

const marked = (f: string | undefined): string | undefined =>
  lines(f).find((l) => l.startsWith('>'));
const rows = (f: string | undefined): string[] =>
  lines(f).filter((l) => /^[ >] 01a00000/.test(l));

describe('the / filter field', () => {
  it('narrows the list as it is typed', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', 'b', 'e', 't', 'a');
    expect(rows(lastFrame())).toHaveLength(1);
    expect(lastFrame()).toContain('beta');
  });

  it('shows what has been typed', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', 't', 'y', 'p', 'e', ':', 'b', 'u', 'g');
    expect(lastFrame()).toContain('type:bug');
    expect(rows(lastFrame())).toHaveLength(1);
  });

  it('keeps the arrow keys moving the selection while the field is open', async () => {
    // The whole reason arrows are the documented bindings: j and k are text
    // in here by definition.
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', KEY.down);
    expect(marked(lastFrame())).toContain('beta');
  });

  it('types j and k as text rather than moving', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', 'j', 'k');
    expect(lastFrame()).toContain('jk');
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('deletes with backspace', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', 'b', 'e', 'z', KEY.backspace);
    expect(rows(lastFrame())).toHaveLength(1);
    expect(lastFrame()).toContain('beta');
  });

  it('leaves the field on enter, keeping the filter', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', 'b', 'e', 't', 'a', KEY.enter);
    expect(rows(lastFrame())).toHaveLength(1);
    // Back on the list: j moves again instead of typing.
    await press(stdin, 'j');
    expect(lastFrame()).not.toContain('betaj');
  });

  it('clears the filter on escape', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', 'b', 'e', 't', 'a', KEY.escape);
    expect(rows(lastFrame())).toHaveLength(3);
  });

  it('reports a rejected filter without emptying the list', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', 's', 't', 'a', 't', 'u', 's', ':', 'x');
    // Not `toContain('status')`, and not `toContain('filter:')` either: the
    // field echoes the typed text and the header repeats it under the same
    // label, so both pass whether validation ran or not. This phrase can only
    // come from the DzError applyFilter raises.
    expect(lastFrame()).toContain('is not a valid status');
    expect(rows(lastFrame())).toHaveLength(3);
  });

  it('keeps Home and End working inside the filter field', async () => {
    // Same reasoning as the arrows: these are keys, not text. Leaving them out
    // of the shared block made them dead only while the field was open.
    const { lastFrame, stdin } = mount();
    await press(stdin, '/', KEY.end);
    expect(marked(lastFrame())).toContain('gamma');
    await press(stdin, KEY.home);
    expect(marked(lastFrame())).toContain('alpha');
  });

  it('scrolls help with Ctrl-D and Ctrl-U, as its own text promises', async () => {
    const { lastFrame, stdin } = mount(undefined, 12);
    await press(stdin, '?');
    expect(lastFrame()).not.toContain('all:true');
    await press(stdin, KEY.ctrlD);
    expect(lastFrame()).toContain('all:true');
    await press(stdin, KEY.ctrlU);
    expect(lastFrame()).not.toContain('all:true');
  });

  it('does not quit on q while the field is open', async () => {
    const onExit = vi.fn();
    const { stdin } = render(
      <App project={stub(() => ({ issues: three(), failures: [] }))}
        initial={initialState(three(), [])} rows={14} width={80} onExit={onExit} />,
    );
    await press(stdin, '/', 'q');
    expect(onExit).not.toHaveBeenCalled();
  });
});

describe('r refresh', () => {
  it('replaces the snapshot', async () => {
    const extra = issue({ id: '01a00000-0009-7000-8000-000000000009', title: 'delta' });
    // Always the longer list. App does not load on mount — its initial state is
    // injected — so pressing r is the FIRST call to list(), and a fixture that
    // returns three() on call 1 would test nothing.
    const project = stub(() => ({ issues: [...three(), extra], failures: [] }));
    const { lastFrame, stdin } = mount(project);
    await press(stdin, 'r');
    expect(rows(lastFrame())).toHaveLength(4);
    expect(lastFrame()).toContain('delta');
  });

  it('asks for everything, so that all:true can reveal closed issues', async () => {
    // A snapshot loaded with the default filter has no closed issues in it, so
    // no amount of in-memory filtering can show them.
    const seen: (Filter | undefined)[] = [];
    const project = stub((f) => { seen.push(f); return { issues: three(), failures: [] }; });
    const { stdin } = mount(project);
    await press(stdin, 'r');
    expect(seen).toEqual([SNAPSHOT_FILTER]);
    expect(SNAPSHOT_FILTER).toEqual({ all: true });
  });

  it('keeps the filter across a refresh', async () => {
    const project = stub(() => ({ issues: three(), failures: [] }));
    const { lastFrame, stdin } = mount(project);
    await press(stdin, '/', 'b', 'e', 't', 'a', KEY.enter, 'r');
    expect(rows(lastFrame())).toHaveLength(1);
  });

  it('reports a failed reload instead of crashing out of the UI', async () => {
    const project = stub(() => { throw new Error('disk on fire'); });
    const { lastFrame, stdin } = mount(project);
    await press(stdin, 'r');
    expect(lastFrame()).toContain('disk on fire');
    expect(rows(lastFrame())).toHaveLength(3);
  });

  it('stops reporting the failure once a later refresh works', async () => {
    // A status line that keeps showing the last error is a UI that lies about
    // the state of the disk for the rest of the session.
    let fail = true;
    const project = stub(() => {
      if (fail) throw new Error('disk on fire');
      return { issues: three(), failures: [] };
    });
    const { lastFrame, stdin } = mount(project);
    await press(stdin, 'r');
    expect(lastFrame()).toContain('disk on fire');
    fail = false;
    await press(stdin, 'r');
    expect(lastFrame()).not.toContain('disk on fire');
  });
});

describe('? help', () => {
  it('lists every binding, including the ones the footer has no room for', async () => {
    const { lastFrame, stdin } = mount(undefined, 30);
    await press(stdin, '?');
    const frame = lastFrame() ?? '';
    for (const binding of ['j', 'k', 'g', 'G', '/', 'r', 'q', 'assignee:me', 'all:true']) {
      expect(frame).toContain(binding);
    }
  });

  it('stays inside a short terminal instead of scrolling the chrome away', async () => {
    // The bindings are 14 lines. A 12-row terminal cannot show them, and an
    // overlay that overflows pushes the header and footer off the screen —
    // which loses the operator more than a scrollable help does.
    const { lastFrame, stdin } = mount(undefined, 12);
    await press(stdin, '?');
    const frame = lines(lastFrame());
    expect(frame.length).toBeLessThanOrEqual(12);
    expect(frame.join('\n')).toContain('more');
    expect(frame.at(-1)).toContain('q quit');
  });

  it('reaches the bindings it had no room for', async () => {
    // A "… 5 more" that nothing can reveal names a number and withholds the
    // answer. Scrolling is what makes the truncation acceptable.
    const { lastFrame, stdin } = mount(undefined, 12);
    await press(stdin, '?');
    expect(lastFrame()).not.toContain('all:true');
    await press(stdin, KEY.down, KEY.down, KEY.down, KEY.down, KEY.down, KEY.down);
    expect(lastFrame()).toContain('all:true');
  });

  it('does not move the issue selection while help is open', async () => {
    const { lastFrame, stdin } = mount(undefined, 12);
    await press(stdin, '?', KEY.down, KEY.down, '?');
    // Back on the list, still on the first issue: the arrows scrolled help.
    expect(lines(lastFrame()).find((l) => l.startsWith('>'))).toContain('alpha');
  });

  it('closes again', async () => {
    const { lastFrame, stdin } = mount(undefined, 30);
    await press(stdin, '?', '?');
    expect(lastFrame()).not.toContain('assignee:me');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test --workspace ditz2-ui
```

Expected: FAIL — `SNAPSHOT_FILTER` and the two components do not exist.

- [ ] **Step 3: Export `SNAPSHOT_FILTER` from `ui/src/state.ts`**

```ts
/**
 * What every load asks for.
 *
 * Everything, closed issues included. applyFilter hides closed issues unless
 * asked, so narrowing at load time would put them beyond the reach of the
 * in-memory filter — `all:true` in the field would silently show nothing new.
 */
export const SNAPSHOT_FILTER: Filter = { all: true };
```

- [ ] **Step 4: Write the two components**

`ui/src/components/FilterField.tsx`:

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Text } from 'ink';
import React from 'react';
import { truncate } from '../format.js';

export function FilterField(
  { query, width }: { query: string; width: number },
): React.ReactElement {
  return <Text wrap="truncate">{truncate(`/${query}█`, width)}</Text>;
}
```

`ui/src/components/HelpOverlay.tsx`:

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';

const HELP: readonly (readonly [string, string])[] = [
  ['up / down, j / k', 'move'],
  ['Home / End, g / G', 'first / last'],
  ['PgUp / PgDn, ^U / ^D', 'page'],
  ['/', 'filter; enter keeps it, esc clears it'],
  ['r', 'reload from disk'],
  ['?', 'this list; up/down scrolls it'],
  ['q', 'quit'],
  ['', ''],
  ['in the filter field', 'bare words are a regex over titles, bodies and log'],
  ['status:open', 'also in-progress, closed'],
  ['type:bug', 'also feature, task'],
  ['component:cli', 'as configured in dz/config.yaml'],
  ['assignee:me', 'you, as dz records you'],
  ['all:true', 'include closed issues'],
];

/** How many lines the bindings occupy. App needs it to bound scrolling. */
export const HELP_LINES = HELP.length;

/** The furthest `offset` that still shows something, given `rows` of room. */
export function maxHelpOffset(rows: number): number {
  return Math.max(HELP_LINES - Math.max(rows - 1, 1), 0);
}

/**
 * Takes a row budget, stays inside it, and scrolls.
 *
 * No border, and it replaces the list and the detail pane together rather than
 * just the pane: the bindings are 14 lines and a short terminal's detail pane
 * is far fewer, so an overlay sized to the pane would push the header and
 * footer off the screen.
 *
 * Scrolling rather than only marking the overflow. A "… 5 more" that nothing
 * can reveal tells the operator that five bindings exist and refuses to name
 * them, which is a worse answer than a longer scroll.
 */
export function HelpOverlay(
  { rows, offset, width }: { rows: number; offset: number; width: number },
): React.ReactElement {
  const all = HELP.map(([key, what]) => (key === '' ? '' : `  ${key.padEnd(22)}${what}`));

  if (all.length <= rows) {
    return (
      <Box flexDirection="column" width={Math.min(width, 72)}>
        {all.map((line, n) => (
          // eslint-disable-next-line react/no-array-index-key
          <Text key={n} wrap="truncate">{line === '' ? ' ' : line}</Text>
        ))}
      </Box>
    );
  }

  // One row goes to the scroll indicator, which is also where the remaining
  // count lives.
  const room = Math.max(rows - 1, 1);
  const at = Math.min(Math.max(offset, 0), Math.max(all.length - room, 0));
  const shown = all.slice(at, at + room);
  const left = all.length - at - shown.length;

  return (
    <Box flexDirection="column" width={Math.min(width, 72)}>
      {shown.map((line, n) => (
        // eslint-disable-next-line react/no-array-index-key
        <Text key={n} wrap="truncate">{line === '' ? ' ' : line}</Text>
      ))}
      <Text dimColor wrap="truncate">
        {left > 0 ? `  ↓ ${left} more — up/down to scroll` : '  ↑ up to scroll back'}
      </Text>
    </Box>
  );
}
```

- [ ] **Step 5: Wire them into `ui/src/app.tsx`**

Replace the `useInput` body so the filter field takes priority, and add a
`refresh` callback:

```tsx
  const me = React.useMemo(() => meAs(project.whoami()), [project]);

  const refresh = React.useCallback(() => {
    try {
      const { issues, failures } = project.list(SNAPSHOT_FILTER);
      dispatch({ type: 'snapshot', issues, failures });
    } catch (err) {
      // A refresh that throws must not take the UI down with it: the snapshot
      // already on screen is still perfectly readable.
      dispatch({ type: 'notice', text: `refresh failed: ${(err as Error).message}` });
    }
  }, [project]);

  useInput((input, key) => {
    // Help first, because it takes the arrow keys for its own scrolling. If
    // the generic arrow handling below ran first, the keys would move a
    // selection nobody can see while the help sat still.
    if (state.overlay?.kind === 'help') {
      const max = maxHelpOffset(listRows + detailRows);
      if (key.downArrow || input === 'j') { dispatch({ type: 'scrollHelp', delta: 1, max }); return; }
      if (key.upArrow || input === 'k') { dispatch({ type: 'scrollHelp', delta: -1, max }); return; }
      // Ctrl-U/Ctrl-D as well as PgUp/PgDn: the help text lists them as one
      // binding, and a help screen that does not obey its own entry is the
      // same defect as a footer naming a key that does nothing.
      if (key.pageDown || (key.ctrl && input === 'd')) {
        dispatch({ type: 'scrollHelp', delta: listRows + detailRows, max }); return;
      }
      if (key.pageUp || (key.ctrl && input === 'u')) {
        dispatch({ type: 'scrollHelp', delta: -(listRows + detailRows), max }); return;
      }
      if (key.home) { dispatch({ type: 'scrollHelp', delta: -max, max }); return; }
      if (key.end) { dispatch({ type: 'scrollHelp', delta: max, max }); return; }
      if (input === '?' || key.escape || input === 'q') dispatch({ type: 'toggleHelp' });
      return;
    }

    // Navigation that works in the list and inside the filter field alike.
    // These are keys rather than text, which is exactly why they are the
    // documented bindings and j/k/g/G are only the aliases — in the field
    // every letter is text by definition. Home and End belong here for the
    // same reason as the arrows; leaving them out made them dead keys in the
    // field while the arrows kept working.
    if (key.downArrow) { dispatch({ type: 'move', delta: 1 }); return; }
    if (key.upArrow) { dispatch({ type: 'move', delta: -1 }); return; }
    if (key.pageDown) { dispatch({ type: 'move', delta: listRows }); return; }
    if (key.pageUp) { dispatch({ type: 'move', delta: -listRows }); return; }
    if (key.home) { dispatch({ type: 'jump', to: 'first' }); return; }
    if (key.end) { dispatch({ type: 'jump', to: 'last' }); return; }

    if (state.overlay?.kind === 'filter') {
      if (key.return) { dispatch({ type: 'closeFilter' }); return; }
      if (key.escape) {
        dispatch({ type: 'clearFilter' });
        dispatch({ type: 'closeFilter' });
        return;
      }
      if (key.backspace || key.delete) {
        dispatch({ type: 'setQuery', text: state.query.slice(0, -1), me });
        return;
      }
      // Control characters are not text. Without this, a stray ^C or an
      // unhandled escape sequence lands in the filter as garbage.
      if (input !== '' && !key.ctrl && !key.meta) {
        dispatch({ type: 'setQuery', text: state.query + input, me });
      }
      return;
    }

    if (input === 'j') { dispatch({ type: 'move', delta: 1 }); return; }
    if (input === 'k') { dispatch({ type: 'move', delta: -1 }); return; }
    if (key.ctrl && input === 'd') { dispatch({ type: 'move', delta: listRows }); return; }
    if (key.ctrl && input === 'u') { dispatch({ type: 'move', delta: -listRows }); return; }
    if (input === 'G') { dispatch({ type: 'jump', to: 'last' }); return; }
    if (input === 'g') { dispatch({ type: 'jump', to: 'first' }); return; }
    if (input === '/') { dispatch({ type: 'openFilter' }); return; }
    if (input === 'r') { refresh(); return; }
    if (input === '?') { dispatch({ type: 'toggleHelp' }); return; }
    if (input === 'q') { onExit(); }
  });
```

Add the imports `meAs` from `./query.js`, `SNAPSHOT_FILTER` from `./state.js`,
and `HelpOverlay` plus `maxHelpOffset` from `./components/HelpOverlay.js`, along
with `FilterField`. Move `<IssueList>` and `<Detail>` into a fragment that the help overlay
replaces wholesale — help needs both panes' rows — and render the filter field
in place of the footer:

```tsx
      {state.overlay?.kind === 'help'
        ? (
          <HelpOverlay
            // The issue screen has no detail border, so its body is a row
            // taller than the list screen's two panes. Passing the list's
            // budget from either screen wasted that row.
            rows={state.screen === 'issue' ? rows - CHROME_ROWS : listRows + detailRows}
            offset={state.helpOffset}
            width={width}
          />
        )
        : (
          <>
            <IssueList issues={visible} selectedId={state.selectedId}
              rows={listRows} width={width} />
            <Detail issue={selectedIssue(state)} rows={detailRows} width={width} />
          </>
        )}
      <Notice ... />
      {state.overlay?.kind === 'filter'
        ? <FilterField query={state.query} width={width} />
        : <Footer keys={LIST_KEYS} width={width} />}
```

and widen `LIST_KEYS` to `'up/down move  / filter  r refresh  ? help  q quit'`.

- [ ] **Step 6: Run and watch it pass**

```bash
npm run test --workspace ditz2-ui && npm run typecheck --workspace ditz2-ui
```

Expected: PASS, including every earlier test.

- [ ] **Step 7: Prove the checks can fail**

1. Change `refresh` to call `project.list()` with no argument — the
   "asks for everything" test must fail. This is the one most likely to be got
   wrong and the least visible when it is.
2. Move the filter-overlay branch above the arrow-key handling — the "keeps the
   arrow keys moving" test must fail.
3. Remove the `try`/`catch` in `refresh` — the failed-reload test must fail
   (the render throws).
4. Drop `notice: null` from the reducer's `snapshot` case — "stops reporting
   the failure once a later refresh works" must fail, while every other refresh
   test stays green.
5. Handle `q` before the overlay branch — the "does not quit on q" test must
   fail.
6. Change `escape` in the field to `closeFilter` only — the "clears the filter
   on escape" test must fail.
7. Give `HelpOverlay` back a fixed height (drop the `rows` clipping) — the
   short-terminal test must fail.
8. Move the help branch back below the arrow handling — "reaches the bindings
   it had no room for" and "does not move the issue selection" must both fail.
9. Drop `key.home`/`key.end` from the shared navigation block — **two** tests
   must fail: "keeps Home and End working inside the filter field" and
   `app-keys.test.tsx`'s "jumps to the ends with End and Home", which sends the
   real keys rather than letters. "jumps to the ends with G and g" must stay
   green, since the letter aliases live in the list branch and are independent.
   (An earlier revision of this step claimed `g`/`G` covered the list case and
   only the new test would fail. That was wrong — the two are separate tests
   exercising separate bindings.)
10. Drop the `key.ctrl` alternatives from the help branch's paging — "scrolls
   help with Ctrl-D and Ctrl-U" must fail.

- [ ] **Step 8: Lint and commit**

```bash
the formatter and linter
git add ui/src/components/FilterField.tsx ui/src/components/HelpOverlay.tsx \
  ui/tests/app-filter.test.tsx
git commit ui -m "ditz2-ui: add the filter field, refresh and the help overlay"
```

---

### Task 10: The entry points, and running it for real

Everything so far has been tested against `ink-testing-library`, which renders
to a string. This task builds the two real entry points and runs the built
binaries in a real pty against a real project on disk.

That distinction has already cost this project twice: `link(2)` failed on a FUSE-backed checkout
while 291 tests passed, and `uuid@11`'s global `crypto` was polyfilled by vitest
and absent from the built binary. A UI that only ever renders to a string is the
same shape of gap.

**Files:**
- Rename: `ui/src/index.ts` → `ui/src/index.tsx` (it gains JSX)
- Create: `ui/src/main.ts` (the `dzui` bin)
- Create: `ui/README.md`
- Modify: `ui/package.json` (restore the `chmod` in `build`)
- Modify: `README.md`, `HANDOFF.md`
- Test: `ui/tests/e2e.test.ts`

**Interfaces:**
- Produces: `runUi(opts: RunUiOptions): Promise<number>` — the real one, which
  `dz ui` from Task 3 already calls.

- [ ] **Step 1: Write the failing end-to-end test**

Create `ui/tests/e2e.test.ts`:

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The built binaries, in a pty, against a project on disk.
 *
 * ink-testing-library renders to a string, which is exactly the environment
 * gap that hid the link(2) and global-crypto failures in this repository. Ink
 * needs a real terminal: it queries the tty for its size and puts stdin into
 * raw mode, neither of which a pipe supports. `script -qec` allocates one, the
 * same technique tests/cli/edit-conflict.test.ts already uses.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const DZ = path.resolve(here, '..', '..', 'dist', 'cli', 'main.js');
const DZUI = path.resolve(here, '..', 'dist', 'main.js');

const shq = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;

/** ANSI escapes carry cursor moves and colour; assertions want the text. */
function strip(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '').replace(/\u001B[()][AB0]/g, '');
}

interface Run { text: string; code: number; timedOut: boolean }

function pty(argv: string[], cwd: string, input: string): Run {
  const cmd = argv.map(shq).join(' ');
  const r = spawnSync('script', ['-qec', cmd, '/dev/null'], {
    cwd,
    input,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      DZ_AUTHOR: 'Test User <test@example.com>',
      TERM: 'xterm-256color',
      COLUMNS: '100',
      LINES: '30',
    },
  });
  return {
    text: strip(`${r.stdout ?? ''}${r.stderr ?? ''}`),
    code: r.status ?? 1,
    timedOut: r.signal !== null,
  };
}

function project<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-ui-e2e-'));
  try {
    const run = (args: string[]): void => {
      const r = spawnSync(process.execPath, [DZ, ...args], {
        cwd: dir, encoding: 'utf8',
        env: { ...process.env, DZ_AUTHOR: 'Test User <test@example.com>' },
      });
      if (r.status !== 0) throw new Error(`dz ${args.join(' ')} failed: ${r.stderr}`);
    };
    run(['init', '--name', 'bench']);
    run(['component', 'add', 'cli']);
    run(['add', 'sqlite cache for list and grep', '--type', 'feature']);
    run(['add', 'a bug about tokenizers', '--type', 'bug', '--component', 'cli']);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('the UI in a real terminal', () => {
  it('draws the backlog and quits on q', () => {
    project((dir) => {
      const r = pty([process.execPath, DZUI], dir, 'q');
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(0);
      expect(r.text).toContain('bench');
      expect(r.text).toContain('sqlite cache for list and grep');
      expect(r.text).toContain('a bug about tokenizers');
    });
  });

  it('is reachable through dz ui', () => {
    project((dir) => {
      const r = pty([process.execPath, DZ, 'ui'], dir, 'q');
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(0);
      expect(r.text).toContain('sqlite cache for list and grep');
    });
  });

  it('filters what it drew', () => {
    project((dir) => {
      const r = pty([process.execPath, DZUI], dir, '/tokeni\rq');
      expect(r.timedOut).toBe(false);
      // The last frame is what the operator is left looking at.
      const final = r.text.slice(r.text.lastIndexOf('bench'));
      expect(final).toContain('a bug about tokenizers');
      expect(final).not.toContain('sqlite cache');
    });
  });

  it('draws something on a terminal that reports no size at all', () => {
    // Every other test here sets COLUMNS and LINES, so none of them can catch
    // this: a pty with no winsize reports 0, Ink measures its root container
    // straight from process.stdout, and the frame comes out empty while the
    // process sits there looking hung.
    project((dir) => {
      const r = pty([process.execPath, DZUI], dir, 'q', { COLUMNS: undefined, LINES: undefined });
      expect(r.timedOut).toBe(false);
      expect(r.text).toContain('sqlite cache for list and grep');
    });
  });

  it('refuses to open outside a project, with the same error dz uses', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-ui-none-'));
    try {
      const r = pty([process.execPath, DZUI], dir, 'q');
      expect(r.code).toBe(1);
      expect(r.text).toContain('no dz/config.yaml');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run build && npm run test --workspace ditz2-ui
```

Expected: FAIL — `ui/dist/main.js` does not exist.

- [ ] **Step 3: Write `ui/src/index.tsx`**

Rename `ui/src/index.ts` to `ui/src/index.tsx` with `git mv`, then replace its
contents:

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { render, useStdout } from 'ink';
import React from 'react';
import { openProject } from 'ditz2';
import type { Project } from 'ditz2';
import { App } from './app.js';
import { initialState, SNAPSHOT_FILTER } from './state.js';

export interface RunUiOptions {
  cwd: string;
  env: Record<string, string | undefined>;
}

const DEFAULT_ROWS = 24;
const DEFAULT_COLUMNS = 80;

/** Re-renders on SIGWINCH; without it a resize leaves a frame the wrong size. */
function Root({ project, onExit }: { project: Project; onExit: () => void }): React.ReactElement {
  const { stdout } = useStdout();
  const read = React.useCallback(() => ({
    rows: stdout.rows ?? DEFAULT_ROWS,
    columns: stdout.columns ?? DEFAULT_COLUMNS,
  }), [stdout]);

  const [size, setSize] = React.useState(read);
  React.useEffect(() => {
    const onResize = (): void => { setSize(read()); };
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout, read]);

  const initial = React.useMemo(() => {
    const { issues, failures } = project.list(SNAPSHOT_FILTER);
    return initialState(issues, failures);
  }, [project]);

  return (
    <App
      project={project}
      initial={initial}
      // One row short of the terminal on purpose, and independent of how many
      // rows App itself holds back: <Notice> is conditional, so the frame
      // lands one or two rows below the terminal height rather than risking
      // the row that would make Ink clear and redraw the whole screen on
      // every render.
      rows={size.rows - 1}
      width={size.columns}
      onExit={onExit}
    />
  );
}

/**
 * Opens the project and gives Ink the terminal.
 *
 * lockTimeoutMs is 0 and must stay 0. acquireLock otherwise retries with
 * Atomics.wait for up to two seconds of synchronous blocking, during which Ink
 * cannot repaint, cannot read a keystroke, and — because Ink registers a
 * signal-exit handler that suppresses Node's default terminate — cannot be
 * interrupted with Ctrl-C either. Nothing here writes, so nothing should reach
 * a lock; the setting is what keeps that true when plan 2b adds mutations.
 */
export async function runUi(opts: RunUiOptions): Promise<number> {
  // A pty with no winsize reports rows and columns as 0 rather than undefined,
  // and Ink measures its root container from process.stdout directly — so a
  // zero there renders a blank screen that looks like a hang, whatever sizes
  // the components are handed. Observed under `script` with COLUMNS and LINES
  // unset, which is also what some CI runners give you. Normalising the stream
  // is the only lever, because Ink does not take dimensions as options.
  if (!(process.stdout.columns > 0)) process.stdout.columns = DEFAULT_COLUMNS;
  if (!(process.stdout.rows > 0)) process.stdout.rows = DEFAULT_ROWS;

  const project = openProject(opts.cwd, { env: opts.env, lockTimeoutMs: 0 });
  const instance = render(<Root project={project} onExit={() => { instance.unmount(); }} />);
  await instance.waitUntilExit();
  return 0;
}
```

- [ ] **Step 4: Write `ui/src/main.ts`**

```ts
#!/usr/bin/env node
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DzError } from 'ditz2';
import { runUi } from './index.js';

async function main(): Promise<void> {
  // dz ui makes the same check before importing this package, so that it does
  // not load Ink only to refuse. The message differs because the remedy does:
  // there it is "use the commands", here it is "you ran the wrong binary".
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    process.stderr.write('dzui: needs an interactive terminal on stdin and stdout\n');
    process.exitCode = 1;
    return;
  }

  try {
    process.exitCode = await runUi({ cwd: process.cwd(), env: process.env });
  } catch (err) {
    // The same exit codes dz uses: 1 for anything the operator can fix.
    const message = err instanceof DzError || err instanceof Error
      ? err.message
      : String(err);
    process.stderr.write(`dzui: ${message}\n`);
    process.exitCode = err instanceof DzError ? 1 : 3;
  }
}

void main();
```

- [ ] **Step 5: Restore the `chmod` in `ui/package.json`**

```json
    "build": "tsc -p tsconfig.json && chmod +x dist/main.js",
```

- [ ] **Step 6: Run and watch it pass**

```bash
npm run build && npm run test --workspace ditz2-ui
```

Expected: PASS. If `script -qec` is unavailable, stop and report it rather than
weakening the test to a pipe — a pipe cannot exercise Ink at all.

- [ ] **Step 7: Prove the end-to-end tests can fail**

1. Change `SNAPSHOT_FILTER` in `Root` to `{}` — nothing visibly changes, because
   both issues are open. So **add** a closed issue to the `project()` fixture
   (`run(['close', ...])` after capturing its id) and an assertion that
   `all:true` reveals it; confirm that assertion fails with `{}` and passes with
   `SNAPSHOT_FILTER`. Keep the added assertion.
2. Change `lockTimeoutMs` to `2000` — the tests still pass, because plan 2a
   never writes. Note this in the commit message: **the lock setting is
   currently unverifiable by test**, and plan 2b's first mutation test is what
   will cover it. Do not pretend otherwise; revert to `0`.
3. Break `App`'s `q` binding — the "quits on q" tests must fail by timing out
   (`timedOut: true`), not hang the suite. Confirm the 20-second timeout fires.
4. Remove the zero-size normalisation from `runUi` — "draws something on a
   terminal that reports no size at all" must fail **while every other pty
   test stays green**, since they all pass explicit COLUMNS and LINES. That
   asymmetry is the point: the suite as originally written could not see this
   class of bug at all.

- [ ] **Step 8: Write `ui/README.md`**

````markdown
# ditz2-ui

A full-screen terminal UI for [ditz2](../README.md), built on Ink.

Neither package is published yet, so install from a clone:

```
git clone <this repo> && cd ditz2
npm install                     # links ditz2 into ui/ as a workspace
npm run build                   # the ditz2 CLI
npx tsc -p ui/tsconfig.json && chmod +x ui/dist/main.js
node ui/dist/main.js
```

The UI build avoids `npm run build --workspace ditz2-ui` deliberately. The npm
this project's toolchain resolves to is 8.19.4, which discards the exit code of
any script run in a workspace member — so a failed build reports success and
the next line fails with `ERR_MODULE_NOT_FOUND` instead. See `CLAUDE.md`.

Once both are on a registry this becomes:

```
npm i -g ditz2-ui
dz ui          # or: dzui
```

It is a separate package on purpose. Ink and React are 38 packages and about
23 MB, and someone who wants a command-line issue tracker should not have to
install a React reconciler to get one. `ditz2` does not depend on this package;
`dz ui` finds it with a dynamic import and prints an install hint if it is not
there.

## What it does

Browse, filter and read. Everything it shows, `dz list`, `dz show` and `dz grep`
already show — it talks to the same `ditz2` public API the CLI does, so there is
no second implementation to drift. Creating, editing and closing issues from the
UI is plan 2b; for now use `dz`.

## Keys

| | |
| --- | --- |
| `up`/`down`, `j`/`k` | move |
| `Home`/`End`, `g`/`G` | first / last |
| `PgUp`/`PgDn`, `^U`/`^D` | page |
| `/` | filter — `enter` keeps it, `esc` clears it |
| `r` | reload from disk |
| `?` | every binding |
| `q` | quit |

The filter field takes bare words as a regex over titles, bodies and log
entries, and `status:`, `type:`, `component:`, `assignee:` and `all:` as
filters. `assignee:me` resolves to your configured identity. Arrow keys keep
working while the field is open, so you can type and walk the matches at once.

## What it does not do

It does not watch the filesystem. The screen is a snapshot taken at startup and
replaced by `r`, so an agent closing an issue you are looking at will not update
the display. This is deliberate: a list that reorders under a moving cursor is
worse than one that is briefly stale, and correctness does not depend on
freshness — every write re-reads and re-validates under the project lock, so a
stale view produces a refused write and never a silent overwrite.
````

- [ ] **Step 9: Point the root README at it**

Add to `README.md`, in whichever section lists the commands:

````markdown
### A terminal UI

`dz ui` opens a full-screen browser for the backlog. It lives in a separate
package so that the CLI keeps its three dependencies — Ink and React are 38
packages and about 23 MB.

Neither package is published yet; see [ui/README.md](ui/README.md) for how to
build and run it from a clone.
````

- [ ] **Step 10: Update `HANDOFF.md`**

Replace the **State**, **Next** and **Loose ends** sections to say: plan 2a
shipped; `ditz2-ui` browses, filters and reads; the next thing is plan 2b (the
form screen, `add`/`set`/`comment`/`close`, `$EDITOR` suspend, the conflict
overlay and the lock-wait state), which has a design in the spec and no
implementation plan yet. Record the new test count from the actual run, and
carry forward the two open items this plan does not touch: the `engines: ">=20"`
question and the sqlite cache issue in the tracker.

Add the two items this plan created:

- `lockTimeoutMs: 0` is set but **not covered by any test**, because plan 2a
  performs no writes. Plan 2b's first mutation test must assert that a contended
  lock surfaces as `LOCKED` immediately rather than after a two-second freeze.
- The `assignee:me` email-part rule in `ui/src/query.ts` is a guess about how
  people write assignees. Revisit it once the UI has been used.

- [ ] **Step 11: Full suite, both packages, then commit**

```bash
npm run typecheck && npm run build && npx vitest run
rm -rf .dz-fstest
npm run test:all
the formatter and linter
git add ui/src/index.tsx ui/src/main.ts ui/tests/e2e.test.ts ui/README.md
git commit ui README.md HANDOFF.md \
  -m "ditz2-ui: add the entry points, the dzui binary and a pty end-to-end test"
```

---

### Task 11: Take the screen

Added after the fact. The design spec opens with "A full-screen terminal UI for
ditz2" and the UI is not one: Ink writes its frame at the cursor and redraws in
place, so the whole thing appears as the last N lines of the ordinary terminal
buffer with the operator's shell scrollback still above it. Nothing in this plan
ever entered the alternate screen buffer, and nothing tested that it had.

**Why ten reviews and 499 tests missed it.** `ink-testing-library` renders to a
string — there is no screen for a frame to occupy. The pty tests assert on text
content. The one size assertion added in the final fix wave checks the frame is
*no taller* than its budget, which a far-too-small frame satisfies. "Full-screen"
was the first requirement in the spec and the only one never expressed as a
check anywhere.

**Files:**
- Modify: `ui/src/index.tsx` (`runUi`)
- Test: `ui/tests/e2e.test.ts`

`ptyKilled` locates the child by walking down from `script`'s pid with `pgrep
-P`, so it needs `procps`. Fail loudly when it is absent rather than skipping:

```ts
/** `pgrep` is how ptyKilled finds the child; without it the test is blind. */
function requirePgrep(): void {
  const probe = spawnSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' });
  if (probe.error !== undefined) {
    throw new Error(
      'this test needs `pgrep` (procps) to find the UI process inside the pty. '
      + 'It guards against leaving a terminal stranded on the alternate screen, '
      + 'so it fails rather than skipping.',
    );
  }
}
```

The suite already requires `script` from util-linux for all ten pty tests and
the plan already says to stop rather than weaken those if it is missing, so one
more system tool is consistent. A silent skip would quietly drop the only check
standing between a killed process and an unusable terminal.

`findLeafPid` must also cope with `pgrep` returning nothing — `spawnSync` gives
`stdout: null` on ENOENT, and calling `.trim()` on that throws inside an
un-awaited async callback, which surfaces as an unhandled rejection and a
twenty-second timeout instead of a clear failure.

**Interfaces:** unchanged. `runUi(opts: RunUiOptions): Promise<number>` keeps its
signature; both `dzui` and `dz ui` reach it, so one change covers both.

- [ ] **Step 1: Write the failing tests**

Add to `ui/tests/e2e.test.ts`:

```ts
  it('takes the whole screen and gives it back', () => {
    project((dir) => {
      const r = pty([process.execPath, DZUI], dir, 'q');
      expect(r.timedOut).toBe(false);
      // Asserted on the RAW output, before ANSI stripping — these sequences are
      // the behaviour under test, not noise to be filtered out.
      expect(r.raw).toContain(`${ESC}[?1049h`);
      expect(r.raw).toContain(`${ESC}[?1049l`);
      // Balanced, and in the right order: entering twice or never leaving both
      // strand the operator on the alternate buffer with their shell hidden.
      expect(r.raw.indexOf(`${ESC}[?1049h`)).toBeLessThan(r.raw.indexOf(`${ESC}[?1049l`));
      expect(r.raw.split(`${ESC}[?1049h`)).toHaveLength(2);
      expect(r.raw.split(`${ESC}[?1049l`)).toHaveLength(2);
    });
  });

  it('gives the screen back on Ctrl-C', async () => {
    // Covered by runUi's `finally`, NOT by the exit or signal handlers — do
    // not read this as coverage of those. Ink puts the tty in raw mode, which
    // disables ISIG, so Ctrl-C arrives as a plain 0x03 byte; Ink 6.8.0 then
    // unmounts gracefully rather than calling process.exit (see App.js's
    // handleInput), so runUi returns normally and the finally restores the
    // screen. An earlier revision of this plan asserted the opposite and a
    // review repeated it; the trace disproved both.
    //
    // Kept anyway, because it pins the behaviour the operator cares about —
    // the screen comes back — and would still assert the right outcome if a
    // future Ink switched to a hard exit.
    await project(async (dir) => {
      const r = await pty([process.execPath, DZUI], dir, String.fromCharCode(3));
      expect(r.timedOut).toBe(false);
      expect(r.raw).toContain(`${ESC}[?1049l`);
    });
  });

  it('gives the screen back when the process is killed', async () => {
    // Node runs no `exit` handler for a signal it terminates on by default, so
    // without an explicit handler this strands the operator on the alternate
    // buffer. SIGHUP is what a closing terminal window sends, so it is the
    // ordinary case rather than an exotic one.
    //
    // Targeted by walking down from `script`'s own pid: matching on the
    // command line also matches this test's process, which is how an earlier
    // attempt at this measurement killed its own shell instead of the child.
    await project(async (dir) => {
      requirePgrep();
      const r = await ptyKilled([process.execPath, DZUI], dir, 'SIGTERM');
      expect(r.raw).toContain(`${ESC}[?1049h`);
      expect(r.raw).toContain(`${ESC}[?1049l`);
    });
  });

  it('gives the screen back when it fails to open a project', () => {
    // The error path is the one that strands a terminal: the UI never mounts,
    // so an exit handler that only runs after a successful render restores
    // nothing and the operator is left staring at a blank alternate buffer.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-ui-none-'));
    try {
      const r = pty([process.execPath, DZUI], dir, 'q');
      expect(r.code).toBe(1);
      expect(r.raw).toContain(`${ESC}[?1049l`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
```

`pty()` must return the raw, unstripped output as `raw` alongside the stripped
`text`; add it rather than replacing `text`, which every other test uses. Define
`ESC` as `String.fromCharCode(27)` — never a literal escape byte in source.

- [ ] **Step 2: Run them and watch them fail**

Both must fail on the absence of the sequences, not on a crash.

- [ ] **Step 3: Take and release the screen in `runUi`**

```tsx
/** Signals that end the process without Node running its `exit` handlers. */
const EXIT_SIGNALS: Record<string, number> = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 };

/** Enters the alternate screen buffer, and returns the function that leaves it. */
function takeScreen(): () => void {
  if (process.stdout.isTTY !== true) return () => {};
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    process.stdout.write(`${ESC}[?1049l`);
  };
  process.stdout.write(`${ESC}[?1049h`);
  // Three paths, none redundant, each verified against a real pty:
  //
  //   finally in runUi — a throw before Ink mounts, and Ink's Ctrl-C, which
  //     in 6.8.0 unmounts gracefully rather than calling process.exit (read
  //     App.js's handleInput; an earlier revision of this plan asserted the
  //     opposite and was wrong).
  //   exit           — an uncaught exception or unhandled rejection anywhere
  //     in the process. Node's default handler ends the process without
  //     unwinding, so the finally never runs, but `exit` still fires.
  //     Verified with a probe; this is not the hypothetical
  //     "a caller calls process.exit" that an earlier revision claimed, and
  //     no such caller exists.
  //   signal handlers — an externally delivered SIGINT/SIGTERM/SIGHUP, which
  //     Node terminates on WITHOUT running exit handlers. Measured: without
  //     these, `kill -TERM` leaves the alternate buffer up and the operator's
  //     shell invisible. SIGHUP is the one that fires when a terminal window
  //     is closed, so this is not an exotic case.
  //
  // `released` makes the overlap harmless.
  process.once('exit', release);
  for (const [signal, number] of Object.entries(EXIT_SIGNALS)) {
    process.once(signal, () => {
      release();
      process.exit(128 + number);
    });
  }
  return release;
}
```

and wrap the body of `runUi`:

```tsx
export async function runUi(opts: RunUiOptions): Promise<number> {
  if (!(process.stdout.columns > 0)) process.stdout.columns = DEFAULT_COLUMNS;
  if (!(process.stdout.rows > 0)) process.stdout.rows = DEFAULT_ROWS;

  const release = takeScreen();
  try {
    const project = openProject(opts.cwd, { env: opts.env, lockTimeoutMs: 0 });
    const instance = render(<Root project={project} onExit={() => { instance.unmount(); }} />);
    await instance.waitUntilExit();
    return 0;
  } finally {
    release();
  }
}
```

Define `ESC` at module scope as `String.fromCharCode(27)`.

- [ ] **Step 4: Run the tests and watch them pass**

- [ ] **Step 5: Prove the checks can fail**

1. Drop the `process.stdout.write` of the enter sequence — the first test must
   fail on the missing `?1049h`.
2. Drop the `finally` while keeping the `exit` handler — the **project-open
   failure** test must fail, while the normal-quit test stays green. That split
   is the point: the error path is the one that strands a terminal.
3. Drop the `process.once('exit', release)` while keeping the `finally` — the
   Ctrl-C test below must fail. That handler exists for exactly one path: Ink
   turns Ctrl-C into a `process.exit`, which unwinds nothing, so the `finally`
   never runs and only the exit handler restores the screen.

**On breakage 2, which does not fail and is not supposed to.** Dropping the
`finally` while keeping the exit handler breaks no test, because no caller ever
calls `process.exit` directly — both entry points set `process.exitCode` and let
Node drain, so `'exit'` always fires. The `finally` is still load-bearing, for a
reason no assertion on the captured byte stream can see: `ui/src/main.ts` writes
the error to stderr *before* the process exits, so without the synchronous
restore that message lands on the alternate screen and is discarded with it.
Verified by index in a real pty run — the leave sequence precedes the error
text. Do not delete the `finally` on the strength of a green suite.

- [ ] **Step 6: Lint and commit**

The frame still sits one to two rows short of the terminal, which is deliberate
and unchanged here — reclaiming those rows means touching the arithmetic that
produced four defects in this plan, and wants its own task with the frame-height
test extended first.

---

### Task 12: A full-screen issue view on Enter

The detail pane shows a fragment and announces the rest (`… 7 more lines`),
with no way to reach it. `dz show` is the only way to read a whole issue, which
defeats "work a backlog without leaving the terminal". `Enter` on the list now
opens the selected issue full-screen, scrollable, with the complete body and
the complete log — no `LOG_ROOM` cap, no clipping. `Esc` or `q` returns.

**Why the pane's tests did not catch this.** `detailLines` is thoroughly tested
for clipping *correctly* — never exceeding its budget, keeping whole log
entries, padding a short pane. Not one test asks whether the clipped content is
reachable. Every test verified the truncation was well-behaved; none asked
whether truncating at all was acceptable.

**A note on the key.** The design spec reserves `Enter` for the edit form in
plan 2b. This takes it for reading. Plan 2b will need another binding for the
form — `e` is already the spec's key for "body in `$EDITOR`", so `Tab` or
`Ctrl-E` are the candidates. Recorded in `HANDOFF.md` rather than left for 2b
to discover.

**Files:**
- Modify: `ui/src/state.ts` (`screen`, `issueOffset`, three actions)
- Modify: `ui/src/format.ts` (`issueLines`, shared head with `detailLines`)
- Create: `ui/src/components/IssueView.tsx`
- Modify: `ui/src/app.tsx` (chrome constants, key routing, render branch)
- Modify: `ui/src/components/HelpOverlay.tsx` (the new bindings)
- Test: `ui/tests/state.test.ts`, `ui/tests/format.test.ts`, `ui/tests/issue-view.test.tsx`

**Interfaces:**
- `issueLines(issue: Issue, width: number): string[]` — the whole issue, every
  body line and every log entry, truncated only to `width`. No height budget.
- `<IssueView issue={Issue} offset={number} rows={number} width={number} />`
- `UiState` gains `screen: 'list' | 'issue'` and `issueOffset: number`.
- Actions: `openIssue`, `closeIssue`, `scrollIssue({ delta, max })`.

- [ ] **Step 1: Split the chrome constants**

`app.tsx` currently has `CHROME_ROWS = 4`, which bundles the header, status
line and footer with `<Detail>`'s border. The issue screen has no detail pane
and so no border, and a second literal would be the same drift that produced
four defects in this plan. Replace with:

```tsx
/** Header, status line, footer — present on every screen. */
const CHROME_ROWS = 3;
/** The rule <Detail> draws above itself. List screen only. */
const DETAIL_BORDER_ROWS = 1;
```

and on the list screen use `CHROME_ROWS + DETAIL_BORDER_ROWS` where `4` was.
The list split must be numerically identical afterwards — Task 7's paging test
at `rows={21}` pins `listRows === 10` and must stay green untouched.

- [ ] **Step 2: `issueLines` in `format.ts`, sharing the head with `detailLines`**

```ts
/** Title and the one-line field summary. Shared so the two views cannot drift. */
function issueHead(issue: Issue): string[] {
  const resolution = issue.resolution === null ? '' : ` (${issue.resolution})`;
  return [
    issue.title,
    `${issue.status}${resolution} · ${issue.component ?? 'no component'} · `
    + `${issue.assignee ?? 'unassigned'} · ${issue.type}`,
    '',
  ];
}

/**
 * The whole issue: every body line, every log entry, nothing budgeted away.
 * Only `width` constrains it — the caller scrolls.
 */
export function issueLines(issue: Issue, width: number): string[] {
  const body = issue.body === '' ? ['(no description)'] : issue.body.split('\n');
  const log = issue.log.flatMap(logLines);
  const out = [
    ...issueHead(issue),
    ...body,
    ...(log.length === 0 ? [] : ['', ...log]),
  ];
  return out.map((l) => truncate(l, width));
}
```

`detailLines` must be changed to call `issueHead` rather than building those
lines itself. Its behaviour must not change: the existing detail tests stay
green untouched.

- [ ] **Step 3: State**

Add to `UiState`: `screen: 'list' | 'issue'` (already typed as `'list'` only —
widen it) and `issueOffset: number`, initialised to 0. Add:

```ts
    case 'openIssue':
      // Only from a real selection; Enter on an empty list must do nothing.
      if (selectedIssue(state) === null) return state;
      return { ...state, screen: 'issue', issueOffset: 0 };

    case 'closeIssue':
      return { ...state, screen: 'list' };

    case 'scrollIssue':
      return {
        ...state,
        issueOffset: Math.min(Math.max(state.issueOffset + action.delta, 0), Math.max(action.max, 0)),
      };
```

`openIssue` resets the offset, so reopening an issue starts at the top — the
same rule `toggleHelp` already follows.

- [ ] **Step 4: `IssueView.tsx`**

```tsx
export function IssueView(
  { issue, offset, rows, width }: { issue: Issue; offset: number; rows: number; width: number },
): React.ReactElement {
  const all = issueLines(issue, width);
  const room = all.length <= rows ? rows : Math.max(rows - 1, 1);
  const at = Math.min(Math.max(offset, 0), Math.max(all.length - room, 0));
  const shown = all.slice(at, at + room);
  const left = all.length - at - shown.length;

  return (
    <Box flexDirection="column">
      {shown.map((line, n) => (
        // eslint-disable-next-line react/no-array-index-key
        <Text key={n} wrap="truncate">{line === '' ? ' ' : line}</Text>
      ))}
      {Array.from({ length: Math.max(room - shown.length, 0) }, (_, n) => (
        // eslint-disable-next-line react/no-array-index-key
        <Text key={`pad-${n}`}> </Text>
      ))}
      {all.length > rows && (
        <Text dimColor wrap="truncate">
          {left > 0 ? `  ↓ ${left} more` : '  ↑ top of the issue is above'}
        </Text>
      )}
    </Box>
  );
}
```

Export `maxIssueOffset(total: number, rows: number): number` from the same file
so `app.tsx` clamps against the same arithmetic the view slices with, rather
than keeping its own copy:

```ts
export function maxIssueOffset(total: number, rows: number): number {
  if (total <= rows) return 0;
  return Math.max(total - Math.max(rows - 1, 1), 0);
}
```

- [ ] **Step 5: Key routing in `app.tsx`**

The issue screen owns the keyboard, like help does. Put its branch immediately
after the help branch and before the shared navigation block, or the arrows
will move the list selection behind the view:

```tsx
    if (state.screen === 'issue') {
      const issue = selectedIssue(state);
      if (issue === null) { dispatch({ type: 'closeIssue' }); return; }
      const body = rows - CHROME_ROWS;
      const max = maxIssueOffset(issueLines(issue, width).length, body);
      if (key.downArrow || input === 'j') { dispatch({ type: 'scrollIssue', delta: 1, max }); return; }
      if (key.upArrow || input === 'k') { dispatch({ type: 'scrollIssue', delta: -1, max }); return; }
      if (key.pageDown || (key.ctrl && input === 'd')) { dispatch({ type: 'scrollIssue', delta: body, max }); return; }
      if (key.pageUp || (key.ctrl && input === 'u')) { dispatch({ type: 'scrollIssue', delta: -body, max }); return; }
      if (key.home || input === 'g') { dispatch({ type: 'scrollIssue', delta: -max, max }); return; }
      if (key.end || input === 'G') { dispatch({ type: 'scrollIssue', delta: max, max }); return; }
      if (input === '?') { dispatch({ type: 'toggleHelp' }); return; }
      if (key.escape || key.return || input === 'q') dispatch({ type: 'closeIssue' });
      return;
    }
```

and on the list screen, `if (key.return) { dispatch({ type: 'openIssue' }); return; }`
alongside the other action keys.

`q` returns to the list rather than quitting. Quitting from a reading view by
reflex is the kind of thing that loses a filter someone spent time typing.

- [ ] **Step 6: Chrome for the issue screen**

Header: `` `ditz2 · ${project.name} · ${shortId(issue.id)}` ``.
Footer: `'up/down scroll  g/G top/bottom  enter/esc back  ? help  q back'`.
`Enter` closes the view as well as opening it, so the footer has to say so —
this project's footer rule cuts both ways, and a working binding nobody
advertises is only marginally better than an advertised one that does nothing.
Both must describe only what the issue screen binds — the list footer's
`/ filter` and `r refresh` do nothing here, and advertising them would break
the rule the list footer's own test enforces.

- [ ] **Step 7: Help overlay**

Add the issue-screen bindings to `HELP`, and note `enter` opens an issue from
the list. `HELP_LINES` grows, so re-check `maxHelpOffset` and the two help
scrolling tests at `rows={12}` — they assert an exact minimum press count and
will need recalibrating. Recalibrate the fixture, never the assertion text.

- [ ] **Step 8: Tests**

In `state.test.ts`: `openIssue` sets the screen and zeroes the offset;
`openIssue` on an empty list is a no-op; `closeIssue` returns to the list and
leaves the filter and selection intact; `scrollIssue` clamps at both ends.

In `format.test.ts`: `issueLines` contains every body line and every log entry
for an issue whose `detailLines` output clips — the direct expression of the
bug this task fixes. Also that both views agree on the head, by comparing
`issueLines(i, 80)[0..1]` with `detailLines(i, 30, 80)[0..1]`.

In `issue-view.test.tsx`: Enter opens the view and it shows body text the list
screen's pane clipped; `j` scrolls; `G` reaches the last log line; `Esc`
returns to the list with the previous selection still marked; **Enter a second
time also returns**, and the footer names it.

- [ ] **Step 9: Prove the checks can fail**

1. Make `openIssue` not reset `issueOffset` — reopening after scrolling must
   fail the reset test.
2. Move the issue-screen branch below the shared navigation block — the scroll
   tests must fail, because the arrows will move the list selection instead.
3. Cap `issueLines`'s log at `LOG_ROOM` as `detailLines` does — the "contains
   every log entry" test must fail.
4. Leave `CHROME_ROWS` at 4 for the list screen after the split — Task 7's
   `pages by exactly one screen` test must fail, since `listRows` changes.
   Confirm it stays green with the split done correctly.
5. Drop `enter` from the issue footer string — the footer test must fail. It is
   the same rule as the list footer's, in the other direction: the footer is
   the UI's account of itself and an unlisted working key makes it incomplete.

- [ ] **Step 10: Lint and commit**

---

### Task 13: Wrap prose instead of truncating it

`issueLines` and `detailLines` both end in `out.map((l) => truncate(l, width))`.
A Markdown paragraph is one source line, so each paragraph renders as a single
display line with everything past the terminal width replaced by an ellipsis.
The real issue in this repository's own backlog has body lines of 280, 263,
241, 277 and 234 characters; on a 110-column terminal the reader shows about
40% of each paragraph and silently drops the rest.

The full-screen view added in Task 12 therefore still does not let you read an
issue. It fixed vertical clipping and left horizontal clipping untouched.

**Why this was missed.** Task 12's tests assert that a body *line* appears in
the output, never that the *text* does. `expect(text).toContain('cache.sqlite')`
passes on a line whose remaining 200 characters were thrown away, because the
substring searched for happened to fall inside the surviving prefix. The
ellipses were visible in the pty captures used to verify the task and were read
as intentional preview clipping.

**Files:**
- Modify: `ui/src/format.ts` (`wrapLine`, used by `issueLines` and `detailLines`)
- Test: `ui/tests/format.test.ts`, `ui/tests/issue-view.test.tsx`

**Interfaces:**
- `wrapLine(line: string, width: number): string[]` — one source line to one or
  more display lines, never wider than `width`, never losing a character.

- [ ] **Step 1: Write the failing tests**

In `format.test.ts`:

```ts
describe('wrapLine', () => {
  it('leaves a short line alone', () => {
    expect(wrapLine('short', 20)).toEqual(['short']);
  });

  it('breaks at spaces, never mid-word', () => {
    expect(wrapLine('alpha beta gamma delta', 12)).toEqual(['alpha beta', 'gamma delta']);
  });

  it('conserves every non-whitespace character, even when it must hard-break', () => {
    // The guarantee that holds at ANY width, including widths too narrow to
    // keep a token whole. Token-level conservation does not hold there, and
    // claiming it did was the second wrong version of this contract.
    const text = '10. findIssue no longer parses every file,  but list and grep must.';
    const bare = text.replace(/\s+/g, '');
    for (const w of [1, 2, 3, 5, 12, 40]) {
      expect(wrapLine(text, w).join('').replace(/\s+/g, '')).toBe(bare);
    }
  });

  it('conserves every token, in order, at every width wide enough to keep one', () => {
    // The property that matters, and stated as a property rather than as one
    // round-trip: an earlier version passed a single-spaced round-trip while
    // dropping leading indents and collapsing doubled spaces.
    const text = '  findIssue no longer parses every file,  but list and grep still '
      + 'must, because a filter has to look at each one before it can decide.';
    const want = text.trim().split(/\s+/);
    for (const w of [8, 13, 20, 31, 60, 200]) {
      const out = wrapLine(text, w);
      expect(out.join(' ').trim().split(/\s+/)).toEqual(want);
      // `Math.max(w, text.length)` would resolve to text.length at every width
      // tested here and constrain nothing. The real guarantee is the width.
      expect(out.every((l) => l.length <= w)).toBe(true);
    }
  });

  it('terminates on a list marker wider than the width', () => {
    // Regression: the hanging indent was re-added faster than characters were
    // consumed, so this grew without bound. A synchronous spin here freezes
    // the UI and Ink cannot service Ctrl-C while it runs.
    const out = wrapLine(`10. ${'x'.repeat(30)}`, 2);
    expect(out.length).toBeLessThan(40);
    expect(out.every((l) => l.length <= 2)).toBe(true);
    expect(out.join('')).toContain('x'.repeat(30));
  });

  it('keeps the leading indent of the line it wrapped', () => {
    expect(wrapLine('  hello world foo bar baz', 10)[0]).toBe('  hello');
  });

  it('handles a plain indent at a width that forces a hard break', () => {
    // The bullet path covers indent + hard break; this covers the plain
    // leading-whitespace path, which shares the mechanism but had no test at
    // a width narrow enough to exercise it.
    const out = wrapLine(`    ${'y'.repeat(20)}`, 6);
    expect(out.every((l) => l.length <= 6)).toBe(true);
    expect(out.join('').replace(/\s+/g, '')).toBe('y'.repeat(20));
  });

  it('handles an indent exactly as wide as the width', () => {
    // The boundary the guard turns on: raw.length < width keeps the indent,
    // raw.length === width drops it. Neither may lose a character or hang.
    const out = wrapLine(`10. ${'z'.repeat(12)}`, 4);
    expect(out.every((l) => l.length <= 4)).toBe(true);
    expect(out.join('').replace(/\s+/g, '')).toBe(`10.${'z'.repeat(12)}`);
  });

  it('leaves a whitespace-only line alone', () => {
    // It is a paragraph separator; collapsing it closes the gap it exists for.
    expect(wrapLine('   ', 2)).toEqual(['   ']);
  });

  it('hard-breaks a word longer than the width', () => {
    // A URL or a path has no space to break at, and dropping its tail is the
    // bug this task exists to fix.
    const long = 'x'.repeat(25);
    const out = wrapLine(long, 10);
    expect(out.every((l) => l.length <= 10)).toBe(true);
    expect(out.join('')).toBe(long);
  });

  it('keeps a blank line blank', () => {
    expect(wrapLine('', 10)).toEqual(['']);
  });

  it('indents continuations of a bullet under its text', () => {
    // Flush-left continuations make a wrapped list unreadable — the second
    // line of one bullet looks like a new one.
    expect(wrapLine('- alpha beta gamma', 12)).toEqual(['- alpha beta', '  gamma']);
  });

  it('survives a zero or negative width', () => {
    expect(() => wrapLine('anything', 0)).not.toThrow();
  });
});
```

and, as the direct expression of the bug:

```ts
  it('reflows a long paragraph instead of cutting it off', () => {
    const para = 'word '.repeat(60).trim();
    const out = issueLines(issue({ ...one, body: para }), 40);
    expect(out.every((l) => l.length <= 40)).toBe(true);
    expect(out.some((l) => l.includes('…'))).toBe(false);
    // Every word survives, in order.
    const body = out.slice(3).join(' ').trim();
    expect(body.split(/\s+/).filter((w) => w === 'word')).toHaveLength(60);
  });
```

In `issue-view.test.tsx`, assert against the **whole** text rather than a
substring that might fall inside a surviving prefix:

```ts
  it('shows every word of a long paragraph, not just its first line', async () => {
    const para = Array.from({ length: 40 }, (_, n) => `w${n}`).join(' ');
    // … render the issue view at width 40 …
    const shown = lines(lastFrame()).join(' ');
    for (const w of para.split(' ')) expect(shown).toContain(w);
  });
```

- [ ] **Step 2: Run them and watch them fail**

The paragraph tests must fail on truncation, not on a missing export.

- [ ] **Step 3: Write `wrapLine`**

```ts
/** Continuation indent for a wrapped list item, so it does not read as a new one. */
const BULLET = /^(\s*(?:[-*+]|\d+\.)\s+)/;

/**
 * One source line as one or more display lines of at most `width`.
 *
 * A Markdown paragraph is a single source line, so without this every
 * paragraph rendered as one truncated line and the rest of the text was
 * simply gone.
 *
 * The contract, stated exactly, because two earlier attempts at stating it
 * were both wrong in ways no test could see:
 *
 *   - Non-whitespace characters are conserved, in order. Concatenating the
 *     output and discarding whitespace reproduces the input with whitespace
 *     discarded. That holds for every input, including hard-broken ones.
 *   - A *token* survives whole only when it fits in `width`. One that does not
 *     is split across lines — `wrapLine('10. ' + 'x'.repeat(30), 2)` yields
 *     `['10', '.', 'xx', …]` — because the alternative is dropping its tail,
 *     which is the bug this function exists to fix.
 *   - Runs of whitespace between tokens collapse into the single space or line
 *     break that replaces them. That is what reflow means.
 *
 * The first version promised "every character survives" while eating leading
 * indents, whitespace-only lines and doubled spaces. The second promised each
 * token "exactly once, in order", which a hard break makes false. Character
 * conservation is the one that is actually true.
 */
export function wrapLine(line: string, width: number): string[] {
  if (width <= 0 || line.length <= width) return [line];
  // Whitespace-only lines are paragraph separators; reflowing one to nothing
  // silently closes the gap it exists to create.
  if (line.trim() === '') return [line];

  const lead = BULLET.exec(line)?.[1];
  const raw = lead ?? (/^\s*/.exec(line)?.[0] ?? '');
  // An indent at least as wide as the line leaves no room for text, and a
  // hanging indent re-added faster than characters are consumed does not
  // terminate. Measured before this guard existed: `wrapLine('10. ' +
  // 'x'.repeat(30), 2)` grew without bound. A synchronous loop here freezes
  // the whole UI, and Ink cannot service Ctrl-C while it spins.
  const indent = raw.length < width ? ' '.repeat(raw.length) : '';
  const out: string[] = [];
  let current = raw.length < width ? raw : '';
  let fresh = true;

  for (const word of line.trim().split(/\s+/)) {
    const sep = fresh ? '' : ' ';
    if (current.length + sep.length + word.length <= width) {
      current += sep + word;
      fresh = false;
      continue;
    }
    if (!fresh) {
      out.push(current);
      current = indent;
      fresh = true;
    }
    // Still too long on a line of its own — a URL or a path. Break it rather
    // than overflow, which is the loss this whole task is about. `current` is
    // always narrower than `width` here, so each pass consumes at least one
    // character and the loop ends.
    let rest = word;
    while (current.length + rest.length > width) {
      const room = width - current.length;
      out.push(current + rest.slice(0, room));
      rest = rest.slice(room);
      current = indent;
    }
    current += rest;
    fresh = false;
  }

  if (current.trim() !== '' || out.length === 0) out.push(current);
  return out;
}
```

- [ ] **Step 4: Use it in both renderers**

In `issueLines`, replace the final `map` with a `flatMap`:

```ts
  return out.flatMap((l) => wrapLine(l, width));
```

In `detailLines`, wrap **before** the height budget is applied, so the budget
counts display lines rather than source lines — otherwise a single paragraph
claims one row and then overflows the pane sideways.

**All three parts wrap, not just the body.** The first version of this step
changed only the body, leaving the title and the log to be chopped by the
trailing `truncate` — so the pane still showed
`"A title that is quite long and will certainly not fit insid…"` and
`"    This comment is a single long paragraph of prose that g…"` while the
full-screen view reflowed both correctly. Wrapping one of three places and
calling the task done is what made a second round necessary.

```ts
  const head = issueHead(issue).flatMap((l) => wrapLine(l, width));
  // Per entry, so the whole-entry budgeting below measures DISPLAY lines. A
  // comment that reflows to six lines must count as six against LOG_ROOM, or
  // the pane budgets for one and overflows.
  const entries = issue.log.map((e) => logLines(e).flatMap((l) => wrapLine(l, width)));
  const body = issue.body === '' ? [] : issue.body.split('\n').flatMap((l) => wrapLine(l, width));
```

and the final `map((l) => truncate(l, width))` stays. It is *not* dead: the
`… N more lines` marker is built directly rather than routed through
`wrapLine`, so a large hidden count at a narrow width can exceed `width` and
reach it. Truncating a marker is the right outcome — wrapping it would spend a
second row saying the same thing — so the line stays and this note records why,
rather than the earlier claim that it "only ever fires on a display width
mismatch".

`rowFor` must NOT wrap: the list is one row per issue, and truncation there is
correct.

- [ ] **Step 5: Run and watch them pass**

Existing `detailLines` tests must stay green. If a height assertion shifts
because a fixture body now wraps, that is a **fixture** recalibration and is
allowed — the assertion text must not change. Say which ones moved and why.

- [ ] **Step 6: Prove the checks can fail**

1. Revert `issueLines` to `map((l) => truncate(l, width))` — "reflows a long
   paragraph" and "shows every word" must both fail.
2. Drop the hard-break loop — the 25-character-word test must fail with a line
   wider than the width.
2b. Restore the unguarded indent (`const indent = ' '.repeat(raw.length)` with
   no width check) — "terminates on a list marker wider than the width" must
   fail.

   **A per-test timeout does not bound this, and it is worth knowing why.**
   Measured: the test failed after 7.2 seconds with `RangeError: Invalid array
   length`, not at the 2000 ms timeout. The loop is synchronous and never
   yields, so vitest's timer cannot run — the same reason a synchronous lock
   wait blocks Ink's Ctrl-C, which this plan already documents. V8's array
   limit stopped it, not the test framework. The width-guarded indent is the
   only real backstop; the timeout is decoration.
3. Drop the bullet indent — the bullet test must fail.
4. Wrap in `detailLines` *after* the budget instead of before — the pane's
   height tests must fail, since the budget would be counting source lines.
5. Make `rowFor` wrap — the list-row tests must fail, since a row must stay one
   line.
6. Revert the head to `issueHead(issue)` unwrapped — "wraps the title" must
   fail.
7. Revert `entries` to `issue.log.map(logLines)` unwrapped — "wraps a long
   comment" must fail, and "budgets the log by display lines" must fail for a
   different reason: the pane overruns its row count.

- [ ] **Step 7: Run it for real**

Open the reader on this repository's own backlog and confirm the 280-character
paragraph reads as several full lines with no ellipsis, and that the bulleted
constraints list is still legible as a list.

---

## Acceptance

The plan is done when all of these hold. Each is a command, not a judgement.

- [ ] `npm run typecheck && npm run build && npx vitest run` — all 366
      pre-existing tests pass, plus the new ones in `src/api/`, `src/cli/` and
      `tests/cli/`.
- [ ] `npm run test:all` — both packages green, and this is what typechecks
      `ui/tests/`. Confirm it really does by putting `const n: number = 'x';`
      in a UI test file and watching it fail; a suite that only builds `src/`
      would stay green. **Check the exit code, not just the output**: npm
      8.19.4 discards the exit status of workspace-member scripts, so this gate
      is only meaningful because it invokes `tsc` and `vitest` directly. If
      someone reverts it to `npm run test --workspace ditz2-ui`, it will report
      success for every possible state of the code.
- [ ] `the formatter and linter` — clean, in both packages.
- [ ] `rm -rf .dz-fstest` afterwards; it must not be committed.
- [ ] **No existing test assertion was weakened, retargeted or deleted.** Not
      "no test file was edited" — that blanket form was wrong and this plan
      paid for it. Task 7's paging test encoded a pre-Task-8 assumption about
      what `rows` meant, and treating it as immovable preserved a real bug
      where paging skipped twelve issues a keypress. A task that changes an
      assumption must update the tests that encode it.

      What is allowed: appending new cases, and recalibrating a **fixture**
      (a row budget, a keypress count) when a deliberate change moves the
      arithmetic — provided the assertion text is unchanged and the test still
      fails for the reason it was written. What is not: editing an `expect` to
      match new behaviour.

      Known and justified fixture edits, each recorded with its reasoning:
      `app-keys.test.tsx` (`rows={10}`→`{20}`→`{21}`, twice, as `CHROME_ROWS`
      changed) and `app-filter.test.tsx` (help-scroll press counts, as
      `HELP_LINES` grew). `src/api/api.test.ts` gains a `describe` block
      (Task 1); `src/cli/help.ts` gains a tutorial step and a contract line
      (Task 3).

      Verify against the base commit, not the working tree — `git status` is
      empty when everything is committed, which is how this check has been run
      uselessly here before:

      ```bash
      git log -r . -T "{node|short}\n"
      git status --rev <plan-commit> --rev . tests/ src/
      git diff --rev <plan-commit> src/api/api.test.ts | awk '/^-[^-]/ { n++ } END { print n+0 }'
      ```

      **`<plan-commit>` is the commit that added this plan document, not the
      trunk merge-base.** Against the merge-base every file in the project
      reports `A`, no `M` can ever appear, and the check silently cannot fail —
      which is exactly the class of defect it exists to catch. Run it against
      the plan commit, where `M src/api/api.test.ts` is the one expected
      modification among test files.

      `git status` should show `A tests/cli/ui.test.ts`, `A src/cli/ui.test.ts`
      and `M src/api/api.test.ts` among the test files, and no other `M` on
      one. The `awk` line must print `0`: append-only means no removed lines.
      If it prints anything else, an existing test was changed to accommodate
      the work, which is the failure this check exists to catch.

      `awk`, not `grep`, and not because the pipe would traverse anything —
      it reads one command's output. The rule in the repository's `CLAUDE.md` is
      absolute about the command name, and a plan that carves out an exception
      teaches the next reader to carve out their own.
- [ ] `ditz2`'s `dependencies` are still exactly `commander`, `uuid`, `yaml`.
- [ ] `ditz2-ui` is named in `src/` only by `src/cli/ui.ts` (the `UI_PACKAGE`
      constant and its dynamic import) and `src/cli/help.ts` (the tutorial step
      and the `--json` exception).

      **Do not use `grep`, `find` or `rg` for this.** the repository's `CLAUDE.md`
      forbids them outright, and `grep -c ditz2-ui src/` — the obvious
      formulation — does not recurse into a directory: it prints nothing and
      exits 1, so it reports "clean" for every possible state of the tree.
      Delegate to the `meta_codesearch:code-search` agent instead, thoroughness
      "quick", asking where `ditz2-ui` appears under `src/`. (Outside such a repository
      an ordinary repository-wide search does the same job; no such command is
      named here, because every one of them is banned in this checkout and a
      reader skimming for something to paste should not find one.)
- [ ] The UI runs against **this repository's own backlog**, on a FUSE-backed checkout, not
      under `os.tmpdir()`:

      ```bash
      ./ui/dist/main.js      # then press / r ? and q
      ```

      This is the same reason `tests/cli/repo-filesystem.test.ts` exists. On an
      ordinary clone it is redundant; here it is the only check that would catch
      a filesystem-specific failure.
- [ ] The README's build-from-clone steps were run start to finish in a fresh
      clone, in order, and the last one opened the UI. The published-install
      instructions are marked as not yet true and must not read as working.
- [ ] Every "prove the check can fail" step was actually run. A test that has
      never been seen to fail is not evidence.

## Deliberately not in this plan

From the spec, and belonging to plan 2b: the form screen, `add`, `set`,
`comment`, `close`, the status, component, resolution and comment pickers, the
`$EDITOR` suspend-without-unmount sequence, the conflict overlay, and the
lock-wait state with its holder, timer and cancel key. `UiState.screen`,
`UiState.overlay` and the missing `waitingFor` field are shaped so that each is
an addition rather than a rewrite.

From the spec's own out-of-scope list, and belonging to no plan: mouse support,
themes, a config file, user-defined bindings, multi-select, further split panes,
and filesystem watching.
