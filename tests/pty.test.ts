/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { SED_I, ptyPipeline, ptyShell, ptySpawn, sedInPlace } from './pty.js';

/**
 * The Linux spellings, pinned literally.
 *
 * Everything else in this suite exercises whichever branch the running machine
 * takes, so on a Mac the Linux arm of every decision in pty.ts is dead code
 * that no test would notice breaking — and Linux is where CI runs. These
 * assertions are deliberately written as the exact strings the suite used
 * before pty.ts existed, so that a change which alters them has to be a
 * deliberate one.
 */
describe('the pty and sed spellings', () => {
  it('leaves the util-linux command lines exactly as they were', () => {
    expect(sedInPlace('linux')).toBe('sed -i');
    expect(ptySpawn('CMD', { platform: 'linux' }))
      .toEqual({ file: 'script', args: ['-qec', 'CMD', '/dev/null'] });
    expect(ptySpawn('CMD', { platform: 'linux', transcript: '/t', flush: true }))
      .toEqual({ file: 'script', args: ['-qefc', 'CMD', '/t'] });
  });

  it('never sizes the pty with stty off darwin, because script reads the env', () => {
    // util-linux falls back to COLUMNS/LINES on its own. An stty prefix here
    // would be a second, disagreeing source for the same number.
    expect(ptySpawn('CMD', { platform: 'linux', cols: '100', rows: '30' }).args)
      .toEqual(['-qec', 'CMD', '/dev/null']);
  });

  it('leaves the util-linux pipeline a plain pipeline', () => {
    // No flag file and no held end of input: util-linux does not push an EOT
    // into the pty when its own input ends, so there is nothing to hold back.
    expect(ptyPipeline('FEED', 'CMD', { platform: 'linux', transcript: '/t', flush: true }))
      .toBe(`FEED | script '-qefc' 'CMD' '/t'`);
    expect(ptyPipeline('FEED', 'CMD', { platform: 'linux' })).not.toContain('sleep');
  });

  it('holds the end of input back on darwin, and cleans up after itself', () => {
    const p = ptyPipeline('FEED', 'CMD', { platform: 'darwin' });
    expect(p).toContain('FEED');
    // The wait ends early on the flag the right-hand side raises, and the flag
    // is removed however the pipeline ends.
    const flag = (/touch ('[^']+')/.exec(p) ?? [, ''])[1] as string;
    expect(flag).not.toBe('');
    expect(p).toContain(`[ ! -f ${flag} ]`);
    expect(p).toContain(`rm -f ${flag}`);
    // Two runs must not share a flag, or one clears the other's wait.
    expect(ptyPipeline('FEED', 'CMD', { platform: 'darwin' })).not.toContain(flag);
  });

  it('keeps a no-input command a direct child on both platforms', () => {
    // ptyKilled walks down from the spawned pid to the process running the UI
    // and signals it. An interposed `cat` would be a second child of the same
    // parent, and a first-child walk can just as well descend into that.
    expect(ptySpawn('CMD', { platform: 'darwin', noStdin: true }).file).toBe('script');
    expect(ptySpawn('CMD', { platform: 'linux', noStdin: true }))
      .toEqual({ file: 'script', args: ['-qec', 'CMD', '/dev/null'] });
  });

  it('spawns a sized no-input command with no shell in front of it', () => {
    // The exact shape `tests/hermes/run.test.ts`'s control test depends on,
    // pinned from Linux because that test's whole assertion is
    // `child.exitCode === null`. Were `child` the `cat`-fed `/bin/sh` of the
    // default darwin shape, the `cat` would block forever on a stdin pipe
    // that test never writes to, the pipeline could never exit, and the
    // assertion would be vacuously true on macOS -- green whatever the UI did.
    // So: `script` itself is the spawned process, and no `cat` anywhere.
    const darwin = ptySpawn('CMD', { platform: 'darwin', cols: '100', rows: '30', noStdin: true });
    expect(darwin).toEqual({
      file: 'script',
      args: ['-q', '/dev/null', '/bin/sh', '-c', 'stty cols 100 rows 30 2>/dev/null; exec CMD'],
    });
    expect(darwin.args.join(' ')).not.toContain('cat');
    const linux = ptySpawn('CMD', { platform: 'linux', cols: '100', rows: '30', noStdin: true });
    expect(linux).toEqual({ file: 'script', args: ['-qec', 'CMD', '/dev/null'] });
    expect(linux.args.join(' ')).not.toContain('cat');
  });

  it('uses the BSD command line on darwin', () => {
    // No -c, transcript before the command, and a shell named explicitly.
    expect(ptySpawn('CMD', { platform: 'darwin' })).toEqual({
      file: '/bin/sh',
      args: ['-c', `cat 2>/dev/null | script '-q' '/dev/null' '/bin/sh' '-c' 'CMD'`],
    });
    // -f is spelled -F, and -e is dropped: BSD always passes the status through.
    expect(ptyShell('CMD', { platform: 'darwin', transcript: '/t', flush: true }))
      .toBe(`script '-q' '-F' '/t' '/bin/sh' '-c' 'CMD'`);
  });

  it('sizes the pty on darwin only when asked, and only with numbers', () => {
    expect(ptyShell('CMD', { platform: 'darwin', cols: '100', rows: '30' }))
      .toContain('stty cols 100 rows 30');
    // The no-winsize case the UI suite tests on purpose must stay unsized.
    expect(ptyShell('CMD', { platform: 'darwin' })).not.toContain('stty');
    expect(ptyShell('CMD', { platform: 'darwin', cols: '; rm -rf /', rows: '30' }))
      .toContain('stty cols NaN');
  });

  it('exports a constant that agrees with the running platform', () => {
    // The call sites interpolate SED_I; if it disagreed with sedInPlace() the
    // branch this module exists to pick would be picked twice, differently.
    expect(SED_I).toBe(sedInPlace(process.platform));
  });
});
