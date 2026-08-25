/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { dz, withTempProject } from '../helpers.js';

function project<T>(fn: (dir: string, id: string) => T): T {
  return withTempProject((dir) => {
    dz(['init', '--name', 'demo'], { cwd: dir });
    const id = JSON.parse(dz(['add', 'A task', '--json'], { cwd: dir }).stdout).id;
    return fn(dir, id.slice(0, 8));
  });
}

describe('dz set', () => {
  it('moves an issue to in-progress and logs the transition', () => {
    project((dir, id) => {
      const issue = JSON.parse(dz(['set', id, '--status', 'in-progress', '--json'], { cwd: dir }).stdout);
      expect(issue.status).toBe('in-progress');
      expect(issue.log.at(-1).verb).toBe('status');
      expect(issue.log.at(-1).detail).toBe('open -> in-progress');
    });
  });

  it('refuses --status closed and names the close command', () => {
    project((dir, id) => {
      const r = dz(['set', id, '--status', 'closed', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      const err = JSON.parse(r.stderr).error;
      expect(err.code).toBe('INVALID_FIELD');
      expect(err.message).toContain('dz close');
    });
  });

  it('reopens a closed issue and clears the resolution', () => {
    project((dir, id) => {
      dz(['close', id, '--as', 'fixed'], { cwd: dir });
      const issue = JSON.parse(dz(['set', id, '--status', 'open', '--json'], { cwd: dir }).stdout);
      expect(issue.status).toBe('open');
      expect(issue.resolution).toBeNull();
    });
  });

  it('sets title, type and assignee', () => {
    project((dir, id) => {
      const issue = JSON.parse(
        dz(['set', id, '--title', 'Renamed', '--type', 'bug', '--assignee', 'a@x.com', '--json'],
          { cwd: dir }).stdout,
      );
      expect(issue.title).toBe('Renamed');
      expect(issue.type).toBe('bug');
      expect(issue.assignee).toBe('a@x.com');
    });
  });

  it('errors when no field is given', () => {
    project((dir, id) => {
      const r = dz(['set', id, '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.message).toContain('no field');
    });
  });
});

describe('dz close', () => {
  it('closes with a resolution and logs one status entry naming it', () => {
    project((dir, id) => {
      const issue = JSON.parse(dz(['close', id, '--as', 'fixed', '--json'], { cwd: dir }).stdout);
      expect(issue.status).toBe('closed');
      expect(issue.resolution).toBe('fixed');
      expect(issue.log.at(-1).detail).toBe('open -> closed (fixed)');
      expect(issue.log.filter((e: { verb: string }) => e.verb === 'closed')).toHaveLength(0);
    });
  });

  it('attaches a closing comment', () => {
    project((dir, id) => {
      const issue = JSON.parse(
        dz(['close', id, '--as', 'wontfix', '-m', 'Not worth it.', '--json'], { cwd: dir }).stdout,
      );
      expect(issue.log.at(-1).text).toBe('Not worth it.');
    });
  });

  it('rejects an unknown resolution', () => {
    project((dir, id) => {
      expect(dz(['close', id, '--as', 'bogus'], { cwd: dir }).code).toBe(1);
    });
  });

  it('requires --as', () => {
    project((dir, id) => {
      expect(dz(['close', id], { cwd: dir }).code).toBe(2);
    });
  });
});

describe('dz comment', () => {
  it('appends a comment entry', () => {
    project((dir, id) => {
      const issue = JSON.parse(dz(['comment', id, '-m', 'a remark', '--json'], { cwd: dir }).stdout);
      expect(issue.log.at(-1).verb).toBe('comment');
      expect(issue.log.at(-1).text).toBe('a remark');
    });
  });

  it('reads the comment from stdin with -m -', () => {
    project((dir, id) => {
      const issue = JSON.parse(
        dz(['comment', id, '-m', '-', '--json'], { cwd: dir, input: 'from stdin\n' }).stdout,
      );
      expect(issue.log.at(-1).text).toBe('from stdin');
    });
  });

  it('survives a multi-line comment through a re-read', () => {
    project((dir, id) => {
      dz(['comment', id, '-m', 'line one\nline two'], { cwd: dir });
      const issue = JSON.parse(dz(['show', id, '--json'], { cwd: dir }).stdout);
      expect(issue.log.at(-1).text).toBe('line one\nline two');
    });
  });
});
