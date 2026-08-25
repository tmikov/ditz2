/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { renderIssueDetail } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { findIssue } from '../store/issues.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';

export function registerShow(program: Command, ctx: CliContext): void {
  program
    .command('show')
    .description('show one issue in full')
    .argument('<id-prefix>', 'any unambiguous leading substring of the id')
    .action((prefix: string) => {
      const root = findProjectRoot(ctx.cwd);
      const issue = findIssue(root, prefix);
      ctx.stdout.write(ctx.json ? renderIssueJson(issue) : renderIssueDetail(issue));
    });
}
