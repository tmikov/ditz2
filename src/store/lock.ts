/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isIsoTimestamp } from '../core/clock.js';
import { DzError } from '../core/errors.js';
import { sleepSync } from '../core/sleep.js';
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
  // Values, not just types. Every field here feeds a decision: `pid` reaches
  // process.kill, where a negative number addresses a whole process group
  // rather than one process; `created` reaches Date.parse, which yields NaN and
  // printed "NaNs ago"; an unrecognised `version` means a future dz wrote this
  // and its rules are unknown. Anything that fails is malformed, which `unlock`
  // will not remove without --force -- the right answer for a lock we cannot
  // reason about.
  try {
    const parsed = JSON.parse(raw) as Partial<LockInfo>;
    const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
    if (
      parsed.version !== LOCK_VERSION
      || !nonEmpty(parsed.token)
      || !nonEmpty(parsed.hostname)
      || !nonEmpty(parsed.command)
      || !nonEmpty(parsed.created)
      || !Number.isInteger(parsed.pid)
      || (parsed.pid as number) <= 0
      || !isIsoTimestamp(parsed.created)
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
    // O_EXCL is what makes this mutual exclusion: the create either wins or
    // fails EEXIST. The payload is written immediately afterwards, so there is
    // a brief window in which a reader can catch the file empty and call it
    // malformed; `breakLock` refuses to remove a malformed lock that has since
    // become readable, which is what that window produces.
    //
    // Publishing the file already-complete via link(2) would remove the window
    // entirely, and an earlier version did exactly that. It cannot be used:
    // EdenFS, the virtual filesystem some large monorepos are served from,
    // rejects link(2) with EPERM, so every mutating command failed inside such
    // a checkout. O_EXCL, mkdir and rename all work there; link alone
    // does not.
    let fd: number;
    try {
      fd = fs.openSync(file, 'wx', 0o600);
    } catch (err) {
      const failure = err as NodeJS.ErrnoException;
      if (failure.code !== 'EEXIST') throw failure;

      if (Date.now() >= deadline) {
        const held = readLockInfo(root);
        const who = held === null ? 'held by an unreadable lock file' : describe(held);
        throw new DzError(
          'LOCKED',
          `another dz command is modifying this project: ${who}. `
          + `Waited ${timeoutMs(env)}ms. Raise DZ_LOCK_TIMEOUT_MS to wait longer, `
          + `or run 'dz unlock' if you believe it was abandoned.`,
        );
      }
      sleepSync(Math.min(RETRY_INTERVAL_MS, Math.max(1, deadline - Date.now())));
      continue;
    }

    try {
      fs.writeSync(fd, JSON.stringify(info, null, 2));
    } catch (err) {
      // We own the file but could not fill it. Leaving it would strand the
      // project behind a lock with no owner recorded in it.
      fs.rmSync(file, { force: true });
      throw err;
    } finally {
      fs.closeSync(fd);
    }
    return { token: info.token, path: file };
  }
}

/**
 * Removes a lock this process does not hold, for `dz unlock`.
 *
 * `expectedToken` is the token `lockState` saw, or `null` when the metadata was
 * too malformed to have one. Returns false without touching anything if the
 * lock changed hands in between.
 *
 * The re-read narrows that window; it cannot close it. A single pathname offers
 * no atomic compare-and-delete, so a lock acquired between the check and the
 * unlink is still removed unexamined. That is why `unlock` is an administrative
 * command, to be run when nothing else is mutating the project.
 */
export function breakLock(root: string, expectedToken: string | null): boolean {
  const now = readLockInfo(root);

  // Both branches require the re-read to produce exactly what the caller
  // diagnosed. Anything else means the lock changed under us, and the reason
  // it changed does not matter: unreadable is not "close enough" to either
  // case. An earlier version accepted an unreadable re-read when a token was
  // expected, which deleted a live lock whenever the holder was replaced by a
  // new one caught between its create and its write.
  if (expectedToken === null) {
    // A malformed lock that now parses was an in-flight acquisition, not a
    // corpse, and removing it would release a lock belonging to someone else.
    if (now !== null) return false;
  } else if (now === null || now.token !== expectedToken) {
    return false;
  }

  fs.rmSync(lockPath(root), { force: true });
  return true;
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
