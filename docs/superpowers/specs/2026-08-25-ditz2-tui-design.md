# ditz2 TUI Design

**Date:** 2026-08-25
**Status:** Approved for implementation

A full-screen terminal UI for ditz2, shipped as a separate optional package
built on Ink, talking to a new narrow API facade in ditz2 itself.

## Goal

Work a backlog without leaving the terminal and without composing command
lines: browse, filter, read, create, retitle, reassign, comment, close, and
edit bodies. The CLI stays the primary and complete interface. The TUI is a
second front-end over the same operations, not a superset and not a
replacement.

Anything the TUI can do, `dz` can already do. That is the constraint that keeps
the facade honest: if a TUI feature needs a new operation, the operation
belongs in ditz2 and gets a CLI verb too.

## Two packages

```
ditz2                    deps: commander, uuid, yaml        (unchanged)
  src/api/               the facade -- the only public surface
  src/cli/               argument parsing and rendering
  src/core/ src/store/   internal, free to refactor

ditz2-ui                 deps: ink, react, ditz2
  src/                   Ink components
```

### Invocation

`dz ui` stays a command in the core CLI, because that is where someone will
look for it. It attempts a dynamic import of `ditz2-ui` and hands over; if the
package is absent it prints an install hint and exits non-zero:

```
$ dz ui
dz: the terminal UI is a separate package
    npm i -g ditz2-ui
```

The dynamic import is the only place core mentions `ditz2-ui`, it is not a
dependency, and `dz ui --help` works without it installed. `ditz2-ui` also
installs its own `dzui` binary so it can be run directly.

`dz ui` requires an interactive terminal. Without one it exits with a typed
error rather than rendering escape codes into a pipe, matching how `dz edit`
declines to prompt when stdin is not a tty.

### The core CLI keeps its dependencies

Measured, Ink 7.1.1 with React 19 pulls 38 packages and about 23 MB, plus one
more for `ink-testing-library`. People who want a command line issue tracker
should not install a React reconciler to get one.

`ditz2` gains an `exports` map naming only `src/api`. It is today a bin-only
package with no `main` and no `exports`, so this is its first importable
surface and worth being deliberate about. `core/`, `store/` and `render/` stay
private: the locking discipline in `store/lock.ts` took two review rounds to
get right and must remain free to change without breaking a consumer.

### The CLI calls the facade too

This is the rule that makes the split safe. `dz close` becomes argument
parsing, one facade call, and one render. The facade is not a second
implementation beside the commands; it is where the commands' bodies move to.

The alternative -- a facade that reimplements what the commands do -- is a
known failure mode in this codebase, not a hypothetical one. `doctor` carried
its own copy of the gitignore list and therefore certified as healthy exactly
the state it existed to detect. `unlock` unlinked the lock file directly
instead of going through `store/lock.ts`, duplicating a compare-and-delete.
Both were caught in review. A parallel facade would be the same mistake at a
larger scale.

Commands are 21 to 126 lines today (`edit.ts` at 242 is the outlier) and each
has the same shape: resolve the root, read inputs outside the lock, run one
`withProjectLock` closure that loads, mutates, validates and writes, then
render. The closure body is the facade method. The extraction is close to
mechanical and removes duplication rather than adding it.

## The facade

```ts
export function openProject(cwd: string, opts: ProjectOptions): Project;

interface ProjectOptions {
  env: NodeJS.ProcessEnv;    // author resolution
  lockTimeoutMs?: number;    // 0 means fail immediately; see below
}

interface Project {
  readonly root: string;

  list(filter?: Filter): LoadResult;      // { issues, failures }
  show(prefix: string): Issue;
  grep(pattern: string, filter?: Filter): LoadResult;

  add(fields: NewIssue): Issue;
  set(prefix: string, fields: EditableFields): Issue;
  comment(prefix: string, text: string): Issue;
  close(prefix: string, as: string, comment?: string | null): Issue;

  components: {
    list(): string[];
    add(name: string): { components: string[]; added: boolean };
    remove(name: string, force?: boolean): string[];
  };

  doctor(): Diagnosis[];
  lock: { state(): LockState; break(expectedToken: string | null): boolean };

  /** The whole edit flow. See "Editing bodies". */
  readForEdit(prefix: string): EditSource;          // { issue, baseline }
  parseEdit(text: string, original: Issue): Issue;
  /** Commits only if the file still matches `baseline`. */
  saveEdited(issue: Issue, baseline: string | null): SaveResult;
}
```

**Corrections made during implementation.** `list` and `grep` return
`{issues, failures}` rather than a bare array, because the CLI's
partial-failure path needs the failures and a UI wants to report unreadable
files rather than silently showing a short list.

`opts` and `opts.env` are both required. An optional `env` has exactly one
plausible default -- `process.env` -- which is the global read the parameter
exists to prevent, so there is no default worth having.

`set` takes `EditableFields`, whose members are already all optional;
`Partial<>` of it would say nothing further.

`close` takes `as: string` and `comment?: string | null`, not
`as: Resolution`. Validation of the vocabulary happens inside, so a consumer
passing a string it got from a user gets a `DzError` rather than a type error
it cannot act on. `null` is spelled out because that is what "no comment"
already is everywhere else in the codebase.

`components.add` returns `{components, added}` rather than the list alone.
Adding is idempotent, and reporting whether anything happened is what lets a
caller word its message without a second, unlocked read that could race.

`doctor` returns `Diagnosis[]`; the spec's `Problem` was never the name of the
type in `store/doctor.ts`.

`lock.break` takes `expectedToken: string | null`, not `force: boolean`. A
boolean cannot express "delete this lock only if it is still the one I
diagnosed", which is the compare-and-delete that keeps `unlock` from removing
a live lock belonging to a newly arrived holder. `null` means "only if there
is no readable lock at all".

`readForEdit` and `parseEdit` were added so the edit flow is expressible
through the closed surface. Without them a consumer can obtain neither
argument `saveEdited` takes, and would have to reimplement `dz edit`'s
pre-lock logic -- including the id-change guard, whose absence silently
overwrites a different issue. `parseEdit` carries that guard and the pre-lock
`validateIssue`; the scratch file stays a CLI concept, so it is the CLI that
appends "your edit is at ..." to whatever `parseEdit` throws.

`saveEdited` has no `force` flag. Forcing means writing over the version you
were shown, and that version is a baseline, so force is the same call with the
conflicting bytes. One compare-and-swap covers the save, the reload and the
force, and no parameter means "skip the check". A conflict is returned as
`{saved: false, current}` rather than thrown, because the caller needs those
bytes to offer a reload.

Each method takes the project lock internally for its own read-modify-write,
exactly as the commands do now. Read-only methods take no lock, also as now.

Errors stay `DzError` with the existing typed codes, so a consumer switches on
`LOCKED`, `CONCURRENT_MODIFICATION`, `NOT_FOUND`, `AMBIGUOUS_PREFIX` and
`INVALID_FIELD` rather than matching message text.

Return shapes are the ones the versioned JSON schema already describes. The
schema becomes the facade's documented type contract, and the existing test
that validates real command output against it keeps the two from drifting.

Three details worth stating:

- `set` accepts all five editable fields in one call, so a form save is **one
  atomic locked operation**, not five sequential ones.
- `openProject` throws `NO_PROJECT` immediately when there is no
  `dz/config.yaml`, so a consumer fails at startup rather than on first use.
- The facade takes `env` and `lockTimeoutMs` as parameters rather than reading
  `process.env`, so a consumer never has to mutate global environment.

## The facade is synchronous

ditz2 is synchronous end to end and the facade stays that way. Making it async
would mean async file IO throughout, which the lock design already considered
and declined; wrapping the existing sync calls in promises would be pure
theatre, since the work still runs the moment it is called.

Two things in a synchronous facade can block an Ink event loop, and they are
not the same problem.

**Parsing is acceptable.** Measured, `loadAllIssues` over 200 issues takes 50
to 125 ms in process, scaling linearly. With the snapshot model below, a full
load happens at startup and on an explicit refresh, not per keystroke; a
mutation re-reads one file and writes one file, around a millisecond. A 50 ms
hitch on a keypress the user deliberately pressed is invisible.

That is a real ceiling rather than a floor. Past roughly 500 issues a refresh
starts to feel slow, and the answer is the lazily built cache already filed as
`01a031ea-9853`, not an asynchronous API. Make parsing fast; do not make the
interface lie about being non-blocking.

**Lock waiting is not acceptable.** `acquireLock` retries with `Atomics.wait`
for up to `DZ_LOCK_TIMEOUT_MS`, default 2000. That blocks the event loop
completely: no repaint, no keystrokes, and no Ctrl-C. The lock design measured
this directly --

> A Node signal handler is a JS callback dispatched from the event loop, so it
> cannot preempt synchronous JS. Measured: with a handler registered, a
> `SIGINT` sent 0.6s into a 3s synchronous block never ran the handler.

-- and Ink registers a signal handler via `signal-exit`, which suppresses
Node's default terminate. A contended lock would therefore give a frozen and
unkillable UI for two seconds. Contention is the normal case for this tool,
since agents are expected to be working alongside the operator.

**Therefore the TUI passes `lockTimeoutMs: 0`.** The facade then never sleeps:
it takes the lock or throws `LOCKED` at once. Retrying becomes rendered state
with a visible holder, a timer and a cancel key. The lock design already names
this caller:

> `0` means fail immediately, which is what a caller wanting to implement its
> own policy sets.

## Freshness

The TUI reads a snapshot at startup and refreshes on demand with `r`. It does
not watch the filesystem.

The screen can therefore be out of date: an agent may close an issue you are
looking at. That is accepted deliberately. A watcher costs debouncing, and a
list that reorders under a moving selection is worse than one that is briefly
stale. Correctness does not depend on freshness -- every write re-reads and
re-validates under the lock, so a stale view produces a refused write, never a
silent overwrite.

Selection is tracked by **issue id, not list index**, so a refresh that
reorders or filters the list keeps the cursor on the same issue, or reports
that it is gone.

## Screens

Two screens and a few overlays.

```
+- ditz2 . bench . 32 open ---------------------- filter: status:open -+
|   01a031ea  feat  store  sqlite cache for list and grep              |
| > 01a03591  feat  cli    interactive conflict prompt for dz edit     |
|   01a031fe  bug   store  concurrent mutations can lose updates       |
+----------------------------------------------------------------------+
| interactive conflict prompt for dz edit     open . cli . unassigned  |
|                                                                      |
| Steps 8-10 of the lock design describe what dz edit should do when   |
| the issue changed underneath the editor...                           |
|                                                                      |
| 2026-08-24 17:12  tmikov  created                                    |
+----------------------------------------------------------------------+
| up/down move  enter edit  n new  c comment  x close  / filter  r  q  |
+----------------------------------------------------------------------+
```

```
+- edit 01a03591 ------------------------------------------------------+
| Title      interactive conflict prompt for dz edit                   |
| Type       ( ) bug   (*) feature   ( ) task                          |
| Status     (*) open  ( ) in-progress                                 |
| Component  [ cli    ]                                                |
| Assignee   --                                                        |
|                                                                      |
| Body       41 lines                        enter: open in $EDITOR    |
+----------------------------------------------------------------------+
| tab field  enter pick/edit  ^S save  esc cancel                      |
+----------------------------------------------------------------------+
```

Overlays, drawn over the current screen: status picker, resolution picker (on
close), component picker, comment entry, conflict resolution, lock wait, and
error.

## Keys

Arrow keys are the documented bindings and `j`/`k` also work. Supporting both
costs two lines in Ink's `useInput`, so there is no reason to make anyone learn
a scheme.

Arrows are primary for a functional reason rather than a familiar one. While
the `/` filter field is open every letter is text, so `j` and `k` are
unavailable by definition; arrows let the operator type a filter and walk the
matches without leaving the field.

**List screen.** `up`/`down` (also `j`/`k`) move; `Home`/`End` (also `g`/`G`)
jump; `PgUp`/`PgDn` (also `Ctrl-U`/`Ctrl-D`) page. `Enter` opens the form.
`n` new, `c` comment, `x` close, `e` body in `$EDITOR`, `/` filter, `r`
refresh, `?` help, `q` quit.

`/` opens one field that does both jobs the CLI splits across `list` and
`grep`: bare words are a regex passed to `grep`, and `key:value` terms
(`status:open`, `type:bug`, `component:cli`, `assignee:me`) become `Filter`
fields. Both are applied against the snapshot already in memory, so filtering
never re-reads the disk and is instant. `Esc` clears it.

`n` opens the form screen over an empty issue; `Ctrl-S` there calls `add`
rather than `set`. Everything else about the form is identical, so there is no
separate new-issue screen.

**Form screen.** `Tab` and `Shift-Tab` move focus, `Enter` opens a picker or
launches `$EDITOR` on the body, `Ctrl-S` saves, `Esc` cancels.

The two screens have different key regimes because in a form every letter is
text. This is a real seam and the footer is how the UI admits it: it shows the
bindings for the screen you are on, and `?` lists everything.

## State

```ts
{
  snapshot: Issue[],          // from list(), replaced wholesale on refresh
  filter: Filter,
  selectedId: string | null,  // by id, never by index
  screen: 'list' | 'form',
  overlay: null | { kind: 'status' | 'component' | 'resolution'
                        | 'comment' | 'conflict' | 'error' },
  waitingFor: null | { op: string, holder: LockInfo },
  notice: string | null,      // status line
}
```

One reducer. `LOCKED` is not an error dialog; it sets `waitingFor`, which
renders "waiting for the lock, held by `comment` (pid 4821)" with a retry timer
and `Esc` to give up.

## Editing bodies

Fields are edited in the form. The body opens `$EDITOR`, the way `tig` and
`lazygit` do, rather than the TUI growing a text editor. A multi-line editor
means owning a buffer, cursor, wrapping, scrolling, selection and undo; Ink has
no such component and `ink-text-input` is single-line. `dz edit` already solves
the hard part correctly.

The suspend and resume sequence, verified by spike:

```
capture baseline bytes
setRawMode(false)
instance.clear()
spawnSync($EDITOR, scratch, { stdio: 'inherit' })
setRawMode(true)
parse and validate the scratch file
facade.saveEdited(issue, baseline)
```

**Do not unmount.** The obvious approach -- `instance.unmount()`, spawn,
`instance.rerender()` -- was tried and does not work: after unmount the React
tree is dead, so state updates and rerenders are silently dropped and the UI
resumes showing pre-edit data. Releasing raw mode without unmounting works.
Confirmed in a pty that the child process receives a real terminal, that Ink
repaints after resume, and that the keyboard is live again.

### Conflicts

If `saveEdited` throws `CONCURRENT_MODIFICATION`, the TUI offers the same three
choices the CLI does -- reload the newer version and edit again, force this
version over it, or abort -- as an Ink overlay.

The overlay is necessary because Ink owns the terminal and the CLI's
synchronous stdin prompt cannot run inside it. Only the prompt differs. The
part that matters, the byte comparison under the lock, lives once in
`saveEdited`, and `dz edit` calls the same function. Whatever a choice discards
is written aside and its path shown in the status line, because `edit` appends
no log entry and a forced overwrite would otherwise leave no trace.

## Testing

The TUI is held to the standard the rest of the project already meets.

`ink-testing-library` renders to a plain string and accepts synthetic
keystrokes, verified working. List navigation, filtering, form focus, field
validation, the conflict overlay and the lock-wait state are ordinary
assertions on rendered frames.

The suspend and resume path gets a pty test through `script -qec`, the same
technique the `dz edit` conflict prompt tests already use.

The facade gets unit tests of its own. The strongest evidence that extracting
it changed no behaviour is that ditz2's existing 330 tests keep passing
untouched, so the refactor must not require editing them.

## Out of scope

Mouse support, themes, a configuration file, user-defined key bindings, bulk
or multi-select operations, split panes beyond list-and-detail, and live
filesystem watching. Each can be added later and none is needed to answer "can
I work this backlog without leaving the terminal".

## This is two plans, not one

The work splits at the package boundary, and each half is independently
valuable and independently testable.

**Plan one: the facade.** Add `src/api/`, move the command bodies into it, add
the `exports` map, and rewrite the commands as parsing plus one call plus one
render. Ships on its own with no TUI in sight. Its acceptance test is that the
existing 330 tests pass **unmodified** -- if the refactor requires editing
them, it changed behaviour.

**Plan two: `ditz2-ui`.** The new package, the Ink components, the key
handling, the `$EDITOR` suspend, and the conflict overlay. Depends on plan one
being done, and on nothing else.

Splitting them also means the facade gets used and reviewed before anything
depends on its shape.

## Measurements behind these decisions

Everything asserted above was measured rather than assumed.

| Claim | Result |
| --- | --- |
| Ink + React install cost | 38 packages, 23 MB; +1 for `ink-testing-library` |
| Suspend to `$EDITOR` | works without unmount; child gets a real tty |
| Unmount then rerender | does not resume; state updates dropped |
| `ink-testing-library` | renders to string, accepts synthetic keys |
| `loadAllIssues`, 200 issues | 50-125 ms in process, linear |
| `dz list --json` | 223 ms per process; carries body and log, so one call is the whole dataset |
| `dz set` | accepts all five editable fields in one invocation |
| `ditz2` package | bin-only today: no `main`, no `exports` |
