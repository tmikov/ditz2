/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { EXIT_USER_ERROR } from '../core/errors.js';
import { renderDiagnoses, renderRepairs } from '../render/human.js';
import { renderDiagnosesJson } from '../render/json.js';
import { diagnose, repair } from '../store/doctor.js';
import type { Repair } from '../store/doctor.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { withProjectLock } from './lock.js';

export function registerDoctor(program: Command, ctx: CliContext): void {
  program
    .command('doctor')
    .description('check the project for common problems')
    .option('--fix', 'repair the problems dz can repair without changing content')
    .action((opts: { fix?: boolean }) => {
      const root = findProjectRoot(ctx.cwd);
      // Without --fix this command reads and nothing else, so it takes no lock:
      // a diagnostic that refuses to run while another command holds the lock
      // is useless precisely when you reach for it.
      const fixed: Repair[] | undefined = opts.fix === true
        ? withProjectLock(ctx, root, 'doctor --fix', () => repair(root))
        : undefined;
      // Diagnosed after repairing, so what it prints is the state you are left
      // with rather than the one you started from.
      const problems = diagnose(root, ctx.env);
      ctx.stdout.write(
        ctx.json
          ? renderDiagnosesJson(problems, fixed)
          : `${fixed === undefined ? '' : renderRepairs(fixed)}${renderDiagnoses(problems)}`,
      );
      // Findings are the result, not a failure to produce one, so they go to
      // stdout. The exit code is what a script branches on.
      if (problems.length > 0) ctx.exitCode = EXIT_USER_ERROR;
    });
}
