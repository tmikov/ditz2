/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { nowIso } from '../core/clock.js';
import { addComment } from '../core/mutate.js';
import { validateIssue } from '../core/validate.js';
import { shortId } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { loadConfig } from '../store/config.js';
import { resolveAuthor } from '../store/identity.js';
import { findIssue, writeIssue } from '../store/issues.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { withProjectLock } from './lock.js';
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

      withProjectLock(ctx, root, 'comment', () => {
        const author = resolveAuthor(root, ctx.env);
        const issue = addComment(findIssue(root, prefix), text, author, nowIso());
        // Appending a comment cannot itself break an invariant, but every other
        // mutating command validates before writing and a uniform path is worth
        // more than the skipped check saves.
        validateIssue(issue, loadConfig(root));
        writeIssue(root, issue);
        ctx.stdout.write(
          ctx.json ? renderIssueJson(issue) : `commented on ${shortId(issue.id)}\n`,
        );
      });
    });
}
