/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import YAML from 'yaml';
import { DzError } from './errors.js';
import { parseLog, renderLog } from './log.js';
import { ISSUE_TYPES, RESOLUTIONS, STATUSES } from './types.js';
import type { Issue, IssueType, Resolution, Status } from './types.js';

const FENCE = '---';
const LOG_HEADING = '## Log';
/**
 * Only `<<<<<<<`, which is what §7 names. The other two markers are ambiguous
 * with ordinary Markdown — `=======` is a Setext heading underline — and no
 * conflict region exists without an opening marker, so matching it alone loses
 * no detection while leaving valid documents alone.
 */
const CONFLICT_RE = /^<{7}/m;

/** Frontmatter keys this version understands. Anything else lands in `unknown`. */
const KNOWN_KEYS = [
  'id', 'title', 'type', 'status', 'resolution',
  'component', 'assignee', 'created', 'creator',
] as const;

function requireString(fm: Record<string, unknown>, key: string, filename: string): string {
  const value = fm[key];
  if (typeof value !== 'string') {
    throw new DzError('PARSE_ERROR', `${filename}: frontmatter key "${key}" must be a string`);
  }
  return value;
}

function optionalString(fm: Record<string, unknown>, key: string, filename: string): string | null {
  const value = fm[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new DzError('PARSE_ERROR', `${filename}: frontmatter key "${key}" must be a string or null`);
  }
  return value;
}

function requireEnum<T extends string>(
  fm: Record<string, unknown>, key: string, allowed: readonly T[], filename: string,
): T {
  const value = requireString(fm, key, filename);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new DzError(
      'PARSE_ERROR',
      `${filename}: frontmatter key "${key}" is "${value}", expected one of ${allowed.join(', ')}`,
    );
  }
  return value as T;
}

export function parseIssue(text: string, filename = '<string>'): Issue {
  const src = text.replace(/\r\n/g, '\n');

  // Checked before YAML so a merge conflict reports as itself, not as a syntax error.
  if (CONFLICT_RE.test(src)) {
    throw new DzError('CONFLICT_MARKERS', `${filename} contains VCS conflict markers`);
  }

  const lines = src.split('\n');
  if (lines[0] !== FENCE) {
    throw new DzError('PARSE_ERROR', `${filename}: missing leading '---' frontmatter fence`);
  }
  // Only the FIRST closing fence counts, which is what lets a body contain '---'.
  const close = lines.indexOf(FENCE, 1);
  if (close === -1) {
    throw new DzError('PARSE_ERROR', `${filename}: unterminated frontmatter`);
  }

  let fm: Record<string, unknown>;
  try {
    fm = (YAML.parse(lines.slice(1, close).join('\n')) as Record<string, unknown>) ?? {};
  } catch (err) {
    throw new DzError('PARSE_ERROR', `${filename}: invalid YAML frontmatter: ${(err as Error).message}`);
  }

  const rest = lines.slice(close + 1);
  const logIdx = rest.indexOf(LOG_HEADING);
  const bodyLines = logIdx === -1 ? rest : rest.slice(0, logIdx);
  const body = bodyLines.join('\n').trim();
  const log = logIdx === -1 ? [] : parseLog(rest.slice(logIdx + 1), filename);

  const unknown: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) unknown[key] = value;
  }

  return {
    id: requireString(fm, 'id', filename),
    title: requireString(fm, 'title', filename),
    type: requireEnum<IssueType>(fm, 'type', ISSUE_TYPES, filename),
    status: requireEnum<Status>(fm, 'status', STATUSES, filename),
    resolution: fm['resolution'] === null || fm['resolution'] === undefined
      ? null
      : requireEnum<Resolution>(fm, 'resolution', RESOLUTIONS, filename),
    component: optionalString(fm, 'component', filename),
    assignee: optionalString(fm, 'assignee', filename),
    created: requireString(fm, 'created', filename),
    creator: requireString(fm, 'creator', filename),
    body,
    log,
    unknown,
  };
}

export function renderIssue(issue: Issue): string {
  const frontmatter: Record<string, unknown> = {
    id: issue.id,
    title: issue.title,
    type: issue.type,
    status: issue.status,
    resolution: issue.resolution,
    component: issue.component,
    assignee: issue.assignee,
    created: issue.created,
    creator: issue.creator,
    ...issue.unknown,
  };

  let out = `${FENCE}\n${YAML.stringify(frontmatter)}${FENCE}\n\n`;
  if (issue.body !== '') out += `${issue.body}\n\n`;
  out += `${LOG_HEADING}\n\n${renderLog(issue.log)}`;
  return out;
}
