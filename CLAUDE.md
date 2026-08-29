# ditz2 — working notes

**Starting a session: read [HANDOFF.md](HANDOFF.md) first.** It has the current
state, what to pick up next, and the open questions. This file holds the things
that do not change; that one holds the things that do. Update it when you
finish a chunk of work.

## Toolchain

This is a an internal development host. Before any `node`, `npm` or `npx`:

```bash
source the local bootstrap script
```

System Node is v16; the script puts a vendored Node 21 ahead of it and points npm
at the internal registry mirror. `facebook/README.md` explains why. Running the
already-built `./dist/cli/main.js` does not need it.

```bash
npm ci
npm run typecheck && npm run build && npx vitest run
rm -rf .dz-fstest          # one test writes this scratch dir in the checkout
```

Source control is the local VCS, never git. Pass `--reason` to every `sl` command.

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
- The acceptance gate `sl status tests/` was run against the working tree,
  where it is empty because everything is committed. The check that meant
  something was `sl status --rev <base> --rev . tests/`.
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

- Lock acquisition used `link(2)`. EdenFS, the virtual filesystem some large
  monorepos are served from, rejects it with `EPERM`. Every mutating command
  failed in this very repository while 291 tests passed, because they build
  their projects under `os.tmpdir()`.
- `uuid@11` reads a global `crypto`. vitest polyfills it; the built binary has
  no such help.

Hence two standing rules: integration tests spawn the **built binary**, not the
TypeScript sources, and `tests/cli/repo-filesystem.test.ts` runs a project on
the checkout's own filesystem. On an ordinary clone it is redundant; here it is
the only test that would have caught the `link(2)` failure.

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
