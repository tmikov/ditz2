/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';
import { JSON_SCHEMA } from '../render/schema.js';
import type { CliContext } from './context.js';

export function registerSchema(program: Command, ctx: CliContext): void {
  program
    .command('schema')
    .description('print the JSON Schema for --json output')
    .action(() => {
      // Already JSON, so --json changes nothing. Printing it unconditionally
      // means a consumer can fetch the contract without knowing the flag.
      ctx.stdout.write(`${JSON.stringify(JSON_SCHEMA, null, 2)}\n`);
    });
}
