/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { DzError } from '../core/errors.js';
import type { Issue } from '../core/types.js';
import { renderIssueList } from '../render/human.js';
import { renderIssuesJson } from '../render/json.js';
import { loadAllIssues } from '../store/issues.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { addFilterOptions, applyFilters } from './filters.js';
import type { ListFilters } from './filters.js';
import { reportFailures } from './list.js';

function matches(issue: Issue, re: RegExp): boolean {
  if (re.test(issue.title) || re.test(issue.body)) return true;
  // Everything the log displays is searchable, not just comment bodies: the
  // author who made a change, the verb, and the detail carrying status
  // transitions, old titles, and component and assignee changes.
  return issue.log.some(
    (e) => re.test(e.author)
      || re.test(e.verb)
      || (e.detail !== null && re.test(e.detail))
      || (e.text !== null && re.test(e.text)),
  );
}

export function registerGrep(program: Command, ctx: CliContext): void {
  const cmd = program
    .command('grep')
    .description('search title, body and log text with a JavaScript regex')
    .argument('<regex>');
  addFilterOptions(cmd).action((pattern: string, opts: ListFilters) => {
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch (err) {
      throw new DzError('INVALID_FIELD', `invalid regex: ${(err as Error).message}`);
    }
    const root = findProjectRoot(ctx.cwd);
    const { issues, failures } = loadAllIssues(root);
    const shown = applyFilters(issues, opts).filter((i) => matches(i, re));
    ctx.stdout.write(ctx.json ? renderIssuesJson(shown) : renderIssueList(shown));
    reportFailures(ctx, failures);
  });
}
