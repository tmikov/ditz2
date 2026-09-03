/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ptySpawn, shq } from '../../tests/pty.js';

/**
 * The built binaries, in a pty, against a project on disk.
 *
 * ink-testing-library renders to a string, which is exactly the environment
 * gap that hid the link(2) and global-crypto failures in this repository. Ink
 * needs a real terminal: it queries the tty for its size and puts stdin into
 * raw mode, neither of which a pipe supports. `script` allocates one, the same
 * technique tests/cli/edit-conflict.test.ts already uses.
 *
 * `ptySpawn` comes from the root package's test helpers rather than being
 * spelled again here: `script` takes a different command line on each of the
 * two platforms this suite runs on, and a second copy of that decision is the
 * bug CLAUDE.md's rule about checkers holding their own copy of a rule
 * describes.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const DZ = path.resolve(here, '..', '..', 'dist', 'cli', 'main.js');
const DZUI = path.resolve(here, '..', 'dist', 'main.js');

/**
 * ANSI escapes carry cursor moves and colour; assertions want the text.
 *
 * The ESC byte is built with fromCharCode rather than written into a regex
 * literal: an editor tool can silently turn an escape-sequence spelled in
 * source text into the literal control byte, which then looks identical to
 * ordinary text on inspection.
 */
const ESC = String.fromCharCode(0x1b);
/** Save, in the comment entry. Built the same way and for the same reason. */
const CTRL_S = String.fromCharCode(0x13);
/** Opens the form. Built with fromCharCode, like CTRL_S: see its comment. */
const TAB = String.fromCharCode(0x09);
/** What acquireLock's default timeout would cost, and the bound to stay under. */
const SECONDS_2 = 2000;
function strip(raw: string): string {
  return raw
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g'), '')
    .replace(new RegExp(`${ESC}[()][AB0]`, 'g'), '');
}

interface Run {
  text: string;
  raw: string;
  code: number;
  timedOut: boolean;
  /**
   * Milliseconds from `probe.key` reaching the pty to `probe.until` coming
   * back out of it, or null when no probe was asked for or the answer never
   * arrived. Never a whole-run figure — see `Probe`.
   */
  probeMs: number | null;
}

/**
 * Scopes an elapsed measurement to one keystroke and the answer it provokes.
 *
 * A bound on the whole run measures process startup, project setup and the pty
 * handshake as well, and here those dominate: the run this exists for costs
 * about 1.1 s of which the thing under test is roughly ten milliseconds. The
 * bound then has to be loose enough for the startup and is one loaded
 * loaded host away from failing for a reason that has nothing to do with the
 * claim — which is what happened. Measuring the key to its answer leaves the
 * startup out of the number entirely.
 *
 * **This adds no waiting.** `pty()` still resolves on the child's exit and is
 * still bounded by the same 20-second kill; the probe only timestamps two
 * events it happens to see on the way past. An answer that never comes leaves
 * `probeMs` null for the caller to assert on, rather than hanging the reader
 * on a marker.
 */
interface Probe {
  /** Starts the clock once written. Must appear exactly once in `input`. */
  key: string;
  /** Stops it the first time the stripped transcript contains this. */
  until: string;
}

/**
 * Types `input` into a pty running `argv`, one character at a time.
 *
 * Two things a naive single burst write gets wrong, both confirmed against a
 * real `script`-allocated pty on this machine rather than assumed:
 *
 * - Typing does not start until the child has actually rendered a first
 *   frame. Before Ink calls setRawMode, the pty is still in canonical mode,
 *   which buffers by line and delivers whatever accumulated as one blob the
 *   moment raw mode turns on — so keys sent before that point arrive
 *   scrambled together with keys sent after it.
 * - Once in raw mode, keys still have to land in separate reads. Ink's own
 *   parser (input-parser.js) treats an entire chunk with no ESC byte as a
 *   single pasted string, not as one event per character — so a burst write
 *   of e.g. "jjq" is delivered to `useInput` as the one string "jjq", which
 *   never equals the single-character `input === 'q'` the app checks for.
 *   ink-testing-library's own `press` helper (ui/tests/helpers.tsx) exists
 *   for exactly this reason: it writes one key and settles before the next.
 */
/**
 * `envOverrides` values of `undefined` delete that key from the child's env
 * (Node's own documented behaviour for `spawn`'s `env` option) rather than
 * setting it to the four-character string `"undefined"` — needed by the
 * no-winsize test below, which must make `script` see COLUMNS/LINES genuinely
 * absent, not merely empty.
 */
function pty(
  argv: string[],
  cwd: string,
  input: string,
  envOverrides: Record<string, string | undefined> = {},
  probe?: Probe,
): Promise<Run> {
  // An ambiguous key would start the clock on whichever occurrence came first
  // and the measurement would quietly be of something else. Refusing is the
  // only honest answer, and it is checked here rather than trusted at the call
  // site because the call site is where the mistake would be made.
  if (probe !== undefined && input.split(probe.key).length !== 2) {
    throw new Error(`the probe key must appear exactly once in the input, not ${
      input.split(probe.key).length - 1} times`);
  }
  return new Promise((resolve) => {
    const cmd = argv.map(shq).join(' ');
    const env = {
      ...process.env,
      DZ_AUTHOR: 'Test User <test@example.com>',
      TERM: 'xterm-256color',
      COLUMNS: '100',
      LINES: '30',
      ...envOverrides,
    };
    // COLUMNS/LINES are what util-linux sizes the pty from; ptySpawn needs
    // them separately because BSD script ignores them and has to be told with
    // stty instead. Passing the merged values keeps the two in step, including
    // when an override deletes them.
    const { file, args } = ptySpawn(cmd, { cols: env.COLUMNS, rows: env.LINES });
    const child = spawn(file, args, { cwd, env });

    let out = '';
    let exited = false;
    let timedOut = false;
    // Set when the probe's key is written, and read again when its answer is
    // seen. Both stay null when no probe was asked for.
    let probeStarted: number | null = null;
    let probeMs: number | null = null;
    const absorb = (d: Buffer): void => {
      out += d.toString();
      // Only between the key and its answer, so the repeated strip costs
      // nothing on the long runs: before the key there is nothing to time, and
      // after the answer the number is already taken. Checked against the
      // whole accumulated transcript rather than this chunk, since a marker
      // split across two reads would otherwise never be seen; the timestamp is
      // then of the read that completed it, which errs late.
      if (probe === undefined || probeStarted === null || probeMs !== null) return;
      if (strip(out).includes(probe.until)) probeMs = Date.now() - probeStarted;
    };
    child.stdout.on('data', absorb);
    child.stderr.on('data', absorb);
    child.stdin.on('error', () => { /* the child may have already exited */ });

    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 20_000);
    child.on('close', (code) => {
      exited = true;
      clearTimeout(timer);
      resolve({ text: strip(out), raw: out, code: code ?? 1, timedOut, probeMs });
    });

    // Not the first byte of output: entering the alternate screen buffer now
    // writes one of those before Ink ever attaches, so a plain "first data
    // event" heuristic fires on that instead of on a real frame — while the
    // pty is still in canonical mode, which loses whatever gets typed in the
    // gap. Ink wraps every actual frame in a synchronized-update sequence, so
    // wait for that specifically.
    let preFrame = '';
    const firstFrame = new Promise<void>((r) => {
      const onData = (d: Buffer): void => {
        preFrame += d.toString();
        if (preFrame.includes(`${ESC}[?2026h`)) {
          child.stdout.off('data', onData);
          r();
        }
      };
      child.stdout.on('data', onData);
    });
    const closed = new Promise<void>((r) => { child.once('close', () => r()); });
    // A command that dies before drawing cannot be waited for: on darwin the
    // `cat` in ptySpawn is still holding the pipeline open, so `closed` cannot
    // fire until this function stops typing and closes stdin. Giving up on the
    // frame after a bounded wait is what breaks that cycle. It is not a race
    // against a slow first frame — a live UI draws one in well under this, and
    // the only cost of the bound elapsing is that the run had already failed.
    const NO_FRAME_MS = 2000;
    const noFrame = new Promise<void>((r) => { setTimeout(r, NO_FRAME_MS); });

    void (async () => {
      // Whichever comes first: a frame to type into, or an exit before one
      // was ever drawn (the "refuses to open outside a project" case).
      await Promise.race([firstFrame, closed, noFrame]);
      if (!exited) {
        // The synchronized-update marker means Ink has written a frame, not
        // that raw mode is active yet: Ink enables it from an effect that
        // commits after that write, not synchronously with it. A key sent in
        // that gap can still hit the tty while ISIG is enabled — harmless for
        // an ordinary character, which is merely lost, but fatal for Ctrl-C,
        // which the kernel then delivers as a real SIGINT with no handler
        // installed, killing the process before any of it, including Ink's
        // own cleanup, runs. Confirmed with a standalone pty script: identical
        // input reaches Ink every time once this settle gap is added, and
        // fails intermittently without it.
        await new Promise((r) => { setTimeout(r, 150); });
      }
      for (const ch of input) {
        if (exited) break;
        try {
          child.stdin.write(ch);
        } catch {
          break;
        }
        // After the write, not before: the clock is meant to start when the
        // key has been handed to the pty. Anything earlier would be timing
        // this loop as well.
        if (probe !== undefined && ch === probe.key) probeStarted = Date.now();
        await new Promise((r) => { setTimeout(r, 40); });
      }
      // Required on darwin, harmless elsewhere: nothing more will be typed, so
      // release the `cat` feeding the pty and let the pipeline finish. `script`
      // itself survives its stdin closing, so this does not cut the run short.
      try { child.stdin.end(); } catch { /* already gone */ }
    })();
  });
}

/**
 * The direct child of `pid` with no children of its own.
 *
 * `script -qec` runs the command through a shell, so the process actually
 * running Ink is a descendant of `script`'s own pid, not `script` itself.
 * Walking down with `pgrep -P` finds it regardless of how many shell layers
 * sit in between. Matching on the command line instead (`pgrep -f`) was
 * tried first and rejected: the pattern also matches this test's own Node
 * process, which killed the test runner rather than the child under test.
 */
function findLeafPid(pid: number): number {
  let current = pid;
  for (;;) {
    const r = spawnSync('pgrep', ['-P', String(current)], { encoding: 'utf8' });
    // spawnSync gives stdout: null on ENOENT rather than throwing; calling
    // .trim() on that would throw inside this un-awaited async callback,
    // surfacing as an unhandled rejection and a 20s timeout instead of a
    // clear failure. requirePgrep() is meant to catch the missing-binary case
    // up front, but this stays defensive regardless.
    const children = (r.stdout ?? '').trim().split('\n').filter(Boolean).map(Number);
    if (children.length === 0) return current;
    [current] = children;
  }
}

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

/**
 * Like `pty()`, but delivers `signal` to the running process instead of
 * typing, once a frame — and, after the same settle gap `pty()` waits before
 * its first keystroke, the signal handlers a mount effect installs — should
 * both be in place.
 */
function ptyKilled(argv: string[], cwd: string, signal: NodeJS.Signals): Promise<Run> {
  return new Promise((resolve) => {
    const cmd = argv.map(shq).join(' ');
    // Nothing is ever typed here, so the pty takes its input from /dev/null.
    // That also keeps the process tree single-file, which findLeafPid needs.
    const { file, args } = ptySpawn(cmd, { cols: '100', rows: '30', noStdin: true });
    const child = spawn(file, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        DZ_AUTHOR: 'Test User <test@example.com>',
        TERM: 'xterm-256color',
        COLUMNS: '100',
        LINES: '30',
      },
    });

    let out = '';
    let timedOut = false;
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { out += d.toString(); });

    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 20_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      // Nothing is typed here, so there is no keystroke to time from.
      resolve({ text: strip(out), raw: out, code: code ?? 1, timedOut, probeMs: null });
    });

    let preFrame = '';
    const firstFrame = new Promise<void>((r) => {
      const onData = (d: Buffer): void => {
        preFrame += d.toString();
        if (preFrame.includes(`${ESC}[?2026h`)) {
          child.stdout.off('data', onData);
          r();
        }
      };
      child.stdout.on('data', onData);
    });

    void (async () => {
      await firstFrame;
      await new Promise((r) => { setTimeout(r, 150); });
      if (child.pid === undefined) return;
      process.kill(findLeafPid(child.pid), signal);
    })();
  });
}

/**
 * `fn` is awaited before the temp directory is removed — the pty test it
 * runs is asynchronous, and a `finally` that does not wait for it would
 * delete the project out from under a still-running `dzui`.
 */
async function project<T>(fn: (dir: string, closedId: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-ui-e2e-'));
  try {
    const run = (args: string[]): string => {
      const r = spawnSync(process.execPath, [DZ, ...args], {
        cwd: dir, encoding: 'utf8',
        env: { ...process.env, DZ_AUTHOR: 'Test User <test@example.com>' },
      });
      if (r.status !== 0) throw new Error(`dz ${args.join(' ')} failed: ${r.stderr}`);
      return r.stdout;
    };
    run(['init', '--name', 'bench']);
    run(['component', 'add', 'cli']);
    run(['add', 'sqlite cache for list and grep', '--type', 'feature']);
    run(['add', 'a bug about tokenizers', '--type', 'bug', '--component', 'cli']);
    const closedOut = run(['add', 'an issue nobody needs anymore', '--type', 'task', '--json']);
    const closedId = (JSON.parse(closedOut) as { id: string }).id;
    run(['close', closedId, '--as', 'wontfix']);
    return await fn(dir, closedId);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The fixture, built on the checkout's own filesystem rather than in
 * os.tmpdir().
 *
 * On an ordinary clone this is the same filesystem and adds nothing. On the
 * virtual filesystem this project is also developed on it is not, and that
 * one rejected the lock's link(2) with EPERM while the whole suite passed —
 * and plan 2b's evidence that the UI writes correctly here is a paragraph
 * in HANDOFF.md describing something a person
 * did by hand, backed by no check. This is the check.
 *
 * `--nested`, because the repository is a dz project and without it every
 * command resolves upward and operates on ditz2's own tracker.
 *
 * A SUBDIRECTORY of `.dz-fstest`, and the cleanup below removes only that
 * subdirectory. `tests/cli/repo-filesystem.test.ts` owns `.dz-fstest` itself
 * and clears it wholesale; two files racing to delete each other's tree is a
 * flake waiting for the day somebody runs the two suites at once.
 *
 * **That de-confliction is one-directional, and from here it can only be.**
 * This file stays out of the other's way; the other still removes the whole
 * tree, this subdirectory included, and would take a live run down with it.
 * The two suites are separate `vitest` invocations under `npm run test:all`
 * and so do not overlap today, but nothing enforces that. Closing it properly
 * means narrowing what the root test owns, which is not this file's to decide.
 */
const CHECKOUT_SCRATCH = path.resolve(here, '..', '..', '.dz-fstest', 'ui-form');

afterAll(() => { fs.rmSync(CHECKOUT_SCRATCH, { recursive: true, force: true }); });

/**
 * `project()`'s fixture, on the checkout instead of in os.tmpdir().
 *
 * Deliberately smaller than `project()`: this exists to exercise the
 * filesystem, not the list, so it builds the one open issue the form test
 * needs and nothing else.
 */
async function inCheckout<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  fs.mkdirSync(CHECKOUT_SCRATCH, { recursive: true });
  const dir = fs.mkdtempSync(path.join(CHECKOUT_SCRATCH, 'run-'));
  try {
    dz(dir, ['init', '--name', 'onrepo', '--nested']);
    dz(dir, ['add', 'written on the checkout filesystem', '--type', 'task']);
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * `dz` itself, used to read back what the UI claims to have written.
 *
 * Deliberately a second process rather than a call into the facade: the frame
 * only ever proves what the UI believes, and an in-process read could share a
 * cache or a mock with the thing under test. This reads the files.
 */
function dz(dir: string, args: string[]): string {
  const r = spawnSync(process.execPath, [DZ, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, DZ_AUTHOR: 'Test User <test@example.com>' },
  });
  if (r.status !== 0) throw new Error(`dz ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function dzShow(dir: string, id: string): string {
  return dz(dir, ['show', id]);
}

/**
 * `dz show --json`, for the assertions that are about the log.
 *
 * The plain-text `show` renders the log too, but counting entries in it means
 * counting lines, and a form that wrote four no-op changes would leave text a
 * substring assertion is happy with. The JSON carries the entries as entries.
 */
function dzShowJson(dir: string, id: string): { title: string; log: { verb: string }[] } {
  return JSON.parse(dz(dir, ['show', id, '--json'])) as
    { title: string; log: { verb: string }[] };
}

/**
 * `dz list --json`, never the table.
 *
 * The table prints `shortId`, so "the full id is absent from `dz list`" is true
 * of an issue sitting plainly in it — an assertion that cannot fail — and the
 * matching positive assertion against `--all` would fail on a correct close.
 * The JSON carries whole ids, so both halves mean what they say.
 */
function dzList(dir: string, ...args: string[]): string {
  return dz(dir, ['list', '--json', ...args]);
}

/**
 * The issue the UI has selected the moment it opens.
 *
 * The same list, in the same order, from the same code: the UI loads with
 * `all: true` and then applies the default filter, which hides closed issues
 * and preserves order, and `loadAllIssues` sorts by id. So the first row of
 * `dz list` is the first row of the list screen.
 */
function firstIssueId(dir: string): string {
  const issues = JSON.parse(dzList(dir)) as { id: string }[];
  const first = issues[0];
  if (first === undefined) throw new Error('the fixture project has no open issues');
  return first.id;
}

/**
 * Removes the identity `dz init` stored, for the "no author configured" test.
 *
 * Unsetting `DZ_AUTHOR` alone is not enough and the difference is invisible on
 * a machine with no VCS identity: `dz init` probes `git config user.name` and
 * `sl config ui.username`, both of which read the user's *global* configuration
 * and answer even in a fresh temp directory outside any repository. On this
 * development host they do, so `project()` leaves every fixture with a usable
 * `dz/config.local.yaml` and the write would quietly succeed.
 *
 * `force`, not an existence check: a machine where neither VCS answers writes
 * no such file, and the postcondition this establishes — that the project has
 * no identity of its own — is already true there.
 */
function forgetIdentity(dir: string): void {
  fs.rmSync(path.join(dir, 'dz', 'config.local.yaml'), { force: true });
}

/**
 * Takes the project lock from outside the UI, and returns the release.
 *
 * The pid has to name a process that is genuinely running: lockState calls a
 * dead one abandoned rather than active, and the message the UI shows would
 * then describe a corpse. `process.pid` is alive by definition.
 */
function holdLock(dir: string): () => void {
  const file = path.join(dir, 'dz', '.lock');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    token: '0f2c4e1a-0000-4000-8000-00000000dead',
    pid: process.pid,
    hostname: os.hostname(),
    created: new Date().toISOString(),
    command: 'dz comment',
  }, null, 2), { mode: 0o600 });
  return () => { fs.rmSync(file, { force: true }); };
}

describe('the UI in a real terminal', () => {
  it('draws the backlog and quits on q', async () => {
    await project(async (dir) => {
      const r = await pty([process.execPath, DZUI], dir, 'q');
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(0);
      expect(r.text).toContain('bench');
      expect(r.text).toContain('sqlite cache for list and grep');
      expect(r.text).toContain('a bug about tokenizers');
    });
  });

  it('is reachable through dz ui', async () => {
    await project(async (dir) => {
      const r = await pty([process.execPath, DZ, 'ui'], dir, 'q');
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(0);
      expect(r.text).toContain('sqlite cache for list and grep');
    });
  });

  it('filters what it drew', async () => {
    await project(async (dir) => {
      const r = await pty([process.execPath, DZUI], dir, '/tokeni\rq');
      expect(r.timedOut).toBe(false);
      // The last frame is what the operator is left looking at.
      const final = r.text.slice(r.text.lastIndexOf('bench'));
      expect(final).toContain('a bug about tokenizers');
      expect(final).not.toContain('sqlite cache');
    });
  });

  it('draws something on a terminal that reports no size at all', async () => {
    // Every other test here sets COLUMNS and LINES, so none of them can catch
    // this: a pty with no winsize reports 0, Ink measures its root container
    // straight from process.stdout, and the frame comes out empty while the
    // process sits there looking hung.
    await project(async (dir) => {
      const r = await pty([process.execPath, DZUI], dir, 'q', { COLUMNS: undefined, LINES: undefined });
      expect(r.timedOut).toBe(false);
      expect(r.text).toContain('sqlite cache for list and grep');
    });
  });

  it('loads closed issues into the snapshot, revealed by all:true', async () => {
    await project(async (dir) => {
      const r = await pty([process.execPath, DZUI], dir, '/all:true\rq');
      expect(r.timedOut).toBe(false);
      const final = r.text.slice(r.text.lastIndexOf('bench'));
      expect(final).toContain('an issue nobody needs anymore');
    });
  });

  it('refuses to open outside a project, with the same error dz uses', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-ui-none-'));
    try {
      const r = await pty([process.execPath, DZUI], dir, 'q');
      expect(r.code).toBe(1);
      expect(r.text).toContain('no dz/config.yaml');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes the whole screen and gives it back', async () => {
    await project(async (dir) => {
      const r = await pty([process.execPath, DZUI], dir, 'q');
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

  it('gives the screen back when it fails to open a project', async () => {
    // The error path is the one that strands a terminal: the UI never mounts,
    // so an exit handler that only runs after a successful render restores
    // nothing and the operator is left staring at a blank alternate buffer.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-ui-none-'));
    try {
      const r = await pty([process.execPath, DZUI], dir, 'q');
      expect(r.code).toBe(1);
      expect(r.raw).toContain(`${ESC}[?1049l`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a contended write immediately instead of freezing', async () => {
    // The whole reason runUi passes lockTimeoutMs: 0. With the default 2000ms
    // the facade blocks synchronously inside acquireLock, and Ink cannot
    // repaint, read a key, or service Ctrl-C for the duration — so the symptom
    // is not a slow UI, it is a dead one. Measured rather than asserted
    // structurally: hold the lock from outside and write a comment.
    //
    // The measurement is scoped to Ctrl-S → the first byte of the waiting
    // overlay, and deliberately not to the run. A whole-run bound was tried
    // and went intermittent: about 1.1 s of a 1.13 s run is process startup and
    // four keystrokes, so the bound was mostly measuring the host. The
    // scoped number is roughly ten milliseconds against the same bound, and it
    // is the refusal and one repaint and nothing else.
    //
    // The bound stays 2000 and must. It is what acquireLock's default timeout
    // costs, so the discrimination is structural rather than a margin:
    // `acquireLock` sets `deadline = Date.now() + 2000` and only throws once
    // `Date.now() >= deadline`, so with the default in force this measurement
    // cannot come in under 2000 however fast the machine is. Raising the bound
    // past 2000 would throw that away and the test would pass with the freeze
    // it exists to catch.
    await project(async (dir) => {
      const release = holdLock(dir);
      try {
        // c opens the entry, x is the comment, ^S writes it; the first q gives
        // up on the wait and the second quits. Ctrl-S is not the last key, so
        // the end of input — which BSD `script` marks by pushing an EOT into
        // the pty — cannot arrive ahead of the answer being timed.
        const r = await pty([process.execPath, DZUI], dir, `cx${CTRL_S}qq`, {}, {
          key: CTRL_S,
          until: 'waiting for the lock',
        });
        const { probeMs } = r;
        expect(r.text).toContain('waiting for the lock');
        expect(r.text).toContain(`pid ${process.pid}`);
        // Named separately from the bound below so that "the overlay never
        // came" cannot be read as "the refusal was slow"; `?? Infinity` keeps
        // the bound meaningful either way rather than passing on a null.
        expect(probeMs).not.toBeNull();
        expect(probeMs ?? Infinity).toBeLessThan(SECONDS_2);
        expect(r.timedOut).toBe(false);
        expect(r.code).toBe(0);
      } finally {
        release();
      }
    });
  });

  it('writes a comment that dz show can read back', async () => {
    // The assertion is on the FILE, not the frame. A frame that says the
    // comment was written proves the UI believes it; only the file proves it.
    await project(async (dir) => {
      const r = await pty([process.execPath, DZUI], dir, `chello${CTRL_S}q`);
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(0);
      expect(dzShow(dir, firstIssueId(dir))).toContain('hello');
    });
  });

  it('closes an issue that dz list --all can still find', async () => {
    await project(async (dir) => {
      const id = firstIssueId(dir);
      const r = await pty([process.execPath, DZUI], dir, `x${CTRL_S}q`);
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(0);
      // Absent from the default list, present with --all: that pair is what
      // "closed" means, and asserting only the first would also pass if the
      // file had been deleted.
      expect(dzList(dir)).not.toContain(id);
      expect(dzList(dir, '--all')).toContain(id);
      // The picker opens on RESOLUTIONS[0], so ^S with nothing else typed is
      // "closed as fixed", and the resolution is part of what was written.
      expect(dzShow(dir, id)).toContain('closed');
      expect(dzShow(dir, id)).toContain('fixed');
    });
  });

  it('says what is wrong when no author is configured, and writes nothing', async () => {
    // whoami() returns null for both "unset" and "malformed", so the UI cannot
    // distinguish them and does not try. resolveAuthor raises the real message
    // inside the facade on the write, which is the one place that knows which
    // case it is. Assert the operator sees it.
    await project(async (dir) => {
      forgetIdentity(dir);
      const r = await pty([process.execPath, DZUI], dir, `chi${CTRL_S}q`, { DZ_AUTHOR: undefined });
      expect(r.timedOut).toBe(false);
      // Load bearing, not bookkeeping. pty() merges the child's stderr into the
      // transcript, so "the message appears in r.text" is also true of a UI
      // that DIED printing the facade's error to stderr — which is the exact
      // failure this test exists to forbid. Exiting 0 on the q afterwards is
      // what distinguishes "the operator was shown it" from "it was printed on
      // the way down". Measured: with runMutation rethrowing instead of
      // dispatching mutationFailed, this test passes without this line.
      expect(r.code).toBe(0);
      expect(r.text).toContain('DZ_AUTHOR');
      const shown = dzShow(dir, firstIssueId(dir));
      expect(shown).not.toContain('hi');
      // The text is the weaker half: `comment` is the log verb a written one
      // would carry, and it is absent from every field of an untouched issue.
      expect(shown).not.toContain('comment');
    });
  });

  it('says what is wrong when the author is malformed, and writes nothing', async () => {
    // A DZ_AUTHOR containing a double space breaks the log grammar, which uses
    // it as a field separator. The facade refuses; the UI must relay it.
    await project(async (dir) => {
      const r = await pty([process.execPath, DZUI], dir, `chi${CTRL_S}q`, {
        DZ_AUTHOR: 'Jane  Roe <jane@example.com>',
      });
      expect(r.timedOut).toBe(false);
      // For the reason spelled out in the test above: a UI that crashed with
      // this message on stderr would satisfy the assertion below on its own.
      expect(r.code).toBe(0);
      expect(r.text).toContain('double space');
      const shown = dzShow(dir, firstIssueId(dir));
      expect(shown).not.toContain('hi');
      expect(shown).not.toContain('comment');
    });
  });

  it('renames an issue, and dz show reads the new title back', async () => {
    await project(async (dir) => {
      const id = firstIssueId(dir);
      // Tab opens the form on the title field with the cursor at the end, so
      // typing appends. `q` after the save leaves the UI.
      const r = await pty([process.execPath, DZUI], dir, `${TAB} again${CTRL_S}q`);
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(0);
      expect(dzShowJson(dir, id).title).toContain(' again');
    });
  });

  it('writes one log entry for a one-field change, not five', async () => {
    // The payoff of sending a diff. `set` appends an entry for every field it
    // is given, changed or not — measured — so a form that sent all five
    // would leave four entries here saying `bug -> bug`. Asserting on the log
    // rather than on the title is what makes that visible: the title is
    // correct either way.
    await project(async (dir) => {
      const id = firstIssueId(dir);
      const before = dzShowJson(dir, id).log.length;
      const r = await pty([process.execPath, DZUI], dir, `${TAB} again${CTRL_S}q`);
      expect(r.timedOut).toBe(false);
      // Not bookkeeping, and the same reason the author tests above give: a UI
      // that wrote the entry and then died would leave the log correct and the
      // count right, so the log assertions alone cannot see it.
      expect(r.code).toBe(0);
      const { log } = dzShowJson(dir, id);
      expect(log.length - before).toBe(1);
      expect(log.at(-1)?.verb).toBe('title');
    });
  });

  it('creates an issue that dz list can find', async () => {
    await project(async (dir) => {
      const r = await pty([process.execPath, DZUI], dir, `nshiny${CTRL_S}q`);
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(0);
      const issues = JSON.parse(dzList(dir)) as
        { title: string; type: string; component: string | null }[];
      const created = issues.find((i) => i.title === 'shiny');
      expect(created).toBeDefined();
      // The default both front-ends now read from one constant.
      expect(created?.type).toBe('task');
      expect(created?.component).toBeNull();
    });
  });

  it('says what is wrong about an empty title, and creates nothing', async () => {
    // The UI holds no copy of this rule; createIssue raises it. This is the
    // check that the operator sees the facade's own words.
    await project(async (dir) => {
      const before = (JSON.parse(dzList(dir)) as unknown[]).length;
      // The trailing `q` is not tidiness. pty() merges the child's stderr into
      // the transcript, so the message assertion below is equally true of a UI
      // that DIED printing the facade's error — the same trap the two author
      // tests above document. Quitting cleanly afterwards, with code 0, is
      // what distinguishes being shown it from it being printed on the way
      // down. It also saves the twenty seconds a run with no `q` spends
      // waiting for the harness to kill it.
      const r = await pty([process.execPath, DZUI], dir, `n${CTRL_S}q`);
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(0);
      expect(r.text).toContain('title cannot be empty');
      expect((JSON.parse(dzList(dir)) as unknown[]).length).toBe(before);
    });
  });

  it('saves the form on the filesystem the repository itself lives on', async () => {
    await inCheckout(async (dir) => {
      const id = firstIssueId(dir);
      const r = await pty([process.execPath, DZUI], dir, `${TAB} again${CTRL_S}q`);
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(0);
      expect(dzShowJson(dir, id).title).toContain(' again');
    });
  });
});
