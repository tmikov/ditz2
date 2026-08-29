/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** Ink applies input and repaints on a later tick, so tests wait one out. */
export const settle = (): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, 25); });

/**
 * The escape sequences a terminal actually sends.
 *
 * Spelled with \u escapes rather than literal control characters: a literal
 * ESC is invisible in an editor and does not survive a copy-paste, and a key
 * test that silently sends nothing is a test that can only pass.
 */
export const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  home: '\u001B[H',
  end: '\u001B[F',
  pageUp: '\u001B[5~',
  pageDown: '\u001B[6~',
  escape: '\u001B',
  enter: '\r',
  ctrlU: '\u0015',
  ctrlD: '\u0004',
  backspace: '\u007F',
} as const;

export interface FakeStdin { write(data: string): void }

export async function press(stdin: FakeStdin, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    stdin.write(key);
    await settle();
  }
}

/**
 * The lines of a frame, stripped of colour and trailing spaces.
 *
 * Ink emits no escapes when chalk detects no colour support, which is the
 * usual case under vitest — but that depends on the environment, and an
 * assertion like `startsWith('>')` fails silently and confusingly the one time
 * it does not hold. Stripping makes the tests independent of it.
 */
export function lines(frame: string | undefined): string[] {
  return (frame ?? '')
    .replace(/\u001B\[[0-9;]*m/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
}
