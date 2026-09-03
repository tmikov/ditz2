<!--
Moved here from gitignored scratch so it survives the session that produced it.
Plan 2d depends on every finding below; do not re-litigate them without
re-running the experiment.
-->

# Spike: suspend-to-$EDITOR on Ink 6.8.0

Installed versions: `ink@6.8.0`, `react@19.2.8` (checked via
`node_modules/ink/package.json` and `node_modules/react/package.json` in
the checkout root). Ink 7.1.1, which the spec
was written against, cannot be installed here (requires Node >= 22; this
toolchain's vendored Node is 21.4.0), so this spike measures 6.8.0 directly
rather than inheriting the spec's assumptions.

All runs used a real pty (`script -qec ... /dev/null`, util-linux — this
host is Linux, so `tests/pty.ts`'s BSD branch does not apply). This
matches the technique `ui/tests/e2e.test.ts` already uses: wait for Ink's
`ESC[?2026h` synchronized-update marker before typing, one key per write.

## Method

Everything lives under `/tmp/ditz2-spike/` (deleted at the end of this spike;
nothing in the `ditz2` checkout was created or modified):

- `app.mjs` — a minimal Ink app imported directly from the checkout's
  `node_modules/ink/build/index.js` and `node_modules/react/index.js` (no
  build step; `React.createElement` instead of JSX). Takes `mode`
  (`no-unmount` | `unmount`), a fake-`$EDITOR` path, a scratch file path, and
  an `alt` flag. Renders `SPIKE-TEXT:[<text>] KEYS:<n>`. On `e`:
  - `no-unmount`: `setRawMode(false)` → `instanceRef.current.clear()` →
    `spawnSync(editor, [scratch], {stdio:'inherit'})` → `setRawMode(true)` →
    read the scratch file back → `setText(newValue)`.
  - `unmount`: `instanceRef.current.unmount()` → `spawnSync(...)` → read the
    file back → `setText(newValue)` → `instanceRef.current.rerender(<App/>)`.
  - On `q`: `instance.unmount()` (the app's own exit path).
  - Every other key: `setKeyCount(c => c+1)`.
  - `console.error('STEP:...')` markers at each stage (goes to the same pty,
    so it interleaves with the frames in the captured transcript and lets the
    sequence of events be read directly off the raw output).
- `fake-editor.sh` — writes `TTY:<yes|no> LINES:<n> COLS:<n> EDITED:<marker>`
  into the scratch file, proving tty-ness with `test -t 0 && test -t 1` and
  `tput lines`/`tput cols`.
- `fake-editor-altscreen.sh` — same, but wraps itself in
  `ESC[?1049h ... ESC[?1049l` first, simulating vim.
- `driver.mjs` — spawns `script -qec "node app.mjs <mode> <editor> <scratch> <alt>" /dev/null`
  in a pty, waits for the first frame, sends `e`, waits for `STEP:editor-done`,
  sends `k` (liveness probe), sends `q`, and dumps the raw transcript plus a
  JSON summary.

Node >= 20 was used throughout (ink 6.8.0 requires it).

## Answers

### 1. Does suspend-without-unmount work on Ink 6.8.0? — **Yes.**

`node /tmp/ditz2-spike/driver.mjs no-unmount fake-editor.sh noalt` completed
end to end: first frame drawn, `e` suspended, the fake editor ran and wrote
the scratch file, the app resumed, exit code 0. No exceptions, no hang.
Final summary:
```json
{
  "gotFirstFrame": true, "editorRan": true, "readBack": true,
  "processAliveAfterEdit": true, "keyAfterResumeRegistered": true,
  "exitCode": 0,
  "finalTextLine": "SPIKE-TEXT:[TTY:yes LINES:30 COLS:100 EDITED:no-unmount] KEYS:1"
}
```

### 2. Do state updates made after the editor exits actually render? — **Yes.**

Same run: the pre-edit frame is `SPIKE-TEXT:[BEFORE] KEYS:0`; the file the
fake editor wrote was `TTY:yes LINES:30 COLS:100 EDITED:no-unmount`; the
final rendered frame is
`SPIKE-TEXT:[TTY:yes LINES:30 COLS:100 EDITED:no-unmount] KEYS:1` — the
post-edit value, not the stale one, confirmed by grepping the raw transcript
for the exact string `EDITED:no-unmount` (`rawIncludesEditedNoUnmount: true`).

### 3. Is the keyboard live after resume? — **Yes** (for the no-unmount approach).

After the editor exited, the driver sent `k`; the transcript contains
`STEP:keycount-now:1` and the next rendered frame is `... KEYS:1`
(`keyAfterResumeRegistered: true`). `useInput` was still wired to a live raw
stdin after `setRawMode(true)`.

### 4. Does the child process get a real terminal? — **Yes.**

The scratch file written by the fake editor (run via `spawnSync(editor, args,
{stdio:'inherit'})`) contains `TTY:yes LINES:30 COLS:100` in every run —
`test -t 0 && test -t 1` passed and `tput lines`/`tput cols` returned the
pty's real size, not `NA`.

### 5. Does `unmount()` + `rerender()` genuinely fail on 6.8.0? — **Yes, confirmed broken — worse than "stale display".**

`node /tmp/ditz2-spike/driver.mjs unmount fake-editor.sh noalt`. Raw
transcript after the edit:
```
STEP:unmounted
STEP:editor-done
STEP:read-back:TTY:yes LINES:30 COLS:100 EDITED:unmount
STEP:setText-called
STEP:rerender-called
STEP:waitUntilExit-resolved
STEP:keycount-now:1
STEP:quit-pressed

Session terminated, killing shell... ...killed.
```
Findings:
- **No frame is ever drawn again after `unmount()`.** There is not a single
  `ESC[?2026h`/redraw sequence after the `STEP:suspend-start` block. The
  screen is frozen on the pre-edit frame: `finalTextLine` (the last
  `SPIKE-TEXT:...` string anywhere in the transcript) is
  `"SPIKE-TEXT:[BEFORE] KEYS:0"` — confirming the spec's claim that the UI is
  left showing pre-edit data.
- `setText(newValue)` and `rerender(<App/>)` both ran (`STEP:setText-called`,
  `STEP:rerender-called` both logged) with **no error thrown** and **no
  visible effect** — the failure is silent, exactly as the spec says.
- `instance.unmount()` resolves `waitUntilExit()` immediately, before the
  editor even runs — `STEP:waitUntilExit-resolved` appears in the log right
  after `STEP:rerender-called`, well before the user's `q` keypress. A real
  `runUi`-shaped caller doing `await instance.waitUntilExit(); return 0;`
  would treat the process as done at that point, not after the edit.
- The keystroke sent after resume (`k`) *was* still delivered to the old
  (unmounted) component's `useInput` closure (`STEP:keycount-now:1` appears),
  so state kept updating internally — it just never reached the screen.
- The process did **not** exit cleanly on `q`. `child.on('close')` never
  fired within the driver's timeout; the run only ended when the driver's
  5-second kill fired and `script` printed `Session terminated, killing
  shell... ...killed.` This is a worse failure than the spec describes: not
  just stale content, but a process that no longer terminates normally.

This matches the spec's negative claim and adds a sharper detail the spec
didn't state: state changes after unmount are accepted but never rendered,
and the process can outlive a clean shutdown path entirely.

### 6. Does behavior change on the alternate screen buffer? — **No difference found; the nested case (editor also using the alt screen) works cleanly.**

Two runs, both `no-unmount`, with `runUi`'s `ESC[?1049h`/`ESC[?1049l`
wrapping added around `render()`/exit (mirroring `ui/src/index.tsx`):

- Host alt screen + plain fake editor (editor does not touch the alt screen):
  `altOpenCount: 1`, `altCloseCount: 1`, both correctly paired around the
  whole run; `finalTextLine` shows the post-edit value; behavior otherwise
  identical to the non-alt-screen run.
- Host alt screen + `fake-editor-altscreen.sh` (editor itself does
  `ESC[?1049h` ... text ... `ESC[?1049l`, simulating vim nesting inside the
  host's own alternate screen): raw transcript around the edit —
  ```
  ...STEP:suspend-start...ESC[2K ESC[G ESC[?1049h FAKE EDITOR ON ALT SCREEN\r\n ESC[?1049l ESC[?2026h...STEP:editor-done...
  ```
  The nested enter/leave pair is well-formed and appears exactly once, inside
  the host's own (still-open) outer pair; `altOpenCount: 2` / `altCloseCount:
  2` (1 host + 1 nested each), correctly balanced; the app resumed, the file
  was read back correctly (`EDITED:no-unmount`), the keyboard stayed live,
  and the host's outer `ESC[?1049l` fired once at final exit. No corruption
  or leaked buffer state observed.
- Also checked `unmount` mode + alt screen as a side observation: the outer
  alt-screen restore still fired (via the app's own `process.once('exit',
  ...)` handler, independent of Ink), so the terminal was not stranded on the
  alternate screen even though Ink's own UI hung — but the process still
  needed the driver's forced kill to terminate, same as case 5 without the
  alt screen. This reinforces that `unmount()`/`rerender()` is broken
  regardless of alternate-screen state, and that outer screen-restore logic
  like `runUi`'s `finally`/`exit` handler is what actually protects the
  operator's terminal in that failure mode, not Ink's own bookkeeping.

## Bottom line

The spec's two load-bearing claims both hold on the actually-installed Ink
6.8.0, verified against the real behaviour rather than inferred:
`setRawMode(false)` → `clear()` → `spawnSync(..., {stdio:'inherit'})` →
`setRawMode(true)` works, renders post-edit state, and keeps the keyboard
live, with a real tty handed to the child. `unmount()` + `rerender()` is
confirmed broken, and worse than advertised: it silently accepts and drops
state updates *and* leaves the process unable to exit cleanly. The
alternate-screen-buffer question raised since the spec was written adds no
new risk — nested alt-screen use by a real editor composes correctly with
the host's own alt screen under the no-unmount approach.
