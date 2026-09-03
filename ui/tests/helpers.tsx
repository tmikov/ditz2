/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { vi } from 'vitest';
import type { Issue, LoadFailure, Project } from 'ditz2';
import { App } from '../src/app.js';
import { FOOTER_ROWS } from '../src/components/Chrome.js';
import { initialState } from '../src/state.js';
import { three } from './fixtures.js';

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
  ctrlS: '\u0013',
  backspace: '\u007F',
  tab: '\t',
  /** CSI Z. Ink parses it as name `tab` with `shift` set; see parse-keypress.js. */
  shiftTab: '\u001B[Z',
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

/**
 * The footer, however many lines it has, as one string.
 *
 * Sized from the exported constant. A test that spelled `slice(-1)` would keep
 * passing against a two-line footer while reading only the padding, which is
 * the class of check this project keeps paying for.
 */
export function footerOf(frame: string | undefined): string {
  return lines(frame).slice(-FOOTER_ROWS).join('\n');
}

/**
 * The status line, which App draws immediately above the footer.
 *
 * Sized from `FOOTER_ROWS` for the reason `footerOf` is. Note that `<Notice>`
 * renders nothing at all when there is nothing to say, so on a quiet frame this
 * returns the last row of the body instead — it answers "what does the status
 * line say", not "is there one".
 */
export function noticeOf(frame: string | undefined): string {
  return lines(frame).at(-FOOTER_ROWS - 1) ?? '';
}

/** A Project that fails loudly if the UI calls anything it should not. */
export function stubProject(over: Partial<Project> = {}): Project {
  const reject = (): never => { throw new Error('unexpected project call'); };
  return {
    root: '/tmp/demo',
    name: 'demo',
    whoami: () => 'Jane Roe <jane@example.com>',
    list: () => ({ issues: three(), failures: [] }),
    show: reject, grep: reject, add: reject, set: reject,
    comment: reject, close: reject, doctor: reject, repair: reject,
    readForEdit: reject, parseEdit: reject, saveEdited: reject,
    // The fixture's own two components, so that no issue in `three()` holds
    // one the config does not list and the form's height is predictable.
    // A default that answers is safe here because nothing else calls it —
    // but note that plan 2b's filter test passed for free against a default
    // `list` that ignored its argument, so any test about *which* components
    // are offered must pass its own.
    components: { list: () => ['cli', 'store'], add: reject, remove: reject },
    lock: { state: reject, break: reject },
    ...over,
  } as Project;
}

/**
 * Renders <App> over the three-issue fixture by default.
 *
 * `projectOver` patches the stub project — e.g. a `comment` that records its
 * calls. `stateOver` patches the snapshot handed to `initialState` — e.g. an
 * empty issue list. `onExit` defaults to a fresh mock so callers that do not
 * care about it need not pass one.
 */
export function mount(
  projectOver: Partial<Project> = {},
  stateOver: { issues?: Issue[]; failures?: LoadFailure[] } = {},
  onExit: () => void = vi.fn(),
): ReturnType<typeof render> & { onExit: () => void } {
  const r = render(
    <App
      project={stubProject(projectOver)}
      initial={initialState(stateOver.issues ?? three(), stateOver.failures ?? [])}
      rows={14}
      width={80}
      onExit={onExit}
    />,
  );
  return { ...r, onExit };
}
