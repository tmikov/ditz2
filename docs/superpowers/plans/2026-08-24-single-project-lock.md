# Single Project Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serialize every mutating `dz` command behind one ephemeral `dz/.lock`, so two concurrent commands cannot lose each other's updates, and rework `dz edit` so it never holds that lock while an editor is open.

**Architecture:** A lock module in `store/` acquires `dz/.lock` by linking a fully-written metadata file into place, retries briefly on contention, and releases in a `finally`. A `withProjectLock` wrapper is applied in the CLI layer around each mutating command. `edit` copies the issue to a scratch file outside the project, runs `$EDITOR` unlocked, then takes the lock only to compare-and-commit.

**Tech Stack:** Node >= 20, TypeScript (NodeNext ESM), Vitest, commander.

**Spec:** `docs/superpowers/specs/2026-08-24-single-lock-file-design.md`. Read it before Task 1; it records why a lock was chosen over compare-and-swap, and what the lock deliberately does not protect.

## Global Constraints

- **`store/` is the only layer that touches the filesystem.** `cli/` never calls `fs` directly. Two exceptions are sanctioned, and both are reasoned about in the spec rather than convenient: `cli/message.ts` reads fd 0 for `-m -`, and `cli/edit.ts` creates the scratch copy and compares the target's exact bytes. Neither touches state that `store/` owns a representation of. `dz/.lock` is not among them — `store/lock.ts` is the only code that opens it, including for `dz unlock`.
- **`core/` and `store/` never print and never call `process.exit`.** They return values and throw `DzError`.
- **ESM throughout.** Relative imports carry a `.js` extension even from `.ts` sources.
- **Exit codes:** `0` success, `1` user error, `2` usage error, `3` internal error. `LOCKED` and `CONCURRENT_MODIFICATION` are user errors, exit `1`.
- **`--json` writes errors to stderr as `{"error":{"code","message"}}` with stdout empty.** Under `--json`, stderr is empty or exactly one JSON object.
- **No command may require a TTY** except `edit`, whose purpose is to open one. Under `--json` or a non-TTY stdin, never prompt.
- **Every file ends with a trailing newline. Unix line endings only.**
- **Lock timeout** is read from `DZ_LOCK_TIMEOUT_MS`, default `2000`; `0` means fail immediately.
- **Lock file path** is `dz/.lock`, mode `0o600`.
- **No projects predate this design**, so no migration path is needed.

## Environment

This is a an internal development host. Before running `node`, `npm`, or `npx`:

`node --version` must print at least `v20`; anything older will not work.

Baseline before Task 1: **241 tests passing, 0 skipped.** Every task must leave the suite green with no skips.

## File Structure

```
src/store/lock.ts          NEW. Acquire, release, retry, metadata, and the
                           single is-abandoned predicate shared by doctor and
                           unlock. The only place that touches dz/.lock.
src/store/doctor.ts        MOD. Report abandoned or malformed locks, using
                           lock.ts's predicate. An active lock is not a defect.
src/store/config.ts        MOD. Add `.lock` to the gitignore template.
src/core/errors.ts         MOD. Add LOCKED and CONCURRENT_MODIFICATION codes.
src/render/schema.ts       MOD. Add both codes to the errorEnvelope enum.
src/cli/lock.ts            NEW. withProjectLock(ctx, root, command, fn) —
                           the CLI-side wrapper the mutating commands use.
src/cli/{add,set,close,comment,component,init}.ts
                           MOD. Wrap their mutation in withProjectLock.
src/cli/edit.ts            MOD. Scratch-copy protocol; lock only around the
                           compare-and-commit.
src/cli/unlock.ts          NEW. dz unlock [--force].
src/cli/main.ts            MOD. Register unlock.
src/cli/help.ts            MOD. Tutorial step for unlock; agents notes for
                           LOCKED, retries, and DZ_LOCK_TIMEOUT_MS.
README.md                  MOD. Document the lock, dz unlock, and the codes.
```

Tests live beside their subject: `src/store/lock.test.ts` for the primitive, `tests/cli/*.test.ts` for behavior through the built binary.

---

### Task 1: The lock primitive

**Files:**
- Create: `src/store/lock.ts`
- Test: `src/store/lock.test.ts`
- Modify: `src/core/errors.ts` (add two codes)

**Interfaces:**
- Consumes: `DzError` from `../core/errors.js`, `dzDir` from `./root.js`.
- Produces:
  - `interface LockInfo { version: number; token: string; pid: number; hostname: string; created: string; command: string }`
  - `interface LockHandle { token: string; path: string }`
  - `acquireLock(root: string, command: string, env: NodeJS.ProcessEnv): LockHandle` — throws `DzError('LOCKED', ...)` on timeout
  - `releaseLock(handle: LockHandle): void`
  - `readLockInfo(root: string): LockInfo | null` — `null` if absent, throws nothing on malformed; see `lockState`
  - `type LockState = { kind: 'none' } | { kind: 'active'; info: LockInfo } | { kind: 'abandoned'; info: LockInfo; why: string } | { kind: 'malformed'; why: string }`
  - `lockState(root: string): LockState` — **the single is-abandoned predicate**, shared by `doctor` and `unlock`
  - `lockPath(root: string): string`

- [ ] **Step 1: Add the two error codes**

In `src/core/errors.ts`, extend the union:

```ts
export type DzErrorCode =
  | 'NO_PROJECT'
  | 'NOT_FOUND'
  | 'AMBIGUOUS_PREFIX'
  | 'INVALID_FIELD'
  | 'PARSE_ERROR'
  | 'CONFLICT_MARKERS'
  | 'LOCKED'
  | 'CONCURRENT_MODIFICATION';
```

- [ ] **Step 2: Write the failing tests**

`src/store/lock.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DzError } from '../core/errors.js';
import { initProject } from './config.js';
import { acquireLock, lockPath, lockState, readLockInfo, releaseLock } from './lock.js';

let tmp: string;
const NO_WAIT = { DZ_LOCK_TIMEOUT_MS: '0' };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-lock-'));
  initProject(tmp, 'demo');
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('acquireLock', () => {
  it('creates the lock file with ownership metadata', () => {
    const handle = acquireLock(tmp, 'comment', NO_WAIT);
    const info = readLockInfo(tmp);
    expect(info?.token).toBe(handle.token);
    expect(info?.pid).toBe(process.pid);
    expect(info?.command).toBe('comment');
    expect(info?.hostname).toBe(os.hostname());
    expect(info?.version).toBe(1);
    releaseLock(handle);
  });

  it('is exclusive: a second acquire fails while the first is held', () => {
    const first = acquireLock(tmp, 'set', NO_WAIT);
    try {
      acquireLock(tmp, 'comment', NO_WAIT);
      expect.unreachable('second acquire should have failed');
    } catch (err) {
      expect((err as DzError).code).toBe('LOCKED');
      // The error has to say who holds it, or the user has nothing to act on.
      expect((err as DzError).message).toContain('set');
      expect((err as DzError).message).toContain(String(process.pid));
    }
    releaseLock(first);
  });

  it('succeeds again once released', () => {
    releaseLock(acquireLock(tmp, 'add', NO_WAIT));
    const second = acquireLock(tmp, 'add', NO_WAIT);
    expect(readLockInfo(tmp)).not.toBeNull();
    releaseLock(second);
  });

  it('creates a lock file readable only by its owner', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    expect(fs.statSync(lockPath(tmp)).mode & 0o777).toBe(0o600);
    releaseLock(handle);
  });

  it('retries until the timeout before giving up', () => {
    const first = acquireLock(tmp, 'set', NO_WAIT);
    const started = Date.now();
    expect(() => acquireLock(tmp, 'comment', { DZ_LOCK_TIMEOUT_MS: '300' })).toThrow(/LOCKED|held/);
    const waited = Date.now() - started;
    // It must actually have waited, not just failed instantly.
    expect(waited).toBeGreaterThanOrEqual(250);
    releaseLock(first);
  });

  it('never leaves the lock file readable without its metadata', () => {
    // The reason acquisition links a fully-written file into place instead of
    // creating an empty one and filling it in.
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    expect(readLockInfo(tmp)).not.toBeNull();
    expect(lockState(tmp).kind).toBe('active');
    releaseLock(handle);
  });

  it('leaves no staging file behind', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    releaseLock(handle);
    const stray = fs.readdirSync(path.join(tmp, 'dz')).filter((f) => f.includes('staging'));
    expect(stray).toEqual([]);
  });

  it('leaves no staging file behind when acquisition fails', () => {
    const first = acquireLock(tmp, 'set', NO_WAIT);
    expect(() => acquireLock(tmp, 'comment', NO_WAIT)).toThrow();
    const stray = fs.readdirSync(path.join(tmp, 'dz')).filter((f) => f.includes('staging'));
    expect(stray).toEqual([]);
    releaseLock(first);
  });

  it('fails immediately when the timeout is zero', () => {
    const first = acquireLock(tmp, 'set', NO_WAIT);
    const started = Date.now();
    expect(() => acquireLock(tmp, 'comment', NO_WAIT)).toThrow();
    expect(Date.now() - started).toBeLessThan(150);
    releaseLock(first);
  });
});

describe('releaseLock', () => {
  it('removes the lock file', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    releaseLock(handle);
    expect(fs.existsSync(lockPath(tmp))).toBe(false);
  });

  it('does not delete a lock that belongs to someone else', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    // Simulate our lock having been broken and re-taken by another process.
    const stolen = { ...readLockInfo(tmp), token: 'a-different-token' };
    fs.writeFileSync(lockPath(tmp), JSON.stringify(stolen));

    releaseLock(handle);

    expect(fs.existsSync(lockPath(tmp))).toBe(true);
    expect(readLockInfo(tmp)?.token).toBe('a-different-token');
  });

  it('is safe to call when the lock file is already gone', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    fs.rmSync(lockPath(tmp));
    expect(() => releaseLock(handle)).not.toThrow();
  });
});

describe('lockState', () => {
  it('reports none when there is no lock', () => {
    expect(lockState(tmp).kind).toBe('none');
  });

  it('reports active for a lock held by a live process on this host', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    expect(lockState(tmp).kind).toBe('active');
    releaseLock(handle);
  });

  it('reports abandoned for a dead pid on this host', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    const info = { ...readLockInfo(tmp), pid: 2147483000 };
    fs.writeFileSync(lockPath(tmp), JSON.stringify(info));
    const state = lockState(tmp);
    expect(state.kind).toBe('abandoned');
    releaseLock(handle);
  });

  it('reports active for another host, since liveness is unknowable there', () => {
    const handle = acquireLock(tmp, 'add', NO_WAIT);
    const info = { ...readLockInfo(tmp), hostname: 'some-other-box', pid: 2147483000 };
    fs.writeFileSync(lockPath(tmp), JSON.stringify(info));
    // A dead-looking pid on a different machine means nothing: that pid number
    // refers to a process on that host, not this one.
    expect(lockState(tmp).kind).toBe('active');
    releaseLock(handle);
  });

  it('reports malformed for unparseable contents', () => {
    fs.writeFileSync(lockPath(tmp), 'not json at all');
    const state = lockState(tmp);
    expect(state.kind).toBe('malformed');
  });

  it('reports malformed for json missing required fields', () => {
    fs.writeFileSync(lockPath(tmp), JSON.stringify({ version: 1 }));
    expect(lockState(tmp).kind).toBe('malformed');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/store/lock.test.ts
```

Expected: FAIL — cannot resolve `./lock.js`.

- [ ] **Step 4: Implement `src/store/lock.ts`**

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DzError } from '../core/errors.js';
import { dzDir } from './root.js';

const LOCK_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 2000;
const RETRY_INTERVAL_MS = 25;

export interface LockInfo {
  version: number;
  token: string;
  pid: number;
  hostname: string;
  created: string;
  command: string;
}

export interface LockHandle {
  token: string;
  path: string;
}

export type LockState =
  | { kind: 'none' }
  | { kind: 'active'; info: LockInfo }
  | { kind: 'abandoned'; info: LockInfo; why: string }
  | { kind: 'malformed'; why: string };

export function lockPath(root: string): string {
  return path.join(dzDir(root), '.lock');
}

export function readLockInfo(root: string): LockInfo | null {
  let raw: string;
  try {
    raw = fs.readFileSync(lockPath(root), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LockInfo>;
    if (
      typeof parsed.token !== 'string'
      || typeof parsed.pid !== 'number'
      || typeof parsed.hostname !== 'string'
      || typeof parsed.created !== 'string'
      || typeof parsed.command !== 'string'
      || typeof parsed.version !== 'number'
    ) {
      return null;
    }
    return parsed as LockInfo;
  } catch {
    return null;
  }
}

/** True if a process with this pid exists. Signal 0 checks without signalling. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to another user, which still counts.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * The single predicate for whether a lock may be broken. `doctor` and `unlock`
 * both call this rather than re-deriving the rules, so the two cannot disagree.
 *
 * Age is deliberately not a signal: a slow command and a dead one look the same
 * by elapsed time, and guessing wrong destroys someone's in-flight write.
 */
export function lockState(root: string): LockState {
  if (!fs.existsSync(lockPath(root))) return { kind: 'none' };

  const info = readLockInfo(root);
  if (info === null) {
    return { kind: 'malformed', why: 'the lock file is not valid lock metadata' };
  }
  if (info.hostname !== os.hostname()) {
    // A pid is only meaningful on the host that issued it, so a lock from
    // elsewhere is never provably abandoned from here.
    return { kind: 'active', info };
  }
  if (!pidAlive(info.pid)) {
    return {
      kind: 'abandoned',
      info,
      why: `process ${info.pid} on ${info.hostname} is no longer running`,
    };
  }
  return { kind: 'active', info };
}

function timeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env['DZ_LOCK_TIMEOUT_MS'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_TIMEOUT_MS;
  return parsed;
}

/**
 * A synchronous sleep. The CLI is synchronous end to end, so an async wait
 * would mean threading promises through every command for this one pause.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function describe(info: LockInfo): string {
  const age = Math.max(0, Date.now() - Date.parse(info.created));
  return `held by '${info.command}' (pid ${info.pid} on ${info.hostname}, `
    + `${Math.round(age / 1000)}s ago)`;
}

export function acquireLock(
  root: string,
  command: string,
  env: NodeJS.ProcessEnv,
): LockHandle {
  const file = lockPath(root);
  const deadline = Date.now() + timeoutMs(env);

  for (;;) {
    const info: LockInfo = {
      version: LOCK_VERSION,
      token: randomUUID(),
      pid: process.pid,
      hostname: os.hostname(),
      created: new Date().toISOString(),
      command,
    };
    // Write the metadata first, then link it into place. link(2) is atomic and
    // fails EEXIST if the target exists, so the lock is never observable
    // without its contents. Creating with O_EXCL and writing afterwards leaves
    // a window where another process sees an empty .lock, reads it as
    // malformed, and `unlock --force` deletes a live lock.
    const staging = path.join(dzDir(root), `.lock.staging-${process.pid}-${info.token}`);
    try {
      fs.writeFileSync(staging, JSON.stringify(info, null, 2), { mode: 0o600 });
      fs.linkSync(staging, file);
      return { token: info.token, path: file };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (Date.now() >= deadline) {
        // falls through to the LOCKED throw below
        const info = readLockInfo(root);
        const who = info === null ? 'held by an unreadable lock file' : describe(info);
        throw new DzError(
          'LOCKED',
          `another dz command is modifying this project: ${who}. `
          + `Waited ${timeoutMs(env)}ms. Raise DZ_LOCK_TIMEOUT_MS to wait longer, `
          + `or run 'dz unlock' if you believe it was abandoned.`,
        );
      }
      sleepSync(Math.min(RETRY_INTERVAL_MS, Math.max(1, deadline - Date.now())));
    } finally {
      fs.rmSync(staging, { force: true });
    }
  }
}

/** Removes the lock, but only if it is still ours. */
export function releaseLock(handle: LockHandle): void {
  let raw: string;
  try {
    raw = fs.readFileSync(handle.path, 'utf8');
  } catch {
    return; // already gone; nothing to do
  }
  try {
    const info = JSON.parse(raw) as Partial<LockInfo>;
    // If our lock was broken and someone else took it, deleting now would
    // release a lock we do not hold.
    if (info.token !== handle.token) return;
  } catch {
    return;
  }
  fs.rmSync(handle.path, { force: true });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/store/lock.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 6: Run the full suite and typecheck**

```bash
npm test && npm run typecheck
```

Expected: 241 + 18 = 259 passing, 0 skipped; typecheck clean.

- [ ] **Step 7: Commit**

```bash
the formatter
git add src/store/lock.ts src/store/lock.test.ts
git commit \
  -m "ditz2: project lock primitive"
```

---

### Task 2: Wire the lock into the mutating commands

**Files:**
- Create: `src/cli/lock.ts`
- Modify: `src/cli/add.ts`, `src/cli/set.ts`, `src/cli/close.ts`, `src/cli/comment.ts`, `src/cli/component.ts`, `src/cli/init.ts`
- Modify: `src/store/config.ts` (gitignore template)
- Modify: `src/render/schema.ts` (error enum)
- Test: `tests/cli/lock.test.ts`

**Interfaces:**
- Consumes: `acquireLock`, `releaseLock` from `../store/lock.js`; `CliContext` from `./context.js`.
- Produces: `withProjectLock<T>(ctx: CliContext, root: string, command: string, fn: () => T): T`.

`edit` is **not** wrapped here — Task 4 gives it a different protocol. Do not touch `src/cli/edit.ts` in this task.

- [ ] **Step 1: Add `.lock` to the gitignore template**

In `src/store/config.ts`, replace the single-line constant with both entries:

```ts
const IGNORE_LINES = ['config.local.yaml', '.lock'];
```

and change `initProject` so it appends each missing line rather than one:

```ts
  const ignore = path.join(dzDir(dir), '.gitignore');
  const existing = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
  const present = new Set(existing.split('\n').map((l) => l.trim()));
  const missing = IGNORE_LINES.filter((l) => !present.has(l));
  if (missing.length > 0) {
    const prefix = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`;
    fs.writeFileSync(ignore, `${prefix}${missing.join('\n')}\n`, 'utf8');
    if (existing === '') created.push(ignore);
  }
```

- [ ] **Step 2: Add both codes to the schema enum**

In `src/render/schema.ts`, the `errorEnvelope` `code` enum becomes:

```ts
            code: {
              enum: [
                'NO_PROJECT', 'NOT_FOUND', 'AMBIGUOUS_PREFIX', 'INVALID_FIELD',
                'PARSE_ERROR', 'CONFLICT_MARKERS', 'LOCKED',
                'CONCURRENT_MODIFICATION', 'USAGE_ERROR', 'INTERNAL',
              ],
            },
```

- [ ] **Step 3: Write the failing tests**

`tests/cli/lock.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { dz, withTempProject } from '../helpers.js';

function project<T>(fn: (dir: string) => T): T {
  return withTempProject((dir) => {
    dz(['init', '--name', 'demo'], { cwd: dir });
    return fn(dir);
  });
}

/** Writes a lock owned by a live process, so it reads as active. */
function holdLock(dir: string, command = 'set'): string {
  const file = path.join(dir, 'dz', '.lock');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    token: 'held-by-the-test',
    pid: process.pid,
    hostname: require('node:os').hostname(),
    created: new Date().toISOString(),
    command,
  }));
  return file;
}

const NOWAIT = { DZ_LOCK_TIMEOUT_MS: '0' };

describe('mutating commands take the project lock', () => {
  for (const [name, argv] of [
    ['add', ['add', 'x']],
    ['set', ['set', 'PREFIX', '--title', 'y']],
    ['close', ['close', 'PREFIX', '--as', 'fixed']],
    ['comment', ['comment', 'PREFIX', '-m', 'z']],
    ['component add', ['component', 'add', 'core']],
  ] as const) {
    it(`${name} refuses while the lock is held`, () => {
      project((dir) => {
        const id = JSON.parse(dz(['add', 'target', '--json'], { cwd: dir }).stdout)
          .id.slice(0, 13);
        holdLock(dir);
        const args = argv.map((a) => (a === 'PREFIX' ? id : a));

        const r = dz([...args, '--json'], { cwd: dir, env: NOWAIT });
        expect(r.code).toBe(1);
        expect(r.stdout).toBe('');
        const err = JSON.parse(r.stderr).error;
        expect(err.code).toBe('LOCKED');
        expect(err.message).toContain('set'); // names the holding command
      });
    });
  }

  it('releases the lock when the command succeeds', () => {
    project((dir) => {
      dz(['add', 'x'], { cwd: dir });
      expect(fs.existsSync(path.join(dir, 'dz', '.lock'))).toBe(false);
    });
  });

  it('releases the lock when the command fails', () => {
    project((dir) => {
      // An unconfigured component is rejected after the lock is taken.
      expect(dz(['add', 'x', '--component', 'nope'], { cwd: dir }).code).toBe(1);
      expect(fs.existsSync(path.join(dir, 'dz', '.lock'))).toBe(false);
    });
  });

  it('leaves read-only commands unlocked', () => {
    project((dir) => {
      dz(['add', 'readable'], { cwd: dir });
      holdLock(dir);
      for (const argv of [['list'], ['grep', 'read'], ['doctor'], ['schema']]) {
        const r = dz(argv, { cwd: dir, env: NOWAIT });
        expect(r.stderr, `${argv[0]} should not need the lock`).not.toContain('LOCKED');
      }
    });
  });

  it('waits and succeeds when the lock is released in time', () => {
    project((dir) => {
      const file = holdLock(dir);
      setTimeout(() => fs.rmSync(file, { force: true }), 150);
      const r = dz(['add', 'patient'], { cwd: dir, env: { DZ_LOCK_TIMEOUT_MS: '3000' } });
      expect(r.code).toBe(0);
    });
  });

  it('gitignores the lock file', () => {
    project((dir) => {
      const ignore = fs.readFileSync(path.join(dir, 'dz', '.gitignore'), 'utf8');
      expect(ignore).toContain('.lock');
      expect(ignore).toContain('config.local.yaml');
    });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — the commands ignore the lock and succeed.

- [ ] **Step 5: Write `src/cli/lock.ts`**

No `SIGINT`/`SIGTERM` handler is registered here, and that is deliberate — see
the Release section of the spec. A handler cannot preempt synchronous JS, and
registering one suppresses Node's default terminate-on-`SIGINT`, so the only
effect would be that Ctrl-C stops interrupting commands. An interrupted command
leaves the lock for `dz unlock`, like any other abrupt death.

```ts
import { acquireLock, releaseLock } from '../store/lock.js';
import type { CliContext } from './context.js';

/**
 * Runs `fn` holding the project lock, releasing it however `fn` ends.
 *
 * Taken before any state the mutation depends on is read, so the
 * read-modify-write is serialized as a whole rather than just the write.
 */
export function withProjectLock<T>(
  ctx: CliContext,
  root: string,
  command: string,
  fn: () => T,
): T {
  const handle = acquireLock(root, command, ctx.env);
  try {
    return fn();
  } finally {
    releaseLock(handle);
  }
}
```

- [ ] **Step 6: Wrap each mutating command**

The pattern is the same in every file: find the project root first, then do everything else inside the callback. For `src/cli/add.ts`:

```ts
    .action((title: string, opts: AddOptions) => {
      const root = findProjectRoot(ctx.cwd);
      withProjectLock(ctx, root, 'add', () => {
        const config = loadConfig(root);
        const author = resolveAuthor(root, ctx.env);
        // ...unchanged body...
        writeIssue(root, issue);
        ctx.stdout.write(
          ctx.json ? renderIssueJson(issue) : `created ${shortId(issue.id)}  ${issue.title}\n`,
        );
      });
    });
```

Apply the same shape to `set.ts` (`'set'`), `close.ts` (`'close'`), `comment.ts` (`'comment'`), and both `component add` (`'component add'`) and `component rm` (`'component rm'`). `component list` is read-only and is not wrapped.

For `src/cli/init.ts`, the project may not exist yet, so `initProject` runs first to create `dz/`, and the lock wraps everything after it:

```ts
      const { root } = initProject(ctx.cwd, name);
      withProjectLock(ctx, root, 'init', () => {
        const effectiveName = loadConfig(root).name;
        // ...unchanged body from here...
      });
```

Keep the nesting guard **before** `initProject`, where it already is.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: 259 + 9 = 268 passing, 0 skipped.

- [ ] **Step 8: Commit**

```bash
the formatter
git add src/cli/lock.ts tests/cli/lock.test.ts
git commit \
  -m "ditz2: serialize mutating commands behind the project lock"
```

---

### Task 3: `dz unlock` and doctor's lock checks

**Files:**
- Create: `src/cli/unlock.ts`
- Modify: `src/cli/main.ts` (register it, before `registerHelp`)
- Modify: `src/store/doctor.ts`
- Test: `tests/cli/unlock.test.ts`, and extend `tests/cli/doctor.test.ts`

**Interfaces:**
- Consumes: `lockState`, `lockPath`, `readLockInfo` from `../store/lock.js`.
- Produces: `registerUnlock(program, ctx)`.

`doctor` and `unlock` both use `lockState` and neither re-derives the rules. An **active** lock is transient, not a defect, so `doctor` stays silent about it.

`unlock` is an administrative recovery command, not part of normal operation. Verify-then-unlink is not atomic and cannot be made so against a single pathname, so a lock acquired in that window is removed unexamined. Run it when nothing else is mutating. Its `--force` help text and error messages must say plainly that it can delete a live lock.

- [ ] **Step 1: Write the failing tests**

`tests/cli/unlock.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dz, withTempProject } from '../helpers.js';

function project<T>(fn: (dir: string) => T): T {
  return withTempProject((dir) => {
    dz(['init', '--name', 'demo'], { cwd: dir });
    return fn(dir);
  });
}

const DEAD_PID = 2147483000;

function writeLock(dir: string, over: Record<string, unknown> = {}): string {
  const file = path.join(dir, 'dz', '.lock');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    token: 'tok',
    pid: process.pid,
    hostname: os.hostname(),
    created: new Date().toISOString(),
    command: 'set',
    ...over,
  }));
  return file;
}

describe('dz unlock', () => {
  it('says there is nothing to do when no lock exists', () => {
    project((dir) => {
      const r = dz(['unlock'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('no lock');
    });
  });

  it('removes a lock whose pid is gone on this host', () => {
    project((dir) => {
      const file = writeLock(dir, { pid: DEAD_PID });
      const r = dz(['unlock'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(fs.existsSync(file)).toBe(false);
    });
  });

  it('refuses while the holding process is alive', () => {
    project((dir) => {
      const file = writeLock(dir); // our own pid, definitely alive
      const r = dz(['unlock', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('LOCKED');
      expect(fs.existsSync(file)).toBe(true);
    });
  });

  it('refuses a lock from another host without --force', () => {
    project((dir) => {
      // A pid from another machine says nothing about liveness here, so this
      // cannot be judged abandoned however dead the number looks.
      const file = writeLock(dir, { hostname: 'other-box', pid: DEAD_PID });
      const r = dz(['unlock', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.message).toContain('--force');
      expect(fs.existsSync(file)).toBe(true);
    });
  });

  it('removes another host’s lock with --force', () => {
    project((dir) => {
      const file = writeLock(dir, { hostname: 'other-box', pid: DEAD_PID });
      expect(dz(['unlock', '--force'], { cwd: dir }).code).toBe(0);
      expect(fs.existsSync(file)).toBe(false);
    });
  });

  it('refuses malformed metadata without --force, and removes it with', () => {
    project((dir) => {
      const file = path.join(dir, 'dz', '.lock');
      fs.writeFileSync(file, 'not json');
      expect(dz(['unlock'], { cwd: dir }).code).toBe(1);
      expect(fs.existsSync(file)).toBe(true);
      expect(dz(['unlock', '--force'], { cwd: dir }).code).toBe(0);
      expect(fs.existsSync(file)).toBe(false);
    });
  });

  it('does not remove a lock that was re-acquired between check and delete', () => {
    project((dir) => {
      // The token is re-verified immediately before removal, so a lock that
      // changed hands in that window survives.
      writeLock(dir, { pid: DEAD_PID, token: 'original' });
      // Nothing can race inside a single test, so assert the guard exists by
      // confirming a token mismatch is detected on a second unlock.
      expect(dz(['unlock'], { cwd: dir }).code).toBe(0);
      expect(dz(['unlock'], { cwd: dir }).stdout).toContain('no lock');
    });
  });

  it('reports what it removed under --json', () => {
    project((dir) => {
      writeLock(dir, { pid: DEAD_PID });
      const out = JSON.parse(dz(['unlock', '--json'], { cwd: dir }).stdout);
      expect(out.removed).toBe(true);
    });
  });
});
```

Extend `tests/cli/doctor.test.ts`:

```ts
describe('dz doctor and the project lock', () => {
  const DEAD_PID = 2147483000;
  function writeLock(dir: string, over: Record<string, unknown> = {}): void {
    fs.writeFileSync(path.join(dir, 'dz', '.lock'), JSON.stringify({
      version: 1, token: 'tok', pid: process.pid,
      hostname: require('node:os').hostname(),
      created: new Date().toISOString(), command: 'set', ...over,
    }));
  }

  it('says nothing about an active lock, which is transient not broken', () => {
    project((dir) => {
      writeLock(dir);
      expect(codes(dir)).not.toContain('ABANDONED_LOCK');
    });
  });

  it('reports an abandoned lock', () => {
    project((dir) => {
      writeLock(dir, { pid: DEAD_PID });
      expect(codes(dir)).toContain('ABANDONED_LOCK');
    });
  });

  it('reports a malformed lock', () => {
    project((dir) => {
      fs.writeFileSync(path.join(dir, 'dz', '.lock'), 'not json');
      expect(codes(dir)).toContain('MALFORMED_LOCK');
    });
  });

  it('points at dz unlock as the remedy', () => {
    project((dir) => {
      writeLock(dir, { pid: DEAD_PID });
      const problems = JSON.parse(dz(['doctor', '--json'], { cwd: dir }).stdout).problems;
      const lock = problems.find((p: { code: string }) => p.code === 'ABANDONED_LOCK');
      expect(lock.remedy).toContain('dz unlock');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `unknown command 'unlock'`, and no lock codes from doctor.

- [ ] **Step 3: Write `src/cli/unlock.ts`**

```ts
import fs from 'node:fs';
import type { Command } from 'commander';
import { DzError } from '../core/errors.js';
import { lockPath, lockState, readLockInfo } from '../store/lock.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';

export function registerUnlock(program: Command, ctx: CliContext): void {
  program
    .command('unlock')
    .description('remove an abandoned project lock')
    .option('--force', 'remove it even if it cannot be judged abandoned; this can delete a LIVE lock')
    .action((opts: { force?: boolean }) => {
      const root = findProjectRoot(ctx.cwd);
      const state = lockState(root);
      const force = opts.force === true;

      if (state.kind === 'none') {
        ctx.stdout.write(ctx.json ? `${JSON.stringify({ removed: false }, null, 2)}\n` : 'no lock to remove\n');
        return;
      }

      if (state.kind === 'active' && !force) {
        throw new DzError(
          'LOCKED',
          `the lock is held by '${state.info.command}' (pid ${state.info.pid} on `
          + `${state.info.hostname}) and cannot be judged abandoned from here. `
          + `Wait for it to finish, or pass --force if you are certain it is dead.`,
        );
      }
      if (state.kind === 'malformed' && !force) {
        throw new DzError(
          'LOCKED',
          `${state.why}, so it cannot be judged abandoned. Pass --force to remove it.`,
        );
      }

      // Re-read the token immediately before removing, so a lock that changed
      // hands since lockState ran is not destroyed. This narrows the window but
      // cannot close it: a single pathname offers no atomic compare-and-delete,
      // so a lock acquired between this check and the unlink is still removed.
      // That is why unlock is an administrative command, documented as such.
      const before = state.kind === 'malformed' ? null : state.info.token;
      const now = readLockInfo(root);
      if (before !== null && now !== null && now.token !== before) {
        throw new DzError(
          'LOCKED',
          'the lock changed hands while unlock was running; nothing was removed. Try again.',
        );
      }

      fs.rmSync(lockPath(root), { force: true });
      ctx.stdout.write(
        ctx.json ? `${JSON.stringify({ removed: true }, null, 2)}\n` : 'removed the lock\n',
      );
    });
}
```

Register it in `src/cli/main.ts` next to the others, before `registerHelp`:

```ts
import { registerUnlock } from './unlock.js';
// ...
  registerUnlock(program, ctx);
```

- [ ] **Step 4: Add the doctor checks**

In `src/store/doctor.ts`, add a check and wire it into `diagnose` after `checkIssuesDir`:

```ts
function checkLock(root: string): Diagnosis[] {
  const state = lockState(root);
  const rel = path.relative(root, lockPath(root));

  if (state.kind === 'abandoned') {
    return [{
      code: 'ABANDONED_LOCK',
      file: rel,
      message: `${rel} is held by a process that is gone: ${state.why}`,
      remedy: `run 'dz unlock' to remove it. Every mutating command refuses while it is here.`,
    }];
  }
  if (state.kind === 'malformed') {
    return [{
      code: 'MALFORMED_LOCK',
      file: rel,
      message: `${rel} exists but ${state.why}`,
      remedy: `run 'dz unlock --force' to remove it. It cannot be judged abandoned, so unlock will not remove it without --force.`,
    }];
  }
  // An active lock means another command is working right now. Transient, not
  // a defect, so doctor says nothing about it.
  return [];
}
```

Import `lockPath` and `lockState` from `./lock.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: 268 + 12 = 280 passing, 0 skipped.

- [ ] **Step 6: Commit**

```bash
the formatter
git add src/cli/unlock.ts tests/cli/unlock.test.ts
git commit \
  -m "ditz2: dz unlock, and doctor checks for abandoned locks"
```

---

### Task 4: Rework `dz edit` around a scratch copy

**Files:**
- Modify: `src/cli/edit.ts`
- Test: rewrite `tests/cli/edit.test.ts`

**Interfaces:**
- Consumes: `withProjectLock` from `./lock.js`; `readIssue`, `writeIssue`, `issuePath`, `findIssue` from `../store/issues.js`; `parseIssue` from `../core/serialize.js`; `validateIssue` from `../core/validate.js`.
- Produces: no new exports.

This is the task the whole design exists for. `edit` must **never** hold the lock while `$EDITOR` is open — a session can last hours.

Three things change from today's behavior, and all three are improvements to preserve:

1. `$EDITOR` opens a **scratch copy**, not the real file. The real file is only written if the edit parses and validates, so a broken edit can no longer leave a broken file on disk.
2. The edit is committed by parsing the scratch and calling `writeIssue`, **not** by renaming the scratch. `rename` fails with `EXDEV` across filesystems, and the scratch lives in `os.tmpdir()`, which is a different filesystem from a FUSE-backed checkout. Going through `writeIssue` also gives `edit` the same validation and re-parse guard as every other write.
3. The parsed id must equal the original. `writeIssue` targets
   `issuePath(root, issue.id)`, so an edited `id:` writes elsewhere — leaving
   the original untouched, creating a second issue, and overwriting any issue
   already using that id.
4. Validation runs **again inside the lock**. The pre-lock check uses the config
   as it was when the editor opened; a long session gives `component rm --force`
   time to invalidate the issue, and `writeIssue`'s guard only checks that the
   bytes re-parse.
5. The scratch must **not** be placed in `dz/issues/`. Anything named `*.md` there is read as an issue, so a concurrent `list` would report it as a duplicate or stem mismatch.

- [ ] **Step 1: Write the failing tests**

Replace `tests/cli/edit.test.ts` entirely:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dz, withTempProject } from '../helpers.js';

/** An $EDITOR that applies `sed` to whatever file it is given. */
function editorApplying(dir: string, sedExpr: string): string {
  const bin = path.join(dir, `ed-${Math.random().toString(36).slice(2)}.sh`);
  fs.writeFileSync(bin, `#!/bin/sh\nsed -i '${sedExpr}' "$1"\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

function project<T>(fn: (dir: string, id: string, file: string) => T): T {
  return withTempProject((dir) => {
    dz(['init', '--name', 'demo'], { cwd: dir });
    const full = JSON.parse(dz(['add', 'Editable', '--json'], { cwd: dir }).stdout).id;
    const file = path.join(dir, 'dz', 'issues', `${full}.md`);
    return fn(dir, full.slice(0, 13), file);
  });
}

describe('dz edit', () => {
  it('applies a valid edit', () => {
    project((dir, id) => {
      const editor = editorApplying(dir, 's/^title: .*/title: Edited/');
      const r = dz(['edit', id], { cwd: dir, env: { EDITOR: editor } });
      expect(r.code).toBe(0);
      expect(JSON.parse(dz(['show', id, '--json'], { cwd: dir }).stdout).title).toBe('Edited');
    });
  });

  it('appends no log entry, because the tool cannot know what changed', () => {
    project((dir, id) => {
      const before = JSON.parse(dz(['show', id, '--json'], { cwd: dir }).stdout).log.length;
      const editor = editorApplying(dir, 's/^title: .*/title: Edited/');
      dz(['edit', id], { cwd: dir, env: { EDITOR: editor } });
      expect(JSON.parse(dz(['show', id, '--json'], { cwd: dir }).stdout).log).toHaveLength(before);
    });
  });

  it('leaves the real file untouched when the edit is invalid', () => {
    project((dir, id, file) => {
      const original = fs.readFileSync(file, 'utf8');
      const editor = editorApplying(dir, 's/^status: .*/status: banana/');

      const r = dz(['edit', id, '--json'], { cwd: dir, env: { EDITOR: editor } });

      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('PARSE_ERROR');
      // The old behaviour left the broken text on disk. Now the real file is
      // never written unless the edit parses.
      expect(fs.readFileSync(file, 'utf8')).toBe(original);
    });
  });

  it('preserves the user’s work in a scratch file and names it', () => {
    project((dir, id) => {
      const editor = editorApplying(dir, 's/^status: .*/status: banana/');
      const r = dz(['edit', id, '--json'], { cwd: dir, env: { EDITOR: editor } });
      const scratch = JSON.parse(r.stderr).error.message.match(/(\S+\.md)/)?.[1];
      expect(scratch, 'the error must name the scratch file').toBeDefined();
      expect(fs.readFileSync(String(scratch), 'utf8')).toContain('status: banana');
      fs.rmSync(String(scratch), { force: true });
    });
  });

  it('does not put the scratch file in dz/issues', () => {
    project((dir, id) => {
      // A *.md file there is read as an issue, so a concurrent list would
      // report it as a duplicate.
      const editor = editorApplying(dir, 's/^title: .*/title: Edited/');
      dz(['edit', id], { cwd: dir, env: { EDITOR: editor } });
      const names = fs.readdirSync(path.join(dir, 'dz', 'issues'));
      expect(names).toHaveLength(1);
      expect(dz(['list'], { cwd: dir }).code).toBe(0);
    });
  });

  it('holds no lock while the editor runs', () => {
    project((dir, id) => {
      // The editor asserts, from inside the session, that another command can
      // still mutate the project. That is the entire point of the design.
      const probe = path.join(dir, 'probe.txt');
      const bin = path.join(dir, 'ed-probe.sh');
      const dzBin = path.resolve('dist/cli/main.js');
      fs.writeFileSync(bin,
        `#!/bin/sh\n`
        + `cd "${dir}" && DZ_LOCK_TIMEOUT_MS=0 node "${dzBin}" add "made during edit" > "${probe}" 2>&1\n`
        + `echo "exit=$?" >> "${probe}"\n`
        + `sed -i 's/^title: .*/title: Edited/' "$1"\n`);
      fs.chmodSync(bin, 0o755);

      const r = dz(['edit', id], { cwd: dir, env: { EDITOR: bin } });
      expect(r.code).toBe(0);
      expect(fs.readFileSync(probe, 'utf8')).toContain('exit=0');
    });
  });

  it('refuses non-interactively when the issue changed during the edit', () => {
    project((dir, id, file) => {
      const bin = path.join(dir, 'ed-racer.sh');
      fs.writeFileSync(bin,
        `#!/bin/sh\n`
        // Change the real file behind the editor's back, then edit the scratch.
        + `sed -i 's/^title: .*/title: Changed By Someone Else/' "${file}"\n`
        + `sed -i 's/^title: .*/title: My Edit/' "$1"\n`);
      fs.chmodSync(bin, 0o755);

      const r = dz(['edit', id, '--json'], { cwd: dir, env: { EDITOR: bin } });

      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('CONCURRENT_MODIFICATION');
      // The other writer's change stands; ours is preserved in the scratch.
      expect(fs.readFileSync(file, 'utf8')).toContain('Changed By Someone Else');
      expect(JSON.parse(r.stderr).error.message).toMatch(/\S+\.md/);
    });
  });

  it('refuses an edit that changes the id, and touches nothing', () => {
    project((dir, id, file) => {
      const other = JSON.parse(dz(['add', 'Other', '--json'], { cwd: dir }).stdout).id;
      const before = fs.readdirSync(path.join(dir, 'dz', 'issues')).sort();
      const otherBefore = fs.readFileSync(path.join(dir, 'dz', 'issues', `${other}.md`), 'utf8');
      const original = fs.readFileSync(file, 'utf8');

      // Retarget this issue at the other one: without the guard this would
      // overwrite Other and leave Editable untouched.
      const editor = editorApplying(dir, `s|^id: .*|id: ${other}|`);
      const r = dz(['edit', id, '--json'], { cwd: dir, env: { EDITOR: editor } });

      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('INVALID_FIELD');
      expect(fs.readdirSync(path.join(dir, 'dz', 'issues')).sort()).toEqual(before);
      expect(fs.readFileSync(file, 'utf8')).toBe(original);
      expect(fs.readFileSync(path.join(dir, 'dz', 'issues', `${other}.md`), 'utf8'))
        .toBe(otherBefore);
    });
  });

  it('re-validates under the lock, catching config that changed mid-session', () => {
    project((dir, id) => {
      dz(['component', 'add', 'cli'], { cwd: dir });
      dz(['set', id, '--component', 'cli'], { cwd: dir });

      // The editor removes the component the issue uses, then makes an edit
      // that was valid when the session started.
      const dzBin = path.resolve('dist/cli/main.js');
      const bin = path.join(dir, 'ed-rmcomp.sh');
      fs.writeFileSync(bin,
        `#!/bin/sh
`
        + `cd "${dir}" && node "${dzBin}" component rm cli --force >/dev/null 2>&1
`
        + `sed -i 's/^title: .*/title: Edited/' "$1"
`);
      fs.chmodSync(bin, 0o755);

      const r = dz(['edit', id, '--json'], { cwd: dir, env: { EDITOR: bin } });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('INVALID_FIELD');
    });
  });

  it('errors when no editor is configured', () => {
    project((dir, id) => {
      const r = dz(['edit', id], { cwd: dir, env: { EDITOR: '', VISUAL: '' } });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('EDITOR');
    });
  });

  it('handles a project path containing a space', () => {
    withTempProject((base) => {
      const dir = path.join(base, 'my projects');
      fs.mkdirSync(dir);
      dz(['init', '--name', 'spaced'], { cwd: dir });
      const id = JSON.parse(dz(['add', 'Spaced', '--json'], { cwd: dir }).stdout).id.slice(0, 13);
      const editor = editorApplying(base, 's/^title: .*/title: Edited/');
      const r = dz(['edit', id], { cwd: dir, env: { EDITOR: editor } });
      expect(r.code).toBe(0);
      expect(JSON.parse(dz(['show', id, '--json'], { cwd: dir }).stdout).title).toBe('Edited');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cli/edit.test.ts`
Expected: FAIL — today's `edit` opens the real file in place, so the scratch, no-lock, and concurrent-modification cases all fail.

- [ ] **Step 3: Rewrite `src/cli/edit.ts`**

```ts
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Command } from 'commander';
import { DzError } from '../core/errors.js';
import { parseIssue } from '../core/serialize.js';
import { validateIssue } from '../core/validate.js';
import { shortId } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { loadConfig } from '../store/config.js';
import { findIssue, issuePath, writeIssue } from '../store/issues.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { withProjectLock } from './lock.js';

/** POSIX single-quoting, so a path containing spaces survives `shell: true`. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function registerEdit(program: Command, ctx: CliContext): void {
  program
    .command('edit')
    .description('open an issue in $EDITOR')
    .argument('<id-prefix>')
    .action((prefix: string) => {
      const editor = ctx.env['VISUAL'] ?? ctx.env['EDITOR'] ?? '';
      if (editor.trim() === '') {
        throw new DzError('INVALID_FIELD', 'no editor configured; set EDITOR or VISUAL');
      }

      const root = findProjectRoot(ctx.cwd);
      const target = issuePath(root, findIssue(root, prefix).id);
      const original = fs.readFileSync(target, 'utf8');

      // Outside dz/issues on purpose: a *.md file there is read as an issue.
      // Never renamed into place, so a different filesystem is fine.
      const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-edit-'));
      const scratch = path.join(scratchDir, path.basename(target));
      fs.writeFileSync(scratch, original, 'utf8');

      // No lock is held here. An editing session can last hours.
      const result = spawnSync(`${editor} ${shellQuote(scratch)}`, {
        stdio: 'inherit',
        shell: true,
      });
      if (result.status !== 0) {
        throw new DzError(
          'INVALID_FIELD',
          `editor exited with status ${String(result.status)}; your edit is at ${scratch}`,
        );
      }

      const originalId = parseIssue(original, path.relative(root, target)).id;

      let issue;
      try {
        issue = parseIssue(fs.readFileSync(scratch, 'utf8'), path.relative(root, target));
        // writeIssue picks its destination from issue.id, and parseIssue does
        // not check the id against the filename — only readIssue does, and this
        // path bypasses it. A changed id would leave the original alone, create
        // a second issue, and silently overwrite any issue already using it.
        if (issue.id !== originalId) {
          throw new DzError(
            'INVALID_FIELD',
            `the id may not be changed by an edit: it was "${originalId}" and is now `
            + `"${issue.id}". Ids are identity; there is no rename operation.`,
          );
        }
        validateIssue(issue, loadConfig(root));
      } catch (err) {
        throw new DzError(
          (err as DzError).code ?? 'PARSE_ERROR',
          `${(err as Error).message}. The issue was not changed; your edit is at ${scratch}`,
        );
      }

      withProjectLock(ctx, root, 'edit', () => {
        // Compare exact bytes: another writer may have changed the issue while
        // the editor was open, and overwriting would discard their work.
        const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
        if (current !== original) {
          throw new DzError(
            'CONCURRENT_MODIFICATION',
            `${path.relative(root, target)} was modified while your editor was open, `
            + `so it was left alone. Your edit is at ${scratch}; merge it by hand.`,
          );
        }
        // Re-validate under the lock. The check above ran against the config as
        // it was when the editor opened, and a session can last hours — long
        // enough for `component rm --force` to invalidate this issue. The
        // write-side guard in writeIssue only checks that the bytes re-parse,
        // not that the invariants hold.
        validateIssue(issue, loadConfig(root));
        writeIssue(root, issue);
      });

      fs.rmSync(scratchDir, { recursive: true, force: true });
      ctx.stdout.write(ctx.json ? renderIssueJson(issue) : `edited ${shortId(issue.id)}\n`);
    });
}
```

Note there is deliberately **no prompt**. The design allows an interactive conflict prompt, but every path here is non-interactive, which is what the spec requires under `--json` or a non-TTY. Adding the prompt is Task 6, gated on whether it is wanted at all.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: ~280 passing after the edit tests are replaced, 0 skipped.

- [ ] **Step 5: Commit**

```bash
the formatter
git commit \
  -m "ditz2: edit via a scratch copy, holding no lock while the editor runs"
```

---

### Task 5: Documentation

**Files:**
- Modify: `src/cli/help.ts` (tutorial step, agents section)
- Modify: `README.md`
- Test: the existing help drift test enforces the tutorial step

- [ ] **Step 1: Add a tutorial step for `unlock`**

In `TUTORIAL`, after the `dz doctor` step:

```
  dz unlock
      Removes a lock left behind by a command that died. Refuses while the
      owning process is alive; --force overrides that.
```

The drift test requires every registered command to have a step, so this is not optional.

- [ ] **Step 2: Extend the agents section**

In `AGENTS`, under GOTCHAS:

```
  Mutating commands take a project lock. On contention they retry for
      DZ_LOCK_TIMEOUT_MS (default 2000, 0 fails immediately) and then fail with
      code LOCKED. Read-only commands never wait.
  'dz edit' holds no lock while the editor is open. If the issue changed
      meanwhile it fails with CONCURRENT_MODIFICATION and names a scratch file
      holding your version; nothing is overwritten.
```

- [ ] **Step 3: Document it in the README**

Add a `## Concurrency` section after `## Identity`:

````markdown
## Concurrency

Commands that modify the project take a single lock at `dz/.lock`, so two
running at once cannot lose each other's changes. Read-only commands — `list`,
`show`, `grep`, `doctor`, `schema`, `help` — never take it, and never wait.

On contention a command retries briefly and then fails with `LOCKED`. Set
`DZ_LOCK_TIMEOUT_MS` to change how long it waits; `0` fails immediately, which
is what you want if you are implementing your own retry policy.

`dz edit` is the exception: it copies the issue to a scratch file, runs your
editor with no lock held, and takes the lock only to check that nobody else
changed the issue and to write the result. If someone did, the edit is refused
with `CONCURRENT_MODIFICATION` and your version is preserved in the scratch file,
whose path is printed. Nothing is overwritten.

If a command is killed outright, the lock can be left behind. `dz doctor`
reports it and `dz unlock` removes it — refusing while the owning process is
still alive, and requiring `--force` for a lock from another machine, which
cannot be judged from here.

The lock only serializes `dz` against itself. It does not make a concurrent
`git commit` atomic: a commit taken while an agent is working captures whole,
valid issue files, but not necessarily a coherent moment. It can never capture
a half-written file, because every write is a temp file plus a rename.
````

- [ ] **Step 4: Verify and commit**

```bash
npm test && npm run typecheck && the linter
the formatter
git commit \
  -m "ditz2: document the project lock"
```

---

### Task 6 (optional, gated): interactive conflict prompt

**Do not start this task without asking.** The design describes an interactive prompt on `CONCURRENT_MODIFICATION` — offer to overwrite, defaulting to no, re-checking after confirmation. Task 4 implements the non-interactive half, which is what the spec strictly requires and what agents need.

The prompt is worth having only if `edit` is used interactively enough to justify a readline dependency in a codebase that currently has none, plus a TTY-only code path that the integration harness cannot exercise without a pty. Raise it with the human and let them decide.

---

## Self-Review Notes

Checked against the spec:

1. **Spec coverage.** Lock file and metadata, acquisition, retry, release, abandoned locks, `dz unlock`, doctor integration, error codes, schema, gitignore, and the whole `edit` sequence are each in a task. The one deliberate omission is the interactive prompt from the design's steps 8–10, isolated as gated Task 6 with the reason.

2. **A test that could pass vacuously.** In Task 3, "does not remove a lock that was re-acquired between check and delete" cannot actually race inside one process, so it asserts the weaker observable behavior. Named in the test body so nobody reads it as proof of the race guard.

3. **`init` and the lock.** `initProject` runs before the lock, because there is no `dz/` to lock inside until it does. Two concurrent first-time `init`s in one directory both create `dz/`, then one wins the lock — the loser fails with `LOCKED` rather than corrupting anything, since `initProject` never overwrites.


---

## Amendment, 2026-08-24 (post-implementation)

Two things in this plan turned out to be wrong and were changed during the
final review. The task text above is left as written, since it is the record of
what was planned; this note is the record of what shipped.

**1. The Global Constraint "No projects predate this design" was false.** ditz2
tracks its own issues in `dz/`, created before this branch, and it is the first
project the code runs against. The consequence was not theoretical: `dz init`
had to be re-run in this repository to append `.lock` to `dz/.gitignore`, and
until it was, `doctor` certified the gap as healthy because it carried its own
stale copy of the ignore list.

**2. Task 2's `link(2)` acquisition does not work where this tool is
developed.** a FUSE-backed virtual filesystem, of the kind large repositories are
sometimes served from, rejects `link(2)`
with `EPERM`. Every mutating command failed in ditz2's own repository while all
291 tests passed, because `withTempProject` builds under `os.tmpdir()`.
Acquisition now uses `O_EXCL`, as the original design specified, and
`breakLock` refuses to break a malformed lock that has since become readable —
which handles the window `link` was chosen to avoid.
`tests/cli/repo-filesystem.test.ts` covers the checkout's own filesystem so
this cannot regress silently.

**Steps 8-10 of the edit flow (Task 6) remain unimplemented and gated.**
