/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { setFields } from '../api/write.js';
import { shortId } from '../render/human.js';
import { renderIssueJson } from '../render/json.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';

interface SetOptions {
  status?: string;
  title?: string;
  component?: string;
  assignee?: string;
  type?: string;
}

/** `--component ''` and `--assignee ''` clear the field; the API takes null. */
function clearable(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === '' ? null : value;
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
      const issue = setFields({ root: findProjectRoot(ctx.cwd), env: ctx.env }, prefix, {
        status: opts.status,
        title: opts.title,
        type: opts.type,
        component: clearable(opts.component),
        assignee: clearable(opts.assignee),
      });
      ctx.stdout.write(ctx.json ? renderIssueJson(issue) : `updated ${shortId(issue.id)}\n`);
    });
}
