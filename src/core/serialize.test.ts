/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { parseIssue, renderIssue } from './serialize.js';
import { DzError } from './errors.js';
import type { Issue } from './types.js';

const AUTHOR = 'Tzvetan Mikov <tmikov@example.com>';

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: '0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12',
    title: 'Parser drops trailing newline',
    type: 'bug',
    status: 'in-progress',
    resolution: null,
    component: 'core',
    assignee: 'tmikov@example.com',
    created: '2026-08-22T09:14:03.221Z',
    creator: AUTHOR,
    body: 'Repro: feed the tokenizer a file with no final newline.',
    log: [
      { timestamp: '2026-08-22T09:14:03.221Z', author: AUTHOR, verb: 'created', detail: null, text: null },
    ],
    unknown: {},
    ...over,
  };
}

describe('round-trip', () => {
  const cases: Array<[string, Issue]> = [
    ['baseline', issue()],
    ['empty body', issue({ body: '' })],
    ['no log entries', issue({ log: [] })],
    ['unicode and emoji title', issue({ title: 'Ünicode 🎉 and a: colon' })],
    ['--- inside the body', issue({ body: 'before\n\n---\n\nafter' })],
    ['markdown heading in body', issue({ body: '## Not the log\n\ntext' })],
    ['closed with resolution', issue({ status: 'closed', resolution: 'fixed' })],
    ['null component and assignee', issue({ component: null, assignee: null })],
    ['unknown frontmatter keys', issue({ unknown: { priority: 'high', votes: 3 } })],
    [
      'multi-line comment continuation',
      issue({
        log: [
          { timestamp: '2026-08-22T11:40:12.887Z', author: AUTHOR, verb: 'comment', detail: null, text: 'line one\nline two' },
        ],
      }),
    ],
  ];

  for (const [name, value] of cases) {
    it(`round-trips: ${name}`, () => {
      expect(parseIssue(renderIssue(value))).toEqual(value);
    });
  }
});

describe('parseIssue input tolerance', () => {
  it('normalizes CRLF input', () => {
    const crlf = renderIssue(issue()).replace(/\n/g, '\r\n');
    expect(parseIssue(crlf)).toEqual(issue());
  });

  it('accepts a file with no trailing newline', () => {
    const trimmed = renderIssue(issue()).replace(/\n+$/, '');
    expect(parseIssue(trimmed)).toEqual(issue());
  });

  it('treats a missing ## Log section as an empty log', () => {
    const text = ['---', 'id: 0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12', 'title: No log',
      'type: task', 'status: open', 'resolution: null', 'component: null',
      'assignee: null', 'created: 2026-08-22T09:14:03.221Z', `creator: ${AUTHOR}`,
      '---', '', 'body text', ''].join('\n');
    expect(parseIssue(text).log).toEqual([]);
  });

  it('keeps the ISO created timestamp a string, not a Date', () => {
    expect(typeof parseIssue(renderIssue(issue())).created).toBe('string');
  });
});

describe('parseIssue failures', () => {
  it('reports conflict markers by name instead of a YAML error', () => {
    const text = renderIssue(issue()).replace('type: bug', '<<<<<<< HEAD\ntype: bug');
    try {
      parseIssue(text, 'issues/abc.md');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('CONFLICT_MARKERS');
      expect((err as DzError).message).toContain('issues/abc.md');
    }
  });

  it('does not mistake a Setext heading underline for a conflict marker', () => {
    const round = parseIssue(renderIssue(issue({ body: 'Heading\n=======' })));
    expect(round.body).toBe('Heading\n=======');
  });

  it('rejects a file with no leading fence', () => {
    expect(() => parseIssue('no frontmatter here\n')).toThrow(/leading '---'/);
  });

  it('rejects unterminated frontmatter', () => {
    expect(() => parseIssue('---\nid: x\n')).toThrow(/unterminated frontmatter/);
  });

  it('rejects a frontmatter field with the wrong type', () => {
    const text = renderIssue(issue()).replace('status: in-progress', 'status: banana');
    try {
      parseIssue(text);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('PARSE_ERROR');
      expect((err as DzError).message).toContain('status');
    }
  });
});
