/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { commentOn } from '../api/write.js';
import { shortId } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { readMessage } from './message.js';

export function registerComment(program: Command, ctx: CliContext): void {
  program
    .command('comment')
    .description('append a comment to an issue')
    .argument('<id-prefix>')
    .requiredOption('-m, --message <text>', "comment text, or '-' to read stdin")
    .action((prefix: string, opts: { message: string }) => {
      const root = findProjectRoot(ctx.cwd);
      // Read before the lock. `-m -` blocks until stdin closes, which is as
      // long as a slow producer runs or a human takes to press Ctrl-D, and no
      // part of a message body is project state worth serializing.
      const text = readMessage(opts.message);

      const issue = commentOn({ root, env: ctx.env }, prefix, text);
      ctx.stdout.write(
        ctx.json ? renderIssueJson(issue) : `commented on ${shortId(issue.id)}\n`,
      );
    });
}
