/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export type Status = 'open' | 'in-progress' | 'closed';
export type Resolution = 'fixed' | 'wontfix' | 'duplicate';
export type IssueType = 'bug' | 'feature' | 'task';

export const STATUSES: readonly Status[] = ['open', 'in-progress', 'closed'];
export const RESOLUTIONS: readonly Resolution[] = ['fixed', 'wontfix', 'duplicate'];
export const ISSUE_TYPES: readonly IssueType[] = ['bug', 'feature', 'task'];

export interface LogEntry {
  timestamp: string;
  author: string;
  verb: string;
  detail: string | null;
  /** Continuation lines, joined with \n. Carries comment bodies. */
  text: string | null;
}

export interface Issue {
  id: string;
  title: string;
  type: IssueType;
  status: Status;
  /** Non-null exactly when status === 'closed'. */
  resolution: Resolution | null;
  component: string | null;
  assignee: string | null;
  created: string;
  creator: string;
  /** Verbatim markdown. The tool never reformats it. */
  body: string;
  log: LogEntry[];
  /** Frontmatter keys this version does not recognise, preserved on write. */
  unknown: Record<string, unknown>;
}

export interface Config {
  name: string;
  components: string[];
}

export interface IssueRef {
  id: string;
  title: string;
}
