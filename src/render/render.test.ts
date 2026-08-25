/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  renderIssuesJson, renderIssueJson, renderErrorJson, renderWarningsJson,
} from './json.js';
import { renderIssueList, renderIssueDetail, renderWarnings, shortId } from './human.js';
import { DzError } from '../core/errors.js';
import type { Issue } from '../core/types.js';

const AUTHOR = 'T <t@example.com>';

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: '0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12',
    title: 'Parser drops trailing newline', type: 'bug', status: 'in-progress',
    resolution: null, component: 'core', assignee: 'tmikov@example.com',
    created: '2026-08-22T09:14:03.221Z', creator: AUTHOR,
    body: 'Repro steps here.',
    log: [{ timestamp: '2026-08-22T09:14:03.221Z', author: AUTHOR, verb: 'created', detail: null, text: null }],
    unknown: {}, ...over,
  };
}

describe('json output', () => {
  it('emits an array for lists, parseable and lossless', () => {
    const parsed = JSON.parse(renderIssuesJson([issue()]));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe(issue().id);
    expect(parsed[0].log[0].verb).toBe('created');
  });

  it('emits an object for a single issue', () => {
    expect(JSON.parse(renderIssueJson(issue())).title).toBe('Parser drops trailing newline');
  });

  it('emits errors in the documented envelope', () => {
    expect(JSON.parse(renderErrorJson('NOT_FOUND', 'nope')))
      .toEqual({ error: { code: 'NOT_FOUND', message: 'nope' } });
  });

  it('ends every payload with exactly one newline', () => {
    expect(renderIssuesJson([issue()]).endsWith('\n')).toBe(true);
    expect(renderIssuesJson([issue()]).endsWith('\n\n')).toBe(false);
  });
});

describe('human output', () => {
  it('lists one issue per line with a short id, status, type and title', () => {
    const out = renderIssueList([issue()]);
    expect(out).toContain('0198f2b0');
    expect(out).toContain('in-progress');
    expect(out).toContain('bug');
    expect(out).toContain('Parser drops trailing newline');
    expect(out.trimEnd().split('\n')).toHaveLength(1);
  });

  it('says so when there is nothing to show', () => {
    expect(renderIssueList([])).toContain('no issues');
  });

  it('shows the body and the log in detail view', () => {
    const out = renderIssueDetail(issue());
    expect(out).toContain('Repro steps here.');
    expect(out).toContain('created');
    expect(out).toContain('tmikov@example.com');
  });

  it('shortId takes the full millisecond-timestamp prefix', () => {
    expect(shortId(issue().id)).toBe('0198f2b0-9d17');
  });
});

describe('renderWarnings', () => {
  const failure = (file: string, message: string) => ({
    file,
    error: new DzError('PARSE_ERROR', message),
  });

  it('does not repeat a filename the message already carries', () => {
    const out = renderWarnings([
      failure('dz/issues/a.md', 'dz/issues/a.md: unterminated frontmatter'),
    ]);
    expect(out).toBe('dz: warning: skipping dz/issues/a.md: unterminated frontmatter');
    // The bug this pins: the path appearing twice in one line.
    expect(out.split('dz/issues/a.md')).toHaveLength(2);
  });

  it('handles the conflict-marker shape, which uses a space not a colon', () => {
    const out = renderWarnings([
      failure('dz/issues/b.md', 'dz/issues/b.md contains VCS conflict markers'),
    ]);
    expect(out).toBe('dz: warning: skipping dz/issues/b.md contains VCS conflict markers');
  });

  it('still names the file when a message does not carry it', () => {
    const out = renderWarnings([failure('dz/issues/c.md', 'something went wrong')]);
    expect(out).toBe('dz: warning: skipping dz/issues/c.md: something went wrong');
  });

  it('emits one line per failure', () => {
    const out = renderWarnings([
      failure('dz/issues/a.md', 'dz/issues/a.md: bad'),
      failure('dz/issues/b.md', 'dz/issues/b.md: worse'),
    ]);
    expect(out.split('\n')).toHaveLength(2);
  });

  it('renders nothing for no failures', () => {
    expect(renderWarnings([])).toBe('');
  });
});

describe('renderWarningsJson', () => {
  const failure = (file: string, code: 'PARSE_ERROR' | 'CONFLICT_MARKERS', message: string) => ({
    file,
    error: new DzError(code, message),
  });

  it('emits one object with a warnings array carrying file, code and message', () => {
    const out = renderWarningsJson([
      failure('dz/issues/a.md', 'PARSE_ERROR', 'dz/issues/a.md: unterminated frontmatter'),
      failure('dz/issues/b.md', 'CONFLICT_MARKERS', 'dz/issues/b.md contains VCS conflict markers'),
    ]);
    expect(JSON.parse(out)).toEqual({
      warnings: [
        { file: 'dz/issues/a.md', code: 'PARSE_ERROR', message: 'dz/issues/a.md: unterminated frontmatter' },
        { file: 'dz/issues/b.md', code: 'CONFLICT_MARKERS', message: 'dz/issues/b.md contains VCS conflict markers' },
      ],
    });
  });

  it('is a single line, so stderr stays one parseable object', () => {
    const out = renderWarningsJson([
      failure('a.md', 'PARSE_ERROR', 'a.md: x'),
      failure('b.md', 'PARSE_ERROR', 'b.md: y'),
    ]);
    expect(out.trimEnd()).not.toContain('\n');
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });

  it('does not use the error envelope shape', () => {
    const parsed = JSON.parse(renderWarningsJson([failure('a.md', 'PARSE_ERROR', 'a.md: x')]));
    expect(parsed.error).toBeUndefined();
  });
});
