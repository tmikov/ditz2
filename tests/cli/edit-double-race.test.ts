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
 * What `dz edit` claims after a forced save that was itself refused.
 *
 * Forcing is a second compare-and-swap, not a bypass, so it can fail: the file
 * can change again while the operator reads the conflict prompt. They are then
 * asked again and nothing is written, so nothing may be announced as
 * overwritten. The aside exists to prove a version was destroyed; naming one
 * for a version that is still on disk is worse than saying nothing.
 *
 * The ordering here is enforced by observation, not by sleeping. The racing
 * writer waits until the prompt appears in the pty transcript before it moves
 * the file, and the answer waits until the racing writer has finished, so
 * "second change lands between the two saves" holds however slow the machine
 * is. `script -f` is what makes the transcript readable while it is still
 * being written.
 */

/** A bounded poll, so a missed condition fails the test rather than hanging. */
function until(cond: string): string {
  return `i=0; while [ $i -lt 200 ] && ! ${cond}; do i=$((i+1)); sleep 0.05; done`;
}

function project<T>(fn: (dir: string, id: string, file: string) => T): T {
  return withTempProject((dir) => {
    dz(['init', '--name', 'demo'], { cwd: dir });
    const full = JSON.parse(dz(['add', 'Editable', '--json'], { cwd: dir }).stdout).id;
    return fn(dir, full.slice(0, 13), path.join(dir, 'dz', 'issues', `${full}.md`));
  });
}

describe('dz edit on a double race', () => {
  it('claims no overwrite on the round it was refused', () => {
    project((dir, id, file) => {
      const transcript = path.join(dir, 'pty-transcript');
      const flag = path.join(dir, 'second-writer-done');

      // The editor makes the first change, which raises the prompt. It also
      // leaves behind a writer that makes a SECOND change, held back until the
      // prompt is actually on screen -- that is what puts it strictly between
      // the refused save and the forced one.
      const editor = path.join(dir, 'ed-double.sh');
      fs.writeFileSync(editor,
        '#!/bin/sh\n'
        + '(\n'
        + `  ${until(`grep -q 'changed while your editor was open' ${shq(transcript)} 2>/dev/null`)}\n`
        + `  ${SED_I} 's/^title: .*/title: Third Party/' ${shq(file)}\n`
        + `  touch ${shq(flag)}\n`
        + ') &\n'
        + `${SED_I} 's/^title: .*/title: Someone Else/' ${shq(file)}\n`
        + `${SED_I} 's/^title: .*/title: Mine/' "$1"\n`);
      fs.chmodSync(editor, 0o755);

      // The answer is withheld until that second change has landed. Only one
      // answer is ever sent: the re-prompt hits end of input and aborts, which
      // is how the run terminates.
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
      const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;

      // The forced save really was refused, so the operator really was asked a
      // second time. Without that, the rest of this proves nothing.
      const asked = (output.match(/changed while your editor was open/g) ?? []).length;
      expect(asked).toBe(2);
      expect(r.status).toBe(1);

      // The point of the test. Nothing was written on the refused round, so
      // nothing may be reported as overwritten.
      expect(output).not.toContain('the version you overwrote was kept at');

      // And the second writer's version is untouched, which is the substance
      // the message would have been lying about.
      expect(fs.readFileSync(file, 'utf8')).toContain('title: Third Party');
    });
  }, 20000);
});
