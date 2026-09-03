# ditz2 API Facade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ditz2 a narrow public API under `src/api/` that performs every
project operation, and rewrite the CLI commands as argument parsing plus one
facade call plus one render.

**Architecture:** The facade is where the command bodies move to, not a second
implementation beside them. A `Session` holds the resolved root, the
environment used for author resolution, and an optional lock timeout override.
Read operations take no lock; write operations each take the project lock for
their own read-modify-write, exactly as the commands do today. `src/api` is the
only path named in the package's `exports` map; `core/`, `store/` and `render/`
stay private.

**Tech Stack:** TypeScript 5.9 (NodeNext ESM), Node >= 20, vitest 2.1, commander
14. No new dependencies.

## Global Constraints

- Node `>=20`. The `engines` field stays as it is.
- ditz2's runtime dependencies stay exactly `commander`, `uuid`, `yaml`. This
  plan adds none.
- The `exports` map names **only** `./` mapping to `dist/api/index.js`.
  `core/`, `store/` and `render/` remain private and must not be reachable.
- The CLI calls the facade. A facade that reimplements what a command does is
  the defect this plan exists to prevent.
- The facade is **synchronous** throughout. No `async`, no promises.
- The facade takes `env` and `lockTimeoutMs` as parameters and must never read
  `process.env` itself.
- Errors are `DzError` with the existing codes: `NO_PROJECT`, `NOT_FOUND`,
  `AMBIGUOUS_PREFIX`, `INVALID_FIELD`, `PARSE_ERROR`, `CONFLICT_MARKERS`,
  `LOCKED`, `CONCURRENT_MODIFICATION`. No new codes.
- **Acceptance gate for every task: the existing test suite passes with no test
  file modified.** 330 tests across 25 files at the start of this plan. If a
  task requires editing an existing test, the refactor changed behaviour and the
  change is wrong. New tests may be added.
- Every new `.ts` file starts with the license header used throughout the repo:

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
```

- Trailing newline on every new file. Unix line endings.
- Run `the formatter` before each commit and `the linter` before declaring a task done.
- Build and test with the any Node >= 20:
  then `npm run typecheck`, `npm run build`, `npx vitest run`.

## Correction to the spec

The design document gives `list(filter?): Issue[]`. That is wrong and this plan
deviates from it deliberately.

`loadAllIssues` returns `{issues, failures}`, and the CLI's partial-failure
behaviour depends on the failures: `dz list` prints results to stdout, warnings
to stderr, and exits 1. Returning only `Issue[]` would either discard that or
force the CLI to re-read the directory to recover it.

`list` and `grep` therefore return `LoadResult`:

```ts
interface LoadResult { issues: Issue[]; failures: LoadFailure[] }
```

The TUI wants the same information — it can report "3 files unreadable" in the
status line rather than silently showing a short list. Update the spec's facade
block as part of Task 5.

## `init` is deliberately not on the facade

`openProject` requires a project to exist, so `init` cannot be a `Project`
method. It is the only command that runs without one, the TUI never needs it,
and giving it a module-level facade entry would add public surface nothing
consumes. `src/cli/init.ts` keeps its current implementation and its direct use
of `initProject`. `schema` and `help` are pure output with no project and stay
as they are too.

## File structure

**New:**

| File | Responsibility |
| --- | --- |
| `src/api/session.ts` | `Session` type, `withLock` helper, lock-timeout override |
| `src/api/filter.ts` | `Filter` type and `applyFilter` — moved from `src/cli/filters.ts` |
| `src/api/read.ts` | `list`, `show`, `grep`, `doctor`, `lockState` — no locks |
| `src/api/write.ts` | `add`, `set`, `comment`, `close`, `saveEdited`, component ops, `breakLock` |
| `src/api/index.ts` | `openProject`, the `Project` interface, public type re-exports |
| `src/api/api.test.ts` | Unit tests for the facade |

**Modified:** every file under `src/cli/` except `help.ts`, `schema.ts`,
`init.ts`, `context.ts`, `message.ts` and `prompt.ts`.

**Deleted:** `src/cli/lock.ts` (its `withProjectLock` becomes `withLock` in
`src/api/session.ts`). `src/cli/filters.ts` keeps only `addFilterOptions`, the
commander wiring; its `applyFilters` and `ListFilters` move to
`src/api/filter.ts`.

---

## Task 1: Session, filters, and the read side

**Files:**
- Create: `src/api/session.ts`
- Create: `src/api/filter.ts`
- Create: `src/api/read.ts`
- Modify: `src/cli/filters.ts` (drop `applyFilters` and `ListFilters`)
- Modify: `src/cli/list.ts`, `src/cli/grep.ts`, `src/cli/show.ts`
- Test: `src/api/api.test.ts`

**Interfaces:**
- Consumes: `loadAllIssues`, `findIssue` from `../store/issues.js`;
  `findProjectRoot` from `../store/root.js`; `diagnose` from
  `../store/doctor.js`; `lockState` from `../store/lock.js`;
  `acquireLock`, `releaseLock` from `../store/lock.js`.
- Produces:
  - `interface Session { readonly root: string; readonly env: NodeJS.ProcessEnv; readonly lockTimeoutMs?: number }`
  - `function withLock<T>(s: Session, command: string, fn: () => T): T`
  - `interface Filter { status?: string; component?: string; assignee?: string; type?: string; all?: boolean }`
  - `function applyFilter(issues: Issue[], f: Filter): Issue[]`
  - `function listIssues(s: Session, f?: Filter): LoadResult`
  - `function showIssue(s: Session, prefix: string): Issue`
  - `function grepIssues(s: Session, pattern: string, f?: Filter): LoadResult`
  - `function diagnoseProject(s: Session): Diagnosis[]`
  - `function projectLockState(s: Session): LockState`

- [ ] **Step 1: Write `src/api/session.ts`**

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { acquireLock, releaseLock } from '../store/lock.js';

/**
 * Everything an operation needs that is not its own arguments.
 *
 * Deliberately does not carry an output stream. Rendering belongs to the
 * caller, which is what lets the CLI and a UI share these operations.
 */
export interface Session {
  readonly root: string;
  /** Used for author resolution: DZ_AUTHOR and the VCS probe. */
  readonly env: NodeJS.ProcessEnv;
  /**
   * Overrides DZ_LOCK_TIMEOUT_MS. `0` fails immediately instead of sleeping,
   * which is what a caller implementing its own retry policy sets — a UI
   * cannot afford a synchronous 2s sleep, because it blocks repaint, input
   * and Ctrl-C.
   */
  readonly lockTimeoutMs?: number;
}

/** The env `acquireLock` should see, with any override applied. */
function lockEnv(s: Session): NodeJS.ProcessEnv {
  if (s.lockTimeoutMs === undefined) return s.env;
  return { ...s.env, DZ_LOCK_TIMEOUT_MS: String(s.lockTimeoutMs) };
}

/**
 * Runs `fn` holding the project lock, releasing it however `fn` ends.
 *
 * Taken before any state the mutation depends on is read, so the
 * read-modify-write is serialized as a whole rather than just the write.
 */
export function withLock<T>(s: Session, command: string, fn: () => T): T {
  const handle = acquireLock(s.root, command, lockEnv(s));
  try {
    return fn();
  } finally {
    releaseLock(handle);
  }
}
```

- [ ] **Step 2: Write `src/api/filter.ts`**

Move the logic from `src/cli/filters.ts` verbatim, renaming `ListFilters` to
`Filter` and `applyFilters` to `applyFilter`. Do not change behaviour.

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ISSUE_TYPES, STATUSES } from '../core/types.js';
import type { Issue } from '../core/types.js';
import { validateEnum } from '../core/validate.js';

export interface Filter {
  status?: string;
  component?: string;
  assignee?: string;
  type?: string;
  all?: boolean;
}

export function applyFilter(issues: Issue[], f: Filter): Issue[] {
  // A filter value outside the vocabulary can only ever match nothing, so
  // silently returning an empty list would answer a typo with a wrong answer.
  if (f.status !== undefined) validateEnum(f.status, STATUSES, 'status');
  if (f.type !== undefined) validateEnum(f.type, ISSUE_TYPES, 'type');

  // Closed issues are hidden unless asked for, explicitly or via --all.
  const includeClosed = f.all === true || f.status === 'closed';
  return issues.filter((i) => {
    if (!includeClosed && i.status === 'closed') return false;
    if (f.status !== undefined && i.status !== f.status) return false;
    if (f.component !== undefined && i.component !== f.component) return false;
    if (f.assignee !== undefined && i.assignee !== f.assignee) return false;
    if (f.type !== undefined && i.type !== f.type) return false;
    return true;
  });
}
```

- [ ] **Step 3: Write `src/api/read.ts`**

The `matches` helper moves verbatim from `src/cli/grep.ts`.

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DzError } from '../core/errors.js';
import type { Issue } from '../core/types.js';
import { diagnose } from '../store/doctor.js';
import type { Diagnosis } from '../store/doctor.js';
import { findIssue, loadAllIssues } from '../store/issues.js';
import type { LoadResult } from '../store/issues.js';
import { lockState } from '../store/lock.js';
import type { LockState } from '../store/lock.js';
import { applyFilter } from './filter.js';
import type { Filter } from './filter.js';
import type { Session } from './session.js';

/**
 * Reads take no lock. Every write replaces a file atomically, so a reader sees
 * one whole version or another, and a stuck lock must never block reading.
 */
export function listIssues(s: Session, f: Filter = {}): LoadResult {
  const { issues, failures } = loadAllIssues(s.root);
  return { issues: applyFilter(issues, f), failures };
}

export function showIssue(s: Session, prefix: string): Issue {
  return findIssue(s.root, prefix);
}

function matches(issue: Issue, re: RegExp): boolean {
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

export function grepIssues(s: Session, pattern: string, f: Filter = {}): LoadResult {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (err) {
    throw new DzError('INVALID_FIELD', `invalid regex: ${(err as Error).message}`);
  }
  const { issues, failures } = loadAllIssues(s.root);
  return { issues: applyFilter(issues, f).filter((i) => matches(i, re)), failures };
}

export function diagnoseProject(s: Session): Diagnosis[] {
  return diagnose(s.root, s.env);
}

export function projectLockState(s: Session): LockState {
  return lockState(s.root);
}
```

- [ ] **Step 4: Write the failing tests in `src/api/api.test.ts`**

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DzError } from '../core/errors.js';
import { initProject, saveConfig } from '../store/config.js';
import { grepIssues, listIssues, showIssue } from './read.js';
import type { Session } from './session.js';

let tmp: string;
let s: Session;

const ENV = { DZ_AUTHOR: 'Test User <test@example.com>' };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-api-'));
  initProject(tmp, 'demo');
  saveConfig(tmp, { name: 'demo', components: ['core'] });
  s = { root: tmp, env: ENV };
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('reads', () => {
  it('lists nothing in a fresh project, and reports no failures', () => {
    expect(listIssues(s)).toEqual({ issues: [], failures: [] });
  });

  it('reports unreadable files rather than hiding them', () => {
    fs.writeFileSync(path.join(tmp, 'dz', 'issues', 'junk.md'), 'not an issue\n');
    const { issues, failures } = listIssues(s);
    expect(issues).toEqual([]);
    expect(failures).toHaveLength(1);
  });

  it('rejects a filter value outside the vocabulary', () => {
    expect(() => listIssues(s, { status: 'nope' })).toThrow(DzError);
  });

  it('reports an invalid regex as a user error, not a crash', () => {
    try {
      grepIssues(s, '(');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
    }
  });

  it('raises NOT_FOUND for an id prefix that matches nothing', () => {
    try {
      showIssue(s, 'ffffffff');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('NOT_FOUND');
    }
  });
});
```

- [ ] **Step 5: Run the new tests and watch them fail**

```bash
npx vitest run src/api/api.test.ts
```

Expected before Steps 1-3 exist: FAIL, "Cannot find module './read.js'". If
you wrote the files first, they should already pass — that is acceptable for a
pure move, but read the failure once to confirm the test actually exercises the
new module.

- [ ] **Step 6: Rewire `src/cli/list.ts`**

`reportFailures` stays here: it writes to streams, which is the CLI's job.

```ts
import type { Command } from 'commander';
import { listIssues } from '../api/read.js';
import type { Filter } from '../api/filter.js';
import { EXIT_USER_ERROR } from '../core/errors.js';
import { renderIssueList, renderWarnings } from '../render/human.js';
import { renderIssuesJson, renderWarningsJson } from '../render/json.js';
import type { LoadFailure } from '../store/issues.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { addFilterOptions } from './filters.js';

/** Shared by list and grep: warn about skipped files and mark the run failed. */
export function reportFailures(ctx: CliContext, failures: LoadFailure[]): void {
  if (failures.length === 0) return;
  ctx.stderr.write(
    ctx.json ? renderWarningsJson(failures) : `${renderWarnings(failures)}\n`,
  );
  ctx.exitCode = EXIT_USER_ERROR;
}

export function registerList(program: Command, ctx: CliContext): void {
  const cmd = program.command('list').description('list issues');
  addFilterOptions(cmd).action((opts: Filter) => {
    const session = { root: findProjectRoot(ctx.cwd), env: ctx.env };
    const { issues, failures } = listIssues(session, opts);
    ctx.stdout.write(ctx.json ? renderIssuesJson(issues) : renderIssueList(issues));
    reportFailures(ctx, failures);
  });
}
```

- [ ] **Step 7: Rewire `src/cli/grep.ts`**

```ts
import type { Command } from 'commander';
import { grepIssues } from '../api/read.js';
import type { Filter } from '../api/filter.js';
import { renderIssueList } from '../render/human.js';
import { renderIssuesJson } from '../render/json.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { addFilterOptions } from './filters.js';
import { reportFailures } from './list.js';

export function registerGrep(program: Command, ctx: CliContext): void {
  const cmd = program
    .command('grep')
    .description('search title, body and log text with a JavaScript regex')
    .argument('<regex>');
  addFilterOptions(cmd).action((pattern: string, opts: Filter) => {
    const session = { root: findProjectRoot(ctx.cwd), env: ctx.env };
    const { issues, failures } = grepIssues(session, pattern, opts);
    ctx.stdout.write(ctx.json ? renderIssuesJson(issues) : renderIssueList(issues));
    reportFailures(ctx, failures);
  });
}
```

- [ ] **Step 8: Rewire `src/cli/show.ts`**

```ts
import type { Command } from 'commander';
import { showIssue } from '../api/read.js';
import { renderIssueDetail } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';

export function registerShow(program: Command, ctx: CliContext): void {
  program
    .command('show')
    .description('show one issue in full')
    .argument('<id-prefix>', 'any unambiguous leading substring of the id')
    .action((prefix: string) => {
      const issue = showIssue({ root: findProjectRoot(ctx.cwd), env: ctx.env }, prefix);
      ctx.stdout.write(ctx.json ? renderIssueJson(issue) : renderIssueDetail(issue));
    });
}
```

- [ ] **Step 9: Strip the moved logic out of `src/cli/filters.ts`**

Leave only the commander wiring. Delete `ListFilters` and `applyFilters`, and
delete the now-unused imports of `ISSUE_TYPES`, `STATUSES`, `Issue` and
`validateEnum`.

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';

/**
 * The commander wiring for the shared list/grep filters. The filter itself
 * lives in src/api/filter.ts, so a UI applies exactly the same rules.
 */
export function addFilterOptions(cmd: Command): Command {
  return cmd
    .option('--status <status>', 'open|in-progress|closed')
    .option('--component <component>')
    .option('--assignee <assignee>')
    .option('--type <type>', 'bug|feature|task')
    .option('--all', 'include closed issues');
}
```

- [ ] **Step 10: Typecheck, build, run everything**

```bash
npm run typecheck && npm run build && npx vitest run
```

Expected: typecheck clean; **330 pre-existing tests still pass with no test
file edited**, plus the 5 new ones in `src/api/api.test.ts` — 335 total.
If any pre-existing test fails, the move changed behaviour. Fix the source, not
the test.

- [ ] **Step 11: Lint and commit**

```bash
the formatter and linter
git commit -m 'ditz2: extract the read side into src/api

listIssues, showIssue, grepIssues, diagnoseProject and projectLockState move
into src/api/read.ts, with the filter logic in src/api/filter.ts and the
Session type and lock helper in src/api/session.ts. list, grep and show become
argument parsing plus one call plus one render.

list and grep return {issues, failures} rather than the plain Issue[] the
design document specified, because the CLI partial-failure path needs the
failures and re-reading the directory to recover them would be worse.

src/cli/filters.ts keeps only the commander wiring.

Test Plan:
- npm run typecheck clean, the linter clean
- npx vitest run: 335 passing, all 330 pre-existing tests unmodified'
```

---

## Task 2: The write side

**Files:**
- Create: `src/api/write.ts`
- Modify: `src/cli/add.ts`, `src/cli/set.ts`, `src/cli/comment.ts`, `src/cli/close.ts`
- Modify: `src/cli/init.ts` (import `withLock` instead of `withProjectLock`)
- Test: `src/api/api.test.ts` (append)

**Interfaces:**
- Consumes: `Session` and `withLock` from `./session.js`; `createIssue`,
  `setStatus`, `setField`, `addComment`, `closeIssue` from `../core/mutate.js`;
  `validateIssue`, `validateEnum`, `assertSettableStatus` from
  `../core/validate.js`; `resolveAuthor` from `../store/identity.js`;
  `findIssue`, `writeIssue` from `../store/issues.js`; `loadConfig` from
  `../store/config.js`; `newId` from `../core/id.js`; `nowIso` from
  `../core/clock.js`.
- Produces:
  - `interface NewIssue { title: string; type: string; component?: string | null; body?: string }`
  - `interface EditableFields { status?: string; title?: string; type?: string; component?: string | null; assignee?: string | null }`
  - `function addIssue(s: Session, fields: NewIssue): Issue`
  - `function setFields(s: Session, prefix: string, fields: EditableFields): Issue`
  - `function commentOn(s: Session, prefix: string, text: string): Issue`
  - `function closeIssueBy(s: Session, prefix: string, as: string, comment?: string | null): Issue`

Note: `component` and `assignee` take `null` to clear. The CLI's `''` spelling
is argument parsing and stays in `src/cli/set.ts`.

- [ ] **Step 1: Write `src/api/write.ts`**

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { nowIso } from '../core/clock.js';
import { DzError } from '../core/errors.js';
import { newId } from '../core/id.js';
import { addComment, closeIssue, createIssue, setField, setStatus } from '../core/mutate.js';
import { ISSUE_TYPES, RESOLUTIONS } from '../core/types.js';
import type { Issue, IssueType, Resolution } from '../core/types.js';
import { assertSettableStatus, validateEnum, validateIssue } from '../core/validate.js';
import { loadConfig } from '../store/config.js';
import { resolveAuthor } from '../store/identity.js';
import { findIssue, writeIssue } from '../store/issues.js';
import { withLock } from './session.js';
import type { Session } from './session.js';

export interface NewIssue {
  title: string;
  type: string;
  component?: string | null;
  body?: string;
}

export interface EditableFields {
  status?: string;
  title?: string;
  type?: string;
  /** null clears it. */
  component?: string | null;
  /** null clears it. */
  assignee?: string | null;
}

export function addIssue(s: Session, fields: NewIssue): Issue {
  return withLock(s, 'add', () => {
    const config = loadConfig(s.root);
    const issue = createIssue(
      {
        id: newId(),
        title: fields.title,
        type: validateEnum<IssueType>(fields.type, ISSUE_TYPES, 'type'),
        component: fields.component ?? null,
        body: fields.body ?? '',
      },
      resolveAuthor(s.root, s.env),
      nowIso(),
    );
    validateIssue(issue, config);
    writeIssue(s.root, issue);
    return issue;
  });
}

export function setFields(s: Session, prefix: string, fields: EditableFields): Issue {
  const given = Object.values(fields).filter((v) => v !== undefined);
  if (given.length === 0) {
    throw new DzError(
      'INVALID_FIELD',
      'no field given; set at least one of status, title, type, component, assignee',
    );
  }

  return withLock(s, 'set', () => {
    const config = loadConfig(s.root);
    const author = resolveAuthor(s.root, s.env);
    const at = nowIso();

    let issue: Issue = findIssue(s.root, prefix);
    if (fields.status !== undefined) {
      assertSettableStatus(fields.status);
      issue = setStatus(issue, fields.status, author, at);
    }
    if (fields.title !== undefined) issue = setField(issue, 'title', fields.title, config, author, at);
    if (fields.type !== undefined) issue = setField(issue, 'type', fields.type, config, author, at);
    if (fields.component !== undefined) {
      issue = setField(issue, 'component', fields.component, config, author, at);
    }
    if (fields.assignee !== undefined) {
      issue = setField(issue, 'assignee', fields.assignee, config, author, at);
    }

    validateIssue(issue, config);
    writeIssue(s.root, issue);
    return issue;
  });
}

export function commentOn(s: Session, prefix: string, text: string): Issue {
  return withLock(s, 'comment', () => {
    const author = resolveAuthor(s.root, s.env);
    const issue = addComment(findIssue(s.root, prefix), text, author, nowIso());
    // Appending a comment cannot itself break an invariant, but every other
    // mutating operation validates before writing and a uniform path is worth
    // more than the skipped check saves.
    validateIssue(issue, loadConfig(s.root));
    writeIssue(s.root, issue);
    return issue;
  });
}

export function closeIssueBy(
  s: Session,
  prefix: string,
  as: string,
  comment: string | null = null,
): Issue {
  return withLock(s, 'close', () => {
    const config = loadConfig(s.root);
    const author = resolveAuthor(s.root, s.env);
    const resolution = validateEnum<Resolution>(as, RESOLUTIONS, 'resolution');

    const issue = closeIssue(findIssue(s.root, prefix), resolution, comment, author, nowIso());
    validateIssue(issue, config);
    writeIssue(s.root, issue);
    return issue;
  });
}
```

- [ ] **Step 2: Append failing tests to `src/api/api.test.ts`**

Add these imports at the top of the file:

```ts
import { addIssue, closeIssueBy, commentOn, setFields } from './write.js';
```

Then append:

```ts
describe('writes', () => {
  function anIssue(title = 'A title'): string {
    return addIssue(s, { title, type: 'task' }).id;
  }

  it('creates an issue and reads it back', () => {
    const id = anIssue('written through the facade');
    expect(listIssues(s).issues.map((i) => i.title)).toEqual(['written through the facade']);
    expect(showIssue(s, id.slice(0, 13)).title).toBe('written through the facade');
  });

  it('changes several fields in one call', () => {
    const id = anIssue();
    const updated = setFields(s, id.slice(0, 13), {
      title: 'Renamed', type: 'bug', component: 'core', status: 'in-progress',
    });
    expect(updated.title).toBe('Renamed');
    expect(updated.type).toBe('bug');
    expect(updated.component).toBe('core');
    expect(updated.status).toBe('in-progress');
  });

  it('clears a field with null rather than an empty string', () => {
    const id = anIssue();
    setFields(s, id.slice(0, 13), { assignee: 'someone' });
    expect(setFields(s, id.slice(0, 13), { assignee: null }).assignee).toBeNull();
  });

  it('refuses a set with no fields', () => {
    const id = anIssue();
    try {
      setFields(s, id.slice(0, 13), {});
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
    }
  });

  it('refuses a component that is not configured', () => {
    try {
      addIssue(s, { title: 'x', type: 'task', component: 'nope' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
    }
  });

  it('appends a comment', () => {
    const id = anIssue();
    const after = commentOn(s, id.slice(0, 13), 'a remark');
    expect(JSON.stringify(after.log)).toContain('a remark');
  });

  it('closes with a resolution and refuses an unknown one', () => {
    const id = anIssue();
    expect(closeIssueBy(s, id.slice(0, 13), 'fixed').status).toBe('closed');
    const other = anIssue('another');
    try {
      closeIssueBy(s, other.slice(0, 13), 'abandoned');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
    }
  });

  it('releases the lock after every write, so the next one succeeds', () => {
    const id = anIssue();
    commentOn(s, id.slice(0, 13), 'one');
    commentOn(s, id.slice(0, 13), 'two');
    expect(fs.existsSync(path.join(tmp, 'dz', '.lock'))).toBe(false);
  });

  it('fails immediately with LOCKED when lockTimeoutMs is 0 and a lock is held', () => {
    const id = anIssue();
    // A foreign, live-looking lock: this host, this pid, so it reads as active.
    fs.writeFileSync(path.join(tmp, 'dz', '.lock'), JSON.stringify({
      version: 1, token: 'held', pid: process.pid,
      hostname: os.hostname(),
      created: new Date().toISOString(), command: 'comment',
    }));
    const impatient: Session = { root: tmp, env: ENV, lockTimeoutMs: 0 };
    const started = Date.now();
    try {
      commentOn(impatient, id.slice(0, 13), 'blocked');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('LOCKED');
    }
    // The whole point of lockTimeoutMs: 0 for a UI — no synchronous sleep.
    expect(Date.now() - started).toBeLessThan(150);
  });
});
```

- [ ] **Step 3: Run the new tests**

```bash
npx vitest run src/api/api.test.ts
```

Expected: all pass. If the `LOCKED` timing assertion fails, `lockTimeoutMs` is
not reaching `acquireLock` — check `lockEnv` in `src/api/session.ts`.

- [ ] **Step 4: Rewire `src/cli/add.ts`**

```ts
import type { Command } from 'commander';
import { addIssue } from '../api/write.js';
import { ISSUE_TYPES } from '../core/types.js';
import { shortId } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { readMessage } from './message.js';

interface AddOptions {
  type: string;
  component?: string;
  message?: string;
}

export function registerAdd(program: Command, ctx: CliContext): void {
  program
    .command('add')
    .description('create a new issue')
    .argument('<title>', 'issue title')
    .option('--type <type>', `one of ${ISSUE_TYPES.join('|')}`, 'task')
    .option('--component <component>', 'a component from dz/config.yaml')
    .option('-m, --message <text>', "body text, or '-' to read stdin")
    .action((title: string, opts: AddOptions) => {
      const root = findProjectRoot(ctx.cwd);
      // Read before the lock. `-m -` blocks until stdin closes, which is as
      // long as a slow producer runs or a human takes to press Ctrl-D, and no
      // part of a message body is project state worth serializing.
      const body = readMessage(opts.message);

      const issue = addIssue({ root, env: ctx.env }, {
        title,
        type: opts.type,
        component: opts.component ?? null,
        body,
      });
      ctx.stdout.write(
        ctx.json ? renderIssueJson(issue) : `created ${shortId(issue.id)}  ${issue.title}\n`,
      );
    });
}
```

- [ ] **Step 5: Rewire `src/cli/set.ts`**

The `'' means clear` translation stays here — it is argument parsing.

```ts
import type { Command } from 'commander';
import { setFields } from '../api/write.js';
import { shortId } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';

interface SetOptions {
  status?: string;
  title?: string;
  component?: string;
  assignee?: string;
  type?: string;
}

/** `--component ''` and `--assignee ''` clear the field; the API takes null. */
function clearable(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === '' ? null : value;
}

export function registerSet(program: Command, ctx: CliContext): void {
  program
    .command('set')
    .description('change fields on an issue')
    .argument('<id-prefix>')
    .option('--status <status>', 'open|in-progress (use `dz close` to close)')
    .option('--title <title>')
    .option('--component <component>')
    .option('--assignee <assignee>', "use '' to clear")
    .option('--type <type>', 'bug|feature|task')
    .action((prefix: string, opts: SetOptions) => {
      const issue = setFields({ root: findProjectRoot(ctx.cwd), env: ctx.env }, prefix, {
        status: opts.status,
        title: opts.title,
        type: opts.type,
        component: clearable(opts.component),
        assignee: clearable(opts.assignee),
      });
      ctx.stdout.write(ctx.json ? renderIssueJson(issue) : `updated ${shortId(issue.id)}\n`);
    });
}
```

- [ ] **Step 6: Rewire `src/cli/comment.ts`**

```ts
import type { Command } from 'commander';
import { commentOn } from '../api/write.js';
import { shortId } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { readMessage } from './message.js';

export function registerComment(program: Command, ctx: CliContext): void {
  program
    .command('comment')
    .description('append a comment to an issue')
    .argument('<id-prefix>')
    .requiredOption('-m, --message <text>', "comment text, or '-' to read stdin")
    .action((prefix: string, opts: { message: string }) => {
      const root = findProjectRoot(ctx.cwd);
      // Read before the lock. `-m -` blocks until stdin closes, which is as
      // long as a slow producer runs or a human takes to press Ctrl-D, and no
      // part of a message body is project state worth serializing.
      const text = readMessage(opts.message);

      const issue = commentOn({ root, env: ctx.env }, prefix, text);
      ctx.stdout.write(
        ctx.json ? renderIssueJson(issue) : `commented on ${shortId(issue.id)}\n`,
      );
    });
}
```

- [ ] **Step 7: Rewire `src/cli/close.ts`**

Keep the existing `--as` option wiring and the `RESOLUTIONS` import used in its
description; the value is validated inside `closeIssueBy`.

```ts
import type { Command } from 'commander';
import { closeIssueBy } from '../api/write.js';
import { RESOLUTIONS } from '../core/types.js';
import { shortId } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { readMessage } from './message.js';

export function registerClose(program: Command, ctx: CliContext): void {
  program
    .command('close')
    .description('close an issue with a resolution')
    .argument('<id-prefix>')
    .requiredOption('--as <resolution>', RESOLUTIONS.join('|'))
    .option('-m, --message <text>', "closing comment, or '-' to read stdin")
    .action((prefix: string, opts: { as: string; message?: string }) => {
      const root = findProjectRoot(ctx.cwd);
      // Read before the lock. `-m -` blocks until stdin closes, which is as
      // long as a slow producer runs or a human takes to press Ctrl-D, and no
      // part of a message body is project state worth serializing.
      const comment = opts.message === undefined ? null : readMessage(opts.message);

      const issue = closeIssueBy({ root, env: ctx.env }, prefix, opts.as, comment);
      ctx.stdout.write(
        ctx.json ? renderIssueJson(issue) : `closed ${shortId(issue.id)} (${opts.as})\n`,
      );
    });
}
```

- [ ] **Step 8: Point `src/cli/init.ts` at the new lock helper**

`init` is not moving to the facade, but `src/cli/lock.ts` is going away. Change
its import and call:

```ts
import { withLock } from '../api/session.js';
```

and replace `withProjectLock(ctx, root, 'init', () => {` with
`withLock({ root, env: ctx.env }, 'init', () => {`. Nothing else in the file
changes.

- [ ] **Step 9: Typecheck, build, run everything**

```bash
npm run typecheck && npm run build && npx vitest run
```

Expected: **330 pre-existing tests still pass with no test file edited**, plus
14 in `src/api/api.test.ts` — 344 total.

Watch for one specific regression: `dz close` previously rendered the
resolution from the validated value. It now renders `opts.as` directly. Those
are the same string for every valid input, and an invalid one throws before the
write, so the output is unchanged — but confirm the close tests pass rather
than assuming.

- [ ] **Step 10: Lint and commit**

```bash
the formatter and linter
git commit -m 'ditz2: extract the write side into src/api

addIssue, setFields, commentOn and closeIssueBy move into src/api/write.ts,
each taking the project lock for its own read-modify-write exactly as the
commands did. add, set, comment and close become argument parsing plus one call
plus one render.

The API clears a field with null; the CLI keeps translating its `--assignee ""`
spelling, which is argument parsing rather than a project operation.

init does not move -- it is the only command that runs without a project, so it
cannot be a Project method -- but it now takes the lock through
src/api/session.ts so src/cli/lock.ts can be deleted.

Test Plan:
- npm run typecheck clean, the linter clean
- npx vitest run: 344 passing, all 330 pre-existing tests unmodified
- includes a test that lockTimeoutMs 0 fails in under 150ms rather than
  sleeping, which is the property the TUI depends on'
```

---

## Task 3: Components, doctor and the lock

**Files:**
- Modify: `src/api/write.ts` (append component operations and `breakProjectLock`)
- Modify: `src/cli/component.ts`, `src/cli/doctor.ts`, `src/cli/unlock.ts`
- Test: `src/api/api.test.ts` (append)

**Interfaces:**
- Consumes: `Session`, `withLock`; `loadConfig`, `saveConfig` from
  `../store/config.js`; `loadAllIssues` from `../store/issues.js`; `breakLock`
  from `../store/lock.js`; `diagnoseProject` and `projectLockState` from
  `./read.js` (already built in Task 1).
- Produces:
  - `function listComponents(s: Session): string[]`
  - `function addComponent(s: Session, name: string): { components: string[]; added: boolean }`
  - `function removeComponent(s: Session, name: string, force?: boolean): string[]`
  - `function breakProjectLock(s: Session, expectedToken: string | null): boolean`

- [ ] **Step 1: Append the component operations to `src/api/write.ts`**

Add these imports to the existing import block:

```ts
import { loadConfig, saveConfig } from '../store/config.js';
import { findIssue, loadAllIssues, writeIssue } from '../store/issues.js';
import { breakLock } from '../store/lock.js';
```

(`loadConfig` and `findIssue`/`writeIssue` are already imported from Task 2 —
extend those lines rather than duplicating them.)

Then append:

```ts
export function listComponents(s: Session): string[] {
  return loadConfig(s.root).components;
}

export function addComponent(
  s: Session,
  name: string,
): { components: string[]; added: boolean } {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new DzError('INVALID_FIELD', 'a component name cannot be empty');
  }
  return withLock(s, 'component add', () => {
    const config = loadConfig(s.root);
    // Idempotent: re-adding is what a script or an agent does on a rerun, and
    // failing there would be noise rather than information. `added` is
    // reported rather than left for the caller to infer, so a caller wording a
    // message does not have to re-read the list outside this lock and race.
    if (config.components.includes(trimmed)) {
      return { components: config.components, added: false };
    }

    const components = [...config.components, trimmed].sort();
    saveConfig(s.root, { ...config, components });
    return { components, added: true };
  });
}

export function removeComponent(s: Session, name: string, force = false): string[] {
  return withLock(s, 'component rm', () => {
    const config = loadConfig(s.root);

    // Removing something that is not there is almost always a typo, so it is
    // an error rather than a silent success. `add` is the idempotent one.
    if (!config.components.includes(name)) {
      throw new DzError(
        'NOT_FOUND',
        config.components.length === 0
          ? `no component "${name}"; dz/config.yaml lists no components yet`
          : `no component "${name}"; dz/config.yaml lists ${config.components.join(', ')}`,
      );
    }

    // Removing a component in use is what creates issues that cannot be
    // modified afterwards, which `dz doctor` then reports. Say so first.
    const inUse = loadAllIssues(s.root).issues.filter((i) => i.component === name);
    if (inUse.length > 0 && !force) {
      const ids = inUse.map((i) => `  ${i.id}  ${i.title}`).join('\n');
      throw new DzError(
        'INVALID_FIELD',
        `${inUse.length === 1 ? '1 issue still uses' : `${inUse.length} issues still use`} component "${name}":\n${ids}\n`
        + `reassign them with 'dz set --component', or pass --force to remove it anyway. `
        + `Forcing leaves those issues unmodifiable until their component is changed; 'dz doctor' will report them.`,
      );
    }

    const components = config.components.filter((c) => c !== name);
    saveConfig(s.root, { ...config, components });
    return components;
  });
}

/**
 * Removes a lock this session does not hold, for `dz unlock`. See breakLock in
 * store/lock.ts for why this narrows the race rather than closing it.
 */
export function breakProjectLock(s: Session, expectedToken: string | null): boolean {
  return breakLock(s.root, expectedToken);
}
```

Note the message text is copied verbatim from `src/cli/component.ts`, including
its mention of `dz set --component`. Existing integration tests assert on that
wording, so changing it would break the acceptance gate.

- [ ] **Step 2: Append tests to `src/api/api.test.ts`**

Add to the imports:

```ts
import { addComponent, listComponents, removeComponent } from './write.js';
import { diagnoseProject, projectLockState } from './read.js';
```

Then append:

```ts
describe('components, doctor and the lock', () => {
  it('adds a component idempotently and keeps the list sorted', () => {
    expect(addComponent(s, 'zeta')).toEqual({ components: ['core', 'zeta'], added: true });
    expect(addComponent(s, 'alpha'))
      .toEqual({ components: ['alpha', 'core', 'zeta'], added: true });
    // Re-adding reports added: false, which is what lets the CLI word its
    // message without a second, unlocked read.
    expect(addComponent(s, 'alpha'))
      .toEqual({ components: ['alpha', 'core', 'zeta'], added: false });
  });

  it('refuses an empty component name', () => {
    expect(() => addComponent(s, '   ')).toThrow(DzError);
  });

  it('refuses to remove a component that does not exist', () => {
    try {
      removeComponent(s, 'ghost');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('NOT_FOUND');
    }
  });

  it('refuses to remove a component in use, unless forced', () => {
    addIssue(s, { title: 'uses core', type: 'task', component: 'core' });
    try {
      removeComponent(s, 'core');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
    }
    expect(removeComponent(s, 'core', true)).toEqual([]);
  });

  it('reports a healthy project as having no problems', () => {
    expect(diagnoseProject(s)).toEqual([]);
  });

  it('reports the gitignore problem doctor exists to catch', () => {
    fs.rmSync(path.join(tmp, 'dz', '.gitignore'));
    expect(diagnoseProject(s).map((p) => p.code)).toContain('GITIGNORE_MISSING');
  });

  it('reports no lock on a quiet project', () => {
    expect(projectLockState(s).kind).toBe('none');
  });
});
```

- [ ] **Step 3: Run the new tests**

```bash
npx vitest run src/api/api.test.ts
```

Expected: all pass.

- [ ] **Step 4: Rewire `src/cli/component.ts`**

```ts
import type { Command } from 'commander';
import { addComponent, listComponents, removeComponent } from '../api/write.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';

function report(ctx: CliContext, components: string[], humanLine: string): void {
  ctx.stdout.write(
    ctx.json ? `${JSON.stringify({ components }, null, 2)}\n` : humanLine,
  );
}

function listing(components: string[]): string {
  return components.length === 0
    ? 'no components configured\n'
    : `${components.join('\n')}\n`;
}

export function registerComponent(program: Command, ctx: CliContext): void {
  const component = program
    .command('component')
    .description('manage the component list in dz/config.yaml');

  component
    .command('list')
    .description('list the configured components')
    .action(() => {
      const components = listComponents({ root: findProjectRoot(ctx.cwd), env: ctx.env });
      report(ctx, components, listing(components));
    });

  component
    .command('add')
    .description('add a component')
    .argument('<name>')
    .action((name: string) => {
      const { components, added } = addComponent(
        { root: findProjectRoot(ctx.cwd), env: ctx.env },
        name,
      );
      const trimmed = name.trim();
      report(
        ctx,
        components,
        added
          ? `added component "${trimmed}"\n`
          : `component "${trimmed}" is already configured\n`,
      );
    });

  component
    .command('rm')
    .description('remove a component')
    .argument('<name>')
    .option('--force', 'remove it even though issues still use it')
    .action((name: string, opts: { force?: boolean }) => {
      const components = removeComponent(
        { root: findProjectRoot(ctx.cwd), env: ctx.env },
        name,
        opts.force === true,
      );
      report(ctx, components, `removed component "${name}"\n`);
    });
}
```

The `already configured` wording is asserted by an existing test. `addComponent`
reports `added` so the CLI can choose the sentence from a fact established
inside the lock, rather than re-reading the list outside it and racing.

- [ ] **Step 5: Rewire `src/cli/doctor.ts`**

```ts
import type { Command } from 'commander';
import { diagnoseProject } from '../api/read.js';
import { EXIT_USER_ERROR } from '../core/errors.js';
import { renderDiagnoses } from '../render/human.js';
import { renderDiagnosesJson } from '../render/json.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';

export function registerDoctor(program: Command, ctx: CliContext): void {
  program
    .command('doctor')
    .description('check the project for common problems')
    .action(() => {
      const problems = diagnoseProject({ root: findProjectRoot(ctx.cwd), env: ctx.env });
      ctx.stdout.write(ctx.json ? renderDiagnosesJson(problems) : renderDiagnoses(problems));
      // Findings are the result, not a failure to produce one, so they go to
      // stdout. The exit code is what a script branches on.
      if (problems.length > 0) ctx.exitCode = EXIT_USER_ERROR;
    });
}
```

- [ ] **Step 6: Rewire `src/cli/unlock.ts`**

Replace the two direct store imports with facade calls. Everything else in the
file — the `active` and `malformed` refusals, the `--force` warnings, the
`removed` JSON payload — stays byte for byte, because tests assert on it.

```ts
import { breakProjectLock } from '../api/write.js';
import { projectLockState } from '../api/read.js';
```

Then `const state = lockState(root);` becomes
`const session = { root, env: ctx.env }; const state = projectLockState(session);`
and `if (!breakLock(root, before))` becomes
`if (!breakProjectLock(session, before))`.

- [ ] **Step 7: Typecheck, build, run everything**

```bash
npm run typecheck && npm run build && npx vitest run
```

Expected: **330 pre-existing tests still pass with no test file edited**, plus
21 in `src/api/api.test.ts` — 351 total.

`src/cli/lock.ts` stays for now: `src/cli/edit.ts` still imports
`withProjectLock` from it and is not rewired until Task 4, which deletes it.

- [ ] **Step 8: Lint and commit**

```bash
the formatter and linter
git commit -m 'ditz2: move components, doctor and unlock onto the facade

listComponents, addComponent, removeComponent and breakProjectLock join
src/api/write.ts; doctor and lock state were already in src/api/read.ts from
the first task. The three commands become parsing plus one call plus one
render.

src/cli/lock.ts survives this task: src/cli/edit.ts still imports
withProjectLock from it, and edit does not move onto the facade until the next
task, which deletes it.

Component error messages are copied verbatim rather than reworded, because
integration tests assert on them and rewording would fail the gate this
refactor is measured by.

Test Plan:
- npm run typecheck clean, the linter clean
- npx vitest run: 351 passing, all 330 pre-existing tests unmodified'
```

---

## Task 4: `saveEdited`, the compare-and-swap behind `dz edit`

**Files:**
- Modify: `src/api/write.ts` (append `saveEdited`)
- Modify: `src/cli/edit.ts`
- Test: `src/api/api.test.ts` (append)

**Interfaces:**
- Produces:
  - `type SaveResult = { saved: true; issue: Issue } | { saved: false; current: string | null }`
  - `function saveEdited(s: Session, issue: Issue, baseline: string | null): SaveResult`

**Second correction to the spec.** The design gives
`saveEdited(issue, baseline, opts?: { force?: boolean })`. The `force` flag is
unnecessary and is dropped.

Forcing already means "write over the version I was shown", and the version you
were shown is a baseline. So force is just another `saveEdited` call with the
conflicting bytes as the baseline: if the file moved on again, it fails again
and the caller asks again. One compare-and-swap primitive covers the normal
save, the reload, and the force, and there is no parameter that means "skip the
safety check".

Returning a union rather than throwing on conflict is deliberate too: the
caller needs the conflicting bytes to offer reload, and data belongs in a
return value rather than attached to an exception. Genuine failures — invalid
issue, unwritable disk — still throw.

**Correction found during implementation.** `baseline` is `string | null`, not
`string`. A deleted file reads as `current === null`, and an earlier draft had
the caller pass `conflict ?? ''`, which can never equal `null` — so
`dz edit --on-conflict force` on an issue removed mid-session looped forever,
re-taking the lock and re-failing. The caller passes `conflict` through
unchanged and `null` means "the file was absent when I looked".

- [ ] **Step 1: Append `saveEdited` to `src/api/write.ts`**

```ts
export type SaveResult =
  | { saved: true; issue: Issue }
  | { saved: false; current: string | null };

/**
 * Writes `issue` only if its file on disk still contains exactly `baseline`.
 *
 * This is the compare-and-swap that makes editing outside the lock safe. The
 * editor runs unlocked for however long a human takes; the comparison happens
 * under the lock, immediately before the write.
 *
 * A conflict is a result, not an error: the caller gets the current bytes so
 * it can offer to reload them. Forcing is not a parameter — it is this same
 * call with the conflicting bytes as the new baseline, which is why a forced
 * write still cannot clobber a version nobody has seen.
 */
export function saveEdited(s: Session, issue: Issue, baseline: string | null): SaveResult {
  return withLock(s, 'edit', () => {
    const target = issuePath(s.root, issue.id);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current !== baseline) return { saved: false, current };

    // Re-validate under the lock. The caller's check ran before the lock was
    // taken, and the conflict prompt can block on a human for a long time in
    // between — long enough for `component rm --force` to invalidate this
    // issue after it was last checked.
    validateIssue(issue, loadConfig(s.root));
    writeIssue(s.root, issue);
    return { saved: true, issue };
  });
}
```

Add to the import block at the top of the file:

```ts
import fs from 'node:fs';
import { issuePath } from '../store/issues.js';
```

(`issuePath` joins the existing `findIssue, loadAllIssues, writeIssue` import.)

- [ ] **Step 2: Append tests to `src/api/api.test.ts`**

Add `saveEdited` to the `./write.js` import, and `parseIssue` from
`../core/serialize.js`, and `issuePath` from `../store/issues.js`.

```ts
describe('saveEdited', () => {
  function fileFor(id: string): string {
    return issuePath(tmp, id);
  }

  it('writes when the file still matches the baseline', () => {
    const id = addIssue(s, { title: 'Original', type: 'task' }).id;
    const baseline = fs.readFileSync(fileFor(id), 'utf8');
    const edited = parseIssue(baseline.replace('title: Original', 'title: Edited'), 'scratch');

    const r = saveEdited(s, edited, baseline);

    expect(r.saved).toBe(true);
    expect(showIssue(s, id.slice(0, 13)).title).toBe('Edited');
  });

  it('refuses and hands back the current bytes when someone else wrote first', () => {
    const id = addIssue(s, { title: 'Original', type: 'task' }).id;
    const baseline = fs.readFileSync(fileFor(id), 'utf8');
    const edited = parseIssue(baseline.replace('title: Original', 'title: Mine'), 'scratch');

    // Another writer lands while the editor is open.
    setFields(s, id.slice(0, 13), { title: 'Theirs' });

    const r = saveEdited(s, edited, baseline);

    expect(r.saved).toBe(false);
    if (r.saved) return;
    expect(r.current).toContain('title: Theirs');
    // Nothing was overwritten.
    expect(showIssue(s, id.slice(0, 13)).title).toBe('Theirs');
  });

  it('lets a second attempt against the newer bytes succeed, which is what forcing is', () => {
    const id = addIssue(s, { title: 'Original', type: 'task' }).id;
    const baseline = fs.readFileSync(fileFor(id), 'utf8');
    const edited = parseIssue(baseline.replace('title: Original', 'title: Mine'), 'scratch');
    setFields(s, id.slice(0, 13), { title: 'Theirs' });

    const first = saveEdited(s, edited, baseline);
    expect(first.saved).toBe(false);
    if (first.saved) return;

    const second = saveEdited(s, edited, first.current as string);

    expect(second.saved).toBe(true);
    expect(showIssue(s, id.slice(0, 13)).title).toBe('Mine');
  });

  it('still refuses an issue that validation rejects', () => {
    const id = addIssue(s, { title: 'Original', type: 'task' }).id;
    const baseline = fs.readFileSync(fileFor(id), 'utf8');
    const bad = parseIssue(baseline.replace('title: Original', 'title: ""'), 'scratch');
    expect(() => saveEdited(s, bad, baseline)).toThrow(DzError);
    expect(showIssue(s, id.slice(0, 13)).title).toBe('Original');
  });
});
```

- [ ] **Step 3: Run the new tests**

```bash
npx vitest run src/api/api.test.ts
```

Expected: all pass.

- [ ] **Step 4: Rewire `src/cli/edit.ts` onto `saveEdited`**

`edit.ts` keeps everything about the terminal: resolving `$EDITOR`, the scratch
directory, `setAside`, the `--on-conflict` flag, and the stdin prompt. What
changes is that the locked byte-comparison is no longer written here.

Replace the local `commit` helper and both `withProjectLock` blocks with calls
to `saveEdited`. The main loop becomes:

```ts
      const issue = ((): Issue => {
        for (;;) {
          runEditor();
          const edited = readEdited();

          const first = save(edited, baseline);
          if (first.saved) return first.issue;
          let conflict: string | null = first.current;

          // Deliberately outside the lock: whatever happens next waits on a
          // human, and holding the lock across that blocks every other writer.
          for (;;) {
            const action = decide();
            if (action === 'abort') throw aborted();

            if (action === 'reload') {
              const kept = setAside('your-edit', fs.readFileSync(scratch, 'utf8'));
              fs.writeFileSync(scratch, conflict ?? '', 'utf8');
              baseline = conflict;
              ctx.stderr.write(`your version was kept at ${kept}\n`);
              break; // reopen the editor on the fresh content
            }

            // Force is the same compare-and-swap against the bytes the operator
            // was actually shown. If the file moved on again, ask again rather
            // than overwrite something nobody has seen.
            const forced = save(edited, conflict);
            if (forced.saved) {
              // Announced only after the write succeeded. Saying "the version
              // you overwrote" before knowing whether anything was overwritten
              // is a lie on a double race, where the save is refused and the
              // operator is re-prompted.
              if (conflict !== null) {
                ctx.stderr.write(
                  `the version you overwrote was kept at ${setAside('overwritten', conflict)}\n`,
                );
              }
              return forced.issue;
            }
            conflict = forced.current;
          }
        }
      })();
```

`baseline` is declared `let baseline: string | null = fs.readFileSync(...)`,
because the reload path reassigns it.

`save` is a small local wrapper that restores one thing the deleted `commit`
helper used to do — telling the user where their work is when a validation
failure happens under the lock:

```ts
      const save = (issue: Issue, base: string | null): SaveResult => {
        try {
          return saveEdited(session, issue, base);
        } catch (err) {
          // A validation failure here is a judgement about the user's edit, so
          // it must name the scratch file — their work is on disk and nothing
          // else would tell them where. LOCKED is not about the edit and is
          // rethrown untouched, or every contended save would claim the issue
          // was invalid.
          if (!(err instanceof DzError) || err.code === 'LOCKED') throw err;
          throw new DzError(
            err.code,
            `${err.message}. The issue was not changed; your edit is at ${scratch}`,
          );
        }
      };
```

with `const session = { root, env: ctx.env };` declared alongside `root`, and
these imports replacing the removed ones:

```ts
import { saveEdited } from '../api/write.js';
import type { SaveResult } from '../api/write.js';
```

Remove the now-unused imports: `withProjectLock` and `writeIssue`. **Keep
`loadConfig` and `validateIssue`** — `readEdited` still calls
`validateIssue(issue, loadConfig(root))` before the lock is taken, and dropping
them is a compile error. Keep `parseIssue`, `findIssue`, `issuePath`, `DzError`
and the rest.

One behavioural detail to preserve: `readEdited` still calls `validateIssue`
against the config as it was before the editor opened, so an obviously broken
edit is rejected without taking the lock at all. `saveEdited` re-validates
under the lock. Both checks stay.

- [ ] **Step 5: Delete `src/cli/lock.ts`**

`src/cli/edit.ts` was its last importer. Confirm, then remove it:

```bash
grep -rn "from './lock.js'" src/cli/ || echo "no importers"
git rm src/cli/lock.ts
```

If anything still imports it, stop and report — do not work around it.

- [ ] **Step 6: Typecheck, build, run everything**

```bash
npm run typecheck && npm run build && npx vitest run
```

Expected: **330 pre-existing tests still pass with no test file edited**, plus
25 in `src/api/api.test.ts` — 355 total.

`tests/cli/edit-conflict.test.ts` is the one that matters here: 11 tests
covering abort, force, reload, EOF, an unrecognised answer, both
`--on-conflict` values and the two cases that must not prompt. If the force or
reload test fails, the baseline threading in the loop above is wrong.

- [ ] **Step 7: Lint and commit**

```bash
the formatter and linter
git commit -m 'ditz2: move the edit compare-and-swap into the facade

saveEdited writes an issue only if its file still contains exactly the bytes
the edit was based on, comparing under the lock immediately before the write.
dz edit keeps everything terminal-shaped -- $EDITOR, the scratch directory, the
--on-conflict flag, the prompt -- and no longer implements the comparison.

The spec gave saveEdited a force flag; it is dropped. Forcing means writing
over the version you were shown, and that version is a baseline, so force is
the same call with the conflicting bytes. One primitive covers the save, the
reload and the force, and there is no parameter meaning "skip the check".

A conflict returns {saved: false, current} rather than throwing, because the
caller needs the conflicting bytes to offer a reload and data belongs in a
return value.

src/cli/lock.ts is deleted here rather than in the previous task: edit was its
last importer.

Test Plan:
- npm run typecheck clean, the linter clean
- npx vitest run: 355 passing, all 330 pre-existing tests unmodified
- the 11 tests in tests/cli/edit-conflict.test.ts exercise this through the
  built binary, including the pty-driven interactive answers'
```

---

## Task 5: The public entry point

**Files:**
- Create: `src/api/index.ts`
- Modify: `package.json` (add `exports`)
- Modify: `src/api/api.test.ts` (append)
- Modify: `docs/superpowers/specs/2026-08-25-ditz2-tui-design.md` (two corrections)
- Modify: `README.md`

**Interfaces:**
- Produces: `openProject`, `Project`, `ProjectOptions`, and the public type
  re-exports listed below.

- [ ] **Step 1: Write `src/api/index.ts`**

`openProject` binds a session to the module functions. Its methods are
one-line delegations on purpose: the shared implementation is those functions,
which the CLI calls directly, so there is nothing here to drift.

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Diagnosis } from '../store/doctor.js';
import type { LoadResult } from '../store/issues.js';
import type { LockState } from '../store/lock.js';
import { findProjectRoot } from '../store/root.js';
import { diagnoseProject, grepIssues, listIssues, projectLockState, showIssue } from './read.js';
import {
  addComponent, addIssue, breakProjectLock, closeIssueBy, commentOn,
  listComponents, removeComponent, saveEdited, setFields,
} from './write.js';
import type { Session } from './session.js';
import type { Filter } from './filter.js';
import type { EditableFields, NewIssue, SaveResult } from './write.js';
import type { Issue } from '../core/types.js';

export type { Filter } from './filter.js';
export type { EditableFields, NewIssue, SaveResult } from './write.js';
export type { Diagnosis } from '../store/doctor.js';
export type { LoadFailure, LoadResult } from '../store/issues.js';
export type { LockInfo, LockState } from '../store/lock.js';
export type {
  Config, Issue, IssueType, LogEntry, Resolution, Status,
} from '../core/types.js';
export { ISSUE_TYPES, RESOLUTIONS, STATUSES } from '../core/types.js';
export { DzError } from '../core/errors.js';
export type { DzErrorCode } from '../core/errors.js';
export { SCHEMA_VERSION, JSON_SCHEMA } from '../render/schema.js';

export interface ProjectOptions {
  /**
   * Used for author resolution. Required rather than defaulted to process.env,
   * so no operation ever reads global state behind the caller's back.
   */
  env: NodeJS.ProcessEnv;
  /**
   * Overrides DZ_LOCK_TIMEOUT_MS. Pass 0 to fail immediately instead of
   * sleeping — a UI cannot afford a synchronous wait, because it blocks
   * repaint, keyboard input and Ctrl-C.
   */
  lockTimeoutMs?: number;
}

export interface Project {
  readonly root: string;

  list(filter?: Filter): LoadResult;
  show(prefix: string): Issue;
  grep(pattern: string, filter?: Filter): LoadResult;

  add(fields: NewIssue): Issue;
  set(prefix: string, fields: EditableFields): Issue;
  comment(prefix: string, text: string): Issue;
  close(prefix: string, as: string, comment?: string | null): Issue;

  components: {
    list(): string[];
    add(name: string): { components: string[]; added: boolean };
    remove(name: string, force?: boolean): string[];
  };

  doctor(): Diagnosis[];
  lock: {
    state(): LockState;
    break(expectedToken: string | null): boolean;
  };

  saveEdited(issue: Issue, baseline: string | null): SaveResult;
}

/**
 * Opens the project containing `cwd`.
 *
 * Throws NO_PROJECT immediately when there is no dz/config.yaml, so a consumer
 * fails at startup rather than on its first operation.
 *
 * Every method is synchronous. ditz2 is synchronous end to end, and an async
 * wrapper around synchronous file IO would only be theatre.
 */
export function openProject(cwd: string, opts: ProjectOptions): Project {
  const s: Session = {
    root: findProjectRoot(cwd),
    env: opts.env,
    lockTimeoutMs: opts.lockTimeoutMs,
  };

  return {
    root: s.root,

    list: (filter) => listIssues(s, filter),
    show: (prefix) => showIssue(s, prefix),
    grep: (pattern, filter) => grepIssues(s, pattern, filter),

    add: (fields) => addIssue(s, fields),
    set: (prefix, fields) => setFields(s, prefix, fields),
    comment: (prefix, text) => commentOn(s, prefix, text),
    close: (prefix, as, comment) => closeIssueBy(s, prefix, as, comment ?? null),

    components: {
      list: () => listComponents(s),
      add: (name) => addComponent(s, name),
      remove: (name, force) => removeComponent(s, name, force ?? false),
    },

    doctor: () => diagnoseProject(s),
    lock: {
      state: () => projectLockState(s),
      break: (expectedToken) => breakProjectLock(s, expectedToken),
    },

    saveEdited: (issue, baseline) => saveEdited(s, issue, baseline),
  };
}
```

- [ ] **Step 2: Add the `exports` map to `package.json`**

Insert after the `"license"` and `"author"` lines. `main` and `types` are for
older resolvers; `exports` is what actually restricts the surface.

```json
  "main": "./dist/api/index.js",
  "types": "./dist/api/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/api/index.d.ts",
      "default": "./dist/api/index.js"
    }
  },
```

- [ ] **Step 3: Write the failing test for the entry point and the closed surface**

Append to `src/api/api.test.ts`, adding `import { openProject } from './index.js';`:

```ts
describe('openProject', () => {
  it('exposes the whole surface bound to one project', () => {
    const p = openProject(tmp, { env: ENV });
    expect(p.root).toBe(tmp);

    const created = p.add({ title: 'via openProject', type: 'bug' });
    expect(p.list().issues.map((i) => i.title)).toEqual(['via openProject']);
    expect(p.show(created.id.slice(0, 13)).type).toBe('bug');
    expect(p.grep('openProject').issues).toHaveLength(1);
    expect(p.set(created.id.slice(0, 13), { title: 'renamed' }).title).toBe('renamed');
    expect(p.comment(created.id.slice(0, 13), 'hi').log.length).toBeGreaterThan(1);
    expect(p.close(created.id.slice(0, 13), 'fixed').status).toBe('closed');

    expect(p.components.list()).toEqual(['core']);
    expect(p.components.add('extra')).toEqual({ components: ['core', 'extra'], added: true });
    expect(p.components.remove('extra')).toEqual(['core']);

    expect(p.doctor()).toEqual([]);
    expect(p.lock.state().kind).toBe('none');
  });

  it('fails at open time when there is no project', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-empty-'));
    try {
      openProject(empty, { env: ENV });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('NO_PROJECT');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('passes lockTimeoutMs through to the operations', () => {
    fs.writeFileSync(path.join(tmp, 'dz', '.lock'), JSON.stringify({
      version: 1, token: 'held', pid: process.pid,
      hostname: os.hostname(),
      created: new Date().toISOString(), command: 'set',
    }));
    const p = openProject(tmp, { env: ENV, lockTimeoutMs: 0 });
    const started = Date.now();
    expect(() => p.add({ title: 'blocked', type: 'task' })).toThrow(DzError);
    expect(Date.now() - started).toBeLessThan(150);
  });
});
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
npm run build && npx vitest run src/api/api.test.ts
```

- [ ] **Step 5: Verify the private modules really are unreachable**

This is the only check that the `exports` map does its job. It must run against
a packed tarball, not the source tree.

```bash
npm pack --silent
mkdir -p /tmp/dz-export-check && cd /tmp/dz-export-check && npm init -y >/dev/null
npm install ./ditz2-0.1.0.tgz >/dev/null
node --input-type=module -e "
  const ok = await import('ditz2');
  console.log('public entry:', typeof ok.openProject === 'function' ? 'OK' : 'MISSING');
  for (const deep of ['ditz2/dist/store/lock.js', 'ditz2/dist/core/mutate.js']) {
    try { await import(deep); console.log('LEAKED:', deep); }
    catch { console.log('blocked:', deep); }
  }
"
```

Expected:

```
public entry: OK
blocked: ditz2/dist/store/lock.js
blocked: ditz2/dist/core/mutate.js
```

Then clean up: `cd - && rm -rf /tmp/dz-export-check ditz2-0.1.0.tgz`.

If a deep path imports successfully, the `exports` map is wrong and `store/`
is public API you did not mean to publish.

- [ ] **Step 6: Correct the two deviations in the design document**

In `docs/superpowers/specs/2026-08-25-ditz2-tui-design.md`, in the facade code
block, change:

```
  list(filter?: Filter): Issue[];
  grep(pattern: string, filter?: Filter): Issue[];
```

to

```
  list(filter?: Filter): LoadResult;      // { issues, failures }
  grep(pattern: string, filter?: Filter): LoadResult;
```

and change

```
  saveEdited(issue: Issue, baseline: string, opts?: { force?: boolean }): Issue;
```

to

```
  saveEdited(issue: Issue, baseline: string | null): SaveResult;
```

Then add this note directly beneath the code block:

```markdown
**Corrections made during implementation.** `list` and `grep` return
`{issues, failures}` rather than a bare array, because the CLI's
partial-failure path needs the failures and a UI wants to report unreadable
files rather than silently showing a short list.

`saveEdited` has no `force` flag. Forcing means writing over the version you
were shown, and that version is a baseline, so force is the same call with the
conflicting bytes. One compare-and-swap covers the save, the reload and the
force, and no parameter means "skip the check". A conflict is returned as
`{saved: false, current}` rather than thrown, because the caller needs those
bytes to offer a reload.
```

- [ ] **Step 7: Document the API in the README**

Add this section immediately before the `## License` section:

```markdown
## Using ditz2 from Node

`ditz2` publishes a small synchronous API alongside the `dz` command. It is the
same code the CLI runs, so anything you can do here you can do at the command
line and vice versa.

```js
import { openProject } from 'ditz2';

const dz = openProject(process.cwd(), { env: process.env });

for (const issue of dz.list({ status: 'open' }).issues) {
  console.log(issue.id, issue.title);
}

dz.set('01a031ea', { status: 'in-progress', assignee: 'me@example.com' });
```

Only this entry point is public. `dz/`'s internals — the store, the parser, the
renderers — are not importable and change without notice.

Every method is synchronous, and mutating ones take the project lock for the
duration of their read-modify-write. Pass `lockTimeoutMs: 0` if you would
rather handle contention yourself than have the call sleep: it then throws a
`LOCKED` error immediately instead of waiting. A long-running UI should always
do this, because a synchronous wait blocks its event loop.
```

- [ ] **Step 8: Typecheck, build, run everything one last time**

```bash
npm run typecheck && npm run build && npx vitest run
```

Expected: **330 pre-existing tests still pass with no test file edited**, plus
28 in `src/api/api.test.ts` — 358 total.

- [ ] **Step 9: Confirm the acceptance gate directly**

The whole plan is measured by one claim. Verify it rather than assume it:

```bash
git status tests/
```

Expected: **no output**. Not one file under `tests/` may be modified by this
plan. `src/**/*.test.ts` may gain `src/api/api.test.ts` and nothing else should
change there either:

```bash
git status 'glob:src/**/*.test.ts'
```

Expected: only `A src/api/api.test.ts`.

If either shows anything else, stop and work out what behaviour changed.

- [ ] **Step 10: Lint and commit**

```bash
the formatter and linter
git commit -m 'ditz2: publish a narrow API alongside the CLI

openProject binds a session to the operations the commands already call and is
the only path named in the exports map. store/, core/ and render/ stay private:
verified against a packed tarball that deep imports of dist/store/lock.js and
dist/core/mutate.js are blocked while `import {openProject} from "ditz2"` works.

env is required rather than defaulting to process.env, so no operation reads
global state behind the caller. lockTimeoutMs is passed through, which is how a
UI avoids a synchronous sleep that would block its event loop.

The design document is corrected in two places where implementation proved it
wrong: list and grep return {issues, failures}, and saveEdited has no force
flag.

Test Plan:
- npm run typecheck clean, the linter clean
- npx vitest run: 358 passing
- `git status tests/` is empty: the refactor did not modify a single existing
  test, which is the gate this plan set for itself
- packed-tarball check confirms the private modules are unreachable'
```

---

## Done when

- `src/api/` exists with `session.ts`, `filter.ts`, `read.ts`, `write.ts`,
  `index.ts` and `api.test.ts`.
- `src/cli/lock.ts` is gone (deleted in Task 4, its last importer being
  `src/cli/edit.ts`) and `src/cli/filters.ts` holds only commander wiring.
- Every command except `init`, `schema` and `help` is parsing plus one facade
  call plus one render.
- `package.json` has an `exports` map naming only the API entry.
- 358 tests pass, and `git status tests/` is empty.
