/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject } from './config.js';
import { issuesDir } from './root.js';
import { listIssueIds, loadAllIssues, readIssue, writeIssue, findIssue } from './issues.js';
import { createIssue } from '../core/mutate.js';
import { renderIssue } from '../core/serialize.js';
import { DzError } from '../core/errors.js';
import type { Issue } from '../core/types.js';

let tmp: string;
const AUTHOR = 'T <t@example.com>';

function make(id: string, title: string): Issue {
  return createIssue({ id, title, type: 'bug', component: null, body: 'b' },
    AUTHOR, '2026-08-22T09:14:03.221Z');
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-issues-'));
  initProject(tmp, 'p');
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('writeIssue / readIssue', () => {
  it('round-trips an issue through the filesystem', () => {
    const issue = make('0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12', 'Hello');
    writeIssue(tmp, issue);
    expect(readIssue(tmp, issue.id)).toEqual(issue);
  });

  it('names the file after the id', () => {
    const issue = make('0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12', 'Hello');
    writeIssue(tmp, issue);
    expect(fs.existsSync(path.join(issuesDir(tmp), `${issue.id}.md`))).toBe(true);
  });

  it('leaves no temp files behind', () => {
    writeIssue(tmp, make('0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12', 'Hello'));
    expect(fs.readdirSync(issuesDir(tmp)).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('throws NOT_FOUND for a missing issue', () => {
    try {
      readIssue(tmp, '0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('NOT_FOUND');
    }
  });

  it('does not report a non-ENOENT read failure as NOT_FOUND', () => {
    const id = '0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12';
    // A directory where the issue file should be: it exists, so "no issue
    // matches" would be a lie.
    fs.mkdirSync(path.join(issuesDir(tmp), `${id}.md`));
    try {
      readIssue(tmp, id);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).not.toBeInstanceOf(DzError);
      expect((err as NodeJS.ErrnoException).code).toBe('EISDIR');
    }
  });

  it('rejects a frontmatter id that disagrees with the filename stem', () => {
    const stem = '0198f2b0-0000-7000-8000-000000000002';
    const issue = make('0198f2a1-0000-7000-8000-000000000001', 'renamed');
    fs.writeFileSync(path.join(issuesDir(tmp), `${stem}.md`), renderIssue(issue), 'utf8');
    try {
      readIssue(tmp, stem);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
      expect((err as DzError).message).toMatch(/does not match the filename stem/);
    }
  });
});

describe('writeIssue refuses output it could not read back', () => {
  const id = '0198f2b0-9d17-7a55-8c31-6e2b0f9a4d12';

  function expectRefused(issue: Issue, detail: RegExp): void {
    try {
      writeIssue(tmp, issue);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('INVALID_FIELD');
      expect((err as DzError).message).toMatch(/collides with the issue file format/);
      expect((err as DzError).message).toMatch(detail);
    }
    expect(fs.existsSync(path.join(issuesDir(tmp), `${id}.md`))).toBe(false);
    expect(fs.readdirSync(issuesDir(tmp)).filter((f) => f.includes('.tmp-'))).toEqual([]);
  }

  it('refuses a body containing a line reading exactly "## Log"', () => {
    expectRefused({ ...make(id, 'x'), body: 'intro\n## Log\nfake' }, /unrecognized log line/);
  });

  it('refuses a log author containing a double space', () => {
    const issue = make(id, 'x');
    issue.log[0].author = 'Jane  Doe <j@e.com>';
    expectRefused(issue, /bad verb/);
  });

  it('refuses a log author containing a newline', () => {
    const issue = make(id, 'x');
    issue.log[0].author = 'Ev\nil <e@e.com>';
    expectRefused(issue, /malformed log entry/);
  });

  it('writes a body whose Setext heading only looks like a conflict marker', () => {
    const issue = { ...make(id, 'x'), body: 'Heading\n=======' };
    writeIssue(tmp, issue);
    expect(readIssue(tmp, id)).toEqual(issue);
  });
});

describe('listIssueIds', () => {
  it('returns ids in chronological (filename) order and ignores non-md files', () => {
    writeIssue(tmp, make('0198f2b0-0000-7000-8000-000000000002', 'second'));
    writeIssue(tmp, make('0198f2a1-0000-7000-8000-000000000001', 'first'));
    fs.writeFileSync(path.join(issuesDir(tmp), 'README.txt'), 'ignore me\n');
    expect(listIssueIds(tmp)).toEqual([
      '0198f2a1-0000-7000-8000-000000000001',
      '0198f2b0-0000-7000-8000-000000000002',
    ]);
  });
});

describe('loadAllIssues', () => {
  it('reports a malformed file as a failure without losing the good ones', () => {
    writeIssue(tmp, make('0198f2a1-0000-7000-8000-000000000001', 'good'));
    fs.writeFileSync(path.join(issuesDir(tmp), '0198f2b0-0000-7000-8000-000000000002.md'),
      'not an issue file\n');
    const { issues, failures } = loadAllIssues(tmp);
    expect(issues.map((i) => i.title)).toEqual(['good']);
    expect(failures).toHaveLength(1);
    expect(failures[0].error.code).toBe('PARSE_ERROR');
  });

  it('classifies a conflicted file as CONFLICT_MARKERS', () => {
    const good = make('0198f2a1-0000-7000-8000-000000000001', 'good');
    writeIssue(tmp, good);
    fs.writeFileSync(path.join(issuesDir(tmp), '0198f2b0-0000-7000-8000-000000000002.md'),
      '---\n<<<<<<< HEAD\ntitle: a\n=======\ntitle: b\n>>>>>>> other\n---\n');
    const { failures } = loadAllIssues(tmp);
    expect(failures[0].error.code).toBe('CONFLICT_MARKERS');
  });
});

describe('findIssue', () => {
  it('resolves by prefix', () => {
    writeIssue(tmp, make('0198f2a1-0000-7000-8000-000000000001', 'target'));
    expect(findIssue(tmp, '0198f2a1').title).toBe('target');
  });

  it('reports ambiguity with titles', () => {
    writeIssue(tmp, make('0198f2a1-0000-7000-8000-000000000001', 'one'));
    writeIssue(tmp, make('0198f2a1-0000-7000-8000-000000000002', 'two'));
    expect(() => findIssue(tmp, '0198f2a1')).toThrow(/one[\s\S]*two/);
  });
});

describe('findIssue resolves from the directory listing', () => {
  it('names the candidates with their titles when a prefix is ambiguous', () => {
    writeIssue(tmp, make('0198f2a1-0000-7000-8000-000000000001', 'first candidate'));
    writeIssue(tmp, make('0198f2a1-0000-7000-8000-000000000002', 'second candidate'));
    try {
      findIssue(tmp, '0198f2a1');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('AMBIGUOUS_PREFIX');
      // Titles are read only on this path, so this is what proves they are
      // still fetched rather than left blank by the listing-based lookup.
      expect((err as DzError).message).toContain('first candidate');
      expect((err as DzError).message).toContain('second candidate');
    }
  });

  it('lists an unreadable candidate rather than hiding the ambiguity', () => {
    writeIssue(tmp, make('0198f2a1-0000-7000-8000-000000000001', 'readable one'));
    fs.writeFileSync(
      path.join(issuesDir(tmp), '0198f2a1-0000-7000-8000-000000000002.md'),
      'not an issue file\n',
    );
    try {
      findIssue(tmp, '0198f2a1');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('AMBIGUOUS_PREFIX');
      expect((err as DzError).message).toContain('readable one');
      expect((err as DzError).message).toContain('(unreadable)');
    }
  });

  it('reports why a single corrupt match is bad, not that nothing matched', () => {
    fs.writeFileSync(
      path.join(issuesDir(tmp), '0198f2a1-0000-7000-8000-000000000001.md'),
      'not an issue file\n',
    );
    try {
      findIssue(tmp, '0198f2a1');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DzError).code).toBe('PARSE_ERROR');
    }
  });

  it('still reports NOT_FOUND when nothing matches', () => {
    writeIssue(tmp, make('0198f2a1-0000-7000-8000-000000000001', 'present'));
    expect(() => findIssue(tmp, 'ffffffff')).toThrow(/no issue matches/);
  });
});
