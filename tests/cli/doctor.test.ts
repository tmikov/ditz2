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
    fs.writeFileSync(
      path.join(dir, 'dz', 'config.yaml'),
      'name: demo\ncomponents:\n  - core\n',
    );
    return fn(dir);
  });
}

/** The codes doctor reported, via --json so the assertion is not on prose. */
function codes(dir: string): string[] {
  const r = dz(['doctor', '--json'], { cwd: dir });
  return JSON.parse(r.stdout).problems.map((p: { code: string }) => p.code);
}

describe('dz doctor on a healthy project', () => {
  it('reports nothing and exits 0', () => {
    project((dir) => {
      dz(['add', 'fine', '--component', 'core'], { cwd: dir });
      const r = dz(['doctor'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('no problems found');
      expect(r.stderr).toBe('');
    });
  });

  it('emits an empty problems array under --json', () => {
    project((dir) => {
      const r = dz(['doctor', '--json'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ problems: [] });
    });
  });

  it('requires a project, like every other command', () => {
    withTempProject((dir) => {
      const r = dz(['doctor', '--json'], { cwd: dir });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('NO_PROJECT');
    });
  });
});

describe('dz doctor finds what nothing else reports', () => {
  it('a missing dz/.gitignore, which would leak the identity file', () => {
    project((dir) => {
      fs.rmSync(path.join(dir, 'dz', '.gitignore'));
      expect(codes(dir)).toContain('GITIGNORE_MISSING');
      // Nothing else notices this at all.
      expect(dz(['list'], { cwd: dir }).code).toBe(0);
    });
  });

  it('a dz/.gitignore that no longer ignores the identity file', () => {
    project((dir) => {
      fs.writeFileSync(path.join(dir, 'dz', '.gitignore'), '# emptied\n');
      expect(codes(dir)).toContain('GITIGNORE_INCOMPLETE');
    });
  });

  it('a dz/.gitignore predating the lock, which would let .lock be committed', () => {
    project((dir) => {
      // What every project created before the lock shipped looks like. A
      // committed .lock names a foreign host, so lockState reads it as active
      // forever and no dz command can get rid of it for good.
      fs.writeFileSync(path.join(dir, 'dz', '.gitignore'), 'config.local.yaml\n');
      const problems = JSON.parse(dz(['doctor', '--json'], { cwd: dir }).stdout).problems;
      const missing = problems.find((p: { code: string }) => p.code === 'GITIGNORE_INCOMPLETE');
      expect(missing, 'doctor must not certify a .gitignore init would add to').toBeDefined();
      expect(missing.message).toContain('.lock');
    });
  });

  it('is satisfied by exactly what dz init writes, so init makes doctor quiet', () => {
    project((dir) => {
      // The drift this pairs with: doctor kept its own copy of the required
      // lines and went stale when init's list grew.
      fs.rmSync(path.join(dir, 'dz', '.gitignore'));
      expect(codes(dir)).toContain('GITIGNORE_MISSING');
      dz(['init'], { cwd: dir });
      expect(codes(dir)).not.toContain('GITIGNORE_MISSING');
      expect(codes(dir)).not.toContain('GITIGNORE_INCOMPLETE');
    });
  });

  it('a config.yaml whose components are silently ignored', () => {
    project((dir) => {
      fs.writeFileSync(path.join(dir, 'dz', 'config.yaml'), 'name: demo\ncomponents: nope\n');
      expect(codes(dir)).toContain('CONFIG_MALFORMED');
    });
  });

  it('a config.yaml that is not valid YAML', () => {
    project((dir) => {
      fs.writeFileSync(path.join(dir, 'dz', 'config.yaml'), 'name: [unclosed\n');
      expect(codes(dir)).toContain('CONFIG_UNREADABLE');
    });
  });

  it('an issue naming a component that has since been removed', () => {
    project((dir) => {
      dz(['add', 'uses core', '--component', 'core'], { cwd: dir });
      fs.writeFileSync(path.join(dir, 'dz', 'config.yaml'), 'name: demo\ncomponents: []\n');
      expect(codes(dir)).toContain('UNKNOWN_COMPONENT');
    });
  });

  it('a temp file left behind by an interrupted write', () => {
    project((dir) => {
      fs.writeFileSync(path.join(dir, 'dz', 'issues', 'x.md.tmp-123-0'), '');
      expect(codes(dir)).toContain('ORPHANED_TEMP_FILE');
    });
  });

  it('an unparseable issue file, with the code list and grep use', () => {
    project((dir) => {
      fs.writeFileSync(path.join(dir, 'dz', 'issues', 'bad.md'), 'garbage\n');
      expect(codes(dir)).toContain('PARSE_ERROR');
    });
  });
});

describe('dz doctor output', () => {
  it('carries a remedy for every problem, since diagnosing without one is useless', () => {
    project((dir) => {
      fs.rmSync(path.join(dir, 'dz', '.gitignore'));
      fs.writeFileSync(path.join(dir, 'dz', 'issues', 'bad.md'), 'garbage\n');
      const problems = JSON.parse(dz(['doctor', '--json'], { cwd: dir }).stdout).problems;
      expect(problems.length).toBeGreaterThan(1);
      for (const p of problems) {
        expect(typeof p.code).toBe('string');
        expect(p.remedy.length).toBeGreaterThan(0);
        expect(p.message.length).toBeGreaterThan(0);
      }
    });
  });

  it('exits 1 when it finds problems, so a script can branch on it', () => {
    project((dir) => {
      fs.rmSync(path.join(dir, 'dz', '.gitignore'));
      expect(dz(['doctor'], { cwd: dir }).code).toBe(1);
    });
  });

  it('changes nothing on disk, because it only diagnoses', () => {
    project((dir) => {
      dz(['add', 'untouched', '--component', 'core'], { cwd: dir });
      fs.rmSync(path.join(dir, 'dz', '.gitignore'));
      const before = fs.readdirSync(path.join(dir, 'dz', 'issues')).sort();
      const issue = fs.readFileSync(
        path.join(dir, 'dz', 'issues', before[0]),
        'utf8',
      );

      dz(['doctor'], { cwd: dir });

      expect(fs.readdirSync(path.join(dir, 'dz', 'issues')).sort()).toEqual(before);
      expect(fs.readFileSync(path.join(dir, 'dz', 'issues', before[0]), 'utf8')).toBe(issue);
      // Notably it does not helpfully recreate the .gitignore it complained about.
      expect(fs.existsSync(path.join(dir, 'dz', '.gitignore'))).toBe(false);
    });
  });
});

describe('dz doctor catches what the review found silent', () => {
  it('a missing dz/issues directory, which otherwise reads as an empty project', () => {
    project((dir) => {
      fs.rmSync(path.join(dir, 'dz', 'issues'), { recursive: true });
      expect(dz(['list'], { cwd: dir }).code).toBe(0); // still looks fine
      expect(codes(dir)).toContain('ISSUES_DIR_MISSING');
    });
  });

  it('an issue violating the resolution invariant', () => {
    project((dir) => {
      const id = JSON.parse(dz(['add', 'open one', '--json'], { cwd: dir }).stdout)
        .id.slice(0, 13);
      const issues = path.join(dir, 'dz', 'issues');
      const file = path.join(issues, fs.readdirSync(issues)[0]);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('resolution: null', 'resolution: fixed'));

      // show still displays it, deliberately: reads are not validated, so you
      // can always inspect the file you are trying to repair. doctor notices.
      const shown = dz(['show', id, '--json'], { cwd: dir });
      expect(shown.code).toBe(0);
      expect(JSON.parse(shown.stdout).resolution).toBe('fixed');

      expect(codes(dir)).toContain('INVALID_ISSUE');

      // And the mutation path still refuses it, which is the cost doctor exists
      // to make visible ahead of time.
      expect(dz(['comment', id, '-m', 'x'], { cwd: dir }).code).toBe(1);
    });
  });

  it('a component entry that is not a string', () => {
    project((dir) => {
      fs.writeFileSync(
        path.join(dir, 'dz', 'config.yaml'),
        'name: demo\ncomponents:\n  - core\n  - 123\n',
      );
      const problems = JSON.parse(dz(['doctor', '--json'], { cwd: dir }).stdout).problems;
      expect(problems.some((p: { message: string }) => p.message.includes('123'))).toBe(true);
    });
  });
});

describe('dz doctor and the project lock', () => {
  const DEAD_PID = 2147483000;
  function writeLock(dir: string, over: Record<string, unknown> = {}): void {
    fs.writeFileSync(path.join(dir, 'dz', '.lock'), JSON.stringify({
      version: 1, token: 'tok', pid: process.pid,
      hostname: require('node:os').hostname(),
      created: new Date().toISOString(), command: 'set', ...over,
    }));
  }

  it('says nothing about an active lock, which is transient not broken', () => {
    project((dir) => {
      writeLock(dir);
      expect(codes(dir)).not.toContain('ABANDONED_LOCK');
    });
  });

  it('reports an abandoned lock', () => {
    project((dir) => {
      writeLock(dir, { pid: DEAD_PID });
      expect(codes(dir)).toContain('ABANDONED_LOCK');
    });
  });

  it('reports a malformed lock', () => {
    project((dir) => {
      fs.writeFileSync(path.join(dir, 'dz', '.lock'), 'not json');
      expect(codes(dir)).toContain('MALFORMED_LOCK');
    });
  });

  it('points at dz unlock as the remedy', () => {
    project((dir) => {
      writeLock(dir, { pid: DEAD_PID });
      const problems = JSON.parse(dz(['doctor', '--json'], { cwd: dir }).stdout).problems;
      const lock = problems.find((p: { code: string }) => p.code === 'ABANDONED_LOCK');
      expect(lock.remedy).toContain('dz unlock');
    });
  });
});
