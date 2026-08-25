/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { nowIso } from '../core/clock.js';
import { newId } from '../core/id.js';
import { createIssue } from '../core/mutate.js';
import { ISSUE_TYPES } from '../core/types.js';
import type { IssueType } from '../core/types.js';
import { validateEnum, validateIssue } from '../core/validate.js';
import { renderIssueJson } from '../render/json.js';
import { shortId } from '../render/human.js';
import { loadConfig } from '../store/config.js';
import { resolveAuthor } from '../store/identity.js';
import { writeIssue } from '../store/issues.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { withProjectLock } from './lock.js';
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

      withProjectLock(ctx, root, 'add', () => {
        const config = loadConfig(root);
        const author = resolveAuthor(root, ctx.env);

        const issue = createIssue(
          {
            id: newId(),
            title,
            type: validateEnum<IssueType>(opts.type, ISSUE_TYPES, 'type'),
            component: opts.component ?? null,
            body,
          },
          author,
          nowIso(),
        );
        validateIssue(issue, config);
        writeIssue(root, issue);

        ctx.stdout.write(
          ctx.json ? renderIssueJson(issue) : `created ${shortId(issue.id)}  ${issue.title}\n`,
        );
      });
    });
}
