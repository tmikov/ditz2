/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
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

/**
 * ANSI escapes carry cursor moves and colour; assertions want the text.
 *
 * The ESC byte is built with fromCharCode rather than written into a regex
 * literal: an editor tool can silently turn an escape-sequence spelled in
 * source text into the literal control byte, which then looks identical to
 * ordinary text on inspection.
 */
const ESC = String.fromCharCode(0x1b);
function strip(raw: string): string {
  return raw
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g'), '')
    .replace(new RegExp(`${ESC}[()][AB0]`, 'g'), '');
}

interface Run { text: string; raw: string; code: number; timedOut: boolean }

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
): Promise<Run> {
  return new Promise((resolve) => {
    const cmd = argv.map(shq).join(' ');
    const child = spawn('script', ['-qec', cmd, '/dev/null'], {
      cwd,
      env: {
        ...process.env,
        DZ_AUTHOR: 'Test User <test@example.com>',
        TERM: 'xterm-256color',
        COLUMNS: '100',
        LINES: '30',
        ...envOverrides,
      },
    });

    let out = '';
    let exited = false;
    let timedOut = false;
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
    child.stdin.on('error', () => { /* the child may have already exited */ });

    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 20_000);
    child.on('close', (code) => {
      exited = true;
      clearTimeout(timer);
      resolve({ text: strip(out), raw: out, code: code ?? 1, timedOut });
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

    void (async () => {
      // Whichever comes first: a frame to type into, or an exit before one
      // was ever drawn (the "refuses to open outside a project" case).
      await Promise.race([firstFrame, closed]);
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
        await new Promise((r) => { setTimeout(r, 40); });
      }
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
    const child = spawn('script', ['-qec', cmd, '/dev/null'], {
      cwd,
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
      resolve({ text: strip(out), raw: out, code: code ?? 1, timedOut });
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
});
