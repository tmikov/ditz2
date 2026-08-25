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

describe('dz add', () => {
  it('creates an open issue and prints its id', () => {
    project((dir) => {
      const r = dz(['add', 'Parser drops newline', '--json'], { cwd: dir });
      expect(r.code).toBe(0);
      const issue = JSON.parse(r.stdout);
      expect(issue.title).toBe('Parser drops newline');
      expect(issue.status).toBe('open');
      expect(issue.resolution).toBeNull();
      expect(issue.type).toBe('task');
      expect(issue.log).toHaveLength(1);
      expect(issue.log[0].verb).toBe('created');
    });
  });

  it('accepts --type and -m', () => {
    project((dir) => {
      const r = dz(['add', 'A bug', '--type', 'bug', '-m', 'body text', '--json'], { cwd: dir });
      const issue = JSON.parse(r.stdout);
      expect(issue.type).toBe('bug');
      expect(issue.body).toBe('body text');
    });
  });

  it('produces an empty body with no -m, so it is safe in scripts', () => {
    project((dir) => {
      expect(JSON.parse(dz(['add', 'No body', '--json'], { cwd: dir }).stdout).body).toBe('');
    });
  });

  it("reads the body from stdin with -m -", () => {
    project((dir) => {
      const r = dz(['add', 'From stdin', '-m', '-', '--json'], { cwd: dir, input: 'piped body\n' });
      expect(JSON.parse(r.stdout).body).toBe('piped body');
    });
  });

  it('rejects an unconfigured component and names the valid ones', () => {
    project((dir) => {
      const r = dz(['add', 'X', '--component', 'nope', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(JSON.parse(r.stderr).error.code).toBe('INVALID_FIELD');
    });
  });

  it('rejects an invalid type', () => {
    project((dir) => {
      expect(dz(['add', 'X', '--type', 'epic'], { cwd: dir }).code).toBe(1);
    });
  });

  it('errors when no author identity is available', () => {
    project((dir) => {
      // `init` above probed a VCS identity and may have written config.local.yaml.
      // Remove it, or resolveAuthor falls back to it and this asserts nothing.
      fs.rmSync(path.join(dir, 'dz', 'config.local.yaml'), { force: true });
      const r = dz(['add', 'X', '--json'], { cwd: dir, env: { DZ_AUTHOR: '' } });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('DZ_AUTHOR');
    });
  });
});

describe('dz show', () => {
  it('finds an issue by id prefix', () => {
    project((dir) => {
      const id = JSON.parse(dz(['add', 'Findable', '--json'], { cwd: dir }).stdout).id;
      const r = dz(['show', id.slice(0, 8), '--json'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout).title).toBe('Findable');
    });
  });

  it('prints human detail including the body and log', () => {
    project((dir) => {
      const id = JSON.parse(dz(['add', 'Detailed', '-m', 'the body', '--json'], { cwd: dir }).stdout).id;
      const out = dz(['show', id.slice(0, 8)], { cwd: dir }).stdout;
      expect(out).toContain('Detailed');
      expect(out).toContain('the body');
      expect(out).toContain('created');
    });
  });

  it('reports NOT_FOUND for an unmatched prefix', () => {
    project((dir) => {
      const r = dz(['show', 'ffffffff', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('NOT_FOUND');
    });
  });
});

describe('message handling is the same however the text arrives', () => {
  it('trims an inline -m, not just stdin', () => {
    project((dir) => {
      const inline = JSON.parse(
        dz(['add', 'inline', '-m', '  padded body  \n', '--json'], { cwd: dir }).stdout,
      );
      const piped = JSON.parse(
        dz(['add', 'piped', '-m', '-', '--json'], { cwd: dir, input: '  padded body  \n' }).stdout,
      );
      expect(inline.body).toBe('padded body');
      expect(piped.body).toBe(inline.body);
    });
  });
});

describe('an issue whose id does not match its filename', () => {
  /** Renames an issue file so its stem no longer equals its frontmatter id. */
  function desyncFilename(dir: string, id: string): string {
    const stem = '01a03199-0000-7000-8000-00000000dead';
    const issues = path.join(dir, 'dz', 'issues');
    fs.renameSync(path.join(issues, `${id}.md`), path.join(issues, `${stem}.md`));
    return stem;
  }

  it('reports why the file was skipped, not that nothing matches', () => {
    project((dir) => {
      const id = JSON.parse(dz(['add', 'renamed', '--json'], { cwd: dir }).stdout).id;
      const stem = desyncFilename(dir, id);

      // Before: findIssue saw only issues that loaded, so this claimed
      // NOT_FOUND for a file plainly present on disk.
      const r = dz(['show', stem, '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      const err = JSON.parse(r.stderr).error;
      expect(err.code).toBe('INVALID_FIELD');
      expect(err.message).toContain('filename');
    });
  });

  it('still reports NOT_FOUND for a prefix that matches nothing at all', () => {
    project((dir) => {
      dz(['add', 'present', '--json'], { cwd: dir });
      const r = dz(['show', 'ffffffff', '--json'], { cwd: dir });
      expect(JSON.parse(r.stderr).error.code).toBe('NOT_FOUND');
    });
  });
});

describe('dz add rejects an empty title', () => {
  it('refuses it, as dz set already did', () => {
    project((dir) => {
      const r = dz(['add', '', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(JSON.parse(r.stderr).error.code).toBe('INVALID_FIELD');
    });
  });

  it('refuses a whitespace-only title too', () => {
    project((dir) => {
      expect(dz(['add', '   ', '--json'], { cwd: dir }).code).toBe(1);
    });
  });
});
