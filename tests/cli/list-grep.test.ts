/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { dz, withTempProject } from '../helpers.js';

function project<T>(fn: (dir: string) => T): T {
  return withTempProject((dir) => {
    dz(['init', '--name', 'demo'], { cwd: dir });
    return fn(dir);
  });
}

function add(dir: string, title: string, extra: string[] = []): string {
  return JSON.parse(dz(['add', title, '--json', ...extra], { cwd: dir }).stdout).id;
}

describe('dz list', () => {
  it('lists open issues in creation order', () => {
    project((dir) => {
      add(dir, 'first');
      add(dir, 'second');
      const titles = JSON.parse(dz(['list', '--json'], { cwd: dir }).stdout).map(
        (i: { title: string }) => i.title,
      );
      expect(titles).toEqual(['first', 'second']);
    });
  });

  it('hides closed issues by default', () => {
    project((dir) => {
      const id = add(dir, 'done');
      add(dir, 'still open');
      dz(['close', id.slice(0, 13), '--as', 'fixed'], { cwd: dir });
      const titles = JSON.parse(dz(['list', '--json'], { cwd: dir }).stdout).map(
        (i: { title: string }) => i.title,
      );
      expect(titles).toEqual(['still open']);
    });
  });

  it('shows closed issues with --all and with --status closed', () => {
    project((dir) => {
      const id = add(dir, 'done');
      dz(['close', id.slice(0, 8), '--as', 'fixed'], { cwd: dir });
      expect(JSON.parse(dz(['list', '--all', '--json'], { cwd: dir }).stdout)).toHaveLength(1);
      expect(
        JSON.parse(dz(['list', '--status', 'closed', '--json'], { cwd: dir }).stdout),
      ).toHaveLength(1);
    });
  });

  it('filters by type', () => {
    project((dir) => {
      add(dir, 'a bug', ['--type', 'bug']);
      add(dir, 'a task');
      const got = JSON.parse(dz(['list', '--type', 'bug', '--json'], { cwd: dir }).stdout);
      expect(got.map((i: { title: string }) => i.title)).toEqual(['a bug']);
    });
  });

  it('warns and exits 1 on a malformed file, without hiding the good ones', () => {
    project((dir) => {
      add(dir, 'good');
      fs.writeFileSync(
        path.join(dir, 'dz', 'issues', '0198f2b0-0000-7000-8000-000000000009.md'),
        'not an issue\n',
      );
      const r = dz(['list', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stdout)).toHaveLength(1);
      expect(r.stderr).toContain('0198f2b0-0000-7000-8000-000000000009.md');
    });
  });
});

describe('dz grep', () => {
  it('matches against title, body and log text', () => {
    project((dir) => {
      add(dir, 'tokenizer trouble');
      add(dir, 'unrelated', ['-m', 'mentions tokenizer in the body']);
      add(dir, 'nothing here');
      const got = JSON.parse(dz(['grep', 'tokenizer', '--json'], { cwd: dir }).stdout);
      expect(got).toHaveLength(2);
    });
  });

  it('accepts the same filters as list', () => {
    project((dir) => {
      add(dir, 'tokenizer bug', ['--type', 'bug']);
      add(dir, 'tokenizer task');
      const got = JSON.parse(dz(['grep', 'tokenizer', '--type', 'bug', '--json'], { cwd: dir }).stdout);
      expect(got.map((i: { title: string }) => i.title)).toEqual(['tokenizer bug']);
    });
  });

  it('reports an invalid regex as a user error', () => {
    project((dir) => {
      const r = dz(['grep', '([unclosed', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('INVALID_FIELD');
    });
  });
});

// A typo used to produce an empty result set and exit 0, which reads to an
// agent as "no such issues" rather than "no such status".
describe('filter value validation', () => {
  for (const cmd of [['list'], ['grep', 'x']]) {
    it(`rejects an unknown --status for ${cmd[0]}`, () => {
      project((dir) => {
        add(dir, 'one');
        const r = dz([...cmd, '--status', 'bogus', '--json'], { cwd: dir });
        expect(r.code).toBe(1);
        expect(r.stdout).toBe('');
        const { code, message } = JSON.parse(r.stderr).error;
        expect(code).toBe('INVALID_FIELD');
        expect(message).toMatch(/not a valid status.*open, in-progress, closed/);
      });
    });

    it(`rejects an unknown --type for ${cmd[0]}`, () => {
      project((dir) => {
        add(dir, 'one');
        const r = dz([...cmd, '--type', 'bogus', '--json'], { cwd: dir });
        expect(r.code).toBe(1);
        expect(JSON.parse(r.stderr).error.code).toBe('INVALID_FIELD');
        expect(JSON.parse(r.stderr).error.message).toMatch(/not a valid type/);
      });
    });
  }

  it('still accepts every valid status, including closed', () => {
    project((dir) => {
      for (const s of ['open', 'in-progress', 'closed']) {
        expect(dz(['list', '--status', s, '--json'], { cwd: dir }).code).toBe(0);
      }
    });
  });
});

describe('partial failure under --json', () => {
  function withBadFile<T>(fn: (dir: string) => T): T {
    return project((dir) => {
      dz(['add', 'good one', '--json'], { cwd: dir });
      fs.writeFileSync(
        path.join(dir, 'dz', 'issues', '01a03199-0000-7000-8000-00000000beef.md'),
        'not an issue file\n',
      );
      fs.writeFileSync(
        path.join(dir, 'dz', 'issues', '01a03199-0000-7000-8000-0000000000c0.md'),
        '---\n<<<<<<< HEAD\ntitle: a\n=======\ntitle: b\n>>>>>>> other\n---\n',
      );
      return fn(dir);
    });
  }

  it('puts results on stdout and one warnings object on stderr, exiting 1', () => {
    withBadFile((dir) => {
      const r = dz(['list', '--json'], { cwd: dir });
      expect(r.code).toBe(1);

      // stdout is still the results array, unchanged by the failures.
      expect(JSON.parse(r.stdout)).toHaveLength(1);

      // stderr is exactly one object, not one line per warning.
      expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
      const parsed = JSON.parse(r.stderr);
      expect(parsed.error).toBeUndefined();
      const codes = parsed.warnings.map((w: { code: string }) => w.code).sort();
      expect(codes).toEqual(['CONFLICT_MARKERS', 'PARSE_ERROR']);
      for (const w of parsed.warnings) {
        expect(w.file).toMatch(/^dz\/issues\/.*\.md$/);
        expect(typeof w.message).toBe('string');
      }
    });
  });

  it('applies to grep as well as list', () => {
    withBadFile((dir) => {
      const r = dz(['grep', 'good', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stdout)).toHaveLength(1);
      expect(JSON.parse(r.stderr).warnings).toHaveLength(2);
    });
  });

  it('stays plain text without --json', () => {
    withBadFile((dir) => {
      const r = dz(['list'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('dz: warning: skipping');
      expect(() => JSON.parse(r.stderr)).toThrow();
    });
  });

  it('writes nothing to stderr when every file loads', () => {
    project((dir) => {
      dz(['add', 'fine', '--json'], { cwd: dir });
      const r = dz(['list', '--json'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(r.stderr).toBe('');
    });
  });
});

describe('grep searches everything the log displays', () => {
  function withHistory<T>(fn: (dir: string) => T): T {
    return project((dir) => {
      const id = JSON.parse(dz(['add', 'searchable', '--json'], { cwd: dir }).stdout)
        .id.slice(0, 13);
      dz(['set', id, '--status', 'in-progress'], { cwd: dir });
      dz(['comment', id, '-m', 'mentions tokenizer'], { cwd: dir });
      return fn(dir);
    });
  }
  const hits = (dir: string, re: string) =>
    JSON.parse(dz(['grep', re, '--json'], { cwd: dir }).stdout).length;

  it('finds a status transition recorded in a log detail', () => {
    withHistory((dir) => expect(hits(dir, 'in-progress')).toBe(1));
  });

  it('finds the author of a change', () => {
    withHistory((dir) => expect(hits(dir, 'Test User')).toBe(1));
  });

  it('finds a log verb', () => {
    withHistory((dir) => expect(hits(dir, 'created')).toBe(1));
  });

  it('still finds titles and comment bodies', () => {
    withHistory((dir) => {
      expect(hits(dir, 'searchable')).toBe(1);
      expect(hits(dir, 'tokenizer')).toBe(1);
    });
  });

  it('still misses what is genuinely absent', () => {
    withHistory((dir) => expect(hits(dir, 'nowhere-in-this-issue')).toBe(0));
  });
});
