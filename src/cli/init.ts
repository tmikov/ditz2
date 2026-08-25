/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'node:path';
import type { Command } from 'commander';
import { DzError } from '../core/errors.js';
import { initProject, loadConfig, loadLocalAuthor, saveLocalAuthor } from '../store/config.js';
import { authorProblem, probeVcsIdentity } from '../store/identity.js';
import { findProjectRoot } from '../store/root.js';
import type { CliContext } from './context.js';
import { withProjectLock } from './lock.js';

/** The enclosing project root, or null if this directory is not inside one. */
function enclosingProject(cwd: string): string | null {
  try {
    return findProjectRoot(cwd);
  } catch {
    return null;
  }
}

export function registerInit(program: Command, ctx: CliContext): void {
  program
    .command('init')
    .description('create a dz/ project in the current directory')
    .option('--name <name>', 'project name (defaults to the directory name)')
    .option('--nested', 'create a project even inside an existing one')
    .action((opts: { name?: string; nested?: boolean }) => {
      const name = opts.name ?? path.basename(path.resolve(ctx.cwd));

      // Nesting is legitimate for a genuinely separate subproject, so this is a
      // guard rather than a prohibition. Re-running init in a project's own
      // root is not nesting; initProject is idempotent and stays that way.
      const enclosing = enclosingProject(ctx.cwd);
      if (
        enclosing !== null
        && path.resolve(enclosing) !== path.resolve(ctx.cwd)
        && opts.nested !== true
      ) {
        throw new DzError(
          'INVALID_FIELD',
          `already inside the dz project at ${enclosing}; commands here would use that one. Pass --nested to create a separate project anyway`,
        );
      }

      // The whole project is created BEFORE the lock, and the order matters.
      //
      // Locking first, with only dz/ created, looks safer and is not: a crash
      // in that window leaves a dz/ holding a lock but no config.yaml. Root
      // discovery keys on config.yaml, so every command — including `unlock`
      // and `doctor` — answers "no dz/config.yaml found; run `dz init`", while
      // `dz init` answers "run `dz unlock`". The only way out is deleting a
      // file by hand.
      //
      // The unlocked window is safe because initProject never overwrites an
      // existing file, and saveConfig replaces atomically. Two concurrent
      // first-time inits therefore both succeed and one name wins whole, which
      // is the same benign outcome as two `mkdir -p`.
      const { root } = initProject(ctx.cwd, name);

      // The one and only VCS shell-out in the tool, and it can sit in a
      // subprocess timeout for seconds. Deliberately outside the lock: it
      // reads nothing of the project, and holding the lock across it would
      // block every other writer for that whole time.
      const probed = loadLocalAuthor(root) === null ? probeVcsIdentity(ctx.cwd) : null;

      withProjectLock(ctx, root, 'init', () => {
        // initProject leaves an existing config.yaml alone, so on a re-init
        // the requested name is not the one in effect. Report what is
        // actually configured rather than what was asked for.
        const effectiveName = loadConfig(root).name;

        // Re-read under the lock, because the check that decided whether to
        // probe ran outside it. Never overwrite an identity the user already
        // set: a re-init used to replace a hand-edited author with the VCS one.
        const existing = loadLocalAuthor(root);
        let identity: string | null = existing;
        let problem: string | null = null;
        if (existing === null) {
          // Checked here rather than stored blindly: an unusable identity
          // would otherwise init cleanly and then fail every command that
          // needs an author, a long way from the thing that caused it.
          problem = probed === null ? null : authorProblem(probed);
          identity = problem === null ? probed : null;
          if (identity !== null) saveLocalAuthor(root, identity);
        }

        if (ctx.json) {
          ctx.stdout.write(
            `${JSON.stringify({
              name: effectiveName,
              requestedName: name,
              root,
              author: identity,
              authorRejected: problem === null ? null : probed,
            }, null, 2)}\n`,
          );
          return;
        }
        ctx.stdout.write(
          `initialized dz project "${effectiveName}" in ${path.join(root, 'dz')}\n`,
        );
        if (effectiveName !== name) {
          ctx.stdout.write(
            `note: the project was already named "${effectiveName}"; "${name}" was not applied. Edit name in dz/config.yaml to change it.\n`,
          );
        }
        if (identity !== null) {
          ctx.stdout.write(`author identity: ${identity}\n`);
        } else if (problem !== null) {
          ctx.stdout.write(
            `your VCS identity ${JSON.stringify(probed)} ${problem}, so it was not saved;\n` +
              'set DZ_AUTHOR or add an author to dz/config.local.yaml\n',
          );
        } else {
          ctx.stdout.write(
            'could not probe a VCS identity; set DZ_AUTHOR or edit dz/config.local.yaml\n',
          );
        }
      });
    });
}
