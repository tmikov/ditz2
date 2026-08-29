/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Command } from 'commander';

/**
 * The commander wiring for the shared list/grep filters. The filter itself
 * lives in src/api/filter.ts, so a UI applies exactly the same rules.
 */
export function addFilterOptions(cmd: Command): Command {
  return cmd
    .option('--status <status>', 'open|in-progress|closed')
    .option('--component <component>')
    .option('--assignee <assignee>')
    .option('--type <type>', 'bug|feature|task')
    .option('--all', 'include closed issues');
}
