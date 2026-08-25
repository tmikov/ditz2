/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'node:fs';
import { sleepSync } from '../core/sleep.js';

/** How long to wait before asking a not-yet-ready fd 0 again. */
const POLL_MS = 20;

/**
 * Reads fd 0 to EOF.
 *
 * `fs.readFileSync(0)` is not enough. Something in the process — commander, as
 * it happens — leaves fd 0 non-blocking, so a read issued before the producer
 * has written anything fails `EAGAIN` instead of waiting. That made
 * `slow-producer | dz comment <id> -m -` die with an internal error, while the
 * same command with a here-string worked, because the data was already there.
 * `EAGAIN` means "nothing yet", not "failed", so wait and ask again.
 */
function readStdin(): string {
  const chunks: Buffer[] = [];
  const buf = Buffer.alloc(64 * 1024);
  for (;;) {
    let read: number;
    try {
      read = fs.readSync(0, buf, 0, buf.length, null);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EAGAIN') {
        sleepSync(POLL_MS);
        continue;
      }
      // A terminal at end of input reports EOF as an error rather than 0.
      if (code === 'EOF') break;
      throw err;
    }
    if (read === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, read)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * One convention for free text across add, comment and close.
 * `-` means stdin; there is deliberately no separate --body flag.
 *
 * Callers must invoke this *before* taking the project lock. Reading stdin
 * blocks until the producer closes it, which is however long a pipeline or a
 * human takes, and a message body is not project state.
 */
export function readMessage(value: string | undefined): string {
  if (value === undefined) return '';
  const text = value === '-' ? readStdin() : value;
  // Trimmed whichever way it arrived. A here-doc almost always carries a
  // trailing newline the author did not mean, and treating the two spellings
  // of the same flag differently is a surprise nobody needs.
  return text.trim();
}
