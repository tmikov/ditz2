# ditz2-ui, plan 2b: writing at all Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ditz2-ui` write. Comment on an issue with `c`, close one with
`x`, and handle the two things every write from a TUI has to handle — a
contended lock and a missing author identity — as rendered state rather than a
crash.

**Architecture:** One mutation path. Every write goes through a single helper
that calls the facade, and turns the two expected failures into state: `LOCKED`
becomes a `waitingFor` overlay with the holder, a retry and a cancel key;
`INVALID_FIELD` from author resolution becomes an error overlay that says what
to set. Success re-reads the snapshot rather than patching it, so the list can
never disagree with the disk. The two overlays added here — comment entry and
close — are the template the form screen in plan 2c will follow.

**Tech Stack:** TypeScript (NodeNext, strict), Ink 6.8.0, React 19.2.8,
`ink-testing-library` 4.0.0, vitest 2.1.9, npm workspaces.

## Global Constraints

Copied from `docs/superpowers/specs/2026-08-25-ditz2-tui-design.md`, the plan
2a document, and `CLAUDE.md`. Every task's requirements implicitly include this
section.

- **`lockTimeoutMs: 0`, always.** `ui/src/index.tsx` already sets it and must
  keep it. `acquireLock` otherwise retries with `Atomics.wait` for up to two
  seconds of *synchronous* blocking, during which Ink cannot repaint, cannot
  read a keystroke, and cannot service Ctrl-C — its signal handler is itself a
  JS callback and cannot preempt synchronous JS. **This plan is the first that
  can actually reach a lock**, so it is also the first that can test the
  setting. Plan 2a shipped it uncovered; that ends here.
- **Every write goes through the facade.** `ditz2-ui` imports `ditz2` by bare
  specifier only. No reaching into `core/`, `store/` or `render/`.
- **The snapshot is reloaded after a successful write**, with
  `SNAPSHOT_FILTER` (`{ all: true }`), not patched from the returned `Issue`.
  A patched list is a second source of truth, and this project has paid for
  that twice.
- **Selection is tracked by issue id, never by list index.**
- **A test that cannot fail is a defect.** Plan 2a produced seven of them and
  nine breakage steps that could not fail. After writing a test, break the code
  it covers and watch it fail; a breakage that refuses to fire is a finding,
  not a formality.
- **Never claim an invariant a comment cannot back.** Five comments in plan 2a
  described behaviour the code had stopped honouring, each created by a change
  that was itself correct.
- Toolchain: any Node >= 20 and the public npm registry.
- **`git add` new files BEFORE running any checks** — a checker that reads the
  changeset cannot see an untracked file.
- Commit messages: `ditz2-ui: <what changed>` for `ui/`, `ditz2:` elsewhere.
- New files: the 6-line MIT header, one trailing newline and no empty line
  after it (`tail -c 1 <f> | od -An -tx1` prints `0a`), unix line endings, and
  **no raw control bytes** — write escapes as `String.fromCharCode(27)`.
- Comment only non-obvious invariants. Do not restate what the code does.
- Formatter and linter clean before committing.
- **`npm run test:all` is the gate and its exit code is meaningful** only
  because it invokes `tsc` and `vitest` directly. npm 8.19.4 discards the exit
  status of workspace-member scripts. Do not "simplify" it back to
  `npm run test --workspace ditz2-ui`.
- Never use bash `grep`/`find`/`rg` — recursive traversal here times out.

## Decisions this plan inherits

- **`Tab` opens the form**, not `Enter` — `Enter` opens and closes the
  full-screen reader. The form itself is plan 2c; `Tab` is reserved here only
  so the footer and help can be written once. Nothing in this plan binds it.
- **`whoami()` returns `null` for both "no identity configured" and "identity
  configured but malformed"** (a `DZ_AUTHOR` containing a newline or a double
  space, which the log grammar uses as separators). That was ruled acceptable
  while nothing wrote. This plan writes, so Task 4 handles the failure at the
  point it actually occurs: inside the facade, on the write.
- **`loadAllIssues` costs 50–125 ms over 200 issues, linearly.** Reloading
  after every write puts that on the critical path of each mutation. Accepted
  for now; the sqlite cache issue in the tracker is the fix, and this plan adds
  the first workload that will make it matter.

## What already exists

Read these before starting.

| | |
| --- | --- |
| The approved design | `docs/superpowers/specs/2026-08-25-ditz2-tui-design.md` |
| What shipped, and what it cost | `docs/superpowers/plans/2026-08-26-ditz2-ui-browse.md` |
| The `$EDITOR` spike, for plan 2d | `.superpowers/sdd/2026-08-26-ditz2-ui-browse/spike-editor-suspend.md` |
| Current state | `HANDOFF.md` |

The facade offers `comment(prefix, text): Issue` and
`close(prefix, as, comment?): Issue`. Each takes the project lock internally
and throws `DzError` with a typed code — `LOCKED`, `NOT_FOUND`,
`INVALID_FIELD`, `AMBIGUOUS_PREFIX`, `CONCURRENT_MODIFICATION`.

`UiState` today carries `snapshot`, `failures`, `query`, `filter`, `pattern`,
`queryError`, `selectedId`, `screen: 'list' | 'issue'`, `overlay: null |
{kind:'filter'} | {kind:'help'}`, `helpOffset`, `issueOffset`, `notice`.

## File structure

**Modified in `ui/`:**

| File | Responsibility |
| --- | --- |
| `ui/src/state.ts` | `waitingFor`, `pending`, the mutation actions, widened `overlay` |
| `ui/src/app.tsx` | the mutation helper, `c` and `x` bindings, overlay routing |
| `ui/src/components/Chrome.tsx` | footer strings for the new overlays |
| `ui/src/components/HelpOverlay.tsx` | the new bindings |

**Created in `ui/`:**

| File | Responsibility |
| --- | --- |
| `ui/src/mutate.ts` | the single write path: call, classify the failure, retry |
| `ui/src/components/TextEntry.tsx` | one-line-at-a-time entry, shared by comment and any later prompt |
| `ui/src/components/CommentOverlay.tsx` | `c` |
| `ui/src/components/CloseOverlay.tsx` | `x`, with the resolution picker |
| `ui/src/components/WaitingOverlay.tsx` | holder, elapsed time, retry, cancel |

Tests alongside, one file per task.

---

### Task 1: The mutation lifecycle, in the reducer

State first, pure, no React. Every write has the same shape: it is attempted,
it either succeeds, is refused for the lock, or fails for a reason the operator
has to read. Modelling that once here is what keeps the two overlays in this
plan and the four screens in 2c from each inventing their own.

**Files:**
- Modify: `ui/src/state.ts`
- Test: `ui/tests/state.test.ts`

**Interfaces:**
- Consumes: `Issue`, `LoadFailure`, `Filter`, `LockInfo` from `'ditz2'`.
- Produces, added to `UiState`:
  - `pending: null | { op: string }` — a write is in flight.
  - `waitingFor: null | { op: string; holder: LockInfo | null; since: number; attempts: number }`
  - `overlay` widens to include `{ kind: 'comment' }`, `{ kind: 'close' }`,
    `{ kind: 'waiting' }` and `{ kind: 'error'; message: string }`.
- New actions: `openComment`, `openClose`, `closeOverlay`, `mutationStarted`,
  `mutationLocked`, `mutationFailed`, `mutationSucceeded`, `retryTick`.

- [ ] **Step 1: Write the failing tests**

Append to `ui/tests/state.test.ts`:

```ts
const HOLDER = {
  version: 1, token: 't', pid: 4821, hostname: 'box',
  created: '2026-08-30 10:00', command: 'comment',
} as const;

describe('the mutation lifecycle', () => {
  it('starts idle', () => {
    const s = start();
    expect(s.pending).toBeNull();
    expect(s.waitingFor).toBeNull();
  });

  it('marks a write in flight and clears it on success', () => {
    let s = run(start(), { type: 'openComment' });
    s = run(s, { type: 'mutationStarted', op: 'comment' });
    expect(s.pending).toEqual({ op: 'comment' });
    s = run(s, { type: 'mutationSucceeded', issues: three(), failures: [] });
    expect(s.pending).toBeNull();
    // The overlay closes on success: leaving it open invites a second write
    // the operator did not intend.
    expect(s.overlay).toBeNull();
  });

  it('turns a refused lock into waitingFor, not an error', () => {
    // LOCKED is the ordinary case for this tool — agents write alongside the
    // operator — so it is a state with a retry, not a dialog with an OK button.
    let s = run(start(), { type: 'mutationStarted', op: 'comment' });
    s = run(s, { type: 'mutationLocked', op: 'comment', holder: HOLDER, at: 1000 });
    expect(s.overlay).toEqual({ kind: 'waiting' });
    expect(s.waitingFor).toMatchObject({ op: 'comment', holder: HOLDER, attempts: 1 });
    expect(s.pending).toBeNull();
  });

  it('counts attempts across retries and keeps the first timestamp', () => {
    // `since` is what the elapsed display is computed from, so a retry must
    // not reset it — otherwise the timer restarts at zero every second and
    // never tells the operator how long they have actually been waiting.
    let s = run(start(), { type: 'mutationLocked', op: 'comment', holder: HOLDER, at: 1000 });
    s = run(s, { type: 'mutationLocked', op: 'comment', holder: HOLDER, at: 4000 });
    expect(s.waitingFor).toMatchObject({ since: 1000, attempts: 2 });
  });

  it('reports a holder it could not read', () => {
    // breakLock and lockState both admit a lock they cannot parse. A UI that
    // renders `undefined (pid undefined)` is worse than one that says so.
    const s = run(start(), { type: 'mutationLocked', op: 'comment', holder: null, at: 1000 });
    expect(s.waitingFor?.holder).toBeNull();
  });

  it('turns any other failure into an error overlay carrying its message', () => {
    const s = run(start(), {
      type: 'mutationFailed', op: 'comment',
      message: 'no author identity: set DZ_AUTHOR',
    });
    expect(s.overlay).toEqual({ kind: 'error', message: 'no author identity: set DZ_AUTHOR' });
    expect(s.pending).toBeNull();
    expect(s.waitingFor).toBeNull();
  });

  it('replaces the snapshot on success rather than patching it', () => {
    const s = run(start(),
      { type: 'mutationStarted', op: 'comment' },
      { type: 'mutationSucceeded', issues: three().slice(0, 2), failures: [] });
    expect(visibleIssues(s)).toHaveLength(2);
  });

  it('keeps the selection across a write, by id', () => {
    const s = run(start(), { type: 'move', delta: 2 },
      { type: 'mutationSucceeded', issues: [...three()].reverse(), failures: [] });
    expect(selectedIssue(s)?.title).toBe('gamma');
  });

  it('clears a stale error when the next write starts', () => {
    // An error line that outlives the thing it described is a UI lying about
    // the state of the project.
    const s = run(start(),
      { type: 'mutationFailed', op: 'comment', message: 'boom' },
      { type: 'mutationStarted', op: 'close' });
    expect(s.overlay).toBeNull();
    expect(s.pending).toEqual({ op: 'close' });
  });

  it('closes the waiting overlay when the operator gives up', () => {
    const s = run(start(),
      { type: 'mutationLocked', op: 'comment', holder: HOLDER, at: 1000 },
      { type: 'closeOverlay' });
    expect(s.overlay).toBeNull();
    expect(s.waitingFor).toBeNull();
  });

  it('opens comment and close only with something selected', () => {
    const empty = initialState([], []);
    expect(run(empty, { type: 'openComment' }).overlay).toBeNull();
    expect(run(empty, { type: 'openClose' }).overlay).toBeNull();
    expect(run(start(), { type: 'openComment' }).overlay).toEqual({ kind: 'comment' });
    expect(run(start(), { type: 'openClose' }).overlay).toEqual({ kind: 'close' });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run --root ui tests/state.test.ts
```

Expected: FAIL — none of the new actions exist.

- [ ] **Step 3: Widen `UiState`**

```ts
  /** A write is in flight. Set between the call and its outcome. */
  pending: null | { op: string };
  /**
   * A write refused because another process holds the lock. `since` is the
   * first refusal, not the latest, so the elapsed display keeps counting
   * across retries instead of restarting.
   */
  waitingFor: null | {
    op: string;
    /** null when the lock file exists but could not be parsed. */
    holder: LockInfo | null;
    since: number;
    attempts: number;
  };
```

and widen `overlay`:

```ts
  overlay:
    | null
    | { kind: 'filter' }
    | { kind: 'help' }
    | { kind: 'comment' }
    | { kind: 'close' }
    | { kind: 'waiting' }
    | { kind: 'error'; message: string };
```

`initialState` sets both new fields to `null`.

- [ ] **Step 4: The actions**

```ts
  | { type: 'openComment' }
  | { type: 'openClose' }
  | { type: 'closeOverlay' }
  | { type: 'mutationStarted'; op: string }
  | { type: 'mutationLocked'; op: string; holder: LockInfo | null; at: number }
  | { type: 'mutationFailed'; op: string; message: string }
  | { type: 'mutationSucceeded'; issues: Issue[]; failures: LoadFailure[] }
  | { type: 'retryTick'; at: number }
```

and the reducer cases:

```ts
    case 'openComment':
    case 'openClose': {
      // Nothing selected means nothing to write to. Silently doing nothing is
      // right here: an error for pressing a key on an empty list is noise.
      if (selectedIssue(state) === null) return state;
      return {
        ...state,
        overlay: { kind: action.type === 'openComment' ? 'comment' : 'close' },
      };
    }

    case 'closeOverlay':
      return { ...state, overlay: null, waitingFor: null };

    case 'mutationStarted':
      // Clears any previous error: the operator has moved on, and a message
      // about the last attempt would now be describing nothing.
      return { ...state, pending: { op: action.op }, overlay: null, waitingFor: null };

    case 'mutationLocked':
      return {
        ...state,
        pending: null,
        overlay: { kind: 'waiting' },
        waitingFor: {
          op: action.op,
          holder: action.holder,
          since: state.waitingFor?.since ?? action.at,
          attempts: (state.waitingFor?.attempts ?? 0) + 1,
        },
      };

    case 'mutationFailed':
      return {
        ...state,
        pending: null,
        waitingFor: null,
        overlay: { kind: 'error', message: action.message },
      };

    case 'mutationSucceeded':
      return reselect({
        ...state,
        snapshot: action.issues,
        failures: action.failures,
        pending: null,
        waitingFor: null,
        overlay: null,
        notice: null,
      }, true);

    case 'retryTick':
      return state.waitingFor === null ? state : { ...state };
```

`mutationSucceeded` goes through `reselect` for the same reason `snapshot`
does: the write may have filtered the issue out from under the cursor.

- [ ] **Step 5: Run and watch them pass**

```bash
npx vitest run --root ui tests/state.test.ts && npx tsc -p ui/tsconfig.test.json
```

- [ ] **Step 6: Prove the tests can fail**

1. Make `mutationLocked` reset `since` to `action.at` every time — the
   attempts-and-timestamp test must fail on `since`, and only on `since`.
2. Make `mutationStarted` preserve `overlay` — the stale-error test must fail.
3. Make `mutationSucceeded` skip `reselect` — the keeps-the-selection test must
   fail.
4. Drop the `selectedIssue(state) === null` guard — the empty-list test must
   fail for both `openComment` and `openClose`.
5. Route `LOCKED` to `mutationFailed` instead — the "not an error" test must
   fail. This is the one that matters: an error dialog for a contended lock is
   the wrong model for a tool whose normal case is an agent writing alongside
   you.

- [ ] **Step 7: Lint and commit**

```bash
git add ui/src/state.ts ui/tests/state.test.ts
git commit ui -m "ditz2-ui: model the mutation lifecycle in the reducer"
```

---

### Task 2: One write path

Every mutation in this plan and the next three screens in plan 2c call one
function. It runs the facade call, classifies the failure, and reloads the
snapshot on success. Written once so the four call sites cannot each decide
what `LOCKED` means.

**Files:**
- Create: `ui/src/mutate.ts`
- Test: `ui/tests/mutate.test.ts`

**Interfaces:**
- Consumes: `Project`, `DzError`, `LockInfo` from `'ditz2'`; `UiAction` and
  `SNAPSHOT_FILTER` from `./state.js`.
- Produces:
  `runMutation(project: Project, dispatch: (a: UiAction) => void, op: string, call: () => void, now: () => number): void`

- [ ] **Step 1: Write the failing tests**

Create `ui/tests/mutate.test.ts`:

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { DzError } from 'ditz2';
import type { Project, UiAction } from '../src/mutate.js';
import { runMutation } from '../src/mutate.js';
import { SNAPSHOT_FILTER } from '../src/state.js';
import { three } from './fixtures.js';

function harness(over: Partial<Project> = {}) {
  const seen: UiAction[] = [];
  const listed: unknown[] = [];
  const project = {
    list: (f?: unknown) => { listed.push(f); return { issues: three(), failures: [] }; },
    ...over,
  } as unknown as Project;
  return { project, seen, listed, dispatch: (a: UiAction) => { seen.push(a); } };
}
const types = (seen: UiAction[]): string[] => seen.map((a) => a.type);

describe('runMutation', () => {
  it('announces the start, then the success, and reloads', () => {
    const h = harness();
    runMutation(h.project, h.dispatch, 'comment', () => {}, () => 0);
    expect(types(h.seen)).toEqual(['mutationStarted', 'mutationSucceeded']);
  });

  it('reloads with SNAPSHOT_FILTER, or all:true can never reveal anything', () => {
    // Same trap as the initial load: applyFilter hides closed issues unless
    // asked, and `x` closes issues. Reloading with the default filter makes
    // the issue you just closed vanish with no way to see it again.
    const h = harness();
    runMutation(h.project, h.dispatch, 'close', () => {}, () => 0);
    expect(h.listed).toEqual([SNAPSHOT_FILTER]);
  });

  it('routes LOCKED to the waiting state, carrying the holder', () => {
    const holder = {
      version: 1, token: 't', pid: 4821, hostname: 'box',
      created: '2026-08-30 10:00', command: 'comment',
    };
    const h = harness({
      lock: { state: () => ({ kind: 'active', info: holder }), break: () => false },
    } as Partial<Project>);
    runMutation(h.project, h.dispatch, 'comment', () => {
      throw new DzError('LOCKED', 'the project is locked');
    }, () => 1000);
    expect(types(h.seen)).toEqual(['mutationStarted', 'mutationLocked']);
    expect(h.seen[1]).toMatchObject({ holder, at: 1000 });
  });

  it('reports a null holder when the lock cannot be read', () => {
    const h = harness({
      lock: { state: () => ({ kind: 'malformed', why: 'bad json' }), break: () => false },
    } as Partial<Project>);
    runMutation(h.project, h.dispatch, 'comment', () => {
      throw new DzError('LOCKED', 'locked');
    }, () => 0);
    expect(h.seen[1]).toMatchObject({ holder: null });
  });

  it('does not let a failing lock.state() mask the LOCKED it is describing', () => {
    // The lock can vanish between the refusal and the question. That must
    // still be a wait, not an unrelated error about reading the lock.
    const h = harness({
      lock: { state: () => { throw new Error('gone'); }, break: () => false },
    } as Partial<Project>);
    runMutation(h.project, h.dispatch, 'comment', () => {
      throw new DzError('LOCKED', 'locked');
    }, () => 0);
    expect(types(h.seen)).toEqual(['mutationStarted', 'mutationLocked']);
  });

  it('turns any other DzError into a failure carrying its message', () => {
    const h = harness();
    runMutation(h.project, h.dispatch, 'comment', () => {
      throw new DzError('INVALID_FIELD', 'no author identity: set DZ_AUTHOR');
    }, () => 0);
    expect(types(h.seen)).toEqual(['mutationStarted', 'mutationFailed']);
    expect(h.seen[1]).toMatchObject({ message: 'no author identity: set DZ_AUTHOR' });
  });

  it('does not swallow a non-DzError', () => {
    // A TypeError here is a bug in this package, not something the operator
    // can act on. Reporting it as a user-facing failure would bury it.
    const h = harness();
    expect(() => runMutation(h.project, h.dispatch, 'comment', () => {
      throw new TypeError('undefined is not a function');
    }, () => 0)).toThrow(TypeError);
  });

  it('does not reload after a failure', () => {
    const h = harness();
    runMutation(h.project, h.dispatch, 'comment', () => {
      throw new DzError('NOT_FOUND', 'no such issue');
    }, () => 0);
    expect(h.listed).toEqual([]);
  });

  it('reports a failure to reload rather than claiming the write failed', () => {
    // The write succeeded. Saying otherwise would send the operator to redo a
    // thing that already happened.
    const h = harness({ list: () => { throw new DzError('PARSE_ERROR', 'unreadable'); } });
    runMutation(h.project, h.dispatch, 'comment', () => {}, () => 0);
    expect(types(h.seen)).toEqual(['mutationStarted', 'mutationFailed']);
    expect((h.seen[1] as { message: string }).message).toContain('written');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL — `../src/mutate.js` does not exist.

- [ ] **Step 3: Write `ui/src/mutate.ts`**

```ts
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DzError } from 'ditz2';
import type { LockInfo, Project } from 'ditz2';
import { SNAPSHOT_FILTER } from './state.js';
import type { UiAction } from './state.js';

export type { Project } from 'ditz2';
export type { UiAction } from './state.js';

/** Who holds the lock, or null when it cannot be read. */
function holderOf(project: Project): LockInfo | null {
  try {
    const state = project.lock.state();
    return state.kind === 'active' || state.kind === 'abandoned' ? state.info : null;
  } catch {
    // The lock can be released between the refusal and this question. Losing
    // the holder's name is a worse frame, not a different outcome — the write
    // was still refused, and that is what the operator needs to see.
    return null;
  }
}

/**
 * The one path every write takes.
 *
 * `LOCKED` is a state, not an error: agents are expected to be working
 * alongside the operator, so contention is ordinary and gets a holder, a timer
 * and a retry. Everything else the facade raises is a message the operator has
 * to read. Anything that is not a DzError is a bug in this package and is
 * rethrown rather than dressed up as a user-facing failure.
 *
 * `now` is injected so the elapsed display is testable without a clock.
 */
export function runMutation(
  project: Project,
  dispatch: (action: UiAction) => void,
  op: string,
  call: () => void,
  now: () => number,
): void {
  dispatch({ type: 'mutationStarted', op });
  try {
    call();
  } catch (err) {
    if (!(err instanceof DzError)) throw err;
    if (err.code === 'LOCKED') {
      dispatch({ type: 'mutationLocked', op, holder: holderOf(project), at: now() });
      return;
    }
    dispatch({ type: 'mutationFailed', op, message: err.message });
    return;
  }

  // Reloaded rather than patched from the returned Issue: one source of truth.
  // SNAPSHOT_FILTER, because `x` closes issues and the default filter hides
  // closed ones — reloading without it makes what you just did disappear.
  try {
    const { issues, failures } = project.list(SNAPSHOT_FILTER);
    dispatch({ type: 'mutationSucceeded', issues, failures });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    dispatch({
      type: 'mutationFailed',
      op,
      message: `the ${op} was written, but the backlog could not be reloaded: ${detail}`,
    });
  }
}
```

- [ ] **Step 4: Run and watch it pass**

- [ ] **Step 5: Prove the checks can fail**

1. Reload with `project.list()` instead of `SNAPSHOT_FILTER` — the
   `SNAPSHOT_FILTER` test must fail. This is the failure that would make a
   closed issue vanish irretrievably, and it looks completely correct.
2. Catch `LOCKED` with the others — the routing test must fail.
3. Remove the `instanceof DzError` guard — the non-DzError test must fail.
4. Reload inside the `try` before the catch — "does not reload after a
   failure" must fail.
5. Make the reload failure dispatch `mutationSucceeded` — the "was written"
   test must fail. Report whether it also breaks anything else; if not, that
   tells you the message is the only thing distinguishing the two outcomes.

- [ ] **Step 6: Lint and commit**

```bash
git add ui/src/mutate.ts ui/tests/mutate.test.ts
git commit ui -m "ditz2-ui: route every write through one path"
```

---

### Task 3: Comment — the first write

`c` opens a text entry over the list, `Ctrl-S` writes it, `Esc` abandons it.
The first mutation the UI performs, and the template for the rest.

**Files:**
- Create: `ui/src/components/TextEntry.tsx`, `ui/src/components/CommentOverlay.tsx`
- Modify: `ui/src/app.tsx`, `ui/src/components/Chrome.tsx`
- Test: `ui/tests/comment.test.tsx`

**Interfaces:**
- `<TextEntry lines={string[]} width={number} rows={number} />` — renders text
  with a block cursor at the end. Multi-line: a comment is prose.
- `<CommentOverlay issue={Issue} lines={string[]} rows={number} width={number} />`
- App gains `c` on the list screen and a `comment` overlay branch.

**Why the entry is hand-rolled rather than `ink-text-input`:** that component
is single-line, and a comment is not. This one appends characters, handles
backspace across a line boundary, and takes `Enter` as a newline — which is
why saving is `Ctrl-S` and not `Enter`. It owns no cursor movement: this is a
scratch pad for a sentence or two, and `$EDITOR` is one plan away for anything
longer.

- [ ] **Step 1: Write the failing tests**

Create `ui/tests/comment.test.tsx` with cases:

```ts
  it('opens on c and shows the issue it will comment on', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'c');
    expect(lastFrame()).toContain('alpha');
    expect(lines(lastFrame()).at(-1)).toContain('^S save');
  });

  it('does nothing on c when the list is empty', async () => {
    const { lastFrame, stdin } = mount(undefined, { issues: [] });
    await press(stdin, 'c');
    expect(lastFrame()).not.toContain('^S save');
  });

  it('takes typed text, including newlines, and shows it', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'c', 'i', 't', KEY.enter, 'i', 's');
    // Enter is a newline here, not save — otherwise a two-line comment is
    // impossible and the first line commits by accident.
    const shown = lines(lastFrame()).join('\n');
    expect(shown).toContain('it');
    expect(shown).toContain('is');
  });

  it('deletes across the line boundary on backspace', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'c', 'a', KEY.enter, KEY.backspace, 'b');
    expect(lines(lastFrame()).join('\n')).toContain('ab');
  });

  it('writes on Ctrl-S and passes exactly what was typed', async () => {
    const calls: [string, string][] = [];
    const { stdin } = mount({ comment: (p: string, t: string) => { calls.push([p, t]); return three()[0]!; } });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toBe('hi');
  });

  it('refuses to write an empty comment', async () => {
    // An empty log entry is noise that cannot be deleted afterwards.
    const calls: unknown[] = [];
    const { lastFrame, stdin } = mount({ comment: () => { calls.push(1); return three()[0]!; } });
    await press(stdin, 'c', KEY.ctrlS);
    expect(calls).toHaveLength(0);
    expect(lastFrame()).toContain('^S save');
  });

  it('abandons on Esc without writing', async () => {
    const calls: unknown[] = [];
    const { lastFrame, stdin } = mount({ comment: () => { calls.push(1); return three()[0]!; } });
    await press(stdin, 'c', 'h', 'i', KEY.escape);
    expect(calls).toHaveLength(0);
    expect(lastFrame()).not.toContain('^S save');
  });

  it('does not quit on q while the entry is open', async () => {
    const onExit = vi.fn();
    const { stdin } = mount(undefined, undefined, onExit);
    await press(stdin, 'c', 'q');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('closes and reloads on success', async () => {
    let listCalls = 0;
    const { lastFrame, stdin } = mount({
      comment: () => three()[0]!,
      list: () => { listCalls += 1; return { issues: three(), failures: [] }; },
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(listCalls).toBe(1);
    expect(lastFrame()).not.toContain('^S save');
  });

  it('shows what the facade refused, and keeps the text', async () => {
    // The operator has typed something. Throwing it away on a failure they
    // can fix — an unset DZ_AUTHOR — would be the worst moment to lose it.
    const { lastFrame, stdin } = mount({
      comment: () => { throw new DzError('INVALID_FIELD', 'no author identity: set DZ_AUTHOR'); },
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(lastFrame()).toContain('no author identity');
  });
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: `TextEntry.tsx`**

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import { truncate } from '../format.js';

/** Appends one printable character to the last line. */
export function append(lines: string[], input: string): string[] {
  const out = [...lines];
  out[out.length - 1] = (out[out.length - 1] ?? '') + input;
  return out;
}

/**
 * Deletes one character, joining lines when the current one is empty.
 *
 * Without the join, backspace stalls at the start of a line and the operator
 * cannot undo a newline they just typed.
 */
export function backspace(lines: string[]): string[] {
  const out = [...lines];
  const last = out[out.length - 1] ?? '';
  if (last !== '') {
    out[out.length - 1] = last.slice(0, -1);
    return out;
  }
  if (out.length === 1) return out;
  out.pop();
  return out;
}

export function TextEntry(
  { lines, rows, width }: { lines: string[]; rows: number; width: number },
): React.ReactElement {
  // The cursor is on the last line, so keep the END of the text when it
  // overflows: scrolling the cursor off the screen is the one thing a text
  // entry must never do.
  const shown = lines.slice(Math.max(lines.length - rows, 0));
  return (
    <Box flexDirection="column">
      {shown.map((line, n) => {
        const isLast = n === shown.length - 1;
        const text = isLast ? `${line}█` : line;
        return (
          // Positional slots, not identified rows.
          // eslint-disable-next-line react/no-array-index-key
          <Text key={n} wrap="truncate">{truncate(text, width) || ' '}</Text>
        );
      })}
    </Box>
  );
}
```

`append` and `backspace` are exported and pure so the key handler in `app.tsx`
has no editing logic of its own — and so both are testable without rendering.

- [ ] **Step 4: `CommentOverlay.tsx`**

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import { shortId } from 'ditz2';
import type { Issue } from 'ditz2';
import { truncate } from '../format.js';
import { TextEntry } from './TextEntry.js';

export function CommentOverlay(
  { issue, lines, rows, width }:
  { issue: Issue; lines: string[]; rows: number; width: number },
): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">
        {truncate(`comment on ${shortId(issue.id)}  ${issue.title}`, width)}
      </Text>
      <Text> </Text>
      <TextEntry lines={lines} rows={Math.max(rows - 2, 1)} width={width} />
    </Box>
  );
}
```

- [ ] **Step 5: Wire `c` into `app.tsx`**

The overlay owns the keyboard, like help and the issue screen. Its branch goes
with theirs, before the shared navigation block — arrows must not move the
list selection behind an open entry.

```tsx
    if (state.overlay?.kind === 'comment') {
      if (key.escape) { dispatch({ type: 'closeOverlay' }); return; }
      if (key.ctrl && input === 's') {
        const issue = selectedIssue(state);
        const text = draft.join('\n').trim();
        // Empty is not a comment. Silently ignoring the keypress is right:
        // there is nothing to report and nothing was lost.
        if (issue === null || text === '') return;
        runMutation(project, dispatch, 'comment', () => { project.comment(issue.id, text); }, now);
        return;
      }
      if (key.return) { setDraft([...draft, '']); return; }
      if (key.backspace || key.delete) { setDraft(backspace(draft)); return; }
      if (input !== '' && !key.ctrl && !key.meta) { setDraft(append(draft, input)); return; }
      return;
    }
```

and on the list screen, `if (input === 'c') { dispatch({ type: 'openComment' }); return; }`.

The draft is component state rather than reducer state: it is scratch that
never outlives the overlay, and putting it in `UiState` would mean every
snapshot action had to decide what to do with a half-typed sentence. Clear it
when the overlay opens, not when it closes, so a failed write keeps the text.

- [ ] **Step 6: Footer**

In `app.tsx`, alongside `LIST_KEYS` and `ISSUE_KEYS`:

```tsx
const COMMENT_KEYS = 'type your comment  enter newline  ^S save  esc cancel';
```

and select it in the render:

```tsx
      {state.overlay?.kind === 'comment'
        ? <Footer keys={COMMENT_KEYS} width={width} />
        : /* existing footer selection */ null}
```

Only bindings that work. The list footer's `/ filter`, `r refresh` and
`q quit` do nothing while the entry is open, and this project has a test in
each direction — one refusing a footer that advertises a dead key, one
refusing a working key the footer omits. `enter newline` is named because
`Enter` not saving is the surprising part.

- [ ] **Step 7: Prove the checks can fail**

1. Save on `Enter` instead of `Ctrl-S` — "takes typed text, including
   newlines" must fail.
2. Drop the empty-text guard — "refuses to write an empty comment" must fail.
3. Clear the draft on failure — "keeps the text" must fail.
4. Move the overlay branch below the shared navigation block — the `q` test
   must fail, and check whether arrows also start moving the list behind it.
5. Reload with the default filter — no test here will fail, because nothing in
   this file closes an issue. Say so: Task 2's test is the only thing covering
   it, and that is the point of having put it there.

- [ ] **Step 8: Lint and commit**

---

### Task 4: Waiting for the lock

The state exists and the write path sets it; this renders it. Who holds the
lock, how long it has been held, `r` to retry, `Esc` to give up.

**Files:**
- Create: `ui/src/components/WaitingOverlay.tsx`
- Modify: `ui/src/app.tsx`, `ui/src/components/Chrome.tsx`
- Test: `ui/tests/waiting.test.tsx`, `ui/tests/e2e.test.ts`

**This is the task that finally covers `lockTimeoutMs: 0`.** Plan 2a set it and
could not test it, because nothing wrote. The end-to-end test below is the
first thing in this repository that proves a contended write from the UI
returns immediately instead of freezing for two seconds.

- [ ] **Step 1: The unit tests**

```ts
  it('names the holder and its pid', async () => { /* … 'comment', 4821 … */ });

  it('says so when the holder cannot be read', async () => {
    // Rendering "held by undefined (pid undefined)" is worse than admitting it.
    // holder: null must produce prose, not blanks.
  });

  it('counts the wait from the first refusal, not the latest retry', async () => {
    // Two refusals 3s apart must show ~3s, not ~0s. A timer that restarts on
    // every retry tells the operator nothing about how long they have waited.
  });

  it('retries on r, calling the same operation again', async () => {
    let attempts = 0;
    const { stdin } = mount({
      comment: () => { attempts += 1; throw new DzError('LOCKED', 'locked'); },
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(attempts).toBe(1);
    await press(stdin, 'r');
    expect(attempts).toBe(2);
  });

  it('gives up on Esc, leaving the list usable', async () => {
    const { lastFrame, stdin } = mount({
      comment: () => { throw new DzError('LOCKED', 'locked'); },
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS, KEY.escape);
    expect(lastFrame()).not.toContain('waiting for the lock');
    // Back on the list: j moves again rather than typing.
    await press(stdin, 'j');
    expect(lines(lastFrame()).find((l) => l.startsWith('>'))).toContain('beta');
  });

  it('closes itself when a retry succeeds', async () => {
    let attempts = 0;
    const { lastFrame, stdin } = mount({
      comment: () => {
        attempts += 1;
        if (attempts === 1) throw new DzError('LOCKED', 'locked');
        return three()[0]!;
      },
    });
    await press(stdin, 'c', 'h', 'i', KEY.ctrlS);
    expect(lastFrame()).toContain('waiting for the lock');
    await press(stdin, 'r');
    expect(lastFrame()).not.toContain('waiting for the lock');
    // And the comment entry is gone too — the write it belonged to happened.
    expect(lastFrame()).not.toContain('^S save');
  });
```

- [ ] **Step 2: The end-to-end test, in a real pty**

Append to `ui/tests/e2e.test.ts`:

```ts
  it('refuses a contended write immediately instead of freezing', async () => {
    // The whole reason runUi passes lockTimeoutMs: 0. With the default 2000ms
    // the facade blocks synchronously inside acquireLock, and Ink cannot
    // repaint, read a key, or service Ctrl-C for the duration — so the symptom
    // is not a slow UI, it is a dead one. Measured, not asserted structurally:
    // hold the lock from outside, press `c`, and require the waiting overlay
    // to appear well inside the two seconds a default timeout would take.
    await project(async (dir) => {
      holdLock(dir);                       // writes dz/.lock with a live pid
      const started = Date.now();
      const r = await pty([process.execPath, DZUI], dir, 'c' + 'x' + CTRL_S);
      expect(r.text).toContain('waiting for the lock');
      expect(Date.now() - started).toBeLessThan(SECONDS_2);
    });
  });
```

`holdLock` writes a lock file naming a pid that exists — use `process.pid`,
which is alive by definition. Remove it in a `finally`.

- [ ] **Step 3: `WaitingOverlay.tsx`**

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import type { LockInfo } from 'ditz2';
import { truncate } from '../format.js';

/**
 * Who holds the lock, in prose.
 *
 * Never interpolates a field that might be absent: a lock file this build
 * cannot parse yields `holder: null`, and "held by undefined (pid undefined)"
 * is worse than admitting the file is unreadable.
 */
export function holderLine(holder: LockInfo | null): string {
  if (holder === null) return 'held by a process this lock file does not describe';
  return `held by ${holder.command} (pid ${holder.pid}) on ${holder.hostname}`;
}

/** Whole seconds, floored, so the display never reads "0.4s". */
export function elapsedLine(since: number, now: number): string {
  const seconds = Math.max(Math.floor((now - since) / 1000), 0);
  return `waiting ${seconds}s`;
}

export function WaitingOverlay(
  { op, holder, since, attempts, now, width }:
  {
    op: string; holder: LockInfo | null; since: number;
    attempts: number; now: number; width: number;
  },
): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">{truncate(`waiting for the lock to run ${op}`, width)}</Text>
      <Text wrap="truncate">{truncate(`  ${holderLine(holder)}`, width)}</Text>
      <Text dimColor wrap="truncate">
        {truncate(`  ${elapsedLine(since, now)}, ${attempts} attempt${attempts === 1 ? '' : 's'}`, width)}
      </Text>
    </Box>
  );
}
```

`holderLine` and `elapsedLine` are exported and pure so both can be tested
without a clock or a render.

- [ ] **Step 4: Retry**

`r` re-runs the same mutation, so the overlay has to hold the call itself —
the op name is not enough to repeat it. Keep the thunk in component state
beside the draft: same lifetime, same reason it is not in `UiState`.

```tsx
  const [retry, setRetry] = React.useState<(() => void) | null>(null);

  /** Runs a write and remembers how to run it again. */
  const write = React.useCallback((op: string, call: () => void) => {
    // Stored as a thunk-returning-thunk: useState calls a bare function
    // argument instead of storing it, which would run the mutation on the
    // spot and lose the retry.
    setRetry(() => () => { runMutation(project, dispatch, op, call, Date.now); });
    runMutation(project, dispatch, op, call, Date.now);
  }, [project]);
```

and in the waiting branch of `useInput`:

```tsx
    if (state.overlay?.kind === 'waiting') {
      if (input === 'r') { retry?.(); return; }
      if (key.escape || input === 'q') { dispatch({ type: 'closeOverlay' }); return; }
      return;
    }
```

The elapsed display needs the clock to advance while nothing is typed, so the
overlay also mounts a one-second interval dispatching `retryTick`, cleared when
it closes:

```tsx
  React.useEffect(() => {
    if (state.overlay?.kind !== 'waiting') return undefined;
    const id = setInterval(() => { dispatch({ type: 'retryTick', at: Date.now() }); }, 1000);
    return () => { clearInterval(id); };
  }, [state.overlay?.kind]);
```

Without the cleanup the interval outlives the overlay and keeps waking a
component that has nothing to redraw.

- [ ] **Step 5: Prove the checks can fail**

1. Reset `since` on retry — the elapsed test must fail.
2. Render `${holder.command} (pid ${holder.pid})` unguarded with `holder: null`
   — the unreadable-holder test must fail on the literal string `undefined`.
3. **Set `lockTimeoutMs` back to `2000` in `ui/src/index.tsx`** — the pty test
   must fail on the elapsed bound, not on the assertion about the text. Report
   the measured time in both states. This is the check plan 2a could not write.

- [ ] **Step 6: Lint and commit**

---

### Task 5: Close, with its resolution picker

`x` closes the selected issue. A resolution is required — `fixed`, `wontfix`
or `duplicate` — and a comment is optional. This is the first overlay with two
fields, and the picker it introduces is the one plan 2c reuses for type,
status and component.

**Files:**
- Create: `ui/src/components/CloseOverlay.tsx`, `ui/src/components/Picker.tsx`
- Modify: `ui/src/app.tsx`, `ui/src/components/Chrome.tsx`, `ui/src/components/HelpOverlay.tsx`
- Test: `ui/tests/close.test.tsx`

**Interfaces:**
- `<Picker options={readonly string[]} selected={number} width={number} />` —
  one line per option, the chosen one marked. Plan 2c reuses it as-is.
- `<CloseOverlay issue={Issue} resolution={number} lines={string[]} … />`

**The vocabulary is imported, never retyped.** `ditz2` exports `RESOLUTIONS`.
A literal `['fixed', 'wontfix', 'duplicate']` here is a second copy of a rule
the facade already enforces — `close` validates through `validateEnum` and
raises `INVALID_FIELD` — and the two would be free to drift. This project
shipped exactly that defect once.

- [ ] **Step 1: Write the failing tests**

```ts
  it('offers exactly the resolutions the facade accepts', async () => {
    // Imported, not retyped: RESOLUTIONS is the single source, and a literal
    // here could offer a value `close` would reject.
    const { lastFrame, stdin } = mount();
    await press(stdin, 'x');
    for (const r of RESOLUTIONS) expect(lastFrame()).toContain(r);
  });

  it('moves between resolutions with the arrows and marks exactly one', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'x');
    expect(lastFrame()).toContain(`(*) ${RESOLUTIONS[0]}`);
    await press(stdin, KEY.down);
    expect(lastFrame()).toContain(`(*) ${RESOLUTIONS[1]}`);
    expect(lastFrame()).toContain(`( ) ${RESOLUTIONS[0]}`);
    const marked = lines(lastFrame()).filter((l) => l.includes('(*)'));
    expect(marked).toHaveLength(1);
  });

  it('stops at the ends rather than wrapping', async () => {
    const { lastFrame, stdin } = mount();
    await press(stdin, 'x', KEY.up, KEY.up);
    expect(lastFrame()).toContain(`(*) ${RESOLUTIONS[0]}`);
    for (let i = 0; i < RESOLUTIONS.length + 2; i += 1) await press(stdin, KEY.down);
    expect(lastFrame()).toContain(`(*) ${RESOLUTIONS.at(-1)}`);
  });

  it('passes the chosen resolution and no comment when none was typed', async () => {
    const calls: [string, string, string | null | undefined][] = [];
    const { stdin } = mount({ close: (p, as, c) => { calls.push([p, as, c]); return three()[0]!; } });
    await press(stdin, 'x', KEY.down, KEY.ctrlS);
    expect(calls[0]![1]).toBe(RESOLUTIONS[1]);
    // null, not '' — the facade spells "no comment" as null everywhere else,
    // and an empty string would append a blank log entry.
    expect(calls[0]![2]).toBeNull();
  });

  it('passes a typed comment alongside the resolution', async () => {
    const calls: [string, string, string | null | undefined][] = [];
    const { stdin } = mount({ close: (p, as, c) => { calls.push([p, as, c]); return three()[0]!; } });
    await press(stdin, 'x', KEY.tab, 'd', 'o', 'n', 'e', KEY.ctrlS);
    expect(calls[0]![1]).toBe(RESOLUTIONS[0]);
    expect(calls[0]![2]).toBe('done');
  });

  it('tabs between the picker and the comment field', async () => {
    // Two fields need a way to move. Tab here is the same key plan 2c uses for
    // the form, so the habit transfers.
  });

  it('types into the comment field without moving the picker', async () => {
    // The bug this guards: while the comment field has focus, `d` is text —
    // not a jump to `duplicate`.
    const { lastFrame, stdin } = mount();
    await press(stdin, 'x', KEY.tab, 'd', 'u', 'e');
    expect(lastFrame()).toContain('due');
    expect(lastFrame()).toContain(`(*) ${RESOLUTIONS[0]}`);
  });

  it('abandons on Esc without writing', async () => {
    const calls: unknown[] = [];
    const { lastFrame, stdin } = mount({ close: () => { calls.push(1); return three()[0]!; } });
    await press(stdin, 'x', KEY.escape);
    expect(calls).toHaveLength(0);
    expect(lastFrame()).not.toContain('^S close');
  });

  it('does not quit on q while open', async () => {
    // q is text in the comment field and must not reach the list's quit.
    const onExit = vi.fn();
    const { stdin } = mount(undefined, undefined, onExit);
    await press(stdin, 'x', KEY.tab, 'q');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('closes and reloads on success', async () => {
    let listCalls = 0;
    const { lastFrame, stdin } = mount({
      close: () => closedIssue(),
      list: () => { listCalls += 1; return { issues: three(), failures: [] }; },
    });
    await press(stdin, 'x', KEY.ctrlS);
    expect(listCalls).toBe(1);
    expect(lastFrame()).not.toContain('^S close');
  });

  it('keeps the closed issue reachable afterwards', async () => {
    // The reload uses SNAPSHOT_FILTER, so the issue just closed is still in
    // the snapshot and `all:true` can find it. Reloading with the default
    // filter would make it vanish with no way back — the single most likely
    // way to lose sight of your own work.
    const { lastFrame, stdin } = mount({ close: () => closedIssue() });
    await press(stdin, 'x', KEY.ctrlS);
    await press(stdin, '/', 'a', 'l', 'l', ':', 't', 'r', 'u', 'e', KEY.enter);
    expect(lastFrame()).toContain('alpha');
  });
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: `Picker.tsx`**

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import { truncate } from '../format.js';

/** Clamped, never wrapping: the ends of a short list should feel like ends. */
export function moveSelection(selected: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(selected + delta, 0), count - 1);
}

export function Picker(
  { options, selected, width, dim }:
  { options: readonly string[]; selected: number; width: number; dim?: boolean },
): React.ReactElement {
  return (
    <Box flexDirection="column">
      {options.map((option, n) => (
        <Text key={option} dimColor={dim === true} wrap="truncate">
          {truncate(`  ${n === selected ? '(*)' : '( )'} ${option}`, width)}
        </Text>
      ))}
    </Box>
  );
}
```

`dim` is how the picker shows it does not have focus, so the operator can see
which of the two fields their next keystroke goes to.

- [ ] **Step 4: `CloseOverlay.tsx`**

```tsx
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Box, Text } from 'ink';
import React from 'react';
import { RESOLUTIONS, shortId } from 'ditz2';
import type { Issue } from 'ditz2';
import { truncate } from '../format.js';
import { Picker } from './Picker.js';
import { TextEntry } from './TextEntry.js';

export type CloseFocus = 'resolution' | 'comment';

export function CloseOverlay(
  { issue, resolution, lines, focus, rows, width }:
  {
    issue: Issue; resolution: number; lines: string[];
    focus: CloseFocus; rows: number; width: number;
  },
): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">
        {truncate(`close ${shortId(issue.id)}  ${issue.title}`, width)}
      </Text>
      <Text> </Text>
      <Picker
        options={RESOLUTIONS}
        selected={resolution}
        width={width}
        dim={focus !== 'resolution'}
      />
      <Text> </Text>
      <Text dimColor={focus !== 'comment'} wrap="truncate">
        {truncate('  comment (optional)', width)}
      </Text>
      <TextEntry
        lines={lines}
        rows={Math.max(rows - RESOLUTIONS.length - 5, 1)}
        width={width}
      />
    </Box>
  );
}
```

`RESOLUTIONS` comes from `ditz2`. A literal here would be a second copy of a
vocabulary `close` already validates, and the two would be free to drift.

- [ ] **Step 5: The `x` binding**

The overlay owns the keyboard. Its branch goes with the other overlay branches,
**before** the shared navigation block — otherwise the arrows move the list
selection behind it instead of the picker.

```tsx
    if (state.overlay?.kind === 'close') {
      const issue = selectedIssue(state);
      if (key.escape) { dispatch({ type: 'closeOverlay' }); return; }
      if (key.tab) { setFocus(focus === 'resolution' ? 'comment' : 'resolution'); return; }
      if (key.ctrl && input === 's') {
        if (issue === null) return;
        const text = draft.join('\n').trim();
        // null, not '': the facade spells "no comment" as null everywhere
        // else, and '' would append a blank log entry nobody can delete.
        const note = text === '' ? null : text;
        write('close', () => { project.close(issue.id, RESOLUTIONS[resolution]!, note); });
        return;
      }
      if (focus === 'resolution') {
        if (key.downArrow) { setResolution(moveSelection(resolution, 1, RESOLUTIONS.length)); return; }
        if (key.upArrow) { setResolution(moveSelection(resolution, -1, RESOLUTIONS.length)); return; }
        return;
      }
      if (key.return) { setDraft([...draft, '']); return; }
      if (key.backspace || key.delete) { setDraft(backspace(draft)); return; }
      if (input !== '' && !key.ctrl && !key.meta) { setDraft(append(draft, input)); return; }
      return;
    }
```

and on the list screen, `if (input === 'x') { dispatch({ type: 'openClose' }); return; }`.

The arrow keys are handled **inside** the focus check rather than above it. A
picker that keeps moving while the comment field has focus is the bug the
"types into the comment field without moving the picker" test exists to catch.

`focus`, `resolution` and `draft` are component state, reset when the overlay
opens — same lifetime and same reasoning as Task 3's draft.

The footer for this overlay:

```tsx
const CLOSE_KEYS = 'tab field  up/down resolution  ^S close  esc cancel';
```

- [ ] **Step 6: Help**

Add to `HELP` in `HelpOverlay.tsx`, after the existing list-screen rows:

```ts
  ['c', 'comment on the selected issue'],
  ['x', 'close it — pick a resolution, comment optional'],
  ['', ''],
  ['while a write waits', 'r retry, esc give up'],
```

`HELP_LINES` grows by four, so `maxHelpOffset` shifts and the two help-scroll
tests at `rows={12}` need their **fixture** press counts recalibrated.
Recalibrate the fixture, never the assertion text, and say in the report which
moved and why. Plan 2a's acceptance rule permits exactly that and forbids the
reverse — and the reason it is worded that way is that treating a stale test as
immovable once preserved a real bug for three tasks.

- [ ] **Step 7: Prove the checks can fail**

1. Replace `RESOLUTIONS` with a literal that omits `duplicate` — the "exactly
   the resolutions the facade accepts" test must fail.
2. Pass `''` instead of `null` for an untyped comment — the null test must fail.
3. Let the picker handle keys while the comment field has focus — the "types
   into the comment field" test must fail on the picker having moved.
4. Reload with the default filter — "keeps the closed issue reachable" must
   fail. This is the same mutation as Task 2's breakage 1, now visible at the
   surface where an operator would actually meet it.

- [ ] **Step 8: Lint and commit**

---

### Task 6: The real thing, on disk

Everything so far renders to a string. This task writes to a real project
through the built binaries in a real pty, and checks the file afterwards.

**Files:**
- Modify: `ui/tests/e2e.test.ts`
- Modify: `README.md`, `ui/README.md`, `HANDOFF.md`

**Interfaces:** none. This task adds no product code — if it needs any, that
is a finding about the previous five.

- [ ] **Step 1: End-to-end tests**

```ts
  it('writes a comment that dz show can read back', async () => {
    // The assertion is on the FILE, not the frame. A frame that says the
    // comment was written proves the UI believes it; only the file proves it.
    await project(async (dir) => {
      await pty([process.execPath, DZUI], dir, `c${'hello'}${CTRL_S}q`);
      const shown = dzShow(dir, firstIssueId(dir));
      expect(shown).toContain('hello');
    });
  });

  it('closes an issue that dz list --all can still find', async () => {
    await project(async (dir) => {
      const id = firstIssueId(dir);
      await pty([process.execPath, DZUI], dir, `x${CTRL_S}q`);
      // Absent from the default list, present with --all: that pair is what
      // "closed" means, and asserting only the first would also pass if the
      // file had been deleted.
      expect(dzList(dir)).not.toContain(id);
      expect(dzList(dir, '--all')).toContain(id);
      expect(dzShow(dir, id)).toContain('closed');
    });
  });

  it('says what is wrong when no author is configured, and writes nothing',
    async () => {
      // whoami() returns null for both "unset" and "malformed", so the UI
      // cannot distinguish them and does not try. resolveAuthor raises the
      // real message inside the facade on the write, which is the one place
      // that knows which case it is. Assert the operator sees it.
      await project(async (dir) => {
        const r = await pty([process.execPath, DZUI], dir, `c${'hi'}${CTRL_S}`,
          { DZ_AUTHOR: undefined });
        expect(r.text).toContain('DZ_AUTHOR');
        expect(dzShow(dir, firstIssueId(dir))).not.toContain('hi');
      });
    });

  it('says what is wrong when the author is malformed, and writes nothing',
    async () => {
      // A DZ_AUTHOR containing a double space breaks the log grammar, which
      // uses it as a field separator. The facade refuses; the UI must relay it.
      await project(async (dir) => {
        const r = await pty([process.execPath, DZUI], dir, `c${'hi'}${CTRL_S}`,
          { DZ_AUTHOR: 'Jane  Roe <jane@example.com>' });
        expect(r.text).toContain('double space');
      });
    });
```

The last two are the payment on the `whoami()` ruling. The UI cannot tell the
two cases apart, and does not need to: the facade produces the right message
at the moment of the write, and this proves the operator sees it rather than a
blank screen or a crash.

- [ ] **Step 2: Prove they can fail**

1. Swallow the `mutationFailed` message in the error overlay — both identity
   tests must fail.
2. Make the comment write happen before the empty-text guard — no test here
   fails; note it, and add the missing coverage if it is cheap.

- [ ] **Step 3: Documentation**

`ui/README.md` gains `c` and `x` in the key table and a sentence that the UI
now writes. The "What it does not do" section loses comment and close and
keeps the rest. `HANDOFF.md` records the new counts, that `lockTimeoutMs: 0`
is **now covered** (deleting the loose end that says it is not), and that
plans 2c and 2d remain.

- [ ] **Step 4: Full verification and commit**

```bash
npm run typecheck && npm run build && npx vitest run
rm -rf .dz-fstest
npm run test:all          # check echo $?, not the log
```

---

## Acceptance

- [ ] `npm run test:all` — **exit code 0**, checked directly. The log is not
      the gate; npm 8.19.4 discards workspace-member exit statuses and this
      script only works because it calls `tsc` and `vitest` itself.
- [ ] Every "prove the check can fail" step was run, and each breakage that
      refused to fire is recorded as a finding rather than ticked off. Nine of
      them refused in plan 2a and every one was a real gap.
- [ ] **`lockTimeoutMs: 0` is covered.** Setting it to `2000` must fail Task
      4's pty test on elapsed time. Report both measurements.
- [ ] `ditz2`'s runtime dependencies are still exactly `commander`, `uuid`,
      `yaml`, and `ui/` imports `ditz2` only by bare specifier.
- [ ] A comment and a close performed through the built binary are visible in
      `dz show` and `dz list --all` afterwards — asserted on the file, not the
      frame.
- [ ] The UI was run by hand against this repository's own backlog.
      Every requirement gap in plan 2a was found by a person looking at a
      screen and none by review; do not skip this.

## Deliberately not in this plan

The form screen and `add`/`set` are plan 2c. `$EDITOR` body editing and the
conflict overlay are plan 2d, and the spike behind them is already done —
`.superpowers/sdd/2026-08-26-ditz2-ui-browse/spike-editor-suspend.md` confirms
suspend-without-unmount works on Ink 6.8.0, that post-resume state renders,
that the child gets a real tty, and that the alternate screen composes cleanly
even when the editor uses it too. It also found the `unmount()` path fails
worse than the spec says: no frame is drawn again, `waitUntilExit()` resolves
before the edit finishes, and the process will not exit on `q`. Plan 2d should
forbid that path outright rather than describe it as a worse alternative.
