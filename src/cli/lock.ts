/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

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
