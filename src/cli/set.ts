/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { nowIso } from '../core/clock.js';
import { DzError } from '../core/errors.js';
import { setField, setStatus } from '../core/mutate.js';
import type { Issue } from '../core/types.js';
import { assertSettableStatus, validateIssue } from '../core/validate.js';
import { shortId } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { loadConfig } from '../store/config.js';
import { resolveAuthor } from '../store/identity.js';
import { findIssue, writeIssue } from '../store/issues.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { withProjectLock } from './lock.js';

interface SetOptions {
  status?: string;
  title?: string;
  component?: string;
  assignee?: string;
  type?: string;
}

export function registerSet(program: Command, ctx: CliContext): void {
  program
    .command('set')
    .description('change fields on an issue')
    .argument('<id-prefix>')
    .option('--status <status>', 'open|in-progress (use `dz close` to close)')
    .option('--title <title>')
    .option('--component <component>')
    .option('--assignee <assignee>', "use '' to clear")
    .option('--type <type>', 'bug|feature|task')
    .action((prefix: string, opts: SetOptions) => {
      const given = Object.values(opts).filter((v) => v !== undefined);
      if (given.length === 0) {
        throw new DzError('INVALID_FIELD', 'no field given; pass at least one of --status --title --component --assignee --type');
      }

      const root = findProjectRoot(ctx.cwd);
      withProjectLock(ctx, root, 'set', () => {
        const config = loadConfig(root);
        const author = resolveAuthor(root, ctx.env);
        const at = nowIso();

        let issue: Issue = findIssue(root, prefix);
        if (opts.status !== undefined) {
          assertSettableStatus(opts.status);
          issue = setStatus(issue, opts.status, author, at);
        }
        if (opts.title !== undefined) issue = setField(issue, 'title', opts.title, config, author, at);
        if (opts.type !== undefined) issue = setField(issue, 'type', opts.type, config, author, at);
        if (opts.component !== undefined) {
          issue = setField(issue, 'component', opts.component === '' ? null : opts.component, config, author, at);
        }
        if (opts.assignee !== undefined) {
          issue = setField(issue, 'assignee', opts.assignee === '' ? null : opts.assignee, config, author, at);
        }

        validateIssue(issue, config);
        writeIssue(root, issue);
        ctx.stdout.write(ctx.json ? renderIssueJson(issue) : `updated ${shortId(issue.id)}\n`);
      });
    });
}
