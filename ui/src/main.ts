#!/usr/bin/env node
/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DzError } from 'ditz2';
import { runUi } from './index.js';

async function main(): Promise<void> {
  // dz ui makes the same check before importing this package, so that it does
  // not load Ink only to refuse. The message differs because the remedy does:
  // there it is "use the commands", here it is "you ran the wrong binary".
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    process.stderr.write('dzui: needs an interactive terminal on stdin and stdout\n');
    process.exitCode = 1;
    return;
  }

  try {
    process.exitCode = await runUi({ cwd: process.cwd(), env: process.env });
  } catch (err) {
    // The same exit codes dz uses: 1 for anything the operator can fix.
    const message = err instanceof DzError || err instanceof Error
      ? err.message
      : String(err);
    process.stderr.write(`dzui: ${message}\n`);
    process.exitCode = err instanceof DzError ? 1 : 3;
  }
}

void main();
