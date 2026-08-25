/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dz, withTempProject } from '../helpers.js';

/** An $EDITOR that applies `sed` to whatever file it is given. */
function editorApplying(dir: string, sedExpr: string): string {
  const bin = path.join(dir, `ed-${Math.random().toString(36).slice(2)}.sh`);
  fs.writeFileSync(bin, `#!/bin/sh\nsed -i '${sedExpr}' "$1"\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

function project<T>(fn: (dir: string, id: string, file: string) => T): T {
  return withTempProject((dir) => {
    dz(['init', '--name', 'demo'], { cwd: dir });
    const full = JSON.parse(dz(['add', 'Editable', '--json'], { cwd: dir }).stdout).id;
    const file = path.join(dir, 'dz', 'issues', `${full}.md`);
    return fn(dir, full.slice(0, 13), file);
  });
}

describe('dz edit', () => {
  it('applies a valid edit', () => {
    project((dir, id) => {
      const editor = editorApplying(dir, 's/^title: .*/title: Edited/');
      const r = dz(['edit', id], { cwd: dir, env: { EDITOR: editor } });
      expect(r.code).toBe(0);
      expect(JSON.parse(dz(['show', id, '--json'], { cwd: dir }).stdout).title).toBe('Edited');
    });
  });

  it('appends no log entry, because the tool cannot know what changed', () => {
    project((dir, id) => {
      const before = JSON.parse(dz(['show', id, '--json'], { cwd: dir }).stdout).log.length;
      const editor = editorApplying(dir, 's/^title: .*/title: Edited/');
      dz(['edit', id], { cwd: dir, env: { EDITOR: editor } });
      expect(JSON.parse(dz(['show', id, '--json'], { cwd: dir }).stdout).log).toHaveLength(before);
    });
  });

  it('leaves the real file untouched when the edit is invalid', () => {
    project((dir, id, file) => {
      const original = fs.readFileSync(file, 'utf8');
      const editor = editorApplying(dir, 's/^status: .*/status: banana/');

      const r = dz(['edit', id, '--json'], { cwd: dir, env: { EDITOR: editor } });

      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('PARSE_ERROR');
      // The old behaviour left the broken text on disk. Now the real file is
      // never written unless the edit parses.
      expect(fs.readFileSync(file, 'utf8')).toBe(original);
    });
  });

  it('preserves the user’s work in a scratch file and names it', () => {
    project((dir, id) => {
      const editor = editorApplying(dir, 's/^status: .*/status: banana/');
      const r = dz(['edit', id, '--json'], { cwd: dir, env: { EDITOR: editor } });
      const scratch = JSON.parse(r.stderr).error.message.match(/(\S+\.md)/)?.[1];
      expect(scratch, 'the error must name the scratch file').toBeDefined();
      expect(fs.readFileSync(String(scratch), 'utf8')).toContain('status: banana');
      fs.rmSync(String(scratch), { force: true });
    });
  });

  it('does not put the scratch file in dz/issues', () => {
    project((dir, id) => {
      // A *.md file there is read as an issue, so a concurrent list would
      // report it as a duplicate.
      const editor = editorApplying(dir, 's/^title: .*/title: Edited/');
      dz(['edit', id], { cwd: dir, env: { EDITOR: editor } });
      const names = fs.readdirSync(path.join(dir, 'dz', 'issues'));
      expect(names).toHaveLength(1);
      expect(dz(['list'], { cwd: dir }).code).toBe(0);
    });
  });

  it('holds no lock while the editor runs', () => {
    project((dir, id) => {
      // The editor asserts, from inside the session, that another command can
      // still mutate the project. That is the entire point of the design.
      const probe = path.join(dir, 'probe.txt');
      const bin = path.join(dir, 'ed-probe.sh');
      const dzBin = path.resolve('dist/cli/main.js');
      fs.writeFileSync(bin,
        `#!/bin/sh\n`
        + `cd "${dir}" && DZ_LOCK_TIMEOUT_MS=0 node "${dzBin}" add "made during edit" > "${probe}" 2>&1\n`
        + `echo "exit=$?" >> "${probe}"\n`
        + `sed -i 's/^title: .*/title: Edited/' "$1"\n`);
      fs.chmodSync(bin, 0o755);

      const r = dz(['edit', id], { cwd: dir, env: { EDITOR: bin } });
      expect(r.code).toBe(0);
      expect(fs.readFileSync(probe, 'utf8')).toContain('exit=0');
    });
  });

  // There is no interactive path: the conflict prompt from the design is
  // deferred, so this is what happens whether or not stdin is a terminal.
  it('refuses when the issue changed while the editor was open', () => {
    project((dir, id, file) => {
      const bin = path.join(dir, 'ed-racer.sh');
      fs.writeFileSync(bin,
        `#!/bin/sh\n`
        // Change the real file behind the editor's back, then edit the scratch.
        + `sed -i 's/^title: .*/title: Changed By Someone Else/' "${file}"\n`
        + `sed -i 's/^title: .*/title: My Edit/' "$1"\n`);
      fs.chmodSync(bin, 0o755);

      const r = dz(['edit', id, '--json'], { cwd: dir, env: { EDITOR: bin } });

      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('CONCURRENT_MODIFICATION');
      // The other writer's change stands; ours is preserved in the scratch.
      expect(fs.readFileSync(file, 'utf8')).toContain('Changed By Someone Else');
      expect(JSON.parse(r.stderr).error.message).toMatch(/\S+\.md/);
    });
  });

  it('refuses an edit that changes the id, and touches nothing', () => {
    project((dir, id, file) => {
      const other = JSON.parse(dz(['add', 'Other', '--json'], { cwd: dir }).stdout).id;
      const before = fs.readdirSync(path.join(dir, 'dz', 'issues')).sort();
      const otherBefore = fs.readFileSync(path.join(dir, 'dz', 'issues', `${other}.md`), 'utf8');
      const original = fs.readFileSync(file, 'utf8');

      // Retarget this issue at the other one: without the guard this would
      // overwrite Other and leave Editable untouched.
      const editor = editorApplying(dir, `s|^id: .*|id: ${other}|`);
      const r = dz(['edit', id, '--json'], { cwd: dir, env: { EDITOR: editor } });

      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('INVALID_FIELD');
      expect(fs.readdirSync(path.join(dir, 'dz', 'issues')).sort()).toEqual(before);
      expect(fs.readFileSync(file, 'utf8')).toBe(original);
      expect(fs.readFileSync(path.join(dir, 'dz', 'issues', `${other}.md`), 'utf8'))
        .toBe(otherBefore);
    });
  });

  it('re-validates under the lock, catching config that changed mid-session', () => {
    project((dir, id) => {
      dz(['component', 'add', 'cli'], { cwd: dir });
      dz(['set', id, '--component', 'cli'], { cwd: dir });

      // The editor removes the component the issue uses, then makes an edit
      // that was valid when the session started.
      const dzBin = path.resolve('dist/cli/main.js');
      const bin = path.join(dir, 'ed-rmcomp.sh');
      fs.writeFileSync(bin,
        `#!/bin/sh
`
        + `cd "${dir}" && node "${dzBin}" component rm cli --force >/dev/null 2>&1
`
        + `sed -i 's/^title: .*/title: Edited/' "$1"
`);
      fs.chmodSync(bin, 0o755);

      const r = dz(['edit', id, '--json'], { cwd: dir, env: { EDITOR: bin } });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('INVALID_FIELD');
    });
  });

  it('errors when no editor is configured', () => {
    project((dir, id) => {
      const r = dz(['edit', id], { cwd: dir, env: { EDITOR: '', VISUAL: '' } });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('EDITOR');
    });
  });

  it('handles a scratch path containing a space, which is what shellQuote is for', () => {
    withTempProject((base) => {
      const dir = path.join(base, 'my projects');
      fs.mkdirSync(dir);
      // The shell string is built from the scratch path, and the scratch lives
      // under os.tmpdir(). A space in the project path alone never reaches
      // shellQuote, so TMPDIR is where it has to go for this to discriminate.
      const tmp = path.join(base, 'tmp with space');
      fs.mkdirSync(tmp);
      const env = { EDITOR: '', TMPDIR: tmp };

      dz(['init', '--name', 'spaced'], { cwd: dir, env });
      const id = JSON.parse(dz(['add', 'Spaced', '--json'], { cwd: dir, env }).stdout)
        .id.slice(0, 13);
      // The editor binary itself is interpolated unquoted, as $EDITOR always
      // is, so it stays on a path with no space in it.
      env.EDITOR = editorApplying(base, 's/^title: .*/title: Edited/');

      const r = dz(['edit', id], { cwd: dir, env });
      expect(r.code).toBe(0);
      expect(JSON.parse(dz(['show', id, '--json'], { cwd: dir, env }).stdout).title)
        .toBe('Edited');
    });
  });
});

describe('dz edit refuses what the published schema forbids', () => {
  // The schema promises a non-empty title and RFC 3339 timestamps. Only edit
  // can put anything else in a file, so only edit can break that promise.
  const cases: Array<[string, string, string]> = [
    ['an empty title', 's/^title: .*/title: ""/', 'empty title'],
    ['a whitespace-only title', 's/^title: .*/title: "   "/', 'empty title'],
    ['a created that is not a timestamp', 's/^created: .*/created: yesterday/', 'ISO 8601'],
    [
      'a created that looks right but is not a real day',
      's/^created: .*/created: 2026-02-31T00:00:00.000Z/',
      'ISO 8601',
    ],
  ];

  for (const [what, sed, expected] of cases) {
    it(`rejects ${what}`, () => {
      project((dir, id, file) => {
        const original = fs.readFileSync(file, 'utf8');
        const r = dz(['edit', id], { cwd: dir, env: { EDITOR: editorApplying(dir, sed) } });

        expect(r.code).toBe(1);
        expect(r.stderr).toContain(expected);
        // The file on disk is what the schema is a promise about.
        expect(fs.readFileSync(file, 'utf8')).toBe(original);
      });
    });
  }

  it('still accepts a non-UTC offset, which is a valid RFC 3339 time', () => {
    project((dir, id) => {
      const editor = editorApplying(dir, 's/^created: .*/created: 2026-08-24T02:00:00+05:00/');
      expect(dz(['edit', id], { cwd: dir, env: { EDITOR: editor } }).code).toBe(0);
    });
  });
});

describe('dz edit distinguishes a bad edit from a broken machine', () => {
  // Running as root defeats the permission bit this relies on.
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  it.skipIf(asRoot)('reports a failed write as internal, not as a validation error', () => {
    project((dir, id) => {
      const issues = path.join(dir, 'dz', 'issues');
      const editor = editorApplying(dir, 's/^title: .*/title: Edited/');
      fs.chmodSync(issues, 0o500);
      try {
        const r = dz(['edit', id, '--json'], { cwd: dir, env: { EDITOR: editor } });

        // The edit itself was perfectly valid; the disk refused it. Reporting
        // INVALID_FIELD and exit 1 blames the user, and emits a code that is
        // not in the schema's enum when the raw errno leaks through.
        expect(r.code).toBe(3);
        expect(JSON.parse(r.stderr).error.code).toBe('INTERNAL');
      } finally {
        fs.chmodSync(issues, 0o700);
      }
    });
  });
});

