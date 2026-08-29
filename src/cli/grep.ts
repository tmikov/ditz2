/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { grepIssues } from '../api/read.js';
import type { Filter } from '../api/filter.js';
import { renderIssueList } from '../render/human.js';
import { renderIssuesJson } from '../render/json.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { addFilterOptions } from './filters.js';
import { reportFailures } from './list.js';

export function registerGrep(program: Command, ctx: CliContext): void {
  const cmd = program
    .command('grep')
    .description('search title, body and log text with a JavaScript regex')
    .argument('<regex>');
  addFilterOptions(cmd).action((pattern: string, opts: Filter) => {
    const session = { root: findProjectRoot(ctx.cwd), env: ctx.env };
    const { issues, failures } = grepIssues(session, pattern, opts);
    ctx.stdout.write(ctx.json ? renderIssuesJson(issues) : renderIssueList(issues));
    reportFailures(ctx, failures);
  });
}
