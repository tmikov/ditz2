/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { render, useStdout } from 'ink';
import React from 'react';
import { openProject } from 'ditz2';
import type { Project } from 'ditz2';
import { App } from './app.js';
import { initialState, SNAPSHOT_FILTER } from './state.js';

export interface RunUiOptions {
  cwd: string;
  env: Record<string, string | undefined>;
}

const DEFAULT_ROWS = 24;
const DEFAULT_COLUMNS = 80;

const ESC = String.fromCharCode(27);

/** Re-renders on SIGWINCH; without it a resize leaves a frame the wrong size. */
function Root({ project, onExit }: { project: Project; onExit: () => void }): React.ReactElement {
  const { stdout } = useStdout();
  // A pty with no controlling terminal reports 0, not undefined, for an
  // unset winsize (confirmed against a real `script`-allocated pty, where
  // `??` alone left the UI drawing into a 0x0 frame instead of falling back).
  const read = React.useCallback(() => ({
    rows: stdout.rows > 0 ? stdout.rows : DEFAULT_ROWS,
    columns: stdout.columns > 0 ? stdout.columns : DEFAULT_COLUMNS,
  }), [stdout]);

  const [size, setSize] = React.useState(read);
  React.useEffect(() => {
    const onResize = (): void => { setSize(read()); };
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout, read]);

  const initial = React.useMemo(() => {
    const { issues, failures } = project.list(SNAPSHOT_FILTER);
    return initialState(issues, failures);
  }, [project]);

  return (
    <App
      project={project}
      initial={initial}
      // One row short of the terminal on purpose, and independent of how many
      // rows App itself holds back: <Notice> is conditional, so the frame
      // lands one or two rows below the terminal height rather than risking
      // the row that would make Ink clear and redraw the whole screen on
      // every render.
      rows={size.rows - 1}
      width={size.columns}
      onExit={onExit}
    />
  );
}

/** Signals that end the process without Node running its `exit` handlers. */
const EXIT_SIGNALS: Record<string, number> = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 };

/** Enters the alternate screen buffer, and returns the function that leaves it. */
function takeScreen(): () => void {
  if (process.stdout.isTTY !== true) return () => {};
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    process.stdout.write(`${ESC}[?1049l`);
  };
  process.stdout.write(`${ESC}[?1049h`);
  // Three paths, none redundant, each verified against a real pty:
  //
  //   finally in runUi — a throw before Ink mounts, and Ink's Ctrl-C, which
  //     in 6.8.0 unmounts gracefully rather than calling process.exit (read
  //     App.js's handleInput; an earlier revision of this plan asserted the
  //     opposite and was wrong).
  //   exit           — an uncaught exception or unhandled rejection anywhere
  //     in the process. Node's default handler ends the process without
  //     unwinding, so the finally never runs, but `exit` still fires.
  //     Verified with a probe; this is not the hypothetical
  //     "a caller calls process.exit" that an earlier revision claimed, and
  //     no such caller exists.
  //   signal handlers — an externally delivered SIGINT/SIGTERM/SIGHUP, which
  //     Node terminates on WITHOUT running exit handlers. Measured: without
  //     these, `kill -TERM` leaves the alternate buffer up and the operator's
  //     shell invisible. SIGHUP is the one that fires when a terminal window
  //     is closed, so this is not an exotic case.
  //
  // `released` makes the overlap harmless.
  process.once('exit', release);
  for (const [signal, number] of Object.entries(EXIT_SIGNALS)) {
    process.once(signal, () => {
      release();
      process.exit(128 + number);
    });
  }
  return release;
}

/**
 * Opens the project and gives Ink the terminal.
 *
 * lockTimeoutMs is 0 and must stay 0. acquireLock otherwise retries with
 * Atomics.wait for up to two seconds of synchronous blocking, during which Ink
 * cannot repaint, cannot read a keystroke, and — because Ink registers a
 * signal-exit handler that suppresses Node's default terminate — cannot be
 * interrupted with Ctrl-C either. Nothing here writes, so nothing should reach
 * a lock; the setting is what keeps that true when plan 2b adds mutations.
 */
export async function runUi(opts: RunUiOptions): Promise<number> {
  // A pty with no winsize reports rows and columns as 0 rather than undefined,
  // and Ink measures its root container from process.stdout directly — so a
  // zero there renders a blank screen that looks like a hang, whatever sizes
  // the components are handed. Observed under `script` with COLUMNS and LINES
  // unset, which is also what some CI runners give you. Normalising the stream
  // is the only lever, because Ink does not take dimensions as options.
  if (!(process.stdout.columns > 0)) process.stdout.columns = DEFAULT_COLUMNS;
  if (!(process.stdout.rows > 0)) process.stdout.rows = DEFAULT_ROWS;

  const release = takeScreen();
  try {
    const project = openProject(opts.cwd, { env: opts.env, lockTimeoutMs: 0 });
    const instance = render(<Root project={project} onExit={() => { instance.unmount(); }} />);
    await instance.waitUntilExit();
    return 0;
  } finally {
    release();
  }
}
