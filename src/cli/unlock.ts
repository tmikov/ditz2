/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { projectLockState } from '../api/read.js';
import { breakProjectLock } from '../api/write.js';
import { DzError } from '../core/errors.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';

export function registerUnlock(program: Command, ctx: CliContext): void {
  program
    .command('unlock')
    .description('remove an abandoned project lock')
    .option('--force', 'remove it even if it cannot be judged abandoned; this can delete a LIVE lock')
    .action((opts: { force?: boolean }) => {
      const root = findProjectRoot(ctx.cwd);
      const session = { root, env: ctx.env };
      const state = projectLockState(session);
      const force = opts.force === true;

      if (state.kind === 'none') {
        ctx.stdout.write(ctx.json ? `${JSON.stringify({ removed: false }, null, 2)}\n` : 'no lock to remove\n');
        return;
      }

      if (state.kind === 'active' && !force) {
        throw new DzError(
          'LOCKED',
          `the lock is held by '${state.info.command}' (pid ${state.info.pid} on `
          + `${state.info.hostname}) and cannot be judged abandoned from here. `
          + `Wait for it to finish, or pass --force to remove it anyway — this `
          + `can delete a lock that is still live.`,
        );
      }
      if (state.kind === 'malformed' && !force) {
        throw new DzError(
          'LOCKED',
          `${state.why}, so it cannot be judged abandoned. Pass --force to `
          + `remove it anyway — this can delete a lock that is still live.`,
        );
      }

      // breakLock re-reads the token immediately before removing, so a lock
      // that changed hands since lockState ran is not destroyed. That narrows
      // the window but cannot close it; see the note on breakLock itself.
      const before = state.kind === 'malformed' ? null : state.info.token;
      if (!breakProjectLock(session, before)) {
        throw new DzError(
          'LOCKED',
          'the lock changed hands while unlock was running; nothing was removed. Try again.',
        );
      }

      ctx.stdout.write(
        ctx.json ? `${JSON.stringify({ removed: true }, null, 2)}\n` : 'removed the lock\n',
      );
    });
}
