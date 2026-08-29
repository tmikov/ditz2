/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { addIssue } from '../api/write.js';
import { ISSUE_TYPES } from '../core/types.js';
import { shortId } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { readMessage } from './message.js';

interface AddOptions {
  type: string;
  component?: string;
  message?: string;
}

export function registerAdd(program: Command, ctx: CliContext): void {
  program
    .command('add')
    .description('create a new issue')
    .argument('<title>', 'issue title')
    .option('--type <type>', `one of ${ISSUE_TYPES.join('|')}`, 'task')
    .option('--component <component>', 'a component from dz/config.yaml')
    .option('-m, --message <text>', "body text, or '-' to read stdin")
    .action((title: string, opts: AddOptions) => {
      const root = findProjectRoot(ctx.cwd);
      // Read before the lock. `-m -` blocks until stdin closes, which is as
      // long as a slow producer runs or a human takes to press Ctrl-D, and no
      // part of a message body is project state worth serializing.
      const body = readMessage(opts.message);

      const issue = addIssue({ root, env: ctx.env }, {
        title,
        type: opts.type,
        component: opts.component ?? null,
        body,
      });
      ctx.stdout.write(
        ctx.json ? renderIssueJson(issue) : `created ${shortId(issue.id)}  ${issue.title}\n`,
      );
    });
}
