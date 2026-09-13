# ditz2 — working notes

**Starting a session: read [HANDOFF.md](HANDOFF.md) first.** It has the current
state, what to pick up next, and the open questions. This file holds the things
that do not change; that one holds the things that do. Update it when you
finish a chunk of work.

## Toolchain

Any Node >= 20 and the public npm registry. Nothing else is required, and the
already-built `./dist/cli/main.js` needs no toolchain at all.

One exception: `npm run hermes` builds ditz2 to run under
[hermes-node](https://github.com/tmikov/hermes-node-compat), and needs a
`hermes-node` binary named by `$HERMES_NODE`. That is not on npm and cannot be
obtained by `npm ci`. Nothing else in this repository needs it, and
`tests/hermes/` skips itself when the variable is unset, so `npm ci && npm test`
stays Node-and-npm-only. See
`docs/superpowers/specs/2026-09-13-hermes-node-design.md`.

```bash
npm ci
npm run typecheck && npm run build && npx vitest run
rm -rf .dz-fstest          # one test writes this scratch dir in the checkout
```

If you are on a host whose npm is pointed at a private mirror, or which pins an
older Node, keep that setup in an untracked `CLAUDE.local.md` — it is specific
to your machine, not to this project, and this repository is public.

The UI lives in a second workspace, `ui/` (package `ditz2-ui`). It imports
`ditz2` through the published `exports` map, so `dist/` must be current:

```bash
npm run test:ui     # builds ditz2, then typechecks, builds and tests ditz2-ui
npm run test:all    # both packages, both test suites, both typechecks
```

`test:ui` typechecks `ui/tests/` as well as `ui/src/`. `ui/tsconfig.json`
excludes the tests and vitest does not typecheck, so without that step a type
error in a UI test is invisible.

`string-width` is held at `^7.2.0` by an `overrides` entry in the root
`package.json`, and that pin is load-bearing. Ink 6.5.0 bumped it to 8, which
matches graphemes with `/^\p{RGI_Emoji}$/v`; `RGI_Emoji` is a property of
strings, so the `v` flag cannot be rewritten to `u`, and Hermes — which `dz`
ships as, so `dz ui` runs inside it — rejects the flag at parse time. The
bundle then fails to compile before a line of it runs. Nothing under node
notices — `ui/`'s frame assertions pass unchanged on either major — which is
exactly the danger: a dependency refresh that quietly drops the override goes
green here and ships a binary that will not start.
`ui/tests/string-width-pin.test.ts` is what stands between the two.

`test:ui` calls `tsc` and `vitest` directly (`tsc -p ui/tsconfig.json`,
`tsc -p ui/tsconfig.test.json`, `vitest run --root ui`) rather than `npm run
<script> --workspace ditz2-ui`. npm 8 discards the exit status of any
workspace-member script, including one run by `cd`ing into the member directory
by hand: the failure is printed but the wrapping `npm run` still exits 0. npm
11 propagates it correctly. If you are on npm 8 and run `ui/`'s own
`npm run build`/`typecheck`/`test` scripts directly instead of through the root
`test:ui`, read the output — do not trust `$?`.

---

# Lessons this project paid for

Each rule below is here because ignoring it produced a real defect in this
repository. They are ordered by how often they have bitten.

## Make every check fail on purpose before you trust it

A check you have never seen fail is not evidence. This has been the single
largest source of wasted confidence here:

- A test written to cover a fix **passed before the fix was applied**. The
  implementer investigated instead of shipping it, and found the bug's real
  trigger was somewhere else entirely.
- A concurrency test for atomic config writes passed just as happily against
  the non-atomic implementation. It was replaced with an inode comparison,
  which cannot pass by luck.
- A test named `re-validates under the lock` passed with that validation
  deleted outright.
- The acceptance gate `git status tests/` was run against the working tree,
  where it is empty because everything is committed. The check that meant
  something was `git diff --name-only <base>..HEAD -- tests/`.
- A packed-tarball check confirmed runtime imports resolved and private paths
  were blocked — and passed while the `.d.ts` files it existed to verify did
  not exist at all.

So: after writing a test, break the code it covers and watch it fail. After
writing a verification command, construct the failure it is supposed to catch
and confirm it reports it. **Green on the wrong axis is worse than no check**,
because it buys confidence it has not earned.

## Run the real artifact in the real environment

Two separate bugs shipped behind a green suite because the test environment
differed from the deployment one:

- Lock acquisition used `link(2)`. Some virtual filesystems — the FUSE-backed
  checkouts large repositories are sometimes served from — reject it with
  `EPERM`. Every mutating command
  failed in this very repository while 291 tests passed, because they build
  their projects under `os.tmpdir()`.
- `uuid@11` reads a global `crypto`. vitest polyfills it; the built binary has
  no such help.

Hence two standing rules: integration tests spawn the **built binary**, not the
TypeScript sources, and `tests/cli/repo-filesystem.test.ts` runs a project on
the checkout's own filesystem. On an ordinary clone it is redundant; here it is
the only test that would have caught the `link(2)` failure.

## The tests run on two Unixes, and the shell tools differ on both

`sed -i` and `script` are spelled differently by GNU and BSD, and both are used
from generated `$EDITOR` scripts and pty runners where a wrong spelling is not
a portability warning — it is an editor that silently changed nothing, or a
`script` that never started. The whole `dz edit` suite failed on macOS this way
while passing on Linux.

**Never write `sed -i` or `script` in a test. Import from `tests/pty.ts`**,
which is the single place either spelling is decided, and which takes the
platform as an argument so that `tests/pty.test.ts` can pin the Linux command
lines from a Mac. That pinning is the point: whichever machine you are on, one
of the two branches is dead code no other test would notice breaking.

Three BSD behaviours that are not in the obvious diff between the two, all
confirmed against the built binaries rather than assumed:

- BSD `script` reads its stdin with `tcgetattr` and refuses a socket — which is
  exactly what libuv hands a spawned child for `stdio: 'pipe'`. An interposed
  `cat`, whose stdout is an ordinary pipe, is the way round it; the cost is
  that the caller must then close stdin, or the pipeline outlives the command.
- BSD `script` pushes an EOT into the pty when its own input ends, so a feed
  that exits right after writing an answer can deliver end-of-input ahead of
  the answer. The reader takes its no-answer path and the test measures the
  wrong branch. `a)bort: ^Df` in a transcript is what that looks like.
- BSD `script` gives the pty no winsize when its stdout is not a terminal;
  util-linux falls back to `COLUMNS`/`LINES`. `stty` inside the pty is the fix,
  and it must stay off when a test wants a terminal that reports no size.

## A checker must never hold its own copy of the rule it checks

`dz doctor` carried a private `IGNORE_LINE` constant while `config.ts` had
`IGNORE_LINES`. The two drifted, and `doctor` then certified as healthy the
exact broken state it existed to detect. When two places must agree, one
imports from the other. There is no third option.

The same reasoning is why the CLI calls `src/api/`: a facade written *beside*
the commands rather than *extracted from* them is the same bug waiting to
happen at a larger scale.

## When you harden one branch, look at its siblings

`breakLock` was fixed to refuse a malformed lock that had since become
readable — and the neighbouring branch was left accepting an unreadable
re-read, which deleted a live lock. Fixing one arm of a conditional is the
moment to re-read the others.

## Verify a plan's factual claims before following them

Instructions are not evidence either. In one plan: "nothing imports this file"
(two live call sites), a baseline type that made an error path loop forever,
and a message printed before the event it described. Each was caught by
someone who checked the premise rather than executing it. If an instruction
asserts a fact about the code, confirm it — and if it turns out false, report
it rather than working around it.

## Verified components can still be wrongly composed

`saveEdited`'s compare-and-swap was reviewed closely and is correct. It was
then handed inputs from a function that read the file twice, so a stale issue
could arrive with a fresh baseline and defeat the swap. Reviewing a function's
internals says nothing about whether its callers satisfy its preconditions —
and defects living *between* two correct pieces are exactly what per-unit
review cannot see.
