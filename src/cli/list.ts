/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { EXIT_USER_ERROR } from '../core/errors.js';
import { renderIssueList, renderWarnings } from '../render/human.js';
import { renderIssuesJson, renderWarningsJson } from '../render/json.js';
import { loadAllIssues } from '../store/issues.js';
import type { LoadFailure } from '../store/issues.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { addFilterOptions, applyFilters } from './filters.js';
import type { ListFilters } from './filters.js';

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
  addFilterOptions(cmd).action((opts: ListFilters) => {
    const root = findProjectRoot(ctx.cwd);
    const { issues, failures } = loadAllIssues(root);
    const shown = applyFilters(issues, opts);
    ctx.stdout.write(ctx.json ? renderIssuesJson(shown) : renderIssueList(shown));
    reportFailures(ctx, failures);
  });
}
