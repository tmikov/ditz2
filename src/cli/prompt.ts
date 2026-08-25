/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'node:fs';
import { sleepSync } from '../core/sleep.js';
import type { CliContext } from './context.js';

/** How long to wait before asking a not-yet-ready fd 0 again. */
const POLL_MS = 20;

/**
 * True when it is reasonable to ask the operator a question.
 *
 * Both halves matter. Without a tty there may be nobody to answer, and a read
 * would either block until the pipe closes or swallow data meant for something
 * else. Under `--json` the whole point is that stdout and stderr are
 * machine-readable, and a prompt turns the run into a hang.
 */
export function canPrompt(ctx: CliContext): boolean {
  return !ctx.json && process.stdin.isTTY === true;
}

/**
 * Reads one line from fd 0, or null at end of input.
 *
 * A byte at a time, which is fine at human typing speed and avoids reading
 * past the newline into whatever the next command wants. The `EAGAIN` handling
 * is not optional: commander leaves fd 0 non-blocking, so a read issued before
 * the operator has typed anything fails rather than waiting.
 */
export function readLineSync(): string | null {
  const bytes: number[] = [];
  const buf = Buffer.alloc(1);
  for (;;) {
    let read: number;
    try {
      read = fs.readSync(0, buf, 0, 1, null);
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
    if (buf[0] === 0x0a) return Buffer.from(bytes).toString('utf8');
    bytes.push(buf[0] as number);
  }
  return bytes.length === 0 ? null : Buffer.from(bytes).toString('utf8');
}

export interface Choice<T> {
  /** The letter the operator types. Compared case-insensitively. */
  key: string;
  label: string;
  value: T;
}

/**
 * Asks a single-letter question on stderr and returns the chosen value.
 *
 * Returns null at end of input — Ctrl-D is a refusal to answer, and the caller
 * treats it the same as choosing the safest option. Unrecognised input asks
 * again rather than guessing.
 *
 * stderr, not stdout, because stdout carries the command's result. A line
 * rather than a raw single keypress: raw mode would need `setRawMode` on the
 * tty and interacts badly with synchronous reads, and pressing Enter is a
 * small price for not having to manage terminal state.
 */
export function choose<T>(ctx: CliContext, question: string, choices: Choice<T>[]): T | null {
  const menu = choices.map((c) => `${c.key})${c.label}`).join(', ');
  for (;;) {
    ctx.stderr.write(`${question}\n${menu}: `);
    const answer = readLineSync();
    if (answer === null) {
      ctx.stderr.write('\n');
      return null;
    }
    const typed = answer.trim().slice(0, 1).toLowerCase();
    const match = choices.find((c) => c.key.toLowerCase() === typed);
    if (match !== undefined) return match.value;
    ctx.stderr.write(
      `"${answer.trim()}" is not one of ${choices.map((c) => c.key).join(', ')}.\n`,
    );
  }
}
