/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { DzError } from '../core/errors.js';
import type { Env } from '../core/types.js';
import type { CliContext } from './context.js';

/** The one thing ditz2-ui must export for dz ui to hand over to it. */
interface UiModule {
  runUi(opts: { cwd: string; env: Env }): Promise<number>;
}

const UI_PACKAGE = 'ditz2-ui';

function isUiModule(mod: unknown): mod is UiModule {
  return typeof mod === 'object' && mod !== null
    && typeof (mod as UiModule).runUi === 'function';
}

/**
 * Loads ditz2-ui and gives it the terminal.
 *
 * `importUi` is a parameter rather than an inline import() so the
 * package-absent path is testable: ui/ is a workspace of this repository, so
 * the specifier resolves here and the failure cannot be produced by omission.
 */
export async function handOverToUi(
  ctx: CliContext,
  isTty: boolean,
  importUi: () => Promise<unknown>,
): Promise<number> {
  // Checked first, and before the import: with no terminal there is nothing to
  // hand over to, and Ink would otherwise be loaded only to be discarded.
  if (!isTty) {
    throw new DzError(
      'INVALID_FIELD',
      'the terminal UI needs an interactive terminal on stdin and stdout. '
      + "Use the commands instead — 'dz list', 'dz show', 'dz grep'",
    );
  }

  let mod: unknown;
  try {
    mod = await importUi();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    // A missing dependency OF ditz2-ui raises the same errno. Telling the
    // operator to install ditz2-ui when ditz2-ui is what failed to load its
    // own dependency sends them to fix the wrong thing.
    const missingUi = e.code === 'ERR_MODULE_NOT_FOUND'
      && typeof e.message === 'string'
      && e.message.includes(`'${UI_PACKAGE}'`);
    if (!missingUi) throw err;
    // The first two lines are the spec's wording, verbatim. The third is here
    // because ditz2 is not published yet, so the install it names currently
    // fails on an unresolvable dependency, and printing only that would send
    // the operator to a command that cannot succeed. Delete the third line
    // when both packages are on a registry.
    throw new DzError(
      'NOT_FOUND',
      `the terminal UI is a separate package\n    npm i -g ${UI_PACKAGE}\n`
      + '    (unpublished for now — see ui/README.md to build it from a clone)',
    );
  }

  if (!isUiModule(mod)) {
    throw new DzError(
      'INVALID_FIELD',
      `${UI_PACKAGE} is installed but exports no runUi(); its version does not `
      + 'match this dz. Reinstall both.',
    );
  }

  return mod.runUi({ cwd: ctx.cwd, env: ctx.env });
}

export function registerUi(program: Command, ctx: CliContext): void {
  program
    .command('ui')
    .description(`open the full-screen terminal UI (needs the ${UI_PACKAGE} package)`)
    .action(async () => {
      // The contract in `dz help agents` is that every command accepts --json
      // and that stdout is then machine-readable. A full-screen UI cannot
      // honour that, so it refuses rather than painting escape codes over a
      // caller that asked for JSON. `dz help` is the only other exception.
      if (ctx.json) {
        throw new DzError(
          'INVALID_FIELD',
          'dz ui is interactive and has no --json form; use dz list --json',
        );
      }
      const isTty = process.stdin.isTTY === true && process.stdout.isTTY === true;
      // The only mention of ditz2-ui anywhere in this package, and deliberately
      // a dynamic import: it is not a dependency and must not be bundled.
      ctx.exitCode = await handOverToUi(ctx, isTty, () => import(UI_PACKAGE));
    });
}
