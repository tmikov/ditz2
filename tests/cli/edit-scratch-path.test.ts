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
import { SED_I, ptyPipeline, shq } from '../pty.js';

/**
 * Where `dz edit` tells the operator their work went when the locked save
 * fails.
 *
 * `readEdited` validates before the lock and reports against the scratch file,
 * so most bad edits are named there. The gap is the conflict prompt: it sits
 * between that check and the locked save, and it waits on a human. A writer
 * landing in that window can invalidate an edit that was fine when it was
 * checked, and the save then fails with the operator's only copy sitting in a
 * temporary directory. Nothing but the error message names it.
 *
 * This is also the only test that reaches the in-lock `validateIssue` in
 * `api/write.ts`, so its ordering is enforced by observation rather than by
 * sleeping: the racing writer waits until the prompt appears in the pty
 * transcript, and the answer waits until that writer has finished. `script -f`
 * is what makes the transcript readable while it is still being written.
 */

/** A bounded poll, so a missed condition fails the test rather than hanging. */
function until(cond: string): string {
  return `i=0; while [ $i -lt 200 ] && ! ${cond}; do i=$((i+1)); sleep 0.05; done`;
}

interface Run { output: string; code: number }

/** A project whose one issue uses a component, which is what gets invalidated. */
function project<T>(fn: (dir: string, id: string, file: string) => T): T {
  return withTempProject((dir) => {
    dz(['init', '--name', 'demo'], { cwd: dir });
    dz(['component', 'add', 'cli'], { cwd: dir });
    const full = JSON.parse(
      dz(['add', 'Editable', '--component', 'cli', '--json'], { cwd: dir }).stdout,
    ).id;
    return fn(dir, full.slice(0, 13), path.join(dir, 'dz', 'issues', `${full}.md`));
  });
}

describe('dz edit names the scratch file when the locked save fails', () => {
  it('points at the surviving edit when a writer lands while the prompt waits', () => {
    project((dir, id, file) => {
      const transcript = path.join(dir, 'pty-transcript');
      const flag = path.join(dir, 'component-removed');

      // Two things happen here. The editor changes the real file, which is the
      // conflict that raises the prompt. It also leaves behind a writer that
      // removes the component, held back until the prompt is actually on
      // screen -- that is what puts it strictly after the pre-lock check,
      // which therefore still saw a valid edit.
      const editor = path.join(dir, 'ed-race.sh');
      fs.writeFileSync(editor,
        '#!/bin/sh\n'
        + '(\n'
        + `  ${until(`grep -q 'changed while your editor was open' ${shq(transcript)} 2>/dev/null`)}\n`
        + `  cd ${shq(dir)} && ${shq(process.execPath)} ${shq(DZ_BIN)} `
        + 'component rm cli --force >/dev/null 2>&1\n'
        + `  touch ${shq(flag)}\n`
        + ') &\n'
        + `${SED_I} 's/^title: .*/title: Someone Else/' ${shq(file)}\n`
        + `${SED_I} 's/^title: .*/title: Mine/' "$1"\n`);
      fs.chmodSync(editor, 0o755);

      // The prompt needs a real terminal, and the answer has to be withheld
      // until the racing writer has finished. spawnSync delivers `input` as
      // soon as it is read, so the gate has to live in the pipeline itself.
      const inner = `${shq(process.execPath)} ${shq(DZ_BIN)} edit ${shq(id)}`;
      const runner = path.join(dir, 'run.sh');
      fs.writeFileSync(runner,
        '#!/bin/sh\n'
        + `${ptyPipeline(
          `( ${until(`[ -f ${shq(flag)} ]`)}; printf 'f\\n' )`,
          inner,
          { transcript, flush: true },
        )}\n`);
      fs.chmodSync(runner, 0o755);

      const r = spawnSync(runner, [], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, DZ_AUTHOR: 'Test User <test@example.com>', EDITOR: editor },
      });
      const run: Run = { output: `${r.stdout ?? ''}${r.stderr ?? ''}`, code: r.status ?? 1 };

      // The prompt really was reached, so the pre-lock check really did pass.
      expect(run.output).toContain('changed while your editor was open');
      expect(run.code).toBe(1);
      expect(run.output).toContain('is not a configured component');

      // The point of the test: the failure names the scratch file, and the
      // path it names really holds the work. A message pointing nowhere would
      // be worse than none.
      const kept = (/your edit is at (\S+)/.exec(run.output) ?? [, ''])[1] as string;
      expect(kept).not.toBe('');
      expect(fs.existsSync(kept)).toBe(true);
      expect(fs.readFileSync(kept, 'utf8')).toContain('title: Mine');

      // And nothing was written, so the other writer's version still stands.
      expect(fs.readFileSync(file, 'utf8')).toContain('title: Someone Else');
    });
  }, 20000);

  it('says nothing about the edit when the failure is a lock someone else holds', () => {
    project((dir, id) => {
      // A held lock is not a judgement about this edit. Appending "the issue
      // was not changed; your edit is at ..." would read as a rejection of it.
      const editor = path.join(dir, 'ed-lock.sh');
      fs.writeFileSync(editor,
        '#!/bin/sh\n'
        + `printf 'held by someone' > ${shq(path.join(dir, 'dz', '.lock'))}\n`
        + `${SED_I} 's/^title: .*/title: Mine/' "$1"\n`);
      fs.chmodSync(editor, 0o755);

      const r = dz(['edit', id, '--json'], {
        cwd: dir,
        env: { EDITOR: editor, DZ_LOCK_TIMEOUT_MS: '0' },
      });

      const err = JSON.parse(r.stderr).error;
      expect(err.code).toBe('LOCKED');
      expect(err.message).not.toContain('your edit is at');
    });
  });
});
