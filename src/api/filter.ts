/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DzError } from '../core/errors.js';
import { ISSUE_TYPES, STATUSES } from '../core/types.js';
import type { Issue } from '../core/types.js';
import { validateEnum } from '../core/validate.js';

export interface Filter {
  status?: string;
  component?: string;
  assignee?: string;
  type?: string;
  all?: boolean;
}

export function applyFilter(issues: Issue[], f: Filter): Issue[] {
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

export function compilePattern(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (err) {
    throw new DzError('INVALID_FIELD', `invalid regex: ${(err as Error).message}`);
  }
}

export function matchesRe(issue: Issue, re: RegExp): boolean {
  if (re.test(issue.title) || re.test(issue.body)) return true;
  // Everything the log displays is searchable, not just comment bodies: the
  // author who made a change, the verb, and the detail carrying status
  // transitions, old titles, and component and assignee changes.
  return issue.log.some(
    (e) => re.test(e.author)
      || re.test(e.verb)
      || (e.detail !== null && re.test(e.detail))
      || (e.text !== null && re.test(e.text)),
  );
}

/**
 * The in-memory half of grep, over issues the caller already holds.
 *
 * A UI filters a snapshot it loaded once; routing each keystroke through
 * grepIssues would re-read every file on disk. This shares matchesRe with
 * grepIssues so the two can never disagree about what "matches" means.
 */
export function matchIssues(issues: Issue[], pattern: string): Issue[] {
  const re = compilePattern(pattern);
  return issues.filter((i) => matchesRe(i, re));
}
