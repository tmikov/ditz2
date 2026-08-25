/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { EXIT_USER_ERROR } from '../core/errors.js';
import { renderDiagnoses } from '../render/human.js';
import { renderDiagnosesJson } from '../render/json.js';
import { diagnose } from '../store/doctor.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';

export function registerDoctor(program: Command, ctx: CliContext): void {
  program
    .command('doctor')
    .description('check the project for common problems')
    .action(() => {
      const root = findProjectRoot(ctx.cwd);
      const problems = diagnose(root, ctx.env);
      ctx.stdout.write(ctx.json ? renderDiagnosesJson(problems) : renderDiagnoses(problems));
      // Findings are the result, not a failure to produce one, so they go to
      // stdout. The exit code is what a script branches on.
      if (problems.length > 0) ctx.exitCode = EXIT_USER_ERROR;
    });
}
