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

describe('dz init', () => {
  it('creates the project layout', () => {
    withTempProject((dir) => {
      const r = dz(['init', '--name', 'demo'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(dir, 'dz', 'config.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'dz', 'issues'))).toBe(true);
      expect(fs.readFileSync(path.join(dir, 'dz', '.gitignore'), 'utf8'))
        .toBe('config.local.yaml\n.lock\n');
    });
  });

  it('emits a json payload on stdout with --json and nothing on stderr', () => {
    withTempProject((dir) => {
      const r = dz(['init', '--name', 'demo', '--json'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout).name).toBe('demo');
      expect(r.stderr).toBe('');
    });
  });

  it('defaults the project name to the directory name', () => {
    withTempProject((dir) => {
      dz(['init'], { cwd: dir });
      const cfg = fs.readFileSync(path.join(dir, 'dz', 'config.yaml'), 'utf8');
      expect(cfg).toContain(path.basename(dir));
    });
  });

  it('still succeeds when no VCS identity can be probed, and says what to do', () => {
    withTempProject((dir) => {
      const r = dz(['init'], { cwd: dir, env: { PATH: '/nonexistent', DZ_AUTHOR: '' } });
      expect(r.code).toBe(0);
      expect(r.stdout + r.stderr).toContain('DZ_AUTHOR');
    });
  });
});

describe('cli plumbing', () => {
  it('exits 2 on an unknown command', () => {
    withTempProject((dir) => {
      expect(dz(['bogus'], { cwd: dir }).code).toBe(2);
    });
  });

  it('exits 2 on an unknown command with a plain-text stderr message when not --json', () => {
    withTempProject((dir) => {
      const r = dz(['bogus'], { cwd: dir });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("unknown command 'bogus'");
    });
  });

  it('reports a commander usage error as json on stderr with empty stdout', () => {
    withTempProject((dir) => {
      const r = dz(['bogus', '--json'], { cwd: dir });
      expect(r.code).toBe(2);
      expect(r.stdout).toBe('');
      expect(JSON.parse(r.stderr).error.code).toBe('USAGE_ERROR');
    });
  });

  it('exits 0 for --help and writes to stdout', () => {
    withTempProject((dir) => {
      const r = dz(['--help'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('init');
    });
  });

  it('does not turn --help into an error when combined with --json', () => {
    withTempProject((dir) => {
      const r = dz(['--help', '--json'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('init');
    });
  });

  it('reports NO_PROJECT as json on stderr with empty stdout', () => {
    withTempProject((dir) => {
      const r = dz(['list', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(JSON.parse(r.stderr).error.code).toBe('NO_PROJECT');
    });
  });
});

describe('dz init rejects an unusable probed identity', () => {
  /** A fake `git` on PATH that reports the given user.name. */
  function fakeGit(dir: string, name: string): string {
    const bin = path.join(dir, 'fakebin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(
      path.join(bin, 'git'),
      // `git config user.name` puts the key in $2, not $3.
      `#!/bin/sh\ncase "$2" in\n  user.name) printf '%s\\n' '${name}' ;;\n  user.email) echo 'j@example.com' ;;\nesac\n`,
    );
    fs.chmodSync(path.join(bin, 'git'), 0o755);
    return bin;
  }

  it('does not store an author containing a double space', () => {
    withTempProject((dir) => {
      // A double space is what the log grammar uses to separate fields, so
      // storing this would init cleanly and then break every later command.
      const bin = fakeGit(dir, 'Jane  Doe');
      const r = dz(['init'], { cwd: dir, env: { PATH: bin, DZ_AUTHOR: '' } });

      expect(r.code).toBe(0);
      expect(r.stdout).toContain('double space');
      expect(fs.existsSync(path.join(dir, 'dz', 'config.local.yaml'))).toBe(false);
    });
  });

  it('reports the rejected identity in --json mode', () => {
    withTempProject((dir) => {
      const bin = fakeGit(dir, 'Jane  Doe');
      const r = dz(['init', '--json'], { cwd: dir, env: { PATH: bin, DZ_AUTHOR: '' } });

      const out = JSON.parse(r.stdout);
      expect(out.author).toBeNull();
      expect(out.authorRejected).toBe('Jane  Doe <j@example.com>');
    });
  });

  it('still stores an ordinary identity', () => {
    withTempProject((dir) => {
      const bin = fakeGit(dir, 'Jane Doe');
      const r = dz(['init', '--json'], { cwd: dir, env: { PATH: bin, DZ_AUTHOR: '' } });

      expect(JSON.parse(r.stdout).author).toBe('Jane Doe <j@example.com>');
      expect(fs.existsSync(path.join(dir, 'dz', 'config.local.yaml'))).toBe(true);
    });
  });
});

describe('dz with no subcommand', () => {
  it('does not leak commander’s placeholder into the json envelope', () => {
    withTempProject((dir) => {
      const r = dz(['--json'], { cwd: dir });
      expect(r.code).toBe(2);
      expect(r.stdout).toBe('');
      const err = JSON.parse(r.stderr).error;
      expect(err.code).toBe('USAGE_ERROR');
      expect(err.message).not.toContain('outputHelp');
      expect(err.message).toContain('subcommand is required');
    });
  });
});

describe('dz init inside an existing project', () => {
  it('refuses, naming the project it would be shadowed by', () => {
    withTempProject((dir) => {
      dz(['init', '--name', 'outer'], { cwd: dir });
      const sub = path.join(dir, 'sub');
      fs.mkdirSync(sub);

      const r = dz(['init', '--json'], { cwd: sub });
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      const err = JSON.parse(r.stderr).error;
      expect(err.code).toBe('INVALID_FIELD');
      expect(err.message).toContain('--nested');
      expect(fs.existsSync(path.join(sub, 'dz'))).toBe(false);
    });
  });

  it('creates the nested project when asked explicitly', () => {
    withTempProject((dir) => {
      dz(['init', '--name', 'outer'], { cwd: dir });
      const sub = path.join(dir, 'sub');
      fs.mkdirSync(sub);

      const r = dz(['init', '--name', 'inner', '--nested'], { cwd: sub });
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(sub, 'dz', 'config.yaml'))).toBe(true);
    });
  });

  it('still allows re-running init in a project root, which is not nesting', () => {
    withTempProject((dir) => {
      dz(['init', '--name', 'demo'], { cwd: dir });
      expect(dz(['init', '--name', 'demo'], { cwd: dir }).code).toBe(0);
    });
  });
});

describe('dz init is safe to re-run', () => {
  it('keeps other lines in a customised dz/.gitignore', () => {
    withTempProject((dir) => {
      dz(['init', '--name', 'demo'], { cwd: dir });
      const ignore = path.join(dir, 'dz', '.gitignore');
      fs.writeFileSync(ignore, 'config.local.yaml\nmy-custom-entry\n');

      dz(['init', '--name', 'demo'], { cwd: dir });

      const after = fs.readFileSync(ignore, 'utf8');
      expect(after).toContain('my-custom-entry');
      expect(after).toContain('config.local.yaml');
    });
  });

  it('adds the required line back if it was removed, without discarding the rest', () => {
    withTempProject((dir) => {
      dz(['init', '--name', 'demo'], { cwd: dir });
      const ignore = path.join(dir, 'dz', '.gitignore');
      fs.writeFileSync(ignore, 'my-custom-entry\n');

      dz(['init', '--name', 'demo'], { cwd: dir });

      const after = fs.readFileSync(ignore, 'utf8');
      expect(after).toContain('my-custom-entry');
      expect(after).toContain('config.local.yaml');
    });
  });

  it('does not overwrite an author the user set by hand', () => {
    withTempProject((dir) => {
      dz(['init', '--name', 'demo'], { cwd: dir });
      const local = path.join(dir, 'dz', 'config.local.yaml');
      fs.writeFileSync(local, 'author: Custom Person <c@example.com>\n');

      dz(['init', '--name', 'demo'], { cwd: dir });

      expect(fs.readFileSync(local, 'utf8')).toContain('Custom Person');
    });
  });

  it('reports the name actually configured, not the one requested', () => {
    withTempProject((dir) => {
      dz(['init', '--name', 'first'], { cwd: dir });
      const r = dz(['init', '--name', 'second', '--json'], { cwd: dir });

      const out = JSON.parse(r.stdout);
      expect(out.name).toBe('first');
      expect(out.requestedName).toBe('second');
      expect(fs.readFileSync(path.join(dir, 'dz', 'config.yaml'), 'utf8')).toContain('name: first');
    });
  });
});
