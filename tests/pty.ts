/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The two shell utilities these tests drive that BSD and GNU spell differently.
 *
 * Both are used from generated `$EDITOR` scripts and pty runners, so a
 * divergence does not surface as a portability warning — it surfaces as an
 * editor that silently changed nothing, or as `script` refusing to start. This
 * module is the single place either spelling is decided; nothing else in the
 * suite may hold its own copy (see CLAUDE.md on checkers holding the rule they
 * check).
 *
 * `platform` is a parameter rather than a direct `process.platform` read so
 * that both branches are reachable from a test on either OS. The Linux branch
 * cannot otherwise be exercised where this was developed, and it is the one
 * that must not regress.
 */

import os from 'node:os';
import path from 'node:path';

/** Distinguishes the flag files of concurrent `holdEof` runs in one process. */
let counter = 0;

/** Quotes a value for `sh`, including one containing single quotes. */
export function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * `sed`, invoked to edit a file in place.
 *
 * GNU's `-i` takes an OPTIONAL suffix, attached: `sed -i 's/a/b/' f`. BSD's is
 * mandatory and separate, so that same line consumes the expression as the
 * backup suffix and then reads the filename as the script, which fails with
 * `unescaped newline inside substitute pattern` and leaves the file untouched.
 * The empty suffix BSD needs is what GNU would read as the script, so there is
 * no spelling that works on both and the branch is unavoidable.
 */
export function sedInPlace(platform: NodeJS.Platform = process.platform): string {
  return platform === 'darwin' ? `sed -i ''` : 'sed -i';
}

/** `sedInPlace()` for the running platform, for interpolating into scripts. */
export const SED_I = sedInPlace();

export interface PtyOptions {
  /** Where `script` writes the typescript. */
  transcript?: string;
  /** Flush after every write, so a reader can follow the transcript live. */
  flush?: boolean;
  /** Force the pty's winsize. Ignored off darwin — see `sizeCommand`. */
  cols?: string | undefined;
  rows?: string | undefined;
  /** For callers that cannot hold stdin open. See `holdCommand`. */
  holdEof?: boolean;
  /**
   * The command is sent no input at all, so the pty's input side can come
   * straight from /dev/null. The caller must spawn it with stdin `'ignore'`.
   */
  noStdin?: boolean;
  platform?: NodeJS.Platform;
}

/**
 * BSD `script` creates the pty with no winsize when its own stdout is not a
 * terminal, so the child sees 0x0. util-linux falls back to the COLUMNS and
 * LINES environment variables, which is why every caller sets them and why
 * only BSD needs this: `stty` runs inside the pty, where it is the controlling
 * terminal, so it can set what `script` did not.
 *
 * Left alone when the caller passes no size, because a pty that genuinely
 * reports no size is a case the UI suite tests on purpose.
 */
function sizeCommand(cmd: string, o: PtyOptions, platform: NodeJS.Platform): string {
  if (platform !== 'darwin' || o.cols === undefined || o.rows === undefined) return cmd;
  // Number(): these reach a shell, and a winsize is the only thing they may be.
  return `stty cols ${Number(o.cols)} rows ${Number(o.rows)} 2>/dev/null; exec ${cmd}`;
}

/**
 * Arguments to `script` itself, in whichever of the two command lines is local.
 *
 * util-linux takes the command with `-c` and the transcript as its positional
 * argument. BSD has no `-c` at all — the synopsis is
 * `script [-aeFkpqr] [file [command ...]]` — so the command comes after the
 * transcript and must name a shell explicitly to keep the shell semantics that
 * `-c` implies. Flushing is `-f` on GNU and `-F` on BSD. BSD accepts `-e` only
 * for compatibility: it always passes the child's exit status through, which is
 * exactly what `-e` asks util-linux to do, so the status assertions hold on
 * both without it.
 */
function scriptArgv(cmd: string, o: PtyOptions, platform: NodeJS.Platform): string[] {
  const transcript = o.transcript ?? '/dev/null';
  const inner = sizeCommand(cmd, o, platform);
  return platform === 'darwin'
    ? ['-q', ...(o.flush === true ? ['-F'] : []), transcript, '/bin/sh', '-c', inner]
    : [`-qe${o.flush === true ? 'f' : ''}c`, inner, transcript];
}

/**
 * A `script` command line to embed in a generated shell script.
 *
 * For callers whose stdin is already a pipe built by the shell, which is the
 * case `ptySpawn` cannot use — see its note on socketpairs.
 */
export function ptyShell(cmd: string, o: PtyOptions = {}): string {
  const platform = o.platform ?? process.platform;
  return `script ${scriptArgv(cmd, o, platform).map(shq).join(' ')}`;
}

/** Milliseconds a held feed will wait for the command before giving up. */
const HOLD_MS = 2000;

/**
 * `feed | script`, with the end of input held back until the command has had
 * a chance to read what was fed.
 *
 * BSD `script` marks its own end of input by pushing an EOT into the pty, and
 * a feed that exits as soon as it has written the answer delivers that EOT on
 * the answer's heels. `dz edit` then reads end of input rather than the `f` it
 * was sent and takes its abort path, so the test measures the wrong branch —
 * observed as `a)bort: ^Df` in a transcript. util-linux does not do this,
 * which is why the Linux path is a plain pipeline and needs none of it.
 *
 * The wait ends the moment the command exits, so only a test that deliberately
 * withholds an answer — and so is waiting for the end of input to arrive —
 * pays the full bound. Too short a bound is a failing assertion rather than a
 * flake: the command sees end of input early and takes its no-answer path.
 */
function heldPipeline(feed: string, script: string): string {
  const ticks = Math.round(HOLD_MS / 50);
  // A path, not a file: the right-hand side creates it, the left waits on it.
  const flag = shq(path.join(os.tmpdir(), `dz-pty-${process.pid}-${(counter += 1)}`));
  const hold = `i=0; while [ $i -lt ${ticks} ] && [ ! -f ${flag} ]; do i=$((i+1)); sleep 0.05; done`;
  // Each side's status is its own; the pipeline's is the right-hand side's,
  // which is `script`'s, which is the command's.
  return `{ ${feed}; ${hold}; } 2>/dev/null | { ${script}; s=$?; touch ${flag}; exit $s; }`
    + `; s=$?; rm -f ${flag}; exit $s`;
}

/**
 * A `script` pipeline to embed in a generated shell script, fed by `feed`.
 *
 * For callers whose stdin is already a pipe built by the shell, which is the
 * case `ptySpawn` cannot use — see its note on socketpairs.
 */
export function ptyPipeline(feed: string, cmd: string, o: PtyOptions = {}): string {
  const platform = o.platform ?? process.platform;
  const script = ptyShell(cmd, { ...o, platform });
  return platform === 'darwin' ? heldPipeline(feed, script) : `${feed} | ${script}`;
}

/**
 * What to hand `spawn`/`spawnSync` to run `cmd` in a pty, with this process
 * writing the keystrokes.
 *
 * On darwin the command is wrapped in a shell and piped through `cat`, which
 * looks pointless and is not. libuv gives a spawned child's stdio a
 * socketpair, not a pipe, and BSD `script` calls `tcgetattr` on its stdin and
 * exits with `tcgetattr/ioctl: Operation not supported on socket` when that
 * fails this way. `cat`'s stdout is an ordinary pipe, which it accepts.
 *
 * The cost is that `cat` outlives the command it feeds — it is still blocked
 * reading this process's stdin when `script` exits, and the pipeline cannot
 * finish until it stops. Callers that keep stdin open must therefore close it
 * once they are done typing; callers that cannot want `holdEof`. Closing early
 * is otherwise safe: BSD `script` keeps running after its own stdin reaches
 * EOF, verified against the built `dzui`.
 */
export function ptySpawn(
  cmd: string,
  o: PtyOptions = {},
): { file: string; args: string[] } {
  const platform = o.platform ?? process.platform;
  if (platform !== 'darwin') return { file: 'script', args: scriptArgv(cmd, o, platform) };

  // /dev/null is a tcgetattr target BSD script accepts, so a command with no
  // input needs neither the shell nor the `cat`. Worth the branch: it keeps
  // `script` the only child of the spawned process, which is what lets a
  // caller walk down the tree to the process actually running the UI.
  if (o.noStdin === true) return { file: 'script', args: scriptArgv(cmd, o, platform) };

  const script = ptyShell(cmd, { ...o, platform });
  const pipeline = o.holdEof === true
    ? heldPipeline('cat', script)
    : `cat 2>/dev/null | ${script}`;
  return { file: '/bin/sh', args: ['-c', pipeline] };
}
