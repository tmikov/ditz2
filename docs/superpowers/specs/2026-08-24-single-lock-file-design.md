# Single Project Lock Design

**Date:** 2026-08-24
**Status:** Approved for implementation
**Addresses:** issue `01a031fe-0172`, concurrent mutations can silently lose updates

Use one ephemeral lock file at `dz/.lock` to serialize all commands that modify
project state.

## Why a lock rather than a compare-and-swap

The alternative considered was preconditioning each write on the bytes that were
read: hash at read, verify immediately before the rename, abort on mismatch.
That is exact and needs no new state, but it only shrinks the race window rather
than closing it, and it does nothing at all for `edit`, where the window is
however long a human keeps the editor open.

Node has no `flock(2)`, so the lock cannot be released by the kernel when a
holder dies. That is a real cost and the reason abandoned locks need explicit
handling below, but it is a smaller cost than leaving `edit` unprotected.

## Scope

The following commands acquire the lock:

- `init`
- `add`
- `set`
- `comment`
- `close`
- `edit`
- `component add` and `component rm`

Read-only commands — `list`, `show`, `grep`, `doctor`, `schema`, and `help` — do
not acquire the lock. Atomic issue-file replacement ensures readers see either
the old or new complete file.

That guarantee is per file, not project-wide. A reader takes no lock, so it can
observe a multi-file operation midway: an `init` that has written `config.yaml`
but not yet `.gitignore`, or a `component rm` between the config write and the
issues that referenced it. Every individual file it reads is whole and valid;
the set is not necessarily a coherent moment. Making it one would mean readers
taking the lock, which would let a stuck lock block `list`.

This is a cooperative protocol. Direct manual edits cannot participate in it.

### What the lock does not protect

The lock serializes dz's own mutations against each other. It does not make a
concurrent `git commit` or `sl commit` atomic with respect to them. A commit
taken while an agent is working can capture issue A updated and issue B not yet:
nothing is corrupt, but the snapshot is mid-sequence. Closing that would mean
holding the lock across someone else's commit, which is not this tool's
business. The remedy is not to mutate while committing.

A commit can never capture a half-written issue file, because every write is a
same-directory temp file followed by `rename`. A reader sees the old complete
file or the new one.

## Lock file

The lock is stored at `dz/.lock` and contains diagnostic ownership metadata:

```json
{
  "version": 1,
  "token": "random UUID",
  "pid": 12345,
  "hostname": "dev123",
  "created": "2026-08-24T12:00:00.000Z",
  "command": "comment"
}
```

The random token identifies this particular acquisition. The remaining fields
allow errors and diagnostic commands to explain who owns the lock and whether
it may have been abandoned.

`dz init` writes `.lock` into `dz/.gitignore` alongside `config.local.yaml`,
appending without replacing any existing entry. `dz doctor` checks the same
list, rather than a copy of its own.

**Correction.** An earlier draft of this section claimed no projects predate
this design, so no migration was needed. That was wrong: ditz2 tracks its own
issues in `dz/`, created well before this work, and it is the first project the
code runs against. Re-running `dz init` appends whatever is missing and is the
migration; `doctor` reports the gap until then.

A committed `.lock` would be unrecoverable from inside the tool: it names a
foreign hostname, so `lockState` reads it as active forever, every mutation
fails `LOCKED`, `unlock` refuses it without `--force`, and `--force` deletes a
tracked file that the next checkout restores.

## Acquisition

1. Create `dz/.lock` with `O_CREAT|O_EXCL`, mode `0o600`.
2. `O_EXCL` is atomic and fails with `EEXIST` if the target exists, so exactly
   one process succeeds.
3. Write the ownership metadata into the descriptor, then close it. If the write
   fails, unlink the lock rather than leave one nobody can attribute.
4. If it already exists, retry (see below); on giving up, throw a typed
   `LOCKED` user error containing its owner, command, and age.
5. Acquire the lock before reading any state used by the mutation.

**Correction.** This section previously specified writing the metadata to a
temporary file and `link(2)`-ing it into place, on the grounds that `O_EXCL`
leaves a window in which another process sees an empty `dz/.lock`, reads it as
malformed, and `unlock --force` deletes a live lock. The reasoning holds, but
the mechanism does not: EdenFS, the virtual filesystem backing a large monorepo, where
ditz2 is developed, rejects `link(2)` with `EPERM`. Every mutating command
failed in ditz2's own repository while the whole test suite passed, because the
tests build their projects under `os.tmpdir()`. `O_EXCL`, `mkdir` and `rename`
all work on EdenFS; `link` alone does not.

The window is therefore real and is handled rather than designed away:
`breakLock` re-reads before removing and refuses to break a malformed lock that
has since become readable, which is exactly what an in-flight acquisition looks
like. A lock that is still unparseable on the second read is malformed for good.

`tests/cli/repo-filesystem.test.ts` runs a project on the checkout's own
filesystem for this reason. On an ordinary clone it duplicates the existing
coverage; inside a large monorepo it is the only test that exercises the case that
broke.

**`edit` is the deliberate exception to step 5.** It reads its baseline before
acquiring, because the alternative is holding the lock for the length of an
editing session. It compensates by re-comparing the exact bytes under the lock
before it commits; see below.

Conceptually, mutations run as follows:

```ts
withProjectLock(root, command, () => {
  const issue = readIssue(root, id);
  const updated = mutate(issue);
  writeIssue(root, updated);
});
```

Lock all writes for a uniform rule, even though independently generated UUID
filenames make concurrent `add` operations naturally unlikely to conflict.

`init` creates the whole project — `dz/`, `issues/`, `.gitignore`, and
`config.yaml` — *before* acquiring the lock, then takes it for everything after.

Locking earlier, with only `dz/` created, would be worse: a crash in that window
leaves a `dz/` containing a lock but no `config.yaml`. Root discovery keys on
`config.yaml`, so the project would be invisible to every command including
`unlock` and `doctor`, and the only remedy would be deleting a file by hand.
Creating the project first means a crash always leaves something the tools can
find. Nothing is at risk in the unlocked window, because `initProject` never
overwrites an existing file — two concurrent first-time inits both run it
harmlessly, and then one wins the lock.

### Retrying

Failing instantly on contention would push a retry loop onto every caller, and
AI agents running commands in parallel are a first-class consumer. A mutation
takes roughly 200 ms wall-clock, most of it Node startup, so the lock itself is
held for a small fraction of that and contention is typically brief.

Retry on `EEXIST` with a short delay until a timeout, then fail with `LOCKED`.
The timeout is read from `DZ_LOCK_TIMEOUT_MS`, defaulting to 2000; `0` means
fail immediately, which is what a caller wanting to implement its own policy
sets.

The CLI is synchronous throughout, so the delay needs a synchronous sleep —
`Atomics.wait` on a `SharedArrayBuffer` — rather than making acquisition async
and threading that through every command.

## Release

Release the lock in a `finally` block:

1. Verify that `dz/.lock` still contains the handle's random token.
2. Close the descriptor.
3. Delete `dz/.lock`.

**Do not install `SIGINT`/`SIGTERM` handlers.** This was in the original design
and is withdrawn: it cannot work here, and attempting it makes the tool worse.

A Node signal handler is a JS callback dispatched from the event loop, so it
cannot preempt synchronous JS — and this CLI is synchronous end to end.
Measured: with a handler registered, a `SIGINT` sent 0.6s into a 3s synchronous
block never ran the handler, and the work completed and exited 0. Registering a
listener also suppresses Node's default terminate-on-`SIGINT`, so the only
observable effect is that Ctrl-C no longer interrupts a running command. Without
the listener, the same `SIGINT` kills the process immediately.

Making it work would mean rewriting every command to be asynchronous so the loop
can turn — a large change for a case `dz unlock` already covers. A
`process.on('exit')` hook adds nothing either: it does not run on default signal
termination, and on normal exit the `finally` has already released.

So an interrupted command leaves the lock behind, exactly as a crash or
`SIGKILL` does. `dz doctor` reports it and `dz unlock` removes it. That is the
recovery path, and it is the same one for every way a holder can die.

## Abandoned locks

Do not automatically break a lock based only on age. A slow command and an
abandoned command cannot be distinguished reliably by elapsed time alone.

Provide a `dz unlock` command with these rules:

- If the lock belongs to the current hostname and its PID no longer exists,
  remove it.
- If that PID is alive, refuse to remove it.
- If the hostname differs or the metadata is malformed, require
  `dz unlock --force`.
- Re-read and verify the token immediately before removal.

PID liveness is a heuristic: a recycled PID makes a genuinely abandoned lock
look live, and the command then refuses until `--force`. That is the safe
direction to fail in.

**`dz unlock` is an administrative recovery command, not part of normal
operation.** Verifying the token and then unlinking is not atomic, and a single
pathname cannot offer atomic compare-and-delete: between the check and the
`unlink`, another process can acquire the lock, and `unlock` then deletes a lock
it never inspected. The window is small, but it cannot be closed at this design
point. Run it when nothing else is mutating the project. `--force` skips the
one check that makes accidental removal unlikely, so its help text and error
messages must say plainly that it can delete a live lock belonging to a running
command.

`releaseLock` has the same shape and the same residual window, but reaching it
requires our own lock to have been broken already, which means something has
gone wrong regardless.

`dz doctor` should diagnose abandoned and malformed locks. An active lock is
normally transient and is not itself a project defect. `doctor` and `unlock`
must share one predicate for deciding whether a lock is abandoned, rather than
each implementing the rules above, or the two will disagree as they drift.

Add `LOCKED` and `CONCURRENT_MODIFICATION` to the documented error codes and to
the `errorEnvelope` enum in the JSON schema. Both are user errors and exit with
status `1`. The schema has not shipped, so no version bump is needed.

## `edit`

`edit` must not hold the project lock while `$EDITOR` runs. An editing session
may last minutes or hours, and should not block unrelated mutations for that
entire time.

Instead, `edit` uses this sequence:

1. Read the actual issue file and retain its exact original bytes.
2. Create a scratch copy and open that copy in `$EDITOR`.
3. When the editor exits successfully, parse the scratch file and check that
   its `id` still equals the original. Reject the edit if it changed.
4. Acquire the project lock.
5. Re-read the actual issue file and compare its exact bytes with the retained
   original. A missing file also counts as a modification.
6. If the actual file is unchanged, re-load the configuration, run
   `validateIssue` again, commit the parsed issue through the normal write
   path, and release the lock.
7. If the actual file changed, retain its exact current bytes and release the
   lock immediately.
8. Ask what to do, holding no lock. The choices are reload the newer version
   and edit it again, force this version over it, or abort. Abort is the
   default in every ambiguous case: end of input, no terminal, `--json`, or
   `--on-conflict` unset in a non-interactive run.
9. On force, reacquire the lock and compare the actual file with the
   conflicting version retained in step 7. If it is unchanged, commit and
   release.
10. If the actual file changed again while waiting for an answer, release the
    lock and ask again using the newest version. This prevents an answer about
    one version from overwriting a later change.

**On the earlier deferral.** Steps 8-10 shipped after all. The stated cost was a
readline dependency and a TTY-only path the harness could not exercise. Both
were wrong: a synchronous single-line read on fd 0 is about thirty lines and
needs no dependency, and `script -qec` allocates a pty, so the interactive path
is covered end to end by ordinary integration tests.

`--on-conflict abort|force` gives scripts and agents the same choices without a
terminal. `reload` is deliberately not accepted there, since reloading means
reopening the editor.

Whatever a choice discards is written to a file and its path printed — the
abandoned attempt on reload, and the overwritten version on force. `edit`
appends no log entry, so a forced overwrite would otherwise leave no evidence
the other writer's version ever existed.

If the user aborts, preserve the scratch file and print its path so their work
is not lost. Invalid edits should likewise preserve the scratch file and report
its path.

The scratch lives in a private `mkdtemp` directory, which POSIX creates mode
`0700`, so another user on the machine cannot read the issue's contents. It is
removed on success. On any failure it is deliberately kept — that is the point,
it holds work that would otherwise be lost — which means failed edits accumulate
under the system temp directory until it is cleaned. Say so in the message, so
the path reads as something to go and use rather than debris.

Never prompt under `--json` or whenever stdin is not an interactive terminal.
Return a typed `CONCURRENT_MODIFICATION` user error, preserve the scratch file,
and include its path in the error message. A pipe is the case that must not
prompt: there may be nobody to answer, and a read would either block until the
producer closes or consume data meant for something else.

Every lock acquisition in this sequence covers only filesystem reads,
comparisons, and an optional write. No lock is held while the editor or a prompt
is open.

### The id may not change

`writeIssue` derives its destination from `issue.id`, and `parseIssue` does not
compare the id against the filename — only `readIssue` does, and `edit` bypasses
it by parsing the scratch directly. So an edit that changes the `id:` line
writes to a *different* path: it leaves the original issue untouched, creates a
second one, and silently overwrites any existing issue that happens to have the
new id.

After parsing the scratch, require the parsed id to equal the id that was read,
and reject the edit with `INVALID_FIELD` if it does not, naming both. Renaming
an issue is not an operation this tool offers; ids are identity.

### Validation must be repeated under the lock

Step 3 validates against the configuration as it was when the editor opened. A
session can last hours, and `dz component rm --force` can run in the meantime,
so by commit time the issue may name a component that no longer exists.
`writeIssue` will not catch it: its write-side guard checks that the rendered
bytes parse, not that the issue satisfies the invariants.

Re-load the configuration and call `validateIssue` again inside the lock,
immediately before writing. The early check stays: it fails fast, before taking
the lock, on the common case of a typo.

### Where the scratch file lives, and how the edit is committed

Step 6 commits by parsing the scratch file into an `Issue` and writing it
through the existing `writeIssue`, rather than renaming the scratch over the
target.

This matters for placement. `rename` is only atomic within a filesystem, and
fails with `EXDEV` across one — verified here, where the checkout is EdenFS and
`os.tmpdir()` is btrfs. Committing by rename would therefore force the scratch
onto the same filesystem as the issue. Committing through `writeIssue` does not:
the scratch is only ever read, and `writeIssue` does its own same-directory temp
and rename. The scratch can live in `os.tmpdir()`.

The scratch must not be placed in `dz/issues/`. Anything named `*.md` there is
read as an issue, so a concurrent `list` would report the scratch as a duplicate
or a stem mismatch.

Going through the normal write path also means `edit` gets the same validation,
the same write-side re-parse guard, and the same canonical output as every other
command, instead of being the one path that writes bytes nothing checked. The
cost is that hand-formatting inside the frontmatter is normalized on save, which
the README already documents as true of any rewrite.

It also improves the current failure mode. Today `edit` opens the real file in
place, so an invalid edit leaves a broken file on disk — the tool reports the
error and deliberately does not revert, because reverting would discard the
user's work. With a scratch copy the real file is never touched unless the edit
parses and validates, and the user's work is in the scratch whose path is
printed.

## What the lock does not cover, and what a second review found

Serialising writers is necessary but not sufficient. A second review of the
implementation found four ways project state could still be damaged or
misreported, all now fixed.

**`init`'s ordering stands; only the identity probe moved.** The review asked
for the opposite of what this document specifies: create just `dz/`, take the
lock, and write `.gitignore` and `config.yaml` under it, because two first-time
inits can otherwise both find `config.yaml` absent and overwrite each other.

That was tried and reverted. The race is real but benign — with an atomic
`saveConfig` one name wins whole, the same outcome as two `mkdir -p`. The
proposed fix is not benign. A crash between taking the lock and writing
`config.yaml` leaves a `dz/` holding a lock and no config, and root discovery
keys on `config.yaml`. Measured, in that state:

```
dz doctor  -> no dz/config.yaml found ...; run `dz init`
dz unlock  -> no dz/config.yaml found ...; run `dz init`
dz init    -> another dz command is modifying this project ...
              run 'dz unlock' if you believe it was abandoned
```

A closed circle, escapable only by deleting a file by hand. The existing order
guarantees a crash always leaves something the tools can find.

What the review got right is the VCS identity probe, which has moved out of the
lock: it is the tool's only subprocess, it can sit in a timeout for seconds, and
it reads nothing of the project.

**`config.yaml` needs the same atomic replace as issue files.** Writing in
place truncates first, and read-only commands deliberately take no lock, so
`dz list` can load an empty config while `dz component add` is writing and
report every issue's component as unknown. Sibling temporary file, then rename
within the directory.

**Lock metadata must be validated by value, not just by type.** Every field
feeds a decision. A negative `pid` reaches `process.kill(pid, 0)`, which
addresses a whole process group rather than one process, so a hand-written
`-1` read as a live lock. An unparseable `created` reached `Date.parse` and
printed `NaNs ago`. An unrecognised `version` means a future dz wrote the file
under rules this one does not know. All of these are malformed, which `unlock`
will not remove without `--force`.

**`breakLock` must require the re-read to match exactly.** Accepting an
unreadable re-read when a token was expected deleted a live lock in this
sequence: `unlock` diagnoses lock A, A is released, B wins `O_EXCL` and has not
written its metadata yet, the re-read comes back unreadable, and B's lock is
removed. Unreadable is not close enough to either case.

Two further findings were not accepted:

- Semantic validation was extended to cover the non-empty title and RFC 3339
  timestamps the JSON Schema promises, since `edit` is the one path that can
  write anything else. The schema test also had to be told to enforce
  `format`, which ajv ignores by default — every `date-time` assertion in it
  had been passing vacuously.
- The report asked for `SIGINT`/`SIGTERM` cleanup. That requirement was
  withdrawn earlier with measurements and remains withdrawn; see above.
