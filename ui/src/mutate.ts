/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DzError } from 'ditz2';
import type { LockInfo, Project } from 'ditz2';
import { SNAPSHOT_FILTER } from './state.js';
import type { UiAction } from './state.js';

export type { Project } from 'ditz2';
export type { UiAction } from './state.js';

/** Who holds the lock, or null when it cannot be read. */
function holderOf(project: Project): LockInfo | null {
  try {
    const state = project.lock.state();
    return state.kind === 'active' || state.kind === 'abandoned' ? state.info : null;
  } catch {
    // The lock can be released between the refusal and this question. Losing
    // the holder's name is a worse frame, not a different outcome — the write
    // was still refused, and that is what the operator needs to see.
    return null;
  }
}

/**
 * The one path every write takes.
 *
 * `LOCKED` is a state, not an error: agents are expected to be working
 * alongside the operator, so contention is ordinary and gets a holder, a timer
 * and a retry. Everything else the facade raises is a message the operator has
 * to read. Anything that is not a DzError is a bug in this package and is
 * rethrown rather than dressed up as a user-facing failure.
 *
 * `now` is injected so the elapsed display is testable without a clock.
 */
export function runMutation(
  project: Project,
  dispatch: (action: UiAction) => void,
  op: string,
  call: () => void,
  now: () => number,
): void {
  dispatch({ type: 'mutationStarted', op });
  try {
    call();
  } catch (err) {
    if (!(err instanceof DzError)) throw err;
    if (err.code === 'LOCKED') {
      dispatch({ type: 'mutationLocked', op, holder: holderOf(project), at: now() });
      return;
    }
    dispatch({ type: 'mutationFailed', op, message: err.message });
    return;
  }

  // Reloaded rather than patched from the returned Issue: one source of truth.
  // SNAPSHOT_FILTER, because `x` closes issues and the default filter hides
  // closed ones — reloading without it makes what you just did disappear.
  try {
    const { issues, failures } = project.list(SNAPSHOT_FILTER);
    dispatch({ type: 'mutationSucceeded', issues, failures });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    dispatch({
      type: 'mutationFailed',
      op,
      message: `the ${op} was written, but the backlog could not be reloaded: ${detail}`,
    });
  }
}
