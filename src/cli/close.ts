/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { closeIssueBy } from '../api/write.js';
import { RESOLUTIONS } from '../core/types.js';
import { shortId } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { readMessage } from './message.js';

export function registerClose(program: Command, ctx: CliContext): void {
  program
    .command('close')
    .description('close an issue with a resolution')
    .argument('<id-prefix>')
    .requiredOption('--as <resolution>', RESOLUTIONS.join('|'))
    .option('-m, --message <text>', "closing comment, or '-' to read stdin")
    .action((prefix: string, opts: { as: string; message?: string }) => {
      const root = findProjectRoot(ctx.cwd);
      // Read before the lock. `-m -` blocks until stdin closes, which is as
      // long as a slow producer runs or a human takes to press Ctrl-D, and no
      // part of a message body is project state worth serializing.
      const comment = opts.message === undefined ? null : readMessage(opts.message);

      const issue = closeIssueBy({ root, env: ctx.env }, prefix, opts.as, comment);
      ctx.stdout.write(
        ctx.json ? renderIssueJson(issue) : `closed ${shortId(issue.id)} (${opts.as})\n`,
      );
    });
}
