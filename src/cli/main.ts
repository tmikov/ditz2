#!/usr/bin/env node
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Command, CommanderError } from 'commander';
import {
  DzError, EXIT_INTERNAL_ERROR, EXIT_SUCCESS, EXIT_USAGE_ERROR, EXIT_USER_ERROR,
} from '../core/errors.js';
import { renderErrorJson } from '../render/json.js';
import { registerAdd } from './add.js';
import { registerClose } from './close.js';
import { registerComment } from './comment.js';
import { registerComponent } from './component.js';
import { registerDoctor } from './doctor.js';
import { registerSchema } from './schema.js';
import type { CliContext } from './context.js';
import { registerEdit } from './edit.js';
import { registerGrep } from './grep.js';
import { registerHelp } from './help.js';
import { registerInit } from './init.js';
import { registerList } from './list.js';
import { registerSet } from './set.js';
import { registerShow } from './show.js';
import { registerUi } from './ui.js';
import { registerUnlock } from './unlock.js';

export function buildProgram(ctx: CliContext): Command {
  const program = new Command();
  program
    .name('dz')
    .description('a distributed issue tracker whose issues are files in your repository')
    .version('0.1.0')
    .option('--json', 'emit machine-readable JSON on stdout');

  // Subcommands copy exitOverride/configureOutput from their parent at the
  // moment `.command()` creates them, so both must be set before any
  // registerX() call below — otherwise a subcommand's own usage errors (e.g.
  // a missing requiredOption) bypass runCli's catch and call process.exit(1)
  // directly instead of surfacing as a caught, --json-aware usage error.
  program.configureOutput({
    writeOut: (s) => ctx.stdout.write(s),
    // In --json mode commander's plain text is suppressed; runCli re-emits the
    // failure through the JSON envelope so stderr stays machine-parseable.
    writeErr: (s) => { if (!ctx.json) ctx.stderr.write(s); },
  });
  program.exitOverride();

  registerInit(program, ctx);
  registerAdd(program, ctx);
  registerShow(program, ctx);
  registerList(program, ctx);
  registerGrep(program, ctx);
  registerSet(program, ctx);
  registerClose(program, ctx);
  registerComment(program, ctx);
  registerEdit(program, ctx);
  registerDoctor(program, ctx);
  registerComponent(program, ctx);
  registerSchema(program, ctx);
  registerUnlock(program, ctx);
  registerUi(program, ctx);
  // Last, so `program.commands` is fully populated when `help <command>`
  // looks a name up.
  registerHelp(program, ctx);

  return program;
}

export async function runCli(argv: string[], ctx: CliContext): Promise<number> {
  const program = buildProgram(ctx);
  try {
    await program.parseAsync(argv, { from: 'user' });
    return ctx.exitCode;
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help and --version are "errors" to exitOverride, but succeeded.
      if (err.exitCode === 0) return EXIT_SUCCESS;
      if (ctx.json) {
        // Commander prefixes its own messages with "error: "; strip it so the
        // JSON envelope's message field reads cleanly. Its missing-subcommand
        // path carries the internal placeholder "(outputHelp)" instead of a
        // message, which would otherwise reach the caller verbatim.
        const raw = err.message.replace(/^error: /, '');
        const message = raw === '(outputHelp)'
          ? "a subcommand is required; run 'dz help' to list them"
          : raw;
        ctx.stderr.write(renderErrorJson('USAGE_ERROR', message));
      }
      return EXIT_USAGE_ERROR;
    }
    if (err instanceof DzError) {
      ctx.stderr.write(
        ctx.json ? renderErrorJson(err.code, err.message) : `dz: ${err.message}\n`,
      );
      return EXIT_USER_ERROR;
    }
    const message = err instanceof Error ? err.message : String(err);
    ctx.stderr.write(
      ctx.json ? renderErrorJson('INTERNAL', message) : `dz: internal error: ${message}\n`,
    );
    return EXIT_INTERNAL_ERROR;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const ctx: CliContext = {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    // Read off argv directly: an error can occur before commander finishes parsing.
    json: argv.includes('--json'),
    exitCode: EXIT_SUCCESS,
  };
  process.exitCode = await runCli(argv, ctx);
}

void main();
