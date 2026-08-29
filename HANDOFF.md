# Handoff

Current state and what to pick up next. **This file goes stale** — update it
when you finish a chunk of work, and distrust anything here that the repository
contradicts. Durable knowledge belongs in `CLAUDE.md`, the specs, or the issue
tracker; this file is only the part that changes.

**Last updated:** 2026-08-29, on `master` at commit `7890b35` (uncommitted).

## State

**The suites now run on macOS as well as Linux.** They did not before: every
`dz edit` test and the whole UI end-to-end file failed there, on two GNU-only
assumptions that a Linux CI could never surface. `tests/pty.ts` is new and is
the only place either is decided; `tests/pty.test.ts` pins the Linux command
lines so that the branch the local machine does not take cannot rot unnoticed.
`CLAUDE.md` has the three BSD behaviours this cost, which are not guessable
from the man pages alone.

Also new, and unrelated to that: 129 of `package-lock.json`'s `resolved` URLs
pointed at a private registry mirror rather than the public one, so `npm ci`
could not install anywhere without credentials for it — and `--registry` does
not override a `resolved` URL. They are all on `registry.npmjs.org` now.
**A lockfile regenerated against a private mirror will reintroduce this**, so
check before committing one:

```bash
grep -c 'registry.npmjs.org' package-lock.json   # should equal the entry count
```

Counts as of this update: **401 tests** in the root package, **167** in `ui/`
(568 total), both typechecks clean. Verified on macOS across twelve consecutive
full runs, plus fifteen of the three timing-sensitive pty files alone, after one
real flake was found and fixed.

### Earlier state

Plan 2a (`docs/superpowers/plans/2026-08-26-ditz2-ui-browse.md`) shipped:
`ditz2-ui` is a real Ink terminal UI — browse, filter, read and refresh a
backlog — with two entry points (`runUi()` for `dz ui`, and the `dzui` binary)
and a pty end-to-end suite that runs the **built binaries**, not
`ink-testing-library`'s string rendering, against a real project on disk.

The final whole-branch review's fix wave has also landed: `App` now reserves
`CHROME_ROWS = 4` (the fourth row is `<Detail>`'s own top border, which no
component's line count had accounted for), `pad` truncates an overlong
`component` value instead of shifting the columns after it, and a vacuous
assertion in `src/cli/ui.test.ts` was replaced with one that actually fails on
the mutation it was meant to catch.

Tree clean at that point, with **381 tests passing** in the root package and
**118** in `ui/`; both typechecks clean. (Superseded by the
counts above — those were taken on Linux, before the macOS work.)

Re-derive rather than trusting the hashes above:

```bash
git log --oneline -5
```

**Nothing is pushed** without being asked.

## What exists

A complete CLI issue tracker, `dz`, whose issues are Markdown files under
`dz/`. It dogfoods itself: this project's own backlog lives in `dz/issues/`.

It also has a narrow public API at `src/api/`, published as the package's only
importable path through an `exports` map:

```ts
import { openProject } from 'ditz2';
const dz = openProject(process.cwd(), { env: process.env });
```

**The CLI calls that same API.** It is not a parallel implementation and must
never become one — see the rule about checkers holding their own copy of a rule
in `CLAUDE.md`. `init`, `schema` and `help` are the deliberate exceptions;
`init` is the only command that runs without an existing project, so it cannot
be a `Project` method.

## Next

Plan 2b, from `docs/superpowers/specs/2026-08-25-ditz2-tui-design.md`: the form
screen, `add`/`set`/`comment`/`close` from inside the UI, the `$EDITOR`
suspend-without-unmount sequence, the conflict overlay, and the lock-wait state
with its holder, timer and cancel key. `UiState.screen`, `UiState.overlay` and
the missing `waitingFor` field are shaped so each of these is an addition
rather than a rewrite — but plan 2b itself has no implementation plan written
yet.

Before writing that plan, re-run the spike behind these two spec assumptions on
Ink 6.8.0 (the spec measured Ink 7.1.1, which this project cannot install — see
"Deviations from the spec" in the plan 2a document):

- Ink's suspend-to-`$EDITOR` works **without unmounting**. The obvious
  `unmount()` then `rerender()` silently drops state updates and resumes
  showing pre-edit data.
- `ink-testing-library` renders to a plain string and accepts synthetic keys,
  so the UI is testable to the same standard as everything else here.

## Open questions

`package.json` declares `engines: ">=20"`, and both READMEs justify it by
`uuid@11` reading a global `crypto` absent below that. **That does not
reproduce everywhere.** System Node is v16.20.2, `globalThis.crypto` is
present, and `dz init`, `dz add` and `dz list` all work under it — so the
`#!/usr/bin/env node` shebang picks up unsupported Node and appears fine.

Either the floor is wrong or it is justified by a case this machine does not
exhibit. It is the one place the repository currently documents something there
is evidence against. Settle it before anyone relies on the explanation.

**`npm run <script> --workspace <name>` — and even a plain `npm run <script>`
run from inside a workspace member directory — reports exit code `0` on this
machine's npm (8.19.4) even when the script fails.** Confirmed with a minimal
reproduction outside this repository: a two-package workspace where the member
package's script is bare `false` still makes `npm run` exit `0`, both `cd`'ed
into the member and via `--workspace` from the root. This is a known class of
npm-workspaces bug, fixed in later npm releases; nothing here works around it.

**This is npm 8, not a property of the scripts.** On macOS with
npm 11.4.2 the exit status propagates correctly: `npm run test:ui` was observed
exiting 1 on a failing UI typecheck and 0 when clean. The warning below applies
wherever npm 8 is still in play.

Concretely, this means **`npm run test:all`, `npm run test:ui` and `npm run
typecheck --workspace ditz2-ui` cannot be trusted as pass/fail gates** — a
typecheck or test failure inside `ui/` prints its error to the log and then the
overall command still exits `0`. Verified directly: introducing `const n:
number = 'x';` into a `ui/tests/*.ts` file makes `npm run test:all` print
`error TS2322` and then finish with exit status `0`. Anyone scripting CI around
these commands must check the log text, not the exit code, until npm is
upgraded. `npm run test` (root, no workspace) and directly-invoked `npx vitest
run` / `npx tsc` are unaffected — this task's own verification used those, not
the wrapper scripts, for exactly this reason.

## Loose ends

Parked by review as non-blocking:

- `until` is still duplicated between `tests/cli/edit-double-race.test.ts` and
  `tests/cli/edit-scratch-path.test.ts`. `shq` no longer is — the portability
  work needed it in `tests/pty.ts`, so all four callers now import it from
  there, `ui/tests/e2e.test.ts` included.
- `parseEdit` hardcodes `'the edited text'` as its parse source label
  (`src/api/write.ts:160`), because the facade must not know about the CLI's
  scratch file.
- `lockTimeoutMs: 0` in `ui/src/index.tsx` is set but **not covered by any
  test**, because plan 2a performs no writes, so nothing can ever contend the
  lock. Verified by deliberately changing it to `2000`: the full `ui/` suite
  still passes. Plan 2b's first mutation test must assert that a contended lock
  surfaces as `LOCKED` immediately rather than after a two-second freeze.
- The `assignee:me` email-part rule in `ui/src/query.ts` is a guess about how
  people write assignees. Revisit it once the UI has been used.

One issue is open in the tracker and correctly so — run `dz list` to see it. It
is the lazily built sqlite cache for `list` and `grep`: `loadAllIssues` takes
50-125 ms over 200 issues and scales linearly, which is the first ceiling a TUI
refresh will hit.

## Plan 2b must pick a different key for the form

The design spec binds `Enter` on the list screen to "open the form". Task 12
took `Enter` for reading instead: it opens the selected issue full-screen and
scrollable, because the detail pane clips long issues and there was no way to
read one without leaving the UI for `dz show`.

So plan 2b needs another binding. `e` is already the spec's key for "body in
`$EDITOR`", so the candidates are `Tab` or `Ctrl-E`. Whichever it is, the
footer and the `?` overlay both have to name it — there are tests refusing a
footer that advertises keys which do nothing, and Task 12 added the mirror of
that rule for a working key nobody advertises.

`Enter` also closes the issue view, so 2b should not assume it is free there
either.

## Where the rest lives

| | |
| --- | --- |
| Toolchain, and the rules this project's defects earned | `CLAUDE.md` |
| Why it works the way it does | `README.md` |
| Designs and implementation plans | `docs/superpowers/` |
| The backlog | `dz list`, `dz show <prefix>` |
