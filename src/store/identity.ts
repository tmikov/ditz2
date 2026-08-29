/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execFileSync } from 'node:child_process';
import { DzError } from '../core/errors.js';
import type { Env } from '../core/types.js';
import { loadLocalAuthor } from './config.js';
import { localConfigPath } from './root.js';

function run(cmd: string, args: string[], cwd: string): string | null {
  try {
    const out = execFileSync(cmd, args, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    });
    const trimmed = out.trim();
    return trimmed === '' ? null : trimmed;
  } catch {
    return null;
  }
}

/**
 * The ONLY place in the tool that shells out to a VCS. Called once, at init.
 * Returns "Name <email>" or null if no VCS on this machine can tell us.
 */
export function probeVcsIdentity(cwd: string): string | null {
  const gitName = run('git', ['config', 'user.name'], cwd);
  const gitEmail = run('git', ['config', 'user.email'], cwd);
  if (gitName !== null && gitEmail !== null) return `${gitName} <${gitEmail}>`;

  // Some VCS tools store the whole "Name <email>" string under one key.
  const slUser = run('sl', ['config', 'ui.username'], cwd);
  if (slUser !== null) return slUser;

  return null;
}

/**
 * Describes why `author` cannot be written to a log entry, or null if it can.
 *
 * The log grammar separates fields with exactly two spaces and entries with
 * newlines, so an author containing either is not merely ugly — it silently
 * shifts its own tail into the verb field on the next read.
 *
 * Exposed separately from `checkAuthor` so `init` can report the problem where
 * the identity is first picked up, rather than storing it and failing later on
 * every command that needs an author.
 */
export function authorProblem(author: string): string | null {
  if (/[\n\r]/.test(author)) {
    return 'contains a line break, which the log format uses to separate entries';
  }
  if (author.includes('  ')) {
    return 'contains a double space, which the log format uses to separate fields';
  }
  return null;
}

function checkAuthor(author: string, source: string): string {
  const problem = authorProblem(author);
  if (problem !== null) {
    throw new DzError(
      'INVALID_FIELD',
      `author from ${source} ${problem}: ${JSON.stringify(author)}`,
    );
  }
  return author;
}

export function resolveAuthor(root: string, env: Env): string {
  const fromEnv = env['DZ_AUTHOR'];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return checkAuthor(fromEnv, 'DZ_AUTHOR');
  }

  const fromFile = loadLocalAuthor(root);
  if (fromFile !== null) return checkAuthor(fromFile, localConfigPath(root));

  throw new DzError(
    'INVALID_FIELD',
    `no author identity: set the DZ_AUTHOR environment variable, or add "author: Name <email>" to ${localConfigPath(root)}`,
  );
}
