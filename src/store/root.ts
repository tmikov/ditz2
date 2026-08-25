/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DzError } from '../core/errors.js';

export const DZ_DIR = 'dz';
export const CONFIG_FILE = 'config.yaml';
export const LOCAL_CONFIG_FILE = 'config.local.yaml';
export const ISSUES_DIR = 'issues';

export const dzDir = (root: string): string => path.join(root, DZ_DIR);
export const configPath = (root: string): string => path.join(dzDir(root), CONFIG_FILE);
export const localConfigPath = (root: string): string => path.join(dzDir(root), LOCAL_CONFIG_FILE);
export const issuesDir = (root: string): string => path.join(dzDir(root), ISSUES_DIR);

/** Walks up from `startDir` looking for the dz/config.yaml root marker. */
export function findProjectRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(configPath(dir))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new DzError(
        'NO_PROJECT',
        `no ${DZ_DIR}/${CONFIG_FILE} found in ${path.resolve(startDir)} or any parent directory; run \`dz init\``,
      );
    }
    dir = parent;
  }
}
