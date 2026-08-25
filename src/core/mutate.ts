/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DzError } from './errors.js';
import { ISSUE_TYPES, RESOLUTIONS } from './types.js';
import type { Config, Issue, IssueType, LogEntry, Resolution } from './types.js';
import { assertSettableStatus, validateComponent, validateEnum } from './validate.js';
import type { SettableStatus } from './validate.js';

function entry(author: string, at: string, verb: string, detail: string | null, text: string | null): LogEntry {
  return { timestamp: at, author, verb, detail, text };
}

function withEntry(issue: Issue, patch: Partial<Issue>, e: LogEntry): Issue {
  return { ...issue, ...patch, log: [...issue.log, e] };
}

/** Renders a nullable field for a log detail, so `null` reads as something. */
function show(value: string | null): string {
  return value === null ? '(none)' : value;
}

export interface NewIssueFields {
  id: string;
  title: string;
  type: IssueType;
  component: string | null;
  body: string;
  assignee?: string | null;
}

export function createIssue(fields: NewIssueFields, author: string, at: string): Issue {
  // setField enforces this too; without it here the same rule held on one path
  // and not the other, and `dz add ""` produced an issue with no title.
  if (fields.title.trim() === '') {
    throw new DzError('INVALID_FIELD', 'title cannot be empty');
  }
  return {
    id: fields.id,
    title: fields.title,
    type: fields.type,
    status: 'open',
    resolution: null,
    component: fields.component,
    assignee: fields.assignee ?? null,
    created: at,
    creator: author,
    body: fields.body,
    log: [entry(author, at, 'created', null, null)],
    unknown: {},
  };
}

export function setStatus(issue: Issue, next: SettableStatus, author: string, at: string): Issue {
  assertSettableStatus(next);
  const detail = `${issue.status} -> ${next}`;
  // Reopening clears the resolution; the invariant lives in exactly one place.
  return withEntry(issue, { status: next, resolution: null }, entry(author, at, 'status', detail, null));
}

export function closeIssue(
  issue: Issue, resolution: Resolution, comment: string | null, author: string, at: string,
): Issue {
  validateEnum(resolution, RESOLUTIONS, 'resolution');
  const detail = `${issue.status} -> closed (${resolution})`;
  const text = comment !== null && comment.trim() !== '' ? comment : null;
  return withEntry(issue, { status: 'closed', resolution }, entry(author, at, 'status', detail, text));
}

export function addComment(issue: Issue, text: string, author: string, at: string): Issue {
  if (text.trim() === '') {
    throw new DzError('INVALID_FIELD', 'refusing to record an empty comment');
  }
  return withEntry(issue, {}, entry(author, at, 'comment', null, text));
}

export type SettableField = 'title' | 'component' | 'assignee' | 'type';

export function setField(
  issue: Issue, field: SettableField, value: string | null,
  config: Config | null, author: string, at: string,
): Issue {
  switch (field) {
    case 'title': {
      if (value === null || value.trim() === '') {
        throw new DzError('INVALID_FIELD', 'title cannot be empty');
      }
      return withEntry(issue, { title: value },
        entry(author, at, 'title', `${issue.title} -> ${value}`, null));
    }
    case 'type': {
      if (value === null) throw new DzError('INVALID_FIELD', 'type cannot be empty');
      const next = validateEnum<IssueType>(value, ISSUE_TYPES, 'type');
      return withEntry(issue, { type: next },
        entry(author, at, 'type', `${issue.type} -> ${next}`, null));
    }
    case 'component': {
      validateComponent(value, config);
      return withEntry(issue, { component: value },
        entry(author, at, 'component', `${show(issue.component)} -> ${show(value)}`, null));
    }
    case 'assignee': {
      return withEntry(issue, { assignee: value },
        entry(author, at, 'assigned', `${show(issue.assignee)} -> ${show(value)}`, null));
    }
  }
}
