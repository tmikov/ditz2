/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ISSUE_TYPES, STATUSES } from '../core/types.js';
import type { Command } from 'commander';
import type { Issue } from '../core/types.js';
import { validateEnum } from '../core/validate.js';

export interface ListFilters {
  status?: string;
  component?: string;
  assignee?: string;
  type?: string;
  all?: boolean;
}

export function addFilterOptions(cmd: Command): Command {
  return cmd
    .option('--status <status>', 'open|in-progress|closed')
    .option('--component <component>')
    .option('--assignee <assignee>')
    .option('--type <type>', 'bug|feature|task')
    .option('--all', 'include closed issues');
}

export function applyFilters(issues: Issue[], f: ListFilters): Issue[] {
  // A filter value outside the vocabulary can only ever match nothing, so
  // silently returning an empty list would answer a typo with a wrong answer.
  if (f.status !== undefined) validateEnum(f.status, STATUSES, 'status');
  if (f.type !== undefined) validateEnum(f.type, ISSUE_TYPES, 'type');

  // Closed issues are hidden unless asked for, explicitly or via --all.
  const includeClosed = f.all === true || f.status === 'closed';
  return issues.filter((i) => {
    if (!includeClosed && i.status === 'closed') return false;
    if (f.status !== undefined && i.status !== f.status) return false;
    if (f.component !== undefined && i.component !== f.component) return false;
    if (f.assignee !== undefined && i.assignee !== f.assignee) return false;
    if (f.type !== undefined && i.type !== f.type) return false;
    return true;
  });
}
