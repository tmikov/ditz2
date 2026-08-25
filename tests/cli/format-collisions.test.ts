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

/**
 * End-to-end guards for free text colliding with the file format's delimiters.
 * Each case used to write a file the tool could not read back — the last one
 * silently, by corrupting the record of who did what.
 */
function project<T>(fn: (dir: string) => T): T {
  return withTempProject((dir) => {
    dz(['init', '--name', 'demo'], { cwd: dir });
    return fn(dir);
  });
}

function issueFiles(dir: string): string[] {
  return fs.readdirSync(path.join(dir, 'dz', 'issues'));
}

describe('write-side format validation', () => {
  it('accepts a Setext heading in the body instead of calling it a conflict', () => {
    project((dir) => {
      const r = dz(['add', 'setext', '-m', 'Heading\n=======', '--json'], { cwd: dir });
      expect(r.code).toBe(0);
      const id = JSON.parse(r.stdout).id;

      // The point of the regression: it must still be readable afterwards.
      const shown = dz(['show', id, '--json'], { cwd: dir });
      expect(shown.code).toBe(0);
      expect(JSON.parse(shown.stdout).body).toBe('Heading\n=======');

      const listed = dz(['list', '--json'], { cwd: dir });
      expect(listed.code).toBe(0);
      expect(listed.stderr).toBe('');
    });
  });

  it('still reports a real conflict marker as CONFLICT_MARKERS', () => {
    project((dir) => {
      const id = JSON.parse(dz(['add', 'conflicted', '--json'], { cwd: dir }).stdout).id;
      const file = path.join(dir, 'dz', 'issues', `${id}.md`);
      fs.appendFileSync(file, '<<<<<<< HEAD\n');
      const r = dz(['list'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/conflict markers/);
    });
  });

  it('refuses a body containing a line reading exactly "## Log"', () => {
    project((dir) => {
      const r = dz(['add', 'fake log', '-m', 'intro\n## Log\nfake', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('INVALID_FIELD');
      expect(JSON.parse(r.stderr).error.message).toMatch(/collides with the issue file format/);
      expect(issueFiles(dir)).toEqual([]);
    });
  });

  it('refuses an author containing a double space, which used to corrupt silently', () => {
    project((dir) => {
      const r = dz(['add', 'dbl', '--json'], {
        cwd: dir,
        env: { DZ_AUTHOR: 'Jane  Doe <j@e.com>' },
      });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('INVALID_FIELD');
      expect(JSON.parse(r.stderr).error.message).toMatch(/double space/);
      expect(issueFiles(dir)).toEqual([]);
    });
  });

  it('refuses an author containing a newline', () => {
    project((dir) => {
      const r = dz(['add', 'nl', '--json'], {
        cwd: dir,
        env: { DZ_AUTHOR: 'Ev\nil <e@e.com>' },
      });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('INVALID_FIELD');
      expect(JSON.parse(r.stderr).error.message).toMatch(/line break/);
      expect(issueFiles(dir)).toEqual([]);
    });
  });

  it('rejects a bad author from config.local.yaml too, not just DZ_AUTHOR', () => {
    project((dir) => {
      fs.writeFileSync(
        path.join(dir, 'dz', 'config.local.yaml'),
        'author: "Jane  Doe <j@e.com>"\n',
      );
      const r = dz(['add', 'from file', '--json'], { cwd: dir, env: { DZ_AUTHOR: '' } });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.message).toMatch(/config\.local\.yaml.*double space/s);
    });
  });
});

describe('frontmatter id must match the filename stem', () => {
  it('skips a renamed file, naming the reason, instead of listing it as usable', () => {
    project((dir) => {
      const id = JSON.parse(dz(['add', 'renamed', '--json'], { cwd: dir }).stdout).id;
      const issues = path.join(dir, 'dz', 'issues');
      const stem = '0198f2b0-0000-7000-8000-000000000002';
      fs.renameSync(path.join(issues, `${id}.md`), path.join(issues, `${stem}.md`));

      // It used to appear in `list` while `show` and `set` denied it existed.
      const listed = dz(['list'], { cwd: dir });
      expect(listed.code).toBe(1);
      expect(listed.stdout).toMatch(/no issues/);
      expect(listed.stderr).toMatch(/does not match the filename stem/);
    });
  });

  it('makes `set` fail rather than write a second file under the stem name', () => {
    project((dir) => {
      const id = JSON.parse(dz(['add', 'renamed', '--json'], { cwd: dir }).stdout).id;
      const issues = path.join(dir, 'dz', 'issues');
      const stem = '0198f2b0-0000-7000-8000-000000000002';
      fs.renameSync(path.join(issues, `${id}.md`), path.join(issues, `${stem}.md`));

      const r = dz(['set', stem, '--status', 'in-progress', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(fs.readdirSync(issues)).toEqual([`${stem}.md`]);
    });
  });
});
