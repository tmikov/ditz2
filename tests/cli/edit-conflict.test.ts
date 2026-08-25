/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DZ_BIN, dz, withTempProject } from '../helpers.js';

/**
 * What `dz edit` does when the issue changed while the editor was open.
 *
 * The interactive half needs a real terminal, because the prompt is gated on
 * `process.stdin.isTTY` — a pipe is exactly the case that must NOT prompt.
 * `script -qec` allocates a pty and runs the command inside it, which is the
 * only way to exercise the path an actual user takes. It merges stdout and
 * stderr into the one pty, so those tests assert on combined output and, more
 * importantly, on what ends up on disk.
 */

function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

interface Run { output: string; code: number }

/** Runs dz attached to a pty, feeding `input` as the operator's typing. */
function ptyDz(args: string[], cwd: string, input: string, editor: string): Run {
  const cmd = [process.execPath, DZ_BIN, ...args].map(shq).join(' ');
  const r = spawnSync('script', ['-qec', cmd, '/dev/null'], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...process.env, DZ_AUTHOR: 'Test User <test@example.com>', EDITOR: editor },
  });
  return { output: `${r.stdout ?? ''}${r.stderr ?? ''}`, code: r.status ?? 1 };
}

/**
 * An $EDITOR that changes the real issue file behind its own back before
 * editing the scratch, which is the conflict this whole feature is about.
 */
function racingEditor(dir: string, target: string, title: string): string {
  const bin = path.join(dir, `ed-race-${Math.random().toString(36).slice(2)}.sh`);
  fs.writeFileSync(bin,
    '#!/bin/sh\n'
    + `sed -i 's/^title: .*/title: Someone Else/' ${shq(target)}\n`
    + `sed -i 's/^title: .*/title: ${title}/' "$1"\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

function project<T>(fn: (dir: string, id: string, file: string) => T): T {
  return withTempProject((dir) => {
    dz(['init', '--name', 'demo'], { cwd: dir });
    const full = JSON.parse(dz(['add', 'Editable', '--json'], { cwd: dir }).stdout).id;
    return fn(dir, full.slice(0, 13), path.join(dir, 'dz', 'issues', `${full}.md`));
  });
}

function titleOf(file: string): string {
  return (/^title: (.*)$/m.exec(fs.readFileSync(file, 'utf8')) ?? [, ''])[1] as string;
}

describe('dz edit --on-conflict', () => {
  it('aborts, leaving the other writer\'s version in place', () => {
    project((dir, id, file) => {
      const editor = racingEditor(dir, file, 'Mine');
      const r = dz(['edit', id, '--json', '--on-conflict', 'abort'], {
        cwd: dir, env: { EDITOR: editor },
      });

      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('CONCURRENT_MODIFICATION');
      expect(titleOf(file)).toBe('Someone Else');
    });
  });

  it('forces, and keeps the version it overwrote', () => {
    project((dir, id, file) => {
      const editor = racingEditor(dir, file, 'Mine');
      const r = dz(['edit', id, '--on-conflict', 'force'], {
        cwd: dir, env: { EDITOR: editor },
      });

      expect(r.code).toBe(0);
      expect(titleOf(file)).toBe('Mine');

      // edit writes no log entry, so without this the overwritten version
      // would leave no trace that it ever existed.
      const kept = (/kept at (\S+)/.exec(r.stderr) ?? [, ''])[1] as string;
      expect(kept).not.toBe('');
      expect(fs.readFileSync(kept, 'utf8')).toContain('Someone Else');
    });
  });

  it('rejects an unknown action', () => {
    project((dir, id) => {
      const r = dz(['edit', id, '--json', '--on-conflict', 'merge'], {
        cwd: dir, env: { EDITOR: '/bin/true' },
      });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('INVALID_FIELD');
    });
  });

  it('does not accept reload, which needs a terminal it cannot have', () => {
    project((dir, id) => {
      const r = dz(['edit', id, '--json', '--on-conflict', 'reload'], {
        cwd: dir, env: { EDITOR: '/bin/true' },
      });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('INVALID_FIELD');
    });
  });

  it('never prompts without a terminal, even with no flag', () => {
    project((dir, id, file) => {
      const editor = racingEditor(dir, file, 'Mine');
      // stdin is a pipe here. Prompting would hang the run forever.
      const r = dz(['edit', id, '--json'], { cwd: dir, env: { EDITOR: editor }, input: 'f\n' });

      expect(r.code).toBe(1);
      expect(JSON.parse(r.stderr).error.code).toBe('CONCURRENT_MODIFICATION');
      expect(titleOf(file)).toBe('Someone Else');
    });
  });

  it('never prompts under --json even on a terminal', () => {
    project((dir, id, file) => {
      const r = ptyDz(['edit', id, '--json'], dir, 'f\n', racingEditor(dir, file, 'Mine'));

      expect(r.code).toBe(1);
      expect(r.output).not.toContain('changed while your editor was open');
      expect(titleOf(file)).toBe('Someone Else');
    });
  });
});

describe('dz edit prompts on a terminal', () => {
  it('aborts on a', () => {
    project((dir, id, file) => {
      const r = ptyDz(['edit', id], dir, 'a\n', racingEditor(dir, file, 'Mine'));

      expect(r.output).toContain('changed while your editor was open');
      expect(r.code).toBe(1);
      expect(titleOf(file)).toBe('Someone Else');
    });
  });

  it('forces on f', () => {
    project((dir, id, file) => {
      const r = ptyDz(['edit', id], dir, 'f\n', racingEditor(dir, file, 'Mine'));

      expect(r.code).toBe(0);
      expect(titleOf(file)).toBe('Mine');
    });
  });

  it('aborts at end of input, because refusing to answer must destroy nothing', () => {
    project((dir, id, file) => {
      const r = ptyDz(['edit', id], dir, '', racingEditor(dir, file, 'Mine'));

      expect(r.code).toBe(1);
      expect(titleOf(file)).toBe('Someone Else');
    });
  });

  it('asks again when the answer is not one of the letters', () => {
    project((dir, id, file) => {
      const r = ptyDz(['edit', id], dir, 'yes\nq\na\n', racingEditor(dir, file, 'Mine'));

      expect(r.output).toContain('is not one of');
      expect(r.code).toBe(1);
      expect(titleOf(file)).toBe('Someone Else');
    });
  });

  it('reloads on r, reopening the editor on the newer version', () => {
    project((dir, id, file) => {
      // The other writer changes a DIFFERENT field from the one being edited,
      // so after a reload both changes are visible in the saved file. That is
      // what distinguishes a real reload from simply retrying the old edit.
      const bin = path.join(dir, 'ed-twice.sh');
      const counter = path.join(dir, 'runs');
      fs.writeFileSync(bin,
        '#!/bin/sh\n'
        + `n=$(cat ${shq(counter)} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${shq(counter)}\n`
        + 'if [ "$n" = 1 ]; then\n'
        + `  sed -i 's/^assignee: .*/assignee: someone-else/' ${shq(file)}\n`
        + "  sed -i 's/^title: .*/title: My First Try/' \"$1\"\n"
        + 'else\n'
        + "  sed -i 's/^title: .*/title: Reloaded Edit/' \"$1\"\n"
        + 'fi\n');
      fs.chmodSync(bin, 0o755);

      const r = ptyDz(['edit', id], dir, 'r\n', bin);

      expect(r.code).toBe(0);
      // The editor really did run a second time.
      expect(fs.readFileSync(counter, 'utf8').trim()).toBe('2');

      const saved = fs.readFileSync(file, 'utf8');
      expect(saved).toContain('assignee: someone-else'); // survived
      expect(saved).toContain('title: Reloaded Edit');   // applied on top
      expect(saved).not.toContain('My First Try');       // the stale edit is gone

      // The discarded first attempt is still on disk somewhere findable.
      const kept = (/kept at (\S+)/.exec(r.output) ?? [, ''])[1] as string;
      expect(kept).not.toBe('');
      expect(fs.readFileSync(kept.trim(), 'utf8')).toContain('My First Try');
    });
  });
});
