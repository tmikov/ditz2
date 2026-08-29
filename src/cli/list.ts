/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { listIssues } from '../api/read.js';
import type { Filter } from '../api/filter.js';
import { EXIT_USER_ERROR } from '../core/errors.js';
import { renderIssueList, renderWarnings } from '../render/human.js';
import { renderIssuesJson, renderWarningsJson } from '../render/json.js';
import type { LoadFailure } from '../store/issues.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { addFilterOptions } from './filters.js';

/** Shared by list and grep: warn about skipped files and mark the run failed. */
export function reportFailures(ctx: CliContext, failures: LoadFailure[]): void {
  if (failures.length === 0) return;
  ctx.stderr.write(
    ctx.json ? renderWarningsJson(failures) : `${renderWarnings(failures)}\n`,
  );
  ctx.exitCode = EXIT_USER_ERROR;
}

export function registerList(program: Command, ctx: CliContext): void {
  const cmd = program.command('list').description('list issues');
  addFilterOptions(cmd).action((opts: Filter) => {
    const session = { root: findProjectRoot(ctx.cwd), env: ctx.env };
    const { issues, failures } = listIssues(session, opts);
    ctx.stdout.write(ctx.json ? renderIssuesJson(issues) : renderIssueList(issues));
    reportFailures(ctx, failures);
  });
}
