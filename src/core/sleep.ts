/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A synchronous sleep. The CLI is synchronous end to end, so an async wait
 * would mean threading promises through every command for one pause.
 *
 * `Atomics.wait` on a throwaway SharedArrayBuffer is the only way to block the
 * main thread without spinning: the wait can never be satisfied, so it always
 * runs the full timeout.
 */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
