/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { acquireLock, releaseLock } from '../store/lock.js';
import type { Env } from '../core/types.js';

/**
 * Everything an operation needs that is not its own arguments.
 *
 * Deliberately does not carry an output stream. Rendering belongs to the
 * caller, which is what lets the CLI and a UI share these operations.
 */
export interface Session {
  readonly root: string;
  /** Used for author resolution: DZ_AUTHOR and the VCS probe. */
  readonly env: Env;
  /**
   * Overrides DZ_LOCK_TIMEOUT_MS. `0` fails immediately instead of sleeping,
   * which is what a caller implementing its own retry policy sets — a UI
   * cannot afford a synchronous 2s sleep, because it blocks repaint, input
   * and Ctrl-C.
   */
  readonly lockTimeoutMs?: number;
}

/** The env `acquireLock` should see, with any override applied. */
function lockEnv(s: Session): Env {
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
