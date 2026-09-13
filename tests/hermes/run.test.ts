/*
 * Copyright (c) 2026 Tzvetan Mikov
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ptySpawn, shq } from '../pty.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DZ = path.join(REPO, 'scripts', 'hermes', 'dz');

let tmp: string;

const ENV = { ...process.env, DZ_AUTHOR: 'Test User <test@example.com>' };

/** `scripts/hermes/dz` in a throwaway directory, which is the whole point. */
function dz(args: string[], cwd: string): string {
  return execFileSync(DZ, args, { cwd, encoding: 'utf8', env: ENV });
}

describe.skipIf(!process.env.HERMES_NODE)('dz under hermes-node', () => {
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-hermes-'));
    dz(['init', '--name', 'demo'], tmp);
  });
  afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // Run from a directory that is not the checkout. A relative entry path in
  // the launcher fails here, and so does a launcher that cd's into the repo —
  // it would act on ditz2's own backlog instead of this project.
  it('initialises a project in the callers directory, not the checkout', () => {
    expect(fs.existsSync(path.join(tmp, 'dz', 'config.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(REPO, 'dz', 'config.yaml'))).toBe(true);
  });

  it('adds an issue that list and show can both find', () => {
    const added = dz(['add', 'a hermes issue', '--type', 'task'], tmp);
    const id = added.trim().split(/\s+/)[1];
    expect(id).toMatch(/^[0-9a-f-]{13}$/);
    expect(dz(['list'], tmp)).toContain('a hermes issue');
    expect(dz(['show', id], tmp)).toContain('a hermes issue');
  });

  it('writes issue files the Node build reads back identically', () => {
    // Adds its own issue rather than leaning on the test above. Run alone
    // this would otherwise compare two empty lists and pass without
    // exercising persistence at all.
    const added = dz(['add', 'compared across engines', '--type', 'task'], tmp);
    const id = added.trim().split(/\s+/)[1];
    const files = fs.readdirSync(path.join(tmp, 'dz', 'issues'));
    expect(files.some((f) => f.startsWith(id))).toBe(true);

    const underNode = execFileSync(
      process.execPath,
      [path.join(REPO, 'dist', 'cli', 'main.js'), 'list', '--json'],
      { cwd: tmp, encoding: 'utf8', env: ENV },
    );
    const hermes = JSON.parse(dz(['list', '--json'], tmp)) as Array<{ title: string }>;
    expect(hermes.map((i) => i.title)).toContain('compared across engines');
    expect(hermes).toEqual(JSON.parse(underNode));
  });
});

interface UiRun {
  out: string;
  code: number | null;
  sawFrame: boolean;
  sawHelp: boolean;
  /** When `q` was written, or undefined if the run never got that far. */
  qAt: number | undefined;
  /**
   * When the first frame appeared in this run's output. The control measures
   * its window from the same event, which is the only reason the two runs'
   * timings can be compared at all -- see the block comment below.
   */
  frameAt: number;
  /** When the child's `exit` event arrived. */
  exitAt: number;
}

interface IdleRun {
  /** Kept separate from `stillRunning` on purpose -- see the give-up timer. */
  sawFrame: boolean;
  stillRunning: boolean;
}

/**
 * `child.kill()` and `child.stdin.end()` on a process already gone are both
 * no-ops, so this is safe to call unconditionally from a `finally` -- on the
 * happy path, on a thrown assertion, and on a timeout that aborts the test
 * before either test's own cleanup runs. Without it, a failed assertion in
 * either pty test below would leave a `script` process holding a pty open
 * for the rest of the run, which is exactly the kind of thing that makes
 * later, unrelated tests behave strangely for no visible reason.
 */
function killQuietly(child: ReturnType<typeof spawn> | undefined): void {
  child?.kill('SIGKILL');
  child?.stdin?.end();
}

/*
 * The two pty tests below are one experiment in two halves, and these five
 * numbers are its design. They are a single argument rather than five
 * independent settings, so they live together: moving one on its own can break
 * the argument while every test still passes, which is why the inequalities
 * they have to satisfy are asserted below rather than left to a reader to
 * re-derive.
 *
 * The problem they solve: three earlier versions of this check were each
 * defeated by a fake `runUi` that passed for the wrong reason, the last of
 * them by one that prints both markers unconditionally, never reads stdin, and
 * exits on a fixed delay of its own. No amount of waiting rules that out -- a
 * longer window only makes an input-blind process exit sooner to slip through,
 * it cannot close the class.
 *
 * What closes it is a control, and the two halves must measure from the same
 * anchor or the comparison is not one. That anchor is the frame: each test
 * records when `visible in the ui` first appeared in its own output.
 * `stays up when nothing is typed` sends no input and finds the process alive
 * OBSERVE_MS past its frame. `reacts to a keystroke` types `?`, Esc and `q`,
 * and requires the process gone within EXIT_BY_MS of its frame. A process
 * whose exit schedule does not depend on stdin would therefore have to be gone
 * by frame+1500ms in one run and still alive at frame+2000ms in the other,
 * from the same binary in the same environment. The 500ms between those two is
 * what absorbs the two runs' frames arriving at slightly different times;
 * `EXIT_BY_MS < OBSERVE_MS` is that inequality, and the first test asserts it
 * rather than trusting it.
 *
 * Anchoring matters more than it looks. An earlier version bounded the exit
 * only against `qAt`, and `q` is written a fixed delay after the help marker
 * appears -- an event the process under test schedules. Nothing bounded when
 * that marker had to arrive, so a fake could push its own help text out, push
 * `qAt` with it, and buy itself an arbitrarily late deadline: one that printed
 * the list marker at once, the help marker at +1500ms and exited at +2500ms
 * passed both tests. A deadline whose adversary picks one of its terms is not
 * a bound. EXIT_BY_MS is measured from the frame, which arrives before any of
 * this and is the same event the control measures from.
 *
 * The q-anchored bound is kept alongside it because it carries the tighter
 * causation story -- the exit followed the keypress within Q_EXIT_MS, not
 * merely the frame within EXIT_BY_MS -- and `ESC_WAIT_MS + Q_EXIT_MS <
 * OBSERVE_MS` keeps its worst case inside the control's window too. It is a
 * supplement to the frame-anchored bound, never a substitute for it.
 *
 * The numbers are measured, not chosen. Six runs of the keystroke sequence
 * against the real build, driven from a standalone script rather than vitest
 * to keep the runner's own scheduling out of the numbers, gave: frame at
 * +72-74ms, help overlay at +127-137ms, `q` written at +728-737ms, process
 * exit at +786-793ms. So q-to-exit is 56-60ms, and three runs of the test as
 * it stands, inside vitest, put the same gap at 57-75ms and the whole
 * frame-to-exit span at 713-740ms.
 *
 * What the pair establishes: no single fixed schedule satisfies both halves,
 * because both are measured from the frame and they demand opposite things of
 * the same interval. A process that ignores stdin behaves the same way in both
 * runs -- the two differ in the input they are sent and in nothing else it
 * could notice -- so it fails one of them whatever delay it picks.
 *
 * What it still does not rule out, stated so nobody has to rediscover it: a
 * process that behaves differently in the two runs by consulting state outside
 * itself -- a counter in a fixed path, say, keyed to the order the tests run
 * in. That was built and it does pass both. It is not a shape any regression
 * in the UI can take, and no two-run comparison can exclude it.
 */

/** EXIT_BY_MS's ceiling, and the whole reason the control is worth 2s. */
const OBSERVE_MS = 2000;

/**
 * How long the process may take to go away after its frame, counting the whole
 * `?`/Esc/`q` sequence. This is the bound that closes the fixed-schedule
 * class; Q_EXIT_MS is the tighter, weaker-anchored companion.
 *
 * **Measured on both platforms, because they differ a lot.** Linux, where
 * `ptySpawn` runs `script` directly: 713-740ms idle, 778-779ms under 3x
 * oversubscription. darwin, where BSD `script` refuses a socket on stdin and
 * `ptySpawn` interposes a `cat`, so the child is the shell and its exit waits
 * on EOF_AFTER_Q_MS: 1158-1210ms. So the headroom under this bound is ~760ms
 * on Linux but only ~300ms on a Mac. Re-measure on darwin before lowering it,
 * and do not read the Linux figure as the margin.
 */
const EXIT_BY_MS = 1500;

/**
 * How long the process may take to go away after `q`. ~17x the 56-75ms
 * measured above. Anchored to a keypress whose timing the process under test
 * can influence, so it is kept for the causation it states, not relied on as
 * the bound.
 */
const Q_EXIT_MS = 1000;

/**
 * The wait between Esc and `q`, forced by Node's readline: a lone ESC byte is
 * held for up to its 500ms `ESCAPE_CODE_TIMEOUT` -- see the note at the write
 * itself. It is part of the inequality because it delays the keypress, and so
 * the deadline, towards the control's window.
 */
const ESC_WAIT_MS = 600;

/**
 * The gap between `q` and closing stdin. EOF goes separately and later on
 * purpose: BSD `script` pushes an EOT into the pty when its input ends, so
 * closing alongside the keystroke can deliver end-of-input first and exit the
 * UI down a path this test is not measuring.
 *
 * It is a named constant and part of the inequality below because on darwin it
 * is a first-class term in `exitAt - frameAt` -- the interposed `cat` keeps the
 * pipeline alive until this fires -- not the free-floating literal it looks
 * like on Linux. Raising it eats EXIT_BY_MS's margin on Macs, with nothing
 * else to notice.
 */
const EOF_AFTER_Q_MS = 500;

/**
 * How long either test waits for the frame before giving up on the run. The
 * frame is measured at +72-74ms, so this is two orders of magnitude of
 * headroom; it exists so that a build which renders nothing at all fails in
 * seconds, naming the missing frame, instead of hanging to some other timeout.
 */
const FRAME_MS = 5000;

describe.skipIf(!process.env.HERMES_NODE)('dz ui under hermes-node', () => {
  it('reacts to a keystroke by re-rendering, and exits 0 when q is pressed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-hermes-ui-'));
    let child: ReturnType<typeof spawn> | undefined;
    try {
      // The pair's invariant, asserted rather than trusted: the exit deadline
      // this test enforces must fall inside the window the control watches, or
      // one fixed schedule could satisfy both and neither test would notice.
      // Both bounds are checked, but only the first is anchored to the frame,
      // which is the anchor the control uses and the one no fake can move.
      expect(EXIT_BY_MS).toBeLessThan(OBSERVE_MS);
      expect(ESC_WAIT_MS + Q_EXIT_MS).toBeLessThan(OBSERVE_MS);
      // The binding one, and it binds on darwin: there the child's exit cannot
      // be observed until stdin closes, so the keypress sequence plus that
      // close is a floor under `exitAt - frameAt`. Asserting it here is what
      // stops someone raising ESC_WAIT_MS or EOF_AFTER_Q_MS past the bound on
      // a platform this suite cannot exercise from Linux.
      expect(ESC_WAIT_MS + EOF_AFTER_Q_MS).toBeLessThan(EXIT_BY_MS);

      execFileSync(DZ, ['init', '--name', 'demo'], { cwd: dir, env: ENV });
      execFileSync(DZ, ['add', 'visible in the ui', '--type', 'task'],
        { cwd: dir, env: ENV });

      const env = { ...ENV, TERM: 'xterm-256color', COLUMNS: '100', LINES: '30' };
      const { file, args } = ptySpawn(`${shq(DZ)} ui`, { cols: '100', rows: '30' });

      const r = await new Promise<UiRun>((resolve) => {
        child = spawn(file, args, { cwd: dir, env });
        const c = child;
        let out = '';
        let sawFrame = false;
        let sawHelp = false;
        let qAt: number | undefined;
        let frameAt = 0;
        // Only output produced after `?` was written counts towards the help
        // marker, so a process that prints it up front cannot claim it.
        let helpFrom = 0;
        // The last resort, for a UI that reads the key and then never exits:
        // without it the promise never settles and the test dies on its own
        // 40s timeout with nothing said about why.
        const kill = setTimeout(() => { c.kill('SIGKILL'); }, 25_000);
        // Everything below is gated on the frame, so a run without one has
        // nothing left to do but end. Killing the child makes `exit` fire and
        // the `sawFrame` assertion report it, in seconds rather than at 25s.
        const frameGiveUp = setTimeout(() => { c.kill('SIGKILL'); }, FRAME_MS);
        // A child that has already exited turns the writes below into EPIPE on
        // the stream, and an unhandled `error` there would abort the whole
        // file with something unrelated to what is being tested. The
        // assertions are what report that case.
        c.stdin?.on('error', () => {});

        // No timing window can prove a process is reading its input -- a
        // fixed delay before checking `exitCode` only narrows how fast a UI
        // that ignores stdin has to exit to slip through, it cannot close the
        // class. Only a visible response to a keystroke can, so this drives
        // the UI through an actual round trip: `?` opens the help overlay
        // (`ui/src/app.tsx`, dispatched as `toggleHelp` from the list
        // screen), and `HelpOverlay` renders text -- "reload from disk" --
        // that never appears on the plain list frame. Seeing it appear after
        // sending `?` is proof the keystroke was read and caused a
        // re-render; a process that never touches stdin, however long it
        // waits before exiting on its own, cannot make that text appear.
        c.stdout?.on('data', (d: Buffer) => {
          out += d.toString();
          if (!sawFrame) {
            if (!out.includes('visible in the ui')) return;
            sawFrame = true;
            frameAt = Date.now();
            clearTimeout(frameGiveUp);
            c.stdin?.write('?');
            helpFrom = out.length;
            return;
          }
          if (sawHelp || !out.slice(helpFrom).includes('reload from disk')) return;
          sawHelp = true;
          // `q` alone would not quit here: while the help overlay is open it
          // TOGGLES the overlay closed instead (`ui/src/app.tsx`), so Esc
          // dismisses it first and `q` then reaches the list screen
          // underneath. The two cannot be written back to back: Node's
          // readline key parser (which Ink's input handling sits on) holds a
          // lone ESC byte for up to its 500ms `ESCAPE_CODE_TIMEOUT` waiting to
          // see whether more bytes make it an escape *sequence* -- a `q`
          // arriving inside that window is read together with the ESC as a
          // single Alt+q keypress, which matches neither the overlay's Esc
          // handler nor the list's `q` handler, and the process hangs open
          // forever. Waiting out the timeout before sending `q` is what makes
          // them land as two separate keys.
          c.stdin?.write('\x1b');
          setTimeout(() => {
            qAt = Date.now();
            c.stdin?.write('q');
            // EOF goes separately, and later. BSD `script` pushes an EOT into
            // the pty when its own input ends, so closing stdin in the same
            // breath can deliver end-of-input ahead of the keystroke and exit
            // the UI down a different path than the one under test — the
            // `a)bort: ^Df` shape `CLAUDE.md` describes. The close is still
            // needed: on macOS `ptySpawn` interposes a `cat` whose pipeline
            // outlives the command otherwise.
            setTimeout(() => { c.stdin?.end(); }, EOF_AFTER_Q_MS);
          }, ESC_WAIT_MS);
        });
        c.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
        c.on('exit', (code) => {
          clearTimeout(kill);
          clearTimeout(frameGiveUp);
          resolve({ out, code, sawFrame, sawHelp, qAt, frameAt, exitAt: Date.now() });
        });
      });

      expect(r.sawFrame).toBe(true);
      // A UI that drew one frame and then ignored stdin -- however long it
      // waited before exiting on its own -- can never make this true, because
      // nothing renders the help text without the process reading `?` and
      // reacting to it.
      expect(r.sawHelp).toBe(true);
      expect(r.out).not.toContain('initYoga');
      expect(r.code).toBe(0);
      // The other half of the experiment: the exit has to land inside a window
      // measured from the same event the control measures from, so that no one
      // fixed schedule can satisfy both. Against the real build: 713-740ms on
      // Linux, 1158-1210ms on darwin, against this 1500ms bound.
      expect(r.exitAt - r.frameAt).toBeLessThan(EXIT_BY_MS);
      // The tighter, narrower claim: the exit followed the keypress, not just
      // the frame. Undefined means the process was gone before `q` was ever
      // written, which is the same failure stated differently. `qAt` is placed
      // relative to the help marker, which the process under test emits, so
      // this bound alone would leave that term in the adversary's hands --
      // hence the frame-anchored one above.
      expect(r.qAt).toBeDefined();
      expect(r.exitAt - (r.qAt ?? 0)).toBeLessThan(Q_EXIT_MS);
    } finally {
      // A no-op on the happy path -- the promise above only resolves once
      // `exit` has already fired, so there is nothing left to kill by the
      // time execution reaches here. It matters on the path where an
      // `expect` above throws before that: without this, the child would be
      // left running, holding its pty open for the rest of the suite.
      killQuietly(child);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  // The control. On its own it proves only that an untouched UI stays up; what
  // it is for is denying the test above the explanation that the UI exits on
  // some schedule of its own. The temp directory deliberately carries the same
  // prefix as the other test's: the two runs differ in the input the UI is
  // sent and in nothing else the UI could notice. (They differ on the far side
  // of the pty in one way -- `script` reads /dev/null here and a pipe there --
  // but the child is handed a pty slave either way, and the argument only
  // needs the UI's own view of the two runs to match.)
  //
  // This window has already raced a mutation once -- do not pick a fake's
  // self-exit delay equal to OBSERVE_MS, or close to it, without re-measuring.
  // Five standalone runs against a fake sharing the constant (both markers, no
  // stdin, resolves after 2000ms) put its frame at +40-42ms and its actual
  // exit at +2057-2067ms: a 15-27ms margin, not a safe one. Such a fake is now
  // caught by EXIT_BY_MS in the test above -- frame-to-exit ~2020ms against a
  // 1500ms bound -- rather than by this window, which is the point of pairing
  // them.
  it('stays up when nothing is typed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-hermes-ui-'));
    let child: ReturnType<typeof spawn> | undefined;
    try {
      execFileSync(DZ, ['init', '--name', 'demo'], { cwd: dir, env: ENV });
      execFileSync(DZ, ['add', 'visible in the ui', '--type', 'task'],
        { cwd: dir, env: ENV });

      const env = { ...ENV, TERM: 'xterm-256color', COLUMNS: '100', LINES: '30' };
      // Nothing is ever typed here, so the pty's input side comes from
      // /dev/null and this process spawns with stdin `'ignore'`. That is not
      // tidiness: on darwin the default `ptySpawn` shape is
      // `/bin/sh -c 'cat 2>/dev/null | script ...'`, so `child` would be the
      // shell and the `cat` would sit blocked on a stdin pipe this test never
      // writes to or closes before the `finally`. The pipeline could not exit
      // whatever the UI did, and `c.exitCode === null` below -- the whole
      // assertion -- would be vacuously true on that platform. `noStdin` keeps
      // `script` the only child on both. (`ui/tests/e2e.test.ts` hit the same
      // cycle and its `ptyKilled` takes the same route.)
      const { file, args } = ptySpawn(`${shq(DZ)} ui`,
        { cols: '100', rows: '30', noStdin: true });

      const r = await new Promise<IdleRun>((resolve) => {
        child = spawn(file, args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
        const c = child;
        let out = '';
        let sawFrame = false;
        // A safety net, not the thing under test. It deliberately does NOT
        // look at `exitCode`: a build that renders no frame but keeps its
        // event loop alive -- a bare `setInterval`, say -- would answer that
        // question with "still running" and be reported green, which is the
        // regression this file exists to catch, wearing a disguise. It
        // resolves the run as "no frame" instead, and the `sawFrame`
        // assertion below is what reports it.
        const giveUp = setTimeout(() => {
          resolve({ sawFrame: false, stillRunning: false });
        }, FRAME_MS);
        c.stdout?.on('data', (d: Buffer) => {
          out += d.toString();
          if (sawFrame || !out.includes('visible in the ui')) return;
          sawFrame = true;
          clearTimeout(giveUp);
          // Nothing is sent, ever. `exitCode === null` is a sound liveness
          // check here, unlike in the test above, precisely because of that:
          // no keystroke went in, so a process that is gone has gone for a
          // reason the UI is not allowed to have. It is sound only because
          // `noStdin` above makes `script` the spawned process itself on both
          // platforms; with the `cat`-fed shell it would answer "alive" for
          // the shell rather than for the UI.
          setTimeout(() => {
            resolve({ sawFrame: true, stillRunning: c.exitCode === null });
          }, OBSERVE_MS);
        });
        c.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
        // If the process exits on its own before the observation window
        // closes, that is the failure this test exists to catch -- resolve
        // promptly with the answer rather than waiting out the rest of
        // `OBSERVE_MS` for a process that is already gone.
        c.on('exit', () => {
          clearTimeout(giveUp);
          resolve({ sawFrame, stillRunning: false });
        });
      });

      expect(r.sawFrame).toBe(true);
      expect(r.stillRunning).toBe(true);
      // Not a quit: nothing was typed, so there is no keystroke for the UI to
      // have acted on and no exit code to assert about.
    } finally {
      killQuietly(child);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);
});
